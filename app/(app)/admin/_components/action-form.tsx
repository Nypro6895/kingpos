"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type AdminActionResult = { ok: boolean; message: string; href?: string; rotateRequest?: boolean };

export function AdminActionForm({ action, children, className, confirmMessage, successMessage = "Changes saved.", resetOnSuccess = false }: {
  action: (form: FormData) => Promise<AdminActionResult | void>;
  children: ReactNode; className?: string; confirmMessage?: string; successMessage?: string; resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState<AdminActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return <form ref={formRef} className={className} onSubmit={event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) form.set(submitter.name,submitter.value);
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await action(form);
        const outcome = result ?? { ok: true, message: successMessage };
        setNotice(outcome);
        if (outcome.ok) {
          if (resetOnSuccess) formRef.current?.reset();
          if (outcome.href) router.push(outcome.href);
          router.refresh();
        }
      } catch {
        setNotice({ ok: false, message: "This action could not be completed. Retry or contact a platform owner." });
      }
    });
  }}>
    <fieldset disabled={pending} className="contents">{children}</fieldset>
    {pending && <p role="status" className="col-span-full text-sm text-zinc-500">Saving…</p>}
    {notice && <p role={notice.ok ? "status" : "alert"} className={`col-span-full rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>{notice.message}</p>}
  </form>;
}
