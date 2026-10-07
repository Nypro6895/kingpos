"use client";
import { mergeStaffRoster } from "@/lib/portable-staff-roster";
import { subscribePosChanges } from "@/lib/pos-workspace-sync";
import { portableBusinessDate } from "@/lib/portable-business-day";
import { nextPortableAttendance } from "@/lib/portable-attendance";
import { StaffAvatar } from "@/app/pos/portable/staff-avatar";
import { posUserMessage } from "@/lib/pos-user-messages";

import { prepareOfflineStaff, verifyAndSealStaffPasscode } from "@/lib/portable-offline-staff";
import { savePortableOperation } from "@/lib/portable-operations";
import type { PosDeskStaff } from "@/types/pos-desk";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  POS_STAFF_BROADCAST_EVENT,
  getPosStaffRealtimeChannel,
  type PosStaffBroadcastPayload,
} from "@/lib/pos-staff-realtime";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PortableAttendanceEventInput,
  PortableAttendanceEventUpdate,
  PortableCheckInData,
  PortableCheckInStaffRow,
} from "@/app/pos/portable/actions";
import { usePortableWorkspaceState } from "@/app/pos/portable/portable-workspace-state";

type ActionResult<T> =
  | { data: T; error?: never; ok: true }
  | { data?: never; error: string; ok: false };

type PortableCheckInClientProps = {
  workspacePath?: string;
  staffEndpoint?: string;
  action: (
    input: PortableAttendanceEventInput,
  ) => Promise<ActionResult<PortableAttendanceEventUpdate>>;
  data: PortableCheckInData;
};

type ModalState = {
  eventType: PortableAttendanceEventInput["eventType"];
  staff: PortableCheckInStaffRow;
} | null;

type ToastState = {
  detail: string;
  id: number;
  title: string;
};

const keypadKeys = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "clear",
  "0",
  "back",
];
const PASSCODE_IDLE_CLEAR_MS = 2 * 60 * 1000;
const TOAST_DISMISS_MS = 3000;
const LOCAL_ATTENDANCE_REFRESH_GRACE_MS = 2500;

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "ST"
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    auto_checked_out: "Auto checked out",
    break: "On break",
    checked_in: "Working",
    checked_out: "Checked out",
    not_checked_in: "Not checked in",
    unavailable: "On break",
    working: "Working",
  };

  return labels[status] ?? status.replaceAll("_", " ").toUpperCase();
}

function statusTone(status: string) {
  if (status === "working" || status === "checked_in") {
    return "border-emerald-300/70 bg-emerald-50/80 text-emerald-800";
  }

  if (status === "break" || status === "unavailable") {
    return "border-amber-300/70 bg-amber-50/80 text-amber-900";
  }

  if (status === "checked_out" || status === "auto_checked_out") {
    return "border-zinc-300/70 bg-zinc-100/70 text-zinc-600";
  }

  return "border-sky-300/70 bg-sky-50/80 text-sky-800";
}

function formatTime(value: string | null, timezone: string) {
  if (!value) {
    return "Not checked in";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Checked in";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function getSalonInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S"
  );
}

function getPrimaryEvent(status: string): PortableAttendanceEventInput["eventType"] {
  if (status === "working" || status === "checked_in") {
    return "LEAVE_OUT";
  }

  if (status === "break" || status === "unavailable") {
    return "RETURN_TO_WORK";
  }

  return "CHECK_IN";
}

function eventLabel(eventType: PortableAttendanceEventInput["eventType"]) {
  const labels = {
    CHECK_IN: "Check in",
    CHECK_OUT: "Check out",
    LEAVE_OUT: "Leave out",
    RETURN_TO_WORK: "Return to work",
  } satisfies Record<PortableAttendanceEventInput["eventType"], string>;

  return labels[eventType];
}

function toastTitle(eventType: PortableAttendanceEventInput["eventType"]) {
  const labels = {
    CHECK_IN: "Checked in",
    CHECK_OUT: "Checked out",
    LEAVE_OUT: "Leave out saved",
    RETURN_TO_WORK: "Back to work",
  } satisfies Record<PortableAttendanceEventInput["eventType"], string>;

  return labels[eventType];
}

