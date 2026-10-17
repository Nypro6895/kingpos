"use client";

// The original page JSX/helpers are preserved here; only its server loader is replaced by authorized DTO props.
import type { AppLocalOwnerCustomerDetailData } from "./app-local-owner-page-types";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import { BookingDepositReceipt } from "@/components/booking-deposit-receipt";
import {
  type CustomerBookingSummary,
  type CustomerTicketSummary,
  type CustomerTimelineItem,
} from "@/lib/customers";
import {
  type BeautyProfileResolveResult,
} from "@/lib/beauty-relationship";
import type { Customer } from "@/types/customer";
import Link from "next/link";
import type { ReactNode } from "react";


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
      <dt className="text-sm font-medium text-zinc-500"><WorkspaceText text={label} /></dt>
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
    <details className="border-b border-zinc-200 bg-white">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2">
        <span className="text-sm font-normal text-zinc-600"><WorkspaceText text={title} /></span>
        {action}
      </summary>
      <div className="px-4 pb-3">{children}</div>
    </details>
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
      {customer.status === "active" ? <WorkspaceText text="Active" /> : <WorkspaceText text="Inactive" />}
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
      <div className="content-surface border-zinc-200 bg-zinc-50 p-4 rounded-none border-y shadow-none">
        <p className="text-sm font-normal text-zinc-950">
          <WorkspaceText text="No ReyLUMI profile linked" />
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="This customer is only a salon CRM record right now." />
        </p>
      </div>
    );
  }

  if (result?.ok && result.state === "unlinked") {
    return (
      <div className="content-surface border-zinc-200 bg-zinc-50 p-4 rounded-none border-y shadow-none">
        <p className="text-sm font-normal text-zinc-950">
          <WorkspaceText text="No ReyLUMI profile linked" />
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="This customer is only a salon CRM record right now." />
        </p>
      </div>
    );
  }

  if (result?.ok && result.state === "profile_not_created") {
    return (
      <div className="content-surface border-zinc-200 bg-zinc-50 p-4 rounded-none border-y shadow-none">
        <p className="text-sm font-normal text-zinc-950">
          <WorkspaceText text="ReyLUMI account linked" />
        </p>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="Beauty profile is not available yet." />
        </p>
      </div>
    );
  }

  if (!result?.ok || !result.profile) {
    return (
      <div className="content-surface border-amber-200 bg-amber-50 p-4 rounded-none border-y shadow-none">
        <p className="text-sm font-semibold text-amber-950">
          <WorkspaceText text="ReyLUMI account linked" />
        </p>
        <p className="mt-1 text-sm text-amber-800">
          <WorkspaceText text="Beauty profile could not be checked right now." />
        </p>
      </div>
    );
  }

  const { profile } = result;
  const isPrivate = profile.state === "private";

  return (
    <div className="content-surface grid gap-4 border-orange-100 bg-gradient-to-br from-white to-orange-50/60 p-4 rounded-none border-y shadow-none">
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
          <span className="block truncate text-sm font-normal text-zinc-950">
            {profile.displayName}
          </span>
          <span className="mt-1 inline-flex rounded-full bg-white px-2 py-1 text-[11px] font-semibold capitalize text-orange-700 ring-1 ring-orange-100">
            <WorkspaceText text={isPrivate ? "Beauty profile is private" : "Public Beauty profile"} />
          </span>
        </span>
      </div>
      {isPrivate ? (
        <p className="text-sm leading-6 text-zinc-600">
          <WorkspaceText text="This customer has a ReyLUMI Beauty identity, but their Beauty content is private." />
        </p>
      ) : null}
      {!isPrivate && profile.bio ? (
        <p className="line-clamp-3 text-sm leading-6 text-zinc-600">
          {profile.bio}
        </p>
      ) : null}
      <Link
        className="inline-flex min-h-10 w-fit items-center justify-center rounded-md bg-[#f26f3d] px-4 text-sm font-normal text-white shadow-sm transition hover:bg-[#e85f2b]"
        href={profile.href}
      >
        <WorkspaceText text="View Beauty Profile" />
      </Link>
    </div>
  );
}

