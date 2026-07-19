"use client";

import {
  createBookingPosTicketAction,
  createOwnerAppointmentAction,
  reassignOwnerBookingAction,
  rescheduleOwnerBookingAction,
  runBookingStatusAction,
  updateBookingSettingsAction,
  type BookingActionResult,
  type CreateOwnerAppointmentInput,
  type UpdateBookingSettingsInput,
} from "@/app/bookings/actions";
import { StaffAvailabilityEditor } from "@/app/booking-setup/booking-setup-editors";
import type {
  BookingWorkspaceData,
  BookingWorkspaceFilters,
  BookingWorkspaceItem,
  BookingWorkspaceRequest,
} from "@/lib/bookings";
import type { StaffBookingReadiness } from "@/lib/booking-setup";
import type {
  BookingConfirmationMode,
  BookingSource,
  BookingStatusEvent,
  BookingTicketCreationMode,
} from "@/types/booking";
import { BOOKING_SOURCES } from "@/types/booking";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type BookingWorkspaceClientProps = Omit<BookingWorkspaceData, "context"> & {
  organizationName: string;
  publicBookingHref: string;
  salonName: string;
};

type DraftLine = {
  serviceId: string;
  staffId: string;
};

type DraftPrefill = {
  customerUserId?: string | null;
  internalNotes?: string | null;
  serviceId?: string | null;
  source?: BookingSource;
  sourceReferenceId?: string | null;
  sourceReferenceType?: string | null;
  staffId?: string | null;
  startLocal?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  checked_in: "Arrived",
  completed: "Completed",
  confirmed: "Confirmed",
  in_service: "In service",
  no_show: "No-show",
  pending: "Pending",
  scheduled: "Confirmed",
};

const SOURCE_LABELS: Record<BookingSource, string> = {
  explore: "Explore",
  legacy_request: "Legacy request",
  owner_manual: "Owner manual",
  phone: "Phone",
  pos: "POS",
  public_profile: "Public profile",
  staff_manual: "Staff manual",
  walk_in: "Walk-in",
};

const VIEW_LABELS = {
  day: "Day",
  list: "List",
  week: "Week",
} as const;

const styles = {
  avatar: "booking-avatar",
  avatarImage: "booking-avatar-image",
  avatarSmall: "booking-avatar-small",
  bookingSurface: "booking-surface",
  eyebrow: "booking-eyebrow",
  field: "booking-field",
  filterDetails: "booking-filter-details",
  filterMenu: "booking-filter-menu",
  iconButton: "booking-icon-button",
  kpiCard: "booking-kpi-card",
  kpiGrid: "booking-kpi-grid",
  kpiHelper: "booking-kpi-helper",
  kpiIcon: "booking-kpi-icon",
  kpiLabel: "booking-kpi-label",
  kpiValue: "booking-kpi-value",
  ownerContent: "booking-owner-content",
  ownerFrame: "booking-owner-frame",
  ownerHeader: "booking-owner-header",
  ownerRoot: "booking-owner-root",
  pageSubtitle: "booking-page-subtitle",
  pageTitle: "booking-page-title",
  panel: "booking-panel",
  primaryButton: "booking-primary-button",
  searchInput: "booking-search-input",
  secondaryButton: "booking-secondary-button",
  select: "booking-select",
  statusArrived: "booking-status-arrived",
  statusBadge: "booking-status-badge",
  statusChip: "booking-status-chip",
  statusChipActive: "booking-status-chip-active",
  statusConfirmed: "booking-status-confirmed",
  statusInService: "booking-status-in-service",
  statusMuted: "booking-status-muted",
  statusPending: "booking-status-pending",
  statusRow: "booking-status-row",
  tab: "booking-tab",
  tabActive: "booking-tab-active",
  tabCount: "booking-tab-count",
  table: "booking-table",
  tableHeader: "booking-table-header",
  tableRow: "booking-table-row",
  tabs: "booking-tabs",
  toolbar: "booking-toolbar",
  toolbarDate: "booking-toolbar-date",
  workspaceCard: "booking-workspace-card",
} as const;

const TICKET_CREATION_MODE_LABELS: Record<BookingTicketCreationMode, string> = {
  manual: "Manual",
  on_check_in: "On check-in",
  on_service_start: "On service start",
};

function classNames(...classes: (false | null | string | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatMinutes(value: number) {
  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const remaining = value % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function dateParts(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${getPart("year")}-${getPart("month")}-${getPart("day")}`,
    time: `${getPart("hour")}:${getPart("minute")}`,
  };
}

function toLocalInputValue(value: string | null | undefined, timeZone: string) {
  if (!value) {
    return "";
  }

  const parts = dateParts(value, timeZone);
  return `${parts.date}T${parts.time}`;
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number) => value.toString().padStart(2, "0");

  return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(
    utcDate.getUTCDate(),
  )}`;
}

function todayInTimeZone(timeZone: string) {
  return dateParts(new Date().toISOString(), timeZone).date;
}

function timeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    day: getPart("day"),
    hour: getPart("hour"),
    minute: getPart("minute"),
    month: getPart("month"),
    second: getPart("second"),
    year: getPart("year"),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = timeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return asUtc - date.getTime();
}

function zonedDateTimeToUtcIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const firstOffset = timeZoneOffsetMs(utcGuess, timeZone);
  const firstResult = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = timeZoneOffsetMs(firstResult, timeZone);

  return new Date(utcGuess.getTime() - secondOffset).toISOString();
}

function idempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sourceLabel(source: BookingSource) {
  return SOURCE_LABELS[source] ?? source;
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "KP";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function safeImageUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.startsWith("http://") || value.startsWith("https://") ? value : null;
}

function StaffAvatar({
  imageUrl,
  label,
  size = "regular",
}: {
  imageUrl?: string | null;
  label: string | null | undefined;
  size?: "regular" | "small";
}) {
  const src = safeImageUrl(imageUrl);

  return (
    <span
      className={size === "small" ? styles.avatarSmall : styles.avatar}
      title={label ?? "Staff"}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className={styles.avatarImage} src={src} />
      ) : (
        initialsFor(label)
      )}
    </span>
  );
}

function BookingIcon({
  children,
  tone = "plum",
}: {
  children: ReactNode;
  tone?: "amber" | "green" | "plum" | "revenue";
}) {
  const toneClass =
    tone === "green"
      ? "bg-[#e8f6ed] text-[#2f8a57]"
      : tone === "amber"
        ? "bg-[#fff2d8] text-[#d79519]"
        : tone === "revenue"
          ? "bg-[#642a56] text-white"
          : "bg-[#efe8f3] text-[#642a56]";

  return (
    <span
      className={classNames(styles.kpiIcon, toneClass)}
      data-kpi-tone={tone}
      data-testid="booking-owner-kpi-icon"
    >
      {children}
    </span>
  );
}

function selectedDateBookings(
  bookings: BookingWorkspaceItem[],
  date: string,
  timezone: string,
) {
  return bookings.filter(
    (booking) => dateParts(booking.start_at, timezone).date === date,
  );
}

function activeBooking(booking: BookingWorkspaceItem) {
  return (
    booking.normalizedStatus !== "cancelled" &&
    booking.normalizedStatus !== "no_show"
  );
}

function onlineBooking(booking: BookingWorkspaceItem) {
  return booking.source === "explore" || booking.source === "public_profile";
}

function localMinutes(value: string) {
  const [hour, minute] = value.slice(0, 5).split(":").map(Number);
  return hour * 60 + minute;
}

function availableStaffMinutes(
  options: BookingWorkspaceClientProps["options"],
  date: string,
) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const staffIds = options.staff
    .filter((staff) => staff.is_active)
    .map((staff) => staff.id);

  return staffIds.reduce((sum, staffId) => {
    const working = options.availabilityRules
      .filter(
        (rule) =>
          rule.is_active &&
          rule.day_of_week === day &&
          rule.rule_type === "working" &&
          (!rule.staff_id || rule.staff_id === staffId),
      )
      .reduce(
        (ruleSum, rule) =>
          ruleSum +
          Math.max(0, localMinutes(rule.ends_at_local) - localMinutes(rule.starts_at_local)),
        0,
      );
    const breaks = options.availabilityRules
      .filter(
        (rule) =>
          rule.is_active &&
          rule.day_of_week === day &&
          rule.rule_type === "break" &&
          (!rule.staff_id || rule.staff_id === staffId),
      )
      .reduce(
        (ruleSum, rule) =>
          ruleSum +
          Math.max(0, localMinutes(rule.ends_at_local) - localMinutes(rule.starts_at_local)),
        0,
      );

    return sum + Math.max(0, working - breaks);
  }, 0);
}

function bookingLineMinutes(booking: BookingWorkspaceItem) {
  return booking.lines.reduce(
    (sum, line) => sum + Number(line.duration_minutes ?? 0),
    0,
  );
}

