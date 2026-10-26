"use client";

import { useActionState, useId, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { MarketRegistryActionResult } from "@/types/market-registry";
import styles from "./registry.module.css";

export type RegistryAction = (previous: MarketRegistryActionResult, form: FormData) => Promise<MarketRegistryActionResult>;
const EMPTY_RESULT: MarketRegistryActionResult = { ok: false, message: "" };

export function RegistryActionForm({ action, label, children, onSuccess, onChange }: {
  action: RegistryAction;
  label: string;
  children: ReactNode;
  onSuccess?: () => void;
  onChange?: () => void;
}) {
  const router = useRouter();
  const statusId = useId();
  const [result, formAction, pending] = useActionState(async (previous: MarketRegistryActionResult, form: FormData) => {
    try {
      const next = await action(previous, form);
      if (next.ok) {
        onSuccess?.();
        router.refresh();
      }
      return next;
    } catch {
      return { ok: false, message: "The request could not be completed. Your changes are still here. Try again or reload the latest details." };
    }
  }, EMPTY_RESULT);

  return <form action={formAction} aria-label={label} aria-describedby={statusId} className={styles.form} onChange={onChange}>
    <fieldset disabled={pending}>{children}</fieldset>
    <div id={statusId} aria-live="polite" aria-atomic="true">
      {pending ? <p className={styles.muted} role="status">Saving your request…</p> : result.message ?
        <p className={result.ok ? styles.status : styles.error} role={result.ok ? "status" : "alert"}>{result.message}</p> : null}
    </div>
  </form>;
}
