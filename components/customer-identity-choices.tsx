"use client";

import type { CustomerIdentityChoice } from "@/types/customer-identity";

export function CustomerIdentityChoices({ candidates, disabled, onChoose }: {
  candidates: CustomerIdentityChoice[];
  disabled?: boolean;
  onChoose: (id: string | null) => void;
}) {
  if (!candidates.length) return null;
  return <section className="my-3 grid gap-2 border-y py-3 text-left" aria-label="Choose your customer profile">
    <p className="font-medium">Is one of these your profile?</p>
    <p className="text-sm text-zinc-600">Choose only your own name. This keeps your visits together.</p>
    {candidates.map(candidate => <button key={candidate.id} type="button" disabled={disabled}
      className="min-h-11 rounded border px-3 py-2 text-left" onClick={() => onChoose(candidate.id)}>
      {candidate.label} · {candidate.phoneHint}<span className="block text-xs text-zinc-500">{candidate.reason}</span>
    </button>)}
    <button type="button" disabled={disabled} className="min-h-11 px-3 py-2 text-left underline" onClick={() => onChoose(null)}>None of these — continue as a new customer</button>
  </section>;
}
