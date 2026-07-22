"use client";

import { useCustomerShellContext } from "@/app/customer-shell-context";
import type {
  ExploreNotificationItem,
  ExploreUpcomingBooking,
  ExploreUtilityContent,
} from "@/types/explore";
import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

type UtilityIconName =
  | "bell"
  | "calendar"
  | "gift"
  | "message"
  | "percent"
  | "star"
  | "user";

function UtilityIcon({ name }: { name: UtilityIconName }) {
  const common = {
    "aria-hidden": true,
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };
  const paths: Record<UtilityIconName, ReactNode> = {
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </>
    ),
    calendar: (
      <>
        <rect height="18" rx="2" width="18" x="3" y="4" />
        <path d="M16 2v4" />
        <path d="M8 2v4" />
        <path d="M3 10h18" />
      </>
    ),
    gift: (
      <>
        <rect height="13" rx="2" width="18" x="3" y="8" />
        <path d="M12 8v13M3 12h18" />
        <path d="M7.5 8A2.5 2.5 0 1 1 12 6a2.5 2.5 0 1 1 4.5 2" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        <path d="M8 9h8M8 13h5" />
      </>
    ),
    percent: (
      <>
        <path d="m19 5-14 14" />
        <circle cx="7" cy="7" r="2" />
        <circle cx="17" cy="17" r="2" />
      </>
    ),
    star: (
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 22a8 8 0 0 1 16 0" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function dateParts(booking: ExploreUpcomingBooking) {
  const date = new Date(booking.startAt);

  if (Number.isNaN(date.getTime())) {
    return {
      day: "--",
      month: "---",
      range: "Time pending",
    };
  }

  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: booking.salonTimezone,
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    timeZone: booking.salonTimezone,
  }).format(date);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: booking.salonTimezone,
    weekday: "long",
  }).format(date);
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: booking.salonTimezone,
  });
  const end = new Date(booking.endAt);
  const range = Number.isNaN(end.getTime())
    ? `${weekday}, ${timeFormatter.format(date)}`
    : `${weekday}, ${timeFormatter.format(date)} - ${timeFormatter.format(end)}`;

  return { day, month, range };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatStatus(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ") || "Booked";
}

function formatNotificationDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "No date";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function initialsFor(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "K"
  );
}

function notificationIcon(kind: ExploreNotificationItem["kind"]): UtilityIconName {
  if (kind === "booking") {
    return "calendar";
  }

  if (kind === "message") {
    return "message";
  }

  if (kind === "offer") {
    return "percent";
  }

  if (kind === "review") {
    return "star";
  }

  return "bell";
}

