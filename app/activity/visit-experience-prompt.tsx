"use client";

import { recordVisitExperienceAction } from "@/app/activity/actions";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useId, useState, useTransition, type FormEvent } from "react";

type VisitExperiencePromptProps = {
  actionLabel?: string;
  compact?: boolean;
  countsTowardReputation: boolean; // Historical payload; never a Truth v2 eligibility claim.
  initialBody?: string | null;
  initialState?: "good" | "issue" | null;
  salonName: string;
  ticketId: string;
  windowDays: number;
};

export function VisitExperiencePrompt({ actionLabel = "Review visit", compact = false, initialBody = null,
  initialState = null, salonName, ticketId }: VisitExperiencePromptProps) {
  const translate = useWorkspaceTranslation();
  const labelId = useId();
  const [expanded, setExpanded] = useState(!compact);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(initialBody ?? "");
  const [savedBody, setSavedBody] = useState(initialBody ?? "");
  const [draftState, setDraftState] = useState<"good" | "issue" | null>(initialState);
  const [savedState, setSavedState] = useState(initialState);
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();
  const stateLabel = savedState === "issue" ? "Issue shared" : "Good shared";

  function save(feedbackState: "good" | "issue", nextBody = body) {
    startTransition(async () => {
      setStatus("");
      try {
        const result = await recordVisitExperienceAction({ body: nextBody, feedbackState, ticketId });
        if (result.error !== null) { setStatus(result.error); return; }
        setSavedState(feedbackState); setSavedBody(nextBody.trim()); setBody(nextBody.trim());
        setDraftState(feedbackState); setEditing(false);
        setStatus("Your feedback has been saved.");
      } catch { setStatus("Feedback could not be saved. Your draft is still here. Please try again."); }
    });
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (draftState) save(draftState); }
  function cancel() { setBody(savedBody); setDraftState(savedState); setEditing(false); setStatus(""); }

  if (compact && !expanded) return <button type="button" onClick={() => setExpanded(true)} className="min-h-11 px-2 text-sm font-semibold text-brand-teal"><WorkspaceText text={savedState ? stateLabel : actionLabel} /></button>;

  return <section aria-label={translate("Your visit feedback")} className="grid w-full min-w-0 gap-3 border-t border-border-subtle py-3 text-left text-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-semibold uppercase text-brand-teal"><WorkspaceText text="Verified Visit" /></p>
        <h3 className="mt-1 font-semibold"><WorkspaceText text={savedState && !editing ? stateLabel : "How was your experience?"} /></h3>
      </div>
      {compact ? <button disabled={isPending} type="button" onClick={() => { cancel(); setExpanded(false); }} className="min-h-11 px-3 font-semibold"><WorkspaceText text="Close" /></button> : null}
    </div>
    {savedState && !editing ? <>
      {savedBody ? <p className="whitespace-pre-wrap break-words leading-6">{savedBody}</p> : null}
      <button type="button" className="min-h-11 justify-self-start text-brand-teal underline underline-offset-4" onClick={() => { setEditing(true); setDraftState(savedState); setStatus(""); }}><WorkspaceText text="Edit my feedback" /></button>
    </> : <>
      <p className="text-xs leading-5 text-text-secondary"><WorkspaceText text="Your feedback is shared with the salon and may appear in its Experiences. LUMI Truth uses the latest eligible feedback from each independent customer. A verified visit does not guarantee inclusion." /></p>
      <p className="text-xs font-medium">{salonName}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isPending} aria-pressed={draftState === "good"} className="min-h-11 rounded-full border border-brand-teal px-4 font-semibold text-brand-teal aria-pressed:bg-brand-teal aria-pressed:text-white" onClick={() => { if (editing) setDraftState("good"); else save("good", ""); }}><WorkspaceText text="Good" /></button>
        <button type="button" disabled={isPending} aria-pressed={draftState === "issue"} className="min-h-11 rounded-full border border-brand-orange px-4 font-semibold text-brand-orange aria-pressed:bg-brand-orange aria-pressed:text-white" onClick={() => setDraftState("issue")}><WorkspaceText text="Had an issue" /></button>
      </div>
      {draftState ? <form className="grid gap-2" onSubmit={submit}>
        <label htmlFor={labelId} className="text-xs font-medium"><WorkspaceText text="Optional details" /></label>
        <textarea id={labelId} className="min-h-24 w-full resize-y rounded-lg border border-border-subtle bg-white px-3 py-2 text-base leading-6 text-text-primary" maxLength={1000} disabled={isPending} onChange={event => setBody(event.currentTarget.value)} value={body} />
        <p className="text-xs text-text-secondary">{body.length}/1000</p>
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 bg-white py-2">
          <button type="button" disabled={isPending} className="min-h-11 px-3" onClick={cancel}><WorkspaceText text="Cancel" /></button>
          <button type="submit" disabled={isPending} className="min-h-11 rounded-full bg-brand-orange px-5 font-semibold text-white disabled:opacity-60"><WorkspaceText text={isPending ? "Saving..." : editing ? "Save feedback" : "Share issue"} /></button>
        </div>
      </form> : null}
    </>}
    <p role="status" aria-live="polite" className="text-xs leading-5 text-text-secondary"><WorkspaceText text={status} /></p>
  </section>;
}
