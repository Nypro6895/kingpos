"use client";

// The original page JSX/helpers are preserved here; only its server loader is replaced by authorized DTO props.
import type { AppLocalOwnerCustomersData } from "./app-local-owner-page-types";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { WorkspaceToolbar, toolbarStyles } from "@/components/workspace-toolbar";

import Form from "next/form";
import { SubmitButton } from "@/components/submit-button";
import {
  type CustomerListItem,
  type CustomerListPagination,
} from "@/lib/customers";
import { mergeDuplicateCustomers } from "@/app/customers/actions";
import Link from "next/link";
import type { ReactNode } from "react";


function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function sourceLabel(source: CustomerListItem["source"]) {
  return source.replace(/_/g, " ");
}

function StatusBadge({ status }: { status: CustomerListItem["status"] }) {
  return (
    <span
      className={
        status === "active"
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {status === "active" ? <WorkspaceText text="Active" /> : <WorkspaceText text="Inactive" />}
    </span>
  );
}

function SignalBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "amber" | "neutral" | "strong";
}) {
  return (
    <span
      className={
        tone === "strong"
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white"
          : tone === "amber"
            ? "inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
            : "inline-flex rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600"
      }
    >
      {children}
    </span>
  );
}

function DuplicateMergeMenu({
  customer,
}: {
  customer: CustomerListItem;
}) {
  if (customer.duplicateCandidates.length === 0) {
    return null;
  }

  return (
    <details data-dismissible-popover className="relative">
      <summary className="inline-flex cursor-pointer list-none rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 marker:hidden">
        <WorkspaceText text="Duplicate?" />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(360px,calc(100vw-48px))] rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl">
        <p className="text-sm font-semibold text-zinc-950">
          <WorkspaceText text="Matching customer records" />
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          <WorkspaceText text="Keep" /> {customer.name} <WorkspaceText text="and move selected history into it." />
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto pr-1">
          {customer.duplicateCandidates.map((candidate) => (
            <div
              className="content-surface border-zinc-200 bg-zinc-50 px-3 py-2 rounded-none border-y shadow-none"
              key={candidate.id}
            >
              <p className="text-sm font-semibold text-zinc-950">
                {candidate.name}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {[candidate.phone, candidate.email].filter(Boolean).join(" / ") ||
                  "No contact"}{" "}
                / <WorkspaceText text={sourceLabel(candidate.source)} />
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                <WorkspaceText text="Created" /> <WorkspaceText text={formatDateTime(candidate.created_at)} />
              </p>
            </div>
          ))}
        </div>
        <form action={mergeDuplicateCustomers} className="mt-3">
          <input name="target_customer_id" type="hidden" value={customer.id} />
          {customer.duplicateCandidates.map((candidate) => (
            <input
              key={candidate.id}
              name="source_customer_id"
              type="hidden"
              value={candidate.id}
            />
          ))}
          <SubmitButton pendingLabel="Processing…"
            className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white"
            type="submit"
          >
            <WorkspaceText text="Merge all" />
          </SubmitButton>
        </form>
        <form action={mergeDuplicateCustomers} className="mt-2 grid gap-2">
          <input name="target_customer_id" type="hidden" value={customer.id} />
          <div className="grid gap-1">
            {customer.duplicateCandidates.map((candidate) => (
              <label
                className="flex items-center gap-2 text-xs font-semibold text-zinc-700"
                key={candidate.id}
              >
                <input
                  className="h-4 w-4 accent-zinc-950"
                  name="source_customer_id"
                  type="checkbox"
                  value={candidate.id}
                />
                <span className="truncate">{candidate.name}</span>
              </label>
            ))}
          </div>
          <SubmitButton pendingLabel="Processing…"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
            type="submit"
          >
            <WorkspaceText text="Merge selected" />
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}

