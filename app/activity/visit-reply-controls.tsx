"use client";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { replyToVisitExperienceAction, setVisitExperienceStatusAction } from "./experience-actions";

export function VisitReplyControls({ salonId, experienceId, hasReply, issueStatus, onChanged }: {
  salonId: string; experienceId: string; hasReply: boolean; issueStatus: string | null; onChanged: () => void;
}) {
  const label = useId();
  const request = useRef<string | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [posted, setPosted] = useState(hasReply);
  function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) { setError("Write a reply before posting."); return; }
    request.current ??= crypto.randomUUID();
    startTransition(async () => {
      setError("");
      try {
        const result = await replyToVisitExperienceAction({ salonId, experienceId, body, requestId: request.current! });
        if (result.error) { setError(result.error); return; }
        setPosted(true); onChanged();
      } catch { setError("Your reply could not be saved. Your draft is still here. Please try again."); }
    });
  }
  function updateStatus(status: "acknowledged" | "resolved") {
    startTransition(async () => {
      setError("");
      try {
        const result = await setVisitExperienceStatusAction({ salonId, experienceId, status });
        if (result.error) setError(result.error); else onChanged();
      } catch { setError("Issue status could not be saved. Please try again."); }
    });
  }
  return <div className="mt-4 grid gap-2 border-t border-zinc-100 pt-4">
    {!posted ? <form onSubmit={reply} className="grid gap-2">
      <label htmlFor={label} className="text-sm font-semibold"><WorkspaceText text="Reply as the salon" /></label>
      <textarea id={label} disabled={pending} className="min-h-24 w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-base" maxLength={1000} value={body} onChange={event => { setBody(event.target.value); request.current = null; }} />
      <button disabled={pending} type="submit" className="min-h-11 justify-self-start rounded-full bg-brand-teal px-5 font-semibold text-white disabled:opacity-60"><WorkspaceText text={pending ? "Replying..." : "Reply"} /></button>
    </form> : issueStatus ? <>
      <p className="text-xs leading-5 text-zinc-600"><WorkspaceText text="Salon status does not change the customer's original feedback or remove an issue from LUMI Truth." /></p>
      <button type="button" disabled={pending} onClick={() => updateStatus(issueStatus === "resolved" ? "acknowledged" : "resolved")} className="min-h-11 justify-self-start rounded-full border px-4 font-semibold disabled:opacity-60"><WorkspaceText text={pending ? "Saving..." : issueStatus === "resolved" ? "Continue handling" : "Mark handled by salon"} /></button>
    </> : null}
    <p role="status" className="text-sm text-zinc-600"><WorkspaceText text={error} /></p>
  </div>;
}
