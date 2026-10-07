"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { SchedulePicker, type ScheduleSelection } from "@/components/booking-ui/schedule-picker";

export function StaffScheduleCalendar({ date, range = "day", status = "" }: { date: string; range?: ScheduleSelection["range"]; status?: string }) {
  const router = useRouter();
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) root.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && root.current?.open) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  function navigate({date: nextDate, range: nextRange, status: nextStatus}: ScheduleSelection) {
    if (nextDate) {
      if (root.current) root.current.open = false;
      router.push(`/staff/appointments?${new URLSearchParams({ date: nextDate, view: nextRange === "day" ? "day" : "list", range: nextRange, status: nextStatus })}`, {scroll:false});
    }
  }
  return <details data-dismissible-popover ref={root} className="staff-schedule-calendar">
    <summary className="staff-schedule-tab">
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h3M14 15h3"/></svg>
      <span>Calendar</span>
    </summary>
    <div className="staff-schedule-calendar-panel">
      <SchedulePicker key={date} date={date} range={range} status={status} onChange={navigate}/>
    </div>
  </details>;
}
