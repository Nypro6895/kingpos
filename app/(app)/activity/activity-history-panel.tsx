"use client";

import { VisitExperiencePrompt } from "@/app/activity/visit-experience-prompt";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type {
  CustomerActivity,
  CustomerActivitySalon,
} from "@/lib/customer-activity";

const PAGE_SIZE = 10;

type ActivityTypeFilter = "all" | CustomerActivity["type"];
type ActivityStatusFilter = "all" | CustomerActivity["status"];

type ActivityHistoryPanelProps = {
  activities: CustomerActivity[];
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
  return status === "no_show" ? "No-show" : status.replaceAll("_", " ");
}

function statusClass(status: CustomerActivity["status"]) {
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

function SalonLogo({ salon }: { salon: CustomerActivitySalon }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-orange-soft text-xs font-extrabold text-brand-orange ring-1 ring-border-subtle">
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
  return activity.type === "booking" ? activity.timezone : undefined;
}

function activityTypeLabel(activity: CustomerActivity) {
  return activity.type === "purchase" ? "Purchase" : "Booking";
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

  return date;
}

function activityAmountText(activity: CustomerActivity) {
  if (activity.type === "purchase" || activity.total > 0) {
    return formatMoney(activity.total, activity.currency);
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
      : [activity.bookingId];

  return [
    activity.salon.name,
    activity.title,
    activityTypeLabel(activity),
    statusLabel(activity.status),
    formatDate(activity.occurredAt, timezone),
    formatMonth(activity.occurredAt, timezone),
    activity.occurredAt.slice(0, 10),
    ...serviceNames(activity),
    ...people,
    ...ids,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function activityMatchesQuery(activity: CustomerActivity, query: string) {
  const normalized = query.trim().toLowerCase();

  return !normalized || activitySearchText(activity).includes(normalized);
}

function verifiedVisitPrompt(activity: CustomerActivity) {
  if (
    activity.type !== "purchase" ||
    !activity.verifiedVisit ||
    activity.verifiedVisit.experienceState
  ) {
    return null;
  }

  return (
    <VisitExperiencePrompt
      compact
      countsTowardReputation={activity.verifiedVisit.countsTowardReputation}
      initialBody={activity.verifiedVisit.experienceBody}
      initialState={activity.verifiedVisit.experienceState}
      salonName={activity.salon.name}
      ticketId={activity.ticketId}
      windowDays={activity.verifiedVisit.windowDays}
    />
  );
}

function selectClassName() {
  return "h-11 rounded-xl border border-border-subtle bg-white px-3 text-sm font-bold text-text-primary outline-none transition focus:border-brand-orange focus:ring-4 focus:ring-brand-orange/10";
}

function ActivityMobileRow({ activity }: { activity: CustomerActivity }) {
  const prompt = verifiedVisitPrompt(activity);

  return (
    <article className="grid gap-3 border-b border-divider-subtle px-4 py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <SalonLogo salon={activity.salon} />
          <div className="min-w-0">
            <Link
              className="truncate text-sm font-extrabold text-text-primary hover:text-brand-orange"
              href={activity.href}
            >
              {activity.salon.name}
            </Link>
            <p className="mt-1 text-xs font-bold uppercase text-brand-orange">
              {activityTypeLabel(activity)}
            </p>
          </div>
        </div>
        <span
          className={classNames(
            "shrink-0 rounded-full border px-2 py-1 text-[11px] font-extrabold capitalize",
            statusClass(activity.status),
          )}
        >
          {statusLabel(activity.status)}
        </span>
      </div>
      <div className="grid gap-1 text-sm">
        <p className="font-bold text-text-primary">{servicesLabel(activity)}</p>
        <p className="font-semibold text-text-secondary">
          {activityDateText(activity)}
        </p>
        {activity.type === "booking" && activity.staffName ? (
          <p className="font-semibold text-text-secondary">
            {activity.staffName}
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-extrabold text-text-primary">
          {activityAmountText(activity)}
        </p>
        <Link
          className="inline-flex min-h-9 items-center justify-center rounded-full border border-border-subtle px-3 text-sm font-bold text-text-primary transition hover:border-brand-orange/50 hover:text-brand-orange"
          href={activity.href}
        >
          {activity.type === "purchase" ? "Receipt" : "Details"}
        </Link>
      </div>
      {activity.type === "purchase" && activity.verifiedVisit ? (
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-800">
            Verified Visit
          </span>
        </div>
      ) : null}
      {prompt}
    </article>
  );
}

function ActivityDesktopRow({ activity }: { activity: CustomerActivity }) {
  const prompt = verifiedVisitPrompt(activity);

  return (
    <Fragment>
      <tr className="transition hover:bg-surface-muted/70">
        <td className="px-4 py-3 align-middle">
          <div className="flex min-w-0 items-center gap-3">
            <SalonLogo salon={activity.salon} />
            <div className="min-w-0">
              <Link
                className="block truncate font-extrabold text-text-primary hover:text-brand-orange"
                href={activity.href}
              >
                {activity.salon.name}
              </Link>
              <p className="mt-0.5 text-xs font-bold uppercase text-brand-orange">
                {activityTypeLabel(activity)}
              </p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3 align-middle">
          <span
            className={classNames(
              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold capitalize",
              statusClass(activity.status),
            )}
          >
            {statusLabel(activity.status)}
          </span>
          {activity.type === "purchase" && activity.verifiedVisit ? (
            <span className="mt-1 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-extrabold text-emerald-800">
              Verified Visit
            </span>
          ) : null}
        </td>
        <td className="px-4 py-3 align-middle text-sm font-semibold text-text-secondary">
          {activityDateText(activity)}
        </td>
        <td className="max-w-[18rem] px-4 py-3 align-middle">
          <p className="line-clamp-2 text-sm font-bold leading-5 text-text-primary">
            {servicesLabel(activity)}
          </p>
          {activity.type === "booking" && activity.staffName ? (
            <p className="mt-1 truncate text-xs font-semibold text-text-secondary">
              {activity.staffName}
            </p>
          ) : null}
        </td>
        <td className="px-4 py-3 text-right align-middle text-sm font-extrabold text-text-primary">
          {activityAmountText(activity)}
        </td>
        <td className="px-4 py-3 text-right align-middle">
          <Link
            className="inline-flex min-h-9 items-center justify-center rounded-full border border-border-subtle px-3 text-sm font-bold text-text-primary transition hover:border-brand-orange/50 hover:text-brand-orange"
            href={activity.href}
          >
            {activity.type === "purchase" ? "Receipt" : "Details"}
          </Link>
        </td>
      </tr>
      {prompt ? (
        <tr>
          <td className="bg-surface-muted/40 px-4 pb-4" colSpan={6}>
            {prompt}
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

export function ActivityHistoryPanel({ activities }: ActivityHistoryPanelProps) {
  const [query, setQuery] = useState("");
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
        <p className="rounded-2xl border border-dashed border-border-subtle bg-surface px-4 py-5 text-sm font-semibold text-text-secondary">
          Completed visits and past appointments will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
          <div className="grid gap-3 border-b border-divider-subtle bg-surface px-4 py-4 lg:grid-cols-[minmax(18rem,1fr)_auto] lg:items-end">
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
            <div className="grid gap-2 sm:grid-cols-4">
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
                  <option value="purchase">Purchases</option>
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
                  <option value="completed">Completed</option>
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
              <label className="grid gap-1.5">
                <span className="text-xs font-bold uppercase text-text-muted">
                  Rows
                </span>
                <select
                  className={selectClassName()}
                  defaultValue={PAGE_SIZE}
                  disabled
                >
                  <option value={PAGE_SIZE}>10 per page</option>
                </select>
              </label>
            </div>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[880px] w-full table-fixed text-left text-sm">
              <thead className="bg-surface-muted text-xs font-bold uppercase text-text-muted">
                <tr>
                  <th className="w-[22%] px-4 py-3">Salon</th>
                  <th className="w-[13%] px-4 py-3">Status</th>
                  <th className="w-[17%] px-4 py-3">Date</th>
                  <th className="w-[25%] px-4 py-3">Services</th>
                  <th className="w-[11%] px-4 py-3 text-right">Total</th>
                  <th className="w-[12%] px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider-subtle">
                {visibleActivities.map((activity) => (
                  <ActivityDesktopRow activity={activity} key={activity.id} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden">
            {visibleActivities.map((activity) => (
              <ActivityMobileRow activity={activity} key={activity.id} />
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
    </section>
  );
}
