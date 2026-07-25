import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import {
  BOOKING_INSPIRATION_SELECT,
  mapBookingInspirationsByBookingId,
} from "@/lib/booking-inspirations";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { POS_TICKET_WITH_RELATIONS_SELECT } from "@/lib/pos-tickets";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  Booking,
  BookingInspiration,
  BookingInspirationView,
  BookingLine,
  BookingSettings,
  BookingSource,
  BookingStatus,
  BookingStatusEvent,
  BookingWithRelations,
  StaffAvailabilityRule,
  StaffServiceAssignment,
  StaffTimeBlock,
} from "@/types/booking";
import { BOOKING_SOURCES, CANONICAL_BOOKING_STATUSES, normalizeBookingStatus } from "@/types/booking";
import type { Customer } from "@/types/customer";
import type { PosTicketStatus, PosTicketWithRelations } from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

export const BOOKING_SELECT =
  "id, salon_id, customer_id, customer_user_id, customer_account_linked_at, customer_account_linked_by_user_id, customer_account_link_method, customer_account_link_metadata, staff_id, start_at, end_at, notes, public_notes, internal_notes, status, source, confirmation_mode, confirmation_status, salon_timezone_snapshot, customer_cancellation_token_hash, pos_ticket_id, source_reference_type, source_reference_id, idempotency_key, cancellation_reason, cancelled_at, cancelled_by_user_id, no_show_at, no_show_by_user_id, no_show_reason, created_by_user_id, updated_by_user_id, payment_status, deposit_policy_snapshot, cancellation_policy_snapshot, created_at, updated_at";

export const BOOKING_WITH_RELATIONS_SELECT = `${BOOKING_SELECT}, customer:customers(id, name, phone, email), staff:staff(id, display_name)`;

export const BOOKING_PERMISSIONS = {
  view: "booking.view",
  manage: "booking.manage",
} as const;

export const BOOKING_CUSTOMER_OPTION_SELECT =
  "id, location_id, customer_user_id, name, phone, email, notes, staff_notes, internal_notes, source, status, created_by_user_id, updated_by_user_id, created_at, updated_at";
export const BOOKING_STAFF_OPTION_SELECT =
  "id, salon_id, user_id, account_user_id, display_name, first_name, last_name, phone, email, address_line1, address_line2, city, state, postal_code, job_title, pos_enabled, public_profile_photo_path, public_bio, public_profile_visible, owner_public_enabled, staff_public_consent_status, online_booking_enabled, profile_display_order, salon_profile_content_posting_enabled, specialties, is_active, created_at, updated_at";
export const BOOKING_SERVICE_OPTION_SELECT =
  "id, salon_id, name, category, base_price, duration_minutes, description, is_active, online_booking_enabled, created_at, updated_at";
export const BOOKING_SETTINGS_SELECT =
  "id, salon_id, booking_enabled, online_booking_visible, confirmation_mode, minimum_lead_time_minutes, maximum_advance_window_days, slot_interval_minutes, default_cleanup_buffer_minutes, same_day_booking_enabled, cancellation_window_minutes, late_cancellation_policy, no_show_policy, any_professional_enabled, split_staff_appointment_enabled, guest_booking_enabled, timezone_iana, ticket_creation_mode, payment_required_enabled, deposit_required_enabled, deposit_policy, created_at, updated_at";
export const BOOKING_LINE_SELECT =
  "id, salon_id, booking_id, parent_booking_line_id, line_type, service_id, service_name_snapshot, service_category_snapshot, service_description_snapshot, unit_price, quantity, line_total, duration_minutes, cleanup_buffer_minutes, display_order, assigned_staff_id, scheduled_start_at, scheduled_end_at, line_status, started_at, completed_at, performed_by_staff_id, service_note, internal_staff_note, line_status_updated_at, line_status_updated_by_user_id, overbooking_override_reason, overbooking_override_by_user_id, overbooking_override_at, created_at, updated_at";
export const BOOKING_STATUS_EVENT_SELECT =
  "id, salon_id, booking_id, event_type, old_status, new_status, actor_user_id, actor_staff_id, actor_source, metadata, created_at";

export type BookingWorkspaceView = "day" | "list" | "week";

export type BookingWorkspaceSearchParams = {
  bookingId?: string | string[];
  date?: string | string[];
  q?: string | string[];
  request?: string | string[];
  section?: string | string[];
  service?: string | string[];
  source?: string | string[];
  staff?: string | string[];
  staffId?: string | string[];
  status?: string | string[];
  tab?: string | string[];
  view?: string | string[];
};

