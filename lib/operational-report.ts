import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import {
  DAILY_POS_REPORT_PERMISSIONS,
  getUtcBoundsForLocalDate,
  isDateInputValue,
} from "@/lib/daily-pos-report";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeBookingStatus, type BookingStatus } from "@/types/booking";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type { PosPaymentMethod } from "@/types/pos-payment";
import type {
  PosTicketDiscountType,
  PosTicketStatus,
  PosTicketTipType,
} from "@/types/pos-ticket";

export type OperationalReportPreset =
  | "custom"
  | "this_month"
  | "this_week"
  | "today";

export type OperationalReportSearchParams = {
  date?: string | string[];
  end?: string | string[];
  preset?: string | string[];
  start?: string | string[];
};

export type OperationalReportRange = {
  businessDate: string;
  dayCount: number;
  endDate: string;
  label: string;
  previousEndDate: string;
  previousStartDate: string;
  preset: OperationalReportPreset;
  startDate: string;
  timeZone: string;
};

export type OperationalReportTotals = {
  averageTicket: number;
  collectedTotal: number;
  discountTotal: number;
  dueTotal: number;
  grossSales: number;
  netSales: number;
  taxTotal: number;
  ticketCount: number;
  tipTotal: number;
  totalRevenue: number;
};

export type OperationalReportComparisonMetric = {
  current: number;
  delta: number;
  direction: "down" | "flat" | "up";
  percentChange: number | null;
  previous: number;
};

export type OperationalReportComparison = {
  averageTicket: OperationalReportComparisonMetric;
  bookings: OperationalReportComparisonMetric;
  customerCount: OperationalReportComparisonMetric;
  grossSales: OperationalReportComparisonMetric;
  netSales: OperationalReportComparisonMetric;
  ticketCount: OperationalReportComparisonMetric;
  totalRevenue: OperationalReportComparisonMetric;
};

export type OperationalReportTrendPoint = {
  bookingCount: number;
  customerCount: number;
  date: string;
  grossSales: number;
  label: string;
  netSales: number;
  ticketCount: number;
  totalRevenue: number;
};

export type OperationalReportPaymentRow = {
  amount: number;
  method: PosPaymentMethod;
  percentOfCollected: number | null;
};

export type OperationalReportServiceRow = {
  category: string;
  itemCount: number;
  percentOfGrossSales: number | null;
  revenue: number;
  serviceId: string | null;
  serviceName: string;
  ticketCount: number;
};

export type OperationalReportStaffAttributionSource =
  | "none"
  | "pos_ticket_items"
  | "pos_ticket_staff_earnings";

export type OperationalReportStaffRow = {
  averageTicket: number;
  bigTurns: number;
  serviceSales: number;
  smallTurns: number;
  staffId: string;
  staffName: string;
  ticketCount: number;
  tips: number;
  totalEarnings: number;
  totalTurns: number;
};

export type OperationalReportBookingMetrics = {
  booked: number;
  cancelled: number;
  checkedIn: number;
  completed: number;
  completionRate: number | null;
  confirmed: number;
  inService: number;
  noShow: number;
  pending: number;
};

export type OperationalReportCustomerMetrics = {
  activeCustomers: number;
  linkedCustomers: number;
  newCustomerRecords: number;
  returningCustomers: number;
};

export type OperationalReportTicketRow = {
  closedAt: string | null;
  customerName: string | null;
  id: string;
  openedAt: string;
  paymentStatus: "overpaid" | "paid" | "partial" | "unpaid";
  ticketNumber: string;
  totals: OperationalReportTotals;
};

export type OperationalReportData = {
  bookingMetrics: OperationalReportBookingMetrics;
  comparison: OperationalReportComparison;
  customerMetrics: OperationalReportCustomerMetrics;
  dataGaps: string[];
  isEmpty: boolean;
  paymentBreakdown: OperationalReportPaymentRow[];
  permissions: {
    canViewBookings: boolean;
    canViewCustomers: boolean;
    canViewReports: boolean;
    canViewStaffFinancials: boolean;
  };
  range: OperationalReportRange;
  recentTickets: OperationalReportTicketRow[];
  serviceBreakdown: OperationalReportServiceRow[];
  staffAttributionSource: OperationalReportStaffAttributionSource;
  staffRows: OperationalReportStaffRow[];
  totals: OperationalReportTotals;
  trend: OperationalReportTrendPoint[];
};

type SupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type ReportAuthContext = {
  context: CurrentBusinessContext;
  Account: NonNullable<CurrentBusinessContext["currentAccount"]>;
  salon: NonNullable<CurrentBusinessContext["currentSalon"]>;
  supabase: SupabaseClient;
  user: NonNullable<CurrentBusinessContext["user"]>;
};

type ReportClock = {
  businessDate: string;
  timeZone: string;
};

type TicketTurnPartRow = {
  amount: number;
  staff_id: string | null;
  turn_index: number;
  turn_type: "large" | "small";
};

type TicketItemRow = {
  assigned_staff: { display_name: string; id: string } | null;
  assigned_staff_id: string | null;
  id: string;
  is_removed: boolean | null;
  line_total: number;
  quantity: number;
  service: { category: string | null; id: string; name: string } | null;
  service_category_snapshot: string | null;
  service_id: string | null;
  service_name_snapshot: string | null;
  turn_parts?: TicketTurnPartRow[] | null;
};

