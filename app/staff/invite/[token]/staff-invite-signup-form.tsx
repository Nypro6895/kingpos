"use client";

import { WorkspaceText } from "@/components/workspace-language";
import { ActionFeedback } from "@/components/action-feedback";
import { readAuthResponse } from "@/lib/auth-response";
import { AUTH_OFFLINE_MESSAGE } from "@/lib/supabase/auth-errors";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

const inputClassName =
  "mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950";

export function StaffInviteSignupForm({
  maskedEmail,
  token,
}: {
  maskedEmail: string;
  token: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const submitting = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      request.current = null;
      submitting.current = false;
      setIsSubmitting(false);
      setIsNavigating(false);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !mounted.current) return;
    if (!navigator.onLine) {
      setError(AUTH_OFFLINE_MESSAGE);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    submitting.current = true;
    setError(null);
    setIsSubmitting(true);
    setIsNavigating(false);
    let navigating = false;

    try {
      const response = await fetch("/api/staff/invite/signup", {
        body: new FormData(event.currentTarget),
        method: "POST",
        signal: controller.signal,
      });
      const result = await readAuthResponse(
        response,
        "Unable to create staff account.",
      );
      if (controller.signal.aborted || !mounted.current || request.current !== controller) return;

      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to create staff account.");
        return;
      }

      navigating = true;
      setIsNavigating(true);
      router.push(result.redirectTo ?? "/staff/connections");
      router.refresh();
    } catch {
      navigating = false;
      if (!controller.signal.aborted && mounted.current && request.current === controller) setError("Unable to create staff account. Please try again.");
    } finally {
      if (!controller.signal.aborted && mounted.current && request.current === controller && !navigating) {
        request.current = null;
        submitting.current = false;
        setIsSubmitting(false);
        setIsNavigating(false);
      }
    }
  }

  return (
    <form className="grid gap-4 border-t border-zinc-200 pt-4" onSubmit={handleSubmit} aria-busy={isSubmitting}>
      <input name="token" type="hidden" value={token} />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <WorkspaceText text={error} />
        </p>
      ) : null}

      <div className="border-y border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm font-medium text-zinc-950"><WorkspaceText text="Invited email" /></p>
        <p className="mt-1 text-sm text-zinc-600">{maskedEmail}</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          <WorkspaceText text="Re-enter invited email" />
        </span>
        <input
          autoComplete="email"
          className={inputClassName}
          name="email"
          required
          type="email"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          <WorkspaceText text="Create password" />
        </span>
        <input
          autoComplete="new-password"
          className={inputClassName}
          minLength={6}
          name="password"
          required
          type="password"
        />
      </label>

      <button
        aria-busy={isSubmitting}
        className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        <ActionFeedback pending={isSubmitting} pendingLabel={isNavigating ? "Opening your account..." : "Creating account..."}><WorkspaceText text="Create account and connect" /></ActionFeedback>
      </button>
    </form>
  );
}