export type BookingWorkspaceFilters = {
  date: string;
  query: string;
  selectedBookingId: string | null;
  selectedRequestId: string | null;
  serviceId: string | null;
  source: BookingSource | null;
  staffId: string | null;
  status: BookingStatus | null;
  tab: "availability" | "booking-page" | "calendar" | "settings";
  view: BookingWorkspaceView;
};

export type BookingWorkspaceRange = {
  days: {
    date: string;
    label: string;
  }[];
  endIso: string;
  label: string;
  startIso: string;
};

export type BookingWorkspaceLine = BookingLine & {
  assignedStaffName: string | null;
  performedByStaffName: string | null;
};

export type BookingWorkspaceTicketSummary = {
  closedAt: string | null;
  id: string;
  openedAt: string;
  paymentStatus: "paid" | "partial" | "unpaid";
  sourceBookingId: string | null;
  status: PosTicketStatus;
  ticketNumber: string;
  totals: ReturnType<typeof calculateTicketTotals>;
};

export type BookingWorkspaceItem = Booking & {
  assignedStaffNames: string[];
  customer: Pick<Customer, "email" | "id" | "name" | "phone"> | null;
  durationMinutes: number;
  events: BookingStatusEvent[];
  hasOverbookingOverride: boolean;
  inspiration: BookingInspirationView | null;
  lines: BookingWorkspaceLine[];
  normalizedStatus: Exclude<BookingStatus, "scheduled">;
  posTicket: BookingWorkspaceTicketSummary | null;
  serviceNames: string[];
  staff: Pick<Staff, "display_name" | "id"> | null;
  subtotal: number;
};

export type BookingWorkspaceRequest = {
  customerEmail: string | null;
  customerName: string;
  customerPhone: string | null;
  customerUserId: string;
  createdAt: string;
  id: string;
  lookId: string | null;
  privateNote: string | null;
  requestedStartAt: string | null;
  serviceId: string | null;
  serviceName: string | null;
  staffId: string | null;
  staffName: string | null;
  status: "approved" | "cancelled" | "declined" | "requested";
};

export type BookingWorkspaceOptions = {
  assignments: StaffServiceAssignment[];
  availabilityRules: StaffAvailabilityRule[];
  customers: Pick<Customer, "email" | "id" | "name" | "phone">[];
  services: Service[];
  staff: Staff[];
  timeBlocks: StaffTimeBlock[];
};

export type BookingWorkspaceConfigWarning = {
  code:
    | "missing_active_services"
    | "missing_availability"
    | "missing_online_services"
    | "missing_staff_assignments";
  message: string;
};

export type BookingWorkspaceData = {
  bookings: BookingWorkspaceItem[];
  canManageBookings: boolean;
  canViewBookings: boolean;
  context: CurrentBusinessContext;
  filters: BookingWorkspaceFilters;
  options: BookingWorkspaceOptions;
  range: BookingWorkspaceRange;
  requests: BookingWorkspaceRequest[];
  settings: BookingSettings;
  timezone: string;
  warnings: BookingWorkspaceConfigWarning[];
};

type BookingWithCustomerStaffRow = Booking & {
  customer: Pick<Customer, "email" | "id" | "name" | "phone"> | null;
  staff: Pick<Staff, "display_name" | "id"> | null;
};

type BookingRequestRow = {
  created_at: string;
  customer_user_id: string;
  id: string;
  look_id: string | null;
  private_note: string | null;
  requested_start_at: string | null;
  service_id: string | null;
  staff_id: string | null;
  status: "approved" | "cancelled" | "declined" | "requested";
};

type RequestUserRow = {
  display_name: string | null;
  email: string | null;
  first_name: string | null;
  id: string;
  last_name: string | null;
  phone: string | null;
};