type TicketPaymentRow = {
  amount: number;
  payment_method: PosPaymentMethod;
};

type TicketRow = {
  closed_at: string | null;
  customer: { created_at: string; id: string; name: string | null } | null;
  customer_id: string | null;
  discount_type: PosTicketDiscountType;
  discount_value: number;
  id: string;
  opened_at: string;
  payments?: TicketPaymentRow[] | null;
  status: PosTicketStatus;
  tax_rate: number;
  ticket_items?: TicketItemRow[] | null;
  ticket_number: string | null;
  tip_type: PosTicketTipType;
  tip_value: number;
};

type StaffEarningRow = {
  big_turn_count: number;
  service_total: number;
  staff: { display_name: string; id: string } | null;
  staff_id: string;
  small_turn_count: number;
  ticket: { id: string; status: PosTicketStatus } | null;
  ticket_id: string;
  tip_amount: number;
  total_earning: number;
};

type BookingRow = {
  customer_id: string | null;
  id: string;
  start_at: string;
  status: BookingStatus;
};

type CustomerRow = {
  created_at: string;
  customer_user_id: string | null;
  id: string;
};

type ReportFacts = {
  bookingMetrics: OperationalReportBookingMetrics;
  bookings: BookingRow[];
  customerMetrics: OperationalReportCustomerMetrics;
  dataGaps: string[];
  paymentBreakdown: OperationalReportPaymentRow[];
  recentTickets: OperationalReportTicketRow[];
  serviceBreakdown: OperationalReportServiceRow[];
  staffAttributionSource: OperationalReportStaffAttributionSource;
  staffRows: OperationalReportStaffRow[];
  tickets: TicketRow[];
  totals: OperationalReportTotals;
  trend: OperationalReportTrendPoint[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 93;
const RESULT_LIMIT = 5000;
const MONEY_EPSILON = 0.005;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toCents(value: number | string | null | undefined) {
  return Math.round(numberValue(value) * 100);
}

function fromCents(value: number) {
  return roundMoney(value / 100);
}

function sumCents(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanParam(value: string | string[] | undefined) {
  return firstParam(value)?.trim() ?? "";
}

function dateFromDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnlyFromUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  return dateOnlyFromUtcDate(
    new Date(dateFromDateOnly(value).getTime() + days * DAY_MS),
  );
}

function dayCount(startDate: string, endDate: string) {
  return (
    Math.round(
      (dateFromDateOnly(endDate).getTime() -
        dateFromDateOnly(startDate).getTime()) /
        DAY_MS,
    ) + 1
  );
}

function monthStart(value: string) {
  const [year, month] = value.split("-").map(Number);

  return `${year}-${`${month}`.padStart(2, "0")}-01`;
}

function weekStart(value: string) {
  const date = dateFromDateOnly(value);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return dateOnlyFromUtcDate(new Date(date.getTime() + mondayOffset * DAY_MS));
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) {
    return formatDateLabel(startDate);
  }

  return `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`;
}

function normalizePreset(value: string): OperationalReportPreset {
  if (
    value === "today" ||
    value === "this_week" ||
    value === "this_month" ||
    value === "custom"
  ) {
    return value;
  }

  return "this_month";
}

function localDateFromIso(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date(value));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : value.slice(0, 10);
}

function fallbackBusinessDate(timeZone: string) {
  try {
    return localDateFromIso(new Date().toISOString(), timeZone);
  } catch {
    return dateOnlyFromUtcDate(new Date());
  }
}

async function requireOperationalReportContext(
  context?: CurrentBusinessContext,
): Promise<ReportAuthContext> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("You must be logged in to view reports.");
  }

  if (!isSalonManageContext(resolvedContext)) {
    throw new Error("Open reports from a Business workspace.");
  }

  if (!resolvedContext.currentAccount) {
    throw new Error("Choose a salon workspace before viewing reports.");
  }

  if (!resolvedContext.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  await requirePermission(DAILY_POS_REPORT_PERMISSIONS.view, resolvedContext);

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return {
    context: resolvedContext,
    Account: resolvedContext.currentAccount,
    salon: resolvedContext.currentSalon,
    supabase,
    user: resolvedContext.user,
  };
}

async function getReportPermissions(context: CurrentBusinessContext) {
  const [
    canViewBookings,
    canViewCustomers,
    canViewReports,
    canViewPayroll,
    canManagePayroll,
    canViewTickets,
    canManageTickets,
  ] = await Promise.all([
    hasPermission("booking.view", context),
    hasPermission("customers.view", context),
    hasPermission(DAILY_POS_REPORT_PERMISSIONS.view, context),
    hasPermission("payroll.view", context),
    hasPermission("payroll.manage", context),
    hasPermission("tickets.view", context),
    hasPermission("tickets.manage", context),
  ]);

  return {
    canViewBookings,
    canViewCustomers,
    canViewReports,
    canViewStaffFinancials:
      canViewReports ||
      canViewPayroll ||
      canManagePayroll ||
      canViewTickets ||
      canManageTickets,
  };
}

