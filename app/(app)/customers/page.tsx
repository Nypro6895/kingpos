import {
  getCurrentSalonCustomerList,
  type CustomerListItem,
  type CustomerListPagination,
} from "@/lib/customers";
import { mergeDuplicateCustomers } from "@/app/customers/actions";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import Link from "next/link";
import type { ReactNode } from "react";

type CustomersPageProps = {
  searchParams: Promise<{
    error?: string;
    page?: string;
    q?: string;
  }>;
};

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
      {status === "active" ? "Active" : "Inactive"}
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
    <details className="relative">
      <summary className="inline-flex cursor-pointer list-none rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 marker:hidden">
        Duplicate?
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-[min(360px,calc(100vw-48px))] rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-xl">
        <p className="text-sm font-semibold text-zinc-950">
          Matching customer records
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Keep {customer.name} and move selected history into it.
        </p>
        <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto pr-1">
          {customer.duplicateCandidates.map((candidate) => (
            <div
              className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2"
              key={candidate.id}
            >
              <p className="text-sm font-semibold text-zinc-950">
                {candidate.name}
              </p>
              <p className="mt-0.5 text-xs text-zinc-600">
                {[candidate.phone, candidate.email].filter(Boolean).join(" / ") ||
                  "No contact"}{" "}
                / {sourceLabel(candidate.source)}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Created {formatDateTime(candidate.created_at)}
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
          <button
            className="w-full rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white"
            type="submit"
          >
            Merge all
          </button>
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
          <button
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-950"
            type="submit"
          >
            Merge selected
          </button>
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
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-white p-6">
        <h2 className="text-lg font-semibold text-zinc-950">
          {query ? "No matching customers" : "No customers yet"}
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          {query
            ? "Try a different name, phone, or email."
            : "Customers will appear here when appointments or POS tickets create salon-local relationships."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 overflow-visible rounded-lg border border-zinc-200 bg-white">
        <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
          <div className="col-span-12 sm:col-span-3">Customer</div>
          <div className="hidden sm:col-span-2 sm:block">Upcoming</div>
          <div className="hidden sm:col-span-2 sm:block">Last visit</div>
          <div className="hidden sm:col-span-2 sm:block">History</div>
          <div className="hidden sm:col-span-2 sm:block">Spend</div>
          <div className="hidden sm:col-span-1 sm:block">Actions</div>
        </div>
        <ul className="divide-y divide-zinc-200">
          {customers.map((customer) => {
            const riskCount =
              customer.metrics.cancelled_count + customer.metrics.no_show_count;
            const detailHref = customer.isWalkingGroup
              ? `/customers/${customer.id}?group=walking`
              : `/customers/${customer.id}`;

            return (
              <li className="grid grid-cols-12 gap-3 px-5 py-4" key={customer.id}>
                <div className="col-span-12 sm:col-span-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-zinc-950">{customer.name}</p>
                    <StatusBadge status={customer.status} />
                    {customer.duplicate_signal ? (
                      canManageCustomers ? (
                        <DuplicateMergeMenu customer={customer} />
                      ) : (
                        <SignalBadge tone="amber">Duplicate?</SignalBadge>
                      )
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-zinc-600">
                    {customer.isWalkingGroup
                      ? `${customer.groupedCustomerIds?.length ?? 1} walk-in records`
                      : [customer.phone, customer.email].filter(Boolean).join(" / ") ||
                        "No contact"}
                  </p>
                  <p className="mt-1 text-xs capitalize text-zinc-500">
                    {sourceLabel(customer.source)}
                  </p>
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Upcoming:{" "}
                  </span>
                  {customer.metrics.upcoming_start_at ? (
                    <Link
                      className="font-medium text-zinc-950 underline"
                      href={`/bookings?bookingId=${customer.metrics.upcoming_booking_id}`}
                    >
                      {formatDateTime(customer.metrics.upcoming_start_at)}
                    </Link>
                  ) : (
                    "-"
                  )}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Last visit:{" "}
                  </span>
                  {formatDateTime(customer.metrics.last_visit_at)}
                </div>
                <div className="col-span-12 flex flex-wrap gap-2 self-center sm:col-span-2">
                  <SignalBadge tone="strong">
                    {customer.metrics.appointment_count} appts
                  </SignalBadge>
                  {riskCount > 0 ? (
                    <SignalBadge tone="amber">
                      {riskCount} cancel/no-show
                    </SignalBadge>
                  ) : null}
                </div>
                <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-2">
                  <span className="font-medium text-zinc-500 sm:hidden">
                    Finalized spend:{" "}
                  </span>
                  {formatMoney(customer.metrics.finalized_spend)}
                  {customer.metrics.active_pos_ticket_count > 0 ? (
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      {customer.metrics.active_pos_ticket_count} open ticket
                    </p>
                  ) : null}
                </div>
                <div className="col-span-12 flex flex-wrap gap-2 self-center text-sm sm:col-span-1 sm:block sm:space-y-2">
                  <Link
                    className="font-medium text-zinc-950 underline"
                    href={detailHref}
                  >
                    View
                  </Link>
                  {canManageCustomers && !customer.isWalkingGroup ? (
                    <Link
                      className="font-medium text-zinc-950 underline sm:block"
                      href={`/customers/${customer.id}/edit`}
                    >
                      Edit
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {pagination.pageCount > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-zinc-600">
            Page {pagination.page} of {pagination.pageCount} /{" "}
            {pagination.count} customers
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
                Previous
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
                Next
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

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const { error, page, q } = await searchParams;
  await requireSalonManagePageContext("/customers");
  const { context, customers, pagination } = await getCurrentSalonCustomerList({
    page,
    search: q,
  });

  const canManageCustomers = await hasPermission("customers.manage", context);

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <section className="border-b border-zinc-200 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form className="flex flex-col gap-3 sm:flex-row" action="/customers">
            <input
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950 sm:w-[480px]"
              defaultValue={q ?? ""}
              name="q"
              placeholder="Search name, phone, email"
              type="search"
            />
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              type="submit"
            >
              Search
            </button>
            {q ? (
              <Link
                className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
                href="/customers"
              >
                Clear
              </Link>
            ) : null}
          </form>
          {canManageCustomers ? (
            <Link
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              href="/customers/new"
            >
              + Create Customer
            </Link>
          ) : null}
        </div>
      </section>

      <section className="pt-6">
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
