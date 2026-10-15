"use client";

import { readAuthResponse } from "@/lib/auth-response";
import { SecurityChallenge, type SecurityChallengeHandle } from "@/components/security-challenge";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

const inputClassName =
  "mt-2 min-h-[52px] w-full rounded-2xl border bg-white px-4 text-base font-semibold text-text-primary outline-none transition placeholder:font-normal placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 motion-reduce:transition-none";
const inputDefaultClassName = "border-border-subtle";
function fieldClassName(extraClassName = "") {
  return [
    inputClassName,
    inputDefaultClassName,
    extraClassName,
  ]
    .filter(Boolean)
    .join(" ");
}

function PasswordVisibilityIcon({ isVisible }: { isVisible: boolean }) {
  if (isVisible) {
    return (
      <svg
        aria-hidden="true"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 4.4A10.7 10.7 0 0 1 12 4c5 0 9 5 10 8a13.4 13.4 0 0 1-2.1 3.5" />
        <path d="M6.6 6.6A13.1 13.1 0 0 0 2 12c1 3 5 8 10 8a10.8 10.8 0 0 0 4.1-.8" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function SignupForm({ nextPath = "/explore", initialError }: { nextPath?: string; initialError?: string }) {
  const router = useRouter();
  const initialChallenge = initialError?.includes("/security-check") ?? false;
  const [error, setError] = useState<string | null>(initialChallenge ? null : initialError ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [challengeRequired, setChallengeRequired] = useState(initialChallenge);
  const form = useRef<HTMLFormElement>(null);
  const securityCheck = useRef<SecurityChallengeHandle>(null);
  const submitting = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      // Activity can hide this form without discarding its state. Returning must
      // keep the entered fields while allowing an explicit fresh attempt.
      submitting.current = false;
      setIsSubmitting(false);
    };
  }, []);

  async function createAccount() {
    if (submitting.current || !form.current || !form.current.reportValidity()) return;
    // Keep credentials only in this mounted form, including after verification.
    const body = new FormData(form.current);
    const controller = new AbortController();
    request.current = controller;
    submitting.current = true;
    setError(null);
    setIsSubmitting(true);
    let navigating = false;

    try {
      const response = await fetch("/api/auth/signup", {
        headers: {
          Accept: "application/json",
        },
        method: "POST",
        body,
        signal: controller.signal,
      });
      const result = await readAuthResponse(response, "Unable to create account.");
      if (controller.signal.aborted || !mounted.current) return;

      if (!response.ok || result.error) {
        if (result.challengeRequired === true || result.code === "security_check_required" || result.error?.includes("/security-check")) {
          setChallengeRequired(true);
          return;
        }
        setError(result.error ?? "Unable to create account.");
        return;
      }

      navigating = true;
      router.push(result.redirectTo ?? "/explore");
      router.refresh();
    } catch {
      if (!controller.signal.aborted && mounted.current) setError("Unable to create account. Please check your connection and try again.");
    } finally {
      if (!controller.signal.aborted && mounted.current && !navigating) {
        submitting.current = false;
        setIsSubmitting(false);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (challengeRequired) await securityCheck.current?.verify();
    else await createAccount();
  }

  return (
    <>
      {error ? (
        <p
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          id="signup-form-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <form
        ref={form}
        data-signup-security-check={challengeRequired || undefined}
        action="/api/auth/signup"
        aria-describedby={error ? "signup-form-error" : undefined}
        className="relative z-10 mt-6 space-y-5 pointer-events-auto"
        method="post"
        onSubmit={handleSubmit}
      >
        <input name="next" type="hidden" value={nextPath} />
        <div>
          <label className="block text-sm font-extrabold text-text-primary" htmlFor="display_name">
            Display name
          </label>
          <input
            className={fieldClassName()}
            id="display_name"
            name="display_name"
            placeholder="Your name"
            type="text"
            autoComplete="name"
          />
        </div>

        <div>
          <label className="block text-sm font-extrabold text-text-primary" htmlFor="email">
            Email
          </label>
          <input
            className={fieldClassName()}
            id="email"
            name="email"
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-extrabold text-text-primary" htmlFor="password">
            Password
          </label>
          <div className="relative">
            <input
              className={fieldClassName("pr-12")}
              id="password"
              name="password"
              placeholder="Create a password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
            />
            <button
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full text-text-secondary transition hover:bg-surface-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
              onClick={() => setShowPassword((value) => !value)}
              type="button"
            >
              <PasswordVisibilityIcon isVisible={showPassword} />
            </button>
          </div>
        </div>

        {challengeRequired ? (
          <SecurityChallenge
            ref={securityCheck}
            disabled={isSubmitting}
            submitLabel="Verify and create account"
            onVerified={async () => {
              setChallengeRequired(false);
              // Exactly one retry follows an explicit successful verification.
              await createAccount();
            }}
          />
        ) : <button
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
          {isSubmitting ? "Creating..." : "Create account"}
        </button>}
        <p className="text-xs leading-5 text-text-secondary">
          By creating an account, you agree to ReyLUMI&apos;s{" "}
          <Link
            className="font-extrabold text-text-primary underline underline-offset-4 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href="/terms"
          >
            Terms of Service
          </Link>{" "}
          and acknowledge the{" "}
          <Link
            className="font-extrabold text-text-primary underline underline-offset-4 transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </>
  );
}