function UpcomingBookingCard({
  booking,
  bookingLoadError,
}: {
  booking: ExploreUpcomingBooking | null;
  bookingLoadError: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const date = booking ? dateParts(booking) : null;
  const imageUrl = booking && !imageFailed ? booking.salonImageUrl : null;

  return (
    <section
      className="rounded-[1.15rem] bg-surface-elevated p-4 shadow-[0_12px_36px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80"
      data-testid="upcoming-booking-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">
          Upcoming Booking
        </h2>
        <Link
          className="whitespace-nowrap text-xs font-semibold text-brand-orange hover:text-brand-orange-hover"
          href="/my-bookings"
        >
          View all
        </Link>
      </div>

      {bookingLoadError ? (
        <p className="mt-4 rounded-2xl bg-surface-muted p-4 text-sm leading-6 text-text-secondary">
          Upcoming bookings could not be loaded right now.
        </p>
      ) : booking && date ? (
        <Link
          className="mt-4 grid gap-3 rounded-2xl bg-white text-left transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={booking.bookingHref}
        >
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
            <span className="relative block aspect-square overflow-hidden rounded-2xl bg-surface-muted text-sm font-semibold text-brand-orange">
              {imageUrl ? (
                <Image
                  alt={`${booking.salonName} booking image`}
                  className="object-cover"
                  fill
                  onError={() => setImageFailed(true)}
                  sizes="88px"
                  src={imageUrl}
                />
              ) : (
                <span className="grid h-full w-full place-items-center bg-brand-orange-soft">
                  {initialsFor(booking.salonName)}
                </span>
              )}
            </span>
            <span className="grid min-w-0 content-start gap-2">
              <span className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-primary">
                    {booking.salonName}
                  </span>
                  {booking.salonLocation ? (
                    <span className="mt-0.5 block truncate text-xs text-text-secondary">
                      {booking.salonLocation}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 rounded-full bg-brand-orange-soft px-2 py-1 text-[10px] font-semibold text-brand-orange">
                  {formatStatus(booking.status)}
                </span>
              </span>
              <span className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                <span className="grid h-12 place-items-center rounded-2xl bg-surface-muted text-center text-brand-black">
                  <span>
                    <span className="block text-[10px] font-semibold uppercase text-brand-orange">
                      {date.month}
                    </span>
                    <span className="block text-base font-semibold leading-none">
                      {date.day}
                    </span>
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-text-primary">
                    {date.range}
                  </span>
                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-text-secondary">
                    {booking.serviceSummary}
                  </span>
                </span>
              </span>
            </span>
          </div>
          <div className="grid gap-2 border-t border-divider-subtle px-1 pt-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-secondary">{booking.staffSummary}</span>
              {booking.totalAmount > 0 ? (
                <span className="font-semibold text-text-primary">
                  {formatMoney(booking.totalAmount)}
                </span>
              ) : null}
            </div>
          </div>
        </Link>
      ) : (
        <div className="mt-4 grid gap-4 rounded-2xl bg-surface-muted p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-orange-soft text-brand-orange">
              <UtilityIcon name="calendar" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-primary">
                No upcoming bookings
              </p>
              <p className="mt-1 text-xs leading-5 text-text-secondary">
                Confirmed appointments will appear here.
              </p>
            </div>
          </div>
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-surface-elevated px-4 text-xs font-semibold text-text-primary shadow-sm transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href="/my-bookings"
          >
            Open Bookings
          </Link>
        </div>
      )}
    </section>
  );
}

function RecentNotificationsCard({
  notificationLoadError,
  notifications,
}: {
  notificationLoadError: boolean;
  notifications: ExploreNotificationItem[];
}) {
  return (
    <section
      className="rounded-[1.15rem] bg-surface-elevated p-4 shadow-[0_12px_36px_rgba(35,25,22,0.055)] ring-1 ring-divider-subtle/80"
      data-testid="recent-notifications-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">
          Recent Notifications
        </h2>
        <Link
          className="whitespace-nowrap text-xs font-semibold text-brand-orange hover:text-brand-orange-hover"
          href="/notifications"
        >
          View all
        </Link>
      </div>

      {notificationLoadError ? (
        <p className="mt-4 rounded-2xl bg-surface-muted p-4 text-sm leading-6 text-text-secondary">
          Notifications could not be loaded right now.
        </p>
      ) : notifications.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {notifications.map((item) => (
            <Link
              className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-white px-2.5 py-2 transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              href={item.href}
              key={item.id}
            >
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-teal-soft text-brand-teal">
                <UtilityIcon name={notificationIcon(item.kind)} />
              </span>
              <span className="min-w-0">
                <span className="block line-clamp-2 text-xs font-semibold leading-5 text-text-primary">
                  {item.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-secondary">
                  {item.body ?? formatNotificationDate(item.createdAt)}
                </span>
              </span>
              <span className="grid justify-items-end gap-2">
                {!item.read ? (
                  <span className="h-2 w-2 rounded-full bg-brand-orange" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-divider-subtle" />
                )}
                <span className="text-[10px] text-text-muted">
                  {formatNotificationDate(item.createdAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-4 rounded-2xl bg-surface-muted p-4 text-sm leading-6 text-text-secondary">
          No customer notifications yet.
        </p>
      )}
    </section>
  );
}

export function CustomerExploreUtilityPanel({
  utilityContent,
}: {
  utilityContent: ExploreUtilityContent;
}) {
  const customerShell = useCustomerShellContext();

  if (!customerShell?.isCustomerShell) {
    return null;
  }

  return (
    <aside
      aria-label="Customer utility"
      className="hidden min-h-[calc(100vh-5.25rem)] min-w-0 bg-transparent px-4 py-5 xl:block 2xl:px-5"
      data-testid="customer-desktop-utility"
    >
      <div className="sticky top-[5.25rem] grid gap-5">
        <UpcomingBookingCard
          booking={utilityContent.upcomingBooking}
          bookingLoadError={utilityContent.bookingLoadError}
        />
        <RecentNotificationsCard
          notificationLoadError={utilityContent.notificationLoadError}
          notifications={utilityContent.notifications}
        />

        <section className="overflow-hidden rounded-[1.15rem] bg-[linear-gradient(135deg,var(--brand-teal),#006c68)] text-white shadow-[0_16px_42px_rgba(0,111,107,0.16)]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 p-5">
            <div className="min-w-0">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/14 text-white ring-1 ring-white/22">
                <UtilityIcon name="gift" />
              </span>
              <h2 className="mt-4 text-base font-semibold">Refer & Earn</h2>
              <p className="mt-2 text-sm leading-6 text-white/78">
                Invite friends to discover salons you love. Perks appear when
                they are available for your account.
              </p>
              <Link
                className="mt-4 inline-flex min-h-10 w-fit items-center justify-center rounded-full bg-white px-5 text-xs font-semibold text-brand-teal transition hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                href="/more/memberships"
              >
                View perks
              </Link>
            </div>
            <span className="hidden h-20 w-20 place-items-center rounded-[1.25rem] bg-white/12 text-white ring-1 ring-white/18 2xl:grid">
              <UtilityIcon name="star" />
            </span>
          </div>
        </section>
      </div>
    </aside>
  );
}
