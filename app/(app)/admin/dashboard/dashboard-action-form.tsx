"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import type { AdminActionResult } from "../_components/action-form";

export function DashboardActionForm({ action, children, confirmMessage, onComplete, className = "dashboard-form", resetOnSuccess = false }: {
  action: (form: FormData) => Promise<AdminActionResult>; children: ReactNode;
  confirmMessage?: string; onComplete: (result: AdminActionResult) => void; className?: string; resetOnSuccess?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [confirmation, setConfirmation] = useState<FormData | null>(null);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  function submit(form: FormData) {
    setConfirmation(null); setNotice(null);
    startTransition(async () => {
      let result: AdminActionResult;
      try { result = await action(form); }
      catch { result = { ok: false, message: "The result could not be confirmed. Refresh before retrying." }; }
      setNotice(result);
      if (result.ok && resetOnSuccess) ref.current?.reset();
      onComplete(result);
    });
  }
  return <form ref={ref} className={className} onSubmit={event => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const button = (event.nativeEvent as SubmitEvent).submitter;
    if (button instanceof HTMLButtonElement && button.name) data.set(button.name, button.value);
    if (confirmMessage) setConfirmation(data); else submit(data);
  }}>
    <fieldset disabled={pending || Boolean(confirmation)}>{children}</fieldset>
    {confirmation && <div className="dashboard-confirm" role="group" aria-label="Confirm action"><p>{confirmMessage}</p><div className="dashboard-button-row"><button type="button" className="dashboard-button dashboard-button-primary" autoFocus onClick={() => submit(confirmation)}>Confirm action</button><button type="button" className="dashboard-button" onClick={() => setConfirmation(null)}>Cancel</button></div></div>}
    {pending && <p role="status" className="dashboard-muted">Saving changes…</p>}
    {notice && <p role={notice.ok ? "status" : "alert"} className={`dashboard-notice ${notice.ok ? "is-success" : "is-error"}`}>{notice.message}</p>}
  </form>;
}
