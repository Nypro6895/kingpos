"use client";

// Pure presentation extracted from the shipped booking and receipt pages. Reads and commands remain server-authorized.
import Link from "next/link";
import { ContextualSupport } from "@/components/contextual-support";
import { ActivityHistoryPanel } from "@/app/(app)/activity/activity-history-panel";
import { BookingDetailsButton } from "@/app/my-bookings/booking-details-button";
import { VisitExperiencePrompt } from "@/app/activity/visit-experience-prompt";
import { historyBookingLabel, historyTicketTotals } from "@/lib/booking-history";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import type { CustomerBookingLine, CustomerBookingListScope, CustomerBookingSummary } from "@/lib/customer-bookings";
import type { CustomerActivityReceipt, CustomerActivityReceiptService } from "@/lib/customer-activity";
import type { AppLocalBookingsData, AppLocalReceiptData } from "@/lib/app-local-platform-types";
import listStyles from "@/app/(app)/my-bookings/booking-list.module.css";
import styles from "@/components/booking-ui/booking-theme.module.css";
const TABS: Array<{href:string;id:CustomerBookingListScope;label:string}>=[{href:"/my-bookings",id:"upcoming",label:"Upcoming"},{href:"/my-bookings?tab=past",id:"past",label:"Past"},{href:"/my-bookings?tab=cancelled",id:"cancelled",label:"Cancelled"}];
function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDateParts(startAt: string, timezone: string) {
  const date = new Date(startAt);

  if (Number.isNaN(date.getTime())) {
    return {
      day: "--",
      month: "Time",
      weekday: "not available",
    };
  }

  return {
    day: new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      timeZone: timezone,
    }).format(date),
    month: new Intl.DateTimeFormat("en-US", {
      month: "short",
      timeZone: timezone,
    }).format(date),
    weekday: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      timeZone: timezone,
    }).format(date),
  };
}

function formatMonthGroup(startAt: string, timezone: string) {
  const date = new Date(startAt);

  if (Number.isNaN(date.getTime())) {
    return "Upcoming";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: timezone,
    year: "numeric",
  }).format(date);
}

