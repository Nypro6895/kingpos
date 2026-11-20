"use client";

import { useId, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { TimeZoneSelect } from "@/components/time-zone-select";
import type { SalonOperatingHoursWindow } from "@/types/salon-operating-status";
import { saveDirectHours } from "./direct-settings-actions";
import { InlineForm, text, type DirectData } from "./direct-settings-ui";
import "./opening-hours-editor.css";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
type Hours = SalonOperatingHoursWindow[];

function clock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, 0, 1, hour, minute)));
}

export function OpeningHoursEditor({ data, onSaved }: {
  data: Extract<DirectData, { kind: "salon-profile" }>;
  onSaved: () => Promise<void>;
}) {
  const __vt = useWorkspaceTranslation(), id = useId();
  const [windows, setWindows] = useState<Hours>(data.hours.weeklyHours);
  const [changed, setChanged] = useState(false);
  const [loadedHours, setLoadedHours] = useState(data.hours.weeklyHours);
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const closedDrafts = useRef(new Map<number, Hours>());
  if (loadedHours !== data.hours.weeklyHours && !changed) {
    setLoadedHours(data.hours.weeklyHours);
    setWindows(data.hours.weeklyHours);
  }
  function update(value: Hours | ((current: Hours) => Hours)) {
    setWindows(value);
    setChanged(true);
  }
  function add(dayOfWeek: number) {
    update(current => [...current, { dayOfWeek, opensAtLocal: "09:00", closesAtLocal: "17:00", sortOrder: current.filter(w => w.dayOfWeek === dayOfWeek).length }]);
  }
  function reset() {
    setWindows(data.hours.weeklyHours);
    setChanged(false);
    closedDrafts.current.clear();
    setActiveDay(null);
  }
  return <InlineForm className="settings-opening-hours" changed={changed} label={__vt("Save opening hours")}
    save={form => saveDirectHours(data.salonId, { timeZone: text(form, "timezone"), weeklyHours: windows })}
    onSaved={async () => { setLoadedHours(data.hours.weeklyHours); setChanged(false); closedDrafts.current.clear(); await onSaved(); }}
    onCancel={reset}>
    <label className="opening-hours-zone"><WorkspaceText text="Time zone" />
      <TimeZoneSelect compactLabel name="timezone" defaultValue={data.hours.timeZone} required />
    </label>
    <div className="opening-hours-week" aria-label={__vt("Weekly opening hours")} onInvalidCapture={event => {
      const day = (event.target as HTMLElement).closest<HTMLElement>(".opening-hours-day")?.dataset.day;
      if (day !== undefined) setActiveDay(Number(day));
    }}>
      {days.map((day, dayOfWeek) => {
        const entries = windows.map((value, index) => ({ value, index })).filter(({ value }) => value.dayOfWeek === dayOfWeek);
        const isOpen = entries.length > 0;
        return <details className="opening-hours-day" key={day} data-day={dayOfWeek} open={activeDay === dayOfWeek}>
          <summary aria-controls={`${id}-${dayOfWeek}`} onClick={event => { event.preventDefault(); setActiveDay(current => current === dayOfWeek ? null : dayOfWeek); }}>
            <span className="opening-hours-day-name"><WorkspaceText text={day} /></span>
            <span className={`opening-hours-summary ${isOpen ? "" : "opening-hours-closed"}`}>
              {isOpen ? entries.map(({ value, index }) => <span key={index}>{clock(value.opensAtLocal)} – {clock(value.closesAtLocal)}</span>) : <WorkspaceText text="Closed" />}
            </span>
            <span className="opening-hours-chevron" aria-hidden="true">›</span>
          </summary>
          <div className="opening-hours-day-editor" id={`${id}-${dayOfWeek}`}>
            <label className="opening-hours-open settings-toggle-field"><span className="settings-toggle-label"><WorkspaceText text="Open" /></span>
              <input type="checkbox" role="switch" aria-label={__vt(`${day}: Open`)} checked={isOpen}
                onChange={event => {
                  if (event.target.checked) {
                    const restore = closedDrafts.current.get(dayOfWeek);
                    if (restore?.length) update(current => [...current, ...restore]); else add(dayOfWeek);
                  } else {
                    closedDrafts.current.set(dayOfWeek, entries.map(({ value }) => value));
                    update(current => current.filter(value => value.dayOfWeek !== dayOfWeek));
                  }
                }} /><span className="settings-toggle-track" aria-hidden="true"><span /></span>
            </label>
            {entries.map(({ value, index }, rangeIndex) => <div className="opening-hours-range settings-hours-window" key={`${day}-${index}`}>
              {(["opensAtLocal", "closesAtLocal"] as const).map(key => <label className="opening-hours-time" key={key}>
                <WorkspaceText text={key === "opensAtLocal" ? "Opens" : "Closes"} />
                <input type="time" required aria-label={__vt(`${day}: ${key === "opensAtLocal" ? "Opens" : "Closes"} ${rangeIndex + 1}`)}
                  value={value[key].slice(0, 5)} onChange={event => update(current => current.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item))} />
              </label>)}
              <button type="button" className="opening-hours-remove" aria-label={__vt(`Remove ${day} time range ${rangeIndex + 1}`)}
                onClick={() => update(current => current.filter((_, i) => i !== index))}><span aria-hidden="true">×</span></button>
            </div>)}
            {isOpen ? <button type="button" className="opening-hours-add" onClick={() => add(dayOfWeek)}>+ <WorkspaceText text="Add time range" /></button> : null}
          </div>
        </details>;
      })}
    </div>
    <details className="opening-hours-help"><summary><WorkspaceText text="About opening hours" /></summary>
      <p><WorkspaceText text="Opening hours show customers when the salon is open. Set each staff member’s booking hours in Hours & booking." /></p>
    </details>
  </InlineForm>;
}
