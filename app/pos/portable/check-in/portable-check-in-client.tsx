"use client";

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

const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];
const PASSCODE_IDLE_CLEAR_MS = 2 * 60 * 1000;

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
    auto_checked_out: "AUTO_CHECKED_OUT",
    break: "ON_BREAK",
    checked_in: "WORKING",
    checked_out: "CHECKED_OUT",
    not_checked_in: "NOT_CHECKED_IN",
    unavailable: "ON_BREAK",
    working: "WORKING",
  };

  return labels[status] ?? status.toUpperCase();
}

function statusTone(status: string) {
  if (status === "working" || status === "checked_in") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "break" || status === "unavailable") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (status === "checked_out" || status === "auto_checked_out") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }

  return "border-sky-200 bg-sky-50 text-sky-800";
}

function formatTime(value: string | null, timezone: string) {
  if (!value) {
    return "Not checked in";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
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

function availableEvents(status: string): PortableAttendanceEventInput["eventType"][] {
  if (status === "working" || status === "checked_in") {
    return ["LEAVE_OUT", "CHECK_OUT"];
  }

  if (status === "break" || status === "unavailable") {
    return ["RETURN_TO_WORK", "CHECK_OUT"];
  }

  return ["CHECK_IN"];
}

export function PortableCheckInClient({
  action,
  data,
}: PortableCheckInClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [modal, setModal] = useState<ModalState>(null);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isPending, startTransition] = useTransition();
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
    if (!data.salonId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    const channel = supabase.channel(getPosStaffRealtimeChannel(data.salonId));
    channel
      .on(
        "broadcast",
        { event: POS_STAFF_BROADCAST_EVENT },
        ({ payload }: { payload: PosStaffBroadcastPayload }) => {
          if (payload.salonId === data.salonId) {
            router.refresh();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [data.salonId, router]);

  function openAction(staff: PortableCheckInStaffRow) {
    setModal({
      eventType: getPrimaryEvent(staff.status),
      staff,
    });
    setPasscode("");
    setError("");
    setNotice("");
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
      const result = await action({
        eventType: modal.eventType,
        passcode,
        staffId: modal.staff.id,
      });

      setPasscode("");

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setNotice(`${eventLabel(modal.eventType)} saved for ${modal.staff.displayName}.`);
      clearModal();
      router.refresh();
    });
  }

  if (!data.checkInEnabled) {
    return (
      <section
        className="grid h-full place-items-center bg-zinc-100 px-6 text-center"
        data-portable-check-in-page
      >
        <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-950">
            Staff check-in is off
          </h1>
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
      className="flex h-full min-h-0 flex-col overflow-hidden bg-zinc-100 p-3 text-zinc-950"
      data-portable-check-in-page
    >
      <header className="shrink-0 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-500">{data.today}</p>
            <h1 className="text-2xl font-semibold tracking-normal">
              Staff Check-in
            </h1>
          </div>
          <p className="text-sm font-medium text-zinc-600">{data.salonName}</p>
        </div>
        {notice ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            {notice}
          </p>
        ) : null}
      </header>

      <div className="mt-3 grid min-h-0 flex-1 content-start gap-3 overflow-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.staff.map((member) => (
          <button
            className="min-h-40 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            key={member.id}
            onClick={() => openAction(member)}
            type="button"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-zinc-950 text-sm font-semibold text-white">
                {getInitials(member.displayName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-semibold">
                  {member.displayName}
                </span>
                <span className="mt-1 block truncate text-sm text-zinc-500">
                  {member.jobTitle ?? "POS staff"}
                </span>
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <span
                className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${statusTone(
                  member.status,
                )}`}
              >
                {statusLabel(member.status)}
              </span>
              <span className="text-3xl font-bold tabular-nums">
                {member.queueTurnCount}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm text-zinc-500">
              <span>{formatTime(member.checkInAt, data.timezone)}</span>
              <span>
                {member.checkInSequence
                  ? `Seq ${member.checkInSequence}`
                  : "No sequence"}
              </span>
            </div>
          </button>
        ))}
      </div>

      {modal ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 p-4"
          role="dialog"
        >
          <div className="grid max-h-[calc(100dvh-2rem)] w-full max-w-sm gap-4 overflow-hidden rounded-lg bg-white p-4 shadow-2xl">
            <div>
              <p className="text-sm font-semibold text-zinc-500">
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
                    "min-h-11 rounded-md border px-3 py-2 text-sm font-semibold",
                    modal.eventType === eventType
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-300 bg-white text-zinc-950",
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
                className="min-h-12 rounded-md border border-zinc-300 px-3 text-center text-2xl font-semibold tracking-[0.25em]"
                inputMode="numeric"
                onChange={(event) => setPasscode(event.target.value)}
                type="password"
                value={passcode}
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              {keypadKeys.map((key) => (
                <button
                  className="min-h-14 rounded-md border border-zinc-300 bg-zinc-50 text-lg font-semibold text-zinc-950"
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
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-2 font-semibold text-zinc-950"
                onClick={clearModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 font-semibold text-white disabled:bg-zinc-300"
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
