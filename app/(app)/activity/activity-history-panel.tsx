"use client";
import { bookingStatusLabel } from "@/lib/booking-no-show";

import { HistoryDetailsDrawer } from "@/app/activity/history-details-drawer";
import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  CustomerActivity,
  CustomerActivitySalon,
} from "@/lib/customer-activity";
import { searchTextMatches } from "@/lib/search-normalization";

const PAGE_SIZE = 10;

type ActivityTypeFilter = "all" | CustomerActivity["type"];
type ActivityStatusFilter = "all" | CustomerActivity["status"];

type ActivityHistoryPanelProps = {
  activities: CustomerActivity[];
  initialSelectedBookingId?: string;
};

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

function formatMonth(value: string, timezone?: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: timezone,
    year: "numeric",
  }).format(date);
}

function monthKey(value: string, timezone?: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";

  return `${year}-${month}`;
}

function statusLabel(status: CustomerActivity["status"]) {
  return status === "completed" ? "Visited" : status === "past_appointment" ? "Past" : status === "no_show" ? "No-show" : status === "checked_in" ? "Checked in" : status === "in_service" ? "In service" : status === "upcoming" ? "Upcoming" : "Cancelled";
}

function rowStatus(activity: CustomerActivity) {
  return activity.type === "booking" && activity.status === "no_show" && activity.noShowKind === "excused" ? "No-show · Reason" : statusLabel(activity.status);
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

function SalonLogo({ salon }: { salon: CustomerActivitySalon }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand-orange-soft text-[10px] font-extrabold text-brand-orange ring-1 ring-border-subtle md:h-8 md:w-8 md:rounded-xl md:text-xs">
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

function activityTimezone(activity: CustomerActivity) {
  return activity.timezone;
}

function activityTypeLabel(activity: CustomerActivity) {
  return activity.type === "purchase" ? (activity.bookingId ? "Booking · Visit" : "Visit") : activity.type === "visit" ? "Check-in" : "Booking";
}

function SalonIdentity({ activity }: { activity: CustomerActivity }) {
  return <div className="flex min-w-0 items-center gap-2">
    <SalonLogo salon={activity.salon} />
    <div className="min-w-0">
      <p className="truncate text-sm">{activity.salon.name}</p>
      <p className="mt-0.5 text-[11px] text-text-secondary md:mt-1 md:text-xs">{activityTypeLabel(activity)}</p>
    </div>
  </div>;
}

function ActivityDate({ activity, compact = false }: { activity: CustomerActivity; compact?: boolean }) {
  const value = activity.type === "booking" ? activity.startAt : activity.type === "purchase" && activity.appointmentStartAt ? activity.appointmentStartAt : activity.occurredAt;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-xs text-text-secondary">Date unavailable</span>;
  const timezone = activityTimezone(activity);
  const parts = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", weekday: "short", year: "numeric", timeZone: timezone }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return <time dateTime={value} aria-label={activityDateText(activity)} className={compact ? "grid justify-items-start gap-1" : "flex items-center gap-2.5"}>
    <span aria-hidden="true" className="grid h-10 w-9 shrink-0 content-center rounded-lg bg-brand-orange-soft text-center text-brand-orange md:h-14 md:w-12 md:rounded-xl">
      <span className="text-[9px] font-semibold uppercase tracking-wider md:text-[10px]">{part("month")}</span>
      <span className="text-lg font-semibold leading-tight md:text-[23px]">{part("day")}</span>
    </span>
    <span aria-hidden="true" className={compact ? "grid gap-0.5 text-[10px] text-text-secondary" : "grid gap-1 text-xs text-text-secondary"}>
      <span>{part("weekday")} · {part("year")}</span>
      <span className="text-text-primary">{formatTime(value, timezone)}</span>
    </span>
  </time>;
}

function serviceNames(activity: CustomerActivity) {
  return [
    ...new Set(
      activity.services
        .map((service) => service.name)
        .filter((name) => name.trim().length > 0),
    ),
  ];
}

function servicesLabel(activity: CustomerActivity) {
  const names = serviceNames(activity);

  return names.length > 0 ? names.join(" / ") : activity.title;
}

function activityDateText(activity: CustomerActivity) {
  const timezone = activityTimezone(activity);
  const date = formatDate(activity.occurredAt, timezone);

  if (activity.type === "booking") {
    return `${date}, ${formatTime(activity.startAt, timezone)}`;
  }

  return activity.type === "purchase" && activity.appointmentStartAt ? `${formatDate(activity.appointmentStartAt, timezone)}, ${formatTime(activity.appointmentStartAt, timezone)}` : `${date}, ${formatTime(activity.occurredAt, timezone)}`;
}

function activityAmountText(activity: CustomerActivity) {
  if (activity.type === "purchase" || activity.total > 0) {
    return `${activity.type === "booking" ? "Est. " : ""}${formatMoney(activity.total, activity.currency)}`;
  }

  return "-";
}

function activitySearchText(activity: CustomerActivity) {
  const timezone = activityTimezone(activity);
  const people =
    activity.type === "booking"
      ? [activity.staffName]
      : activity.services.map((service) => service.staffName);
  const ids =
    activity.type === "purchase"
      ? [activity.ticketNumber]
      : activity.type === "booking" ? [activity.bookingId] : [activity.id];

  return [
    activity.salon.name,
    activity.salon.location,
    activity.title,
    activityTypeLabel(activity),
    (activity.type === "booking" && activity.status === "no_show" ? bookingStatusLabel(activity.status, activity.noShowKind) : statusLabel(activity.status)),
    formatDate(activity.occurredAt, timezone),
    formatMonth(activity.occurredAt, timezone),
    activity.occurredAt.slice(0, 10),
    ...serviceNames(activity),
    ...people,
    ...ids,
  ]
    .filter(Boolean)
    .join(" ");
}

function activityMatchesQuery(activity: CustomerActivity, query: string) {
  return searchTextMatches([activitySearchText(activity)], query);
}

function selectClassName() {
  return "h-11 rounded-xl border border-border-subtle bg-white px-3 text-sm font-bold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10";
}

type HistoryRowProps = { activity: CustomerActivity; onDetails: (activity: CustomerActivity) => void };

function DetailsButton({ activity, onDetails }: HistoryRowProps) {
  return <button type="button" onClick={() => onDetails(activity)} className="inline-flex min-h-8 items-center justify-center rounded-lg border border-border-subtle px-2.5 text-xs transition hover:border-brand-orange/50 hover:text-brand-orange md:min-h-9 md:px-3 md:text-sm">Details</button>;
}

function ActivityMobileRow({ activity, onDetails }: HistoryRowProps) {
  return <article className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-divider-subtle px-3 py-3 last:border-b-0">
    <ActivityDate activity={activity} compact />
    <div className="grid min-w-0 gap-2">
      <SalonIdentity activity={activity} />
      <p className="line-clamp-2 text-sm" title={servicesLabel(activity)}>{servicesLabel(activity)}</p>
    </div>
    <div className="grid max-w-24 justify-items-end gap-1.5 text-right">
      <p className="text-xs">{activityAmountText(activity)}</p>
      <span className="text-xs text-text-secondary">{rowStatus(activity)}</span>
      <DetailsButton activity={activity} onDetails={onDetails} />
    </div>
  </article>;
}

function ActivityDesktopRow({ activity, onDetails }: HistoryRowProps) {
  return <tr className="transition hover:bg-surface-muted/70">
    <td className="px-4 py-3 align-middle"><ActivityDate activity={activity} /></td>
    <td className="px-4 py-3 align-middle"><SalonIdentity activity={activity} /></td>
    <td className="px-4 py-3 align-middle"><p className="line-clamp-2 text-sm">{servicesLabel(activity)}</p>{activity.type === "booking" && activity.staffName ? <p className="mt-1 text-xs text-text-secondary">{activity.staffName}</p> : null}</td>
    <td className="px-4 py-3 align-middle text-xs text-text-secondary">{rowStatus(activity)}</td>
    <td className="px-4 py-3 text-right align-middle text-sm whitespace-nowrap">{activityAmountText(activity)}</td>
    <td className="px-4 py-3 text-right align-middle"><DetailsButton activity={activity} onDetails={onDetails} /></td>
  </tr>;
}

export function ActivityHistoryPanel({ activities, initialSelectedBookingId }: ActivityHistoryPanelProps) {
  const [selectedActivity, setSelectedActivity] = useState<CustomerActivity | null>(() => initialSelectedBookingId ? activities.find(activity => activity.type !== "visit" && activity.bookingId === initialSelectedBookingId) ?? null : null);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<ActivityStatusFilter>("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [page, setPage] = useState(1);

  const monthOptions = useMemo(() => {
    const options = new Map<string, string>();

    for (const activity of activities) {
      const timezone = activityTimezone(activity);
      const key = monthKey(activity.occurredAt, timezone);

      if (!options.has(key)) {
        options.set(key, formatMonth(activity.occurredAt, timezone));
      }
    }

    return Array.from(options, ([value, label]) => ({ label, value }));
  }, [activities]);

  const filteredActivities = useMemo(
    () =>
      activities.filter((activity) => {
        const timezone = activityTimezone(activity);

        return (
          (typeFilter === "all" || activity.type === typeFilter) &&
          (statusFilter === "all" || activity.status === statusFilter) &&
          (monthFilter === "all" ||
            monthKey(activity.occurredAt, timezone) === monthFilter) &&
          activityMatchesQuery(activity, query)
        );
      }),
    [activities, monthFilter, query, statusFilter, typeFilter],
  );

  const pageCount = Math.max(1, Math.ceil(filteredActivities.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const visibleActivities = filteredActivities.slice(
    startIndex,
    startIndex + PAGE_SIZE,
  );
  const hasFilters =
    query.trim().length > 0 ||
    typeFilter !== "all" ||
    statusFilter !== "all" ||
    monthFilter !== "all";

  function resetPage() {
    setPage(1);
  }

  function clearFilters() {
    setQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
    setMonthFilter("all");
    setPage(1);
  }

  return (
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

      {activities.length === 0 ? (
        <p className="content-surface border-border-subtle bg-surface px-4 py-5 text-sm font-semibold text-text-secondary rounded-none border-y shadow-none">
          Completed visits and past appointments will appear here.
        </p>
      ) : (
        <div className="content-surface overflow-hidden border-border-subtle bg-surface rounded-none border-y shadow-none">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 border-b border-divider-subtle bg-surface px-4 py-3 sm:grid-cols-1 sm:gap-3 sm:py-4 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end">
            <label className="grid gap-1.5">
              <span className="text-xs font-bold uppercase text-text-muted">
                Search history
              </span>
              <input
                className="h-11 rounded-xl border border-border-subtle bg-white px-3 text-sm font-semibold text-text-primary outline-none transition placeholder:text-text-muted focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10"
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  resetPage();
                }}
                placeholder="Search salon, date, or service"
                type="search"
                value={query}
              />
            </label>
            <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)} className="min-h-11 px-1 text-xs font-bold text-brand-teal sm:hidden">Filters</button>
            <div className={classNames(filtersOpen ? "grid" : "hidden", "col-span-2 grid-cols-2 gap-2 sm:col-span-1 sm:grid sm:grid-cols-3")}>
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase text-text-muted">
                  Type
                </span>
                <select
                  className={selectClassName()}
                  onChange={(event) => {
                    setTypeFilter(event.currentTarget.value as ActivityTypeFilter);
                    resetPage();
                  }}
                  value={typeFilter}
                >
                  <option value="all">All activity</option>
                  <option value="purchase">Salon visits</option>
                  <option value="visit">Check-ins</option>
                  <option value="booking">Bookings</option>
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase text-text-muted">
                  Status
                </span>
                <select
                  className={selectClassName()}
                  onChange={(event) => {
                    setStatusFilter(
                      event.currentTarget.value as ActivityStatusFilter,
                    );
                    resetPage();
                  }}
                  value={statusFilter}
                >
                  <option value="all">All statuses</option>
                  <option value="completed">Visited</option>
                  <option value="past_appointment">Past</option>
                  <option value="checked_in">Checked in</option>
                  <option value="in_service">In service</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_show">No-show</option>
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase text-text-muted">
                  Date
                </span>
                <select
                  className={selectClassName()}
                  onChange={(event) => {
                    setMonthFilter(event.currentTarget.value);
                    resetPage();
                  }}
                  value={monthFilter}
                >
                  <option value="all">All dates</option>
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

            </div>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[880px] w-full table-fixed text-left text-sm">
              <thead className="bg-surface-muted text-xs font-bold uppercase text-text-muted">
                <tr>
                  <th className="w-[21%] px-4 py-3">Date & time</th>
                  <th className="w-[20%] px-4 py-3">Salon</th>
                  <th className="w-[25%] px-4 py-3">Services</th>
                  <th className="w-[12%] px-4 py-3">Status</th>
                  <th className="w-[12%] px-4 py-3 text-right">Amount</th>
                  <th className="w-[10%] px-4 py-3 text-right"><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider-subtle">
                {visibleActivities.map((activity) => (
                  <ActivityDesktopRow activity={activity} onDetails={setSelectedActivity} key={activity.id} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {visibleActivities.map((activity) => (
              <ActivityMobileRow activity={activity} onDetails={setSelectedActivity} key={activity.id} />
            ))}
          </div>

          {visibleActivities.length === 0 ? (
            <div className="border-t border-divider-subtle px-4 py-8 text-center">
              <p className="text-sm font-extrabold text-text-primary">
                No matching activity
              </p>
              <p className="mt-1 text-sm font-semibold text-text-secondary">
                Try another salon, date, or service.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-divider-subtle bg-surface px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold text-text-secondary">
              Showing{" "}
              <span className="font-extrabold text-text-primary">
                {visibleActivities.length === 0 ? 0 : startIndex + 1}-
                {Math.min(startIndex + visibleActivities.length, filteredActivities.length)}
              </span>{" "}
              of{" "}
              <span className="font-extrabold text-text-primary">
                {filteredActivities.length}
              </span>{" "}
              history items
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {hasFilters ? (
                <button
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle px-3 text-sm font-bold text-text-secondary transition hover:border-brand-orange/50 hover:text-brand-orange"
                  onClick={clearFilters}
                  type="button"
                >
                  Clear
                </button>
              ) : null}
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle px-3 text-sm font-bold text-text-primary transition hover:border-brand-orange/50 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-45"
                disabled={currentPage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                type="button"
              >
                Previous
              </button>
              <span className="px-1 text-sm font-bold text-text-secondary">
                Page {currentPage} of {pageCount}
              </span>
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle px-3 text-sm font-bold text-text-primary transition hover:border-brand-orange/50 hover:text-brand-orange disabled:cursor-not-allowed disabled:opacity-45"
                disabled={currentPage >= pageCount}
                onClick={() =>
                  setPage((value) => Math.min(pageCount, value + 1))
                }
                type="button"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
      {selectedActivity ? <HistoryDetailsDrawer key={selectedActivity.id} activity={selectedActivity} onClose={() => setSelectedActivity(null)} /> : null}
    </section>
  );
}
