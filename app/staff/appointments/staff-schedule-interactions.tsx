"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const ConfirmationContext = createContext<{
  confirmed: Set<string>;
  markConfirmed: (bookingId: string) => void;
  noShows: Map<string, "excused" | "unexcused">;
  markNoShow: (bookingId: string, kind: "excused" | "unexcused") => void;
} | null>(null);

export function useStaffConfirmation() {
  return useContext(ConfirmationContext);
}

export function StaffScheduleInteractions({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [noShows, setNoShows] = useState<Map<string, "excused" | "unexcused">>(() => new Map());
  const value = useMemo(() => ({
    confirmed,
    markConfirmed: (bookingId: string) => setConfirmed(previous => new Set(previous).add(bookingId)),
    noShows,
    markNoShow: (bookingId: string, kind: "excused" | "unexcused") => setNoShows(previous => new Map(previous).set(bookingId, kind)),
  }), [confirmed, noShows]);

  useEffect(() => {
    function outside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // The no-show review and appointment/settings dialogs belong to the active flow.
      if (target.closest('dialog[open], [role="dialog"]')) return;
      root.current?.querySelectorAll<HTMLDetailsElement>('details[name="staff-appointment"][open]').forEach(row => {
        if (!row.contains(target)) row.open = false;
      });
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelector('dialog[open], [role="dialog"]')) return;
      root.current?.querySelectorAll<HTMLDetailsElement>('details[name="staff-appointment"][open]').forEach(row => {
        row.open = false;
        if (row.contains(document.activeElement)) row.querySelector("summary")?.focus();
      });
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);

  return <ConfirmationContext.Provider value={value}><div ref={root}>{children}</div></ConfirmationContext.Provider>;
}

export function StaffAppointmentStatus({ bookingId, children }: { bookingId: string; children: ReactNode }) {
  const state = useStaffConfirmation();
  if (state?.noShows.has(bookingId)) return <span className="staff-appointments-status-badge" role="status">{state.noShows.get(bookingId) === "excused" ? "No-show · With reason" : "No-show"}</span>;
  return state?.confirmed.has(bookingId)
    ? <span className="staff-appointments-status-badge staff-appointment-confirmed" role="status">Confirmed</span>
    : children;
}