function BookingList({ empty, items }: { empty: string; items: CustomerBookingSummary[] }) {
  return items.length ? <div>{items.map(booking => <details className="border-b border-zinc-100 text-sm font-normal" key={booking.id} data-history-record>
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-xs font-normal">
      <span className="min-w-0 truncate"><WorkspaceText text={shortDate(booking.start_at)} /> · <WorkspaceText text={booking.serviceNames.join(", ") || "No services"} /> · <WorkspaceText text={bookingStatusLabel(booking.normalizedStatus, booking.no_show_kind)} /></span>
      <span className="shrink-0 tabular-nums">{formatMoney(booking.subtotal)} ›</span>
    </summary>
    <div className="space-y-2 px-4 pb-4 text-sm font-normal" data-customer-receipt>
      <div><WorkspaceText text={formatDateTime(booking.start_at)} /> · <WorkspaceText text={booking.staff?.display_name ?? "Unassigned"} /></div>
      {booking.lines.map(line => <div key={line.id} className="flex justify-between gap-3"><span>{line.service_name_snapshot}</span><span>{formatMoney(Number(line.line_total))}</span></div>)}
      <div className="flex justify-between border-t border-zinc-100 pt-2"><WorkspaceText text="Total" /><span>{formatMoney(booking.subtotal)}</span></div>
      <BookingDepositReceipt booking={booking} />
      <Link className="inline-flex min-h-11 items-center text-orange-700" href={`/bookings?date=${booking.start_at.slice(0, 10)}&bookingId=${booking.id}`}><WorkspaceText text="View appointment" /> ›</Link>
    </div>
  </details>)}</div> : <p className="px-4 py-2 text-xs text-zinc-500"><WorkspaceText text={empty} /></p>;
}

