"use client";

import { useState } from "react";
import { searchCustomersForMerge, mergeDuplicateCustomers } from "./actions";
import { SubmitButton } from "@/components/submit-button";

export function ManualMergePicker({ customerId }: { customerId: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<Awaited<ReturnType<typeof searchCustomersForMerge>>>([]);
  const [error, setError] = useState("");
  return <details className="border-y px-4 py-3 text-sm"><summary className="cursor-pointer">Merge customer records</summary>
    <p className="my-2 text-zinc-600">Keep this profile and move selected history into it. Different personal accounts cannot be merged.</p>
    <form className="flex flex-wrap gap-2" onSubmit={async e => {
      e.preventDefault(); setError("");
      try { setMatches(await searchCustomersForMerge({ name, phone, targetId: customerId })); }
      catch { setError("Could not find customers. Try again."); }
    }}>
      <input aria-label="Customer name to merge" className="min-w-0 flex-1 border-b p-2" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <input aria-label="Customer phone to merge" className="min-w-0 flex-1 border-b p-2" placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
      <button className="px-3 py-2" type="submit">Find</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {matches.length > 0 && <form action={mergeDuplicateCustomers} className="mt-3 grid gap-3">
      <input type="hidden" name="target_customer_id" value={customerId} />
      {matches.map(c => <label key={c.id} className="flex gap-2"><input type="checkbox" name="source_customer_id" value={c.id} disabled={Boolean(c.mergeBlockedReason)} /><span>{c.name} · {c.phone}<span className="block text-xs text-zinc-500">{c.mergeBlockedReason || c.match.reason}</span></span></label>)}
      <label className="flex gap-2"><input type="checkbox" required />I checked these records belong to the same person.</label>
      <SubmitButton disabled={matches.every(c => Boolean(c.mergeBlockedReason))} pendingLabel="Merging…" className="rounded-md bg-zinc-900 px-3 py-2 text-white">Merge selected history</SubmitButton>
    </form>}
  </details>;
}
