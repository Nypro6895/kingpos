import { mergeDuplicateCustomers } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { WorkspaceText } from "@/components/workspace-language";
import type { CustomerDuplicateCandidate } from "@/lib/customers";

export function DuplicateMergeForms({ customerId, candidates }: {
  customerId: string;
  candidates: CustomerDuplicateCandidate[];
}) {
  const eligible = candidates.filter(candidate => !candidate.mergeBlockedReason);
  return <div className="mt-3 grid gap-2">
    {eligible.length < candidates.length && <p className="text-xs text-amber-800"><WorkspaceText text="Some suggestions need review and will be kept separate." /></p>}
    <form action={mergeDuplicateCustomers}>
      <input name="target_customer_id" type="hidden" value={customerId} />
      <input name="merge_mode" type="hidden" value="all" />
      {candidates.map(candidate => <input key={candidate.id} name="source_customer_id" type="hidden" value={candidate.id} />)}
      <label className="mb-2 flex gap-2 text-xs"><input required type="checkbox" disabled={!eligible.length} /><WorkspaceText text="These records belong to the same person." /></label>
      <SubmitButton disabled={!eligible.length} pendingLabel="Processing…" className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><WorkspaceText text="Merge all" /> ({eligible.length})</SubmitButton>
    </form>
    <form action={mergeDuplicateCustomers} className="grid gap-2">
      <input name="target_customer_id" type="hidden" value={customerId} />
      {candidates.map(candidate => <label key={candidate.id} className="flex items-start gap-2 text-xs text-zinc-700">
        <input className="mt-0.5 h-4 w-4 shrink-0 accent-zinc-950" name="source_customer_id" type="checkbox" value={candidate.id} disabled={Boolean(candidate.mergeBlockedReason)} />
        <span className="min-w-0 break-words">{candidate.name}{candidate.mergeBlockedReason && <span className="block text-amber-800"><WorkspaceText text={candidate.mergeBlockedReason} /></span>}</span>
      </label>)}
      <label className="flex gap-2 text-xs"><input required type="checkbox" disabled={!eligible.length} /><WorkspaceText text="These records belong to the same person." /></label>
      <SubmitButton disabled={!eligible.length} pendingLabel="Processing…" className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50"><WorkspaceText text="Merge selected" /></SubmitButton>
    </form>
  </div>;
}
