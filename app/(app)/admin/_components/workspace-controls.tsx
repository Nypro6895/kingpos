"use client";
import { FeedbackSearchForm } from "@/components/feedback-search-form";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AdminIcon } from "./admin-icon";
export function AdminRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button type="button" className="dashboard-button" disabled={pending} onClick={() => startTransition(() => router.refresh())}><AdminIcon name="refresh" />{pending ? "Refreshing…" : "Refresh"}</button>;
}
export function AdminResetFilters() {
  const pathname = usePathname();
  return <Link className="dashboard-button" href={pathname}>Reset filters</Link>;
}

export function AdminSearchContainer({ children }: { children: ReactNode }) {
  const search = useSearchParams();
  return <FeedbackSearchForm key={search.toString()} action="" className="admin-search-form mt-5 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">{children}</FeedbackSearchForm>;
}
