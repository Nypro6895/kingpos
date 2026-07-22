import styles from "@/components/booking-ui/booking-theme.module.css";
import {
  listCustomerBookings,
  type CustomerBookingLine,
  type CustomerBookingListScope,
  type CustomerBookingSummary,
} from "@/lib/customer-bookings";
import Link from "next/link";
import { redirect } from "next/navigation";

type MyBookingsPageProps = {
  searchParams: Promise<{
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

  return "border-[#d7c8d3] bg-[#f7f2f7] text-[#642a56]";
}

function statusText(status: string) {
  return status.replaceAll("_", " ");
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

function staffSummary(lines: CustomerBookingLine[]) {
  const staff = lines
    .map((line) => line.assignedStaff)
    .filter((member, index, all) => member && all.findIndex((item) => item?.id === member.id) === index);

  if (staff.length === 0) {
    return {
      avatarUrl: null,
      label: "Salon professional",
      multiple: false,
    };
  }

  if (staff.length === 1) {
    return {
      avatarUrl: staff[0]?.avatarUrl ?? null,
      label: staff[0]?.displayName ?? "Salon professional",
      multiple: false,
    };
  }

  return {
    avatarUrl: null,
    label: `${staff.length} professionals`,
    multiple: true,
  };
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
    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#efe8f3] text-sm font-extrabold text-[#642a56]">
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

function StaffPill({ lines }: { lines: CustomerBookingLine[] }) {
  const staff = staffSummary(lines);

  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[#786d78]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f7f2f7] text-xs font-extrabold text-[#642a56]">
        {staff.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`${staff.label} profile`} className="h-full w-full object-cover" src={staff.avatarUrl} />
        ) : (
          initialsFor(staff.label)
        )}
      </span>
      <span className="truncate">{staff.label}</span>
    </span>
  );
}

function BookingRow({ booking }: { booking: CustomerBookingSummary }) {
  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const dateParts = formatDateParts(booking.start_at, timezone);
  const lines = booking.lines ?? [];
  const salonName = booking.salon?.displayName ?? booking.salon?.name ?? "Reylumi salon";
  const place = locationLabel(booking);
  const showTimezone = timezone !== "America/Chicago";

  return (
    <Link
      className="group grid gap-4 rounded-2xl border border-[#e7dfe5] bg-white p-4 transition hover:border-[#d7c8d3] hover:shadow-[0_14px_36px_rgba(57,37,52,0.08)] md:grid-cols-[auto_1fr_auto] md:items-center"
      href={`/my-bookings/${booking.id}`}
    >
      <div className="flex items-center gap-3 md:block md:text-center">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#f7f2f7] text-[#642a56] md:mx-auto">
          <span className="text-xs font-extrabold uppercase tracking-[0.12em]">
            {dateParts.month}
          </span>
          <span className="-mt-1 text-2xl font-extrabold leading-none">{dateParts.day}</span>
        </div>
        <span className="text-sm font-extrabold text-[#211c24] md:hidden">
          {dateParts.weekday}
        </span>
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <SalonThumb booking={booking} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-extrabold text-[#211c24]">
                {salonName}
              </h2>
              <span className={classNames("rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize", statusClass(booking.status))}>
                {statusText(booking.status)}
              </span>
            </div>
            {place ? (
              <p className="mt-1 truncate text-sm font-semibold text-[#786d78]">{place}</p>
            ) : null}
            <p className="mt-2 text-sm font-extrabold text-[#211c24]">
              {dateParts.weekday}, {formatTime(booking.start_at, timezone)} -{" "}
              {formatTime(booking.end_at, timezone)}
              {showTimezone ? ` ${timezone}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0">
            <p className="truncate text-sm font-extrabold text-[#211c24]">
              {serviceSummary(lines)}
            </p>
            <div className="mt-2">
              <StaffPill lines={lines} />
            </div>
          </div>
          <p className="text-sm font-extrabold text-[#642a56]">
            {formatMoney(totalAmount(lines))}
          </p>
        </div>
      </div>

      <span className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[#d7c8d3] px-4 text-sm font-extrabold text-[#211c24] transition group-hover:border-[#8f4a7b] group-hover:text-[#642a56]">
        View details
      </span>
    </Link>
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
  const groupedBookings = groupBookings(bookings);
  const error = messageFromSearch(resolvedSearchParams.error);
  const message = messageFromSearch(resolvedSearchParams.message);

  return (
    <main className={classNames(styles.bookingSurface, "min-h-screen overflow-x-hidden bg-[#fbf9f7] px-4 py-6 sm:px-6 lg:px-8")}>
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <header className="flex flex-col gap-4 border-b border-[#e7dfe5] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold leading-tight text-[#211c24]">
              Bookings
            </h1>
            <p className="mt-2 text-sm font-semibold text-[#786d78]">
              Your appointments across all salons.
            </p>
          </div>
          <Link className={classNames(styles.secondaryButton, "w-fit px-4")} href="/explore">
            Explore salons
          </Link>
        </header>

        {message ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </p>
        ) : null}
        {error || (!result.ok && result.message) ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {error ?? (!result.ok ? result.message : null)}
          </p>
        ) : null}

        <nav className="flex gap-6 overflow-x-auto" aria-label="Booking filters">
          {TABS.map((tab) => {
            const active = tab.id === scope;

            return (
              <Link
                className={classNames(
                  "min-h-10 shrink-0 border-b-2 px-1 pt-2 text-sm font-extrabold transition",
                  active
                    ? "border-[#642a56] text-[#642a56]"
                    : "border-transparent text-[#786d78] hover:text-[#642a56]",
                )}
                href={tab.href}
                key={tab.id}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {bookings.length === 0 ? (
          <section className="rounded-2xl border border-dashed border-[#d7c8d3] bg-white p-6">
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
        ) : (
          <div className="grid gap-6">
            {groupedBookings.map(([label, group]) => (
              <section className="grid gap-3" key={label}>
                <h2 className="text-sm font-extrabold uppercase tracking-[0.12em] text-[#8f4a7b]">
                  {label}
                </h2>
                <div className="grid gap-3">
                  {group.map((booking) => (
                    <BookingRow booking={booking} key={booking.id} />
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
