"use client";
import { useState } from "react";
import styles from "./schedule-picker.module.css";

export type ScheduleSelection = { date: string; range: "day" | "next7" | "all"; status: string };
export function SchedulePicker({ date, range, status, onChange }: ScheduleSelection & { onChange: (value: ScheduleSelection) => void }) {
  const [month, setMonth] = useState(date.slice(0, 7));
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  function shift(delta: number) { setMonth(new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7)); }
  return <div className={styles.picker}>
    <div className={styles.heading}><button type="button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button><strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)}</strong><button type="button" aria-label="Next month" onClick={() => shift(1)}>›</button></div>
    <div className={styles.days}>
      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}>{day}</span>)}
      {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`blank${i}`} />)}
      {Array.from({ length: count }, (_, i) => {
        const value = `${month}-${String(i + 1).padStart(2, "0")}`;
        return <button type="button" key={value} aria-label={value} aria-pressed={date === value} onClick={() => onChange({ date: value, range: "day", status })}>{i + 1}</button>;
      })}
    </div>
    <div className={styles.filters} aria-label="Date range">
      <button type="button" aria-pressed={range === "next7"} onClick={() => onChange({ date, range: "next7", status })}>1w</button>
      <button type="button" aria-label="All appointments in this month" aria-pressed={range === "all"} onClick={() => onChange({ date: `${month}-01`, range: "all", status })}>All</button>
      <span>{range === "all" ? "Selected month" : range === "next7" ? "7 days from selected date" : "Select a day"}</span>
    </div>
    <div className={styles.filters} aria-label="Appointment status">
      {[["", "All"], ["confirmed", "Confirmed"], ["pending", "Pending"], ["no_show", "No-show"]].map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => onChange({ date, range, status: value })}>{label}</button>)}
    </div>
  </div>;
}
