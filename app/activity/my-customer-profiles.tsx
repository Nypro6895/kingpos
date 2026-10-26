"use client";
import { useState } from "react";
import { getMyCustomerMergeGroups, mergeMyCustomerProfiles, type MyCustomerGroup } from "./customer-merge-actions";

export function MyCustomerProfiles() {
  const [groups, setGroups] = useState<MyCustomerGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <details className="border-y py-3 text-sm"><summary className="cursor-pointer">Combine my customer profiles</summary>
    <p className="my-2 text-zinc-600">Combine duplicate salon profiles already connected to your account. For an unlinked visit, use its receipt claim link or ask the salon.</p>
    <button type="button" disabled={busy} className="min-h-11 underline" onClick={async () => {
      setBusy(true); setMessage("");
      try { const rows = await getMyCustomerMergeGroups(); setGroups(rows); if (!rows.length) setMessage("No duplicate linked profiles found."); }
      catch (e) { setMessage(e instanceof Error ? e.message : "Please retry."); }
      finally { setBusy(false); }
    }}>Find my profiles</button>
    {groups?.map(group => <form key={group.salonId} className="my-3 grid gap-2" onSubmit={async e => {
      e.preventDefault(); if (busy) return;
      const form = new FormData(e.currentTarget); const targetId = String(form.get("target"));
      const sourceIds = form.getAll("source").map(String).filter(id => id !== targetId);
      if (!sourceIds.length) { setMessage("Select at least one other profile to combine."); return; }
      setBusy(true); setMessage("");
      try { await mergeMyCustomerProfiles({ salonId: group.salonId, targetId, sourceIds }); setGroups(await getMyCustomerMergeGroups()); setMessage("Your profiles were combined."); }
      catch (e) { setMessage(e instanceof Error ? e.message : "Please retry."); }
      finally { setBusy(false); }
    }}>
      <strong>{group.salonName}</strong>
      <label>Keep <select name="target" disabled={busy} className="max-w-full border p-2">{group.customers.map(c => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</select></label>
      {group.customers.map(c => <label key={c.id} className="flex gap-2"><input type="checkbox" disabled={busy} name="source" value={c.id} />{c.name} · {c.phone}</label>)}
      <label className="flex gap-2"><input required disabled={busy} type="checkbox" />These profiles are all mine.</label>
      <button disabled={busy} className="min-h-11 text-left font-medium">{busy ? "Processing…" : "Combine selected profiles"}</button>
    </form>)}
    {message && <p role="status">{message}</p>}
  </details>;
}