function requireCurrentAccountAndSalon(context: CurrentBusinessContext) {
  if (!isSalonManageContext(context)) {
    throw new Error("Open bookings from a Business workspace.");
  }

  if (!context.currentAccount) {
    throw new Error("Choose a salon workspace before managing bookings.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  return {
    Account: context.currentAccount,
    salon: context.currentSalon,
  };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanParam(value: string | string[] | undefined) {
  return firstParam(value)?.trim() ?? "";
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + days));
  return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(
    utcDate.getUTCDate(),
  )}`;
}

function dayOfWeek(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
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

export function zonedDateTimeToUtcIso(input: {
  date: string;
  time: string;
  timeZone: string;
}) {
  if (!isIsoDate(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return null;
  }

  const [year, month, day] = input.date.split("-").map(Number);
  const [hour, minute] = input.time.split(":").map(Number);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const firstOffset = timeZoneOffsetMs(utcGuess, input.timeZone);
  const firstResult = new Date(utcGuess.getTime() - firstOffset);
  const secondOffset = timeZoneOffsetMs(firstResult, input.timeZone);

  return new Date(utcGuess.getTime() - secondOffset).toISOString();
}

export function localDateTimeToUtcIso(value: string, timeZone: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/);

  if (!match) {
    return null;
  }

  return zonedDateTimeToUtcIso({
    date: match[1],
    time: match[2],
    timeZone,
  });
}

export function formatDateInTimeZone(date: Date, timeZone: string) {
  const parts = timeZoneParts(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function labelForDate(date: string, timeZone: string) {
  const startIso = zonedDateTimeToUtcIso({
    date,
    time: "12:00",
    timeZone,
  });

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(startIso ? new Date(startIso) : new Date(`${date}T12:00:00Z`));
}

function normalizeView(value: string): BookingWorkspaceView {
  return value === "day" || value === "week" ? value : "list";
}

function normalizeTab(
  value: string,
  section: string,
): BookingWorkspaceFilters["tab"] {
  if (value === "availability" || section === "availability") {
    return "availability";
  }

  if (value === "booking-page" || value === "booking_page") {
    return "booking-page";
  }

  if (value === "settings") {
    return "settings";
  }

  return "calendar";
}

function normalizeStatusFilter(value: string) {
  if (!value) {
    return null;
  }

  if (value === "scheduled") {
    return "scheduled" as const;
  }

  if (CANONICAL_BOOKING_STATUSES.includes(value as Exclude<BookingStatus, "scheduled">)) {
    return value as BookingStatus;
  }

  return null;
}

function normalizeSourceFilter(value: string) {
  if (BOOKING_SOURCES.includes(value as BookingSource)) {
    return value as BookingSource;
  }

  return null;
}

function defaultBookingSettings(input: {
  accountId: string;
  salonId: string;
  timezone: string;
}): BookingSettings {
  const now = new Date(0).toISOString();

  return {
    any_professional_enabled: false,
    booking_enabled: false,
    cancellation_window_minutes: 1440,
    confirmation_mode: "request_confirmation",
    created_at: now,
    default_cleanup_buffer_minutes: 0,
    deposit_policy: {},
    deposit_required_enabled: false,
    guest_booking_enabled: false,
    id: "",
    late_cancellation_policy: {},
    maximum_advance_window_days: 30,
    minimum_lead_time_minutes: 0,
    no_show_policy: {},
    online_booking_visible: false,
    payment_required_enabled: false,
    same_day_booking_enabled: true,
    salon_id: input.salonId,
    slot_interval_minutes: 15,
    split_staff_appointment_enabled: true,
    ticket_creation_mode: "manual",
    timezone_iana: input.timezone,
    updated_at: now,
  };
}

function buildFilters(
  rawSearchParams: BookingWorkspaceSearchParams,
  timeZone: string,
): BookingWorkspaceFilters {
  const requestedDate = cleanParam(rawSearchParams.date);
  const today = formatDateInTimeZone(new Date(), timeZone);

  return {
    date: isIsoDate(requestedDate) ? requestedDate : today,
    query: cleanParam(rawSearchParams.q),
    selectedBookingId: cleanParam(rawSearchParams.bookingId) || null,
    selectedRequestId: cleanParam(rawSearchParams.request) || null,
    serviceId: cleanParam(rawSearchParams.service) || null,
    source: normalizeSourceFilter(cleanParam(rawSearchParams.source)),
    staffId: cleanParam(rawSearchParams.staff) || null,
    status: normalizeStatusFilter(cleanParam(rawSearchParams.status)),
    tab: normalizeTab(
      cleanParam(rawSearchParams.tab),
      cleanParam(rawSearchParams.section),
    ),
    view: normalizeView(cleanParam(rawSearchParams.view)),
  };
}

function buildRange(filters: BookingWorkspaceFilters, timeZone: string) {
  const startDate =
    filters.view === "week"
      ? addDays(filters.date, -dayOfWeek(filters.date))
      : filters.date;
  const spanDays = filters.view === "week" ? 7 : 1;
  const endDate = addDays(startDate, spanDays);
  const startIso =
    zonedDateTimeToUtcIso({ date: startDate, time: "00:00", timeZone }) ??
    `${startDate}T00:00:00.000Z`;
  const endIso =
    zonedDateTimeToUtcIso({ date: endDate, time: "00:00", timeZone }) ??
    `${endDate}T00:00:00.000Z`;
  const days = Array.from({ length: spanDays }, (_, index) => {
    const date = addDays(startDate, index);

    return {
      date,
      label: labelForDate(date, timeZone),
    };
  });

  return {
    days,
    endIso,
    label:
      filters.view === "week"
        ? `${labelForDate(startDate, timeZone)} - ${labelForDate(
            addDays(endDate, -1),
            timeZone,
          )}`
        : labelForDate(startDate, timeZone),
    startIso,
  };
}

function numberValue(value: string | number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function groupByBookingId<T extends { booking_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const currentRows = grouped.get(row.booking_id) ?? [];
    currentRows.push(row);
    grouped.set(row.booking_id, currentRows);
  }

  return grouped;
}

function paymentStatusFromTotals(
  totals: ReturnType<typeof calculateTicketTotals>,
): BookingWorkspaceTicketSummary["paymentStatus"] {
  const totalCents = Math.round(totals.total * 100);
  const paidCents = Math.round(totals.paid * 100);

  if (totalCents > 0 && paidCents >= totalCents) {
    return "paid";
  }

  return paidCents > 0 ? "partial" : "unpaid";
}

function buildTicketSummary(
  ticket: PosTicketWithRelations,
): BookingWorkspaceTicketSummary {
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: ticket.ticket_items ?? [],
    payments: ticket.payments ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });

  return {
    closedAt: ticket.closed_at,
    id: ticket.id,
    openedAt: ticket.opened_at,
    paymentStatus: paymentStatusFromTotals(totals),
    sourceBookingId: ticket.source_booking_id,
    status: ticket.status,
    ticketNumber: ticket.ticket_number,
    totals,
  };
}

function mapTicketsToBookings(
  tickets: PosTicketWithRelations[],
  bookings: BookingWithCustomerStaffRow[],
) {
  const bookingIdByTicketId = new Map(
    bookings
      .filter((booking) => booking.pos_ticket_id)
      .map((booking) => [booking.pos_ticket_id as string, booking.id]),
  );
  const byBookingId = new Map<string, BookingWorkspaceTicketSummary>();

  for (const ticket of tickets) {
    const bookingId =
      ticket.source_booking_id ?? bookingIdByTicketId.get(ticket.id) ?? null;

    if (bookingId && !byBookingId.has(bookingId)) {
      byBookingId.set(bookingId, buildTicketSummary(ticket));
    }
  }

  return byBookingId;
}

function customerName(user: RequestUserRow | null) {
  if (!user) {
    return "Customer";
  }

  return (
    user.display_name?.trim() ||
    [user.first_name, user.last_name]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") ||
    user.email ||
    user.phone ||
    "Customer"
  );
}

function matchesBookingFilters(input: {
  booking: BookingWorkspaceItem;
  filters: BookingWorkspaceFilters;
}) {
  const { booking, filters } = input;

  if (filters.status) {
    const normalizedFilter = normalizeBookingStatus(filters.status);

    if (booking.normalizedStatus !== normalizedFilter) {
      return false;
    }
  }

  if (filters.source && booking.source !== filters.source) {
    return false;
  }

  if (filters.staffId) {
    const lineStaffMatch = booking.lines.some(
      (line) => line.assigned_staff_id === filters.staffId,
    );

    if (booking.staff_id !== filters.staffId && !lineStaffMatch) {
      return false;
    }
  }

  if (
    filters.serviceId &&
    !booking.lines.some((line) => line.service_id === filters.serviceId)
  ) {
    return false;
  }

  if (filters.query) {
    const query = filters.query.toLowerCase();
    const haystack = [
      booking.id,
      booking.idempotency_key,
      booking.source_reference_id,
      booking.customer?.name,
      booking.customer?.phone,
      booking.customer?.email,
      ...booking.serviceNames,
      ...booking.assignedStaffNames,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(query)) {
      return false;
    }
  }

  return true;
}

function mapBookings(input: {
  bookings: BookingWithCustomerStaffRow[];
  events: BookingStatusEvent[];
  inspirationsByBookingId?: Map<string, BookingInspirationView>;
  lines: BookingLine[];
  staff: Staff[];
  ticketsByBookingId?: Map<string, BookingWorkspaceTicketSummary>;
}) {
  const linesByBookingId = groupByBookingId(input.lines);
  const eventsByBookingId = groupByBookingId(input.events);
  const staffById = new Map(input.staff.map((staff) => [staff.id, staff]));

  return input.bookings.map((booking) => {
    const lines = (linesByBookingId.get(booking.id) ?? [])
      .slice()
      .sort((left, right) => left.display_order - right.display_order)
      .map((line) => ({
        ...line,
        assignedStaffName: line.assigned_staff_id
          ? (staffById.get(line.assigned_staff_id)?.display_name ?? null)
          : null,
        performedByStaffName: line.performed_by_staff_id
          ? (staffById.get(line.performed_by_staff_id)?.display_name ?? null)
          : null,
      }));
    const events = (eventsByBookingId.get(booking.id) ?? [])
      .slice()
      .sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
    const assignedStaffNames = [
      ...new Set(
        [
          booking.staff?.display_name,
          ...lines.map((line) => line.assignedStaffName),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const serviceNames = [
      ...new Set(lines.map((line) => line.service_name_snapshot).filter(Boolean)),
    ];

    return {
      ...booking,
      assignedStaffNames,
      durationMinutes: Math.max(
        0,
        Math.round(
          (new Date(booking.end_at).getTime() -
            new Date(booking.start_at).getTime()) /
            60000,
        ),
      ),
      events,
      hasOverbookingOverride: lines.some((line) =>
        Boolean(line.overbooking_override_reason),
      ),
      inspiration: input.inspirationsByBookingId?.get(booking.id) ?? null,
      lines,
      normalizedStatus: normalizeBookingStatus(booking.status),
      posTicket: input.ticketsByBookingId?.get(booking.id) ?? null,
      serviceNames,
      subtotal: lines.reduce((sum, line) => sum + numberValue(line.line_total), 0),
    } satisfies BookingWorkspaceItem;
  });
}

function buildWarnings(input: {
  assignments: StaffServiceAssignment[];
  availabilityRules: StaffAvailabilityRule[];
  services: Service[];
}) {
  const warnings: BookingWorkspaceConfigWarning[] = [];

  if (input.services.filter((service) => service.is_active).length === 0) {
    warnings.push({
      code: "missing_active_services",
      message: "No active services are available for appointment creation.",
    });
  }

  const onlineServiceIds = new Set(
    input.services
      .filter(
        (service) =>
          service.is_active && service.online_booking_enabled,
      )
      .map((service) => service.id),
  );

  if (onlineServiceIds.size === 0) {
    warnings.push({
      code: "missing_online_services",
      message: "No active services are enabled for online booking.",
    });
  }

  if (
    input.assignments.filter(
      (assignment) =>
        assignment.is_active &&
        assignment.online_bookable &&
        onlineServiceIds.has(assignment.service_id),
    ).length === 0
  ) {
    warnings.push({
      code: "missing_staff_assignments",
      message: "No booking staff are selected for an online service.",
    });
  }

  if (input.availabilityRules.filter((rule) => rule.is_active).length === 0) {
    warnings.push({
      code: "missing_availability",
      message: "No active staff availability rules are configured.",
    });
  }

  return warnings;
}

async function loadRequestUsers(
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>,
  userIds: string[],
) {
  if (userIds.length === 0) {
    return new Map<string, RequestUserRow>();
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, phone, first_name, last_name, display_name")
    .in("id", userIds)
    .returns<RequestUserRow[]>();

  if (error) {
    throw error;
  }

  return new Map((data ?? []).map((user) => [user.id, user]));
}

function mapRequests(input: {
  requests: BookingRequestRow[];
  services: Service[];
  staff: Staff[];
  usersById: Map<string, RequestUserRow>;
}) {
  const servicesById = new Map(input.services.map((service) => [service.id, service]));
  const staffById = new Map(input.staff.map((staff) => [staff.id, staff]));

  return input.requests.map((request) => {
    const user = input.usersById.get(request.customer_user_id) ?? null;

    return {
      customerEmail: user?.email ?? null,
      customerName: customerName(user),
      customerPhone: user?.phone ?? null,
      customerUserId: request.customer_user_id,
      createdAt: request.created_at,
      id: request.id,
      lookId: request.look_id,
      privateNote: request.private_note,
      requestedStartAt: request.requested_start_at,
      serviceId: request.service_id,
      serviceName: request.service_id
        ? (servicesById.get(request.service_id)?.name ?? null)
        : null,
      staffId: request.staff_id,
      staffName: request.staff_id
        ? (staffById.get(request.staff_id)?.display_name ?? null)
        : null,
      status: request.status,
    } satisfies BookingWorkspaceRequest;
  });
}

export async function getCurrentSalonBookingWorkspace(
  rawSearchParams: BookingWorkspaceSearchParams,
  context: CurrentBusinessContext,
): Promise<BookingWorkspaceData> {
  await requirePermission(BOOKING_PERMISSIONS.view, context);

  const { Account, salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const canManageBookings = await hasPermission(BOOKING_PERMISSIONS.manage, context);
  const { data: settingsData, error: settingsError } = await supabase
    .from("booking_settings")
    .select(BOOKING_SETTINGS_SELECT)
    .eq("salon_id", salon.id)
    .maybeSingle<BookingSettings>();

  if (settingsError) {
    console.error("Supabase load booking settings failed", {
      code: settingsError.code,
      details: settingsError.details,
      hint: settingsError.hint,
      message: settingsError.message,
      accountId: Account.id,
      salonId: salon.id,
      userId: context.user?.id,
    });
    throw new Error(settingsError.message);
  }

  const settings =
    settingsData ??
    defaultBookingSettings({
      accountId: Account.id,
      salonId: salon.id,
      timezone: "America/Chicago",
    });
  const timezone = settings.timezone_iana || "America/Chicago";
  const filters = buildFilters(rawSearchParams, timezone);
  const range = buildRange(filters, timezone);
  const timeBlockWindow =
    filters.tab === "availability"
      ? {
          endIso: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
          startIso: new Date().toISOString(),
        }
      : {
          endIso: range.endIso,
          startIso: range.startIso,
        };

  const bookingsQuery = supabase
    .from("bookings")
    .select(BOOKING_WITH_RELATIONS_SELECT)
    .eq("salon_id", salon.id)
    .lt("start_at", range.endIso)
    .gt("end_at", range.startIso)
    .order("start_at", { ascending: true })
    .limit(filters.view === "list" ? 100 : 300)
    .returns<BookingWithCustomerStaffRow[]>();
  const customersQuery = canManageBookings
    ? supabase
        .from("customers")
        .select(BOOKING_CUSTOMER_OPTION_SELECT)
        .eq("location_id", salon.id)
        .eq("status", "active")
        .order("name", { ascending: true })
        .limit(300)
        .returns<Customer[]>()
    : Promise.resolve({ data: [] as Customer[], error: null });
  const staffQuery = supabase
    .from("staff")
    .select(BOOKING_STAFF_OPTION_SELECT)
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .order("display_name", { ascending: true })
    .returns<Staff[]>();
  const servicesQuery = supabase
    .from("services")
    .select(BOOKING_SERVICE_OPTION_SELECT)
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .returns<Service[]>();
  const assignmentsQuery = supabase
    .from("staff_service_assignments")
    .select("*")
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .returns<StaffServiceAssignment[]>();
  const availabilityRulesQuery = supabase
    .from("staff_availability_rules")
    .select("*")
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .returns<StaffAvailabilityRule[]>();
  const timeBlocksQuery = supabase
    .from("staff_time_blocks")
    .select("*")
    .eq("salon_id", salon.id)
    .eq("is_active", true)
    .lt("starts_at", timeBlockWindow.endIso)
    .gt("ends_at", timeBlockWindow.startIso)
    .order("starts_at", { ascending: true })
    .returns<StaffTimeBlock[]>();
  const requestsQuery = supabase
    .from("salon_profile_booking_requests")
    .select(
      "id, customer_user_id, look_id, service_id, staff_id, requested_start_at, private_note, status, created_at",
    )
    .eq("salon_id", salon.id)
    .order("created_at", { ascending: false })
    .limit(25)
    .returns<BookingRequestRow[]>();

  const [
    bookingsResult,
    customersResult,
    staffResult,
    servicesResult,
    assignmentsResult,
    availabilityRulesResult,
    timeBlocksResult,
    requestsResult,
  ] = await Promise.all([
    bookingsQuery,
    customersQuery,
    staffQuery,
    servicesQuery,
    assignmentsQuery,
    availabilityRulesQuery,
    timeBlocksQuery,
    requestsQuery,
  ]);

  const resultErrors = [
    bookingsResult.error,
    customersResult.error,
    staffResult.error,
    servicesResult.error,
    assignmentsResult.error,
    availabilityRulesResult.error,
    timeBlocksResult.error,
    requestsResult.error,
  ].filter(Boolean);

  if (resultErrors.length > 0) {
    const error = resultErrors[0];
    console.error("Supabase load booking workspace failed", {
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      message: error?.message,
      accountId: Account.id,
      salonId: salon.id,
      userId: context.user?.id,
    });
    throw new Error(error?.message ?? "Unable to load booking workspace.");
  }

  const loadedBookingRows = bookingsResult.data ?? [];
  const bookingIds = loadedBookingRows.map((booking) => booking.id);
  const ticketIds = loadedBookingRows
    .map((booking) => booking.pos_ticket_id)
    .filter((ticketId): ticketId is string => Boolean(ticketId));
  const ticketLookupOr = [
    ticketIds.length > 0 ? `id.in.(${ticketIds.join(",")})` : null,
    bookingIds.length > 0 ? `source_booking_id.in.(${bookingIds.join(",")})` : null,
  ]
    .filter((clause): clause is string => Boolean(clause))
    .join(",");
  const [linesResult, eventsResult, ticketsResult, inspirationsResult] =
    bookingIds.length > 0
      ? await Promise.all([
          supabase
            .from("booking_lines")
            .select(BOOKING_LINE_SELECT)
            .in("booking_id", bookingIds)
            .order("display_order", { ascending: true })
            .returns<BookingLine[]>(),
          supabase
            .from("booking_status_events")
            .select(BOOKING_STATUS_EVENT_SELECT)
            .in("booking_id", bookingIds)
            .order("created_at", { ascending: false })
            .returns<BookingStatusEvent[]>(),
          supabase
            .from("pos_tickets")
            .select(POS_TICKET_WITH_RELATIONS_SELECT)
            .eq("salon_id", salon.id)
            .or(ticketLookupOr)
            .returns<PosTicketWithRelations[]>(),
          supabase
            .from("booking_inspirations")
            .select(BOOKING_INSPIRATION_SELECT)
            .in("booking_id", bookingIds)
            .returns<BookingInspiration[]>(),
        ])
      : [
          { data: [] as BookingLine[], error: null },
          { data: [] as BookingStatusEvent[], error: null },
          { data: [] as PosTicketWithRelations[], error: null },
          { data: [] as BookingInspiration[], error: null },
        ];

  if (linesResult.error || eventsResult.error || ticketsResult.error || inspirationsResult.error) {
    const error =
      linesResult.error ??
      eventsResult.error ??
      ticketsResult.error ??
      inspirationsResult.error;
    console.error("Supabase load booking details failed", {
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      message: error?.message,
      accountId: Account.id,
      salonId: salon.id,
      userId: context.user?.id,
    });
    throw new Error(error?.message ?? "Unable to load booking details.");
  }

  const userIds = [
    ...new Set((requestsResult.data ?? []).map((request) => request.customer_user_id)),
  ];
  const requestUsersById = await loadRequestUsers(supabase, userIds);
  const ticketsByBookingId = mapTicketsToBookings(
    ticketsResult.data ?? [],
    loadedBookingRows,
  );
  const bookings = mapBookings({
    bookings: loadedBookingRows,
    events: eventsResult.data ?? [],
    inspirationsByBookingId: mapBookingInspirationsByBookingId(
      inspirationsResult.data ?? [],
    ),
    lines: linesResult.data ?? [],
    staff: staffResult.data ?? [],
    ticketsByBookingId,
  }).filter((booking) => matchesBookingFilters({ booking, filters }));
  const options = {
    assignments: assignmentsResult.data ?? [],
    availabilityRules: availabilityRulesResult.data ?? [],
    customers: (customersResult.data ?? []).map((customer) => ({
      email: customer.email,
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
    })),
    services: servicesResult.data ?? [],
    staff: staffResult.data ?? [],
    timeBlocks: timeBlocksResult.data ?? [],
  };

  return {
    bookings,
    canManageBookings,
    canViewBookings: true,
    context,
    filters,
    options,
    range,
    requests: mapRequests({
      requests: requestsResult.data ?? [],
      services: servicesResult.data ?? [],
      staff: staffResult.data ?? [],
      usersById: requestUsersById,
    }),
    settings,
    timezone,
    warnings: buildWarnings({
      assignments: options.assignments,
      availabilityRules: options.availabilityRules,
      services: options.services,
    }),
  };
}

export async function getCurrentSalonBookings() {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    return { context, bookings: [] };
  }

  await requirePermission(BOOKING_PERMISSIONS.view, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_WITH_RELATIONS_SELECT)
    .eq("salon_id", salon.id)
    .order("start_at", { ascending: true })
    .returns<BookingWithRelations[]>();

  if (error) {
    console.error("Supabase load bookings failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: context.currentAccount?.id,
      salonId: salon.id,
      userId: context.user.id,
    });
    throw new Error(error.message);
  }

  return { context, bookings: data ?? [] };
}

export async function getCurrentSalonBookingOptions(context: CurrentBusinessContext) {
  await requirePermission(BOOKING_PERMISSIONS.manage, context);

  const { salon } = requireCurrentAccountAndSalon(context);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [customersResult, staffResult] = await Promise.all([
    supabase
      .from("customers")
      .select(BOOKING_CUSTOMER_OPTION_SELECT)
      .eq("location_id", salon.id)
      .eq("status", "active")
      .order("name", { ascending: true })
      .returns<Customer[]>(),
    supabase
      .from("staff")
      .select(BOOKING_STAFF_OPTION_SELECT)
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .order("display_name", { ascending: true })
      .returns<Staff[]>(),
  ]);

  if (customersResult.error) {
    console.error("Supabase load booking customers failed", {
      code: customersResult.error.code,
      details: customersResult.error.details,
      hint: customersResult.error.hint,
      message: customersResult.error.message,
      accountId: context.currentAccount?.id,
      salonId: salon.id,
      userId: context.user?.id,
    });
    throw new Error(customersResult.error.message);
  }

  if (staffResult.error) {
    console.error("Supabase load booking staff failed", {
      code: staffResult.error.code,
      details: staffResult.error.details,
      hint: staffResult.error.hint,
      message: staffResult.error.message,
      accountId: context.currentAccount?.id,
      salonId: salon.id,
      userId: context.user?.id,
    });
    throw new Error(staffResult.error.message);
  }

  return {
    customers: customersResult.data ?? [],
    staff: staffResult.data ?? [],
  };
}

export type BookingCreationLineDraft = {
  cleanupBufferMinutes: number;
  durationMinutes: number;
  scheduledEndAt: string;
  scheduledStartAt: string;
  serviceId: string;
  staffId: string | null;
};

export type BookingCreationSchedule = {
  endAt: string;
  lines: BookingCreationLineDraft[];
  subtotal: number;
};

export async function deriveBookingCreationSchedule(input: {
  cleanupBufferMinutes: number;
  accountId: string;
  salonId: string;
  serviceIds: string[];
  staffIds: (string | null)[];
  startAt: string;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const uniqueServiceIds = [...new Set(input.serviceIds)];

  if (uniqueServiceIds.length === 0) {
    throw new Error("At least one service is required.");
  }

  const { data: services, error } = await supabase
    .from("services")
    .select(BOOKING_SERVICE_OPTION_SELECT)
    .eq("salon_id", input.salonId)
    .eq("is_active", true)
    .in("id", uniqueServiceIds)
    .returns<Service[]>();

  if (error) {
    throw error;
  }

  const servicesById = new Map((services ?? []).map((service) => [service.id, service]));
  let cursorMs = new Date(input.startAt).getTime();
  let subtotal = 0;
  const lines: BookingCreationLineDraft[] = [];

  if (!Number.isFinite(cursorMs)) {
    throw new Error("Start time is invalid.");
  }

  input.serviceIds.forEach((serviceId, index) => {
    const service = servicesById.get(serviceId);

    if (!service) {
      throw new Error("Booking service must be active for this salon.");
    }

    const scheduledStartAt = new Date(cursorMs).toISOString();
    const durationMinutes = service.duration_minutes;
    const scheduledEndMs =
      cursorMs + (durationMinutes + input.cleanupBufferMinutes) * 60000;
    const scheduledEndAt = new Date(scheduledEndMs).toISOString();

    subtotal += Number(service.base_price ?? 0);
    lines.push({
      cleanupBufferMinutes: input.cleanupBufferMinutes,
      durationMinutes,
      scheduledEndAt,
      scheduledStartAt,
      serviceId,
      staffId: input.staffIds[index] ?? null,
    });
    cursorMs = scheduledEndMs;
  });

  return {
    endAt: new Date(cursorMs).toISOString(),
    lines,
    subtotal,
  } satisfies BookingCreationSchedule;
}
