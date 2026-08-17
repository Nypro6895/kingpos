import "server-only";

import { getCurrentAppNotifications } from "@/lib/app-notifications";
import {
  BOOKING_LINE_SELECT,
  BOOKING_SELECT,
  zonedDateTimeToUtcIso,
} from "@/lib/bookings";
import {
  DAILY_POS_REPORT_PERMISSIONS,
  getDailyPosTodayFinancialData,
  getDailyPosReport,
  type DailyPosStaffAttributionSource,
  type DailyPosTipAttributionSource,
  type DailyPosTodayFinancialData,
} from "@/lib/daily-pos-report";
import type { DailyPosSalesComparison } from "@/lib/daily-pos-sales-comparison";
import {
  isOwnerMembership,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import {
  buildSalonActivityBuckets,
  getLocalDateHour,
  getSalonBusinessHoursForDate,
  unavailableSalonBusinessHours,
  type SalonBusinessHoursWindow,
} from "@/lib/salon-business-hours";
import {
  getCurrentSalonStaffActivitySummaries,
  getCurrentSalonStaffTodayBoard,
  STAFF_WORKDAY_STATUS_LABELS,
  type StaffDailyActivitySummary,
  type StaffWithTodayWorkday,
} from "@/lib/staff-workdays";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCustomerVisitQueueForSalonOrEmpty } from "@/lib/customer-visits";
import {
  getTodayQuickAccessConfiguration,
  type TodayQuickAccessConfiguration,
} from "@/lib/today-quick-accesses";
import {
  normalizeBookingStatus,
  type BookingLine,
  type BookingStatus,
} from "@/types/booking";
import type { CustomerVisitQueueItem } from "@/types/customer-visit";
import type { DailyPosReport } from "@/types/pos-daily-closing";
import type { StaffWorkdayStatus } from "@/types/staff-workday";

export type TodayClientPresence = {
  appointmentAt?: string;
  appointmentId?: string;
  assignedStaff: TodayStaffReference | null;
  customerId?: string;
  displayName: string;
  href: string | null;
  id: string;
  serviceLabel: string | null;
  source: "appointment" | "customer_screen" | "walk_in";
  status: "waiting" | "in_service" | "completed";
};

export type TodayDashboard = {
  attention: TodayAttentionItem[];
  businessHours: SalonBusinessHoursWindow;
  date: string;
  dayView: TodayDayView;
  generatedAt: string;
  greetingName: string;
  loadErrors: TodayLoadError[];
  noAccess: boolean;
  performance: TodayPerformance;
  permissions: TodayDashboardPermissions;
  quickAccesses: TodayQuickAccessConfiguration;
  rightNow: {
    scheduleHref: string | null;
    upcomingBookings: TodayUpcomingBooking[];
    waitingClients: TodayClientPresence[];
  };
  salonName: string;
  summary: {
    customers: TodayMetric;
    sales: TodayMetric;
    staff: TodayMetric;
    waiting: TodayMetric;
  };
  team: TodayTeamMember[];
  timezone: string;
};

export type TodayDashboardPermissions = {
  canViewBookings: boolean;
  canViewDashboard: boolean;
  canViewReports: boolean;
  canViewStaffFinancials: boolean;
  canViewTickets: boolean;
};

export type TodayLoadError = {
  area:
    | "bookings"
    | "business_hours"
    | "financials"
    | "notifications"
    | "quick_accesses"
    | "reports"
    | "staff"
    | "waiting";
  message: string;
};

export type TodayMetric = {
  chart: TodayMetricChart | null;
  detail: string | null;
  href: string | null;
  label: string;
  restricted?: boolean;
  tone?: "default" | "good" | "warning";
  trend?: TodayMetricTrend | null;
  value: string;
};

export type TodayMetricChart = {
  ariaLabel: string;
  kind: "bars" | "sparkline";
  points: TodayMetricChartPoint[];
};

export type TodayMetricChartPoint = {
  afterHours?: boolean;
  highlight?: boolean;
  label: string;
  value: number;
};

export type TodayMetricTrend = {
  direction: "down" | "flat" | "up";
  label: string;
};

export type TodayDayView = {
  currentDate: string;
  invalidDate: string | null;
  isCurrentDate: boolean;
  maxDate: string;
  nextDate: string | null;
  previousDate: string;
  selectedDate: string;
  todayHref: string;
};

export type TodayStaffReference = {
  id: string;
  name: string;
};

export type TodayUpcomingBooking = {
  assignedStaff: TodayStaffReference | null;
  customerName: string;
  href: string;
  id: string;
  serviceLabel: string | null;
  startAt: string;
  status: Exclude<BookingStatus, "scheduled">;
};

export type TodayAttentionItem = {
  actionLabel?: string;
  detail: string;
  href: string | null;
  id: string;
  label: string;
  tone: "good" | "notice" | "warning";
};

export type TodayTeamMember = {
  checkInAt: string | null;
  checkOutAt: string | null;
  displayName: string;
  earnings?: number;
  financialAttribution?: TodayStaffFinancialAttribution;
  id: string;
  jobTitle: string | null;
  serviceSales?: number;
  status: StaffWorkdayStatus | "not_checked_in";
  statusLabel: string;
  tips?: number;
  turns: {
    large: number;
    small: number;
    total: number;
  };
};

export type TodayStaffFinancialAttribution = {
  services: DailyPosStaffAttributionSource | "unavailable";
  tips: DailyPosTipAttributionSource | "unavailable";
};

export type TodayPerformance = {
  bookingStatus: {
    active: number;
    completed: number;
    upcoming: number;
  };
  emptyLabel: string | null;
  salesTrend: TodayPerformancePoint[];
  sales: {
    comparison: TodayMetricTrend | null;
    discount: number;
    service: number;
    ticketCount: number;
    tip: number;
    total: number;
  } | null;
  staffBars: TodayPerformanceStaffBar[];
};