function availableEvents(status: string): PortableAttendanceEventInput["eventType"][] {
  if (status === "working" || status === "checked_in") {
    return ["LEAVE_OUT", "CHECK_OUT"];
  }

  if (status === "break" || status === "unavailable") {
    return ["RETURN_TO_WORK", "CHECK_OUT"];
  }

  return ["CHECK_IN"];
}

function usePortableClock(timezone: string) {
  const [clock, setClock] = useState({ date: "", time: "" });

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setClock({
        date: new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "long",
          timeZone: timezone,
          weekday: "long",
          year: "numeric",
        }).format(now),
        time: new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZone: timezone,
        }).format(now),
      });
    }

    const timeoutId = window.setTimeout(updateClock, 0);
    const intervalId = window.setInterval(updateClock, 1000);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [timezone]);

  return clock;
}

export function PortableCheckInClient({
  workspacePath="/pos/portable/check-in",
  staffEndpoint="/api/pos/portable/staff",
  action,
  data,
}: PortableCheckInClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const workspaceState = usePortableWorkspaceState();
  const setStaffRoster = workspaceState?.setStaffRoster;
  const localAttendancePendingCountRef = useRef(0);
  const lastLocalAttendanceAtRef = useRef(0);
  const [localData, setLocalData] = useState<PortableCheckInData | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [savingStaffIds, setSavingStaffIds] = useState<string[]>([]);
  const sourceData = localData ?? data;
  const businessDate = workspaceState?.businessDate || "";
  const modalDay = useRef("");
  const viewData = { ...sourceData, today: businessDate || sourceData.today, staff: sourceData.staff.map(member => ({ ...member,
    ...(workspaceState && (sourceData.today !== businessDate || (member.checkInAt && portableBusinessDate(sourceData.timezone, member.checkInAt) !== businessDate)) ? { status: "not_checked_in", checkInAt: null, checkInSequence: null, queueTurnCount: 0, leaveCohortStaffIds: [], leaveBaselineTurnCount: null } : {}),
    ...(workspaceState?.attendanceByStaffId[member.id] ?? {}) })) };
  const scope = workspaceState?.offlineEnabled ? workspaceState.scope : undefined;
  useEffect(() => {
    let active = true;
    let loading = false;
    let again=false;
    const refresh = async (ids?: string[]) => {
      if (!navigator.onLine || !active || pathname!==workspacePath || document.visibilityState!=="visible") return;
      if(loading){again=true;return;}
      loading = true;
      try {
        const response = await fetch(staffEndpoint+(ids?.length?"?ids="+encodeURIComponent(ids.join(",")):""), { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (!response.ok) return;
        const fresh = await response.json() as PortableCheckInData;
        if (active && fresh.salonId === data.salonId && fresh.today === portableBusinessDate(data.timezone) && Array.isArray(fresh.staff)) setLocalData(current => ({...fresh, staff: mergeStaffRoster((current ?? data).staff, fresh.staff, (current ?? data).today === fresh.today ? ids : undefined)}));
      } catch { /* Keep the prepared roster while offline. */ }
      finally { loading = false; if(active&&again){again=false;void refresh();} }
    };
    const wake = () => { void refresh(); };
    const unsubscribe=subscribePosChanges(data.salonId,change=>{if(change.resource==="staff")void refresh(change.ids);});
    void refresh();
    document.addEventListener("visibilitychange", wake);
    return () => { active = false; unsubscribe(); document.removeEventListener("visibilitychange", wake); };
  }, [scope, data.salonId, data.today, data.timezone, businessDate, pathname, workspacePath, staffEndpoint]);
  useEffect(() => {
    setStaffRoster?.(sourceData.staff.map(member => ({ id: member.id, display_name: member.displayName,
      job_title: member.jobTitle, is_active: true, avatar_url: member.avatarUrl,
      check_in_at: member.checkInAt, check_in_sequence: member.checkInSequence,
      today_status: member.status as PosDeskStaff["today_status"],
      turns: { queueTurns: member.queueTurnCount, largeTurns: 0, smallTurns: 0, totalTurns: 0, receiptLargeTurns: 0 } })));
  }, [sourceData.staff, setStaffRoster]);

  useEffect(() => {
    if (!scope) return;
    const refresh = () => { void prepareOfflineStaff(scope, true); };
    refresh();
    const timer = setInterval(refresh, 300000);
    window.addEventListener("online", refresh);
    return () => { clearInterval(timer); window.removeEventListener("online", refresh); };
  }, [scope]);
  const clock = usePortableClock(viewData.timezone);
  const selectedEvents = useMemo(
    () => (modal ? availableEvents(modal.staff.status) : []),
    [modal],
  );

  const clearModal = useCallback(() => {
    setPasscode("");
    setModal(null);
    setError("");
  }, []);

  useEffect(() => {
    return () => {
      setPasscode("");
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPasscode("");
      setError("");
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname]);

  useEffect(() => {
    if (!modal || !passcode) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setPasscode("");
      setError("");
    }, PASSCODE_IDLE_CLEAR_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [modal, passcode]);


  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, TOAST_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  function openAction(staff: PortableCheckInStaffRow) {
    modalDay.current = portableBusinessDate(viewData.timezone);
    setModal({
      eventType: getPrimaryEvent(staff.status),
      staff,
    });
    setPasscode("");
    setError("");
    setToast(null);
  }

  function pressKey(key: string) {
    setError("");

    if (key === "clear") {
      setPasscode("");
      return;
    }

    if (key === "back") {
      setPasscode((current) => current.slice(0, -1));
      return;
    }

    setPasscode((current) => `${current}${key}`.slice(0, 32));
  }

  async function submit() {
    if (!modal || savingStaffIds.includes(modal.staff.id)) {
      return;
    }

    if (modalDay.current !== portableBusinessDate(viewData.timezone) || viewData.today !== portableBusinessDate(viewData.timezone)) {
      setError("A new day has started. Close this window and check in again."); return;
    }
    const eventType = modal.eventType;
    const staff = viewData.staff.find(member => member.id === modal.staff.id) ?? modal.staff;
    const staffName = staff.displayName;
    const submittedPasscode = passcode;
    setSavingStaffIds((current) => [...current, staff.id]);
    if (scope) {
      try {
        const sealedPasscode = await verifyAndSealStaffPasscode(scope, staff.id, submittedPasscode);
        const attendance = nextPortableAttendance(staff, viewData.staff, eventType);
        await savePortableOperation(scope, "attendance", { staffId: staff.id, eventType, sealedPasscode, attendance, businessDate: viewData.today });
        workspaceState?.setAttendance(staff.id, attendance);
        clearModal();
      } catch (error) {
        setError(posUserMessage(error instanceof Error ? error.message : "Unable to save check-in."));
      } finally { setSavingStaffIds(current => current.filter(id => id !== staff.id)); }
      return;
    }

    setLocalData((current) => {
      const source = current ?? viewData;
      const optimisticStatus =
        eventType === "CHECK_IN" || eventType === "RETURN_TO_WORK"
          ? "working"
          : eventType === "LEAVE_OUT"
            ? "break"
            : "checked_out";

      return {
        ...source,
        staff: source.staff.map((member) =>
          member.id === staff.id
            ? {
                ...member,
                checkInAt:
                  eventType === "CHECK_IN"
                    ? new Date().toISOString()
                    : member.checkInAt,
                status: optimisticStatus,
              }
            : member,
        ),
      };
    });
    workspaceState?.setAttendance(staff.id, {
      checkInAt:
        eventType === "CHECK_IN" ? new Date().toISOString() : staff.checkInAt,
      checkInSequence: staff.checkInSequence,
      queueTurnCount: staff.queueTurnCount,
      status:
        eventType === "CHECK_IN" || eventType === "RETURN_TO_WORK"
          ? "working"
          : eventType === "LEAVE_OUT"
            ? "break"
            : "checked_out",
    });
    clearModal();

    void (async () => {
      localAttendancePendingCountRef.current += 1;

      try {
        const result = await action({
          eventType,
          passcode: submittedPasscode,
          staffId: staff.id,
        });

        if (!result.ok) {
          setToast({
            detail: posUserMessage(result.error),
            id: Date.now(),
            title: `Could not save ${staffName}`,
          });
          setLocalData(null);
          workspaceState?.setAttendance(staff.id, null);
          return;
        }

        lastLocalAttendanceAtRef.current = Date.now();
        setLocalData((current) => {
          const source = current ?? viewData;

          return {
            ...source,
            staff: source.staff.map((member) =>
              member.id === result.data.staffId
                ? {
                    ...member,
                    checkInAt:
                      eventType === "CHECK_IN"
                        ? new Date().toISOString()
                        : member.checkInAt,
                    checkInSequence: result.data.checkInSequence,
                    isPasscodeDefault: result.data.isPasscodeDefault,
                    queueTurnCount: result.data.queueTurnCount,
                    status: result.data.status,
                  }
                : member,
            ),
            today: result.data.today,
          };
        });
        workspaceState?.setAttendance(staff.id, {
          checkInAt:
            eventType === "CHECK_IN" ? new Date().toISOString() : staff.checkInAt,
          checkInSequence: result.data.checkInSequence,
          queueTurnCount: result.data.queueTurnCount,
          status: result.data.status,
        });
        setToast({
          detail: `${eventLabel(eventType)} saved for ${staffName}.`,
          id: Date.now(),
          title: toastTitle(eventType),
        });
      } catch {
        setToast({
          detail: "Unable to update staff attendance.",
          id: Date.now(),
          title: `Could not save ${staffName}`,
        });
        setLocalData(null);
        workspaceState?.setAttendance(staff.id, null);
      } finally {
        localAttendancePendingCountRef.current = Math.max(
          0,
          localAttendancePendingCountRef.current - 1,
        );
        setSavingStaffIds((current) =>
          current.filter((staffId) => staffId !== staff.id),
        );
      }
    })();
  }

  if (!viewData.checkInEnabled) {
    return (
      <section
        className="grid h-full place-items-center bg-[#f8f4ef] px-6 text-center"
        data-portable-check-in-page
      >
        <div className="max-w-md rounded-lg border border-white/70 bg-white/70 p-6 shadow-sm backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-zinc-950">
            Staff check-in is off
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Enable staff check-in from POS Settings before using this Portable
            page.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f2ec] p-3 text-zinc-950"
      data-portable-check-in-page
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,#fffaf7_0%,#eef9f7_48%,#f8fafc_100%)]"
      />
      {!workspaceState && <header className="relative z-10 shrink-0 px-2 pb-3 pt-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/80 bg-white/64 text-base font-bold text-zinc-950 shadow-[0_14px_34px_rgba(24,24,27,0.12)] backdrop-blur-xl">
            {viewData.salonLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${viewData.salonName} logo`}
                className="h-full w-full object-cover"
                src={viewData.salonLogoUrl}
              />
            ) : (
              getSalonInitials(viewData.salonName)
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold leading-tight text-zinc-950">
              {viewData.salonName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium leading-tight text-zinc-600">
              <time>{clock.date || viewData.today}</time>
              <span aria-hidden="true" className="text-zinc-400">
                /
              </span>
              <time className="tabular-nums">{clock.time}</time>
            </div>
          </div>
        </div>
      </header>}

      <div className="relative z-10 grid min-h-0 flex-1 content-start gap-2.5 overflow-auto px-1 pb-24 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {viewData.staff.map((member) => {
          const isSaving = savingStaffIds.includes(member.id);
          const checkInLabel = formatTime(member.checkInAt, viewData.timezone);
          const sequenceLabel = member.checkInSequence
            ? `Seq ${member.checkInSequence}`
            : "No sequence";

          return (
            <button
              className="group relative min-h-[116px] overflow-hidden rounded-lg border border-white/65 bg-white/52 p-3 text-left shadow-[0_12px_28px_rgba(24,24,27,0.09)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/68 hover:shadow-[0_16px_36px_rgba(24,24,27,0.13)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              key={member.id}
              onClick={() => openAction(member)}
              title={`${member.displayName}: ${statusLabel(
                member.status,
              )}, turn ${member.queueTurnCount}, ${checkInLabel}`}
              type="button"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/52 via-white/18 to-teal-50/42 opacity-90"
              />
              <div className="relative flex h-full min-h-[92px] flex-col justify-between gap-2">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
                  <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-zinc-950 text-xs font-semibold text-white shadow-sm ring-1 ring-white/80">
                    {member.avatarUrl ? (
                      <StaffAvatar
                        className="h-full w-full object-cover"
                        src={member.avatarUrl}
                      />
                    ) : (
                      getInitials(member.displayName)
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold leading-tight">
                      {member.displayName}
                    </span>
                    <span
                      className={`mt-1.5 inline-flex max-w-full rounded-md border px-2 py-0.5 text-[11px] font-bold leading-5 ${statusTone(
                        member.status,
                      )}`}
                    >
                      <span className="truncate">
                        {statusLabel(member.status)}
                      </span>
                    </span>
                  </span>
                  <span className="grid min-w-11 justify-items-end rounded-md bg-white/55 px-2 py-1 ring-1 ring-white/70">
                    <span className="text-[9px] font-bold uppercase tracking-normal text-zinc-500">
                      Turn
                    </span>
                    <span className="text-xl font-black leading-none tabular-nums">
                      {member.queueTurnCount}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-white/60 pt-2 text-[11px] font-semibold leading-tight text-zinc-500">
                  <span className="truncate">{checkInLabel}</span>
                  <span
                    className={`truncate text-right ${
                      isSaving ? "text-emerald-700" : ""
                    }`}
                  >
                    {isSaving ? "Saving..." : sequenceLabel}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-[max(0.9rem,env(safe-area-inset-bottom))] right-[max(0.95rem,env(safe-area-inset-right))] z-20 opacity-85"
        data-portable-check-in-reylumi-logo
      >
        <Image
          alt=""
          className="h-auto w-24 object-contain drop-shadow-[0_12px_24px_rgba(24,24,27,0.16)]"
          height={419}
          src="/brand/reylumi-logo-horizontal.png"
          width={1527}
        />
      </div>

      {toast ? (
        <div
          aria-live="polite"
          className="fixed left-1/2 top-1/2 z-[70] w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-white/80 bg-white/80 p-4 shadow-[0_22px_60px_rgba(24,24,27,0.20)] backdrop-blur-xl"
          role="status"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/95 via-white/72 to-emerald-50/70"
          />
          <div className="relative flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgba(255,255,255,0.72)]"
            />
            <div className="min-w-0">
              <p className="text-base font-bold text-zinc-950">
                {toast.title}
              </p>
              <p className="mt-1 truncate text-sm font-medium text-zinc-600">
                {toast.detail}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {modal ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="grid max-h-[calc(100dvh-2rem)] w-full max-w-sm gap-4 overflow-hidden rounded-lg border border-white/70 bg-white/88 p-4 shadow-2xl backdrop-blur-xl">
            <div>
              <p className="text-sm font-bold text-zinc-500">
                {statusLabel(modal.staff.status)}
              </p>
              <h2 className="text-xl font-semibold">{modal.staff.displayName}</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Current turn {modal.staff.queueTurnCount}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {selectedEvents.map((eventType) => (
                <button
                  className={[
                    "min-h-11 rounded-md border px-3 py-2 text-sm font-semibold transition",
                    modal.eventType === eventType
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-300 bg-white/74 text-zinc-950 hover:bg-white",
                  ].join(" ")}
                  key={eventType}
                  onClick={() =>
                    setModal((current) =>
                      current ? { ...current, eventType } : current,
                    )
                  }
                  type="button"
                >
                  {eventLabel(eventType)}
                </button>
              ))}
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-zinc-700">Passcode</span>
              <div
                role="textbox"
                aria-label="Passcode"
                tabIndex={0}
                className="flex min-h-12 items-center justify-center rounded-md border border-zinc-300 bg-white/82 px-3 text-center text-2xl font-semibold tracking-[0.25em] shadow-inner focus:outline-2 focus:outline-zinc-950"
                onKeyDown={(event) => {
                  if (/^[0-9]$/.test(event.key)) { event.preventDefault(); pressKey(event.key); }
                  else if (event.key === "Backspace") { event.preventDefault(); pressKey("back"); }
                  else if (event.key === "Delete") { event.preventDefault(); pressKey("clear"); }
                }}
              >{"•".repeat(passcode.length)}</div>
            </label>

            <div className="grid grid-cols-3 gap-2">
              {keypadKeys.map((key) => (
                <button
                  className="min-h-14 rounded-md border border-zinc-300 bg-white/72 text-lg font-semibold text-zinc-950 transition hover:bg-white"
                  key={key}
                  onClick={() => pressKey(key)}
                  type="button"
                >
                  {key === "back" ? "Back" : key === "clear" ? "Clear" : key}
                </button>
              ))}
            </div>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {error}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                className="min-h-11 rounded-md border border-zinc-300 bg-white/76 px-3 py-2 font-semibold text-zinc-950 transition hover:bg-white"
                onClick={clearModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 font-semibold text-white transition hover:bg-zinc-800 disabled:bg-zinc-300"
                disabled={passcode.length < 4}
                onClick={submit}
                type="button"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
