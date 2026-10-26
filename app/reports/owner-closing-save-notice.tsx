"use client";
import { WorkspaceText } from "@/components/workspace-language";
import type { useDailyClosingSave } from "@/lib/daily-closing-client";

export function ClosingSaveNotice({ editor }: { editor: ReturnType<typeof useDailyClosingSave> }) {
  const recovery = editor.hasUnknown || editor.conflict || editor.status === "error";
  return <>
    {editor.message ? <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><WorkspaceText text={editor.message} /></p> : null}
    {recovery ? <div className="flex flex-wrap gap-2">
      <button type="button" disabled={editor.isPending} onClick={() => void editor.verify()} className="min-h-11 rounded-lg border bg-white px-3"><WorkspaceText text="Check saved result" /></button>
      {editor.hasUnknown ? <button type="button" disabled={editor.isPending || editor.locked} onClick={editor.retry} className="min-h-11 rounded-lg border bg-white px-3"><WorkspaceText text="Retry this same save" /></button> : null}
    </div> : null}
    {editor.conflict && editor.canReview && editor.remote ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p><WorkspaceText text="Saved amounts" />: Cash ${editor.remote.closingInputs.cashAmount.toFixed(2)} · Credit Card ${editor.remote.closingInputs.creditCardAmount.toFixed(2)} · Other ${editor.remote.closingInputs.otherAmount.toFixed(2)}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => editor.useRemote(false)} className="min-h-11 rounded-lg border bg-white px-3"><WorkspaceText text="Use saved amounts" /></button><button type="button" onClick={() => editor.useRemote(true)} className="min-h-11 rounded-lg border bg-white px-3"><WorkspaceText text="Keep my entries for review" /></button></div>
    </div> : null}
  </>;
}

export function ClosingSaveStatus({status}: {status: ReturnType<typeof useDailyClosingSave>["status"]}) {
  const label = {loading: "Loading saved amounts", idle: "", saving: "Saving", saved: "Saved", error: "Error", unknown: "Save not confirmed", verifying: "Checking saved result", conflict: "Review saved amounts"}[status];
  return label ? <span><WorkspaceText text={label} /></span> : null;
}
