"use client";

import type { ReactNode } from "react";
import Link from "next/link";
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
  // Omitting date uses the route's existing salon-business-date default.
  const todayHref = query ? `${pathname}?${new URLSearchParams({ q: query })}` : pathname;
  return (
    <form className={styles.toolbar} data-ticket-toolbar data-owner-ticket-toolbar={title ? "true" : undefined} role="search"
      onSubmit={event => { event.preventDefault(); (event.currentTarget.elements.namedItem("q") as HTMLInputElement)?.blur(); }}>
      {title ? <h1 data-ticket-title className={styles.title}>{translate(title)}</h1> : null}
      <details className={styles.calendar} data-ticket-date>
        <summary className={styles.calendarButton} aria-label={`${translate("Date")}: ${dateLabel}`} title={dateLabel}>
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="5" width="18" height="17" rx="3" /><path d="M7 2v6m10-6v6M3 10h18" />
            <text x="12" y="18" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7" fontWeight="600">{Number(date.slice(-2))}</text>
          </svg>
        </summary>
        <div className={styles.calendarPanel}>
          <label className={styles.dateLabel}>
            <span>{translate("Date")}</span>
            <input aria-label={translate("Date")} name="date" type="date" value={date}
              onChange={event => {
                if (!event.target.value) return;
                const params = new URLSearchParams(window.location.search);
                params.set("date", event.target.value);
                if (query) params.set("q", query); else params.delete("q");
                event.currentTarget.closest("details")?.removeAttribute("open");
                router.replace(`${pathname}?${params}`, { scroll: false });
              }} />
          </label>
          <Link className={styles.today} href={todayHref} scroll={false}
            onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>
            {translate("Today")}
          </Link>
        </div>
      </details>
      <label className={styles.search}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
        <input aria-label={translate("Search customer, staff, service, ticket #")} name="q" type="search"
          enterKeyHint="search" autoComplete="off" placeholder={translate("Customer, staff, service, ticket #")}
          value={query} onChange={event => onQueryChange(event.target.value)} />
      </label>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </form>
  );
}