function CustomerList({
  customers,
  canManageCustomers,
  pagination,
  query,
}: {
  customers: CustomerListItem[];
  canManageCustomers: boolean;
  pagination: CustomerListPagination;
  query: string;
}) {
  if (customers.length === 0) {
    return (
      <div className="content-surface mt-4 border-zinc-300 bg-white p-6 rounded-none border-y shadow-none">
        <h2 className="text-lg font-semibold text-zinc-950">
          <WorkspaceText text={query ? "No matching customers" : "No customers yet"} />
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          <WorkspaceText text={query
            ? "Try a different name, phone, or email."
            : "Customers will appear here when appointments or POS tickets create salon-local relationships."} />
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-1 bg-white">
        <ul className="divide-y divide-zinc-200">
          {customers.map((customer) => {
            const riskCount =
              customer.metrics.cancelled_count + customer.metrics.no_show_count;
            const detailHref = customer.isWalkingGroup
              ? `/customers/${customer.id}?group=walking`
              : `/customers/${customer.id}`;

            return (
              <li className="px-4 py-2 text-sm" key={customer.id} data-customer-row>
                <div className="flex min-w-0 items-center gap-2">
                  <Link className="min-w-0 flex-1 truncate py-1 text-zinc-950" href={detailHref}>
                    <span className="font-medium">{customer.name}</span>
                    {!customer.isWalkingGroup && customer.phone ? <span className="ml-2 text-xs text-zinc-500">{customer.phone}</span> : null}
                    {customer.status !== "active" ? <span className="ml-2 text-xs text-zinc-500"><WorkspaceText text="Inactive" /></span> : null}
                  </Link>
                  {customer.duplicate_signal ? canManageCustomers ? <DuplicateMergeMenu customer={customer} /> : <SignalBadge tone="amber"><WorkspaceText text="Duplicate?" /></SignalBadge> : null}
                  {riskCount > 0 ? <span className="text-xs text-amber-700" title="Cancel/no-show">{riskCount} !</span> : null}
                  {canManageCustomers && !customer.isWalkingGroup ? <Link aria-label={`Edit ${customer.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-500" href={`/customers/${customer.id}/edit`}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z" /></svg></Link> : null}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="min-w-0 truncate">
                    {customer.isWalkingGroup ? `${customer.groupedCustomerIds?.length ?? 1} walk-ins · ` : ""}
                    {customer.metrics.upcoming_start_at ? <Link className="text-orange-700 underline" href={`/bookings?bookingId=${customer.metrics.upcoming_booking_id}`}><WorkspaceText text="Upcoming" /> {formatDateTime(customer.metrics.upcoming_start_at)}</Link> : <WorkspaceText text={formatDateTime(customer.metrics.last_visit_at)} />}
                    {" · "}{customer.metrics.appointment_count} <WorkspaceText text="appts" />
                  </span>
                  <Link className="shrink-0 tabular-nums text-zinc-700" href={detailHref}>{formatMoney(customer.metrics.finalized_spend)}{customer.metrics.active_pos_ticket_count > 0 ? ` · ${customer.metrics.active_pos_ticket_count} open` : ""}</Link>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {pagination.pageCount > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-zinc-600">
            <WorkspaceText text="Page" /> {pagination.page} <WorkspaceText text="of" /> {pagination.pageCount} /{" "}
            {pagination.count} <WorkspaceText text="customers" />
          </p>
          <div className="flex gap-2">
            {pagination.page > 1 ? (
              <Link
                className="rounded-md border border-zinc-300 px-3 py-2 font-medium text-zinc-950"
                href={customerListHref({
                  page: pagination.page - 1,
                  q: query,
                })}
              >
                <WorkspaceText text="Previous" />
              </Link>
            ) : null}
            {pagination.page < pagination.pageCount ? (
              <Link
                className="rounded-md border border-zinc-300 px-3 py-2 font-medium text-zinc-950"
                href={customerListHref({
                  page: pagination.page + 1,
                  q: query,
                })}
              >
                <WorkspaceText text="Next" />
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function customerListHref({ page, q }: { page: number; q: string }) {
  const params = new URLSearchParams();

  if (q) {
    params.set("q", q);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const query = params.toString();
  return query ? `/customers?${query}` : "/customers";
}

export function AppLocalOwnerCustomersView({ data, params }: { data: AppLocalOwnerCustomersData; params: { error?: string; page?: string; q?: string } }) {
  const __vt = useWorkspaceTranslation();
  const { error, q } = params;
  const { customers, pagination, canManageCustomers } = data;
  return (
    <main className="min-w-0 w-full px-4 py-4 sm:px-6 sm:py-6">
      {error ? (
        <p className="content-surface border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 rounded-none border-y shadow-none">
          <WorkspaceText text={error} />
        </p>
      ) : null}

      <WorkspaceToolbar title="Customers">
          <Form className={toolbarStyles.search} action="/customers">
            <input
              aria-label={__vt("Search customers")} className="h-11 w-full min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none focus:border-zinc-950"
              defaultValue={q ?? ""}
              name="q"
              placeholder={__vt("Search name, phone, email")}
              type="search"
              enterKeyHint="search"
            />
            <button className="sr-only" type="submit"><WorkspaceText text="Search customers" /></button>
            {q ? (
              <Link
                aria-label={__vt("Clear customer search")} className="inline-flex h-11 shrink-0 items-center px-1 text-sm text-zinc-600"
                href="/customers"
              >
                ×
              </Link>
            ) : null}
          </Form>
          {canManageCustomers ? (
            <Link
              aria-label={__vt("Create customer")} className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-orange-500 px-3 text-base text-white"
              href="/customers/new"
            >
              <span className="sm:hidden" aria-hidden="true">+</span><span className="hidden sm:inline"><WorkspaceText text="+ Create Customer" /></span>
            </Link>
          ) : null}
      </WorkspaceToolbar>

      <section>
        <CustomerList
          canManageCustomers={canManageCustomers}
          customers={customers}
          pagination={pagination}
          query={q?.trim() ?? ""}
        />
      </section>
    </main>
  );
}


