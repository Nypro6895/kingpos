"use client";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { WorkspaceToolbar, toolbarStyles } from "@/components/workspace-toolbar";
import { ContextualSupport } from "@/components/contextual-support";
import { CompactFilters } from "@/components/compact-filters";
import { FeedbackSearchForm, SearchSubmitButton } from "@/components/feedback-search-form";
import Link from "next/link";

export function WorkLogFilters({
  query,
  selectedDate,
  todayHref,
}: {
  query: string;
  selectedDate: string;
  todayHref: string;
}) {
  return (
    <WorkspaceToolbar title="POS Tickets">
      <WorkspaceElement as="span" className={toolbarStyles.summary} title={query || selectedDate}>{selectedDate}{query ? ` · ${query}` : ""}</WorkspaceElement>
      <div className="ml-auto flex shrink-0 items-center gap-2">
      <CompactFilters label="Work log filters" active={Boolean(query)}>
    <FeedbackSearchForm
      action="/pos-tickets"
      actionByPath={{ prefix: "/pos/ticket", action: "/pos/ticket" }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500"><WorkspaceText text="Date" /></span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={selectedDate}
          name="date"
          type="date"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500"><WorkspaceText text="Search" /></span>
        <WorkspaceElement as="input"
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={query}
          name="q"
          placeholder="Search customer, staff, service, ticket #"
          type="search"
        />
      </label>
      <SearchSubmitButton
        className="h-10 self-end rounded bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        <WorkspaceText text="Search" />
      </SearchSubmitButton>
      <Link
        className="inline-flex h-10 items-center self-end rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-950"
        href={todayHref}
      >
        <WorkspaceText text="Today" />
      </Link>
    </FeedbackSearchForm>
      </CompactFilters>
      <ContextualSupport />
      </div>
    </WorkspaceToolbar>
  );
}