async function loadBusinessClock(auth: ReportAuthContext): Promise<ReportClock> {
  const fallbackTimeZone = auth.user.timezone || "America/Chicago";
  const fallbackDate = fallbackBusinessDate(fallbackTimeZone);
  const fallback = {
    businessDate: fallbackDate,
    timeZone: fallbackTimeZone,
  };

  try {
    const [timezoneResult, dateResult] = await Promise.all([
      auth.supabase.rpc("get_salon_business_timezone", {
        p_salon_id: auth.salon.id,
      }),
      auth.supabase.rpc("get_salon_business_date", {
        p_salon_id: auth.salon.id,
      }),
    ]);

    if (timezoneResult.error || dateResult.error) {
      console.error("Supabase load report business clock failed", {
        accountId: auth.Account.id,
        dateError: dateResult.error?.message,
        salonId: auth.salon.id,
        timezoneError: timezoneResult.error?.message,
        userId: auth.user.id,
      });
      return fallback;
    }

    return {
      businessDate:
        typeof dateResult.data === "string" && dateResult.data
          ? dateResult.data.slice(0, 10)
          : fallback.businessDate,
      timeZone:
        typeof timezoneResult.data === "string" && timezoneResult.data.trim()
          ? timezoneResult.data
          : fallback.timeZone,
    };
  } catch (error) {
    console.error("Report business clock fallback used", {
      error: error instanceof Error ? error.message : "Unknown error",
      salonId: auth.salon.id,
      userId: auth.user.id,
    });
    return fallback;
  }
}

function resolveReportRange(
  params: OperationalReportSearchParams,
  clock: ReportClock,
): {
  dataGaps: string[];
  range: OperationalReportRange;
} {
  const dataGaps: string[] = [];
  const legacyDate = cleanParam(params.date);
  const rawPreset = cleanParam(params.preset);
  let preset = normalizePreset(rawPreset);
  let startDate = clock.businessDate;
  let endDate = clock.businessDate;

  if (
    legacyDate &&
    isDateInputValue(legacyDate) &&
    !rawPreset &&
    !cleanParam(params.start) &&
    !cleanParam(params.end)
  ) {
    preset = "custom";
    startDate = legacyDate;
    endDate = legacyDate;
  } else if (preset === "today") {
    startDate = clock.businessDate;
    endDate = clock.businessDate;
  } else if (preset === "this_week") {
    startDate = weekStart(clock.businessDate);
    endDate = clock.businessDate;
  } else if (preset === "this_month") {
    startDate = monthStart(clock.businessDate);
    endDate = clock.businessDate;
  } else {
    const requestedStart = cleanParam(params.start);
    const requestedEnd = cleanParam(params.end);

    if (isDateInputValue(requestedStart) && isDateInputValue(requestedEnd)) {
      startDate = requestedStart;
      endDate = requestedEnd;
    } else if (isDateInputValue(legacyDate)) {
      startDate = legacyDate;
      endDate = legacyDate;
    } else {
      startDate = monthStart(clock.businessDate);
      endDate = clock.businessDate;
      preset = "this_month";
      dataGaps.push("Invalid custom dates were replaced with this month.");
    }
  }

  if (endDate > clock.businessDate) {
    endDate = clock.businessDate;
    dataGaps.push("Future dates are excluded from operational reports.");
  }

  if (startDate > endDate) {
    startDate = endDate;
    dataGaps.push("The start date was adjusted because it was after the end date.");
  }

  const days = dayCount(startDate, endDate);

  if (days > MAX_REPORT_DAYS) {
    endDate = addDays(startDate, MAX_REPORT_DAYS - 1);
    dataGaps.push(`Custom ranges are capped at ${MAX_REPORT_DAYS} days for this MVP.`);
  }

  const finalDayCount = dayCount(startDate, endDate);
  const previousEndDate = addDays(startDate, -1);
  const previousStartDate = addDays(startDate, -finalDayCount);

  return {
    dataGaps,
    range: {
      businessDate: clock.businessDate,
      dayCount: finalDayCount,
      endDate,
      label: formatRangeLabel(startDate, endDate),
      previousEndDate,
      previousStartDate,
      preset,
      startDate,
      timeZone: clock.timeZone,
    },
  };
}

function rangeBounds(range: Pick<OperationalReportRange, "endDate" | "startDate" | "timeZone">) {
  const startBounds = getUtcBoundsForLocalDate(range.startDate, range.timeZone);
  const endBounds = getUtcBoundsForLocalDate(range.endDate, range.timeZone);

  return {
    endIso: endBounds.openedTo,
    startIso: startBounds.openedFrom,
  };
}

