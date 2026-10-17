"use client";

import { usePathname, useRouter } from "next/navigation";
import { useWorkspaceTranslation } from "@/components/workspace-language";

export function TicketFilters({ date, query, onQueryChange }: {
  date: string;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const translate = useWorkspaceTranslation();
  return (
    <form className="flex min-w-0 gap-2 px-4 py-3 sm:px-0" role="search"
      onSubmit={event => { event.preventDefault(); (event.currentTarget.elements.namedItem("q") as HTMLInputElement)?.blur(); }}>
      <input aria-label={translate("Date")} name="date" type="date" value={date}
        className="h-11 min-w-0 w-[44%] max-w-48 appearance-none rounded-lg border border-zinc-300 bg-white px-2 text-base text-zinc-950"
        onChange={event => {
          if (!event.target.value) return;
          const params = new URLSearchParams(window.location.search);
          params.set("date", event.target.value);
          if (query) params.set("q", query); else params.delete("q");
          router.replace(`${pathname}?${params}`, { scroll: false });
        }} />
      <input aria-label={translate("Search customer, staff, service, ticket #")} name="q" type="search"
        enterKeyHint="search" autoComplete="off" placeholder={translate("Search")}
        className="h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-950"
        value={query} onChange={event => onQueryChange(event.target.value)} />
    </form>
  );
}
