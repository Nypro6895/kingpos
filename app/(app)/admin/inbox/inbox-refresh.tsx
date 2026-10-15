"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export function InboxRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") startTransition(() => router.refresh()); }, 30000);
    return () => clearInterval(timer);
  }, [router]);
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium">{pending ? "Refreshing…" : "Refresh inbox"}</button>;
}
