"use client";

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
  useTransition,
} from "react";
import type {
  PortableAttendanceEventInput,
  PortableCheckInData,
  PortableCheckInStaffRow,
} from "@/app/pos/portable/actions";

type ActionResult<T> =
  | { data: T; error?: never; ok: true }
  | { data?: never; error: string; ok: false };

type PortableCheckInClientProps = {
  action: (
    input: PortableAttendanceEventInput,
  ) => Promise<ActionResult<PortableCheckInData>>;
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
  action,
  data,
}: PortableCheckInClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const localAttendancePendingRef = useRef(false);
  const lastLocalAttendanceAtRef = useRef(0);
  const [localData, setLocalData] = useState<PortableCheckInData | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [isPending, startTransition] = useTransition();
  const viewData = localData ?? data;
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
    if (!viewData.salonId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    const salonId = viewData.salonId;
    const channel = supabase.channel(getPosStaffRealtimeChannel(salonId));
    channel
      .on(
        "broadcast",
        { event: POS_STAFF_BROADCAST_EVENT },
        ({ payload }: { payload: PosStaffBroadcastPayload }) => {
          if (payload.salonId !== salonId) {
            return;
          }

          const isOwnAttendanceRefresh =
            payload.source === "attendance" &&
            (localAttendancePendingRef.current ||
              Date.now() - lastLocalAttendanceAtRef.current <
                LOCAL_ATTENDANCE_REFRESH_GRACE_MS);

          if (!isOwnAttendanceRefresh) {
            setLocalData(null);
            router.refresh();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, viewData.salonId]);

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

  function submit() {
    if (!modal || isPending) {
      return;
    }

    startTransition(async () => {
      const eventType = modal.eventType;
      const staffName = modal.staff.displayName;
      localAttendancePendingRef.current = true;

      try {
        const result = await action({
          eventType,
          passcode,
          staffId: modal.staff.id,
        });

        setPasscode("");

        if (!result.ok) {
          setError(result.error);
          return;
        }

        lastLocalAttendanceAtRef.current = Date.now();
        setLocalData(result.data);
        setToast({
          detail: `${eventLabel(eventType)} saved for ${staffName}.`,
          id: Date.now(),
          title: toastTitle(eventType),
        });
        clearModal();
      } catch {
        setError("Unable to update staff attendance.");
      } finally {
        localAttendancePendingRef.current = false;
      }
    });
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
      <header className="relative z-10 shrink-0 px-2 pb-3 pt-1">
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
      </header>

      <div className="relative z-10 grid min-h-0 flex-1 content-start gap-2.5 overflow-auto px-1 pb-24 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
        {viewData.staff.map((member) => {
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
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        loading="lazy"
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
                  <span className="truncate text-right">{sequenceLabel}</span>
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
              <input
                autoComplete="off"
                className="min-h-12 rounded-md border border-zinc-300 bg-white/82 px-3 text-center text-2xl font-semibold tracking-[0.25em] shadow-inner"
                inputMode="numeric"
                onChange={(event) => setPasscode(event.target.value)}
                type="password"
                value={passcode}
              />
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
                disabled={isPending || passcode.length < 4}
                onClick={submit}
                type="button"
              >
                {isPending ? "Saving" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
