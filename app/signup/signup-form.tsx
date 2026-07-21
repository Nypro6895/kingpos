"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AuthResponse = {
  error?: string;
  redirectTo?: string;
};

const inputClassName =
  "mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 pointer-events-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950";

export function SignupForm({ nextPath = "/account" }: { nextPath?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    const result = (await response.json()) as AuthResponse;

    setIsSubmitting(false);

    if (!response.ok || result.error) {
      setError(result.error ?? "Unable to create account.");
      return;
    }

    router.push(result.redirectTo ?? "/account");
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <form className="relative z-10 mt-6 space-y-4 pointer-events-auto" onSubmit={handleSubmit}>
        <input name="next" type="hidden" value={nextPath} />
        <div>
          <label className="block text-sm font-medium text-zinc-700" htmlFor="display_name">
            Display name
          </label>
          <input
            className={inputClassName}
            id="display_name"
            name="display_name"
            type="text"
            autoComplete="name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700" htmlFor="email">
            Email
          </label>
          <input
            className={inputClassName}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700" htmlFor="password">
            Password
          </label>
          <input
            className={inputClassName}
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>

        <button
          className="w-full rounded-md bg-zinc-950 px-4 py-2 font-medium text-white pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "Creating..." : "Create account"}
        </button>
      </form>
    </>
  );
}
