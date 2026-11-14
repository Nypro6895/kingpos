"use client";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { ExperienceReplyComposer } from "@/components/experience-reply-composer";
import { replyToVisitExperienceAction } from "./experience-actions";

export function VisitReplyControls({ salonId, experienceId, hasReply, onChanged }: {
  salonId: string; experienceId: string; hasReply: boolean; issueStatus: string | null; onChanged: () => void;
}) {
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
  return <ExperienceReplyComposer body={body} onBodyChange={value => { setBody(value); request.current = null; }} pending={pending} status={error} onSubmit={reply} />;
}
