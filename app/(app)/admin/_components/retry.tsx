"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export function AdminRetry() {
  const router = useRouter();
  const [pending,startTransition] = useTransition();
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())} className="ml-3 font-semibold underline">{pending ? "Retrying…" : "Retry"}</button>;
}
