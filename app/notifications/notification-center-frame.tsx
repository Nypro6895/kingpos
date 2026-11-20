"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { WorkspaceText } from "@/components/workspace-language";

export function NotificationCenterFrame({ filter, onFilterChange, onMarkViewed, marking = false, markDisabled = true, language, actions, children }: {
  filter: "all" | "unread";
  onFilterChange?: (filter: "all" | "unread") => void;
  onMarkViewed?: () => void;
  marking?: boolean;
  markDisabled?: boolean;
  language?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <main className="mx-auto max-w-3xl space-y-4 px-3 py-4">
    <section className="content-surface overflow-hidden border-zinc-200 bg-white rounded-none border-y shadow-none">
      <header className="flex items-center gap-2 border-b border-zinc-100 p-4">
        <h1 className="flex-1 text-xl font-bold"><WorkspaceText text="Notifications" /></h1>
        <button type="button" disabled={markDisabled || marking || !onMarkViewed} className="min-h-9 text-xs font-semibold text-brand-orange" onClick={onMarkViewed}><WorkspaceText text="Mark all viewed" /></button>
        <Link prefetch={false} className="text-sm font-semibold text-blue-700" href="/settings?section=notifications"><WorkspaceText text="Settings" /></Link>
      </header>
      {language}
      {actions}
      <div className="flex gap-2 p-3">
        {(["all", "unread"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} disabled={!onFilterChange}
          className={`min-h-9 rounded-full px-4 text-sm font-semibold ${filter === value ? "bg-blue-50 text-blue-700" : "text-zinc-600 hover:bg-zinc-100"}`}
          onClick={() => onFilterChange?.(value)}><WorkspaceText text={value === "all" ? "All" : "Unread"} /></button>)}
      </div>
      {children}
      <p className="border-t border-zinc-100 p-3 text-xs text-zinc-500"><WorkspaceText text="Updates are marked viewed when they are visible. Items that need action remain until resolved." /></p>
    </section>
  </main>;
}

/** Neutral frame only: mounting this never reads, seeds an empty feed or marks viewed. */
export function NotificationCenterLoading({ initialFilter = "all", error, onRetry }: { initialFilter?: "all" | "unread"; error?: string; onRetry?: () => void }) {
  return <NotificationCenterFrame filter={initialFilter}>
    {error ? <div role="alert" className="m-3 rounded-md bg-red-50 p-3 text-sm text-red-700"><WorkspaceText text={error} />{onRetry && <button type="button" className="ml-2 font-semibold underline" onClick={onRetry}><WorkspaceText text="Retry" /></button>}</div>
      : <p role="status" className="p-4 text-sm text-zinc-500"><WorkspaceText text="Loading notifications…" /></p>}
  </NotificationCenterFrame>;
}