export type TodayPerformancePoint = {
  afterHours: boolean;
  label: string;
  latest: boolean;
  service: number;
  ticketCount: number;
  tip: number;
  total: number;
};

export type TodayPerformanceStaffBar = {
  label: string;
  staffId: string;
  value: number;
};

type TodayBookingLineRow = Pick<
  BookingLine,
  "assigned_staff_id" | "display_order" | "service_name_snapshot"
>;

type TodayBookingRow = {
  booking_lines?: TodayBookingLineRow[] | null;
  confirmation_status: string;
  customer: {
    email: string | null;
    id: string;
    name: string | null;
    phone: string | null;
  } | null;
  customer_id: string;
  end_at: string;
  id: string;
  staff: { display_name: string; id: string } | null;
  staff_id: string | null;
  start_at: string;
  status: BookingStatus;
};

type BusinessClock = {
  date: string;
  timezone: string;
};

type TodayDashboardOptions = {
  date?: string | string[];
};

type DashboardData<T> =
  | { data: T; error: TodayLoadError | null }
  | { data: null; error: TodayLoadError };

const ACTIVE_STAFF_STATUSES = new Set<StaffWorkdayStatus>([
  "break",
  "checked_in",
  "working",
]);
const INACTIVE_BOOKING_STATUSES = new Set<Exclude<BookingStatus, "scheduled">>([
  "cancelled",
  "completed",
  "no_show",
]);
const MONEY_PERFORMANCE_LIMIT = 5;

function emptyQuickAccessConfiguration(): TodayQuickAccessConfiguration {
  return {
    available: [],
    canCustomize: false,
    loadError: null,
    maxSelected: 0,
    selected: [],
  };
}

function canUsePermission(context: CurrentBusinessContext, permissionCode: string) {
  if (isOwnerMembership(context.currentMembership)) {
    return true;
  }

  return (
    context.permissionCodes.includes("*") ||
    context.permissionCodes.includes(permissionCode)
  );
}

