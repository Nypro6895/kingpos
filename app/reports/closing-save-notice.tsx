"use client";
import { WorkspaceText } from "@/components/workspace-language";
import type { ClosingRow } from "@/lib/daily-closing-save";

export function ClosingSaveNotice({ phase, message, latest, storageWarning, pending, checkSaved, review }: {
  phase: string; message: string | null; latest: ClosingRow; storageWarning: boolean;
  pending?: unknown;
  checkSaved: () => void; review: (useSaved: boolean) => void;
}) {
  const attention = phase === "unknown" || phase === "review";
  if (!storageWarning && !message && !attention) return null;
  return <div aria-live="polite" className="space-y-3">
    {storageWarning ? <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">Draft storage is unavailable. Keep this window open until the saved result is confirmed.</p> : null}
    {message || attention ? <div className="border-l-2 border-zinc-300 pl-3 text-sm text-zinc-800">
      {message ? <p role="status"><WorkspaceText text={message}/></p> : null}
      {phase === "review" ? <>
      <p className="mt-2">Saved amounts: Cash ${latest.cashAmount.toFixed(2)} · Card ${latest.creditCardAmount.toFixed(2)} · Other ${latest.otherAmount.toFixed(2)}</p>
      <p className="mt-1 whitespace-pre-wrap break-words">Note: {latest.note || "Empty"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-lg border bg-white px-3" onClick={() => review(true)}>Use saved amounts</button>
        <button type="button" className="min-h-11 rounded-lg border bg-white px-3" onClick={() => review(false)}>Keep my entries for review</button>
      </div>
      </> : null}
      {phase === "unknown" || (phase === "review" && pending) ? <button type="button" className="mt-3 min-h-11 rounded-lg border bg-white px-3 text-sm" onClick={checkSaved}>Check saved result</button> : null}
    </div> : null}
  </div>;
}
