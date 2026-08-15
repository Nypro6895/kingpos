import {
  getCustomerActivity,
  type CustomerActivity,
  type CustomerActivityData,
  type CustomerActivitySalon,
  type CustomerBookingActivity,
} from "@/lib/customer-activity";
import Link from "next/link";
import { redirect } from "next/navigation";

function classNames(...classes: Array<false | null | string | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency",
  }).format(value);
}

function formatDate(value: string, timezone?: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: timezone,
    year: "numeric",
  }).format(date);
}

function formatTime(value: string, timezone?: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(date);
}

function statusLabel(status: CustomerActivity["status"]) {
  return status === "no_show" ? "No-show" : status.replaceAll("_", " ");
}

function statusClass(status: CustomerActivity["status"]) {
  if (status === "upcoming") {
    return "border-brand-teal/25 bg-brand-teal-soft text-brand-teal";
  }

  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  return "border-zinc-300 bg-zinc-100 text-zinc-700";
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

function SalonAvatar({ salon }: { salon: CustomerActivitySalon }) {
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand-orange-soft text-sm font-extrabold text-brand-orange ring-1 ring-border-subtle">
      {salon.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${salon.name} logo`}
          className="h-full w-full object-cover"
          src={salon.imageUrl}
        />
      ) : (
        initialsFor(salon.name)
      )}
    </span>
  );
}

function ServiceNames({ activity }: { activity: CustomerActivity }) {
  const names = [
    ...new Set(
      activity.services
        .map((service) => service.name)
        .filter((name) => name.trim().length > 0),
    ),
  ];

  return (
    <p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-text-primary">
      {names.length > 0 ? names.join(" / ") : activity.title}
    </p>
  );
}

function ActivityAmount({ activity }: { activity: CustomerActivity }) {
  if (activity.type === "purchase") {
    return (
      <p className="text-base font-extrabold text-text-primary sm:text-right">
        {formatMoney(activity.total, activity.currency)}
      </p>
    );
  }

  if (activity.status === "upcoming") {
    return (
      <p className="text-sm font-extrabold text-brand-teal sm:text-right">
        {formatTime(activity.startAt, activity.timezone)}
      </p>
    );
  }

  return activity.total > 0 ? (
    <p className="text-sm font-extrabold text-text-primary sm:text-right">
      {formatMoney(activity.total, activity.currency)}
    </p>
  ) : null;
}

function ActivityCard({ activity }: { activity: CustomerActivity }) {
  const timezone =
    activity.type === "booking" ? activity.timezone : undefined;
  const dateText = formatDate(activity.occurredAt, timezone);
  const label = activity.type === "purchase" ? "Purchase" : "Booking";

  return (
    <Link
      className="group grid min-h-[116px] gap-3 rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition hover:border-brand-orange/40 hover:shadow-[0_16px_36px_rgba(23,19,22,0.06)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
      href={activity.href}
    >
      <SalonAvatar salon={activity.salon} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-extrabold text-text-primary">
            {activity.salon.name}
          </p>
          <span
            className={classNames(
              "rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize",
              statusClass(activity.status),
            )}
          >
            {statusLabel(activity.status)}
          </span>
        </div>
        <p className="mt-1 text-xs font-bold uppercase text-brand-orange">
          {label} - {dateText}
        </p>
        <ServiceNames activity={activity} />
        {activity.type === "booking" && activity.staffName ? (
          <p className="mt-1 truncate text-sm font-semibold text-text-secondary">
            {activity.staffName}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 sm:grid sm:justify-items-end">
        <ActivityAmount activity={activity} />
        <span className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition group-hover:border-brand-orange/50 group-hover:text-brand-orange">
          {activity.type === "purchase" ? "Receipt" : "Details"}
        </span>
      </div>
    </Link>
  );
}

function UpcomingCard({ booking }: { booking: CustomerBookingActivity }) {
  return (
    <section className="grid gap-3" aria-label="Upcoming appointments">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-brand-teal">
            Upcoming
          </p>
          <h2 className="text-xl font-extrabold text-text-primary">
            Next appointment
          </h2>
        </div>
        <Link
          className="shrink-0 text-sm font-bold text-brand-orange hover:text-brand-orange-hover"
          href="/my-bookings"
        >
          All bookings
        </Link>
      </div>
      <ActivityCard activity={booking} />
    </section>
  );
}

function ActivityHeader({ activity }: { activity?: CustomerActivityData }) {
  const hasActivity = (activity?.totalCount ?? 0) > 0;

  if (!activity || !hasActivity) {
    return null;
  }

  return (
    <section
      aria-label="Activity summary"
      className="grid grid-cols-2 gap-2 sm:ml-auto sm:min-w-64"
    >
      <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3 shadow-sm">
        <p className="text-xs font-bold uppercase text-text-muted">
          Salons
        </p>
        <p className="mt-1 text-2xl font-extrabold text-text-primary">
          {activity.salonCount}
        </p>
      </div>
      <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3 shadow-sm">
        <p className="text-xs font-bold uppercase text-text-muted">
          Items
        </p>
        <p className="mt-1 text-2xl font-extrabold text-text-primary">
          {activity.totalCount}
        </p>
        </div>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section className="grid gap-4 rounded-2xl border border-red-200 bg-red-50 px-5 py-8 shadow-sm">
      <div>
        <p className="text-xs font-bold uppercase text-red-700">Activity</p>
        <h2 className="mt-1 text-2xl font-extrabold text-red-950">
          Activity could not be loaded.
        </h2>
        <p className="mt-2 max-w-xl text-sm font-semibold leading-6 text-red-800">
          {message}
        </p>
      </div>
      <Link
        className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-red-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        href="/activity"
      >
        Retry
      </Link>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="grid gap-4 rounded-2xl border border-dashed border-border-subtle bg-surface px-5 py-10 text-center shadow-sm">
      <p className="text-xs font-bold uppercase text-brand-orange">Activity</p>
      <h2 className="text-2xl font-extrabold text-text-primary">
        No activity yet
      </h2>
      <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
        Appointments and salon visits will appear here after you book or check out
        with a salon using your ReyLUMI profile.
      </p>
      <Link
        className="mx-auto inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href="/explore"
      >
        Explore salons
      </Link>
    </section>
  );
}

export default async function ActivityPage() {
  const result = await getCustomerActivity();

  if (!result.ok && result.code === "sign_in_required") {
    redirect("/login?next=/activity");
  }

  if (!result.ok) {
    return (
      <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-5xl gap-5">
          <ActivityHeader />
          <ErrorState message={result.message} />
        </div>
      </main>
    );
  }

  const activity = result.data;
  const nextAppointment = activity.upcoming[0] ?? null;
  const hasActivity = activity.totalCount > 0;

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl gap-5">
        <ActivityHeader activity={activity} />

        {!hasActivity ? (
          <EmptyState />
        ) : (
          <div className="grid gap-7">
            {nextAppointment ? <UpcomingCard booking={nextAppointment} /> : null}

            <section className="grid gap-3" aria-label="Recent activity">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase text-brand-orange">
                    History
                  </p>
                  <h2 className="text-xl font-extrabold text-text-primary">
                    Recent activity
                  </h2>
                </div>
                <Link
                  className="shrink-0 text-sm font-bold text-brand-orange hover:text-brand-orange-hover"
                  href="/explore"
                >
                  Explore
                </Link>
              </div>

              {activity.history.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border-subtle bg-surface px-4 py-5 text-sm font-semibold text-text-secondary">
                  Completed visits and past appointments will appear here.
                </p>
              ) : (
                <div className="grid gap-3">
                  {activity.history.map((item) => (
                    <ActivityCard activity={item} key={item.id} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
