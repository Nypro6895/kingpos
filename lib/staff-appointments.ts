import "server-only";

import {
  formatDateInTimeZone,
  zonedDateTimeToUtcIso,
} from "@/lib/bookings";
import {
  BOOKING_INSPIRATION_SELECT,
  mapBookingInspirationsByBookingId,
} from "@/lib/booking-inspirations";
import {
  getSalonOnlineBookingStatus,
  type SalonOnlineBookingStatus,
} from "@/lib/booking-status";
import { getStaffBookingReadiness, type StaffBookingReadiness } from "@/lib/booking-setup";
import {
  getCurrentStaffBusinessContext,
  isSalonStaffContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { SERVICE_SELECT } from "@/lib/services";
import { STAFF_SELECT } from "@/lib/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BookingConfirmationStatus,
  BookingInspiration,
  BookingInspirationView,
  BookingLineStatus,
  BookingStatus,
  StaffServiceAssignment,
  StaffAvailabilityRule,
  StaffTimeBlock,
} from "@/types/booking";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";

export type StaffAppointmentView = "day" | "list" | "week";

export type StaffAppointmentsSearchParams = {
  bookingId?: string | string[];
  date?: string | string[];
  quickId?: string | string[];
  view?: string | string[];
};

export type StaffAppointmentLine = {
  bookingId: string;
  completedAt: string | null;
  confirmationStatus: BookingConfirmationStatus;
  customerName: string;
  customerPhone: string | null;
  endAt: string;
  id: string;
  inspiration: BookingInspirationView | null;
  lineStatus: BookingLineStatus;
  publicNotes: string | null;
  serviceName: string;
  serviceNote: string | null;
  startAt: string;
  status: Exclude<BookingStatus, "scheduled">;
  ticketId: string | null;
};

export type StaffAppointmentDay = {
  date: string;
  label: string;
};

export type StaffAppointmentsData = {
  appointments: StaffAppointmentLine[];
  assignedServices: Array<{
    category: string | null;
    durationMinutes: number;
    id: string;
    name: string;
    onlineBookable: boolean;
  }>;
  availabilityRules: StaffAvailabilityRule[];
  bookingEnabled: boolean;
  bookingReadiness: StaffBookingReadiness | null;
  canViewTickets: boolean;
  context: CurrentBusinessContext;
  days: StaffAppointmentDay[];
  rangeEnd: string;
  rangeStart: string;
  selectedAppointment: StaffAppointmentLine | null;
  salonBookingStatus: SalonOnlineBookingStatus;
  staff: {
    displayName: string;
    id: string;
    jobTitle: string | null;
    onlineBookingEnabled: boolean;
  } | null;
  timeBlocks: StaffTimeBlock[];
  timezone: string;
  view: StaffAppointmentView;
};

type BookingLineRow = {
  booking: {
    confirmation_status: BookingConfirmationStatus;
    customer: {
      name: string;
      phone: string | null;
    } | null;
    id: string;
    pos_ticket_id: string | null;
    public_notes: string | null;
    salon_timezone_snapshot: string;
    status: BookingStatus;
  } | null;
  completed_at: string | null;
  id: string;
  line_status: BookingLineStatus;
  scheduled_end_at: string;
  scheduled_start_at: string;
  service_name_snapshot: string;
  service_note: string | null;
};

type StaffBookingSettingsRow = {
  booking_enabled: boolean;
  guest_booking_enabled: boolean;
  online_booking_visible: boolean;
  timezone_iana: string;
};

type StaffAppointmentsSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

