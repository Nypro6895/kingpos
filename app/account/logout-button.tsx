"use client";

import { readAuthResponse } from "@/lib/auth-response";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

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
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });
      const result = await readAuthResponse(response, "Unable to log out.");

      router.push(response.ok && result.redirectTo ? result.redirectTo : "/login");
      router.refresh();
    } catch {
      setIsSubmitting(false);
    }
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
