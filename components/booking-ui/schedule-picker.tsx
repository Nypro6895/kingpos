"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useState } from "react";
import styles from "./schedule-picker.module.css";

export type ScheduleSelection = { date: string; range: "day" | "next7" | "all"; status: string };
export function SchedulePicker({ date, range, status, onChange, today, loadCounts }: ScheduleSelection & { today?: string; loadCounts?: (month: string) => Promise<{counts?: Record<string,number>;error?:string}>; onChange: (value: ScheduleSelection) => void }) {
  const __vt = useWorkspaceTranslation();

  const [month, setMonth] = useState(date.slice(0, 7));
  const [markers,setMarkers] = useState<{month:string;counts:Record<string,number>;error?:string}|null>(null);
  useEffect(()=>{let active=true;if(loadCounts)void loadCounts(month).then(result=>{if(active)setMarkers({month,counts:result.counts??{},error:result.error});}).catch(()=>{if(active)setMarkers({month,counts:{},error:"Booking markers could not be loaded."});});return()=>{active=false;};},[month,loadCounts]);
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  function shift(delta: number) { setMonth(new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7)); }
  return <div className={styles.picker}>
    <div className={styles.heading}><button type="button" aria-label={__vt("Previous month")} onClick={() => shift(-1)}>‹</button><strong><WorkspaceText text={new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first)} /></strong><button type="button" aria-label={__vt("Next month")} onClick={() => shift(1)}>›</button></div>
    <div className={styles.days}>
      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <span key={day}><WorkspaceText text={day} /></span>)}
      {Array.from({ length: first.getUTCDay() }, (_, i) => <span key={`blank${i}`} />)}
      {Array.from({ length: count }, (_, i) => {
        const value = `${month}-${String(i + 1).padStart(2, "0")}`;
        return <button type="button" key={value} aria-label={__vt(value)} aria-current={today === value ? "date" : undefined} aria-pressed={date === value} onClick={() => onChange({ date: value, range: "day", status })}>{i + 1}{markers?.month===month && markers.counts[value]>0 && <small className={styles.marker} aria-label={`${markers.counts[value]} bookings`}>{markers.counts[value]}</small>}</button>;
      })}
    </div>
    {markers?.month===month && markers.error && <p role="status">{markers.error}</p>}
    <div className={styles.filters} aria-label={__vt("Date range")}>
      <button type="button" aria-pressed={range === "next7"} onClick={() => onChange({ date, range: "next7", status })}>1w</button>
      <button type="button" aria-label={__vt("All appointments in this month")} aria-pressed={range === "all"} onClick={() => onChange({ date: `${month}-01`, range: "all", status })}><WorkspaceText text="All" /></button>
      <span><WorkspaceText text={range === "all" ? "Selected month" : range === "next7" ? "7 days from selected date" : "Select a day"} /></span>
    </div>
    <div className={styles.filters} aria-label={__vt("Appointment status")}>
      {[["", "All"], ["confirmed", "Confirmed"], ["pending", "Pending"], ["no_show", "No-show"]].map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => onChange({ date, range, status: value })}><WorkspaceText text={label} /></button>)}
    </div>
  </div>;
}
