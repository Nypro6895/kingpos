"use client";

import { readAuthResponse } from "@/lib/auth-response";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/staff/invite/signup", {
        body: new FormData(event.currentTarget),
        method: "POST",
      });
      const result = await readAuthResponse(
        response,
        "Unable to create staff account.",
      );

      if (!response.ok || result.error) {
        setError(result.error ?? "Unable to create staff account.");
        return;
      }

      router.push(result.redirectTo ?? "/staff/connections");
      router.refresh();
    } catch {
      setError("Unable to create staff account. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-t border-zinc-200 pt-4" onSubmit={handleSubmit}>
      <input name="token" type="hidden" value={token} />

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm font-medium text-zinc-950">Invited email</p>
        <p className="mt-1 text-sm text-zinc-600">{maskedEmail}</p>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-zinc-700">
          Re-enter invited email
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
          Create password
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
        className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Creating account..." : "Create account and connect"}
      </button>
    </form>
  );
}
