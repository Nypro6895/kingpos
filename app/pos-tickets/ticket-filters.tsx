"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import styles from "./ticket-filters.module.css";

export function TicketFilters({ date, query, onQueryChange, title, actions }: {
  title?: string;
  actions?: ReactNode;
  date: string;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const translate = useWorkspaceTranslation();
  const dateLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`));
  const compactDateLabel = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`));
  return (
    <form className={title ? styles.ownerToolbar : "flex min-w-0 items-center gap-2 px-4 py-3 sm:px-0"} data-ticket-toolbar data-owner-ticket-toolbar={title ? "true" : undefined} role="search"
      onSubmit={event => { event.preventDefault(); (event.currentTarget.elements.namedItem("q") as HTMLInputElement)?.blur(); }}>
      {title ? <h1 data-ticket-title className={styles.title}>{translate(title)}</h1> : null}
      <div data-ticket-date className={title ? styles.date : "w-[44%] max-w-48"}>
        <label className={title ? styles.dateLabel : "block"}>
          {title ? <><span className={styles.fullDate}>{dateLabel}</span><span className={styles.compactDate}>{compactDateLabel}</span><span aria-hidden="true">⌄</span></> : null}
      <input aria-label={translate("Date")} name="date" type="date" value={date}
        className={title ? "absolute inset-0 h-full w-full cursor-pointer opacity-0" : "h-11 min-w-0 w-full appearance-none rounded-lg border border-zinc-300 bg-white px-2 text-base text-zinc-950"}
        onChange={event => {
          if (!event.target.value) return;
          const params = new URLSearchParams(window.location.search);
          params.set("date", event.target.value);
          if (query) params.set("q", query); else params.delete("q");
          router.replace(`${pathname}?${params}`, { scroll: false });
        }} />
        </label>
      </div>
      <input aria-label={translate("Search customer, staff, service, ticket #")} name="q" type="search"
        enterKeyHint="search" autoComplete="off" placeholder={translate("Search")}
        className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-950"
        value={query} onChange={event => onQueryChange(event.target.value)} />
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </form>
  );
}
