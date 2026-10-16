"use client";
import { WorkspaceText } from "@/components/workspace-language";
import type { ClosingRow } from "@/lib/daily-closing-save";

export function ClosingSaveNotice({ phase, message, latest, storageWarning, checkSaved, review }: {
  phase: string; message: string | null; latest: ClosingRow; storageWarning: boolean;
  checkSaved: () => void; review: (useSaved: boolean) => void;
}) {
  const attention = phase === "unknown" || phase === "review";
  return <div aria-live="polite" className="space-y-3">
    {storageWarning ? <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Draft storage is unavailable. Keep this window open until the saved result is confirmed.</p> : null}
    {message ? <p className={`rounded border p-3 text-sm ${attention ? "border-amber-200 bg-amber-50 text-amber-950" : "border-zinc-200 bg-zinc-50 text-zinc-800"}`}><WorkspaceText text={message}/></p> : null}
    {attention ? <button type="button" className="min-h-11 rounded-lg border bg-white px-3 text-sm" onClick={checkSaved}>Check saved result</button> : null}
    {phase === "review" ? <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
      <p>Current report: Cash ${latest.cashAmount.toFixed(2)} · Card ${latest.creditCardAmount.toFixed(2)} · Other ${latest.otherAmount.toFixed(2)}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">Note: {latest.note || "Empty"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg border bg-white px-3" onClick={() => review(true)}>Use saved amounts</button>
        <button type="button" className="min-h-11 rounded-lg border bg-white px-3" onClick={() => review(false)}>Keep my entries for review</button>
      </div>
    </div> : null}
  </div>;
}
