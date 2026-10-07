"use client";

import { useEffect, useRef, useState } from "react";

const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const label = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function TimeOffRangePicker({ start, end, onChange }: {
  start: string; end: string; onChange: (start: string, end: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(start.slice(0, 7));
  const [draft, setDraft] = useState({ start, end });
  const [selectingEnd, setSelectingEnd] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && open) { setOpen(false); trigger.current?.focus(); event.stopPropagation(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const first = new Date(`${month}-01T12:00:00Z`);
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  function move(offset: number) {
    setMonth(dateKey(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + offset, 1))).slice(0, 7));
  }
  function select(date: string) {
    if (!selectingEnd) { setDraft({ start: date, end: date }); setSelectingEnd(true); }
    else { setDraft({ start: date < draft.start ? date : draft.start, end: date < draft.start ? draft.start : date }); setSelectingEnd(false); }
  }
  return <div className="staff-timeoff-range" ref={root}>
    <button ref={trigger} type="button" className="staff-range-trigger" aria-expanded={open} onClick={() => {
      if (!open) { setDraft({ start, end }); setMonth(start.slice(0, 7)); setSelectingEnd(false); }
      setOpen(!open);
    }}>{label(start)}{start !== end ? ` – ${label(end)}` : ""}<span aria-hidden="true"> ▾</span></button>
    {open ? <div className="staff-range-calendar" role="group" aria-label="Time off dates">
      <div className="staff-range-month"><button type="button" aria-label="Previous month" onClick={() => move(-1)}>‹</button><strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</strong><button type="button" aria-label="Next month" onClick={() => move(1)}>›</button></div>
      <p aria-live="polite">{selectingEnd ? "Choose an end date, or apply for one day." : "Choose your first day off."}</p>
      <div className="staff-range-grid">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}>{day}</span>)}
        {Array.from({ length: first.getUTCDay() }, (_, index) => <span key={`space-${index}`} />)}
        {Array.from({ length: count }, (_, index) => {
          const date = `${month}-${String(index + 1).padStart(2, "0")}`;
          return <button type="button" key={date} aria-label={label(date)} aria-pressed={date >= draft.start && date <= draft.end} data-endpoint={date === draft.start || date === draft.end} onClick={() => select(date)}>{index + 1}</button>;
        })}
      </div>
      <div className="staff-range-footer"><span>{label(draft.start)}{draft.start !== draft.end ? ` – ${label(draft.end)}` : ""}</span><button type="button" className="staff-appointments-primary-button" onClick={() => { onChange(draft.start, draft.end); setOpen(false); trigger.current?.focus(); }}>Apply</button></div>
    </div> : null}
  </div>;
}