function canUseAnyPermission(
  context: CurrentBusinessContext,
  permissionCodes: string[],
) {
  return permissionCodes.some((permissionCode) =>
    canUsePermission(context, permissionCode),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load this section.";
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

function isDateInputValue(value: string | null | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function firstDateParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function buildDayView(input: {
  currentDate: string;
  selectedDateInput?: string | string[];
}) {
  const rawDate = firstDateParam(input.selectedDateInput)?.trim() ?? "";
  let invalidDate: string | null = null;
  let selectedDate = input.currentDate;

  if (rawDate) {
    if (!isDateInputValue(rawDate)) {
      invalidDate = rawDate;
    } else if (rawDate > input.currentDate) {
      invalidDate = rawDate;
    } else {
      selectedDate = rawDate;
    }
  }

  return {
    currentDate: input.currentDate,
    invalidDate,
    isCurrentDate: selectedDate === input.currentDate,
    maxDate: input.currentDate,
    nextDate:
      selectedDate < input.currentDate ? addDays(selectedDate, 1) : null,
    previousDate: addDays(selectedDate, -1),
    selectedDate,
    todayHref: "/staff/today",
  } satisfies TodayDayView;
}

function fallbackDateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day
    ? `${year}-${month}-${day}`
    : new Date().toISOString().slice(0, 10);
}

function getDayBounds(date: string, timeZone: string) {
  const nextDate = addDays(date, 1);

  return {
    endIso:
      zonedDateTimeToUtcIso({ date: nextDate, time: "00:00", timeZone }) ??
      `${nextDate}T00:00:00.000Z`,
    startIso:
      zonedDateTimeToUtcIso({ date, time: "00:00", timeZone }) ??
      `${date}T00:00:00.000Z`,
  };
}

async function loadBusinessClock(
  context: CurrentBusinessContext,
): Promise<BusinessClock> {
  const fallbackTimezone = context.user?.timezone || "America/Chicago";
  const fallback: BusinessClock = {
    date: fallbackDateInTimeZone(fallbackTimezone),
    timezone: fallbackTimezone,
  };
  const salonId = context.currentSalon?.id;

  if (!salonId) {
    return fallback;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return fallback;
  }

  const [timezoneResult, dateResult] = await Promise.all([
    supabase.rpc("get_salon_business_timezone", { p_salon_id: salonId }),
    supabase.rpc("get_salon_business_date", { p_salon_id: salonId }),
  ]);

  if (timezoneResult.error || dateResult.error) {
    console.error("Supabase load Today salon business clock failed", {
      dateError: dateResult.error?.message,
      salonId,
      timezoneError: timezoneResult.error?.message,
    });
    return fallback;
  }

  const timezone =
    typeof timezoneResult.data === "string" && timezoneResult.data.trim()
      ? timezoneResult.data
      : fallback.timezone;
  const date =
    typeof dateResult.data === "string" && dateResult.data
      ? dateResult.data.slice(0, 10)
      : fallbackDateInTimeZone(timezone);

  return { date, timezone };
}

async function loadBusinessHoursDashboardData(input: {
  context: CurrentBusinessContext;
  date: string;
  timezone: string;
}): Promise<DashboardData<SalonBusinessHoursWindow>> {
  try {
    const businessHours = await getSalonBusinessHoursForDate({
      context: input.context,
      date: input.date,
      timeZone: input.timezone,
    });

    return {
      data: businessHours,
      error: businessHours.isFallback
        ? {
            area: "business_hours",
            message:
              businessHours.fallbackReason ??
              "Salon business hours could not be resolved.",
          }
        : null,
    };
  } catch (error) {
    console.error("Today business hours dashboard data failed", {
      error: errorMessage(error),
      salonId: input.context.currentSalon?.id,
      userId: input.context.user?.id,
    });

    return {
      data: null,
      error: {
        area: "business_hours",
        message: errorMessage(error),
      },
    };
  }
}

async function loadTodayBookings(input: {
  context: CurrentBusinessContext;
  date: string;
  timezone: string;
}): Promise<TodayBookingRow[]> {
  const salonId = input.context.currentSalon?.id;

  if (!salonId) {
    return [];
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const bounds = getDayBounds(input.date, input.timezone);
  const { data, error } = await supabase
    .from("bookings")
    .select(
      `${BOOKING_SELECT}, customer:customers(id, name, phone, email), staff:staff(id, display_name), booking_lines(${BOOKING_LINE_SELECT})`,
    )
    .eq("salon_id", salonId)
    .lt("start_at", bounds.endIso)
    .gt("end_at", bounds.startIso)
    .order("start_at", { ascending: true })
    .returns<TodayBookingRow[]>();

  if (error) {
    console.error("Supabase load Today bookings failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId,
      userId: input.context.user?.id,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadStaffDashboardData(input: {
  context: CurrentBusinessContext;
  canViewFinancials: boolean;
  date: string;
}): Promise<
  DashboardData<{
    activityByStaffId: Map<string, StaffDailyActivitySummary>;
    staff: StaffWithTodayWorkday[];
  }>
> {
  try {
    const board = await getCurrentSalonStaffTodayBoard(input.context, {
      workDate: input.date,
    });
    const staffIds = board.staff.map((member) => member.id);
    const activityByStaffId = input.canViewFinancials
      ? await getCurrentSalonStaffActivitySummaries(staffIds, input.context, {
          workDate: input.date,
        })
      : new Map<string, StaffDailyActivitySummary>();

    return {
      data: {
        activityByStaffId,
        staff: board.staff,
      },
      error: null,
    };
  } catch (error) {
    console.error("Today staff dashboard data failed", {
      error: errorMessage(error),
      salonId: input.context.currentSalon?.id,
      userId: input.context.user?.id,
    });

    return {
      data: null,
      error: {
        area: "staff",
        message: errorMessage(error),
      },
    };
  }
}

async function loadBookingDashboardData(input: {
  context: CurrentBusinessContext;
  date: string;
  timezone: string;
}): Promise<DashboardData<TodayBookingRow[]>> {
  try {
    return {
      data: await loadTodayBookings(input),
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: {
        area: "bookings",
        message: errorMessage(error),
      },
    };
  }
}

async function loadReportDashboardData(input: {
  context: CurrentBusinessContext;
  date: string;
}): Promise<DashboardData<DailyPosReport>> {
  try {
    return {
      data: await getDailyPosReport(input.date, input.context),
      error: null,
    };
  } catch (error) {
    console.error("Today report dashboard data failed", {
      error: errorMessage(error),
      salonId: input.context.currentSalon?.id,
      userId: input.context.user?.id,
    });

    return {
      data: null,
      error: {
        area: "reports",
        message: errorMessage(error),
      },
    };
  }
}

async function loadFinancialDashboardData(input: {
  businessHours: SalonBusinessHoursWindow;
  context: CurrentBusinessContext;
  date: string;
  timezone: string;
}): Promise<DashboardData<DailyPosTodayFinancialData>> {
  try {
    return {
      data: await getDailyPosTodayFinancialData({
        businessHours: input.businessHours,
        context: input.context,
        reportDate: input.date,
        timeZone: input.timezone,
      }),
      error: null,
    };
  } catch (error) {
    console.error("Today financial dashboard data failed", {
      error: errorMessage(error),
      salonId: input.context.currentSalon?.id,
      userId: input.context.user?.id,
    });

    return {
      data: null,
      error: {
        area: "financials",
        message: errorMessage(error),
      },
    };
  }
}

async function loadQuickAccessDashboardData(
  context: CurrentBusinessContext,
): Promise<DashboardData<TodayQuickAccessConfiguration>> {
  try {
    return {
      data: await getTodayQuickAccessConfiguration(context),
      error: null,
    };
  } catch (error) {
    console.error("Today quick access dashboard data failed", {
      error: errorMessage(error),
      salonId: context.currentSalon?.id,
      userId: context.user?.id,
    });

    return {
      data: null,
      error: {
        area: "quick_accesses",
        message: errorMessage(error),
      },
    };
  }
}

async function loadNotificationAttentionItems(
  context: CurrentBusinessContext,
): Promise<DashboardData<TodayAttentionItem[]>> {
  try {
    const notifications = await getCurrentAppNotifications({
      accountId: context.currentAccount?.id,
      limit: 3,
      recipientKind: "owner_manager",
      salonId: context.currentSalon?.id,
      unreadOnly: true,
    });

    return {
      data: notifications.map((notification) => ({
        detail: notification.body ?? "Open this update when you have a moment.",
        href: notification.href,
        id: `notification:${notification.id}`,
        label: notification.title,
        tone: "notice" as const,
      })),
      error: null,
    };
  } catch (error) {
    console.error("Today notification dashboard data failed", {
      error: errorMessage(error),
      salonId: context.currentSalon?.id,
      userId: context.user?.id,
    });

    return {
      data: null,
      error: {
        area: "notifications",
        message: errorMessage(error),
      },
    };
  }
}

function customerDisplayName(booking: TodayBookingRow) {
  return (
    booking.customer?.name?.trim() ||
    booking.customer?.phone?.trim() ||
    booking.customer?.email?.trim() ||
    "Customer"
  );
}

function bookingServiceLabel(booking: TodayBookingRow) {
  const serviceNames = [
    ...new Set(
      (booking.booking_lines ?? [])
        .map((line) => line.service_name_snapshot?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  return serviceNames.length > 0 ? serviceNames.join(", ") : null;
}

function bookingStaffReference(booking: TodayBookingRow): TodayStaffReference | null {
  if (booking.staff) {
    return {
      id: booking.staff.id,
      name: booking.staff.display_name,
    };
  }

  const assignedLine = (booking.booking_lines ?? []).find(
    (line) => line.assigned_staff_id,
  );

  if (!assignedLine?.assigned_staff_id) {
    return null;
  }

  return {
    id: assignedLine.assigned_staff_id,
    name: "Assigned staff",
  };
}

function bookingHref(bookingId: string, date: string) {
  return `/bookings?${new URLSearchParams({
    bookingId,
    date,
    range: "day",
  }).toString()}`;
}

function isActiveBookingStatus(status: Exclude<BookingStatus, "scheduled">) {
  return !INACTIVE_BOOKING_STATUSES.has(status);
}

function isActiveStaffStatus(status: StaffWorkdayStatus | "not_checked_in") {
  return status !== "not_checked_in" && ACTIVE_STAFF_STATUSES.has(status);
}

function mapWaitingVisits(
  visits: CustomerVisitQueueItem[],
  date: string,
): TodayClientPresence[] {
  return visits.slice(0, 5).map((visit) => ({
    appointmentAt: visit.appointmentStartAt ?? undefined,
    appointmentId: visit.appointmentId ?? undefined,
    assignedStaff: visit.assignedStaffId
      ? {
          id: visit.assignedStaffId,
          name: visit.assignedStaffName ?? "Assigned staff",
        }
      : null,
    customerId: visit.customerId,
    displayName: visit.customerName,
    href: visit.appointmentId ? bookingHref(visit.appointmentId, date) : null,
    id: `visit:${visit.id}`,
    serviceLabel: visit.serviceLabel,
    source: visit.source,
    status: "waiting" as const,
  }));
}

function mapUpcomingBookings(input: {
  bookings: TodayBookingRow[];
  date: string;
  isCurrentDate: boolean;
  nowIso: string;
}) {
  return input.bookings
    .filter((booking) => {
      const status = normalizeBookingStatus(booking.status);

      if (!input.isCurrentDate) {
        return status !== "cancelled" && status !== "no_show";
      }

      return (
        isActiveBookingStatus(status) &&
        status !== "checked_in" &&
        status !== "in_service" &&
        booking.start_at >= input.nowIso
      );
    })
    .sort((left, right) => left.start_at.localeCompare(right.start_at))
    .slice(0, 5)
    .map<TodayUpcomingBooking>((booking) => ({
      assignedStaff: bookingStaffReference(booking),
      customerName: customerDisplayName(booking),
      href: bookingHref(booking.id, input.date),
      id: booking.id,
      serviceLabel: bookingServiceLabel(booking),
      startAt: booking.start_at,
      status: normalizeBookingStatus(booking.status),
    }));
}

function normalizeTeamMember(input: {
  activity: StaffDailyActivitySummary | undefined;
  attribution: TodayStaffFinancialAttribution | undefined;
  canViewFinancials: boolean;
  financialRow: DailyPosTodayFinancialData["staffRows"][number] | undefined;
  member: StaffWithTodayWorkday;
}): TodayTeamMember {
  const workday = input.member.today_workday;
  const largeTurns =
    typeof workday?.queue_turn_count === "number"
      ? Math.max(0, workday.queue_turn_count)
      : (input.activity?.bigTurns ?? 0);
  const smallTurns = input.activity?.smallTurns ?? 0;
  const serviceSales =
    input.financialRow?.totalEarned ??
    (input.attribution?.services && input.attribution.services !== "unavailable"
      ? 0
      : (input.activity?.assignedServiceAmount ?? 0));
  const tips =
    input.attribution?.tips === "unallocated"
      ? undefined
      : (input.financialRow?.tipAmount ??
        (input.attribution?.tips && input.attribution.tips !== "unavailable"
          ? 0
          : (input.activity?.tipAmount ?? 0)));
  const financials = input.canViewFinancials
    ? {
        earnings: serviceSales + (tips ?? 0),
        financialAttribution: input.attribution ?? {
          services: "unavailable" as const,
          tips: "unavailable" as const,
        },
        serviceSales,
        tips,
      }
    : {};

  return {
    ...financials,
    checkInAt: workday?.check_in_at ?? null,
    checkOutAt: workday?.check_out_at ?? null,
    displayName: input.member.display_name,
    id: input.member.id,
    jobTitle: input.member.job_title,
    status: input.member.today_status,
    statusLabel: STAFF_WORKDAY_STATUS_LABELS[input.member.today_status],
    turns: {
      large: largeTurns,
      small: smallTurns,
      total: largeTurns + smallTurns,
    },
  };
}

function buildTeam(input: {
  activityByStaffId: Map<string, StaffDailyActivitySummary>;
  canViewFinancials: boolean;
  financialData: DailyPosTodayFinancialData | null;
  staff: StaffWithTodayWorkday[];
}) {
  const financialRowsByStaffId = new Map(
    (input.financialData?.staffRows ?? []).map((row) => [row.staffId, row]),
  );
  const attribution = input.financialData
    ? {
        services: input.financialData.staffAttributionSource,
        tips: input.financialData.tipAttributionSource,
      }
    : undefined;

  return input.staff.map((member) =>
    normalizeTeamMember({
      activity: input.activityByStaffId.get(member.id),
      attribution,
      canViewFinancials: input.canViewFinancials,
      financialRow: financialRowsByStaffId.get(member.id),
      member,
    }),
  );
}

function summarizeBookings(
  bookings: TodayBookingRow[],
  nowIso: string,
  isCurrentDate: boolean,
) {
  let active = 0;
  let completed = 0;
  let inService = 0;
  let pending = 0;
  let upcoming = 0;

  for (const booking of bookings) {
    const status = normalizeBookingStatus(booking.status);

    if (status === "completed") {
      completed += 1;
    }

    if (status === "in_service") {
      inService += 1;
    }

    if (status === "pending" || booking.confirmation_status === "requested") {
      pending += 1;
    }

    if (isActiveBookingStatus(status)) {
      active += 1;
    }

    if (!isCurrentDate && status !== "cancelled" && status !== "no_show") {
      upcoming += 1;
    } else if (
      isCurrentDate &&
      isActiveBookingStatus(status) &&
      status !== "checked_in" &&
      status !== "in_service" &&
      booking.start_at >= nowIso
    ) {
      upcoming += 1;
    }
  }

  return { active, completed, inService, pending, upcoming };
}

function buildHourlyMetricPoints(input: {
  buckets: Map<number, number>;
  businessHours: SalonBusinessHoursWindow;
  cumulative?: boolean;
  date: string;
  timeZone: string;
}) {
  const orderedBuckets = buildSalonActivityBuckets({
    activeHours: input.buckets.keys(),
    businessHours: input.businessHours,
    date: input.date,
    timeZone: input.timeZone,
  });

  const points: TodayMetricChartPoint[] = [];
  let runningValue = 0;

  for (const bucket of orderedBuckets) {
    const value = bucket.hours.reduce(
      (total, hour) => total + (input.buckets.get(hour) ?? 0),
      0,
    );
    runningValue += value;
    points.push({
      afterHours: bucket.exceptional,
      highlight: false,
      label: bucket.label,
      value: input.cumulative ? runningValue : value,
    });
  }

  if (points.length > 0) {
    points[points.length - 1] = {
      ...points[points.length - 1],
      highlight: true,
    };
  }

  return points;
}

function buildBookingMetricChart(input: {
  businessHours: SalonBusinessHoursWindow;
  bookings: TodayBookingRow[];
  date: string;
  timeZone: string;
}): TodayMetricChart | null {
  const buckets = new Map<number, number>();

  for (const booking of input.bookings) {
    const status = normalizeBookingStatus(booking.status);

    if (status === "cancelled" || status === "no_show") {
      continue;
    }

    const local = getLocalDateHour(booking.start_at, input.timeZone);

    if (!local || local.date !== input.date) {
      continue;
    }

    buckets.set(local.hour, (buckets.get(local.hour) ?? 0) + 1);
  }

  const points = buildHourlyMetricPoints({
    buckets,
    businessHours: input.businessHours,
    date: input.date,
    timeZone: input.timeZone,
  });

  return points.length > 0
    ? {
        ariaLabel: "Appointments by scheduled hour for the selected day",
        kind: "sparkline",
        points,
      }
    : null;
}

function buildStaffMetricChart(input: {
  businessHours: SalonBusinessHoursWindow;
  date: string;
  team: TodayTeamMember[];
  timeZone: string;
}): TodayMetricChart | null {
  const buckets = new Map<number, number>();

  for (const member of input.team) {
    if (!member.checkInAt) {
      continue;
    }

    const local = getLocalDateHour(member.checkInAt, input.timeZone);

    if (!local || local.date !== input.date) {
      continue;
    }

    buckets.set(local.hour, (buckets.get(local.hour) ?? 0) + 1);
  }

  const points = buildHourlyMetricPoints({
    buckets,
    businessHours: input.businessHours,
    cumulative: true,
    date: input.date,
    timeZone: input.timeZone,
  });

  return points.length > 0
    ? {
        ariaLabel: "Staff check-ins by hour for the selected day",
        kind: "bars",
        points,
      }
    : null;
}

function buildSalesMetric(input: {
  financialData: DailyPosTodayFinancialData | null;
  isCurrentDate: boolean;
  report: DailyPosReport | null;
}): TodayMetric {
  let runningTotal = 0;
  const chartPoints =
    input.financialData?.activityPoints.map((point) => {
      runningTotal += point.total;

      return {
        afterHours: point.isExceptional,
        highlight: point.isLatest,
        label: point.label,
        value: runningTotal,
      };
    }) ?? [];

  if (!input.report) {
    return {
      chart: null,
      detail: "Financial totals require Reports permission.",
      href: "/reports",
      label: input.isCurrentDate ? "Sales Today" : "Sales",
      restricted: true,
      value: "--",
    };
  }

  return {
    detail:
      input.report.metadata.finalizedTicketCount > 0
        ? `${input.report.metadata.finalizedTicketCount} closed ticket${
            input.report.metadata.finalizedTicketCount === 1 ? "" : "s"
          }`
        : input.isCurrentDate
          ? "No sales yet today"
          : "No sales on this day",
    chart:
      chartPoints.length > 0
        ? {
            ariaLabel:
              "Hourly sales from finalized tickets for the selected day",
            kind: "sparkline",
            points: chartPoints,
          }
        : null,
    href: `/reports?${new URLSearchParams({
      date: input.report.reportDate,
    }).toString()}`,
    label: input.isCurrentDate ? "Sales Today" : "Sales",
    tone: input.report.totals.expectedTotal > 0 ? "good" : "default",
    trend: visibleSalesTrend(input.financialData?.salesComparison ?? null),
    value: formatCompactMoney(input.report.totals.expectedTotal),
  };
}

function visibleSalesTrend(
  comparison: DailyPosSalesComparison | null,
): TodayMetricTrend | null {
  if (
    !comparison ||
    comparison.status === "insufficient_history" ||
    comparison.status === "zero_baseline"
  ) {
    return null;
  }

  return {
    direction: comparison.direction,
    label: comparison.label,
  };
}

function buildCustomerMetric(input: {
  bookingChart: TodayMetricChart | null;
  bookingSummary: ReturnType<typeof summarizeBookings> | null;
  canViewBookings: boolean;
  date: string;
  financialData: DailyPosTodayFinancialData | null;
  isCurrentDate: boolean;
  report: DailyPosReport | null;
}) {
  if (input.canViewBookings && input.bookingSummary) {
    const appointmentCount =
      input.bookingSummary.active + input.bookingSummary.completed;

    return {
      chart: input.bookingChart,
      detail:
        appointmentCount > 0
          ? input.isCurrentDate
            ? `${input.bookingSummary.completed} completed / ${input.bookingSummary.upcoming} upcoming`
            : `${input.bookingSummary.completed} completed / ${input.bookingSummary.upcoming} scheduled`
          : "No appointments on this day",
      href: `/bookings?${new URLSearchParams({
        date: input.date,
        range: "day",
      }).toString()}`,
      label: "Appointments",
      value: `${appointmentCount}`,
    } satisfies TodayMetric;
  }

  if (input.report) {
    const chartPoints =
      input.financialData?.activityPoints.map((point) => ({
        afterHours: point.isExceptional,
        highlight: point.isLatest,
        label: point.label,
        value: point.ticketCount,
      })) ?? [];

    return {
      chart:
        chartPoints.length > 0
          ? {
              ariaLabel: "Hourly finalized tickets for the selected day",
              kind: "bars",
              points: chartPoints,
            }
          : null,
      detail:
        input.report.metadata.finalizedTicketCount > 0
          ? "Completed POS tickets"
          : input.isCurrentDate
            ? "No sales yet today"
            : "No sales on this day",
      href: `/reports?${new URLSearchParams({
        date: input.report.reportDate,
      }).toString()}`,
      label: "Tickets",
      value: `${input.report.metadata.finalizedTicketCount}`,
    } satisfies TodayMetric;
  }

  return {
    chart: null,
    detail: "Appointment counts require booking access.",
    href: null,
    label: "Appointments",
    restricted: true,
    value: "--",
  } satisfies TodayMetric;
}

function buildStaffMetric(input: {
  chart: TodayMetricChart | null;
  isCurrentDate: boolean;
  team: TodayTeamMember[];
}) {
  const count = input.isCurrentDate
    ? input.team.filter((member) => isActiveStaffStatus(member.status)).length
    : input.team.filter(
        (member) => member.checkInAt || member.status !== "not_checked_in",
      ).length;

  return {
    chart: input.chart,
    detail:
      count > 0
        ? input.isCurrentDate
          ? `${count} checked in now`
          : `${count} checked in on this day`
        : input.isCurrentDate
          ? "No staff checked in right now"
          : "No staff check-ins recorded",
    href: "/staff",
    label: input.isCurrentDate ? "Staff Working" : "Staff Worked",
    tone: count > 0 ? "good" : "default",
    value: `${count}`,
  } satisfies TodayMetric;
}

function buildWaitingMetric(input: {
  canViewBookings: boolean;
  isCurrentDate: boolean;
  waitingClients: TodayClientPresence[];
}) {
  if (!input.canViewBookings) {
    return {
      chart: null,
      detail: "Booking access is required to view waiting clients.",
      href: null,
      label: "Waiting",
      restricted: true,
      value: "--",
    } satisfies TodayMetric;
  }

  if (!input.isCurrentDate) {
    return {
      chart: null,
      detail: "Waiting state is only available for the current business date.",
      href: null,
      label: "Waiting",
      value: "Live only",
    } satisfies TodayMetric;
  }

  return {
    chart: null,
    detail:
      input.waitingClients.length > 0
        ? "Appointment arrivals waiting for service"
        : "No clients waiting right now",
    href: "/bookings",
    label: "Waiting",
    tone: input.waitingClients.length > 0 ? "warning" : "default",
    value: `${input.waitingClients.length}`,
  } satisfies TodayMetric;
}

function buildAttention(input: {
  bookingSummary: ReturnType<typeof summarizeBookings> | null;
  canViewTickets: boolean;
  date: string;
  isCurrentDate: boolean;
  notifications: TodayAttentionItem[];
  report: DailyPosReport | null;
  waitingClients: TodayClientPresence[];
}) {
  const items: TodayAttentionItem[] = [];

  if (input.isCurrentDate && input.waitingClients.length > 0) {
    items.push({
      actionLabel: "Review",
      detail: "Appointment arrivals are marked checked in and have not started service.",
      href: "/bookings",
      id: "waiting-clients",
      label: `${input.waitingClients.length} waiting client${
        input.waitingClients.length === 1 ? "" : "s"
      }`,
      tone: "warning",
    });
  }

  if (input.bookingSummary && input.bookingSummary.pending > 0) {
    items.push({
      actionLabel: "Review",
      detail: input.isCurrentDate
        ? "Review pending or requested appointments for today."
        : "Review pending or requested appointments for this date.",
      href: `/bookings?${new URLSearchParams({
        date: input.date,
        range: "day",
        status: "pending",
      }).toString()}`,
      id: "pending-bookings",
      label: `${input.bookingSummary.pending} booking${
        input.bookingSummary.pending === 1 ? "" : "s"
      } need review`,
      tone: "notice",
    });
  }

  if (input.report && input.report.metadata.excludedOpenTicketCount > 0) {
    items.push({
      actionLabel: input.canViewTickets ? "View" : undefined,
      detail: input.isCurrentDate
        ? "Open tickets are excluded from daily closing totals until completed."
        : "Open tickets from this date are excluded from daily closing totals until completed.",
      href: input.canViewTickets
        ? `/pos-tickets?${new URLSearchParams({
            date: input.date,
          }).toString()}`
        : null,
      id: "open-pos-tickets",
      label: `${input.report.metadata.excludedOpenTicketCount} open POS ticket${
        input.report.metadata.excludedOpenTicketCount === 1 ? "" : "s"
      }`,
      tone: "notice",
    });
  }

  if (input.isCurrentDate) {
    items.push(
      ...input.notifications.map((notification) => ({
        ...notification,
        actionLabel: notification.actionLabel ?? "View",
      })),
    );
  }

  if (items.length === 0) {
    return [
      {
        detail: input.isCurrentDate
          ? "Nothing needs your attention right now."
          : "No date-specific issues found for this day.",
        href: null,
        id: "all-good",
        label: "All good",
        tone: "good" as const,
      },
    ];
  }

  return items.slice(0, 5);
}

function buildPerformance(input: {
  bookingSummary: ReturnType<typeof summarizeBookings> | null;
  businessHours: SalonBusinessHoursWindow;
  financialData: DailyPosTodayFinancialData | null;
  report: DailyPosReport | null;
  team: TodayTeamMember[];
}) {
  const staffBars = input.team
    .map((member) => ({
      label: member.displayName,
      staffId: member.id,
      value: member.serviceSales ?? 0,
    }))
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, MONEY_PERFORMANCE_LIMIT);
  const sales = input.report
    ? {
        comparison: visibleSalesTrend(input.financialData?.salesComparison ?? null),
        discount: input.report.totals.totalDiscount,
        service: input.report.totals.totalStaffEarned,
        ticketCount: input.report.metadata.finalizedTicketCount,
        tip: input.report.totals.totalTip,
        total: input.report.totals.expectedTotal,
      }
    : null;
  const bookingStatus = input.bookingSummary ?? {
    active: 0,
    completed: 0,
    upcoming: 0,
  };
  const salesTrend =
    input.financialData?.activityPoints.map((point) => ({
      afterHours: point.isExceptional,
      label: point.label,
      latest: point.isLatest,
      service: point.service,
      ticketCount: point.ticketCount,
      tip: point.tip,
      total: point.total,
    })) ?? [];
  const hasSalesActivity = Boolean(
    sales &&
      (sales.ticketCount > 0 ||
        sales.total > 0 ||
        sales.service > 0 ||
        sales.tip > 0),
  );
  const emptyLabel =
    !hasSalesActivity && staffBars.length === 0
      ? input.businessHours.isClosed
        ? "Closed day."
        : "No sales activity yet."
      : null;

  return {
    bookingStatus,
    emptyLabel,
    salesTrend,
    sales,
    staffBars,
  } satisfies TodayPerformance;
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function getGreetingName(context: CurrentBusinessContext) {
  return (
    context.user?.first_name?.trim() ||
    context.user?.display_name?.trim()?.split(/\s+/)[0] ||
    context.user?.email?.split("@")[0] ||
    "there"
  );
}

function emptyDashboard(input: {
  businessHours: SalonBusinessHoursWindow;
  clock: BusinessClock;
  context: CurrentBusinessContext;
  dayView: TodayDayView;
  permissions: TodayDashboardPermissions;
}): TodayDashboard {
  return {
    attention: [
      {
        detail: "Today requires staff view permission for this salon workspace.",
        href: null,
        id: "restricted",
        label: "Permission required",
        tone: "warning",
      },
    ],
    businessHours: input.businessHours,
    date: input.clock.date,
    dayView: input.dayView,
    generatedAt: new Date().toISOString(),
    greetingName: getGreetingName(input.context),
    loadErrors: [],
    noAccess: true,
    performance: {
      bookingStatus: {
        active: 0,
        completed: 0,
        upcoming: 0,
      },
      emptyLabel: "No dashboard data is available for this permission set.",
      salesTrend: [],
      sales: null,
      staffBars: [],
    },
    permissions: input.permissions,
    quickAccesses: emptyQuickAccessConfiguration(),
    rightNow: {
      scheduleHref: null,
      upcomingBookings: [],
      waitingClients: [],
    },
    salonName: input.context.currentSalon?.name ?? "Current salon",
    summary: {
      customers: {
        chart: null,
        detail: null,
        href: null,
        label: "Appointments",
        restricted: true,
        value: "--",
      },
      sales: {
        chart: null,
        detail: null,
        href: null,
        label: "Sales Today",
        restricted: true,
        value: "--",
      },
      staff: {
        chart: null,
        detail: null,
        href: null,
        label: "Staff Working",
        restricted: true,
        value: "--",
      },
      waiting: {
        chart: null,
        detail: null,
        href: null,
        label: "Waiting",
        restricted: true,
        value: "--",
      },
    },
    team: [],
    timezone: input.clock.timezone,
  };
}

export async function getTodayDashboard(
  context: CurrentBusinessContext,
  options: TodayDashboardOptions = {},
): Promise<TodayDashboard> {
  const currentClock = await loadBusinessClock(context);
  const dayView = buildDayView({
    currentDate: currentClock.date,
    selectedDateInput: options.date,
  });
  const clock: BusinessClock = {
    date: dayView.selectedDate,
    timezone: currentClock.timezone,
  };
  const permissions: TodayDashboardPermissions = {
    canViewBookings: canUsePermission(context, "booking.view"),
    canViewDashboard: canUsePermission(context, "staff.view"),
    canViewReports: canUsePermission(context, DAILY_POS_REPORT_PERMISSIONS.view),
    canViewStaffFinancials: canUseAnyPermission(context, [
      "payroll.view",
      "payroll.manage",
      "reports.view",
      "tickets.view",
      "tickets.manage",
    ]),
    canViewTickets: canUseAnyPermission(context, ["tickets.view", "tickets.manage"]),
  };
  const unavailableBusinessHours = unavailableSalonBusinessHours({
    date: clock.date,
    fallbackReason: "Today dashboard access is unavailable.",
    timeZone: clock.timezone,
  });

  if (!permissions.canViewDashboard) {
    return emptyDashboard({
      businessHours: unavailableBusinessHours,
      clock,
      context,
      dayView,
      permissions,
    });
  }

  const businessHoursResult = await loadBusinessHoursDashboardData({
    context,
    date: clock.date,
    timezone: clock.timezone,
  });
  const businessHours =
    businessHoursResult.data ??
    unavailableSalonBusinessHours({
      date: clock.date,
      fallbackReason: "Salon business hours could not be resolved.",
      timeZone: clock.timezone,
    });
  const waitingSalonId = context.currentSalon?.id ?? null;
  const [
    staffResult,
    bookingsResult,
    waitingVisitsResult,
    reportResult,
    financialResult,
    notificationsResult,
    quickAccessResult,
  ] = await Promise.all([
      loadStaffDashboardData({
        canViewFinancials: permissions.canViewStaffFinancials,
        context,
        date: clock.date,
      }),
      permissions.canViewBookings
        ? loadBookingDashboardData({
            context,
            date: clock.date,
            timezone: clock.timezone,
          })
        : Promise.resolve({ data: [] as TodayBookingRow[], error: null }),
      permissions.canViewBookings && dayView.isCurrentDate && waitingSalonId
        ? (async () => {
            const supabase = await createAuthenticatedSupabaseServerClient();

            if (!supabase) {
              return {
                data: [] as CustomerVisitQueueItem[],
                error: {
                  area: "waiting" as const,
                  message: "Waiting clients could not be loaded.",
                },
              };
            }

            try {
              return {
                data: await getCustomerVisitQueueForSalonOrEmpty({
                  limit: 25,
                  salonId: waitingSalonId,
                  supabase,
                }),
                error: null,
              };
            } catch (error) {
              return {
                data: [] as CustomerVisitQueueItem[],
                error: {
                  area: "waiting" as const,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Waiting clients could not be loaded.",
                },
              };
            }
          })()
        : Promise.resolve({
            data: [] as CustomerVisitQueueItem[],
            error: null,
          }),
      permissions.canViewReports
        ? loadReportDashboardData({ context, date: clock.date })
        : Promise.resolve({ data: null, error: null }),
      permissions.canViewStaffFinancials
        ? loadFinancialDashboardData({
            businessHours,
            context,
            date: clock.date,
            timezone: clock.timezone,
          })
        : Promise.resolve({ data: null, error: null }),
      dayView.isCurrentDate
        ? loadNotificationAttentionItems(context)
        : Promise.resolve({ data: [] as TodayAttentionItem[], error: null }),
      loadQuickAccessDashboardData(context),
    ]);
  const loadErrors = [
    businessHoursResult.error,
    staffResult.error,
    bookingsResult.error,
    waitingVisitsResult.error,
    reportResult.error,
    financialResult.error,
    notificationsResult.error,
    quickAccessResult.error,
  ].filter((error): error is TodayLoadError => Boolean(error));
  const financialData = financialResult.data;
  const team = staffResult.data
    ? buildTeam({
        activityByStaffId: staffResult.data.activityByStaffId,
        canViewFinancials: permissions.canViewStaffFinancials,
        financialData,
        staff: staffResult.data.staff,
      })
    : [];
  const bookings = bookingsResult.data ?? [];
  const nowIso = new Date().toISOString();
  const bookingSummary = permissions.canViewBookings
    ? summarizeBookings(bookings, nowIso, dayView.isCurrentDate)
    : null;
  const bookingChart = permissions.canViewBookings
    ? buildBookingMetricChart({
        businessHours,
        bookings,
        date: clock.date,
        timeZone: clock.timezone,
      })
    : null;
  const staffChart = buildStaffMetricChart({
    businessHours,
    date: clock.date,
    team,
    timeZone: clock.timezone,
  });
  const waitingClients = permissions.canViewBookings && dayView.isCurrentDate
    ? mapWaitingVisits(waitingVisitsResult.data ?? [], clock.date)
    : [];
  const upcomingBookings = permissions.canViewBookings
    ? mapUpcomingBookings({
        bookings,
        date: clock.date,
        isCurrentDate: dayView.isCurrentDate,
        nowIso,
      })
    : [];
  const report = reportResult.data;
  const notificationAttention = notificationsResult.data ?? [];

  return {
    attention: buildAttention({
      bookingSummary,
      canViewTickets: permissions.canViewTickets,
      date: clock.date,
      isCurrentDate: dayView.isCurrentDate,
      notifications: notificationAttention,
      report,
      waitingClients,
    }),
    businessHours,
    date: clock.date,
    dayView,
    generatedAt: nowIso,
    greetingName: getGreetingName(context),
    loadErrors,
    noAccess: false,
    performance: buildPerformance({
      bookingSummary,
      businessHours,
      financialData,
      report,
      team,
    }),
    permissions,
    quickAccesses: quickAccessResult.data ?? emptyQuickAccessConfiguration(),
    rightNow: {
      scheduleHref: permissions.canViewBookings
        ? `/bookings?${new URLSearchParams({
            date: clock.date,
            range: "day",
          }).toString()}`
        : null,
      upcomingBookings,
      waitingClients,
    },
    salonName: context.currentSalon?.name ?? "Current salon",
    summary: {
      customers: buildCustomerMetric({
        bookingChart,
        bookingSummary,
        canViewBookings: permissions.canViewBookings,
        date: clock.date,
        financialData,
        isCurrentDate: dayView.isCurrentDate,
        report,
      }),
      sales: buildSalesMetric({
        financialData,
        isCurrentDate: dayView.isCurrentDate,
        report,
      }),
      staff: buildStaffMetric({
        chart: staffChart,
        isCurrentDate: dayView.isCurrentDate,
        team,
      }),
      waiting: buildWaitingMetric({
        canViewBookings: permissions.canViewBookings,
        isCurrentDate: dayView.isCurrentDate,
        waitingClients,
      }),
    },
    team,
    timezone: clock.timezone,
  };
}
