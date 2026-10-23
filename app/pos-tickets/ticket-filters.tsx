"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceTranslation } from "@/components/workspace-language";

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
  return (
    <form className="flex min-w-0 items-center gap-2 px-4 py-3 sm:px-0" data-ticket-toolbar role="search"
      onSubmit={event => { event.preventDefault(); (event.currentTarget.elements.namedItem("q") as HTMLInputElement)?.blur(); }}>
      <div className={title ? "w-32 shrink-0" : "w-[44%] max-w-48"}>
        {title ? <h1 className="text-xs font-semibold leading-5 text-zinc-950">{translate(title)}</h1> : null}
        <label className={title ? "relative flex min-h-7 items-center gap-1 text-sm text-zinc-700" : "block"}>
          {title ? <><span>{dateLabel}</span><span aria-hidden="true">⌄</span></> : null}
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
