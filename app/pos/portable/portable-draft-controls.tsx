"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { portableDeviceStorage } from "@/lib/portable-device-storage";

type Saved<T> = { id: string; at: number; label: string; value: T };
export function PortableDraftControls<T>({ scope, active, activity, value, label, reset, restore, leading, onSavedChange, idleMinutes = 3, warningSeconds = 60 }: {
  idleMinutes?: number; warningSeconds?: number;
  leading?: ReactNode; scope: string; active: boolean; activity: string; value: T; label: string;
  reset: () => Promise<unknown>; restore: (value: T) => boolean; onSavedChange?: (values: T[]) => void;
}) {
  const key = `kingpos:parked-tickets:v1:${scope}`;
  const [saved, setSaved] = useState<Saved<T>[]>([]);
  const [pending, setPending] = useState<Saved<T> | null>(null);
  const savedChange = useRef(onSavedChange);
  useEffect(() => { savedChange.current = onSavedChange; }, [onSavedChange]);
  useEffect(() => { savedChange.current?.(saved.map(row => row.value)); }, [saved]);
  const [open, setOpen] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(60);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const current = useRef({ value, reset, active });
  useEffect(() => { current.current = { value, reset, active }; }, [value, reset, active]);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      try { const rows = JSON.parse(portableDeviceStorage.getItem(key) ?? "[]"); if (Array.isArray(rows)) setSaved(rows); }
      catch { setError("Unable to read saved tickets."); }
    });
    return () => { alive = false; };
  }, [key]);
  useEffect(() => {
    if (!active || pending) { const clear = setTimeout(() => setDeadline(null), 0); return () => clearTimeout(clear); }
    const timer = setTimeout(() => { setSeconds(warningSeconds); setDeadline(Date.now() + warningSeconds * 1000); }, idleMinutes * 60000);
    return () => clearTimeout(timer);
  }, [active, activity, tick, pending, idleMinutes, warningSeconds]);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      if (Date.now() >= deadline) { setDeadline(null); if (current.current.active) void current.current.reset(); }
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  function persist(rows: Saved<T>[]) {
    try { portableDeviceStorage.setItem(key, JSON.stringify(rows)); setSaved(rows); setError(""); return true; }
    catch { setError("Unable to save on this device. Your ticket is still open."); return false; }
  }
  async function park() {
    // Save first; never clear the working receipt after a storage failure.
    if (!persist([...saved, { id: crypto.randomUUID(), at: Date.now(), label, value: current.current.value }])) {
      setDeadline(null); setTick(t => t + 1); return;
    }
    setDeadline(null); await current.current.reset();
  }
  function handleOpenSaved(row: Saved<T>, currentTicket?: Saved<T>) {
    let rows = saved;
    if (currentTicket) {
      rows = [...saved, currentTicket];
      if (!persist(rows)) return;
    }
    if (!restore(row.value)) { setError("Unable to open this ticket. Both tickets have been kept."); return; }
    persist(rows.filter(item => item.id !== row.id));
    setPending(null); setDeadline(null); setTick(t => t + 1);
  }
  const button = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-md active:translate-y-0 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";
  return <>
    <div className="grid grid-cols-2 gap-2" data-pos-customer-shortcuts>
      {leading}
      <button type="button" aria-label={`Saved tickets (${saved.length})`} aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-20 min-w-0 items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 text-left transition hover:border-teal-300 hover:bg-teal-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-teal-700">
        <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-teal-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6"/></svg>
        <span className="min-w-0"><span className="block text-sm font-semibold">Saved tickets</span><span className="mt-1 block text-xs text-zinc-500">{saved.length ? `${saved.length} saved` : "None saved"}</span></span>
      </button>
      {active && <button type="button" onClick={() => void park()} className={button + " col-span-2 !min-h-10 !rounded-lg !shadow-none text-teal-800"}>Save for later</button>}
    </div>
    {error && !pending && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {open && createPortal(<div className="fixed inset-0 z-[85] bg-black/20" onClick={() => setOpen(false)}>
      <section role="dialog" aria-modal="true" aria-label="Saved tickets" className="fixed bottom-4 left-4 top-[88px] flex w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl" onClick={event => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b px-5 py-3"><h2 className="font-semibold">Saved tickets</h2><button type="button" className={button} onClick={() => setOpen(false)}>Close</button></header>
        <ul className="min-h-0 flex-1 divide-y overflow-auto px-4">{saved.length === 0 ? <li className="py-6 text-center text-sm text-zinc-500">No saved tickets</li> : saved.map(row => <li key={row.id} className="flex items-center gap-3 py-2">
          <button type="button" className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-teal-50 active:bg-teal-100 focus-visible:outline-2 focus-visible:outline-teal-600" onClick={() => {
            setOpen(false); setError("");
            if (active) { setDeadline(null); setPending(row); return; }
            handleOpenSaved(row);
          }}><span className="truncate font-semibold">{row.label}</span><time className="shrink-0 text-xs text-zinc-500">{new Date(row.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></button>
          <button type="button" className={button + " text-red-700 hover:bg-red-50"} aria-label={`Delete saved ticket ${row.label}`} onClick={() => persist(saved.filter(item => item.id !== row.id))}>Remove</button>
        </li>)}</ul>
      </section>
    </div>, document.body)}
    {pending && createPortal(<div className="fixed inset-0 z-[95] grid place-items-center bg-black/40 p-4">
      <section role="dialog" aria-modal="true" aria-label="Open saved ticket" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">Keep the current ticket?</h2>
        <p className="mb-5 mt-2 text-sm text-zinc-600">Save it for later, or reset it to open the saved ticket.</p>
        {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" className={button + " text-red-700"} onClick={() => handleOpenSaved(pending)}>Reset</button>
          <button type="button" className={button} onClick={() => { setPending(null); setError(""); setTick(t => t + 1); }}>Cancel</button>
          <button type="button" className={button.replace("bg-white", "bg-orange-600").replace("hover:bg-zinc-50", "hover:bg-orange-700") + " text-white"} onClick={() => handleOpenSaved(pending, { id: crypto.randomUUID(), at: Date.now(), label, value: current.current.value })}>Save</button>
        </div>
      </section>
    </div>, document.body)}
    {deadline && active && createPortal(<div className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Unfinished ticket">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><h2 className="text-lg font-semibold">Keep this ticket?</h2>
        <p className="mb-5 mt-2 text-sm leading-6 text-zinc-600">You haven’t used this ticket for {idleMinutes} minutes. Save it for later or continue working. It will be cleared in <strong className="tabular-nums">{seconds}s</strong>.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={button.replace("bg-white", "bg-teal-700").replace("hover:bg-zinc-50", "hover:bg-teal-800") + " border-teal-700 text-white"} onClick={() => void park()}>Save for later</button>
          <button type="button" className={button} onClick={() => { setDeadline(null); setTick(t => t + 1); }}>Continue</button>
          <button type="button" className={button + " text-red-700 hover:border-red-200 hover:bg-red-50"} onClick={() => { setDeadline(null); void current.current.reset(); }}>Discard</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}
