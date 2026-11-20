"use client";
import { createContext, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./experience-reply-composer.module.css";

const ReplyContext = createContext<{ active: string | null; select: (id: string | null) => void } | null>(null);
export function ExperienceReplyGroup({ children }: { children: ReactNode }) {
  const [active, select] = useState<string | null>(null);
  return <ReplyContext.Provider value={{ active, select }}>{children}</ReplyContext.Provider>;
}

export function ExperienceReplyComposer({ body, onBodyChange, pending, status, onSubmit }: {
  body: string; onBodyChange: (body: string) => void; pending: boolean; status: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const translate = useWorkspaceTranslation();
  const id = useId();
  const group = useContext(ReplyContext);
  const [localOpen, setLocalOpen] = useState(false);
  const open = group ? group.active === id : localOpen;
  const opener = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (open) input.current?.focus({ preventScroll: true }); }, [open]);
  function select(value: boolean) { if (group) group.select(value ? id : null); else setLocalOpen(value); }
  return <div className={styles.reply}>
    {!open ? <button ref={opener} type="button" className={styles.textReply} aria-expanded={false} aria-controls={id} onClick={() => select(true)}><WorkspaceText text="Reply" /></button> : null}
    <form id={id} hidden={!open} className={styles.composer} onSubmit={onSubmit}>
      <label htmlFor={`${id}-body`} className={styles.label}><WorkspaceText text="Reply as the salon" /></label>
      <textarea ref={input} id={`${id}-body`} placeholder={translate("Write your reply…")} disabled={pending} maxLength={1000} value={body} onChange={event => onBodyChange(event.target.value)} />
      <p className={styles.hint}><WorkspaceText text="You can reply once. Your reply cannot be edited." /></p>
      {status ? <p role="status" className={styles.hint}><WorkspaceText text={status} /></p> : null}
      <div className={styles.actions}>
        <button type="button" disabled={pending} className={styles.outline} onClick={() => { select(false); requestAnimationFrame(() => opener.current?.focus()); }}><WorkspaceText text="Cancel" /></button>
        <button type="submit" disabled={pending || !body.trim()} className={styles.send}><WorkspaceText text={pending ? "Replying..." : "Send reply"} /></button>
      </div>
    </form>
  </div>;
}
