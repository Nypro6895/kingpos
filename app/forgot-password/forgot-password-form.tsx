"use client";

import { readAuthResponse } from "@/lib/auth-response";
import Link from "next/link";
import { useState, type FormEvent } from "react";

const inputClassName =
  "mt-2 min-h-[52px] w-full rounded-2xl border bg-white px-4 text-base font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 motion-reduce:transition-none";
const inputDefaultClassName = "border-border-subtle";
const inputErrorClassName = "border-red-300 focus:border-red-500 focus:ring-red-500/10";

function fieldClassName(hasError: boolean) {
  return [
    inputClassName,
    hasError ? inputErrorClassName : inputDefaultClassName,
  ].join(" ");
}

export function ForgotPasswordForm({ nextPath = "/explore" }: { nextPath?: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const result = await readAuthResponse(
        response,
        "Unable to send password reset instructions.",
      );

      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to send password reset instructions.");
        return;
      }

      setMessage(
        result.message ??
          "If a ReyLUMI account exists for this email, we will send password reset instructions.",
      );
    } catch {
      setError("Unable to send reset instructions. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {error ? (
        <p
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          id="forgot-password-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
          id="forgot-password-message"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <form
        aria-describedby={
          error
            ? "forgot-password-error"
            : message
              ? "forgot-password-message"
              : undefined
        }
        className="relative z-10 mt-6 space-y-5"
        onSubmit={handleSubmit}
      >
        <input name="next" type="hidden" value={nextPath} />
        <div>
          <label className="block text-sm font-extrabold text-text-primary" htmlFor="email">
            Email
          </label>
          <input
            aria-invalid={Boolean(error)}
            autoComplete="email"
            className={fieldClassName(Boolean(error))}
            id="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
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
          {isSubmitting ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <Link
        className="mt-5 inline-flex w-full justify-center text-sm font-extrabold text-brand-orange underline-offset-4 transition hover:text-brand-orange-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
        href={`/login?next=${encodeURIComponent(nextPath)}`}
      >
        Back to login
      </Link>
    </>
  );
}