function TicketList({ items }: { items: CustomerTicketSummary[] }) {
  return items.length ? <div>{items.map(ticket => <details className="border-b border-zinc-100 text-sm font-normal" key={ticket.id} data-history-record>
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-xs font-normal">
      <span className="min-w-0 truncate"><WorkspaceText text={shortDate(ticket.opened_at)} /> · {ticket.ticket_number} · <WorkspaceText text={ticket.status} /></span><span className="shrink-0 tabular-nums">{formatMoney(ticket.totals.total)} ›</span>
    </summary>
    <div className="space-y-2 px-4 pb-4 text-sm font-normal" data-customer-receipt>
      <div>{ticket.ticket_number} · <WorkspaceText text={formatDateTime(ticket.opened_at)} /></div>
      <div>{ticket.customer?.name ?? <WorkspaceText text="Walk-in Customer" />}</div>
      {ticket.ticket_items.map(item => <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-t border-zinc-100 py-2"><span>{item.assigned_staff?.display_name ?? <WorkspaceText text="Unassigned" />}</span><span>{item.service?.name ?? item.service_name_snapshot ?? <WorkspaceText text="Service" />}</span><span className="tabular-nums">{formatMoney((item.turn_parts?.length ? item.turn_parts.reduce((total,part) => total + part.amount, 0) : item.line_total))}</span></div>)}
      {ticket.totals.discount_amount > 0 ? <div className="flex justify-between"><WorkspaceText text="Discount" /><span>-{formatMoney(ticket.totals.discount_amount)}</span></div> : null}
      {ticket.totals.tip_amount > 0 ? <div className="flex justify-between"><WorkspaceText text="Tip" /><span>{formatMoney(ticket.totals.tip_amount)}</span></div> : null}
      {ticket.totals.tax_amount > 0 ? <div className="flex justify-between"><WorkspaceText text="Tax" /><span>{formatMoney(ticket.totals.tax_amount)}</span></div> : null}
      <div className="flex justify-between border-t border-zinc-200 pt-2"><WorkspaceText text="Total" /><span>{formatMoney(ticket.totals.total)}</span></div>
      <Link className="inline-flex min-h-11 items-center text-orange-700" href={`/pos-tickets/${ticket.id}`}><WorkspaceText text="View ticket" /> ›</Link>
    </div>
  </details>)}</div> : <p className="px-4 py-2 text-xs text-zinc-500"><WorkspaceText text="No linked POS tickets yet." /></p>;
}

function Timeline({ items }: { items: CustomerTimelineItem[] }) {
  return <ol>{items.map(item => <li key={item.id} className="border-b border-zinc-100 px-4 text-xs font-normal">
    {item.href ? <Link className="flex min-h-11 items-center justify-between gap-2" href={item.href}><span className="truncate"><WorkspaceText text={shortDate(item.timestamp)} /> · <WorkspaceText text={item.label} /></span><span>›</span></Link> : <span className="flex min-h-11 items-center"><WorkspaceText text={shortDate(item.timestamp)} /> · <WorkspaceText text={item.label} /></span>}
  </li>)}{!items.length ? <li className="px-4 py-2 text-xs text-zinc-500"><WorkspaceText text="No timeline activity yet." /></li> : null}</ol>;
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

export function AppLocalOwnerCustomerDetailView({ value, params }: { value: AppLocalOwnerCustomerDetailData; params: { error?: string; group?: string; history?: string; merged?: string } }) {
  const __vt = useWorkspaceTranslation();
  const { error, group, history, merged } = params;
  const historyFilter = ["appointments", "tickets", "timeline"].includes(history ?? "") ? history : "all";
  const { data, beautyProfileResult, canManageCustomers } = value;
  const customer = data.customer;
  const showAppointments =
    historyFilter === "all" || historyFilter === "appointments";
  const showTickets = historyFilter === "all" || historyFilter === "tickets";
  const showTimeline = historyFilter === "all" || historyFilter === "timeline";
  const lastVisit = data.bookingHistory.find((booking) =>
    booking.normalizedStatus === "completed",
  );

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-2 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="min-w-0 truncate text-sm font-normal text-zinc-950">
            {customer.name}
          </span>
            <StatusBadge customer={customer} />
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex min-h-11 items-center text-sm font-normal text-orange-600"
            href="/customers"
          >
            <WorkspaceText text="Customers" />
          </Link>
          {canManageCustomers && !data.isWalkingGroup ? (
            <Link
              className="inline-flex min-h-11 items-center px-2 text-sm font-normal text-orange-600"
              href={`/customers/${customer.id}/edit`}
            >
              <WorkspaceText text="Edit" />
            </Link>
          ) : null}
        </div>
      </div>

      {merged ? (
        <p className="content-surface border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 rounded-none border-y shadow-none">
          <WorkspaceText text="Merged" /> {merged} <WorkspaceText text="duplicate customer record" />{merged === "1" ? "" : "s"}.
        </p>
      ) : null}

      {error ? (
        <p className="content-surface border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 rounded-none border-y shadow-none">
          <WorkspaceText text={error} />
        </p>
      ) : null}

      {data.duplicateCandidates.length > 0 ? (
        <details className="border-y border-amber-200 bg-amber-50 px-4 py-2 text-sm"><summary className="min-h-7 cursor-pointer text-amber-900"><WorkspaceText text={data.isWalkingGroup ? "Walking group" : "Possible duplicate customer"} /> · {data.isWalkingGroup ? (data.groupedCustomerIds?.length ?? data.duplicateCandidates.length + 1) : data.duplicateCandidates.length}</summary>
          <h2 className="sr-only">
            <WorkspaceText text={data.isWalkingGroup ? "Walking group" : "Possible duplicate customer"} />
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            <WorkspaceText text={data.isWalkingGroup
              ? "This view combines walk-in records that have no customer contact information."
              : "Matching phone or email exists in this salon. No merge was performed."} />
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
        </details>
      ) : null}

      <div className="flex justify-between gap-2 px-4 py-2 text-xs font-normal text-zinc-600">
        <span>{data.upcomingBookings.length + data.bookingHistory.length} <WorkspaceText text="appts" /></span><span>{formatMoney(data.finalizedSpend)} <WorkspaceText text="Finalized POS spend" /></span>
      </div>
      <div className="grid min-w-0 gap-2">
        <section className="grid min-w-0 content-start gap-1">
          <div className="flex min-w-0 items-center justify-between border-b border-zinc-200 px-2">
            {[
              ["all", "All"],
              ["appointments", "Appointments"],
              ["tickets", "Tickets"],
              ["timeline", "Timeline"],
            ].map(([value, label]) => (
              <Link
                className={
                  historyFilter === value
                    ? "inline-flex h-11 items-center border-b-2 border-orange-500 px-2 text-sm font-normal text-orange-600"
                    : "inline-flex h-11 items-center px-2 text-sm font-normal text-zinc-600"
                }
                href={historyFilterHref(customer.id, value, group)}
                key={value}
              >
                <WorkspaceText text={label} />
              </Link>
            ))}
          </div>

          {historyFilter === "all" ? (
            <div data-unified-history>{!data.upcomingBookings.length && !data.bookingHistory.length && !data.tickets.length ? <p className="px-4 py-2 text-xs text-zinc-500"><WorkspaceText text="No timeline activity yet." /></p> : null}{[
              ...data.upcomingBookings.map(booking => ({ at: booking.start_at, key: `up-${booking.id}`, content: <BookingList empty="" items={[booking]} /> })),
              ...data.bookingHistory.map(booking => ({ at: booking.start_at, key: `booking-${booking.id}`, content: <BookingList empty="" items={[booking]} /> })),
              ...data.tickets.map(ticket => ({ at: ticket.opened_at, key: `ticket-${ticket.id}`, content: <TicketList items={[ticket]} /> })),
            ].sort((a,b) => b.at.localeCompare(a.at)).map(row => <div key={row.key}>{row.content}</div>)}</div>
          ) : <>
            {showAppointments ? <><BookingList empty="No upcoming appointments." items={data.upcomingBookings} /><BookingList empty="No booking history yet." items={data.bookingHistory} /></> : null}
            {showTickets ? <TicketList items={data.tickets} /> : null}
            {showTimeline ? <Timeline items={data.timeline} /> : null}
          </>}
        </section>

        <aside className="grid h-fit gap-1">
          <Section title={__vt("ReyLUMI Profile")}>
            <ReylumiProfileCard
              linked={Boolean(customer.customer_user_id)}
              result={beautyProfileResult}
            />
          </Section>

          <Section title={__vt("Identity")}>
            <dl className="divide-y divide-zinc-100">
              <DetailRow label={__vt("Customer Name")} value={customer.name} />
              <DetailRow label={__vt("Phone")} value={customer.phone} />
              <DetailRow label={__vt("Email")} value={customer.email} />
              <DetailRow label={__vt("Source")} value={sourceLabel(customer.source)} />
              <DetailRow
                label={__vt("Account Link")}
                value={customer.customer_user_id ? "Linked" : "Not linked"}
              />
              <DetailRow
                label={__vt("Status")}
                value={customer.status === "active" ? "Active" : "Inactive"}
              />
            </dl>
          </Section>

          <Section title={__vt("Signals")}>
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-zinc-500"><WorkspaceText text="Finalized POS spend" /></dt>
                <dd className="mt-1 text-lg font-semibold text-zinc-950">
                  {formatMoney(data.finalizedSpend)}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500"><WorkspaceText text="Active tickets" /></dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  {data.activeTickets.length}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500"><WorkspaceText text="Last visit" /></dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  <WorkspaceText text={formatDateTimeMaybe(lastVisit?.start_at ?? null)} />
                </dd>
              </div>
            </dl>
          </Section>

          <Section title={__vt("Notes")}>
            <dl className="divide-y divide-zinc-100">
              <DetailRow label={__vt("Public notes")} value={customer.notes} />
              <DetailRow label={__vt("Staff-safe notes")} value={customer.staff_notes} />
              <DetailRow
                label={__vt("Owner-only notes")}
                value={customer.internal_notes}
              />
            </dl>
          </Section>

          <Section title={__vt("Record")}>
            <dl className="divide-y divide-zinc-100">
              <DetailRow label={__vt("Created At")} value={formatDateTime(customer.created_at)} />
              <DetailRow label={__vt("Updated At")} value={formatDateTime(customer.updated_at)} />
            </dl>
          </Section>
        </aside>
      </div>
    </main>
  );
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