function KpiGrid({
  bookings,
  date,
  options,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  date: string;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const dayBookings = selectedDateBookings(bookings, date, timezone).filter(activeBooking);
  const onlineCount = dayBookings.filter(onlineBooking).length;
  const bookedMinutes = dayBookings.reduce(
    (sum, booking) => sum + bookingLineMinutes(booking),
    0,
  );
  const availableMinutes = availableStaffMinutes(options, date);
  const bookedPercent =
    availableMinutes > 0 ? Math.round((bookedMinutes / availableMinutes) * 100) : null;
  const revenue = dayBookings.reduce((sum, booking) => sum + booking.subtotal, 0);

  const cards = [
    {
      helper: dayBookings.length === 1 ? "active appointment" : "active appointments",
      icon: (
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
          <path d="M8 2v4M16 2v4M3 10h18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          <rect height="18" rx="3" stroke="currentColor" strokeWidth="2" width="18" x="3" y="4" />
        </svg>
      ),
      label: "Today's appointments",
      tone: "plum" as const,
      value: dayBookings.length.toString(),
    },
    {
      helper: "from public booking sources",
      icon: (
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ),
      label: "Online bookings",
      tone: "green" as const,
      value: onlineCount.toString(),
    },
    {
      helper:
        availableMinutes > 0
          ? `${formatMinutes(bookedMinutes)} booked of ${formatMinutes(availableMinutes)} available`
          : "Set availability to calculate capacity",
      icon: (
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ),
      label: "Booked time",
      tone: "amber" as const,
      value: bookedPercent === null ? "-" : `${bookedPercent}%`,
    },
    {
      helper: "scheduled today",
      icon: (
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
          <path d="M15 9.5A3 3 0 0 0 12 8h-1a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-1a3 3 0 0 1-3-1.5M12 6v12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ),
      label: "Expected revenue",
      tone: "revenue" as const,
      value: formatMoney(revenue),
    },
  ];

  return (
    <section
      aria-label="Booking summary"
      className={styles.kpiGrid}
      data-testid="booking-owner-kpi-grid"
    >
      {cards.map((card) => (
        <article
          className={styles.kpiCard}
          data-testid="booking-owner-kpi-card"
          key={card.label}
        >
          <BookingIcon tone={card.tone}>{card.icon}</BookingIcon>
          <div className="min-w-0">
            <p className={styles.kpiLabel}>{card.label}</p>
            <p className={styles.kpiValue}>{card.value}</p>
            <p className={styles.kpiHelper}>{card.helper}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

function statusTone(status: string) {
  switch (status) {
    case "checked_in":
      return styles.statusArrived;
    case "in_service":
      return styles.statusInService;
    case "pending":
      return styles.statusPending;
    case "confirmed":
      return styles.statusConfirmed;
    default:
      return styles.statusMuted;
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={classNames(
        styles.statusBadge,
        statusTone(status),
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function Message({ result }: { result: BookingActionResult | null }) {
  if (!result) {
    return null;
  }

  return (
    <p
      className={classNames(
        "rounded-md border px-3 py-2 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800",
      )}
      role="status"
    >
      {result.message}
    </p>
  );
}

function ModalFrame({
  children,
  label,
  onClose,
  size = "wide",
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  size?: "detail" | "wide";
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const focusable = getFocusable(frame);
    focusable[0]?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = getFocusable(frameRef.current);

    if (focusable.length === 0) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      aria-label={label}
      aria-modal="true"
      className="fixed inset-0 z-50 grid bg-zinc-950/35 p-0 sm:p-4"
      onKeyDown={onKeyDown}
      role="dialog"
    >
      <div
        className={classNames(
          "ml-auto flex h-dvh w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[calc(100dvh-2rem)] sm:rounded-lg",
          size === "detail" ? "max-w-2xl" : "max-w-5xl",
        )}
        ref={frameRef}
      >
        {children}
      </div>
    </div>
  );
}

function getFocusable(root: HTMLElement | null) {
  if (!root) {
    return [];
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  );
}

function buildUrl(
  pathname: string,
  searchParams: URLSearchParams,
  next: Record<string, string | null>,
) {
  const params = new URLSearchParams(searchParams.toString());

  for (const [key, value] of Object.entries(next)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function FilterBar({
  filters,
  options,
}: {
  filters: BookingWorkspaceFilters;
  options: BookingWorkspaceClientProps["options"];
}) {
  return (
    <form className="booking-filter-bar" method="get">
      <input name="date" type="hidden" value={filters.date} />
      <input name="view" type="hidden" value={filters.view} />
      <input name="tab" type="hidden" value={filters.tab} />
      <label className="booking-filter-bar__search">
        <span className="sr-only">Search appointments</span>
        <input
          className={styles.searchInput}
          defaultValue={filters.query}
          name="q"
          placeholder="Search customer or service"
          type="search"
        />
      </label>
      <details className={styles.filterDetails}>
        <summary className={classNames(styles.secondaryButton, "cursor-pointer gap-2 px-4")}>
          <FunnelIcon />
          <span>Filter</span>
        </summary>
        <div className={styles.filterMenu}>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#786d78]">
              Staff
            </span>
            <select
              className={styles.select}
              defaultValue={filters.staffId ?? ""}
              name="staff"
            >
              <option value="">All staff</option>
              {options.staff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#786d78]">
              Status
            </span>
            <select
              className={styles.select}
              defaultValue={filters.status ?? ""}
              name="status"
            >
              <option value="">All statuses</option>
              {[
                "pending",
                "confirmed",
                "checked_in",
                "in_service",
                "completed",
                "cancelled",
                "no_show",
              ].map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#786d78]">
              Service
            </span>
            <select
              className={styles.select}
              defaultValue={filters.serviceId ?? ""}
              name="service"
            >
              <option value="">All services</option>
              {options.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-extrabold uppercase tracking-[0.08em] text-[#786d78]">
              Source
            </span>
            <select
              className={styles.select}
              defaultValue={filters.source ?? ""}
              name="source"
            >
              <option value="">All sources</option>
              {BOOKING_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {sourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <a
              className={classNames(styles.secondaryButton, "px-4")}
              href={`/bookings?date=${filters.date}&view=${filters.view}&tab=${filters.tab}`}
            >
              Clear
            </a>
            <button className={classNames(styles.primaryButton, "px-4")} type="submit">
              Apply
            </button>
          </div>
        </div>
      </details>
      </form>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M8 2v4M16 2v4M3 10h18"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <rect
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="2"
        width="18"
        x="3"
        y="4"
      />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function DownChevronIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function formatToolbarDate(date: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: timezone,
    weekday: "long",
  }).format(new Date(`${date}T12:00:00Z`));
}

function DateNavigation({
  filters,
  timezone,
}: {
  filters: BookingWorkspaceFilters;
  timezone: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const step = filters.view === "week" ? 7 : 1;

  function goTo(date: string) {
    router.push(buildUrl(pathname, searchParams, { date }), { scroll: false });
  }

  return (
    <div className={styles.toolbarDate}>
      <button
        className={classNames(styles.secondaryButton, "px-4")}
        onClick={() => goTo(todayInTimeZone(timezone))}
        type="button"
      >
        Today
      </button>
      <button
        aria-label={filters.view === "week" ? "Previous week" : "Previous day"}
        className={styles.iconButton}
        onClick={() => goTo(addDays(filters.date, -step))}
        type="button"
      >
        <ChevronIcon direction="left" />
      </button>
      <label className="booking-date-picker">
        <span className="booking-date-picker__label">
          {formatToolbarDate(filters.date, timezone)}
        </span>
        <CalendarIcon />
        <input
          aria-label="Choose appointment date"
          className="booking-date-picker__native"
          onChange={(event) => goTo(event.target.value)}
          type="date"
          value={filters.date}
        />
      </label>
      <button
        aria-label={filters.view === "week" ? "Next week" : "Next day"}
        className={styles.iconButton}
        onClick={() => goTo(addDays(filters.date, step))}
        type="button"
      >
        <ChevronIcon direction="right" />
      </button>
    </div>
  );
}

function ViewTabs({ filters }: { filters: BookingWorkspaceFilters }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <details className="booking-view-menu">
      <summary
        className="booking-view-menu__summary"
        data-testid="booking-owner-view-selector"
      >
        <span>{VIEW_LABELS[filters.view]}</span>
        <DownChevronIcon />
      </summary>
      <div className="booking-view-menu__popover">
        {(["list", "day", "week"] as const).map((view) => (
          <a
            aria-current={filters.view === view ? "page" : undefined}
            className="booking-view-menu__item"
            href={buildUrl(pathname, searchParams, { view })}
            key={view}
          >
            {VIEW_LABELS[view]}
          </a>
        ))}
      </div>
    </details>
  );
}

function WorkspaceTabs({
  appointmentCount,
  filters,
  setupIncomplete,
}: {
  appointmentCount: number;
  filters: BookingWorkspaceFilters;
  setupIncomplete: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabs = [
    { count: appointmentCount, label: "Appointments", value: "calendar" },
    { label: "Booking page", setupNeeded: setupIncomplete, value: "booking-page" },
    { label: "Availability", value: "availability" },
    { label: "Settings", value: "settings" },
  ] as const;

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className={styles.tabs} data-testid="booking-owner-tabs">
        {tabs.map((tab) => (
          <a
            aria-current={filters.tab === tab.value ? "page" : undefined}
            className={classNames(
              styles.tab,
              filters.tab === tab.value && styles.tabActive,
            )}
            href={buildUrl(pathname, searchParams, {
              section: null,
              tab: tab.value,
            })}
            key={tab.value}
          >
            {tab.label}
            {"count" in tab ? (
              <span className={styles.tabCount}>{tab.count}</span>
            ) : null}
            {"setupNeeded" in tab && tab.setupNeeded ? (
              <span className="booking-tab-setup-badge">Setup needed</span>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}

function AppointmentCard({
  booking,
  onOpen,
  timezone,
}: {
  booking: BookingWorkspaceItem;
  onOpen: (booking: BookingWorkspaceItem) => void;
  timezone: string;
}) {
  return (
    <button
      className="grid w-full gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      onClick={() => onOpen(booking)}
      type="button"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-950">
            {formatTime(booking.start_at, timezone)} -{" "}
            {formatTime(booking.end_at, timezone)}
          </p>
          <p className="mt-1 truncate text-base font-semibold text-zinc-950">
            {booking.customer?.name ?? "Unknown customer"}
          </p>
        </div>
        <StatusBadge status={booking.normalizedStatus} />
      </div>
      <div className="grid gap-1 text-sm text-zinc-600">
        <p className="line-clamp-2">
          {booking.serviceNames.length > 0
            ? booking.serviceNames.join(", ")
            : "No services"}
        </p>
        <p className="truncate">
          {booking.assignedStaffNames.length > 0
            ? booking.assignedStaffNames.join(", ")
            : "Unassigned"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-semibold text-zinc-600">
        <span className="rounded-md border border-zinc-200 px-2 py-1">
          {sourceLabel(booking.source)}
        </span>
        <span className="rounded-md border border-zinc-200 px-2 py-1">
          {booking.confirmation_status}
        </span>
        {booking.hasOverbookingOverride ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
            Override
          </span>
        ) : null}
        {booking.lines.length > 1 ? (
          <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-800">
            Multi-service
          </span>
        ) : null}
      </div>
    </button>
  );
}

function minutesFromIso(value: string, timeZone: string) {
  const parts = dateParts(value, timeZone).time.split(":").map(Number);

  return parts[0] * 60 + parts[1];
}

function localTimeLabel(totalMinutes: number) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const date = new Date(Date.UTC(2026, 0, 1, hour, minute));

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: minute ? "2-digit" : undefined,
    timeZone: "UTC",
  }).format(date);
}

function calendarBounds(input: {
  bookings: BookingWorkspaceItem[];
  date: string;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const starts: number[] = [];
  const ends: number[] = [];
  const day = new Date(`${input.date}T12:00:00Z`).getUTCDay();

  for (const rule of input.options.availabilityRules) {
    if (rule.day_of_week !== day || rule.rule_type !== "working" || !rule.is_active) {
      continue;
    }

    const [startHour, startMinute] = rule.starts_at_local.slice(0, 5).split(":").map(Number);
    const [endHour, endMinute] = rule.ends_at_local.slice(0, 5).split(":").map(Number);
    starts.push(startHour * 60 + startMinute);
    ends.push(endHour * 60 + endMinute);
  }

  for (const booking of input.bookings) {
    if (dateParts(booking.start_at, input.timezone).date !== input.date) {
      continue;
    }

    starts.push(minutesFromIso(booking.start_at, input.timezone));
    ends.push(minutesFromIso(booking.end_at, input.timezone));
  }

  const start = Math.max(0, Math.min(...starts, 9 * 60) - 60);
  const end = Math.min(24 * 60, Math.max(...ends, 18 * 60) + 60);

  return {
    end: Math.max(end, start + 4 * 60),
    start,
  };
}

function dayColumns(
  options: BookingWorkspaceClientProps["options"],
  filters: BookingWorkspaceFilters,
) {
  const staff = filters.staffId
    ? options.staff.filter((member) => member.id === filters.staffId)
    : options.staff;

  if (staff.length === 0) {
    return [{ id: "unassigned", label: "Schedule" }];
  }

  return staff.slice(0, 8).map((member) => ({
    id: member.id,
    label: member.display_name,
  }));
}

function bookingColumnIds(
  booking: BookingWorkspaceItem,
  columns: Array<{ id: string; label: string }>,
) {
  const ids = new Set(
    booking.lines
      .map((line) => line.assigned_staff_id)
      .filter((value): value is string => Boolean(value)),
  );

  if (ids.size === 0) {
    return [columns[0]?.id ?? "unassigned"];
  }

  return [...ids].filter((id) => columns.some((column) => column.id === id));
}

function DayCalendarCanvas({
  bookings,
  filters,
  onOpen,
  options,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  filters: BookingWorkspaceFilters;
  onOpen: (booking: BookingWorkspaceItem) => void;
  options: BookingWorkspaceClientProps["options"];
  timezone: string;
}) {
  const columns = dayColumns(options, filters);
  const bounds = calendarBounds({
    bookings,
    date: filters.date,
    options,
    timezone,
  });
  const rowHeight = 64;
  const totalMinutes = bounds.end - bounds.start;
  const canvasHeight = Math.max(360, Math.ceil(totalMinutes / 60) * rowHeight);
  const hours = Array.from(
    { length: Math.ceil(totalMinutes / 60) + 1 },
    (_, index) => bounds.start + index * 60,
  );
  const dayBookings = bookings.filter(
    (booking) => dateParts(booking.start_at, timezone).date === filters.date,
  );
  const blocks = options.timeBlocks.filter(
    (block) => dateParts(block.starts_at, timezone).date === filters.date,
  );
  const today = todayInTimeZone(timezone);
  const nowMinutes = minutesFromIso(new Date().toISOString(), timezone);
  const showNow = filters.date === today && nowMinutes >= bounds.start && nowMinutes <= bounds.end;
  const position = (startIso: string, endIso: string) => {
    const start = minutesFromIso(startIso, timezone);
    const end = minutesFromIso(endIso, timezone);
    const top = ((start - bounds.start) / totalMinutes) * canvasHeight;
    const height = Math.max(36, ((end - start) / totalMinutes) * canvasHeight);

    return { height, top };
  };

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] border-b border-zinc-200 bg-zinc-50">
        <div className="px-3 py-3 text-xs font-semibold uppercase text-zinc-500">
          Time
        </div>
        <div
          className="grid min-w-[680px]"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))` }}
        >
          {columns.map((column) => (
            <div
              className="border-l border-zinc-200 px-3 py-3 text-sm font-semibold text-zinc-950"
              key={column.id}
            >
              {column.label}
            </div>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[752px] grid-cols-[72px_minmax(0,1fr)]">
          <div className="relative bg-zinc-50" style={{ height: canvasHeight }}>
            {hours.map((hour) => (
              <div
                className="absolute left-0 right-0 -translate-y-2 px-3 text-xs text-zinc-500"
                key={hour}
                style={{ top: ((hour - bounds.start) / totalMinutes) * canvasHeight }}
              >
                {localTimeLabel(hour)}
              </div>
            ))}
          </div>
          <div
            className="relative grid"
            style={{
              gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))`,
              height: canvasHeight,
            }}
          >
            {columns.map((column) => (
              <div
                className="relative border-l border-zinc-200"
                key={column.id}
              >
                {hours.map((hour) => (
                  <div
                    className="absolute left-0 right-0 border-t border-zinc-100"
                    key={hour}
                    style={{ top: ((hour - bounds.start) / totalMinutes) * canvasHeight }}
                  />
                ))}
                {blocks
                  .filter((block) => !block.staff_id || block.staff_id === column.id)
                  .map((block) => {
                    const blockPosition = position(block.starts_at, block.ends_at);

                    return (
                      <div
                        className="absolute left-2 right-2 rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600"
                        key={block.id}
                        style={{
                          height: blockPosition.height,
                          top: blockPosition.top,
                        }}
                      >
                        {block.reason || block.block_type.replace(/_/g, " ")}
                      </div>
                    );
                  })}
                {dayBookings
                  .filter((booking) => bookingColumnIds(booking, columns).includes(column.id))
                  .map((booking) => {
                    const itemPosition = position(booking.start_at, booking.end_at);

                    return (
                      <button
                        className="absolute left-2 right-2 overflow-hidden rounded-md border border-[#642a56] bg-[#642a56] px-3 py-2 text-left text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#642a56]"
                        key={`${column.id}-${booking.id}`}
                        onClick={() => onOpen(booking)}
                        style={{
                          height: itemPosition.height,
                          top: itemPosition.top,
                        }}
                        type="button"
                      >
                        <span className="block truncate text-xs font-semibold">
                          {formatTime(booking.start_at, timezone)}{" "}
                          {booking.customer?.name ?? "Unknown customer"}
                        </span>
                        <span className="mt-1 block truncate text-xs text-zinc-200">
                          {booking.serviceNames.join(", ") || "Appointment"}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-zinc-300">
                          {STATUS_LABELS[booking.normalizedStatus]}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))}
            {showNow ? (
              <div
                className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500"
                style={{
                  top: ((nowMinutes - bounds.start) / totalMinutes) * canvasHeight,
                }}
              />
            ) : null}
            {dayBookings.length === 0 ? (
              <div className="booking-empty-state pointer-events-none absolute inset-x-4 top-8">
                <p className="font-semibold text-zinc-950">
                  No appointments scheduled for this day.
                </p>
                <p className="mt-1">Use New appointment to add a manual booking.</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

const QUICK_STATUS_FILTERS: Array<{
  label: string;
  status: BookingWorkspaceFilters["status"];
}> = [
  { label: "All", status: null },
  { label: "Confirmed", status: "confirmed" },
  { label: "Pending", status: "pending" },
  { label: "Arrived", status: "checked_in" },
  { label: "In service", status: "in_service" },
];

function QuickStatusRow({
  bookings,
  filters,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  filters: BookingWorkspaceFilters;
  timezone: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dayBookings = selectedDateBookings(bookings, filters.date, timezone).filter(
    activeBooking,
  );

  function count(status: BookingWorkspaceFilters["status"]) {
    if (!status) {
      return dayBookings.length;
    }

    return dayBookings.filter((booking) => booking.normalizedStatus === status).length;
  }

  return (
    <div className={styles.statusRow} data-testid="booking-owner-status-filters">
      {QUICK_STATUS_FILTERS.map((item) => {
        const active = filters.status === item.status;

        return (
          <a
            className={classNames(
              styles.statusChip,
              active && styles.statusChipActive,
            )}
            href={buildUrl(pathname, searchParams, {
              status: item.status,
            })}
            key={item.label}
          >
            {item.label}
            <span>{count(item.status)}</span>
          </a>
        );
      })}
    </div>
  );
}

function staffForBookingDisplay(
  booking: BookingWorkspaceItem,
  options: BookingWorkspaceClientProps["options"],
) {
  const assignedId =
    booking.lines.find((line) => line.assigned_staff_id)?.assigned_staff_id ??
    booking.staff_id ??
    null;

  if (!assignedId) {
    return null;
  }

  return options.staff.find((staff) => staff.id === assignedId) ?? null;
}

function serviceSummary(booking: BookingWorkspaceItem) {
  const primary =
    booking.lines.find((line) => line.line_type === "service") ?? booking.lines[0] ?? null;
  const addOnCount = booking.lines.filter((line) => line.line_type === "add_on").length;
  const moreCount = Math.max(0, booking.lines.length - 1 - addOnCount);
  const detailParts = [
    addOnCount > 0 ? `+${addOnCount} add-on${addOnCount === 1 ? "" : "s"}` : null,
    moreCount > 0 ? `+${moreCount} more` : null,
  ].filter(Boolean);

  return {
    detail: detailParts.join(" / ") || "No add-ons",
    primary: primary?.service_name_snapshot ?? "No services",
  };
}

function CalendarView({
  bookings,
  filters,
  onOpen,
  options,
  range,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  filters: BookingWorkspaceFilters;
  onOpen: (booking: BookingWorkspaceItem) => void;
  options: BookingWorkspaceClientProps["options"];
  range: BookingWorkspaceClientProps["range"];
  timezone: string;
}) {
  const visibleBookings = filters.status ? bookings : bookings.filter(activeBooking);

  if (filters.view === "week") {
    return (
      <div className="grid gap-3 lg:grid-cols-7">
        {range.days.map((day) => {
          const dayBookings = visibleBookings.filter(
            (booking) => dateParts(booking.start_at, timezone).date === day.date,
          );

          return (
            <section
              className="min-w-0 rounded-lg border border-zinc-200 bg-zinc-50"
              key={day.date}
            >
              <div className="border-b border-zinc-200 px-3 py-2">
                <h3 className="text-sm font-semibold text-zinc-950">{day.label}</h3>
                <p className="text-xs text-zinc-500">{dayBookings.length} booked</p>
              </div>
              <div className="grid gap-2 p-2">
                {dayBookings.length === 0 ? (
                  <p className="booking-empty-state px-3 py-6">
                    No appointments
                  </p>
                ) : (
                  dayBookings.map((booking) => (
                    <AppointmentCard
                      booking={booking}
                      key={booking.id}
                      onOpen={onOpen}
                      timezone={timezone}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  if (filters.view === "list") {
    if (visibleBookings.length === 0) {
      return (
        <div className="booking-empty-state m-5">
          <p className="font-extrabold text-[#211c24]">No appointments match this day.</p>
          <p className="mt-1">Try another date or clear filters.</p>
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <div>Time</div>
            <div>Customer</div>
            <div>Services</div>
            <div>Professional</div>
            <div>Status</div>
            <div>Total</div>
            <div />
          </div>
          {visibleBookings.map((booking) => (
            <button
              className={classNames(
                styles.tableRow,
                "w-full text-left transition hover:bg-[#fbfafb] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#642a56]",
              )}
              key={booking.id}
              onClick={() => onOpen(booking)}
              type="button"
            >
              <div>
                <span className="grid text-sm font-extrabold text-[#211c24]">
                  <span>{formatTime(booking.start_at, timezone)}</span>
                  <span className="mt-1 text-xs font-medium text-[#786d78]">
                    {formatTime(booking.end_at, timezone)}
                  </span>
                </span>
              </div>
              <div>
                <span className="flex min-w-0 items-center gap-3">
                  <StaffAvatar label={booking.customer?.name ?? "Guest"} size="small" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold text-[#211c24]">
                      {booking.customer?.name ?? "Unknown customer"}
                    </span>
                    <span className="block truncate text-xs text-[#786d78]">
                      {sourceLabel(booking.source)}
                    </span>
                  </span>
                </span>
              </div>
              <div>
                {(() => {
                  const summary = serviceSummary(booking);

                  return (
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-extrabold text-[#211c24]">
                        {summary.primary}
                      </span>
                      <span className="block truncate text-xs text-[#786d78]">
                        {summary.detail}
                      </span>
                    </span>
                  );
                })()}
              </div>
              <div>
                {(() => {
                  const staff = staffForBookingDisplay(booking, options);

                  return (
                    <span className="flex min-w-0 items-center gap-2">
                      <StaffAvatar
                        imageUrl={staff?.public_profile_photo_path}
                        label={staff?.display_name ?? booking.assignedStaffNames[0]}
                        size="small"
                      />
                      <span className="truncate text-sm font-extrabold text-[#211c24]">
                        {staff?.display_name ??
                          (booking.assignedStaffNames.join(", ") || "Unassigned")}
                      </span>
                    </span>
                  );
                })()}
              </div>
              <div>
                <StatusBadge status={booking.normalizedStatus} />
              </div>
              <div>
                <span className="text-sm font-extrabold text-[#211c24]">
                  {formatMoney(booking.subtotal)}
                </span>
              </div>
              <div>
                <span className="text-xl leading-none text-[#786d78]" aria-hidden="true">
                  ...
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <DayCalendarCanvas
      bookings={visibleBookings}
      filters={filters}
      onOpen={onOpen}
      options={options}
      timezone={timezone}
    />
  );
}

function eventLabel(event: BookingStatusEvent) {
  return event.event_type.replace(/_/g, " ");
}

function CustomerInspirationSection({
  booking,
}: {
  booking: BookingWorkspaceItem;
}) {
  const inspiration = booking.inspiration;

  if (!inspiration) {
    return null;
  }

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase text-zinc-500">
        Customer inspiration
      </h3>
      <div className="mt-2 grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-[96px_1fr]">
        <a
          className="block h-24 w-24 overflow-hidden rounded-lg bg-zinc-100"
          href={inspiration.imageUrl ?? undefined}
          rel="noreferrer"
          target={inspiration.imageUrl ? "_blank" : undefined}
        >
          {inspiration.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-full w-full object-cover" src={inspiration.imageUrl} />
          ) : (
            <span className="grid h-full w-full place-items-center text-sm font-semibold text-zinc-500">
              Look
            </span>
          )}
        </a>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-zinc-950">
            {inspiration.source_title_snapshot ?? "Booked look"}
          </p>
          <p className="mt-1 font-semibold text-[#642a56]">
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
            <p className="mt-2 line-clamp-3 text-zinc-600">
              {inspiration.source_caption_snapshot}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DetailDrawer({
  booking,
  canManage,
  onClose,
  options,
  settings,
  timezone,
}: {
  booking: BookingWorkspaceItem;
  canManage: boolean;
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  settings: BookingWorkspaceClientProps["settings"];
  timezone: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [rescheduleStart, setRescheduleStart] = useState(
    toLocalInputValue(booking.start_at, timezone),
  );
  const [rescheduleEnd, setRescheduleEnd] = useState(
    toLocalInputValue(booking.end_at, timezone),
  );
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [lineAssignments, setLineAssignments] = useState(
    booking.lines.map((line) => ({
      bookingLineId: line.id,
      staffId: line.assigned_staff_id ?? "",
    })),
  );
  const validActions = actionSetForStatus(booking.normalizedStatus);
  const hasTicket = Boolean(booking.posTicket);
  const ticketConversionBlocked =
    booking.normalizedStatus === "pending" ||
    booking.normalizedStatus === "cancelled" ||
    booking.normalizedStatus === "no_show" ||
    ["requested", "cancelled", "declined"].includes(booking.confirmation_status);
  const missingStaff = booking.lines.some((line) => !line.assigned_staff_id);
  const paymentPending =
    booking.normalizedStatus === "completed" &&
    booking.posTicket &&
    booking.posTicket.paymentStatus !== "paid";

  function runStatus(command: Parameters<typeof runBookingStatusAction>[0]["command"]) {
    setResult(null);
    startTransition(async () => {
      const response = await runBookingStatusAction({
        bookingId: booking.id,
        command,
        reason,
      });
      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function runReschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await rescheduleOwnerBookingAction({
        bookingId: booking.id,
        endLocal: rescheduleEnd,
        overbookingOverrideReason: overrideReason,
        startLocal: rescheduleStart,
      });
      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function runReassign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await reassignOwnerBookingAction({
        bookingId: booking.id,
        lineAssignments: lineAssignments.map((assignment) => ({
          bookingLineId: assignment.bookingLineId,
          staffId: assignment.staffId || null,
        })),
        overbookingOverrideReason: overrideReason,
      });
      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  function createTicket() {
    setResult(null);
    startTransition(async () => {
      const response = await createBookingPosTicketAction({
        bookingId: booking.id,
      });
      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  return (
    <ModalFrame label="Appointment details" onClose={onClose} size="detail">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-zinc-950">
            {booking.customer?.name ?? "Unknown customer"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {formatDateTime(booking.start_at, timezone)}
          </p>
        </div>
        <button
          className="grid size-10 place-items-center rounded-md border border-zinc-300 text-lg font-semibold"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </div>
      <div className="grid flex-1 gap-6 overflow-y-auto px-5 py-5">
        <Message result={result} />
        <section className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={booking.normalizedStatus} />
            <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
              {sourceLabel(booking.source)}
            </span>
            <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
              {booking.confirmation_status}
            </span>
          </div>
          <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
            <p>
              <span className="font-semibold text-zinc-950">Customer: </span>
              {booking.customer?.name ?? "Unknown"}
            </p>
            <p>
              <span className="font-semibold text-zinc-950">Contact: </span>
              {canManage
                ? [booking.customer?.phone, booking.customer?.email]
                    .filter(Boolean)
                    .join(" / ") || "Not provided"
                : "Restricted"}
            </p>
            <p>
              <span className="font-semibold text-zinc-950">Timezone: </span>
              {booking.salon_timezone_snapshot}
            </p>
            <p>
              <span className="font-semibold text-zinc-950">Total: </span>
              {formatMoney(booking.subtotal)}
            </p>
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase text-zinc-500">Services</h3>
          <div className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {booking.lines.map((line) => (
              <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={line.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">
                    {line.service_name_snapshot}
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">
                    {line.duration_minutes} min / {formatMoney(Number(line.line_total))}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-zinc-600">
                    {line.line_status.replace(/_/g, " ")}
                    {line.performedByStaffName
                      ? ` by ${line.performedByStaffName}`
                      : ""}
                  </p>
                  {line.service_note ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      Note: {line.service_note}
                    </p>
                  ) : null}
                  {line.overbooking_override_reason ? (
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      Override: {line.overbooking_override_reason}
                    </p>
                  ) : null}
                </div>
                <div className="text-sm text-zinc-700 sm:text-right">
                  <p>{line.assignedStaffName ?? "Unassigned"}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {line.scheduled_start_at
                      ? `${formatTime(line.scheduled_start_at, timezone)} - ${formatTime(
                          line.scheduled_end_at ?? booking.end_at,
                          timezone,
                        )}`
                      : "No line schedule"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <CustomerInspirationSection booking={booking} />

        <section className="grid gap-2 text-sm text-zinc-700">
          <h3 className="text-sm font-semibold uppercase text-zinc-500">Notes</h3>
          <p>
            <span className="font-semibold text-zinc-950">Public: </span>
            {booking.public_notes || booking.notes || "None"}
          </p>
          <p>
            <span className="font-semibold text-zinc-950">Internal: </span>
            {canManage ? booking.internal_notes || "None" : "Restricted"}
          </p>
          {booking.cancellation_reason ? (
            <p>
              <span className="font-semibold text-zinc-950">Cancellation: </span>
              {booking.cancellation_reason}
            </p>
          ) : null}
          {booking.no_show_reason ? (
            <p>
              <span className="font-semibold text-zinc-950">No-show: </span>
              {booking.no_show_reason}
            </p>
          ) : null}
          {booking.pos_ticket_id ? (
            <p>
              <span className="font-semibold text-zinc-950">POS ticket: </span>
              {booking.pos_ticket_id}
            </p>
          ) : null}
          {booking.source_reference_id ? (
            <p>
              <span className="font-semibold text-zinc-950">Source reference: </span>
              {booking.source_reference_type ?? "reference"} / {booking.source_reference_id}
            </p>
          ) : null}
        </section>

        <section className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase text-zinc-500">
                Ticket
              </h3>
              <p className="mt-1 text-sm text-zinc-600">
                Mode: {TICKET_CREATION_MODE_LABELS[settings.ticket_creation_mode]}.
              </p>
            </div>
            {booking.posTicket ? (
              <a
                className="inline-flex min-h-10 items-center rounded-md bg-[#642a56] px-3 text-sm font-semibold text-white"
                href={`/pos-tickets/${booking.posTicket.id}`}
              >
                Open POS ticket
              </a>
            ) : canManage ? (
              <button
                className="min-h-10 rounded-md bg-[#642a56] px-3 text-sm font-semibold text-white disabled:opacity-60"
                disabled={isPending || ticketConversionBlocked}
                onClick={createTicket}
                type="button"
              >
                Create POS ticket
              </button>
            ) : null}
          </div>

          {booking.posTicket ? (
            <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2">
              <p>
                <span className="block text-zinc-500">Ticket</span>
                <span className="font-semibold text-zinc-950">
                  {booking.posTicket.ticketNumber}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500">Status</span>
                <span className="font-semibold capitalize text-zinc-950">
                  {booking.posTicket.status}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500">Subtotal</span>
                <span className="font-semibold text-zinc-950">
                  {formatMoney(booking.posTicket.totals.subtotal)}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500">Tax</span>
                <span className="font-semibold text-zinc-950">
                  {formatMoney(booking.posTicket.totals.tax_amount)}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500">Total</span>
                <span className="font-semibold text-zinc-950">
                  {formatMoney(booking.posTicket.totals.total)}
                </span>
              </p>
              <p>
                <span className="block text-zinc-500">Payment</span>
                <span className="font-semibold capitalize text-zinc-950">
                  {booking.posTicket.paymentStatus}
                </span>
              </p>
            </div>
          ) : (
            <div className="grid gap-2 text-sm text-zinc-700">
              <p>
                The ticket will use booked services, booked prices, and assigned
                staff snapshots. POS owns discounts, tax, tips, and payments after
                creation.
              </p>
              {ticketConversionBlocked ? (
                <p className="font-semibold text-amber-700">
                  Confirm this appointment before creating a POS ticket.
                </p>
              ) : null}
              {missingStaff ? (
                <p className="font-semibold text-amber-700">
                  One or more services are unassigned; ticket staff attribution may
                  need review.
                </p>
              ) : null}
            </div>
          )}

          {paymentPending ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              Payment pending: the appointment is complete, but this POS ticket is
              not fully paid.
            </p>
          ) : null}

          {hasTicket && booking.normalizedStatus === "cancelled" ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              This appointment was cancelled after ticket creation. Review the POS
              ticket separately.
            </p>
          ) : null}
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase text-zinc-500">Timeline</h3>
          <div className="mt-2 grid gap-2">
            {booking.events.length === 0 ? (
              <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
                No status events recorded.
              </p>
            ) : (
              booking.events.map((event) => (
                <div className="rounded-lg border border-zinc-200 px-4 py-3" key={event.id}>
                  <p className="text-sm font-semibold capitalize text-zinc-950">
                    {eventLabel(event)}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {formatDateTime(event.created_at, timezone)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        {canManage ? (
          <section className="grid gap-4">
            <h3 className="text-sm font-semibold uppercase text-zinc-500">Actions</h3>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                Reason or action note
              </span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {validActions.map((action) => (
                <button
                  className="min-h-10 rounded-md bg-[#642a56] px-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={isPending}
                  key={action.command}
                  onClick={() => runStatus(action.command)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>

            <form className="grid gap-3 rounded-lg border border-zinc-200 p-4" onSubmit={runReschedule}>
              <h4 className="text-sm font-semibold text-zinc-950">Reschedule</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700">Start</span>
                  <input
                    className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                    onChange={(event) => setRescheduleStart(event.target.value)}
                    type="datetime-local"
                    value={rescheduleStart}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700">End</span>
                  <input
                    className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                    onChange={(event) => setRescheduleEnd(event.target.value)}
                    type="datetime-local"
                    value={rescheduleEnd}
                  />
                </label>
              </div>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">
                  Override reason
                </span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setOverrideReason(event.target.value)}
                  value={overrideReason}
                />
              </label>
              <button
                className="w-fit min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={isPending}
                type="submit"
              >
                Save time
              </button>
            </form>

            <form className="grid gap-3 rounded-lg border border-zinc-200 p-4" onSubmit={runReassign}>
              <h4 className="text-sm font-semibold text-zinc-950">Assign staff</h4>
              {booking.lines.map((line, index) => (
                <label className="grid gap-1" key={line.id}>
                  <span className="text-sm font-semibold text-zinc-700">
                    {line.service_name_snapshot}
                  </span>
                  <select
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                    onChange={(event) => {
                      setLineAssignments((current) =>
                        current.map((assignment) =>
                          assignment.bookingLineId === line.id
                            ? { ...assignment, staffId: event.target.value }
                            : assignment,
                        ),
                      );
                    }}
                    value={lineAssignments[index]?.staffId ?? ""}
                  >
                    <option value="">Unassigned</option>
                    {staffForService(options).map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="w-fit min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950 disabled:opacity-60"
                disabled={isPending}
                type="submit"
              >
                Save assignment
              </button>
            </form>
          </section>
        ) : null}
      </div>
    </ModalFrame>
  );
}

function actionSetForStatus(status: string) {
  switch (status) {
    case "pending":
      return [
        { command: "confirm", label: "Confirm" },
        { command: "cancel", label: "Cancel" },
      ] as const;
    case "confirmed":
      return [
        { command: "check_in", label: "Check in" },
        { command: "cancel", label: "Cancel" },
        { command: "mark_no_show", label: "Mark no-show" },
      ] as const;
    case "checked_in":
      return [
        { command: "start_service", label: "Start service" },
        { command: "cancel", label: "Cancel" },
      ] as const;
    case "in_service":
      return [{ command: "complete", label: "Complete" }] as const;
    default:
      return [];
  }
}

function staffForService(
  options: BookingWorkspaceClientProps["options"],
) {
  return options.staff.filter((staff) => staff.is_active);
}

function selectedServices(options: BookingWorkspaceClientProps["options"], lines: DraftLine[]) {
  return lines
    .map((line) => options.services.find((service) => service.id === line.serviceId))
    .filter((service): service is BookingWorkspaceClientProps["options"]["services"][number] =>
      Boolean(service),
    );
}

function totalDraftMinutes(
  options: BookingWorkspaceClientProps["options"],
  lines: DraftLine[],
  cleanupBufferMinutes: number,
) {
  return selectedServices(options, lines).reduce(
    (sum, service) => sum + service.duration_minutes + cleanupBufferMinutes,
    0,
  );
}

function totalDraftPrice(options: BookingWorkspaceClientProps["options"], lines: DraftLine[]) {
  return selectedServices(options, lines).reduce(
    (sum, service) => sum + Number(service.base_price ?? 0),
    0,
  );
}

function lineConflicts(
  bookings: BookingWorkspaceItem[],
  blocks: BookingWorkspaceClientProps["options"]["timeBlocks"],
  staffId: string,
  startIso: string,
  endIso: string,
) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  const overlaps = (leftStart: string, leftEnd: string) =>
    new Date(leftStart).getTime() < endMs && new Date(leftEnd).getTime() > startMs;
  const bookingConflict = bookings.some(
    (booking) =>
      booking.normalizedStatus !== "cancelled" &&
      booking.normalizedStatus !== "no_show" &&
      booking.lines.some(
        (line) =>
          line.assigned_staff_id === staffId &&
          line.scheduled_start_at &&
          line.scheduled_end_at &&
          overlaps(line.scheduled_start_at, line.scheduled_end_at),
      ),
  );
  const blockConflict = blocks.some(
    (block) =>
      block.is_active !== false &&
      (!block.staff_id || block.staff_id === staffId) &&
      overlaps(block.starts_at, block.ends_at),
  );

  return bookingConflict || blockConflict;
}

function generateRealSlots(input: {
  bookings: BookingWorkspaceItem[];
  date: string;
  lines: DraftLine[];
  options: BookingWorkspaceClientProps["options"];
  slotIntervalMinutes: number;
  timezone: string;
}) {
  const selectedLines = input.lines.filter((line) => line.serviceId);

  if (selectedLines.length === 0 || selectedLines.some((line) => !line.staffId)) {
    return [];
  }

  const firstStaffId = selectedLines[0].staffId;

  if (!firstStaffId) {
    return [];
  }

  const day = new Date(`${input.date}T12:00:00Z`).getUTCDay();
  const rules = input.options.availabilityRules.filter(
    (rule) =>
      rule.is_active &&
      rule.day_of_week === day &&
      rule.rule_type === "working" &&
      (!rule.staff_id || rule.staff_id === firstStaffId),
  );
  const totalMinutes = totalDraftMinutes(input.options, selectedLines, 0);
  const slots: string[] = [];

  for (const rule of rules) {
    const startsAt = zonedDateTimeToUtcIso(input.date, rule.starts_at_local.slice(0, 5), input.timezone);
    const endsAt = zonedDateTimeToUtcIso(input.date, rule.ends_at_local.slice(0, 5), input.timezone);
    let cursorMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();

    while (cursorMs + totalMinutes * 60000 <= endMs) {
      const startIso = new Date(cursorMs).toISOString();
      let lineCursorMs = cursorMs;
      const hasConflict = selectedLines.some((line) => {
        const service = input.options.services.find(
          (candidate) => candidate.id === line.serviceId,
        );
        const lineEndIso = new Date(
          lineCursorMs + (service?.duration_minutes ?? 0) * 60000,
        ).toISOString();
        const lineStartIso = new Date(lineCursorMs).toISOString();

        lineCursorMs = new Date(lineEndIso).getTime();

        return line.staffId
          ? lineConflicts(
              input.bookings,
              input.options.timeBlocks,
              line.staffId,
              lineStartIso,
              lineEndIso,
            )
          : true;
      });

      if (!hasConflict) {
        slots.push(toLocalInputValue(startIso, input.timezone));
      }

      cursorMs += input.slotIntervalMinutes * 60000;
    }
  }

  return [...new Set(slots)].slice(0, 24);
}

function AppointmentDrawer({
  bookings,
  onClose,
  options,
  prefill,
  settings,
  timezone,
}: {
  bookings: BookingWorkspaceItem[];
  onClose: () => void;
  options: BookingWorkspaceClientProps["options"];
  prefill: DraftPrefill | null;
  settings: BookingWorkspaceClientProps["settings"];
  timezone: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerUserId] = useState(prefill?.customerUserId ?? "");
  const [lines, setLines] = useState<DraftLine[]>([
    {
      serviceId: prefill?.serviceId ?? options.services[0]?.id ?? "",
      staffId: prefill?.staffId ?? "",
    },
  ]);
  const [startLocal, setStartLocal] = useState(
    prefill?.startLocal ??
      `${todayInTimeZone(timezone)}T${settings.slot_interval_minutes <= 15 ? "09:00" : "10:00"}`,
  );
  const [publicNotes, setPublicNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState(prefill?.internalNotes ?? "");
  const [confirmationMode, setConfirmationMode] =
    useState<BookingConfirmationMode>(settings.confirmation_mode);
  const [source, setSource] = useState<BookingSource>(prefill?.source ?? "owner_manual");
  const [overrideReason, setOverrideReason] = useState("");
  const [key] = useState(idempotencyKey);
  const selectedDate = startLocal.slice(0, 10);
  const slots = useMemo(
    () =>
      generateRealSlots({
        bookings,
        date: selectedDate,
        lines,
        options,
        slotIntervalMinutes: settings.slot_interval_minutes,
        timezone,
      }),
    [bookings, lines, options, selectedDate, settings.slot_interval_minutes, timezone],
  );
  const duplicateWarning = useMemo(() => {
    const phone = customerPhone.replace(/[^0-9]/g, "");
    const email = customerEmail.trim().toLowerCase();

    if (!phone && !email) {
      return null;
    }

    const duplicate = options.customers.find((customer) => {
      const customerPhoneDigits = customer.phone?.replace(/[^0-9]/g, "") ?? "";
      const customerEmailValue = customer.email?.trim().toLowerCase() ?? "";

      return (phone && customerPhoneDigits === phone) || (email && customerEmailValue === email);
    });

    return duplicate ? `Possible duplicate: ${duplicate.name}` : null;
  }, [customerEmail, customerPhone, options.customers]);
  const draftMinutes = totalDraftMinutes(
    options,
    lines,
    settings.default_cleanup_buffer_minutes,
  );
  const draftSubtotal = totalDraftPrice(options, lines);
  const steps = ["Customer", "Services", "Professional", "Date & time", "Details", "Review"];

  function addLine() {
    setLines((current) => [
      ...current,
      { serviceId: options.services[0]?.id ?? "", staffId: "" },
    ]);
  }

  function updateLine(index: number, next: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...next } : line,
      ),
    );
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const payload: CreateOwnerAppointmentInput = {
        confirmationMode,
        customerEmail,
        customerId,
        customerName,
        customerPhone,
        customerUserId,
        idempotencyKey: key,
        internalNotes,
        lines,
        overbookingOverrideReason: overrideReason,
        publicNotes,
        source,
        sourceReferenceId: prefill?.sourceReferenceId,
        sourceReferenceType: prefill?.sourceReferenceType,
        startLocal,
      };
      const response = await createOwnerAppointmentAction(payload);
      setResult(response);

      if (response.ok) {
        router.refresh();
        onClose();
      }
    });
  }

  return (
    <ModalFrame label="New appointment" onClose={onClose}>
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-950">New appointment</h2>
          <p className="mt-1 text-sm text-zinc-500">{timezone}</p>
        </div>
        <button
          className="grid size-10 place-items-center rounded-md border border-zinc-300 text-lg font-semibold"
          onClick={onClose}
          type="button"
        >
          x
        </button>
      </div>
      <div className="border-b border-zinc-200 px-5 py-3">
        <div className="flex gap-2 overflow-x-auto">
          {steps.map((label, index) => (
            <button
              className={classNames(
                "min-h-9 rounded-md border px-3 text-sm font-semibold",
                step === index
                  ? "border-[#642a56] bg-[#642a56] text-white"
                  : "border-zinc-300 text-zinc-700",
              )}
              key={label}
              onClick={() => setStep(index)}
              type="button"
            >
              {index + 1}. {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <Message result={result} />
        {step === 0 ? (
          <section className="mt-4 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                Existing customer
              </span>
              <select
                className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                onChange={(event) => setCustomerId(event.target.value)}
                value={customerId}
              >
                <option value="">Quick-create or request customer</option>
                {options.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name} {customer.phone ? `/ ${customer.phone}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">Name</span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setCustomerName(event.target.value)}
                  value={customerName}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">Phone</span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  value={customerPhone}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">Email</span>
                <input
                  className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  type="email"
                  value={customerEmail}
                />
              </label>
            </div>
            {customerUserId ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                Linked customer account: {customerUserId}
              </p>
            ) : null}
            {duplicateWarning ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {duplicateWarning}
              </p>
            ) : null}
          </section>
        ) : null}

        {step === 1 ? (
          <section className="mt-4 grid gap-4">
            {lines.map((line, index) => (
              <div className="grid gap-3 rounded-lg border border-zinc-200 p-4 sm:grid-cols-[minmax(0,1fr)_auto]" key={index}>
                <label className="grid gap-1">
                  <span className="text-sm font-semibold text-zinc-700">
                    Service {index + 1}
                  </span>
                  <select
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                    onChange={(event) =>
                      updateLine(index, { serviceId: event.target.value, staffId: "" })
                    }
                    value={line.serviceId}
                  >
                    {options.services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name} / {service.duration_minutes} min /{" "}
                        {formatMoney(Number(service.base_price))}
                      </option>
                    ))}
                  </select>
                </label>
                {lines.length > 1 ? (
                  <button
                    className="self-end rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((_, lineIndex) => lineIndex !== index),
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="w-fit min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold"
              onClick={addLine}
              type="button"
            >
              Add service
            </button>
            <p className="text-sm text-zinc-600">
              Total {draftMinutes} min / {formatMoney(draftSubtotal)}
            </p>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="mt-4 grid gap-4">
            {lines.map((line, index) => {
              const service = options.services.find(
                (candidate) => candidate.id === line.serviceId,
              );
              const eligibleStaff = staffForService(options);

              return (
                <label className="grid gap-1" key={`${line.serviceId}-${index}`}>
                  <span className="text-sm font-semibold text-zinc-700">
                    {service?.name ?? `Line ${index + 1}`}
                  </span>
                  <select
                    className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                    onChange={(event) => updateLine(index, { staffId: event.target.value })}
                    value={line.staffId}
                  >
                    <option value="">
                      {settings.any_professional_enabled
                        ? "Any professional / unassigned"
                        : "Unassigned"}
                    </option>
                    {eligibleStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="mt-4 grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">Start</span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                onChange={(event) => setStartLocal(event.target.value)}
                type="datetime-local"
                value={startLocal}
              />
            </label>
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold text-zinc-950">Real available slots</h3>
              {slots.length === 0 ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No slot can be generated from configured staff availability for this
                  selection. Manual time remains available for owner review and will still
                  be validated by the booking domain.{" "}
                  <a
                    className="font-semibold underline"
                    href={`/bookings?tab=availability${
                      lines[0]?.staffId ? `&staffId=${lines[0].staffId}` : ""
                    }`}
                  >
                    Set staff hours
                  </a>
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.map((slot) => (
                    <button
                      className={classNames(
                        "min-h-10 rounded-md border px-3 text-sm font-semibold",
                        startLocal === slot
                          ? "border-[#642a56] bg-[#642a56] text-white"
                          : "border-zinc-300 bg-white text-zinc-700",
                      )}
                      key={slot}
                      onClick={() => setStartLocal(slot)}
                      type="button"
                    >
                      {slot.slice(11)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="mt-4 grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">Source</span>
                <select
                  className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                  onChange={(event) => setSource(event.target.value as BookingSource)}
                  value={source}
                >
                  {BOOKING_SOURCES.map((sourceOption) => (
                    <option key={sourceOption} value={sourceOption}>
                      {sourceLabel(sourceOption)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-sm font-semibold text-zinc-700">
                  Confirmation
                </span>
                <select
                  className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                  onChange={(event) =>
                    setConfirmationMode(event.target.value as BookingConfirmationMode)
                  }
                  value={confirmationMode}
                >
                  <option value="request_confirmation">Request confirmation</option>
                  <option value="instant_booking">Instant booking</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                Public notes
              </span>
              <textarea
                className="min-h-24 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => setPublicNotes(event.target.value)}
                value={publicNotes}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                Internal notes
              </span>
              <textarea
                className="min-h-24 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => setInternalNotes(event.target.value)}
                value={internalNotes}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-semibold text-zinc-700">
                Overbooking override reason
              </span>
              <input
                className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
                onChange={(event) => setOverrideReason(event.target.value)}
                value={overrideReason}
              />
            </label>
          </section>
        ) : null}

        {step === 5 ? (
          <section className="mt-4 grid gap-4">
            <div className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-700">
              <p>
                <span className="font-semibold text-zinc-950">Customer: </span>
                {customerId
                  ? options.customers.find((customer) => customer.id === customerId)?.name
                  : customerName || customerUserId || "Not selected"}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950">Services: </span>
                {selectedServices(options, lines)
                  .map((service) => service.name)
                  .join(", ") || "None"}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950">Staff: </span>
                {lines
                  .map((line) =>
                    line.staffId
                      ? options.staff.find((staff) => staff.id === line.staffId)
                          ?.display_name
                      : "Any professional / unassigned",
                  )
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950">Start: </span>
                {startLocal.replace("T", " ")} {timezone}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950">Subtotal: </span>
                {formatMoney(draftSubtotal)}
              </p>
              <p className="mt-2">
                <span className="font-semibold text-zinc-950">Cancellation window: </span>
                {settings.cancellation_window_minutes} minutes
              </p>
            </div>
          </section>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-5 py-4">
        <button
          className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold"
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(0, current - 1))}
          type="button"
        >
          Back
        </button>
        <div className="flex gap-2">
          {step < steps.length - 1 ? (
            <button
              className="min-h-10 rounded-md bg-[#642a56] px-4 text-sm font-semibold text-white"
              onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}
              type="button"
            >
              Next
            </button>
          ) : (
            <button
              className="min-h-10 rounded-md bg-[#642a56] px-4 text-sm font-semibold text-white disabled:opacity-60"
              disabled={isPending}
              onClick={submit}
              type="button"
            >
              {isPending ? "Creating" : "Create appointment"}
            </button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}

function RequestsPanel({
  canManage,
  onConvert,
  requests,
  timezone,
}: {
  canManage: boolean;
  onConvert: (request: BookingWorkspaceRequest) => void;
  requests: BookingWorkspaceRequest[];
  timezone: string;
}) {
  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center">
        <h3 className="text-lg font-semibold text-zinc-950">No profile requests</h3>
        <p className="mt-2 text-sm text-zinc-600">
          Public profile booking requests will appear here for owner review.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <ul className="divide-y divide-zinc-100">
        {requests.map((request) => (
          <li className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto]" key={request.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-zinc-950">
                  {request.customerName}
                </p>
                <span className="rounded-md border border-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-600">
                  {request.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-600">
                {request.serviceName ?? "Service not selected"} /{" "}
                {request.staffName ?? "Any staff"} /{" "}
                {request.requestedStartAt
                  ? formatDateTime(request.requestedStartAt, timezone)
                  : "No requested time"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-zinc-500">
                {request.privateNote || "No note"}
              </p>
            </div>
            {canManage && request.status === "requested" ? (
              <button
                className="min-h-10 rounded-md bg-[#642a56] px-3 text-sm font-semibold text-white"
                onClick={() => onConvert(request)}
                type="button"
              >
                Review
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function staffHasWorkingHours(
  options: BookingWorkspaceClientProps["options"],
  staffId: string,
) {
  return options.availabilityRules.some(
    (rule) =>
      rule.is_active &&
      rule.rule_type === "working" &&
      (!rule.staff_id || rule.staff_id === staffId),
  );
}

function firstStaffMissingAvailability(options: BookingWorkspaceClientProps["options"]) {
  return (
    options.staff.find(
      (member) => member.is_active && !staffHasWorkingHours(options, member.id),
    )?.id ?? options.staff.find((member) => member.is_active)?.id ?? null
  );
}

function buildReadinessByStaff(input: {
  bookingEnabled: boolean;
  options: BookingWorkspaceClientProps["options"];
}): Record<string, StaffBookingReadiness> {
  return Object.fromEntries(
    input.options.staff.map((member) => {
      const onlineAssignments = input.options.assignments.filter((assignment) => {
        const service = input.options.services.find(
          (candidate) => candidate.id === assignment.service_id,
        );

        return (
          assignment.staff_id === member.id &&
          assignment.is_active &&
          assignment.online_bookable &&
          service?.is_active === true &&
          service.online_booking_enabled === true
        );
      });
      const workingRules = input.options.availabilityRules.filter(
        (rule) =>
          rule.is_active &&
          rule.rule_type === "working" &&
          (!rule.staff_id || rule.staff_id === member.id),
      );
      const reasons: StaffBookingReadiness["reasons"] = [];

      if (!input.bookingEnabled) {
        reasons.push({
          code: "booking_disabled",
          cta: "booking_settings",
          label: "Online booking disabled",
        });
      }

      if (!member.is_active) {
        reasons.push({
          code: "staff_inactive",
          cta: "staff_profile",
          label: "Staff inactive",
        });
      }

      if (!member.online_booking_enabled) {
        reasons.push({
          code: "online_booking_disabled",
          cta: "staff_profile",
          label: "Online booking disabled",
        });
      }

      if (
        !member.public_profile_visible ||
        !member.owner_public_enabled ||
        member.staff_public_consent_status !== "granted"
      ) {
        reasons.push({
          code: "profile_not_public",
          cta: "staff_profile",
          label: "Profile not public",
        });
      }

      if (onlineAssignments.length === 0) {
        reasons.push({
          code: "no_assigned_services",
          cta: "assign_services",
          label: "No assigned services",
        });
      }

      if (workingRules.length === 0) {
        reasons.push({
          code: "no_working_hours",
          cta: "staff_hours",
          label: "No working hours",
        });
      }

      return [
        member.id,
        {
          assignedServiceCount: input.options.assignments.filter(
            (assignment) =>
              assignment.staff_id === member.id && assignment.is_active,
          ).length,
          onlineAssignedServiceCount: onlineAssignments.length,
          ready: reasons.length === 0,
          reasons,
          staffId: member.id,
          upcomingBlockCount: input.options.timeBlocks.filter(
            (block) =>
              block.is_active !== false &&
              (!block.staff_id || block.staff_id === member.id),
          ).length,
          workingRuleCount: workingRules.length,
        },
      ];
    }),
  );
}

function bookingReadinessSteps(input: {
  bookingEnabled: boolean;
  onlineBookingVisible: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  timezoneIana: string;
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const warningCodes = new Set(input.warnings.map((warning) => warning.code));
  const missingAvailabilityStaffId = firstStaffMissingAvailability(input.options);

  return [
    {
      complete:
        !warningCodes.has("missing_active_services") &&
        !warningCodes.has("missing_online_services"),
      cta: "Manage services",
      href: "/services",
      id: "services",
      label: "Services",
    },
    {
      complete: !warningCodes.has("missing_staff_assignments"),
      cta: "Manage Booking staff",
      href: "/services",
      id: "assignments",
      label: "Booking staff",
    },
    {
      complete: !warningCodes.has("missing_availability"),
      cta: "Set staff hours",
      href: `/bookings?tab=availability${
        missingAvailabilityStaffId ? `&staffId=${missingAvailabilityStaffId}` : ""
      }`,
      id: "availability",
      label: "Staff availability",
    },
    {
      complete:
        input.bookingEnabled &&
        input.onlineBookingVisible &&
        Boolean(input.timezoneIana.trim()),
      cta: "Review settings",
      href: "/bookings?tab=settings",
      id: "settings",
      label: "Booking settings",
    },
  ];
}

function BookingReadinessPanel({
  bookingEnabled,
  onlineBookingVisible,
  options,
  publicBookingHref,
  timezoneIana,
  warnings,
}: {
  bookingEnabled: boolean;
  onlineBookingVisible: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  timezoneIana: string;
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const steps = bookingReadinessSteps({
    bookingEnabled,
    onlineBookingVisible,
    options,
    publicBookingHref,
    timezoneIana,
    warnings,
  });
  const completeCount = steps.filter((step) => step.complete).length;

  if (completeCount === steps.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-amber-950">
            Finish online booking setup
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            {completeCount} of {steps.length} steps complete. Manual appointments
            still work, but customers cannot book online until setup is complete.
          </p>
        </div>
        <a
          className="inline-flex min-h-10 w-fit items-center rounded-md border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950"
          href={publicBookingHref}
        >
          Review booking page
        </a>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <div
            className="rounded-md border border-amber-200 bg-white px-3 py-3"
            key={step.id}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-zinc-950">{step.label}</p>
              <span
                className={classNames(
                  "rounded-md px-2 py-1 text-xs font-semibold",
                  step.complete
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-100 text-amber-800",
                )}
              >
                {step.complete ? "Ready" : "Needs setup"}
              </span>
            </div>
            {!step.complete ? (
              <a
                className="mt-3 inline-flex min-h-9 items-center rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-950"
                href={step.href}
              >
                {step.cta}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function SettingsPanel({
  canManage,
  options,
  publicBookingHref,
  settings,
  warnings,
}: {
  canManage: boolean;
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  settings: BookingWorkspaceClientProps["settings"];
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<UpdateBookingSettingsInput>({
    anyProfessionalEnabled: settings.any_professional_enabled,
    bookingEnabled: settings.booking_enabled,
    cancellationWindowMinutes: settings.cancellation_window_minutes,
    confirmationMode: settings.confirmation_mode,
    defaultCleanupBufferMinutes: settings.default_cleanup_buffer_minutes,
    guestBookingEnabled: settings.guest_booking_enabled,
    maximumAdvanceWindowDays: settings.maximum_advance_window_days,
    minimumLeadTimeMinutes: settings.minimum_lead_time_minutes,
    onlineBookingVisible: settings.online_booking_visible,
    sameDayBookingEnabled: settings.same_day_booking_enabled,
    slotIntervalMinutes: settings.slot_interval_minutes,
    splitStaffAppointmentEnabled: settings.split_staff_appointment_enabled,
    ticketCreationMode: settings.ticket_creation_mode,
    timezoneIana: settings.timezone_iana,
  });

  function setBoolean(key: keyof UpdateBookingSettingsInput, value: boolean) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function setNumber(key: keyof UpdateBookingSettingsInput, value: string) {
    setState((current) => ({ ...current, [key]: Number(value) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await updateBookingSettingsAction(state);
      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  const readiness = bookingReadinessSteps({
    bookingEnabled: state.bookingEnabled,
    onlineBookingVisible: state.onlineBookingVisible,
    options,
    publicBookingHref,
    timezoneIana: state.timezoneIana,
    warnings,
  });
  const readinessByStaffId = useMemo(
    () => buildReadinessByStaff({ bookingEnabled: state.bookingEnabled, options }),
    [options, state.bookingEnabled],
  );
  const selectedAvailabilityStaffId = searchParams.get("staffId");

  function copyPublicUrl() {
    const url =
      typeof window === "undefined"
        ? publicBookingHref
        : `${window.location.origin}${publicBookingHref}`;
    void navigator.clipboard?.writeText(url);
  }

  return (
    <div className="grid gap-5">
      <form className="grid gap-5 rounded-lg border border-zinc-200 bg-white p-5" onSubmit={submit}>
      <Message result={result} />
      <section className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-[1fr_auto]">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">Public booking link</h3>
          <p className="mt-2 break-all rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700">
            {publicBookingHref}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {readiness.map((item) => (
              <li
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
                key={item.id}
              >
                <span>{item.label}</span>
                <span
                  className={classNames(
                    "rounded-md px-2 py-1 text-xs font-semibold",
                    item.complete
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-100 text-amber-800",
                  )}
                >
                  {item.complete ? "Ready" : "Needs setup"}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          <button
            className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm font-semibold text-zinc-800"
            onClick={copyPublicUrl}
            type="button"
          >
            Copy
          </button>
          <a
            className="grid min-h-10 place-items-center rounded-md bg-[#642a56] px-3 text-sm font-semibold text-white"
            href={publicBookingHref}
            rel="noreferrer"
            target="_blank"
          >
            Preview
          </a>
        </div>
      </section>
      <BookingReadinessPanel
        bookingEnabled={state.bookingEnabled}
        onlineBookingVisible={state.onlineBookingVisible}
        options={options}
        publicBookingHref={publicBookingHref}
        timezoneIana={state.timezoneIana}
        warnings={warnings}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Toggle
          checked={state.bookingEnabled}
          disabled={!canManage}
          label="Booking enabled"
          onChange={(value) => setBoolean("bookingEnabled", value)}
        />
        <Toggle
          checked={state.onlineBookingVisible}
          disabled={!canManage}
          label="Online booking visible"
          onChange={(value) => setBoolean("onlineBookingVisible", value)}
        />
        <Toggle
          checked={state.sameDayBookingEnabled}
          disabled={!canManage}
          label="Same-day booking"
          onChange={(value) => setBoolean("sameDayBookingEnabled", value)}
        />
        <Toggle
          checked={state.anyProfessionalEnabled}
          disabled={!canManage}
          label="Any Professional"
          onChange={(value) => setBoolean("anyProfessionalEnabled", value)}
        />
        <Toggle
          checked={state.splitStaffAppointmentEnabled}
          disabled={!canManage}
          label="Split-staff appointments"
          onChange={(value) => setBoolean("splitStaffAppointmentEnabled", value)}
        />
        <Toggle
          checked={state.guestBookingEnabled}
          disabled={!canManage}
          label="Guest booking"
          onChange={(value) => setBoolean("guestBookingEnabled", value)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700">Confirmation mode</span>
          <select
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                confirmationMode: event.target.value as BookingConfirmationMode,
              }))
            }
            value={state.confirmationMode}
          >
            <option value="request_confirmation">Request confirmation</option>
            <option value="instant_booking">Instant booking</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700">
            POS ticket creation
          </span>
          <select
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                ticketCreationMode: event.target.value as BookingTicketCreationMode,
              }))
            }
            value={state.ticketCreationMode}
          >
            <option value="manual">Manual</option>
            <option value="on_check_in">On check-in</option>
            <option value="on_service_start">On service start</option>
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label="Minimum lead time"
          onChange={(value) => setNumber("minimumLeadTimeMinutes", value)}
          suffix="min"
          value={state.minimumLeadTimeMinutes}
        />
        <NumberField
          disabled={!canManage}
          label="Maximum advance"
          onChange={(value) => setNumber("maximumAdvanceWindowDays", value)}
          suffix="days"
          value={state.maximumAdvanceWindowDays}
        />
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700">Slot interval</span>
          <select
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            disabled={!canManage}
            onChange={(event) => setNumber("slotIntervalMinutes", event.target.value)}
            value={state.slotIntervalMinutes}
          >
            {[5, 10, 15, 20, 30, 60].map((interval) => (
              <option key={interval} value={interval}>
                {interval} min
              </option>
            ))}
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label="Cleanup buffer"
          onChange={(value) => setNumber("defaultCleanupBufferMinutes", value)}
          suffix="min"
          value={state.defaultCleanupBufferMinutes}
        />
        <NumberField
          disabled={!canManage}
          label="Cancellation window"
          onChange={(value) => setNumber("cancellationWindowMinutes", value)}
          suffix="min"
          value={state.cancellationWindowMinutes}
        />
        <label className="grid gap-1">
          <span className="text-sm font-semibold text-zinc-700">Timezone</span>
          <input
            className="min-h-10 rounded-md border border-zinc-300 px-3 text-sm"
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({ ...current, timezoneIana: event.target.value }))
            }
            value={state.timezoneIana}
          />
        </label>
      </div>
      {canManage ? (
        <button
          className="w-fit min-h-10 rounded-md bg-[#642a56] px-4 text-sm font-semibold text-white disabled:opacity-60"
          disabled={isPending}
          type="submit"
        >
          {isPending ? "Saving" : "Save settings"}
        </button>
      ) : (
        <p className="text-sm text-zinc-600">You have read-only booking access.</p>
      )}
      </form>
      <StaffAvailabilityEditor
        availabilityRules={options.availabilityRules}
        canManage={canManage}
        readinessByStaffId={readinessByStaffId}
        selectedStaffId={selectedAvailabilityStaffId}
        staff={options.staff}
        timeBlocks={options.timeBlocks}
        timezone={state.timezoneIana}
      />
    </div>
  );
}

function BookingPagePanel({
  options,
  publicBookingHref,
  salonName,
  settings,
  warnings,
}: {
  options: BookingWorkspaceClientProps["options"];
  publicBookingHref: string;
  salonName: string;
  settings: BookingWorkspaceClientProps["settings"];
  warnings: BookingWorkspaceClientProps["warnings"];
}) {
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const readiness = bookingReadinessSteps({
    bookingEnabled: settings.booking_enabled,
    onlineBookingVisible: settings.online_booking_visible,
    options,
    publicBookingHref,
    timezoneIana: settings.timezone_iana,
    warnings,
  });
  const readyCount = readiness.filter((item) => item.complete).length;
  const isLive = settings.booking_enabled && settings.online_booking_visible;

  function copyPublicUrl() {
    const url =
      typeof window === "undefined"
        ? publicBookingHref
        : `${window.location.origin}${publicBookingHref}`;
    void navigator.clipboard?.writeText(url);
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[355px_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <article className={classNames(styles.panel, "p-5")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={styles.eyebrow}>Publishing</p>
              <h2 className="mt-3 text-xl font-extrabold text-[#211c24]">
                {isLive ? "Booking page is live" : "Booking page is offline"}
              </h2>
            </div>
            <span
              className={classNames(
                styles.statusBadge,
                isLive ? styles.statusArrived : styles.statusPending,
              )}
            >
              {isLive ? "Live" : "Offline"}
            </span>
          </div>
          <p className="mt-4 break-all rounded-xl border border-[#e7dfe5] bg-[#fbfafb] px-3 py-3 text-sm text-[#211c24]">
            {publicBookingHref}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className={classNames(styles.secondaryButton, "px-4")}
              onClick={copyPublicUrl}
              type="button"
            >
              Copy
            </button>
            <a
              className={classNames(styles.primaryButton, "px-4")}
              href={publicBookingHref}
              rel="noreferrer"
              target="_blank"
            >
              Open public page
            </a>
          </div>
        </article>

        <article className={classNames(styles.panel, "p-5")}>
          <p className={styles.eyebrow}>Readiness</p>
          <h2 className="mt-3 text-xl font-extrabold text-[#211c24]">
            {readyCount} of {readiness.length} checks ready
          </h2>
          <div className="mt-4 grid gap-2">
            {readiness.map((item) => (
              <a
                className="flex items-center justify-between gap-3 rounded-xl border border-[#e7dfe5] bg-white px-3 py-3 text-sm transition hover:border-[#d7c8d3]"
                href={item.href}
                key={item.id}
              >
                <span className="font-extrabold text-[#211c24]">{item.label}</span>
                <span
                  className={classNames(
                    styles.statusBadge,
                    item.complete ? styles.statusArrived : styles.statusPending,
                  )}
                >
                  {item.complete ? "Ready" : "Needs setup"}
                </span>
              </a>
            ))}
          </div>
        </article>

        <article className={classNames(styles.panel, "p-5")}>
          <p className={styles.eyebrow}>Booking health</p>
          <h2 className="mt-3 text-xl font-extrabold text-[#211c24]">
            {Math.round((readyCount / Math.max(1, readiness.length)) * 100)}%
          </h2>
          <p className="mt-2 text-sm leading-6 text-[#786d78]">
            {readyCount === readiness.length
              ? "Customers can reach the live booking flow with current services, staff, and scheduling rules."
              : "Finish the remaining readiness items before promoting the booking page."}
          </p>
        </article>
      </div>

      <article className={classNames(styles.panel, "min-w-0 p-5")}>
        <div className="flex flex-col gap-3 border-b border-[#e7dfe5] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className={styles.eyebrow}>Customer preview</p>
            <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">{salonName}</h2>
          </div>
          <div className="flex rounded-xl border border-[#d7c8d3] bg-white p-1">
            {(["desktop", "mobile"] as const).map((mode) => (
              <button
                className={classNames(
                  "min-h-9 rounded-lg px-3 text-sm font-extrabold",
                  previewMode === mode
                    ? "bg-[#642a56] text-white"
                    : "text-[#786d78] hover:bg-[#f7f2f7]",
                )}
                key={mode}
                onClick={() => setPreviewMode(mode)}
                type="button"
              >
                {mode === "desktop" ? "Desktop" : "Mobile"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-[#d7c8d3] bg-[#f7f2f7] p-3">
          <div className="mb-3 flex gap-1.5 px-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#d7c8d3]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#d7c8d3]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#d7c8d3]" />
          </div>
          <div
            className={classNames(
              "mx-auto overflow-hidden rounded-xl border border-[#e7dfe5] bg-white",
              previewMode === "mobile" ? "max-w-[390px]" : "w-full",
            )}
          >
            <iframe
              className="h-[640px] w-full bg-white"
              src={publicBookingHref}
              title="Public booking preview"
            />
          </div>
        </div>
      </article>
    </section>
  );
}

function AvailabilityPanel({
  canManage,
  options,
  settings,
}: {
  canManage: boolean;
  options: BookingWorkspaceClientProps["options"];
  settings: BookingWorkspaceClientProps["settings"];
}) {
  const searchParams = useSearchParams();
  const readinessByStaffId = useMemo(
    () =>
      buildReadinessByStaff({
        bookingEnabled: settings.booking_enabled,
        options,
      }),
    [options, settings.booking_enabled],
  );

  return (
    <section className={classNames(styles.panel, "p-5")}>
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={styles.eyebrow}>Availability</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-[#211c24]">
            Staff schedule
          </h2>
          <p className="mt-1 text-sm text-[#786d78]">
            Working intervals, breaks, time off, and booking blocks.
          </p>
        </div>
      </div>
      <StaffAvailabilityEditor
        availabilityRules={options.availabilityRules}
        canManage={canManage}
        readinessByStaffId={readinessByStaffId}
        selectedStaffId={searchParams.get("staffId")}
        staff={options.staff}
        timeBlocks={options.timeBlocks}
        timezone={settings.timezone_iana}
      />
    </section>
  );
}

function OwnerSettingsPanel({
  canManage,
  settings,
}: {
  canManage: boolean;
  settings: BookingWorkspaceClientProps["settings"];
}) {
  const router = useRouter();
  const [result, setResult] = useState<BookingActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<UpdateBookingSettingsInput>({
    anyProfessionalEnabled: settings.any_professional_enabled,
    bookingEnabled: settings.booking_enabled,
    cancellationWindowMinutes: settings.cancellation_window_minutes,
    confirmationMode: settings.confirmation_mode,
    defaultCleanupBufferMinutes: settings.default_cleanup_buffer_minutes,
    guestBookingEnabled: settings.guest_booking_enabled,
    maximumAdvanceWindowDays: settings.maximum_advance_window_days,
    minimumLeadTimeMinutes: settings.minimum_lead_time_minutes,
    onlineBookingVisible: settings.online_booking_visible,
    sameDayBookingEnabled: settings.same_day_booking_enabled,
    slotIntervalMinutes: settings.slot_interval_minutes,
    splitStaffAppointmentEnabled: settings.split_staff_appointment_enabled,
    ticketCreationMode: settings.ticket_creation_mode,
    timezoneIana: settings.timezone_iana,
  });

  function setBoolean(key: keyof UpdateBookingSettingsInput, value: boolean) {
    setState((current) => ({ ...current, [key]: value }));
  }

  function setNumber(key: keyof UpdateBookingSettingsInput, value: string) {
    setState((current) => ({ ...current, [key]: Number(value) }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const response = await updateBookingSettingsAction(state);
      setResult(response);

      if (response.ok) {
        router.refresh();
      }
    });
  }

  return (
    <form className="grid gap-4 xl:grid-cols-2" onSubmit={submit}>
      <div className="xl:col-span-2">
        <Message result={result} />
      </div>
      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}>Online booking</p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">Publishing controls</h2>
        </div>
        <Toggle
          checked={state.bookingEnabled}
          disabled={!canManage}
          label="Booking enabled"
          onChange={(value) => setBoolean("bookingEnabled", value)}
        />
        <Toggle
          checked={state.onlineBookingVisible}
          disabled={!canManage}
          label="Online booking visible"
          onChange={(value) => setBoolean("onlineBookingVisible", value)}
        />
        <Toggle
          checked={state.sameDayBookingEnabled}
          disabled={!canManage}
          label="Same-day booking"
          onChange={(value) => setBoolean("sameDayBookingEnabled", value)}
        />
      </section>

      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}>Scheduling rules</p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">Time windows</h2>
        </div>
        <NumberField
          disabled={!canManage}
          label={`Minimum lead time (${formatMinutes(state.minimumLeadTimeMinutes)})`}
          onChange={(value) => setNumber("minimumLeadTimeMinutes", value)}
          suffix="min"
          value={state.minimumLeadTimeMinutes}
        />
        <NumberField
          disabled={!canManage}
          label="Maximum advance"
          onChange={(value) => setNumber("maximumAdvanceWindowDays", value)}
          suffix="days"
          value={state.maximumAdvanceWindowDays}
        />
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]">Slot interval</span>
          <select
            className={styles.select}
            disabled={!canManage}
            onChange={(event) => setNumber("slotIntervalMinutes", event.target.value)}
            value={state.slotIntervalMinutes}
          >
            {[5, 10, 15, 20, 30, 60].map((interval) => (
              <option key={interval} value={interval}>
                {interval} min
              </option>
            ))}
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label="Cleanup buffer"
          onChange={(value) => setNumber("defaultCleanupBufferMinutes", value)}
          suffix="min"
          value={state.defaultCleanupBufferMinutes}
        />
      </section>

      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}>Confirmation</p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">Booking outcome</h2>
        </div>
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]">Confirmation mode</span>
          <select
            className={styles.select}
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                confirmationMode: event.target.value as BookingConfirmationMode,
              }))
            }
            value={state.confirmationMode}
          >
            <option value="request_confirmation">Request confirmation</option>
            <option value="instant_booking">Instant booking</option>
          </select>
        </label>
        <NumberField
          disabled={!canManage}
          label={`Cancellation window (${formatMinutes(state.cancellationWindowMinutes)})`}
          onChange={(value) => setNumber("cancellationWindowMinutes", value)}
          suffix="min"
          value={state.cancellationWindowMinutes}
        />
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]">POS ticket creation</span>
          <select
            className={styles.select}
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                ticketCreationMode: event.target.value as BookingTicketCreationMode,
              }))
            }
            value={state.ticketCreationMode}
          >
            <option value="manual">Manual</option>
            <option value="on_check_in">On check-in</option>
            <option value="on_service_start">On service start</option>
          </select>
        </label>
      </section>

      <section className={classNames(styles.panel, "grid gap-4 p-5")}>
        <div>
          <p className={styles.eyebrow}>Professional assignment</p>
          <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">Customer choice</h2>
        </div>
        <Toggle
          checked={state.anyProfessionalEnabled}
          disabled={!canManage}
          label="Any Professional"
          onChange={(value) => setBoolean("anyProfessionalEnabled", value)}
        />
        <Toggle
          checked={state.splitStaffAppointmentEnabled}
          disabled={!canManage}
          label="Split-staff appointments"
          onChange={(value) => setBoolean("splitStaffAppointmentEnabled", value)}
        />
        <Toggle
          checked={state.guestBookingEnabled}
          disabled={!canManage}
          label="Guest booking"
          onChange={(value) => setBoolean("guestBookingEnabled", value)}
        />
        <label className="grid gap-1">
          <span className="text-sm font-extrabold text-[#211c24]">Timezone</span>
          <input
            className={styles.field}
            disabled={!canManage}
            onChange={(event) =>
              setState((current) => ({ ...current, timezoneIana: event.target.value }))
            }
            value={state.timezoneIana}
          />
        </label>
      </section>

      <div className="xl:col-span-2">
        {canManage ? (
          <button
            className={classNames(styles.primaryButton, "px-5")}
            disabled={isPending}
            type="submit"
          >
            {isPending ? "Saving" : "Save settings"}
          </button>
        ) : (
          <p className="text-sm text-[#786d78]">You have read-only booking access.</p>
        )}
      </div>
    </form>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[#e7dfe5] bg-white px-3">
      <span className="text-sm font-extrabold text-[#211c24]">{label}</span>
      <input
        checked={checked}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <span
        aria-hidden="true"
        className={classNames(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-[#642a56]" : "bg-[#d7c8d3]",
          disabled && "opacity-50",
        )}
      >
        <span
          className={classNames(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </span>
    </label>
  );
}

function NumberField({
  disabled,
  label,
  onChange,
  suffix,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  suffix: string;
  value: number;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-extrabold text-[#211c24]">{label}</span>
      <div className="flex overflow-hidden rounded-xl border border-[#e7dfe5] bg-white">
        <input
          className="min-h-10 min-w-0 flex-1 px-3 text-sm outline-none"
          disabled={disabled}
          min={0}
          onChange={(event) => onChange(event.target.value)}
          type="number"
          value={value}
        />
        <span className="grid min-h-10 place-items-center border-l border-[#e7dfe5] px-3 text-sm text-[#786d78]">
          {suffix}
        </span>
      </div>
    </label>
  );
}

export function BookingWorkspaceClient({
  bookings,
  canManageBookings,
  filters,
  options,
  organizationName,
  publicBookingHref,
  range,
  requests,
  salonName,
  settings,
  timezone,
  warnings,
}: BookingWorkspaceClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedBookingId =
    searchParams.get("bookingId") ?? filters.selectedBookingId;
  const selectedBooking = useMemo(
    () =>
      selectedBookingId
        ? (bookings.find((booking) => booking.id === selectedBookingId) ?? null)
        : null,
    [bookings, selectedBookingId],
  );
  const [drawerPrefill, setDrawerPrefill] = useState<DraftPrefill | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  function openBooking(booking: BookingWorkspaceItem) {
    router.replace(
      buildUrl(pathname, searchParams, { bookingId: booking.id }),
      { scroll: false },
    );
  }

  function closeBooking() {
    router.replace(buildUrl(pathname, searchParams, { bookingId: null }), {
      scroll: false,
    });
  }

  function openRequest(request: BookingWorkspaceRequest) {
    setDrawerPrefill({
      customerUserId: request.customerUserId,
      internalNotes: [
        request.privateNote,
        request.lookId ? `Look ID: ${request.lookId}` : null,
        `Legacy request ID: ${request.id}`,
      ]
        .filter(Boolean)
        .join("\n"),
      serviceId: request.serviceId,
      source: "legacy_request",
      sourceReferenceId: request.id,
      sourceReferenceType: "salon_profile_booking_request",
      staffId: request.staffId,
      startLocal: request.requestedStartAt
        ? toLocalInputValue(request.requestedStartAt, timezone)
        : null,
    });
    setShowCreate(true);
  }

  const appointmentCount = selectedDateBookings(
    bookings,
    filters.date,
    timezone,
  ).filter(activeBooking).length;
  const setupIncomplete = bookingReadinessSteps({
    bookingEnabled: settings.booking_enabled,
    onlineBookingVisible: settings.online_booking_visible,
    options,
    publicBookingHref,
    timezoneIana: settings.timezone_iana,
    warnings,
  }).some((step) => !step.complete);

  return (
    <main
      aria-label={`${organizationName} ${salonName} booking workspace`}
      className={classNames(styles.bookingSurface, styles.ownerRoot)}
      data-booking-surface="owner"
      data-testid="booking-owner-root"
    >
      <section className={styles.ownerHeader}>
        <div className={styles.ownerFrame}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0" data-testid="booking-owner-heading">
              <p className={styles.eyebrow}>Customer experience</p>
              <h1 className={classNames(styles.pageTitle, "mt-4")}>Booking</h1>
              <p className={classNames(styles.pageSubtitle, "mt-3")}>
                Manage appointments, online availability, and the page your customers see.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManageBookings ? (
                <button
                  className={classNames(styles.primaryButton, "gap-2 px-5")}
                  data-testid="booking-owner-new-appointment"
                  onClick={() => {
                    setDrawerPrefill(null);
                    setShowCreate(true);
                  }}
                  type="button"
                >
                  <span aria-hidden="true" className="text-xl leading-none">+</span>
                  <span>New appointment</span>
                </button>
              ) : null}
            </div>
          </div>
          <WorkspaceTabs
            appointmentCount={appointmentCount}
            filters={filters}
            setupIncomplete={setupIncomplete}
          />
        </div>
      </section>

      <section className={styles.ownerContent}>
        {filters.tab === "calendar" ? (
          <>
            <KpiGrid
              bookings={bookings}
              date={filters.date}
              options={options}
              timezone={timezone}
            />
            <section
              className={styles.workspaceCard}
              data-testid="booking-owner-board"
            >
              <div className={styles.toolbar} data-testid="booking-owner-toolbar">
                <DateNavigation
                  filters={filters}
                  timezone={timezone}
                />
                <FilterBar filters={filters} options={options} />
                <ViewTabs filters={filters} />
              </div>
              <QuickStatusRow
                bookings={bookings}
                filters={filters}
                timezone={timezone}
              />
              <CalendarView
                bookings={bookings}
                filters={filters}
                onOpen={openBooking}
                options={options}
                range={range}
                timezone={timezone}
              />
            </section>
            {requests.length > 0 ? (
              <section className={classNames(styles.panel, "p-5")}>
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className={styles.eyebrow}>Request inbox</p>
                    <h2 className="mt-2 text-xl font-extrabold text-[#211c24]">
                      Legacy requests
                    </h2>
                  </div>
                  <p className="text-sm text-[#786d78]">
                    {requests.length} request{requests.length === 1 ? "" : "s"}
                  </p>
                </div>
                <RequestsPanel
                  canManage={canManageBookings}
                  onConvert={openRequest}
                  requests={requests}
                  timezone={timezone}
                />
              </section>
            ) : null}
          </>
        ) : null}

        {filters.tab === "booking-page" ? (
          <BookingPagePanel
            options={options}
            publicBookingHref={publicBookingHref}
            salonName={salonName}
            settings={settings}
            warnings={warnings}
          />
        ) : null}

        {filters.tab === "availability" ? (
          <AvailabilityPanel
            canManage={canManageBookings}
            options={options}
            settings={settings}
          />
        ) : null}

        {filters.tab === "settings" ? (
          <OwnerSettingsPanel
            canManage={canManageBookings}
            settings={settings}
          />
        ) : null}
      </section>

      {selectedBooking ? (
        <DetailDrawer
          booking={selectedBooking}
          canManage={canManageBookings}
          onClose={closeBooking}
          options={options}
          settings={settings}
          timezone={timezone}
        />
      ) : null}

      {showCreate ? (
        <AppointmentDrawer
          bookings={bookings}
          onClose={() => setShowCreate(false)}
          options={options}
          prefill={drawerPrefill}
          settings={settings}
          timezone={timezone}
        />
      ) : null}
    </main>
  );
}
