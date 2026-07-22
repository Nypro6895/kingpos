"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type AuthResponse = {
  redirectTo?: string;
};

type LogoutButtonProps = {
  children?: ReactNode;
  className?: string;
};

const DEFAULT_LOGOUT_CLASS =
  "rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950 pointer-events-auto disabled:cursor-not-allowed disabled:opacity-60";

export function LogoutButton({ children, className }: LogoutButtonProps = {}) {
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
      className={className ?? DEFAULT_LOGOUT_CLASS}
      disabled={isSubmitting}
      onClick={handleLogout}
      type="button"
    >
      {isSubmitting ? "Logging out..." : (children ?? "Log out")}
    </button>
  );
}
