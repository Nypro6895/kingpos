"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceText as Text } from "@/components/workspace-language";
import { readStaffDayFinancialInput, saveStaffDayFinancialInput } from "./staff-day-financial-actions";

export function StaffDayFinancialEditor({ salonId, staffId, businessDate, serviceTotal, tipAmount }: {
  salonId: string; staffId: string; businessDate: string; serviceTotal: number; tipAmount: number;
}) {
  const router = useRouter();
  const [opened, setOpened] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState<Awaited<ReturnType<typeof readStaffDayFinancialInput>> | null>(null);
  const [gross, setGross] = useState(String(serviceTotal)), [tip, setTip] = useState(String(tipAmount)), [note, setNote] = useState("");
  const intent = useRef<Parameters<typeof saveStaffDayFinancialInput>[0] | null>(null);
  const [unknown, setUnknown] = useState(false);
  async function open() {
    setOpened(true); setPending(true); setMessage("");
    try { const state = await readStaffDayFinancialInput(salonId, staffId, businessDate); setBaseline(state); setGross(state.service_total.toFixed(2)); setTip(state.tip_amount.toFixed(2)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Staff day could not be loaded."); }
    finally { setPending(false); }
  }
  async function save() {
    if (!baseline) return;
    if (!intent.current) {
      const service = Number(gross), tips = Number(tip);
      if (!gross.trim() || !tip.trim() || !Number.isFinite(service) || !Number.isFinite(tips) || service < 0 || tips < 0 || Math.round(service * 100) / 100 !== service || Math.round(tips * 100) / 100 !== tips || note.trim().length < 3) { setMessage("Enter nonnegative amounts in cents and a note."); return; }
      intent.current = { salonId, staffId, businessDate, scope: baseline.scope, requestId: crypto.randomUUID(), revision: baseline.revision, expectedService: baseline.service_total, expectedTip: baseline.tip_amount, serviceTotal: service, tipAmount: tips, note: note.trim() };
    }
    setPending(true); setMessage("");
    try {
      const result = await saveStaffDayFinancialInput(intent.current);
      if (result.status === "unknown") { setMessage(result.message); setUnknown(true); }
      else if (result.status === "error") { setMessage(result.message); intent.current = null; setUnknown(false); }
      else { setMessage(result.changed ? "Staff day saved. Change history updated." : "No amounts changed."); setBaseline({ ...baseline, ...result.current }); intent.current = null; setUnknown(false); router.refresh(); }
    } catch { setUnknown(true); setMessage("The save result is not confirmed. Retry the same request to check it safely."); }
    finally { setPending(false); }
  }
  if (!opened) return <button type="button" className="min-h-11 text-sm underline" onClick={open}><Text text="Edit gross / tip" /></button>;
  return <form className="my-2 grid min-w-0 gap-2 rounded border border-zinc-200 p-3 text-sm" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p><Text text="Gross service and tip inputs" /> · {businessDate}</p>
    <fieldset disabled={pending || unknown || !baseline} className="grid gap-2 disabled:opacity-60">
      <label><Text text="Gross service" /><input className="block w-full rounded border p-2" type="number" min="0" step="0.01" required value={gross} onChange={event => setGross(event.target.value)} /></label>
      <label><Text text="Tip" /><input className="block w-full rounded border p-2" type="number" min="0" step="0.01" required value={tip} onChange={event => setTip(event.target.value)} /></label>
      <label><Text text="Reason / note" /><textarea className="block w-full rounded border p-2" required minLength={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
      <p className="text-xs text-zinc-500"><Text text="Commission, tax, cash and check are calculated from these inputs and the effective pay settings." /></p>
    </fieldset>
    <div className="flex flex-wrap gap-3"><button type="submit" disabled={pending || !baseline} className="min-h-11 rounded border px-3 disabled:opacity-50"><Text text={pending ? "Saving..." : unknown ? "Retry same request" : "Save staff day"} /></button>{!unknown && <button type="button" disabled={pending} onClick={() => { setOpened(false); setBaseline(null); }} className="min-h-11"><Text text="Close" /></button>}</div>
    {message && <p role="status"><Text text={message} /></p>}
  </form>;
}
