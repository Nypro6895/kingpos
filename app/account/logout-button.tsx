"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AuthResponse = {
  redirectTo?: string;
};

export function LogoutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    setIsSubmitting(true);
    const response = await fetch("/api/auth/logout", {
      method: "POST",
    });
    const result = (await response.json()) as AuthResponse;

    router.push(result.redirectTo ?? "/login");
    router.refresh();
  }

  return (
    <button
      className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSubmitting}
      onClick={handleLogout}
      type="button"
    >
      {isSubmitting ? "Logging out..." : "Logout"}
    </button>
  );
}