const OFFLINE_SALON_BOOKING_STATUS = getSalonOnlineBookingStatus(null);

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isIsoDate(value: string | null | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));

  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(
    next.getUTCDate(),
  )}`;
}

function dayOfWeek(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function labelForDate(date: string, timeZone: string) {
  const iso =
    zonedDateTimeToUtcIso({ date, time: "12:00", timeZone }) ??
    `${date}T12:00:00.000Z`;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
  }).format(new Date(iso));
}

function normalizeView(value: string | null | undefined): StaffAppointmentView {
  return value === "week" || value === "list" ? value : "day";
}

function normalizeStatus(status: BookingStatus): Exclude<BookingStatus, "scheduled"> {
  return status === "scheduled" ? "confirmed" : status;
}

function normalizeLineStatus(status: BookingLineStatus | string): BookingLineStatus {
  return status === "in_progress" ? "in_service" : (status as BookingLineStatus);
}

async function loadCurrentStaff(context: CurrentBusinessContext) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase || !context.user || !context.currentStaffSalon) {
    return null;
  }

  const { data, error } = await supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("salon_id", context.currentStaffSalon.id)
    .eq("account_user_id", context.user.id)
    .eq("is_active", true)
    .maybeSingle<Staff>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function booleanValue(value: unknown) {
  return value === true;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseBookingSettingsRow(value: unknown): StaffBookingSettingsRow | null {
  const row = asRecord(value);
  const timezone = stringValue(row.timezone_iana);

  if (!timezone) {
    return null;
  }

  return {
    booking_enabled: booleanValue(row.booking_enabled),
    guest_booking_enabled: booleanValue(row.guest_booking_enabled),
    online_booking_visible: booleanValue(row.online_booking_visible),
    timezone_iana: timezone,
  };
}

async function loadSalonBookingSettings(input: {
  salonId: string;
  supabase: StaffAppointmentsSupabaseClient;
}) {
  const { data, error } = await input.supabase
    .from("booking_settings")
    .select("timezone_iana, booking_enabled, online_booking_visible, guest_booking_enabled")
    .eq("salon_id", input.salonId)
    .maybeSingle<StaffBookingSettingsRow>();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    return data;
  }

  const now = new Date();
  const rangeEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const fallback = await input.supabase.rpc("get_public_booking_context", {
    p_range_end: rangeEnd.toISOString(),
    p_range_start: now.toISOString(),
    target_salon_id: input.salonId,
  });

  if (fallback.error) {
    console.warn("Public booking settings fallback failed", {
      code: fallback.error.code,
      details: fallback.error.details,
      hint: fallback.error.hint,
      message: fallback.error.message,
      salonId: input.salonId,
    });
    return null;
  }

  return parseBookingSettingsRow(asRecord(fallback.data).settings);
}

export async function getCurrentStaffAppointments(
  params: StaffAppointmentsSearchParams,
): Promise<StaffAppointmentsData> {
  const context = await getCurrentStaffBusinessContext();

  if (!context.user || !isSalonStaffContext(context) || !context.currentStaffSalon) {
    return {
      appointments: [],
      assignedServices: [],
      availabilityRules: [],
      bookingEnabled: false,
      bookingReadiness: null,
      canViewTickets: false,
      context,
      days: [],
      rangeEnd: "",
      rangeStart: "",
      selectedAppointment: null,
      salonBookingStatus: OFFLINE_SALON_BOOKING_STATUS,
      staff: null,
      timeBlocks: [],
      timezone: "America/Chicago",
      view: "day",
    };
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const staff = await loadCurrentStaff(context);

  if (!staff) {
    return {
      appointments: [],
      assignedServices: [],
      availabilityRules: [],
      bookingEnabled: false,
      bookingReadiness: null,
      canViewTickets: false,
      context,
      days: [],
      rangeEnd: "",
      rangeStart: "",
      selectedAppointment: null,
      salonBookingStatus: OFFLINE_SALON_BOOKING_STATUS,
      staff: null,
      timeBlocks: [],
      timezone: "America/Chicago",
      view: "day",
    };
  }

  const settings = await loadSalonBookingSettings({
    salonId: context.currentStaffSalon.id,
    supabase,
  });

  const timezone = settings?.timezone_iana || "America/Chicago";
  const salonBookingStatus = getSalonOnlineBookingStatus(settings);
  const today = formatDateInTimeZone(new Date(), timezone);
  const selectedDate = isIsoDate(firstParam(params.date))
    ? (firstParam(params.date) as string)
    : today;
  const view = normalizeView(firstParam(params.view));
  const startDate = view === "week" ? addDays(selectedDate, -dayOfWeek(selectedDate)) : selectedDate;
  const spanDays = view === "list" ? 14 : view === "week" ? 7 : 1;
  const endDate = addDays(startDate, spanDays);
  const rangeStart =
    zonedDateTimeToUtcIso({ date: startDate, time: "00:00", timeZone: timezone }) ??
    `${startDate}T00:00:00.000Z`;
  const rangeEnd =
    zonedDateTimeToUtcIso({ date: endDate, time: "00:00", timeZone: timezone }) ??
    `${endDate}T00:00:00.000Z`;
  const days = Array.from({ length: spanDays }, (_, index) => {
    const date = addDays(startDate, index);

    return { date, label: labelForDate(date, timezone) };
  });

  const canViewTickets = await hasPermission("tickets.view", context);
  const [linesResult, availabilityResult, blocksResult, assignmentsResult, servicesResult] =
    await Promise.all([
    supabase
      .from("booking_lines")
      .select(
        "id, booking_id, service_name_snapshot, scheduled_start_at, scheduled_end_at, line_status, completed_at, service_note, booking:bookings!inner(id, status, confirmation_status, pos_ticket_id, public_notes, salon_timezone_snapshot, customer:customers(name, phone))",
      )
      .eq("salon_id", context.currentStaffSalon.id)
      .eq("assigned_staff_id", staff.id)
      .lt("scheduled_start_at", rangeEnd)
      .gt("scheduled_end_at", rangeStart)
      .order("scheduled_start_at", { ascending: true })
      .returns<BookingLineRow[]>(),
    supabase
      .from("staff_availability_rules")
      .select("*")
      .eq("salon_id", context.currentStaffSalon.id)
      .or(`staff_id.is.null,staff_id.eq.${staff.id}`)
      .eq("is_active", true)
      .returns<StaffAvailabilityRule[]>(),
    supabase
      .from("staff_time_blocks")
      .select("*")
      .eq("salon_id", context.currentStaffSalon.id)
      .eq("is_active", true)
      .or(`staff_id.is.null,staff_id.eq.${staff.id}`)
      .lt("starts_at", rangeEnd)
      .gt("ends_at", rangeStart)
      .returns<StaffTimeBlock[]>(),
    supabase
      .from("staff_service_assignments")
      .select("*")
      .eq("salon_id", context.currentStaffSalon.id)
      .eq("staff_id", staff.id)
      .eq("is_active", true)
      .returns<StaffServiceAssignment[]>(),
    supabase
      .from("services")
      .select(SERVICE_SELECT)
      .eq("salon_id", context.currentStaffSalon.id)
      .returns<Service[]>(),
  ]);

  if (linesResult.error) {
    throw new Error(linesResult.error.message);
  }

  if (availabilityResult.error) {
    throw new Error(availabilityResult.error.message);
  }

  if (blocksResult.error) {
    throw new Error(blocksResult.error.message);
  }

  if (assignmentsResult.error) {
    throw new Error(assignmentsResult.error.message);
  }

  if (servicesResult.error) {
    throw new Error(servicesResult.error.message);
  }

  const bookingIds = [
    ...new Set(
      (linesResult.data ?? [])
        .map((line) => line.booking?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const inspirationsByBookingId =
    bookingIds.length > 0
      ? await supabase
          .from("booking_inspirations")
          .select(BOOKING_INSPIRATION_SELECT)
          .in("booking_id", bookingIds)
          .returns<BookingInspiration[]>()
      : { data: [] as BookingInspiration[], error: null };

  if (inspirationsByBookingId.error) {
    throw new Error(inspirationsByBookingId.error.message);
  }

  const inspirationMap = mapBookingInspirationsByBookingId(
    inspirationsByBookingId.data ?? [],
  );
  const servicesById = new Map(
    (servicesResult.data ?? []).map((service) => [service.id, service]),
  );
  const assignedServices = (assignmentsResult.data ?? [])
    .map((assignment) => {
      const service = servicesById.get(assignment.service_id);

      if (
        !service?.is_active ||
        !service.online_booking_enabled ||
        !assignment.online_bookable
      ) {
        return null;
      }

      return {
        category: service.category,
        durationMinutes: service.duration_minutes,
        id: service.id,
        name: service.name,
        onlineBookable: assignment.online_bookable,
      };
    })
    .filter((service): service is NonNullable<typeof service> => Boolean(service));
  const appointments = (linesResult.data ?? [])
    .filter((line) => line.booking)
    .map((line) => ({
      bookingId: line.booking?.id ?? "",
      completedAt: line.completed_at,
      confirmationStatus: line.booking?.confirmation_status ?? "confirmed",
      customerName: line.booking?.customer?.name ?? "Customer",
      customerPhone: line.booking?.customer?.phone ?? null,
      endAt: line.scheduled_end_at,
      id: line.id,
      inspiration: line.booking?.id
        ? inspirationMap.get(line.booking.id) ?? null
        : null,
      lineStatus: normalizeLineStatus(line.line_status),
      publicNotes: line.booking?.public_notes ?? null,
      serviceName: line.service_name_snapshot,
      serviceNote: line.service_note,
      startAt: line.scheduled_start_at,
      status: normalizeStatus(line.booking?.status ?? "confirmed"),
      ticketId: line.booking?.pos_ticket_id ?? null,
    }));
  const selectedBookingId = firstParam(params.bookingId);
  const selectedAppointment =
    selectedBookingId
      ? appointments.find((appointment) => appointment.bookingId === selectedBookingId) ??
        null
      : null;

  return {
    appointments,
    assignedServices,
    availabilityRules: availabilityResult.data ?? [],
    bookingEnabled: salonBookingStatus.onlineBookingOpen,
    bookingReadiness: getStaffBookingReadiness({
      assignments: assignmentsResult.data ?? [],
      availabilityRules: availabilityResult.data ?? [],
      bookingEnabled: salonBookingStatus.onlineBookingOpen,
      services: servicesResult.data ?? [],
      staff,
      timeBlocks: blocksResult.data ?? [],
    }),
    canViewTickets,
    context,
    days,
    rangeEnd,
    rangeStart,
    selectedAppointment,
    salonBookingStatus,
    staff: {
      displayName: staff.display_name,
      id: staff.id,
      jobTitle: staff.job_title,
      onlineBookingEnabled: staff.online_booking_enabled,
    },
    timeBlocks: blocksResult.data ?? [],
    timezone,
    view,
  };
}
