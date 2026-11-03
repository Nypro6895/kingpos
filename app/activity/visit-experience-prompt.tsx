"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordVisitExperienceAction } from "./actions";
import { WorkspaceText } from "@/components/workspace-language";
import { useId, useRef, useState, useTransition, type FormEvent } from "react";
import styles from "./visit-feedback.module.css";
type VisitExperiencePromptProps = {
  actionLabel?: string; compact?: boolean; countsTowardReputation: boolean;
  initialBody?: string | null; initialState?: "good" | "issue" | null;
  experienceId?: string | null; salonName: string; ticketId: string; windowDays: number;
};
export function VisitExperiencePrompt({ compact = false, initialState = null,
  experienceId, ticketId }: VisitExperiencePromptProps) {
  const router = useRouter();
  const labelId = useId();
  const [body, setBody] = useState("");
  const [draftState, setDraftState] = useState<"good" | "issue" | null>(null);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState(initialState !== null);
  const [savedId, setSavedId] = useState(experienceId);
  const [isPending, startTransition] = useTransition();
  const submitting = useRef(false);
  const viewHref = savedId ? "/more/reviews?experience="+savedId : "/more/reviews";
  if (compact) return <Link className={styles.link} href={saved ? viewHref : "/activity/receipts/"+ticketId+"/experience"}><WorkspaceText text={saved ? "View experience" : "Share experience"} /></Link>;
  if (saved) return <div className={styles.list}><p role="status"><WorkspaceText text="Your experience has been shared." /></p><Link className={styles.link} href={viewHref}><WorkspaceText text="View experience" /></Link></div>;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftState || submitting.current) return;
    submitting.current = true;
    startTransition(async () => {
      setStatus("");
      try {
        const result = await recordVisitExperienceAction({ body, feedbackState: draftState, ticketId });
        if (result.error !== null) { setStatus(result.error); return; }
        setSavedId(result.experienceId); setSaved(true);
        router.replace(result.experienceId ? "/more/reviews?experience="+result.experienceId : "/more/reviews");
      } catch { setStatus("Feedback could not be saved. Your draft is still here. Please try again."); }
      finally { submitting.current = false; }
    });
  }
  return <form onSubmit={submit} className={styles.form}>
    <h2><WorkspaceText text="How was your visit?" /></h2>
    <div className={styles.choices}>
      <button type="button" disabled={isPending} aria-pressed={draftState === "good"} className={styles.choice} onClick={() => setDraftState("good")}><WorkspaceText text="Good" /></button>
      <button type="button" disabled={isPending} aria-pressed={draftState === "issue"} data-issue className={styles.choice} onClick={() => setDraftState("issue")}><WorkspaceText text="Had an issue" /></button>
    </div>
    <label className={styles.details} htmlFor={labelId}><WorkspaceText text="Details (optional)" />
      <textarea id={labelId} maxLength={1000} disabled={isPending} onChange={event => setBody(event.currentTarget.value)} value={body} />
    </label>
    <div className={styles.muted}><p><WorkspaceText text="Shared with the salon and may appear publicly." /></p><p><WorkspaceText text="Once shared, your feedback cannot be edited." /></p></div>
    <button type="submit" disabled={isPending || !draftState} className={styles.submit}><WorkspaceText text={isPending ? "Sharing…" : "Share experience"} /></button>
    {status ? <p role="alert" className={styles.error}><WorkspaceText text={status} /></p> : null}
  </form>;
}
