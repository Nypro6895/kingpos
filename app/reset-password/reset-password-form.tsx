"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type RecoverySessionResult =
  | {
      accessToken: string;
      ok: true;
      refreshToken: string;
    }
  | {
      accessToken: null;
      error: string;
      ok: false;
      refreshToken: null;
    };

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

function readRecoverySessionFromHash(hash: string): RecoverySessionResult {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const providerError =
    params.get("error_description") ?? params.get("error") ?? "";
  const type = params.get("type");
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (providerError) {
    return {
      accessToken: null,
      error: providerError,
      ok: false,
      refreshToken: null,
    };
  }

  if (type !== "recovery") {
    return {
      accessToken: null,
      error: "This reset link is invalid. Please request a new password reset email.",
      ok: false,
      refreshToken: null,
    };
  }

  if (!accessToken || !refreshToken) {
    return {
      accessToken: null,
      error: "Use the password reset link from your email to choose a new password.",
      ok: false,
      refreshToken: null,
    };
  }

  return {
    accessToken,
    ok: true,
    refreshToken,
  };
}

function cleanRecoveryHashFromUrl() {
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

export function ResetPasswordForm({ nextPath = "/explore" }: { nextPath?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function initializeRecoverySession() {
      const supabase = createSupabaseBrowserClient();

      if (!supabase) {
        if (isMounted) {
          setError("Authentication is not configured. Please contact support.");
          setIsInitializing(false);
        }
        return;
      }

      const recoverySession = readRecoverySessionFromHash(window.location.hash);
      cleanRecoveryHashFromUrl();

      if (!recoverySession.ok) {
        if (isMounted) {
          setError(recoverySession.error);
          setIsInitializing(false);
        }
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: recoverySession.accessToken,
        refresh_token: recoverySession.refreshToken,
      });

      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError("This reset link is invalid or expired. Please request a new one.");
        setIsInitializing(false);
        return;
      }

      setIsReady(true);
      setIsInitializing(false);
    }

    void initializeRecoverySession();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      setError("Authentication is not configured. Please contact support.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError(updateError.message || "Unable to update password.");
        return;
      }

      await supabase.auth.signOut();
      router.replace(
        `/login?message=${encodeURIComponent(
          "Password updated. Please log in with your new password.",
        )}&next=${encodeURIComponent(nextPath)}`,
      );
      router.refresh();
    } catch {
      setError("Unable to update password. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isInitializing) {
    return (
      <p className="mt-6 rounded-2xl border border-border-subtle bg-surface-muted px-4 py-3 text-sm font-semibold text-text-secondary">
        Checking your reset link...
      </p>
    );
  }

  return (
    <>
      {error ? (
        <p
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
          id="reset-password-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {isReady ? (
        <form
          aria-describedby={error ? "reset-password-error" : undefined}
          className="relative z-10 mt-6 space-y-5"
          onSubmit={handleSubmit}
        >
          <div>
            <label
              className="block text-sm font-extrabold text-text-primary"
              htmlFor="new-password"
            >
              New password
            </label>
            <input
              aria-invalid={Boolean(error)}
              autoComplete="new-password"
              className={fieldClassName(Boolean(error))}
              id="new-password"
              minLength={8}
              name="password"
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </div>

          <div>
            <label
              className="block text-sm font-extrabold text-text-primary"
              htmlFor="confirm-password"
            >
              Confirm password
            </label>
            <input
              aria-invalid={Boolean(error)}
              autoComplete="new-password"
              className={fieldClassName(Boolean(error))}
              id="confirm-password"
              minLength={8}
              name="confirm_password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
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
            {isSubmitting ? "Updating..." : "Update password"}
          </button>
        </form>
      ) : (
        <Link
          className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-brand-orange px-5 text-sm font-extrabold text-white shadow-[0_14px_32px_rgba(242,111,61,0.24)] transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange motion-reduce:transition-none"
          href={`/forgot-password?next=${encodeURIComponent(nextPath)}`}
        >
          Request a new reset link
        </Link>
      )}
    </>
  );
}
