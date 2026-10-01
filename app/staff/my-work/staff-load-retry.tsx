"use client";
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
export function StaffLoadRetry({ automatic = true }: { automatic?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!automatic) return;
    const retry = () => {
      if (!pending && navigator.onLine && document.visibilityState === "visible") startTransition(() => router.refresh());
    };
    const timer = setInterval(retry, 30000);
    window.addEventListener("online", retry); window.addEventListener("focus", retry);
    return () => { clearInterval(timer); window.removeEventListener("online", retry); window.removeEventListener("focus", retry); };
  }, [automatic, pending, router]);
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="mt-3 min-h-11 rounded-lg border border-zinc-200 px-4 text-sm disabled:opacity-50">{pending ? "Updating…" : "Try again"}</button>;
}
