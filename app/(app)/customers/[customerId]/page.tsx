import {
  getCurrentSalonCustomerDetail,
  type CustomerBookingSummary,
  type CustomerTicketSummary,
  type CustomerTimelineItem,
} from "@/lib/customers";
import {
  resolveBeautyProfileForSalonCustomer,
  type BeautyProfileResolveResult,
} from "@/lib/beauty-relationship";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import type { Customer } from "@/types/customer";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

type CustomerDetailPageProps = {
  params: Promise<{
    customerId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    group?: string;
    history?: string;
    merged?: string;
  }>;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDateTimeMaybe(value: string | null) {
  return value ? formatDateTime(value) : "-";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function sourceLabel(source: Customer["source"]) {
  return source.replace(/_/g, " ");
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="border-b border-zinc-100 py-4 last:border-b-0">
      <dt className="text-sm font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-950">{value || "-"}</dd>
    </div>
  );
}

function Section({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
        <h2 className="text-lg font-semibold text-zinc-950">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function StatusBadge({ customer }: { customer: Customer }) {
  return (
    <span
      className={
        customer.status === "active"
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {customer.status === "active" ? "Active" : "Inactive"}
    </span>
  );
}

function ReylumiProfileCard({
  linked,
  result,
}: {
  linked: boolean;
  result: BeautyProfileResolveResult | null;
}) {
  if (!linked) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm font-semibold text-zinc-950">
          No ReyLUMI profile linked
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          This customer is only a salon CRM record right now.
        </p>
      </div>
    );
  }

  if (result?.ok && result.state === "unlinked") {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm font-semibold text-zinc-950">
          No ReyLUMI profile linked
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          This customer is only a salon CRM record right now.
        </p>
      </div>
    );
  }

  if (result?.ok && result.state === "profile_not_created") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm font-semibold text-zinc-950">
          ReyLUMI account linked
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          Beauty profile is not available yet.
        </p>
      </div>
    );
  }

  if (!result?.ok || !result.profile) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-950">
          ReyLUMI account linked
        </p>
        <p className="mt-1 text-sm text-amber-800">
          Beauty profile could not be checked right now.
        </p>
      </div>
    );
  }

  const { profile } = result;
  const isPrivate = profile.state === "private";

  return (
    <div className="grid gap-4 rounded-lg border border-orange-100 bg-gradient-to-br from-white to-orange-50/60 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-orange-100 text-sm font-extrabold text-orange-700 ring-1 ring-orange-200">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${profile.displayName} Beauty profile`}
              className="h-full w-full object-cover"
              src={profile.avatarUrl}
            />
          ) : (
            profile.initials
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-zinc-950">
            {profile.displayName}
          </span>
          <span className="mt-1 inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-semibold capitalize text-orange-700 ring-1 ring-orange-100">
            {isPrivate ? "Beauty profile is private" : "Public Beauty profile"}
          </span>
        </span>
      </div>
      {isPrivate ? (
        <p className="text-sm leading-6 text-zinc-600">
          This customer has a ReyLUMI Beauty identity, but their Beauty content
          is private.
        </p>
      ) : null}
      {!isPrivate && profile.bio ? (
        <p className="line-clamp-3 text-sm leading-6 text-zinc-600">
          {profile.bio}
        </p>
      ) : null}
      <Link
        className="inline-flex min-h-10 w-fit items-center justify-center rounded-md bg-[#f26f3d] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e85f2b]"
        href={profile.href}
      >
        View Beauty Profile
      </Link>
    </div>
  );
}

function BookingList({
  empty,
  items,
}: {
  empty: string;
  items: CustomerBookingSummary[];
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        {empty}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((booking) => (
        <li className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={booking.id}>
          <div className="min-w-0">
            <Link
              className="font-semibold text-zinc-950 underline"
              href={`/bookings?date=${booking.start_at.slice(0, 10)}&bookingId=${booking.id}`}
            >
              {formatDateTime(booking.start_at)}
            </Link>
            <p className="mt-1 text-sm text-zinc-600">
              {booking.serviceNames.join(", ") || "No services"} /{" "}
              {booking.staff?.display_name ?? "Unassigned"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold capitalize text-zinc-700">
              {booking.normalizedStatus.replace(/_/g, " ")}
            </span>
            <span className="rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
              {formatMoney(booking.subtotal)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TicketList({ items }: { items: CustomerTicketSummary[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        No linked POS tickets yet.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((ticket) => (
        <li className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={ticket.id}>
          <div className="min-w-0">
            <Link
              className="font-semibold text-zinc-950 underline"
              href={`/pos-tickets/${ticket.id}`}
            >
              {ticket.ticket_number}
            </Link>
            <p className="mt-1 text-sm text-zinc-600">
              {formatDateTime(ticket.opened_at)}
              {ticket.source_booking_id ? " / From appointment" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold capitalize text-zinc-700">
              {ticket.status}
            </span>
            <span className="rounded-md bg-zinc-950 px-2 py-1 text-xs font-semibold text-white">
              {formatMoney(ticket.totals.total)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ items }: { items: CustomerTimelineItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
        No timeline activity yet.
      </p>
    );
  }

  return (
    <ol className="border-l border-zinc-200">
      {items.map((item) => (
        <li className="relative pb-5 pl-5" key={item.id}>
          <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border border-zinc-300 bg-white" />
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {item.href ? (
                <Link className="text-sm font-semibold capitalize text-zinc-950 underline" href={item.href}>
                  {item.label}
                </Link>
              ) : (
                <p className="text-sm font-semibold capitalize text-zinc-950">
                  {item.label}
                </p>
              )}
              <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold capitalize text-zinc-600">
                {item.type}
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              {formatDateTime(item.timestamp)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function historyFilterHref(customerId: string, filter: string, group?: string) {
  const params = new URLSearchParams();

  if (group) {
    params.set("group", group);
  }

  if (filter !== "all") {
    params.set("history", filter);
  }

  const query = params.toString();

  return query ? `/customers/${customerId}?${query}` : `/customers/${customerId}`;
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: CustomerDetailPageProps) {
  const { customerId } = await params;
  const { error, group, history, merged } = await searchParams;
  const historyFilter = ["appointments", "tickets", "timeline"].includes(history ?? "")
    ? history
    : "all";
  await requireSalonManagePageContext(`/customers/${customerId}`);
  const { context, data } = await getCurrentSalonCustomerDetail(customerId, {
    walkingGroup: group === "walking",
  });

  if (!data) {
    notFound();
  }

  const customer = data.customer;
  const beautyProfileResult = customer.customer_user_id
    ? await resolveBeautyProfileForSalonCustomer({
        context,
        customerId: customer.id,
      })
    : null;
  const canManageCustomers = await hasPermission("customers.manage", context);
  const showAppointments =
    historyFilter === "all" || historyFilter === "appointments";
  const showTickets = historyFilter === "all" || historyFilter === "tickets";
  const showTimeline = historyFilter === "all" || historyFilter === "timeline";
  const lastVisit = data.bookingHistory.find((booking) =>
    booking.normalizedStatus === "completed",
  );

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="min-w-0 truncate text-sm font-semibold text-zinc-950">
            {customer.name}
          </span>
            <StatusBadge customer={customer} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
            href="/customers"
          >
            Customers
          </Link>
          {canManageCustomers && !data.isWalkingGroup ? (
            <Link
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
              href={`/customers/${customer.id}/edit`}
            >
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      {merged ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          Merged {merged} duplicate customer record{merged === "1" ? "" : "s"}.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          {error}
        </p>
      ) : null}

      {data.duplicateCandidates.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4">
          <h2 className="text-base font-semibold text-amber-950">
            {data.isWalkingGroup ? "Walking group" : "Possible duplicate customer"}
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            {data.isWalkingGroup
              ? "This view combines walk-in records that have no customer contact information."
              : "Matching phone or email exists in this salon. No merge was performed."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.duplicateCandidates.map((candidate) => (
              <Link
                className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-950"
                href={`/customers/${candidate.id}`}
                key={candidate.id}
              >
                {candidate.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="grid content-start gap-6">
          <div className="flex flex-wrap items-start gap-2">
            {[
              ["all", "All"],
              ["appointments", "Appointments"],
              ["tickets", "Tickets"],
              ["timeline", "Timeline"],
            ].map(([value, label]) => (
              <Link
                className={
                  historyFilter === value
                    ? "inline-flex h-10 shrink-0 items-center rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white"
                    : "inline-flex h-10 shrink-0 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950"
                }
                href={historyFilterHref(customer.id, value, group)}
                key={value}
              >
                {label}
              </Link>
            ))}
          </div>

          {showAppointments ? (
            <>
              <Section title="Upcoming Appointments">
                <BookingList
                  empty="No upcoming appointments."
                  items={data.upcomingBookings}
                />
              </Section>

              <Section title="Booking History">
                <BookingList
                  empty="No booking history yet."
                  items={data.bookingHistory}
                />
              </Section>
            </>
          ) : null}

          {showTickets ? (
            <Section title="POS Ticket History">
              <TicketList items={data.tickets} />
            </Section>
          ) : null}

          {showTimeline ? (
            <Section title="Timeline">
              <Timeline items={data.timeline} />
            </Section>
          ) : null}
        </section>

        <aside className="grid h-fit gap-6">
          <Section title="ReyLUMI Profile">
            <ReylumiProfileCard
              linked={Boolean(customer.customer_user_id)}
              result={beautyProfileResult}
            />
          </Section>

          <Section title="Identity">
            <dl className="divide-y divide-zinc-100">
              <DetailRow label="Customer Name" value={customer.name} />
              <DetailRow label="Phone" value={customer.phone} />
              <DetailRow label="Email" value={customer.email} />
              <DetailRow label="Source" value={sourceLabel(customer.source)} />
              <DetailRow
                label="Account Link"
                value={customer.customer_user_id ? "Linked" : "Not linked"}
              />
              <DetailRow
                label="Status"
                value={customer.status === "active" ? "Active" : "Inactive"}
              />
            </dl>
          </Section>

          <Section title="Signals">
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-zinc-500">Finalized POS spend</dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {formatMoney(data.finalizedSpend)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Active tickets</dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  {data.activeTickets.length}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Last visit</dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  {formatDateTimeMaybe(lastVisit?.start_at ?? null)}
                </dd>
              </div>
            </dl>
          </Section>

          <Section title="Notes">
            <dl className="divide-y divide-zinc-100">
              <DetailRow label="Public notes" value={customer.notes} />
              <DetailRow label="Staff-safe notes" value={customer.staff_notes} />
              <DetailRow
                label="Owner-only notes"
                value={customer.internal_notes}
              />
            </dl>
          </Section>

          <Section title="Record">
            <dl className="divide-y divide-zinc-100">
              <DetailRow label="Created At" value={formatDateTime(customer.created_at)} />
              <DetailRow label="Updated At" value={formatDateTime(customer.updated_at)} />
            </dl>
          </Section>
        </aside>
      </div>
    </main>
  );
}
