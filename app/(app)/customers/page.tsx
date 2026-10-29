import { withExperiencePage } from "@/components/experience-page";
import { getWorkspaceTranslation } from "@/lib/workspace-language-server";
import { WorkspaceText } from "@/components/workspace-language";
import { WorkspaceToolbar, toolbarStyles } from "@/components/workspace-toolbar";

import Form from "next/form";
import { formatCustomerDateTime as formatDateTime } from "@/lib/customer-date-time";
import { getContextBusinessTimezone } from "@/lib/salon-business-clock";
import {
  getCurrentSalonCustomerList,
  type CustomerListItem,
  type CustomerListPagination,
} from "@/lib/customers";
import { AutomaticCustomerMerge } from "@/app/customers/automatic-customer-merge";
import { DuplicateMergeForms } from "@/app/customers/duplicate-merge-forms";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import Link from "next/link";
import type { ReactNode } from "react";

type CustomersPageProps = {
  searchParams: Promise<{
    error?: string;
    merged?: string;
    page?: string;
    q?: string;
  }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function sourceLabel(source: CustomerListItem["source"]) {
  return source.replace(/_/g, " ");
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
  timezone,
}: {
  customer: CustomerListItem;
  timezone: string;
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
                <WorkspaceText text="Created" /> <WorkspaceText text={formatDateTime(candidate.created_at, timezone)} />
              </p>
              {candidate.match && <p className="mt-0.5 text-xs text-amber-800">{candidate.match.reason}</p>}
            </div>
          ))}
        </div>
        <DuplicateMergeForms customerId={customer.id} candidates={customer.duplicateCandidates} />
      </div>
    </details>
  );
}

function CustomerList({
  customers,
  canManageCustomers,
  pagination,
  query,
  timezone,
}: {
  customers: CustomerListItem[];
  canManageCustomers: boolean;
  pagination: CustomerListPagination;
  query: string;
  timezone: string;
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
                    <span className="font-medium">{customer.name}{customer.isWalkingGroup ? ` · ${customer.groupedCustomerIds?.length ?? 1} customers` : ""}</span>
                    {!customer.isWalkingGroup && customer.phone ? <span className="ml-2 text-xs text-zinc-500">{customer.phone}</span> : null}
                    {customer.status !== "active" ? <span className="ml-2 text-xs text-zinc-500"><WorkspaceText text="Inactive" /></span> : null}
                  </Link>
                  {customer.duplicate_signal ? canManageCustomers ? <DuplicateMergeMenu customer={customer} timezone={timezone} /> : <SignalBadge tone="amber"><WorkspaceText text="Duplicate?" /></SignalBadge> : null}
                  {riskCount > 0 ? <span className="text-xs text-amber-700" title="Cancel/no-show">{riskCount} !</span> : null}
                  {canManageCustomers && !customer.isWalkingGroup ? <Link aria-label={`Edit ${customer.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-500" href={`/customers/${customer.id}/edit`}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m16 3 5 5M4 15 16 3a2 2 0 0 1 5 5L9 20l-6 1 1-6Z" /></svg></Link> : null}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="min-w-0 truncate">

                    {customer.metrics.upcoming_start_at ? <Link className="text-orange-700 underline" href={`/bookings?bookingId=${customer.metrics.upcoming_booking_id}`}><WorkspaceText text="Upcoming" /> {formatDateTime(customer.metrics.upcoming_start_at, timezone)}</Link> : <WorkspaceText text={formatDateTime(customer.metrics.last_visit_at, timezone)} />}
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

async function CustomersPage({ searchParams }: CustomersPageProps) {
  const __vt = await getWorkspaceTranslation();

  const { error, merged, page, q } = await searchParams;
  await requireSalonManagePageContext("/customers");
  const { context, customers, pagination } = await getCurrentSalonCustomerList({
    page,
    search: q,
  });

  const canManageCustomers = await hasPermission("customers.manage", context);
  const timezone = await getContextBusinessTimezone(context);

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

      {merged !== undefined && <p role="status" className="py-2 text-sm">Merged {Number(merged) || 0} duplicate records.</p>}
      {canManageCustomers && context.currentSalon && <AutomaticCustomerMerge salonId={context.currentSalon.id} />}
      <section>
        <CustomerList
          timezone={timezone}
          canManageCustomers={canManageCustomers}
          customers={customers}
          pagination={pagination}
          query={q?.trim() ?? ""}
        />
      </section>
    </main>
  );
}

export default withExperiencePage(CustomersPage);
