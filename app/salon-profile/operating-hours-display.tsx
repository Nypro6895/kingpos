"use client";
import { useEffect, useState } from "react";
import { loadVisibleProfileHours } from "./operating-hours-actions";
import type { SalonOperatingHoursSettings } from "@/types/salon-operating-status";

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function time(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
}
export function OperatingHoursDisplay({ salonId, initialSettings, compact = false }: { salonId: string; initialSettings?: SalonOperatingHoursSettings | null; compact?: boolean }) {
  const [loadedSettings, setSettings] = useState<SalonOperatingHoursSettings | null>(null);
  const settings = initialSettings ?? loadedSettings;
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (initialSettings) return;
    let active = true;
    loadVisibleProfileHours(salonId).then(result => { if (active) { setSettings(result.settings); setError(result.error ?? ""); } }).catch(() => { if (active) setError("Could not load operating hours."); });
    return () => { active = false; };
  }, [salonId, retry, initialSettings]);
  if (!settings) return <div role="status">{error || "Loading operating hours…"}{error ? <button type="button" className="ml-2 underline" onClick={() => { setError(""); setRetry(value => value + 1); }}>Retry</button> : null}</div>;
  const schedule: { first: number; last: number; count: number; hours: string }[] = [];
  for (const index of [1, 2, 3, 4, 5, 6, 0]) {
    const hours = settings.weeklyHours.filter(row => row.dayOfWeek === index).sort((a, b) => a.opensAtLocal.localeCompare(b.opensAtLocal)).map(row => `${time(row.opensAtLocal)} – ${time(row.closesAtLocal)}`).join(", ") || "Closed";
    const previous = schedule.at(-1);
    if (previous?.hours === hours) { previous.last = index; previous.count++; }
    else schedule.push({ first: index, last: index, count: 1, hours });
  }
  return <div className="grid gap-3 text-sm">
    <p><strong className={settings.status.isOpen ? "text-emerald-700" : "text-red-600"}>{settings.status.label}</strong>{settings.status.detail ? <span className="ml-2 text-zinc-500"><span aria-hidden="true" className="mr-2">·</span>{settings.status.detail}</span> : null}</p>
    {settings.weeklyHours.length ? <dl className="grid gap-2">{(compact && !expanded ? schedule.slice(0,3) : schedule).map(row => <div key={row.first} className="flex items-start justify-between gap-4"><dt className="text-zinc-600">{row.count === 7 ? "Daily" : row.count === 1 ? days[row.first] : `${days[row.first].slice(0,3)} – ${days[row.last].slice(0,3)}`}</dt><dd className="text-right">{row.hours}</dd></div>)}</dl> : <p className="text-zinc-500">Hours not set</p>}
    {compact && schedule.length > 3 ? <button type="button" className="justify-self-start text-xs text-teal-700" onClick={() => setExpanded(value=>!value)}>{expanded ? "Show less" : "View all hours"}</button> : null}
    {settings.specialHours.filter(day => day.localDate >= settings.status.localDate).sort((a, b) => a.localDate.localeCompare(b.localDate)).map(day => <p key={day.id}>{day.localDate}: {day.status === "closed" ? "Closed" : `${time(day.opensAtLocal!)} – ${time(day.closesAtLocal!)}`}{day.reason ? ` · ${day.reason}` : ""}</p>)}
    <p className="text-xs text-zinc-500" hidden={compact}>Times shown in {settings.timeZone}. Booking availability may vary.</p>
  </div>;
}
