"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { reportSalonAction } from "@/app/salon-profile/report-actions";
import { useCloseOnNavigation, useOverlayPortalHost } from "@/components/overlay-dismissal";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { SALON_REPORT_REASONS, type SalonReportTarget } from "@/lib/salon-report";

export function SalonReportDialog({ salon, onClose, returnFocusRef }: { salon: SalonReportTarget; onClose: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const translate = useWorkspaceTranslation();
  const host = useOverlayPortalHost();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [supportHref, setSupportHref] = useState<string | null>(null);
  useCloseOnNavigation(onClose);

  useEffect(() => {
    if (!host) return;
    const previous = document.activeElement as HTMLElement | null;
    const opener = returnFocusRef?.current ?? previous?.closest("details")?.querySelector("summary") ?? previous;
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; opener?.focus(); };
  }, [host, returnFocusRef]);

  async function submit() {
    if (!reason || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      const result = await reportSalonAction({ requestId: requestId.current, salonId: salon.id, reason, details });
      if (!result.ok) setError(result.error);
      else { setSupportHref(result.supportHref); setSubmitted(true); }
    } catch {
      setError("Your report could not be sent. Please try again.");
    } finally { submitting.current = false; setBusy(false); }
  }

  if (!host) return null;
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} aria-modal="true"
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-950 shadow-xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="grid gap-4 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 id={titleId} className="text-lg font-semibold"><WorkspaceText text="Report salon" /></h2><p className="break-words text-sm text-zinc-600">{salon.name}</p></div>
        <button type="button" disabled={busy} aria-label={translate("Close report")} className="grid size-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-xl" onClick={onClose}>×</button>
      </header>
      {submitted ? <>
        <p role="status"><WorkspaceText text="Thank you. Your report has been received." /></p>
        {supportHref ? <Link className="text-sm underline" href={supportHref}><WorkspaceText text="View report & conversation" /></Link> : null}
        <button type="button" className="min-h-11 rounded-xl bg-zinc-950 px-4 py-2 font-semibold text-white" onClick={onClose}><WorkspaceText text="Done" /></button>
      </> : <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={busy} className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold"><WorkspaceText text="Why are you reporting this salon?" /></legend>
          {SALON_REPORT_REASONS.map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm has-checked:border-zinc-950 has-checked:bg-zinc-50">
            <input required type="radio" name="salon-report-reason" value={value} checked={reason === value} onChange={() => { setReason(value); setError(""); }} /><WorkspaceText text={label} />
          </label>)}
        </fieldset>
        <label className="grid gap-2 text-sm"><WorkspaceText text="Additional details (optional)" /><textarea disabled={busy} value={details} onChange={event => setDetails(event.target.value)} maxLength={2000} rows={3} className="w-full resize-y rounded-xl border border-zinc-300 p-3" /></label>
        {error ? <p role="alert" className="text-sm text-red-700"><WorkspaceText text={error} /></p> : null}
        <button type="submit" disabled={busy || !reason} className="min-h-11 rounded-xl bg-zinc-950 px-4 py-2 font-semibold text-white disabled:opacity-50"><WorkspaceText text={busy ? "Sending…" : "Send report"} /></button>
      </form>}
    </div>
  </dialog>, host);
}
