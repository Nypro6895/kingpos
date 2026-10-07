import { ActivityHistoryPanel } from "@/app/(app)/activity/activity-history-panel";
import { getCustomerActivity } from "@/lib/customer-activity";
import { BookingDetailsButton } from "@/app/my-bookings/booking-details-button";
import { historyBookingLabel, historyTicketTotals } from "@/lib/booking-history";
import { bookingStatusLabel } from "@/lib/booking-no-show";
import listStyles from "./booking-list.module.css";
import styles from "@/components/booking-ui/booking-theme.module.css";
import {
  listCustomerBookings,
  getCustomerBookingDetail,
  type CustomerBookingLine,
  type CustomerBookingListScope,
  type CustomerBookingSummary,
} from "@/lib/customer-bookings";
import Link from "next/link";
import { redirect } from "next/navigation";

type MyBookingsPageProps = {
  searchParams: Promise<{
    details?: string;
    error?: string;
    message?: string;
    tab?: string;
  }>;
};

const TABS: Array<{
  href: string;
  id: CustomerBookingListScope;
  label: string;
}> = [
  { href: "/my-bookings", id: "upcoming", label: "Upcoming" },
  { href: "/my-bookings?tab=past", id: "past", label: "Past" },
  { href: "/my-bookings?tab=cancelled", id: "cancelled", label: "Cancelled" },
];

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function getScope(value: string | undefined): CustomerBookingListScope {
  return value === "past" || value === "cancelled" ? value : "upcoming";
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
            <strong>{salonName}</strong>
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

export default async function MyBookingsPage({
  searchParams,
}: MyBookingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const scope = getScope(resolvedSearchParams.tab);
  const result = await listCustomerBookings({ scope });

  if (!result.ok && result.code === "sign_in_required") {
    redirect("/login?next=/my-bookings");
  }

  const bookings = result.ok ? result.data : [];
  if (result.ok && resolvedSearchParams.details && !bookings.some(booking => booking.id === resolvedSearchParams.details)) {
    const selected = await getCustomerBookingDetail(resolvedSearchParams.details);
    if (selected.ok && selected.data) bookings.push(selected.data);
  }
  const groupedBookings = groupBookings(bookings);
  const activityResult = scope === "past" && result.ok ? await getCustomerActivity({ limit: 50 }) : null;
  const historyRows = activityResult?.ok ? activityResult.data.history.filter(activity => {
    if (activity.type === "booking") return bookings.some(booking => booking.id === activity.bookingId);
    if (activity.type === "purchase" && activity.bookingId) return bookings.some(booking => booking.id === activity.bookingId);
    return bookings.some(booking => booking.salon_id === activity.salon.id &&
      new Intl.DateTimeFormat("en-CA", { timeZone: booking.salon_timezone_snapshot }).format(new Date(booking.start_at)) ===
      new Intl.DateTimeFormat("en-CA", { timeZone: booking.salon_timezone_snapshot }).format(new Date(activity.occurredAt)));
  }) : null;
  const error = messageFromSearch(resolvedSearchParams.error);
  const message = messageFromSearch(resolvedSearchParams.message);

  return (
    <main className={classNames(styles.bookingSurface, "min-h-screen overflow-x-hidden bg-[#fbf9f7] px-4 py-6 sm:px-6 lg:px-8")}>
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        {message ? (
          <p className="content-surface border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 rounded-none border-y shadow-none">
            {message}
          </p>
        ) : null}
        {error || (!result.ok && result.message) ? (
          <p className="content-surface border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 rounded-none border-y shadow-none">
            {error ?? (!result.ok ? result.message : null)}
          </p>
        ) : null}

        <p className="text-xs text-text-secondary">Appointments here ? <Link className="font-bold text-brand-teal" href="/activity">All visits & receipts</Link></p>
        <nav className="flex gap-6 overflow-x-auto" aria-label="Booking filters">
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
