"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reportSocialText } from "@/app/post-moderation/text-report-actions";
import { useCloseOnNavigation, useNativeDialogNavigation, useOverlayPortalHost } from "@/components/overlay-dismissal";
import { WorkspaceText } from "@/components/workspace-language";
import type { SocialTextReportTarget } from "@/types/social-text-reports";

export function SocialTextReportButton({ target }: { target: SocialTextReportTarget }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [supportHref, setSupportHref] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null);
  const requestId = useRef<string | null>(null), submitting = useRef(false);
  const host = useOverlayPortalHost();
  useNativeDialogNavigation(dialog);
  useCloseOnNavigation(() => setOpen(false));
  useEffect(() => {
    if (!open || !host) return;
    const element = dialog.current;
    const button = opener.current;
    element?.showModal();
    return () => { element?.close(); button?.focus(); };
  }, [open, host]);
  return <>
    <button ref={opener} type="button" className="min-h-11 px-2 text-xs underline" onClick={() => setOpen(true)}><WorkspaceText text="Report" /></button>
    {open && host ? createPortal(<dialog ref={dialog} aria-label="Report content" className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-auto rounded-2xl border p-5 backdrop:bg-black/40" onCancel={event => { event.preventDefault(); if (!busy) setOpen(false); }}>
      <form className="grid gap-3" onSubmit={async event => {
        event.preventDefault(); if (submitting.current) return;
        submitting.current = true; setBusy(true); setError(""); requestId.current ??= crypto.randomUUID();
        try {
          const result = await reportSocialText({target, requestId: requestId.current, reason});
          if (result.error !== null) setError(result.error); else setSupportHref(result.supportHref);
        } catch { setError("Your report could not be sent. Please retry."); }
        finally { submitting.current = false; setBusy(false); }
      }}>
        <h2 className="font-semibold"><WorkspaceText text="Report content" /></h2>
        {supportHref ? <><p role="status"><WorkspaceText text="Thank you. Your report has been received." /></p><Link href={supportHref} className="underline"><WorkspaceText text="View report & conversation" /></Link></> : <><label className="grid gap-2"><WorkspaceText text="Reason" /><textarea required minLength={3} maxLength={1000} disabled={busy} value={reason} onChange={event => setReason(event.target.value)} className="rounded-xl border p-3" /></label>{error ? <p role="alert"><WorkspaceText text={error} /></p> : null}<button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-zinc-950 px-4 text-white"><WorkspaceText text={busy ? "Please wait." : "Send report"} /></button></>}
        <button type="button" disabled={busy} className="min-h-11" onClick={() => setOpen(false)}><WorkspaceText text="Close" /></button>
      </form>
    </dialog>, host) : null}
  </>;
}
