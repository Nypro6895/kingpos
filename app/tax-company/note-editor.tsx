"use client";
import { useState, useTransition } from "react";
import { saveTaxCompanyNote } from "./actions";
import type { TaxCompanyNote } from "@/types/tax-company";
import styles from "./tax-company.module.css";

export function TaxCompanyNoteEditor({ salonId, initial }: { salonId: string; initial: TaxCompanyNote }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.content);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return <aside className={styles.note} aria-label="Salon notes">
    <div className={styles.noteHead}><h2>Notes</h2>{!editing && <button className={styles.button} onClick={() => { setDraft(saved.content); setMessage(""); setEditing(true); }}>{saved.content ? "Edit" : "Add note"}</button>}</div>
    <p className={styles.muted}>For this salon · Private to your account</p>
    {editing ? <form onSubmit={event => {
      event.preventDefault();
      startTransition(async () => {
        try {
          const result = await saveTaxCompanyNote(salonId, draft, saved.version);
          if (result.error || !result.note) { setMessage(result.error ?? "Your note could not be saved."); return; }
          setSaved(result.note); setDraft(result.note.content); setEditing(false); setMessage("Saved");
        } catch { setMessage("Your note could not be saved. Please try again."); }
      });
    }} className={styles.stack}>
      <label className={styles.label}>Notes for this salon<textarea className={styles.textarea} maxLength={4000} value={draft} onChange={event => setDraft(event.target.value)} disabled={pending} placeholder="Deadlines, missing documents, follow-ups…" /></label>
      <div className={styles.actions}><button className={styles.primary} disabled={pending}>{pending ? "Saving…" : "Save"}</button><button className={styles.button} type="button" disabled={pending} onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button></div>
    </form> : <p className={saved.content ? styles.noteText : styles.muted}>{saved.content || "Keep deadlines and reminders here."}</p>}
    {message && <p className={styles.noteStatus} role="status">{message}</p>}
  </aside>;
}