function formatTime(value: string, timezone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function formatMoney(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);

  if (!Number.isFinite(amount)) {
    return "$0.00";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function statusClass(status: string) {
  if (status === "cancelled" || status === "no_show") {
    return "border-zinc-300 bg-zinc-100 text-zinc-700";
  }

  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-[#ffd6c4] bg-[#fff0e8] text-[#f26f3d]";
}

function messageFromSearch(value: string | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "K";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function locationLabel(booking: CustomerBookingSummary) {
  return [
    booking.salon?.address_line1,
    [booking.salon?.city, booking.salon?.state].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" - ");
}

function serviceSummary(lines: CustomerBookingLine[]) {
  const services = lines.filter((line) => line.line_type === "service");
  const addOnCount = lines.filter((line) => line.line_type === "add_on").length;
  const names = services.map((line) => line.service_name_snapshot).filter(Boolean);
  const primary =
    names.length === 0
      ? "Appointment"
      : names.length <= 2
        ? names.join(", ")
        : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;

  return addOnCount > 0 ? `${primary} with ${addOnCount} add-on${addOnCount > 1 ? "s" : ""}` : primary;
}

function totalAmount(lines: CustomerBookingLine[]) {
  return lines.reduce((total, line) => total + Number(line.line_total ?? 0), 0);
}

function groupBookings(bookings: CustomerBookingSummary[]) {
  const groups = new Map<string, CustomerBookingSummary[]>();

  for (const booking of bookings) {
    const timezone = booking.salon_timezone_snapshot || "America/Chicago";
    const label = formatMonthGroup(booking.start_at, timezone);
    groups.set(label, [...(groups.get(label) ?? []), booking]);
  }

  return [...groups.entries()];
}

function SalonThumb({ booking }: { booking: CustomerBookingSummary }) {
  const salonName = booking.salon?.displayName ?? booking.salon?.name ?? "Reylumi salon";
  const imageUrl =
    booking.inspiration?.imageUrl ??
    booking.salon?.logoUrl ??
    booking.salon?.coverUrl;
  const alt = booking.inspiration?.imageUrl
    ? "Saved booking inspiration"
    : `${salonName} salon`;

  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#fff0e8] text-sm font-extrabold text-[#f26f3d]">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={alt}
          className="h-full w-full object-cover"
          src={imageUrl}
        />
      ) : (
        initialsFor(salonName)
      )}
    </span>
  );
}

function BookingRow({ booking, initialOpen }: { booking: CustomerBookingSummary; initialOpen: boolean }) {
  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const dateParts = formatDateParts(booking.start_at, timezone);
  const lines = booking.lines ?? [];
  const salonName = booking.salon?.displayName ?? booking.salon?.name ?? "Reylumi salon";
  const place = locationLabel(booking);

  const ticket = booking.historyEvidence?.ticket;

  return (
    <div className={listStyles.row}>
      <div className={listStyles.summary}>
        <span className={listStyles.date}>
          <span className={listStyles.dateBadge}>
            <span>{dateParts.month}</span>
            <strong>{dateParts.day}</strong>
          </span>
          <span className={listStyles.schedule}>
            <strong>{dateParts.weekday}</strong>
            <span>{formatTime(booking.start_at, timezone)} ? {formatTime(booking.end_at, timezone)}</span>

          </span>
        </span>
        <span className={listStyles.service}>
          <strong>{ticket ? ticket.services.map(service => service.name).join(", ") : serviceSummary(lines)}</strong>
          <span className={classNames(listStyles.status, statusClass(booking.status))}>
            {historyBookingLabel(booking.status, booking.start_at, booking.historyEvidence) ?? bookingStatusLabel(booking.status, booking.no_show_kind)}
          </span>
        </span>
        <span className={listStyles.location}>
          <SalonThumb booking={booking} />
          <span className={listStyles.place}>
            <strong><a href={`/explore/salons/${booking.salon_id}`} className="hover:underline focus-visible:outline-2 focus-visible:outline-brand-orange">{salonName}</a></strong>
            {place ? <span>{place}</span> : null}
          </span>
        </span>
        <span className={listStyles.price}>{ticket ? formatMoney(historyTicketTotals(ticket).total) : `Est. ${formatMoney(totalAmount(lines))}`}</span>
        <span className={listStyles.toggle}>
          <BookingDetailsButton initialOpen={initialOpen} activity={{
            type: "booking", id: `booking-${booking.id}`, bookingId: booking.id,
            href: "/my-bookings", currency: "USD", startAt: booking.start_at,
            endAt: booking.end_at, occurredAt: booking.start_at, timezone,
            status: booking.status === "cancelled" || booking.status === "no_show" ? booking.status : ticket ? "completed" : "upcoming",
            noShowKind: booking.no_show_kind, historyEvidence: booking.historyEvidence,
            salon: { id: booking.salon_id, name: salonName, location: place,
              imageUrl: booking.salon?.logoUrl ?? null, coverUrl: booking.salon?.coverUrl ?? null },
            services: lines.map(line => ({ id: line.id, name: line.service_name_snapshot,
              staffName: line.assignedStaff?.displayName ?? null, lineTotal: Number(line.line_total) })),
            staffName: null, title: serviceSummary(lines), total: totalAmount(lines),
          }} />
        </span>
      </div>
    </div>
  );
}


export function AppLocalCustomerBookings({data,error:initialError,message:initialMessage}:{data:AppLocalBookingsData;error?:string;message?:string}){
const {bookings,tab:scope,historyRows}=data;
const resolvedSearchParams={details:data.details??undefined};
const groupedBookings=groupBookings(bookings);
const result:{ok:true;data:CustomerBookingSummary[]}={ok:true,data:bookings};
const error=messageFromSearch(initialError),message=messageFromSearch(initialMessage);
  return (
    <main className={classNames(styles.bookingSurface, "min-h-screen overflow-x-hidden bg-[#fbf9f7] px-4 py-6 sm:px-6 lg:px-8")}>
      <div className="grid w-full min-w-0 gap-5">
        {message ? (
          <p className="content-surface border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 rounded-none border-y shadow-none">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="content-surface border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 rounded-none border-y shadow-none">
            {error}
          </p>
        ) : null}

        <p className="text-xs text-text-secondary">Appointments here &middot; <Link className="font-bold text-brand-teal" href="/activity">All visits & receipts</Link></p>
        <div className="flex min-w-0 items-center gap-3">
<nav style={{ flex: "1 1 auto", minWidth: 0 }} className="flex gap-6 overflow-x-auto" aria-label="Booking filters">
          {TABS.map((tab) => {
            const active = tab.id === scope;

            return (
              <Link
                className={classNames(
                  "min-h-10 shrink-0 border-b-2 px-1 pt-2 text-sm font-extrabold transition",
                  active
                    ? "border-[#f26f3d] text-[#f26f3d]"
                    : "border-transparent text-[#786d78] hover:text-[#f26f3d]",
                )}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                key={tab.id}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
<ContextualSupport />
</div>

        {!result.ok ? null : bookings.length === 0 ? (
          <section className="content-surface border-[#ffd6c4] bg-white p-6 rounded-none border-y shadow-none">
            <h2 className="text-lg font-extrabold text-[#211c24]">
              No {scope === "upcoming" ? "upcoming" : scope} bookings
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#786d78]">
              Book while signed in or save a guest booking from its secure manage link.
            </p>
            <Link
              className={classNames(styles.primaryButton, "mt-5 px-4")}
              href="/explore"
            >
              Find a salon
            </Link>
          </section>
        ) : scope === "past" && historyRows ? (
          <>
            <ActivityHistoryPanel activities={historyRows} initialSelectedBookingId={resolvedSearchParams.details} />
            {resolvedSearchParams.details && !historyRows.some(activity => activity.type !== "visit" && activity.bookingId === resolvedSearchParams.details) ? bookings.filter(booking => booking.id === resolvedSearchParams.details).map(booking => <BookingRow key={booking.id} booking={booking} initialOpen />) : null}
          </>
        ) : (
          <div className="grid gap-6">
            {groupedBookings.map(([label, group]) => (
              <section className="grid gap-3" key={label}>
                <h2 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#e85f2b]">
                  {label}
                </h2>
                <div className="hidden grid-cols-[2fr_2fr_3fr_1fr_1fr] gap-3 px-4 text-xs font-bold text-text-secondary lg:grid"><span>Date & time</span><span>Services / status</span><span>Location</span><span>Amount</span><span>Details</span></div>
                <div data-continuous-surface className={listStyles.list}>
                  {group.map((booking) => (
                    <BookingRow booking={booking} initialOpen={resolvedSearchParams.details === booking.id} key={booking.id} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

export const AppLocalCustomerReceipt=(()=>{
function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(value);
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "Unavailable";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "R";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function addressLabel(receipt: CustomerActivityReceipt) {
  return [
    receipt.salon.addressLine1,
    receipt.salon.addressLine2,
    [receipt.salon.city, receipt.salon.state].filter(Boolean).join(", "),
    receipt.salon.postalCode,
  ]
    .filter(Boolean)
    .join(" ");
}

function paymentStatusLabel(status: CustomerActivityReceipt["paymentStatus"]) {
  if (status === "paid") {
    return "Paid at salon";
  }

  return status === "partial" ? "Partially paid" : "Unpaid";
}

function SalonHeader({ receipt }: { receipt: CustomerActivityReceipt }) {
  const place = addressLabel(receipt);

  return (
    <section className="content-surface border-border-subtle bg-surface p-4 rounded-none border-y shadow-none">
      <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-brand-orange-soft text-lg font-extrabold text-brand-orange ring-1 ring-border-subtle">
          {receipt.salon.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`${receipt.salon.name} logo`}
              className="h-full w-full object-cover"
              src={receipt.salon.imageUrl}
            />
          ) : (
            initialsFor(receipt.salon.name)
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold leading-tight text-text-primary">
              {receipt.salon.name}
            </h1>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-extrabold text-emerald-800">
              Paid at salon
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-text-secondary">
            Receipt {receipt.ticketNumber}
          </p>
          {place || receipt.salon.phone ? (
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              {[place, receipt.salon.phone].filter(Boolean).join(" / ")}
            </p>
          ) : null}
        </div>
        <div className="content-surface border-border-subtle bg-surface-muted px-4 py-3 sm:text-right rounded-none border-y shadow-none">
          <p className="text-xs font-bold uppercase text-text-muted">
            Paid at salon
          </p>
          <p className="mt-1 text-2xl font-extrabold text-text-primary">
            {formatMoney(receipt.totals.total, receipt.currency)}
          </p>
        </div>
      </div>
    </section>
  );
}

function ServiceLine({
  currency,
  service,
}: {
  currency: string;
  service: CustomerActivityReceiptService;
}) {
  return (
    <li className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-extrabold text-text-primary">
          {service.name}
        </p>
        <p className="mt-1 text-xs font-semibold text-text-secondary">
          {[service.staffName, `Qty ${formatQuantity(service.quantity)}`]
            .filter(Boolean)
            .join(" / ")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 text-sm sm:block sm:text-right">
        <p className="font-semibold text-text-secondary">
          {formatMoney(service.unitPrice, currency)}
        </p>
        <p className="font-extrabold text-text-primary">
          {formatMoney(service.lineTotal, currency)}
        </p>
      </div>
    </li>
  );
}

function TotalsRow({
  emphasis,
  label,
  value,
}: {
  emphasis?: boolean;
  label: string;
  value: string;
}) {
  return (
    <div
      className={classNames(
        "flex justify-between gap-4",
        emphasis && "border-t border-border-subtle pt-3 text-base",
      )}
    >
      <dt
        className={classNames(
          emphasis ? "font-extrabold text-text-primary" : "text-text-secondary",
        )}
      >
        {label}
      </dt>
      <dd className="font-extrabold text-text-primary">{value}</dd>
    </div>
  );
}


return function AppLocalCustomerReceipt({receipt}:AppLocalReceiptData){
  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <Link
          className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/activity"
        >
          Back to Activity
        </Link>

        <SalonHeader receipt={receipt} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <section className="content-surface overflow-hidden border-border-subtle bg-surface rounded-none border-y shadow-none">
            <div className="border-b border-border-subtle px-4 py-4">
              <h2 className="text-lg font-extrabold text-text-primary">
                Services
              </h2>
              <p className="mt-1 text-sm font-semibold text-text-secondary">
                {formatDateTime(receipt.closedAt ?? receipt.openedAt)}
              </p>
            </div>
            {receipt.services.length === 0 ? (
              <p className="px-4 py-6 text-sm font-semibold text-text-secondary">
                No receipt items were found.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {receipt.services.map((service) => (
                  <ServiceLine
                    currency={receipt.currency}
                    key={service.id ?? service.name}
                    service={service}
                  />
                ))}
              </ul>
            )}
          </section>

          <aside className="grid gap-5">
            {receipt.verifiedVisit ? (
              <VisitExperiencePrompt
                countsTowardReputation={
                  receipt.verifiedVisit.countsTowardReputation
                }
                initialBody={receipt.verifiedVisit.experienceBody}
                initialState={receipt.verifiedVisit.experienceState}
                salonName={receipt.salon.name}
                ticketId={receipt.ticketId}
                windowDays={receipt.verifiedVisit.windowDays}
              />
            ) : null}

            <section className="content-surface border-border-subtle bg-surface p-4 rounded-none border-y shadow-none">
              <h2 className="text-lg font-extrabold text-text-primary">
                Receipt total
              </h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <TotalsRow
                  label="Subtotal"
                  value={formatMoney(receipt.totals.subtotal, receipt.currency)}
                />
                <TotalsRow
                  label="Discount"
                  value={formatMoney(
                    receipt.totals.discount_amount,
                    receipt.currency,
                  )}
                />
                <TotalsRow
                  label="Tax"
                  value={formatMoney(
                    receipt.totals.tax_amount,
                    receipt.currency,
                  )}
                />
                <TotalsRow
                  label="Tip"
                  value={formatMoney(
                    receipt.totals.tip_amount,
                    receipt.currency,
                  )}
                />
                <TotalsRow
                  emphasis
                  label="Total"
                  value={formatMoney(receipt.totals.total, receipt.currency)}
                />
                <TotalsRow
                  label="Paid at salon"
                  value={formatMoney(receipt.totals.total, receipt.currency)}
                />
                <TotalsRow
                  label="Status"
                  value={paymentStatusLabel(receipt.paymentStatus)}
                />
              </dl>
            </section>

            <section className="content-surface border-border-subtle bg-surface p-4 rounded-none border-y shadow-none">
              <h2 className="text-lg font-extrabold text-text-primary">
                Recorded payment methods
              </h2>
              {receipt.payments.length === 0 ? (
                <p className="mt-3 text-sm font-semibold text-text-secondary">
                  Payment method was not specified.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border-subtle">
                  {receipt.payments.map((payment) => (
                    <li
                      className="flex justify-between gap-4 py-3 text-sm"
                      key={payment.id ?? `${payment.method}-${payment.createdAt}`}
                    >
                      <span>
                        <span className="block font-extrabold text-text-primary">
                          {payment.label}
                        </span>
                        <span className="block text-xs font-semibold text-text-secondary">
                          {formatDateTime(payment.createdAt)}
                        </span>
                      </span>
                      <span className="font-extrabold text-text-primary">
                        {formatMoney(payment.amount, receipt.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
})();
