"use client";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import { WorkspaceText } from "@/components/workspace-language";
import { replyToVisitExperienceAction } from "./experience-actions";

export function VisitReplyControls({ salonId, experienceId, hasReply, onChanged }: {
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
  if (posted) return null;
  return <div className="mt-4 grid gap-2 border-t border-zinc-100 pt-4">
    {!posted ? <form onSubmit={reply} className="grid gap-2">
      <label htmlFor={label} className="text-sm font-semibold"><WorkspaceText text="Reply as the salon" /></label>
      <textarea id={label} disabled={pending} className="min-h-24 w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-base" maxLength={1000} value={body} onChange={event => { setBody(event.target.value); request.current = null; }} />
      <p className="text-xs text-zinc-600"><WorkspaceText text="You can reply once. Your reply cannot be edited." /></p>
      <button disabled={pending} type="submit" className="min-h-11 justify-self-start rounded-full bg-brand-teal px-5 font-semibold text-white disabled:opacity-60"><WorkspaceText text={pending ? "Replying..." : "Reply"} /></button>
    </form> : null}
    <p role="status" className="text-sm text-zinc-600"><WorkspaceText text={error} /></p>
  </div>;
}
