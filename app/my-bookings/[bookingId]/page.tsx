import { BookingDetailActions } from "@/app/my-bookings/[bookingId]/booking-detail-actions";
import styles from "@/components/booking-ui/booking-theme.module.css";
import {
  getCustomerBookingDetail,
  type CustomerBookingDetail,
  type CustomerBookingLine,
} from "@/lib/customer-bookings";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type MyBookingDetailPageProps = {
  params: Promise<{
    bookingId: string;
  }>;
  searchParams: Promise<{
    code?: string;
    error?: string;
    message?: string;
  }>;
};

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDate(value: string, timezone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
    weekday: "long",
  }).format(date);
}

function formatTime(value: string | null, timezone: string) {
  if (!value) {
    return "Time not available";
  }

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

function formatTimeRange(startAt: string | null, endAt: string | null, timezone: string) {
  return `${formatTime(startAt, timezone)} - ${formatTime(endAt, timezone)}`;
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

function isChangeable(status: string, startAt: string) {
  if (["cancelled", "completed", "no_show"].includes(status)) {
    return false;
  }

  return new Date(startAt).getTime() > Date.now();
}

function searchMessage(value: string | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function locationLabel(booking: CustomerBookingDetail) {
  return [
    booking.salon?.address_line1,
    [booking.salon?.city, booking.salon?.state].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(" - ");
}

function totalDuration(lines: CustomerBookingLine[]) {
  return lines.reduce((total, line) => total + line.duration_minutes, 0);
}

function totalAmount(lines: CustomerBookingLine[]) {
  return lines.reduce((total, line) => total + Number(line.line_total ?? 0), 0);
}

function paymentLabel(status: string) {
  if (status === "not_required") {
    return null;
  }

  return status.replaceAll("_", " ");
}

function groupLines(lines: CustomerBookingLine[]) {
  const services = lines.filter((line) => line.line_type === "service");
  const addOns = lines.filter((line) => line.line_type === "add_on");
  const groupedIds = new Set<string>();
  const groups = services.map((line) => {
    const children = addOns.filter((addOn) => {
      const belongs = addOn.parent_booking_line_id === line.id;

      if (belongs) {
        groupedIds.add(addOn.id);
      }

      return belongs;
    });

    return { addOns: children, line };
  });
  const orphanAddOns = addOns.filter((line) => !groupedIds.has(line.id));

  return { groups, orphanAddOns };
}

function StaffAvatar({ line }: { line: CustomerBookingLine }) {
  const staff = line.assignedStaff;
  const label = staff?.displayName ?? "Salon professional";

  return (
    <span className="flex items-center gap-2 text-sm text-[#786d78]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f7f2f7] text-xs font-extrabold text-[#642a56]">
        {staff?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${label} profile`}
            className="h-full w-full object-cover"
            src={staff.avatarUrl}
          />
        ) : (
          initialsFor(label)
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-extrabold text-[#211c24]">{label}</span>
        {staff?.jobTitle ? (
          <span className="block truncate text-xs text-[#786d78]">{staff.jobTitle}</span>
        ) : null}
      </span>
    </span>
  );
}

function ServiceLine({
  line,
  addOns = [],
  timezone,
}: {
  addOns?: CustomerBookingLine[];
  line: CustomerBookingLine;
  timezone: string;
}) {
  return (
    <article className="grid gap-3 rounded-2xl border border-[#e7dfe5] bg-white p-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {line.line_type === "add_on" ? (
            <span className="rounded-full bg-[#f7f2f7] px-2 py-1 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#8f4a7b]">
              Add-on
            </span>
          ) : null}
          <h3 className="text-base font-extrabold text-[#211c24]">
            {line.service_name_snapshot}
          </h3>
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          <StaffAvatar line={line} />
          <p className="text-sm font-semibold text-[#786d78]">
            {formatTimeRange(line.scheduled_start_at, line.scheduled_end_at, timezone)}
          </p>
        </div>
        {addOns.length > 0 ? (
          <ul className="mt-3 grid gap-2 rounded-xl bg-[#fbf9f7] p-3">
            {addOns.map((addOn) => (
              <li className="grid gap-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3" key={addOn.id}>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#211c24]">
                    {addOn.service_name_snapshot}
                  </span>
                  <span className="block text-xs text-[#786d78]">
                    {formatTimeRange(addOn.scheduled_start_at, addOn.scheduled_end_at, timezone)}
                  </span>
                </span>
                <span className="font-semibold text-[#211c24] sm:text-right">
                  {formatMoney(addOn.line_total)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-4 text-sm sm:block sm:text-right">
        <p className="font-semibold text-[#786d78]">{line.duration_minutes} min</p>
        <p className="font-extrabold text-[#211c24]">{formatMoney(line.line_total)}</p>
      </div>
    </article>
  );
}

function SalonImage({ booking }: { booking: CustomerBookingDetail }) {
  const salonName = booking.salon?.displayName ?? booking.salon?.name ?? "Reylumi salon";
  const imageUrl = booking.salon?.coverUrl ?? booking.salon?.logoUrl;

  return (
    <div className="relative h-24 overflow-hidden rounded-2xl bg-[#efe8f3] sm:h-32">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${salonName} salon`}
          className="h-full w-full object-cover"
          src={imageUrl}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-2xl font-extrabold text-[#642a56]">
          {initialsFor(salonName)}
        </div>
      )}
      {booking.salon?.logoUrl && booking.salon.coverUrl ? (
        <div className="absolute bottom-3 left-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={`${salonName} logo`} className="h-full w-full object-cover" src={booking.salon.logoUrl} />
        </div>
      ) : null}
    </div>
  );
}

function InspirationSection({ booking }: { booking: CustomerBookingDetail }) {
  const inspiration = booking.inspiration;

  if (!inspiration) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-[#e7dfe5] bg-white p-4">
      <div>
        <h2 className="text-lg font-extrabold text-[#211c24]">Your inspiration</h2>
        <p className="mt-1 text-sm text-[#786d78]">
          Saved from the public look you booked.
        </p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[112px_1fr]">
        <div className="h-28 w-28 overflow-hidden rounded-xl bg-[#f7f2f7]">
          {inspiration.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-full w-full object-cover" src={inspiration.imageUrl} />
          ) : (
            <span className="grid h-full w-full place-items-center text-sm font-extrabold text-[#642a56]">
              Look
            </span>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-extrabold text-[#211c24]">
            {inspiration.source_title_snapshot ?? "Booked look"}
          </h3>
          <p className="mt-2 text-sm font-extrabold text-[#642a56]">
            {[
              inspiration.service_name_snapshot,
              inspiration.credited_staff_name_snapshot
                ? `By ${inspiration.credited_staff_name_snapshot}`
                : null,
            ]
              .filter(Boolean)
              .join(" / ") || "Saved with this booking"}
          </p>
          {inspiration.source_caption_snapshot ? (
            <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#786d78]">
              {inspiration.source_caption_snapshot}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export default async function MyBookingDetailPage({
  params,
  searchParams,
}: MyBookingDetailPageProps) {
  const [{ bookingId }, resolvedSearchParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const result = await getCustomerBookingDetail(bookingId);

  if (!result.ok && result.code === "sign_in_required") {
    redirect(`/login?next=${encodeURIComponent(`/my-bookings/${bookingId}`)}`);
  }

  if (!result.ok || !result.data) {
    notFound();
  }

  const booking = result.data;
  const timezone = booking.salon_timezone_snapshot || "America/Chicago";
  const canChange = isChangeable(booking.status, booking.start_at);
  const lines = (booking.lines ?? []).slice();
  const { groups, orphanAddOns } = groupLines(lines);
  const amount = totalAmount(lines);
  const duration = totalDuration(lines);
  const message = searchMessage(resolvedSearchParams.message);
  const error = searchMessage(resolvedSearchParams.error);
  const payment = paymentLabel(booking.payment_status);
  const isCancelledOrNoShow = booking.status === "cancelled" || booking.status === "no_show";
  const hasBookableService = lines.some(
    (line) => line.line_type === "service" && line.currentServiceBookable,
  );
  const canBookAgain = !canChange && (!isCancelledOrNoShow || hasBookableService);
  const canViewSalon = booking.salon?.publicDiscoveryEnabled === true;
  const salonName = booking.salon?.displayName ?? booking.salon?.name ?? "Reylumi salon";
  const place = locationLabel(booking);

  return (
    <main className={classNames(styles.bookingSurface, "min-h-screen bg-[#fbf9f7] px-4 py-6 sm:px-6 lg:px-8")}>
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <Link
          className="w-fit rounded-full px-2 py-1 text-sm font-extrabold text-[#642a56] hover:bg-[#f7f2f7]"
          href="/my-bookings"
        >
          Back to My bookings
        </Link>

        {message ? (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
            {error}
          </p>
        ) : null}

        <section className="rounded-2xl border border-[#e7dfe5] bg-white p-4 shadow-[0_1px_0_rgba(33,28,36,0.03)]">
          <div className="grid gap-4 lg:grid-cols-[280px_1fr] lg:items-center">
            <SalonImage booking={booking} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={classNames("rounded-full border px-3 py-1 text-xs font-extrabold capitalize", statusClass(booking.status))}>
                  {statusText(booking.status)}
                </span>
                {booking.status === "pending" || booking.confirmation_status === "requested" ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-800">
                    Awaiting confirmation
                  </span>
                ) : null}
              </div>
              <h1 className="mt-3 text-2xl font-extrabold leading-tight text-[#211c24] sm:text-3xl">
                {salonName}
              </h1>
              {place ? (
                <p className="mt-1 text-sm font-semibold text-[#786d78]">{place}</p>
              ) : null}
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <div>
                  <p className="text-lg font-extrabold text-[#211c24]">
                    {formatDate(booking.start_at, timezone)}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#786d78]">
                    {formatTimeRange(booking.start_at, booking.end_at, timezone)}
                    {timezone ? ` ${timezone}` : ""}
                  </p>
                </div>
                <p className="text-sm font-extrabold text-[#642a56]">
                  {duration} min / {formatMoney(amount)}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="grid gap-5">
            <InspirationSection booking={booking} />

            <section className="grid gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-[#211c24]">
                  Appointment details
                </h2>
                <p className="mt-1 text-sm text-[#786d78]">
                  Services and professionals reserved for this visit.
                </p>
              </div>

              {groups.map(({ addOns, line }) => (
                <ServiceLine
                  addOns={addOns}
                  key={line.id}
                  line={line}
                  timezone={timezone}
                />
              ))}
              {orphanAddOns.map((line) => (
                <ServiceLine key={line.id} line={line} timezone={timezone} />
              ))}
            </section>

            <section className="rounded-2xl border border-[#e7dfe5] bg-white p-4">
              <h2 className="text-base font-extrabold text-[#211c24]">Visit total</h2>
              <dl className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#786d78]">Estimated duration</dt>
                  <dd className="font-extrabold text-[#211c24]">{duration} min</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#786d78]">Total</dt>
                  <dd className="font-extrabold text-[#211c24]">{formatMoney(amount)}</dd>
                </div>
                {payment ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-[#786d78]">Payment</dt>
                    <dd className="font-extrabold capitalize text-[#211c24]">{payment}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>

          <BookingDetailActions
            booking={booking}
            canBookAgain={canBookAgain}
            canChange={canChange}
            canViewSalon={canViewSalon}
          />
        </div>
      </div>
    </main>
  );
}