async function loadTickets(
  auth: ReportAuthContext,
  range: OperationalReportRange,
) {
  const bounds = rangeBounds(range);
  const { data, error } = await auth.supabase
    .from("pos_tickets")
    .select(
      "id, ticket_number, customer_id, opened_at, closed_at, status, discount_type, discount_value, tax_rate, tip_type, tip_value, customer:customers(id, name, created_at), payments:pos_payments(payment_method, amount), ticket_items:pos_ticket_items(id, service_id, assigned_staff_id, service_name_snapshot, service_category_snapshot, quantity, line_total, is_removed, service:services(id, name, category), assigned_staff:staff!pos_ticket_items_assigned_staff_id_fkey(id, display_name), turn_parts:pos_ticket_item_turn_parts(amount, staff_id, turn_index, turn_type))",
    )
    .eq("salon_id", auth.salon.id)
    .gte("opened_at", bounds.startIso)
    .lte("opened_at", bounds.endIso)
    .order("opened_at", { ascending: true })
    .limit(RESULT_LIMIT)
    .returns<TicketRow[]>();

  if (error) {
    console.error("Supabase load operational report POS tickets failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: auth.Account.id,
      endDate: range.endDate,
      salonId: auth.salon.id,
      startDate: range.startDate,
      userId: auth.user.id,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadBookings(
  auth: ReportAuthContext,
  range: OperationalReportRange,
  canViewBookings: boolean,
) {
  if (!canViewBookings) {
    return [] as BookingRow[];
  }

  const bounds = rangeBounds(range);
  const { data, error } = await auth.supabase
    .from("bookings")
    .select("id, customer_id, start_at, status")
    .eq("salon_id", auth.salon.id)
    .gte("start_at", bounds.startIso)
    .lte("start_at", bounds.endIso)
    .order("start_at", { ascending: true })
    .limit(RESULT_LIMIT)
    .returns<BookingRow[]>();

  if (error) {
    console.error("Supabase load operational report bookings failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: auth.Account.id,
      endDate: range.endDate,
      salonId: auth.salon.id,
      startDate: range.startDate,
      userId: auth.user.id,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadStaffEarnings(
  auth: ReportAuthContext,
  range: OperationalReportRange,
  canViewStaffFinancials: boolean,
) {
  if (!canViewStaffFinancials) {
    return [] as StaffEarningRow[];
  }

  const { data, error } = await auth.supabase
    .from("pos_ticket_staff_earnings")
    .select(
      "staff_id, ticket_id, service_total, tip_amount, total_earning, big_turn_count, small_turn_count, staff:staff(id, display_name), ticket:pos_tickets!inner(id, status)",
    )
    .eq("salon_id", auth.salon.id)
    .gte("work_date", range.startDate)
    .lte("work_date", range.endDate)
    .in("ticket.status", ["closed"])
    .limit(RESULT_LIMIT)
    .returns<StaffEarningRow[]>();

  if (error) {
    console.error("Supabase load operational report staff earnings failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: auth.Account.id,
      endDate: range.endDate,
      salonId: auth.salon.id,
      startDate: range.startDate,
      userId: auth.user.id,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadCustomerRowsByIds(
  auth: ReportAuthContext,
  customerIds: string[],
) {
  const ids = Array.from(new Set(customerIds.filter(Boolean)));
  const rows: CustomerRow[] = [];

  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500);
    const { data, error } = await auth.supabase
      .from("customers")
      .select("id, customer_user_id, created_at")
      .eq("location_id", auth.salon.id)
      .in("id", chunk)
      .returns<CustomerRow[]>();

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...(data ?? []));
  }

  return rows;
}

async function loadNewCustomerRecords(
  auth: ReportAuthContext,
  range: OperationalReportRange,
  canViewCustomers: boolean,
) {
  if (!canViewCustomers) {
    return [] as CustomerRow[];
  }

  const bounds = rangeBounds(range);
  const { data, error } = await auth.supabase
    .from("customers")
    .select("id, customer_user_id, created_at")
    .eq("location_id", auth.salon.id)
    .gte("created_at", bounds.startIso)
    .lte("created_at", bounds.endIso)
    .limit(RESULT_LIMIT)
    .returns<CustomerRow[]>();

  if (error) {
    console.error("Supabase load operational report customer records failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      accountId: auth.Account.id,
      endDate: range.endDate,
      salonId: auth.salon.id,
      startDate: range.startDate,
      userId: auth.user.id,
    });
    throw new Error(error.message);
  }

  return data ?? [];
}

function activeItems(ticket: TicketRow) {
  return (ticket.ticket_items ?? []).filter((item) => !item.is_removed);
}

function itemAmountCents(item: TicketItemRow) {
  const turnParts = item.turn_parts ?? [];

  if (turnParts.length > 0) {
    return sumCents(turnParts.map((part) => toCents(part.amount)));
  }

  return toCents(item.line_total);
}

function calculateOperationalTicketTotals(ticket: TicketRow): OperationalReportTotals {
  const activeTicketItems = activeItems(ticket);
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: numberValue(ticket.discount_value),
    items: activeTicketItems.map((item) => ({
      line_total: fromCents(itemAmountCents(item)),
    })),
    payments: ticket.payments ?? [],
    taxRate: numberValue(ticket.tax_rate),
    tipType: ticket.tip_type,
    tipValue: numberValue(ticket.tip_value),
  });

  return {
    averageTicket: totals.total,
    collectedTotal: totals.paid,
    discountTotal: totals.discount_amount,
    dueTotal: totals.remaining,
    grossSales: totals.subtotal,
    netSales: totals.taxable_amount,
    taxTotal: totals.tax_amount,
    ticketCount: 1,
    tipTotal: totals.tip_amount,
    totalRevenue: totals.total,
  };
}

function emptyTotals(): OperationalReportTotals {
  return {
    averageTicket: 0,
    collectedTotal: 0,
    discountTotal: 0,
    dueTotal: 0,
    grossSales: 0,
    netSales: 0,
    taxTotal: 0,
    ticketCount: 0,
    tipTotal: 0,
    totalRevenue: 0,
  };
}

function addTotals(
  left: OperationalReportTotals,
  right: OperationalReportTotals,
): OperationalReportTotals {
  const ticketCount = left.ticketCount + right.ticketCount;
  const totalRevenue = roundMoney(left.totalRevenue + right.totalRevenue);

  return {
    averageTicket:
      ticketCount === 0 ? 0 : roundMoney(totalRevenue / ticketCount),
    collectedTotal: roundMoney(left.collectedTotal + right.collectedTotal),
    discountTotal: roundMoney(left.discountTotal + right.discountTotal),
    dueTotal: roundMoney(left.dueTotal + right.dueTotal),
    grossSales: roundMoney(left.grossSales + right.grossSales),
    netSales: roundMoney(left.netSales + right.netSales),
    taxTotal: roundMoney(left.taxTotal + right.taxTotal),
    ticketCount,
    tipTotal: roundMoney(left.tipTotal + right.tipTotal),
    totalRevenue,
  };
}

function paymentStatus(totals: OperationalReportTotals) {
  const totalCents = toCents(totals.totalRevenue);
  const paidCents = toCents(totals.collectedTotal);

  if (totalCents <= 0 && paidCents <= 0) {
    return "unpaid" as const;
  }

  if (paidCents > totalCents) {
    return "overpaid" as const;
  }

  if (paidCents >= totalCents) {
    return "paid" as const;
  }

  return paidCents > 0 ? "partial" : "unpaid";
}

function buildPaymentBreakdown(tickets: TicketRow[]) {
  const centsByMethod = new Map<PosPaymentMethod, number>();

  for (const ticket of tickets) {
    for (const payment of ticket.payments ?? []) {
      const current = centsByMethod.get(payment.payment_method) ?? 0;
      centsByMethod.set(payment.payment_method, current + toCents(payment.amount));
    }
  }

  const totalCents = sumCents(Array.from(centsByMethod.values()));

  return Array.from(centsByMethod.entries())
    .map(([method, cents]) => ({
      amount: fromCents(cents),
      method,
      percentOfCollected:
        totalCents <= 0 ? null : Math.round((cents / totalCents) * 1000) / 10,
    }))
    .sort((left, right) => right.amount - left.amount);
}

function serviceKey(item: TicketItemRow) {
  return (
    item.service_id ??
    item.service?.id ??
    `${item.service_name_snapshot ?? item.service?.name ?? "Unknown"}:${
      item.service_category_snapshot ?? item.service?.category ?? "Uncategorized"
    }`
  );
}

function buildServiceBreakdown(tickets: TicketRow[], grossSales: number) {
  const servicesByKey = new Map<
    string,
    {
      category: string;
      itemCount: number;
      revenueCents: number;
      serviceId: string | null;
      serviceName: string;
      ticketIds: Set<string>;
    }
  >();

  for (const ticket of tickets) {
    for (const item of activeItems(ticket)) {
      const key = serviceKey(item);
      const entry =
        servicesByKey.get(key) ??
        {
          category:
            item.service_category_snapshot ??
            item.service?.category ??
            "Uncategorized",
          itemCount: 0,
          revenueCents: 0,
          serviceId: item.service_id ?? item.service?.id ?? null,
          serviceName:
            item.service_name_snapshot ??
            item.service?.name ??
            "Unknown service",
          ticketIds: new Set<string>(),
        };

      entry.itemCount += Math.max(1, Math.round(numberValue(item.quantity) || 1));
      entry.revenueCents += itemAmountCents(item);
      entry.ticketIds.add(ticket.id);
      servicesByKey.set(key, entry);
    }
  }

  const grossCents = toCents(grossSales);

  return Array.from(servicesByKey.values())
    .map((entry) => ({
      category: entry.category,
      itemCount: entry.itemCount,
      percentOfGrossSales:
        grossCents <= 0
          ? null
          : Math.round((entry.revenueCents / grossCents) * 1000) / 10,
      revenue: fromCents(entry.revenueCents),
      serviceId: entry.serviceId,
      serviceName: entry.serviceName,
      ticketCount: entry.ticketIds.size,
    }))
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 12);
}

function staffName(staffId: string, name: string | null | undefined) {
  return name?.trim() || `Staff ${staffId.slice(0, 8)}`;
}

function buildStaffRowsFromEarnings(
  earnings: StaffEarningRow[],
): OperationalReportStaffRow[] {
  const rowsByStaffId = new Map<
    string,
    {
      bigTurns: number;
      serviceCents: number;
      smallTurns: number;
      staffName: string;
      ticketIds: Set<string>;
      tipCents: number;
      totalEarningCents: number;
    }
  >();

  for (const earning of earnings) {
    const existing =
      rowsByStaffId.get(earning.staff_id) ??
      {
        bigTurns: 0,
        serviceCents: 0,
        smallTurns: 0,
        staffName: staffName(earning.staff_id, earning.staff?.display_name),
        ticketIds: new Set<string>(),
        tipCents: 0,
        totalEarningCents: 0,
      };

    existing.bigTurns += Number(earning.big_turn_count ?? 0);
    existing.serviceCents += toCents(earning.service_total);
    existing.smallTurns += Number(earning.small_turn_count ?? 0);
    existing.ticketIds.add(earning.ticket?.id ?? earning.ticket_id);
    existing.tipCents += toCents(earning.tip_amount);
    existing.totalEarningCents += toCents(earning.total_earning);
    rowsByStaffId.set(earning.staff_id, existing);
  }

  return Array.from(rowsByStaffId.entries())
    .map(([staffId, row]) => {
      const serviceSales = fromCents(row.serviceCents);
      const ticketCount = row.ticketIds.size;

      return {
        averageTicket:
          ticketCount === 0 ? 0 : roundMoney(serviceSales / ticketCount),
        bigTurns: row.bigTurns,
        serviceSales,
        smallTurns: row.smallTurns,
        staffId,
        staffName: row.staffName,
        ticketCount,
        tips: fromCents(row.tipCents),
        totalEarnings: fromCents(row.totalEarningCents),
        totalTurns: row.bigTurns + row.smallTurns,
      };
    })
    .sort((left, right) => right.serviceSales - left.serviceSales);
}

function buildStaffRowsFromTicketItems(
  tickets: TicketRow[],
): OperationalReportStaffRow[] {
  const rowsByStaffId = new Map<
    string,
    {
      bigTurns: number;
      serviceCents: number;
      smallTurns: number;
      staffName: string;
      ticketIds: Set<string>;
    }
  >();

  for (const ticket of tickets) {
    for (const item of activeItems(ticket)) {
      const turnParts = item.turn_parts ?? [];

      if (turnParts.length > 0) {
        for (const part of turnParts) {
          const staffId = part.staff_id ?? item.assigned_staff_id;

          if (!staffId) {
            continue;
          }

          const existing =
            rowsByStaffId.get(staffId) ??
            {
              bigTurns: 0,
              serviceCents: 0,
              smallTurns: 0,
              staffName: staffName(staffId, item.assigned_staff?.display_name),
              ticketIds: new Set<string>(),
            };

          existing.serviceCents += toCents(part.amount);
          existing.ticketIds.add(ticket.id);

          if (part.turn_type === "large") {
            existing.bigTurns += 1;
          } else {
            existing.smallTurns += 1;
          }

          rowsByStaffId.set(staffId, existing);
        }

        continue;
      }

      if (!item.assigned_staff_id) {
        continue;
      }

      const itemTotalCents = itemAmountCents(item);
      const existing =
        rowsByStaffId.get(item.assigned_staff_id) ??
        {
          bigTurns: 0,
          serviceCents: 0,
          smallTurns: 0,
          staffName: staffName(
            item.assigned_staff_id,
            item.assigned_staff?.display_name,
          ),
          ticketIds: new Set<string>(),
        };
      const turns = Math.max(1, Math.round(numberValue(item.quantity) || 1));

      existing.serviceCents += itemTotalCents;
      existing.ticketIds.add(ticket.id);

      if (fromCents(itemTotalCents) >= 25) {
        existing.bigTurns += turns;
      } else {
        existing.smallTurns += turns;
      }

      rowsByStaffId.set(item.assigned_staff_id, existing);
    }
  }

  return Array.from(rowsByStaffId.entries())
    .map(([staffId, row]) => {
      const serviceSales = fromCents(row.serviceCents);
      const ticketCount = row.ticketIds.size;

      return {
        averageTicket:
          ticketCount === 0 ? 0 : roundMoney(serviceSales / ticketCount),
        bigTurns: row.bigTurns,
        serviceSales,
        smallTurns: row.smallTurns,
        staffId,
        staffName: row.staffName,
        ticketCount,
        tips: 0,
        totalEarnings: serviceSales,
        totalTurns: row.bigTurns + row.smallTurns,
      };
    })
    .sort((left, right) => right.serviceSales - left.serviceSales);
}

function buildBookingMetrics(bookings: BookingRow[]) {
  const metrics: OperationalReportBookingMetrics = {
    booked: bookings.length,
    cancelled: 0,
    checkedIn: 0,
    completed: 0,
    completionRate: null,
    confirmed: 0,
    inService: 0,
    noShow: 0,
    pending: 0,
  };

  for (const booking of bookings) {
    const status = normalizeBookingStatus(booking.status);

    if (status === "pending") {
      metrics.pending += 1;
    } else if (status === "confirmed") {
      metrics.confirmed += 1;
    } else if (status === "checked_in") {
      metrics.checkedIn += 1;
    } else if (status === "in_service") {
      metrics.inService += 1;
    } else if (status === "completed") {
      metrics.completed += 1;
    } else if (status === "cancelled") {
      metrics.cancelled += 1;
    } else if (status === "no_show") {
      metrics.noShow += 1;
    }
  }

  const outcomeCount = metrics.completed + metrics.cancelled + metrics.noShow;
  metrics.completionRate =
    outcomeCount === 0
      ? null
      : Math.round((metrics.completed / outcomeCount) * 1000) / 10;

  return metrics;
}

function buildCustomerMetrics(input: {
  activeCustomerIds: string[];
  customerRows: CustomerRow[];
  newCustomerRecords: CustomerRow[];
  range: OperationalReportRange;
}) {
  const customerRowsById = new Map(input.customerRows.map((row) => [row.id, row]));
  const activeIds = new Set(input.activeCustomerIds);
  let linkedCustomers = 0;
  let returningCustomers = 0;

  for (const customerId of activeIds) {
    const row = customerRowsById.get(customerId);

    if (!row) {
      continue;
    }

    if (row.customer_user_id) {
      linkedCustomers += 1;
    }

    if (row.created_at.slice(0, 10) < input.range.startDate) {
      returningCustomers += 1;
    }
  }

  return {
    activeCustomers: activeIds.size,
    linkedCustomers,
    newCustomerRecords: input.newCustomerRecords.length,
    returningCustomers,
  } satisfies OperationalReportCustomerMetrics;
}

function buildTrend(input: {
  bookings: BookingRow[];
  customerIdsByDate: Map<string, Set<string>>;
  range: OperationalReportRange;
  ticketTotalsByDate: Map<string, OperationalReportTotals>;
}) {
  const bookingsByDate = new Map<string, number>();

  for (const booking of input.bookings) {
    const date = localDateFromIso(booking.start_at, input.range.timeZone);
    bookingsByDate.set(date, (bookingsByDate.get(date) ?? 0) + 1);
  }

  const points: OperationalReportTrendPoint[] = [];
  let cursor = input.range.startDate;

  while (cursor <= input.range.endDate) {
    const totals = input.ticketTotalsByDate.get(cursor) ?? emptyTotals();

    points.push({
      bookingCount: bookingsByDate.get(cursor) ?? 0,
      customerCount: input.customerIdsByDate.get(cursor)?.size ?? 0,
      date: cursor,
      grossSales: totals.grossSales,
      label: formatDateLabel(cursor),
      netSales: totals.netSales,
      ticketCount: totals.ticketCount,
      totalRevenue: totals.totalRevenue,
    });
    cursor = addDays(cursor, 1);
  }

  return points;
}

function buildRecentTickets(tickets: TicketRow[]) {
  return [...tickets]
    .sort((left, right) => right.opened_at.localeCompare(left.opened_at))
    .slice(0, 10)
    .map((ticket) => {
      const totals = calculateOperationalTicketTotals(ticket);

      return {
        closedAt: ticket.closed_at,
        customerName: ticket.customer?.name ?? null,
        id: ticket.id,
        openedAt: ticket.opened_at,
        paymentStatus: paymentStatus(totals),
        ticketNumber: ticket.ticket_number?.trim() || ticket.id.slice(0, 8),
        totals,
      } satisfies OperationalReportTicketRow;
    });
}

function buildComparisonMetric(
  current: number,
  previous: number,
): OperationalReportComparisonMetric {
  const delta = roundMoney(current - previous);
  const direction =
    Math.abs(delta) < MONEY_EPSILON ? "flat" : delta > 0 ? "up" : "down";

  return {
    current,
    delta,
    direction,
    percentChange:
      previous === 0 ? null : Math.round((delta / Math.abs(previous)) * 1000) / 10,
    previous,
  };
}

function buildComparison(
  current: ReportFacts,
  previous: ReportFacts,
): OperationalReportComparison {
  return {
    averageTicket: buildComparisonMetric(
      current.totals.averageTicket,
      previous.totals.averageTicket,
    ),
    bookings: buildComparisonMetric(
      current.bookingMetrics.booked,
      previous.bookingMetrics.booked,
    ),
    customerCount: buildComparisonMetric(
      current.customerMetrics.activeCustomers,
      previous.customerMetrics.activeCustomers,
    ),
    grossSales: buildComparisonMetric(
      current.totals.grossSales,
      previous.totals.grossSales,
    ),
    netSales: buildComparisonMetric(
      current.totals.netSales,
      previous.totals.netSales,
    ),
    ticketCount: buildComparisonMetric(
      current.totals.ticketCount,
      previous.totals.ticketCount,
    ),
    totalRevenue: buildComparisonMetric(
      current.totals.totalRevenue,
      previous.totals.totalRevenue,
    ),
  };
}

async function loadReportFacts(input: {
  auth: ReportAuthContext;
  includeDetails: boolean;
  permissions: OperationalReportData["permissions"];
  range: OperationalReportRange;
}): Promise<ReportFacts> {
  const [tickets, bookings, staffEarnings, newCustomerRecords] = await Promise.all([
    loadTickets(input.auth, input.range),
    loadBookings(input.auth, input.range, input.permissions.canViewBookings),
    loadStaffEarnings(
      input.auth,
      input.range,
      input.permissions.canViewStaffFinancials,
    ),
    loadNewCustomerRecords(
      input.auth,
      input.range,
      input.permissions.canViewCustomers,
    ),
  ]);
  const dataGaps: string[] = [];
  const finalizedTickets = tickets.filter((ticket) => ticket.status === "closed");
  const ticketTotalsByDate = new Map<string, OperationalReportTotals>();
  const customerIdsByDate = new Map<string, Set<string>>();
  let totals = emptyTotals();

  for (const ticket of finalizedTickets) {
    const ticketTotals = calculateOperationalTicketTotals(ticket);
    const ticketDate = localDateFromIso(ticket.opened_at, input.range.timeZone);
    const dailyTotals = ticketTotalsByDate.get(ticketDate) ?? emptyTotals();

    totals = addTotals(totals, ticketTotals);
    ticketTotalsByDate.set(ticketDate, addTotals(dailyTotals, ticketTotals));

    if (ticket.customer_id) {
      const ids = customerIdsByDate.get(ticketDate) ?? new Set<string>();
      ids.add(ticket.customer_id);
      customerIdsByDate.set(ticketDate, ids);
    }
  }

  const activeCustomerIds = [
    ...new Set(
      [
        ...finalizedTickets.map((ticket) => ticket.customer_id),
        ...bookings.map((booking) => booking.customer_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const customerRows =
    input.permissions.canViewCustomers && activeCustomerIds.length > 0
      ? await loadCustomerRowsByIds(input.auth, activeCustomerIds)
      : [];
  const bookingMetrics = buildBookingMetrics(bookings);
  const customerMetrics = input.permissions.canViewCustomers
    ? buildCustomerMetrics({
        activeCustomerIds,
        customerRows,
        newCustomerRecords,
        range: input.range,
      })
    : {
        activeCustomers: activeCustomerIds.length,
        linkedCustomers: 0,
        newCustomerRecords: 0,
        returningCustomers: 0,
      };
  const staffRows =
    staffEarnings.length > 0
      ? buildStaffRowsFromEarnings(staffEarnings)
      : input.permissions.canViewStaffFinancials
        ? buildStaffRowsFromTicketItems(finalizedTickets)
        : [];
  const staffAttributionSource: OperationalReportStaffAttributionSource =
    staffEarnings.length > 0
      ? "pos_ticket_staff_earnings"
      : staffRows.length > 0
        ? "pos_ticket_items"
        : "none";

  if (!input.permissions.canViewBookings) {
    dataGaps.push("Booking metrics require booking.view permission.");
  }

  if (!input.permissions.canViewCustomers) {
    dataGaps.push("New and returning customer metrics require customers.view permission.");
  }

  if (!input.permissions.canViewStaffFinancials) {
    dataGaps.push("Staff financial performance requires reports, payroll, or ticket access.");
  } else if (staffAttributionSource === "pos_ticket_items") {
    dataGaps.push(
      "Staff performance is using POS item assignment fallback because staff earning rows were not available for this range.",
    );
  }

  if (tickets.length >= RESULT_LIMIT || bookings.length >= RESULT_LIMIT) {
    dataGaps.push("Large result sets may be truncated by the current report limit.");
  }

  return {
    bookingMetrics,
    bookings,
    customerMetrics,
    dataGaps,
    paymentBreakdown: input.includeDetails
      ? buildPaymentBreakdown(finalizedTickets)
      : [],
    recentTickets: input.includeDetails ? buildRecentTickets(finalizedTickets) : [],
    serviceBreakdown: input.includeDetails
      ? buildServiceBreakdown(finalizedTickets, totals.grossSales)
      : [],
    staffAttributionSource,
    staffRows: input.includeDetails ? staffRows.slice(0, 12) : staffRows,
    tickets,
    totals,
    trend: buildTrend({
      bookings,
      customerIdsByDate,
      range: input.range,
      ticketTotalsByDate,
    }),
  };
}

function withPreviousRange(
  range: OperationalReportRange,
): OperationalReportRange {
  return {
    ...range,
    endDate: range.previousEndDate,
    label: formatRangeLabel(range.previousStartDate, range.previousEndDate),
    previousEndDate: addDays(range.previousStartDate, -1),
    previousStartDate: addDays(range.previousStartDate, -range.dayCount),
    preset: "custom",
    startDate: range.previousStartDate,
  };
}

export async function getOperationalReport(
  params: OperationalReportSearchParams = {},
  context?: CurrentBusinessContext,
): Promise<OperationalReportData> {
  const auth = await requireOperationalReportContext(context);
  const [permissions, clock] = await Promise.all([
    getReportPermissions(auth.context),
    loadBusinessClock(auth),
  ]);
  const { dataGaps: rangeGaps, range } = resolveReportRange(params, clock);
  const previousRange = withPreviousRange(range);
  const [currentFacts, previousFacts] = await Promise.all([
    loadReportFacts({
      auth,
      includeDetails: true,
      permissions,
      range,
    }),
    loadReportFacts({
      auth,
      includeDetails: false,
      permissions,
      range: previousRange,
    }),
  ]);

  return {
    bookingMetrics: currentFacts.bookingMetrics,
    comparison: buildComparison(currentFacts, previousFacts),
    customerMetrics: currentFacts.customerMetrics,
    dataGaps: [
      ...rangeGaps,
      ...currentFacts.dataGaps,
      "POS item data does not carry a reliable product/add-on taxonomy yet, so service mix is reported by POS service snapshot and category only.",
      "Server-side report export is not enabled because the project does not currently expose a reusable export service.",
    ],
    isEmpty:
      currentFacts.totals.ticketCount === 0 &&
      currentFacts.bookingMetrics.booked === 0 &&
      currentFacts.customerMetrics.newCustomerRecords === 0,
    paymentBreakdown: currentFacts.paymentBreakdown,
    permissions,
    range,
    recentTickets: currentFacts.recentTickets,
    serviceBreakdown: currentFacts.serviceBreakdown,
    staffAttributionSource: currentFacts.staffAttributionSource,
    staffRows: currentFacts.staffRows,
    totals: currentFacts.totals,
    trend: currentFacts.trend,
  };
}
