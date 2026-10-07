"use client";

import { readAuthResponse, type AuthResponse } from "@/lib/auth-response";
import { PortableTouchKeyboard } from "@/app/pos/portable/touch-keyboard";
import { AUTH_OFFLINE_MESSAGE, SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE } from "@/lib/supabase/auth-errors";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

function maskPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");

  if (digits.length < 4) {
    return "your profile phone";
  }

  return `*** *** ${digits.slice(-4)}`;
}

export function LoginForm({
  nextPath = "/explore",
  showRecoveryHelpInitially = false,
  onAuthenticated,
}: {
  nextPath?: string;
  showRecoveryHelpInitially?: boolean;
  onAuthenticated?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(
    showRecoveryHelpInitially,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<AuthResponse["mfa"] | null>(
    null,
  );
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError(AUTH_OFFLINE_MESSAGE);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    setMfaChallenge(null);

    try {
      const response = await fetch("/api/auth/login", {
        headers: {
          Accept: "application/json",
        },
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const result = await readAuthResponse(response, "Unable to log in.");

      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to log in.");
        setShowRecoveryHelp(true);
        return;
      }

      if (result.mfa) {
        setShowRecoveryHelp(false);
        setMfaChallenge(result.mfa);
        return;
      }

      if (onAuthenticated) {
        onAuthenticated();
        router.refresh();
        return;
      }
      router.push(result.redirectTo ?? "/explore");
      router.refresh();
    } catch {
      setError(navigator.onLine ? SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE : AUTH_OFFLINE_MESSAGE);
      setShowRecoveryHelp(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!navigator.onLine) {
      setError(AUTH_OFFLINE_MESSAGE);
      return;
    }

    if (!mfaChallenge) {
      setError("Two-factor verification expired. Log in again.");
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData(event.currentTarget);
      formData.set("factor_id", mfaChallenge.factorId);
      formData.set("challenge_id", mfaChallenge.challengeId);
      formData.set("next", nextPath);

      const response = await fetch("/api/auth/mfa/verify", {
        headers: {
          Accept: "application/json",
        },
        method: "POST",
        body: formData,
      });
      const result = await readAuthResponse(
        response,
        "Unable to verify two-factor code.",
      );

      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to verify two-factor code.");
        setShowRecoveryHelp(true);
        return;
      }

      if (onAuthenticated) {
        onAuthenticated();
        router.refresh();
        return;
      }
      router.push(result.redirectTo ?? "/explore");
      router.refresh();
    } catch {
      setError(navigator.onLine ? SUPABASE_AUTH_CONNECTION_ERROR_MESSAGE : AUTH_OFFLINE_MESSAGE);
      setShowRecoveryHelp(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div data-login-touch-shell>
      <PortableTouchKeyboard enabled desktopOnly scopeSelector="[data-login-touch-shell]" />
      {error ? (
        <p
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          id="login-form-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {mfaChallenge ? (
        <form
          key="mfa"
          aria-describedby={error ? "login-form-error" : undefined}
          className="relative z-10 mt-6 space-y-5"
          onSubmit={handleMfaSubmit}
        >
          <div>
            <p className="text-xs font-extrabold uppercase text-brand-orange">
              Two-factor verification
            </p>
            <h3 className="mt-2 text-xl font-semibold tracking-normal text-text-primary">
              Enter your security code
            </h3>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {mfaChallenge.factorType === "phone"
                ? `We sent an SMS code to ${maskPhone(mfaChallenge.phone)}.`
                : "Use the 6-digit code from your authenticator app."}
            </p>
          </div>

          <div>
            <label className="block text-sm font-extrabold text-text-primary" htmlFor="mfa_code">
              Security code
            </label>
            <input
              aria-invalid={Boolean(error)}
              autoComplete="one-time-code"
              className={fieldClassName(Boolean(error))}
              id="mfa_code"
              inputMode="numeric"
              maxLength={8}
              name="code"
              required
              type="text"
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
            {isSubmitting ? "Verifying..." : "Verify and log in"}
          </button>

          <button
            className="inline-flex w-full justify-center text-sm font-extrabold text-text-secondary underline-offset-4 transition hover:text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
            onClick={() => {
              setError(null);
              setMfaChallenge(null);
              setShowRecoveryHelp(false);
            }}
            type="button"
          >
            Use a different account
          </button>
        </form>
      ) : (
        <form
        key="login"
        action="/api/auth/login"
        aria-describedby={error ? "login-form-error" : undefined}
        className="relative z-10 mt-6 space-y-5"
        method="post"
        onSubmit={handleSubmit}
      >
        <input name="next" type="hidden" value={nextPath} />
        <div>
          <label className="block text-sm font-extrabold text-text-primary" htmlFor="email">
            Email
          </label>
          <input
            aria-invalid={Boolean(error)}
            className={fieldClassName(Boolean(error))}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <label className="block text-sm font-extrabold text-text-primary" htmlFor="password">
              Password
            </label>
            <Link
              className="text-sm font-extrabold text-brand-orange underline-offset-4 transition hover:text-brand-orange-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
              href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              aria-invalid={Boolean(error)}
              className={[fieldClassName(Boolean(error)), "pr-12"].join(" ")}
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
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

        <label className="flex min-h-8 items-center gap-3 text-sm font-bold text-text-secondary">
          <input
            className="size-4 shrink-0 accent-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            name="remember_me"
            type="checkbox"
          />
          <span>Remember me</span>
        </label>

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
          {isSubmitting ? "Logging in..." : "Log in"}
        </button>
        </form>
      )}

      {showRecoveryHelp ? (
        <Link
          className="mt-5 inline-flex w-full justify-center text-sm font-extrabold text-text-secondary underline-offset-4 transition hover:text-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
          href={`/account-recovery?next=${encodeURIComponent(nextPath)}`}
        >
          Lost access or recovery code?
        </Link>
      ) : null}
    </div>
  );
}
