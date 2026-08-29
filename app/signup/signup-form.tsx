"use client";

import { readAuthResponse } from "@/lib/auth-response";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const inputClassName =
  "mt-2 min-h-[52px] w-full rounded-2xl border bg-white px-4 text-base font-semibold text-text-primary outline-none transition placeholder:font-normal placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10 motion-reduce:transition-none";
const inputDefaultClassName = "border-border-subtle";
const inputErrorClassName = "border-red-300 focus:border-red-500 focus:ring-red-500/10";

function fieldClassName(hasError: boolean, extraClassName = "") {
  return [
    inputClassName,
    hasError ? inputErrorClassName : inputDefaultClassName,
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

export function SignupForm({ nextPath = "/explore" }: { nextPath?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/signup", {
        headers: {
          Accept: "application/json",
        },
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const result = await readAuthResponse(response, "Unable to create account.");

      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to create account.");
        return;
      }

      router.push(result.redirectTo ?? "/explore");
      router.refresh();
    } catch {
      setError("Unable to create account. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
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
            className={fieldClassName(Boolean(error))}
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
            aria-invalid={Boolean(error)}
            className={fieldClassName(Boolean(error))}
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
              aria-invalid={Boolean(error)}
              className={fieldClassName(Boolean(error), "pr-12")}
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
          {isSubmitting ? "Creating..." : "Create account"}
        </button>
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
