"use client";

import {
  redeemRecoveryCodeAction,
  type AccountRecoveryCodeActionResult,
} from "@/app/account-recovery/actions";
import Link from "next/link";
import { useState, type FormEvent } from "react";

const inputClassName =
  "mt-2 min-h-[52px] w-full rounded-2xl border bg-white px-4 text-base font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 motion-reduce:transition-none";
const textareaClassName =
  "mt-2 min-h-28 w-full rounded-2xl border bg-white px-4 py-3 text-base font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 motion-reduce:transition-none";
const inputDefaultClassName = "border-border-subtle";
const inputErrorClassName = "border-red-300 focus:border-red-500 focus:ring-red-500/10";

function fieldClassName(hasError: boolean, baseClassName = inputClassName) {
  return [
    baseClassName,
    hasError ? inputErrorClassName : inputDefaultClassName,
  ].join(" ");
}

export function AccountRecoveryForm({
  nextPath = "/explore",
}: {
  nextPath?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const result: AccountRecoveryCodeActionResult =
        await redeemRecoveryCodeAction(new FormData(event.currentTarget));

      if (result.error) {
        setError(result.error);
        return;
      }

      setMessage(result.message ?? "Recovery request submitted.");
      event.currentTarget.reset();
    } catch {
      setError("Recovery request could not be submitted. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {error ? (
        <p
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          id="account-recovery-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
          id="account-recovery-message"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <form
        aria-describedby={
          error
            ? "account-recovery-error"
            : message
              ? "account-recovery-message"
              : undefined
        }
        className="relative z-10 mt-6 space-y-5"
        onSubmit={handleSubmit}
      >
        <div>
          <label
            className="block text-sm font-extrabold text-text-primary"
            htmlFor="account_identifier"
          >
            Account email or profile phone
          </label>
          <input
            aria-invalid={Boolean(error)}
            autoComplete="username"
            className={fieldClassName(Boolean(error))}
            id="account_identifier"
            name="account_identifier"
            required
            type="text"
          />
        </div>

        <div>
          <label
            className="block text-sm font-extrabold text-text-primary"
            htmlFor="recovery_code"
          >
            Recovery code
          </label>
          <input
            aria-invalid={Boolean(error)}
            autoComplete="one-time-code"
            className={fieldClassName(Boolean(error))}
            id="recovery_code"
            name="recovery_code"
            placeholder="RL-XXXXXXXX-XXXXXXXX"
            required
            type="text"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              className="block text-sm font-extrabold text-text-primary"
              htmlFor="contact_email"
            >
              Safe contact email
            </label>
            <input
              autoComplete="email"
              className={fieldClassName(Boolean(error))}
              id="contact_email"
              name="contact_email"
              type="email"
            />
          </div>

          <div>
            <label
              className="block text-sm font-extrabold text-text-primary"
              htmlFor="contact_phone"
            >
              Safe contact phone
            </label>
            <input
              autoComplete="tel"
              className={fieldClassName(Boolean(error))}
              id="contact_phone"
              name="contact_phone"
              type="tel"
            />
          </div>
        </div>

        <div>
          <label
            className="block text-sm font-extrabold text-text-primary"
            htmlFor="details"
          >
            What happened?
          </label>
          <textarea
            className={fieldClassName(Boolean(error), textareaClassName)}
            id="details"
            name="details"
            placeholder="Lost phone, email unavailable, account may be taken over..."
          />
        </div>

        <button
          aria-busy={isSubmitting}
          className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-orange px-5 text-sm font-extrabold text-white shadow-[0_14px_32px_rgba(242,111,61,0.24)] transition hover:bg-brand-orange-hover active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-wait disabled:opacity-70 motion-reduce:transform-none motion-reduce:transition-none"
          disabled={isSubmitting}
          type="submit"
        >
          <span
            aria-hidden={!isSubmitting}
            className={[
              "h-4 w-4 rounded-full border-2 border-white/40 border-t-white",
              isSubmitting ? "animate-spin motion-reduce:animate-none" : "hidden",
            ].join(" ")}
          />
          {isSubmitting ? "Submitting..." : "Submit recovery case"}
        </button>
      </form>

      <div className="mt-5 grid gap-3 text-center text-sm font-extrabold sm:grid-cols-2">
        <Link
          className="text-brand-orange underline-offset-4 transition hover:text-brand-orange-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
          href={`/login?next=${encodeURIComponent(nextPath)}`}
        >
          Back to login
        </Link>
        <Link
          className="text-text-secondary underline-offset-4 transition hover:text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
          href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}
        >
          Forgot password?
        </Link>
      </div>
    </>
  );
}
