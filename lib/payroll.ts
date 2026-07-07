import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { getUtcBoundsForLocalDate, isDateInputValue } from "@/lib/daily-pos-report";
import { hasPermission, requirePermission } from "@/lib/permissions";
import { STAFF_SELECT } from "@/lib/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  PayrollCorrectionListItem,
  PayrollCycleType,
  PayrollPaystub,
  PayrollPeriod,
  PayrollPeriodPreset,
  PayrollRun,
  PayrollStaffDailyTotal,
  PayrollStaffLine,
  PayrollStaffLineWithDailyTotals,
  PayrollSummary,
  SalonPayrollSetting,
  StaffPayType,
  StaffPayrollSetting,
  StaffPayrollSettingWithStaff,
  TipAllocationMethod,
} from "@/types/payroll";
import type { Staff } from "@/types/staff";

export const PAYROLL_PERMISSIONS = {
  manage: "payroll.manage",
  taxCompany: "payroll.tax_company",
  view: "payroll.view",
} as const;

export const SALON_PAYROLL_SETTING_SELECT =
  "id, organization_id, salon_id, cycle_type, biweekly_anchor_date, created_at, updated_at";
export const STAFF_PAYROLL_SETTING_SELECT =
  "id, organization_id, salon_id, staff_id, legal_name, pay_type, commission_rate, fixed_pay_amount, check_rate, tax_rate, apply_tax_to_fixed_pay, tax_company_enabled, effective_from, effective_to, created_at, updated_at";
export const PAYROLL_RUN_SELECT =
  "id, organization_id, salon_id, period_start, period_end, cycle_type, status, settings_snapshot, correction_snapshot, generated_at, locked_at, locked_by, paid_at, paid_by, created_at, updated_at";
export const PAYROLL_STAFF_LINE_SELECT =
  "id, payroll_run_id, organization_id, salon_id, staff_id, staff_display_name_snapshot, staff_legal_name_snapshot, gross_sales, pay_type_used, commission_rate_used, fixed_pay_amount_used, staff_commission_gross, shop_share, check_rate_used, cash_amount, check_gross, tax_rate_used, tax_withheld, check_net, check_number, tip_amount, tip_allocation_method, bonus_amount, final_staff_income, tax_company_enabled_snapshot, note, created_at, updated_at";
export const PAYROLL_STAFF_DAILY_TOTAL_SELECT =
  "id, payroll_run_id, organization_id, salon_id, staff_id, business_date, gross_sales, tip_amount, correction_delta, note, created_at, updated_at";
export const PAYROLL_PAYSTUB_SELECT =
  "id, payroll_run_id, organization_id, salon_id, staff_id, uploaded_by, file_url_or_path, file_name, mime_type, size_bytes, note, created_at, updated_at";

const DEFAULT_COMMISSION_RATE = 60;
const DEFAULT_CHECK_RATE = 60;
const DEFAULT_TAX_RATE = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

type SupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type PayrollAccess = {
  canManagePayroll: boolean;
  canViewAllPayroll: boolean;
  canViewTaxCompany: boolean;
  linkedStaffId: string | null;
};

type PayrollAuthContext = {
  access: PayrollAccess;
  context: CurrentBusinessContext;
  organization: NonNullable<CurrentBusinessContext["currentOrganization"]>;
  salon: NonNullable<CurrentBusinessContext["currentSalon"]>;
  supabase: SupabaseClient;
  user: NonNullable<CurrentBusinessContext["user"]>;
};

type StaffEarningRow = {
  manual_tip_amount: number | null;
  service_total: number;
  staff_id: string;
  ticket_id: string;
  tip_amount: number;
  tip_is_manual: boolean;
  work_date: string;
};

type FinancialCorrectionRequestRow = {
  business_date: string;
  correction_type: string;
  id: string;
  money_delta: number;
  requested_at: string;
  requested_value_json: unknown;
  status: string;
  target_id: string | null;
  target_type: string;
};

type FinancialAdjustmentRow = {
  business_date: string;
  correction_request_id: string | null;
  created_at: string;
  expected_total_delta: number;
  id: string;
  service_delta: number;
  staff_id: string | null;
  target_id: string | null;
  target_type: string;
  ticket_id: string | null;
  tip_delta: number;
};

type TicketAdjustmentRow = {
  action: string;
  created_at: string;
  id: string;
  ticket_id: string;
};

type TicketForAdjustmentRow = {
  id: string;
  opened_at: string;
  ticket_number: string;
};

type LineManualValues = Pick<
  PayrollStaffLine,
  "bonus_amount" | "check_number" | "note"
>;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toCents(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.round(numeric * 100);
}

function fromCents(value: number) {
  return roundMoney(value / 100);
}

function numberValue(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Date must use YYYY-MM-DD format.");
  }

  const [, year, month, day] = match;
  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function dateOnlyFromUtcDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dateFromDateOnly(value: string) {
  const parts = parseDateParts(value);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
}

function addDays(value: string, days: number) {
  return dateOnlyFromUtcDate(new Date(dateFromDateOnly(value).getTime() + days * DAY_MS));
}

function firstDayOfMonth(date: Date) {
  return dateOnlyFromUtcDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12)),
  );
}

function lastDayOfPreviousMonth(date: Date) {
  return dateOnlyFromUtcDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0, 12)),
  );
}

function getPreviousMonthPeriod(referenceDate = new Date()) {
  const currentMonth = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1, 12),
  );
  const previousMonth = new Date(currentMonth.getTime() - DAY_MS);

  return {
    endDate: lastDayOfPreviousMonth(currentMonth),
    startDate: firstDayOfMonth(previousMonth),
  };
}

function getPreviousBiweeklyPeriod(anchorDate: string | null, referenceDate = new Date()) {
  const anchor = anchorDate ? dateFromDateOnly(anchorDate) : dateFromDateOnly("2026-01-05");
  const todayNoon = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate(),
      12,
    ),
  );
  const daysSinceAnchor = Math.floor((todayNoon.getTime() - anchor.getTime()) / DAY_MS);
  const currentPeriodIndex = Math.floor(daysSinceAnchor / 14);
  const previousStart = new Date(anchor.getTime() + (currentPeriodIndex - 1) * 14 * DAY_MS);
  const previousEnd = new Date(previousStart.getTime() + 13 * DAY_MS);

  return {
    endDate: dateOnlyFromUtcDate(previousEnd),
    startDate: dateOnlyFromUtcDate(previousStart),
  };
}

function formatDateForLabel(value: string) {
  const date = dateFromDateOnly(value);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

function formatPeriodLabel(startDate: string, endDate: string) {
  return `${formatDateForLabel(startDate)} - ${formatDateForLabel(endDate)}`;
}

function normalizePreset(value: string | undefined): PayrollPeriodPreset {
  if (value === "previous_biweekly" || value === "custom") {
    return value;
  }

  return "previous_month";
}

function normalizeCycleType(
  value: string | undefined,
  fallback: PayrollCycleType,
): PayrollCycleType {
  if (value === "monthly" || value === "biweekly" || value === "custom") {
    return value;
  }

  return fallback;
}

function assertDateRange(startDate: string, endDate: string) {
  if (!isDateInputValue(startDate) || !isDateInputValue(endDate)) {
    throw new Error("Period start and end are required.");
  }

  if (startDate > endDate) {
    throw new Error("Period start must be before period end.");
  }
}

function getDefaultSalonPayrollSetting(
  organizationId: string,
  salonId: string,
): SalonPayrollSetting | null {
  return {
    biweekly_anchor_date: null,
    created_at: "",
    cycle_type: "monthly",
    id: "",
    organization_id: organizationId,
    salon_id: salonId,
    updated_at: "",
  };
}

export function resolvePayrollPeriod(input: {
  cycleType?: string;
  endDate?: string;
  preset?: string;
  salonSetting: SalonPayrollSetting | null;
  startDate?: string;
}): PayrollPeriod {
  const preset = normalizePreset(input.preset);

  if (preset === "custom") {
    const startDate = isDateInputValue(input.startDate) ? input.startDate! : "";
    const endDate = isDateInputValue(input.endDate) ? input.endDate! : "";

    if (startDate && endDate && startDate <= endDate) {
      return {
        cycleType: "custom",
        endDate,
        label: formatPeriodLabel(startDate, endDate),
        preset,
        startDate,
      };
    }

    const previousMonth = getPreviousMonthPeriod();
    return {
      cycleType: "custom",
      endDate: previousMonth.endDate,
      label: formatPeriodLabel(previousMonth.startDate, previousMonth.endDate),
      preset,
      startDate: previousMonth.startDate,
    };
  }

  if (preset === "previous_biweekly") {
    const period = getPreviousBiweeklyPeriod(input.salonSetting?.biweekly_anchor_date ?? null);
    return {
      cycleType: "biweekly",
      endDate: period.endDate,
      label: formatPeriodLabel(period.startDate, period.endDate),
      preset,
      startDate: period.startDate,
    };
  }

  const previousMonth = getPreviousMonthPeriod();
  return {
    cycleType: normalizeCycleType(input.cycleType, "monthly"),
    endDate: previousMonth.endDate,
    label: formatPeriodLabel(previousMonth.startDate, previousMonth.endDate),
    preset,
    startDate: previousMonth.startDate,
  };
}

function getStaffName(staff: Staff | undefined, staffId: string) {
  return staff?.display_name?.trim() || `Staff ${staffId.slice(0, 8)}`;
}

function getLegalName(setting: StaffPayrollSetting | null, staff: Staff | undefined) {
  return (
    setting?.legal_name?.trim() ||
    [staff?.first_name, staff?.last_name].filter(Boolean).join(" ").trim() ||
    staff?.display_name ||
    null
  );
}

function getDefaultStaffPayrollSetting(input: {
  organizationId: string;
  periodStart: string;
  salonId: string;
  staff: Staff | undefined;
  staffId: string;
}): StaffPayrollSetting {
  return {
    apply_tax_to_fixed_pay: true,
    check_rate: DEFAULT_CHECK_RATE,
    commission_rate: DEFAULT_COMMISSION_RATE,
    created_at: "",
    effective_from: input.periodStart,
    effective_to: null,
    fixed_pay_amount: 0,
    id: "",
    legal_name: getLegalName(null, input.staff),
    organization_id: input.organizationId,
    pay_type: "commission",
    salon_id: input.salonId,
    staff_id: input.staffId,
    tax_company_enabled: false,
    tax_rate: DEFAULT_TAX_RATE,
    updated_at: "",
  };
}

function pickEffectiveSetting(input: {
  organizationId: string;
  periodEnd: string;
  periodStart: string;
  salonId: string;
  settingsByStaffId: Map<string, StaffPayrollSetting[]>;
  staff: Staff | undefined;
  staffId: string;
}) {
  const settings = input.settingsByStaffId.get(input.staffId) ?? [];
  const effective = settings
    .filter(
      (setting) =>
        setting.effective_from <= input.periodEnd &&
        (!setting.effective_to || setting.effective_to >= input.periodStart),
    )
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];

  return (
    effective ??
    getDefaultStaffPayrollSetting({
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      salonId: input.salonId,
      staff: input.staff,
      staffId: input.staffId,
    })
  );
}

function buildLineCalculation(input: {
  bonusAmount: number;
  grossSales: number;
  setting: StaffPayrollSetting;
  tipAmount: number;
}) {
  const grossSales = roundMoney(input.grossSales);
  const commissionRate = numberValue(input.setting.commission_rate);
  const fixedPayAmount = roundMoney(numberValue(input.setting.fixed_pay_amount));
  const checkRate = numberValue(input.setting.check_rate);
  const taxRate = numberValue(input.setting.tax_rate);
  const staffCommissionGross =
    input.setting.pay_type === "fixed"
      ? fixedPayAmount
      : roundMoney((grossSales * commissionRate) / 100);
  const shopShare = roundMoney(grossSales - staffCommissionGross);
  const checkGross = roundMoney((staffCommissionGross * checkRate) / 100);
  const cashAmount = roundMoney(staffCommissionGross - checkGross);
  const taxableCheckGross =
    input.setting.pay_type === "fixed" && !input.setting.apply_tax_to_fixed_pay
      ? 0
      : checkGross;
  const taxWithheld = roundMoney((taxableCheckGross * taxRate) / 100);
  const checkNet = roundMoney(checkGross - taxWithheld);
  const finalStaffIncome = roundMoney(
    cashAmount + checkNet + input.tipAmount + input.bonusAmount,
  );

  return {
    cashAmount,
    checkGross,
    checkNet,
    finalStaffIncome,
    shopShare,
    staffCommissionGross,
    taxWithheld,
  };
}

function getTipAllocationMethod(input: {
  hasManualTip: boolean;
  tipAmount: number;
}): TipAllocationMethod {
  if (input.tipAmount <= 0) {
    return "none";
  }

  return input.hasManualTip ? "manual" : "prorated";
}

async function getLinkedCurrentStaffId(
  context: CurrentBusinessContext,
  supabase: SupabaseClient,
) {
  if (!context.user?.auth_user_id || !context.currentOrganization || !context.currentSalon) {
    return null;
  }

  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("organization_id", context.currentOrganization.id)
    .eq("salon_id", context.currentSalon.id)
    .eq("user_id", context.user.auth_user_id)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ?? null;
}

async function requirePayrollContext(options: {
  taxCompanyOnly?: boolean;
} = {}): Promise<PayrollAuthContext> {
  const [supabase, context] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentBusinessContext(),
  ]);

  if (!supabase || !context.user) {
    throw new Error("You must be logged in to view payroll.");
  }

  if (!context.currentOrganization) {
    throw new Error("Create an organization before using payroll.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon first.");
  }

  const [canManagePayroll, canViewPayroll, canViewTaxCompany] = await Promise.all([
    hasPermission(PAYROLL_PERMISSIONS.manage, context),
    hasPermission(PAYROLL_PERMISSIONS.view, context),
    hasPermission(PAYROLL_PERMISSIONS.taxCompany, context),
  ]);
  const linkedStaffId = await getLinkedCurrentStaffId(context, supabase);
  const canViewAllPayroll = canManagePayroll || canViewPayroll;
  const canViewCurrentArea = options.taxCompanyOnly
    ? canViewAllPayroll || canViewTaxCompany
    : canViewAllPayroll || Boolean(linkedStaffId);

  if (!canViewCurrentArea) {
    throw new Error("You do not have permission to view payroll.");
  }

  return {
    access: {
      canManagePayroll,
      canViewAllPayroll,
      canViewTaxCompany,
      linkedStaffId,
    },
    context,
    organization: context.currentOrganization,
    salon: context.currentSalon,
    supabase,
    user: context.user,
  };
}

async function requirePayrollManageContext() {
  const auth = await requirePayrollContext();

  await requirePermission(PAYROLL_PERMISSIONS.manage, auth.context);

  if (!auth.access.canManagePayroll) {
    throw new Error("You do not have permission to manage payroll.");
  }

  return auth;
}

async function loadSalonPayrollSetting(auth: PayrollAuthContext) {
  const { data, error } = await auth.supabase
    .from("salon_payroll_settings")
    .select(SALON_PAYROLL_SETTING_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<SalonPayrollSetting>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? getDefaultSalonPayrollSetting(auth.organization.id, auth.salon.id);
}

async function loadStaffRows(auth: PayrollAuthContext) {
  const { data, error } = await auth.supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .order("display_name", { ascending: true })
    .returns<Staff[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadStaffPayrollSettings(auth: PayrollAuthContext) {
  const { data, error } = await auth.supabase
    .from("staff_payroll_settings")
    .select(STAFF_PAYROLL_SETTING_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .order("effective_from", { ascending: false })
    .returns<StaffPayrollSetting[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function settingsByStaffId(settings: StaffPayrollSetting[]) {
  const map = new Map<string, StaffPayrollSetting[]>();

  for (const setting of settings) {
    map.set(setting.staff_id, [...(map.get(setting.staff_id) ?? []), setting]);
  }

  return map;
}

function latestSettingsWithStaff(
  staff: Staff[],
  settings: StaffPayrollSetting[],
): StaffPayrollSettingWithStaff[] {
  const byStaffId = settingsByStaffId(settings);

  return staff.map((member) => ({
    setting: (byStaffId.get(member.id) ?? [])[0] ?? null,
    staff: member,
  }));
}

async function loadPayrollRun(auth: PayrollAuthContext, period: PayrollPeriod) {
  const { data, error } = await auth.supabase
    .from("payroll_runs")
    .select(PAYROLL_RUN_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("period_start", period.startDate)
    .eq("period_end", period.endDate)
    .maybeSingle<PayrollRun>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

async function loadPayrollRunById(auth: PayrollAuthContext, payrollRunId: string) {
  const { data, error } = await auth.supabase
    .from("payroll_runs")
    .select(PAYROLL_RUN_SELECT)
    .eq("id", payrollRunId)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<PayrollRun>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("Payroll run was not found.");
  }

  return data;
}

async function loadPayrollLines(auth: PayrollAuthContext, run: PayrollRun) {
  let query = auth.supabase
    .from("payroll_staff_lines")
    .select(PAYROLL_STAFF_LINE_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id);

  if (!auth.access.canViewAllPayroll && auth.access.linkedStaffId) {
    query = query.eq("staff_id", auth.access.linkedStaffId);
  }

  const { data, error } = await query
    .order("staff_display_name_snapshot", { ascending: true })
    .returns<PayrollStaffLine[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadPayrollDailyTotals(
  auth: PayrollAuthContext,
  run: PayrollRun,
  staffIds: string[],
) {
  if (staffIds.length === 0) {
    return [];
  }

  const { data, error } = await auth.supabase
    .from("payroll_staff_daily_totals")
    .select(PAYROLL_STAFF_DAILY_TOTAL_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id)
    .in("staff_id", staffIds)
    .order("business_date", { ascending: true })
    .returns<PayrollStaffDailyTotal[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadPayrollPaystubs(
  auth: PayrollAuthContext,
  run: PayrollRun,
  staffIds: string[],
) {
  if (staffIds.length === 0) {
    return [];
  }

  const { data, error } = await auth.supabase
    .from("payroll_paystubs")
    .select(PAYROLL_PAYSTUB_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id)
    .in("staff_id", staffIds)
    .returns<PayrollPaystub[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadPayrollSnapshot(auth: PayrollAuthContext, period: PayrollPeriod) {
  const run = await loadPayrollRun(auth, period);

  if (!run) {
    return {
      lines: [] as PayrollStaffLineWithDailyTotals[],
      paystubs: [] as PayrollPaystub[],
      run: null,
    };
  }

  const lines = await loadPayrollLines(auth, run);
  const staffIds = lines.map((line) => line.staff_id);
  const [dailyTotals, paystubs] = await Promise.all([
    loadPayrollDailyTotals(auth, run, staffIds),
    loadPayrollPaystubs(auth, run, staffIds),
  ]);
  const dailyTotalsByStaffId = new Map<string, PayrollStaffDailyTotal[]>();
  const paystubByStaffId = new Map(paystubs.map((paystub) => [paystub.staff_id, paystub]));

  for (const dailyTotal of dailyTotals) {
    dailyTotalsByStaffId.set(dailyTotal.staff_id, [
      ...(dailyTotalsByStaffId.get(dailyTotal.staff_id) ?? []),
      dailyTotal,
    ]);
  }

  return {
    lines: lines.map((line) => ({
      ...line,
      dailyTotals: dailyTotalsByStaffId.get(line.staff_id) ?? [],
      paystub: paystubByStaffId.get(line.staff_id) ?? null,
    })),
    paystubs,
    run,
  };
}

function calculateSummary(input: {
  corrections: PayrollCorrectionListItem[];
  lines: PayrollStaffLineWithDailyTotals[];
}) {
  const sum = (selector: (line: PayrollStaffLineWithDailyTotals) => number) =>
    roundMoney(input.lines.reduce((total, line) => total + selector(line), 0));

  return {
    correctionAfterLockdayCount: input.corrections.length,
    missingPaystubCount: input.lines.filter(
      (line) => line.tax_company_enabled_snapshot && !line.paystub,
    ).length,
    totalBonus: sum((line) => line.bonus_amount),
    totalCashPayout: sum((line) => line.cash_amount),
    totalCheckGross: sum((line) => line.check_gross),
    totalCheckNet: sum((line) => line.check_net),
    totalFinalStaffIncome: sum((line) => line.final_staff_income),
    totalPosIncome: sum((line) => line.gross_sales),
    totalShopShare: sum((line) => line.shop_share),
    totalStaffCommissionPayout: sum((line) => line.staff_commission_gross),
    totalStaffGrossProduction: sum((line) => line.gross_sales),
    totalTaxWithheld: sum((line) => line.tax_withheld),
    totalTip: sum((line) => line.tip_amount),
  } satisfies PayrollSummary;
}

function extractStaffIdFromCorrectionJson(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.staffId,
    record.staff_id,
    record.staff,
    record.requestedStaffId,
    record.requested_staff_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return null;
}

async function loadTicketAdjustmentsForPeriod(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
) {
  const startBounds = getUtcBoundsForLocalDate(period.startDate, auth.user.timezone);
  const endBounds = getUtcBoundsForLocalDate(period.endDate, auth.user.timezone);
  const { data: tickets, error: ticketsError } = await auth.supabase
    .from("pos_tickets")
    .select("id, ticket_number, opened_at")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("opened_at", startBounds.openedFrom)
    .lte("opened_at", endBounds.openedTo)
    .returns<TicketForAdjustmentRow[]>();

  if (ticketsError) {
    throw new Error(ticketsError.message);
  }

  const ticketRows = tickets ?? [];

  if (ticketRows.length === 0) {
    return [];
  }

  const ticketById = new Map(ticketRows.map((ticket) => [ticket.id, ticket]));
  const { data: adjustments, error: adjustmentsError } = await auth.supabase
    .from("pos_ticket_adjustments")
    .select("id, ticket_id, action, created_at")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .in(
      "ticket_id",
      ticketRows.map((ticket) => ticket.id),
    )
    .returns<TicketAdjustmentRow[]>();

  if (adjustmentsError) {
    throw new Error(adjustmentsError.message);
  }

  return (adjustments ?? []).map<PayrollCorrectionListItem>((adjustment) => {
    const ticket = ticketById.get(adjustment.ticket_id);

    return {
      businessDate: ticket?.opened_at.slice(0, 10) ?? period.startDate,
      correctionDate: adjustment.created_at,
      delta: null,
      id: adjustment.id,
      source: "ticket_adjustment",
      staffId: null,
      staffName: null,
      status: "recorded",
      ticketId: adjustment.ticket_id,
      ticketNumber: ticket?.ticket_number ?? null,
      type: adjustment.action,
    };
  });
}

async function loadPayrollCorrections(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
  staffById = new Map<string, Staff>(),
) {
  const [requestsResult, adjustmentsResult, ticketAdjustments] = await Promise.all([
    auth.supabase
      .from("pos_financial_correction_requests")
      .select(
        "id, business_date, target_type, target_id, correction_type, requested_value_json, money_delta, status, requested_at",
      )
      .eq("organization_id", auth.organization.id)
      .eq("salon_id", auth.salon.id)
      .gte("business_date", period.startDate)
      .lte("business_date", period.endDate)
      .returns<FinancialCorrectionRequestRow[]>(),
    auth.supabase
      .from("pos_financial_adjustments")
      .select(
        "id, business_date, correction_request_id, target_type, target_id, staff_id, ticket_id, service_delta, tip_delta, expected_total_delta, created_at",
      )
      .eq("organization_id", auth.organization.id)
      .eq("salon_id", auth.salon.id)
      .gte("business_date", period.startDate)
      .lte("business_date", period.endDate)
      .returns<FinancialAdjustmentRow[]>(),
    loadTicketAdjustmentsForPeriod(auth, period),
  ]);

  if (requestsResult.error) {
    throw new Error(requestsResult.error.message);
  }

  if (adjustmentsResult.error) {
    throw new Error(adjustmentsResult.error.message);
  }

  const requests = (requestsResult.data ?? []).map<PayrollCorrectionListItem>(
    (request) => {
      const staffId = extractStaffIdFromCorrectionJson(request.requested_value_json);

      return {
        businessDate: request.business_date,
        correctionDate: request.requested_at,
        delta: numberValue(request.money_delta),
        id: request.id,
        source: "financial_request",
        staffId,
        staffName: staffId ? getStaffName(staffById.get(staffId), staffId) : null,
        status: request.status,
        ticketId: request.target_type === "pos_ticket" ? request.target_id : null,
        ticketNumber: null,
        type: request.correction_type,
      };
    },
  );
  const adjustments = (adjustmentsResult.data ?? []).map<PayrollCorrectionListItem>(
    (adjustment) => {
      const delta = roundMoney(
        numberValue(adjustment.service_delta) +
          numberValue(adjustment.tip_delta) +
          numberValue(adjustment.expected_total_delta),
      );

      return {
        businessDate: adjustment.business_date,
        correctionDate: adjustment.created_at,
        delta,
        id: adjustment.id,
        source: "financial_adjustment",
        staffId: adjustment.staff_id,
        staffName: adjustment.staff_id
          ? getStaffName(staffById.get(adjustment.staff_id), adjustment.staff_id)
          : null,
        status: "applied",
        ticketId: adjustment.ticket_id,
        ticketNumber: null,
        type: adjustment.target_type,
      };
    },
  );

  return [...requests, ...adjustments, ...ticketAdjustments].sort(
    (left, right) =>
      left.businessDate.localeCompare(right.businessDate) ||
      left.correctionDate.localeCompare(right.correctionDate),
  );
}

async function loadStaffEarningsForPeriod(auth: PayrollAuthContext, period: PayrollPeriod) {
  const { data, error } = await auth.supabase
    .from("pos_ticket_staff_earnings")
    .select(
      "ticket_id, staff_id, work_date, service_total, tip_amount, tip_is_manual, manual_tip_amount",
    )
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("work_date", period.startDate)
    .lte("work_date", period.endDate)
    .returns<StaffEarningRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadFinancialAdjustmentDeltasByStaffDate(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
) {
  const { data, error } = await auth.supabase
    .from("pos_financial_adjustments")
    .select("business_date, staff_id, service_delta, tip_delta")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("business_date", period.startDate)
    .lte("business_date", period.endDate)
    .not("staff_id", "is", null)
    .returns<
      Array<{
        business_date: string;
        service_delta: number;
        staff_id: string | null;
        tip_delta: number;
      }>
    >();

  if (error) {
    throw new Error(error.message);
  }

  const deltas = new Map<string, number>();

  for (const adjustment of data ?? []) {
    if (!adjustment.staff_id) {
      continue;
    }

    const key = `${adjustment.staff_id}:${adjustment.business_date}`;
    deltas.set(
      key,
      roundMoney(
        (deltas.get(key) ?? 0) +
          numberValue(adjustment.service_delta) +
          numberValue(adjustment.tip_delta),
      ),
    );
  }

  return deltas;
}

async function rebuildPayrollRunSnapshot(auth: PayrollAuthContext, run: PayrollRun) {
  const period: PayrollPeriod = {
    cycleType: run.cycle_type,
    endDate: run.period_end,
    label: formatPeriodLabel(run.period_start, run.period_end),
    preset: run.cycle_type === "biweekly" ? "previous_biweekly" : "previous_month",
    startDate: run.period_start,
  };
  const previousLines = await loadPayrollLines(auth, run);
  const previousManualValuesByStaffId = new Map<string, LineManualValues>(
    previousLines.map((line) => [
      line.staff_id,
      {
        bonus_amount: line.bonus_amount,
        check_number: line.check_number,
        note: line.note,
      },
    ]),
  );

  await auth.supabase
    .from("payroll_staff_daily_totals")
    .delete()
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id);
  await auth.supabase
    .from("payroll_staff_lines")
    .delete()
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id);

  const [staffRows, settings, earnings, correctionDeltas] = await Promise.all([
    loadStaffRows(auth),
    loadStaffPayrollSettings(auth),
    loadStaffEarningsForPeriod(auth, period),
    loadFinancialAdjustmentDeltasByStaffDate(auth, period),
  ]);
  const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));
  const settingMap = settingsByStaffId(settings);
  const grossCentsByStaffId = new Map<string, number>();
  const tipCentsByStaffId = new Map<string, number>();
  const hasManualTipByStaffId = new Map<string, boolean>();
  const dailyCentsByStaffDate = new Map<
    string,
    {
      grossCents: number;
      staffId: string;
      tipCents: number;
      workDate: string;
    }
  >();

  for (const earning of earnings) {
    const staffId = earning.staff_id;

    grossCentsByStaffId.set(
      staffId,
      (grossCentsByStaffId.get(staffId) ?? 0) + toCents(earning.service_total),
    );
    tipCentsByStaffId.set(
      staffId,
      (tipCentsByStaffId.get(staffId) ?? 0) + toCents(earning.tip_amount),
    );
    hasManualTipByStaffId.set(
      staffId,
      Boolean(hasManualTipByStaffId.get(staffId) || earning.tip_is_manual),
    );

    const dailyKey = `${staffId}:${earning.work_date}`;
    const daily = dailyCentsByStaffDate.get(dailyKey) ?? {
      grossCents: 0,
      staffId,
      tipCents: 0,
      workDate: earning.work_date,
    };
    daily.grossCents += toCents(earning.service_total);
    daily.tipCents += toCents(earning.tip_amount);
    dailyCentsByStaffDate.set(dailyKey, daily);
  }

  const staffIds = Array.from(grossCentsByStaffId.keys()).sort((left, right) =>
    getStaffName(staffById.get(left), left).localeCompare(getStaffName(staffById.get(right), right)),
  );
  const lines = staffIds.map((staffId) => {
    const staff = staffById.get(staffId);
    const setting = pickEffectiveSetting({
      organizationId: auth.organization.id,
      periodEnd: period.endDate,
      periodStart: period.startDate,
      salonId: auth.salon.id,
      settingsByStaffId: settingMap,
      staff,
      staffId,
    });
    const grossSales = fromCents(grossCentsByStaffId.get(staffId) ?? 0);
    const tipAmount = fromCents(tipCentsByStaffId.get(staffId) ?? 0);
    const manualValues = previousManualValuesByStaffId.get(staffId);
    const bonusAmount = roundMoney(numberValue(manualValues?.bonus_amount));
    const calculation = buildLineCalculation({
      bonusAmount,
      grossSales,
      setting,
      tipAmount,
    });

    return {
      bonus_amount: bonusAmount,
      cash_amount: calculation.cashAmount,
      check_gross: calculation.checkGross,
      check_net: calculation.checkNet,
      check_number: manualValues?.check_number ?? null,
      check_rate_used: numberValue(setting.check_rate),
      commission_rate_used: setting.pay_type === "commission" ? numberValue(setting.commission_rate) : 0,
      fixed_pay_amount_used:
        setting.pay_type === "fixed" ? roundMoney(numberValue(setting.fixed_pay_amount)) : 0,
      final_staff_income: calculation.finalStaffIncome,
      gross_sales: grossSales,
      note: manualValues?.note ?? null,
      organization_id: auth.organization.id,
      pay_type_used: setting.pay_type,
      payroll_run_id: run.id,
      salon_id: auth.salon.id,
      shop_share: calculation.shopShare,
      staff_commission_gross: calculation.staffCommissionGross,
      staff_display_name_snapshot: getStaffName(staff, staffId),
      staff_id: staffId,
      staff_legal_name_snapshot: getLegalName(setting, staff),
      tax_company_enabled_snapshot: setting.tax_company_enabled,
      tax_rate_used: numberValue(setting.tax_rate),
      tax_withheld: calculation.taxWithheld,
      tip_allocation_method: getTipAllocationMethod({
        hasManualTip: Boolean(hasManualTipByStaffId.get(staffId)),
        tipAmount,
      }),
      tip_amount: tipAmount,
    };
  });
  const dailyTotals = Array.from(dailyCentsByStaffDate.values()).map((daily) => ({
    business_date: daily.workDate,
    correction_delta: correctionDeltas.get(`${daily.staffId}:${daily.workDate}`) ?? 0,
    gross_sales: fromCents(daily.grossCents),
    note: null,
    organization_id: auth.organization.id,
    payroll_run_id: run.id,
    salon_id: auth.salon.id,
    staff_id: daily.staffId,
    tip_amount: fromCents(daily.tipCents),
  }));
  const corrections = await loadPayrollCorrections(auth, period, staffById);
  const settingsSnapshot = lines.map((line) => ({
    checkRate: line.check_rate_used,
    commissionRate: line.commission_rate_used,
    fixedPayAmount: line.fixed_pay_amount_used,
    payType: line.pay_type_used,
    staffId: line.staff_id,
    taxCompanyEnabled: line.tax_company_enabled_snapshot,
    taxRate: line.tax_rate_used,
  }));

  if (lines.length > 0) {
    const { error } = await auth.supabase.from("payroll_staff_lines").insert(lines);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (dailyTotals.length > 0) {
    const { error } = await auth.supabase
      .from("payroll_staff_daily_totals")
      .insert(dailyTotals);

    if (error) {
      throw new Error(error.message);
    }
  }

  const { data: updatedRun, error: updateRunError } = await auth.supabase
    .from("payroll_runs")
    .update({
      correction_snapshot: corrections,
      generated_at: new Date().toISOString(),
      settings_snapshot: settingsSnapshot,
      status: "draft",
    })
    .eq("id", run.id)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .select(PAYROLL_RUN_SELECT)
    .single<PayrollRun>();

  if (updateRunError) {
    throw new Error(updateRunError.message);
  }

  return updatedRun;
}

export async function getPayrollPageData(input: {
  cycleType?: string;
  endDate?: string;
  preset?: string;
  startDate?: string;
}) {
  const auth = await requirePayrollContext();
  const [salonSetting, staffRows, settings] = await Promise.all([
    auth.access.canViewAllPayroll
      ? loadSalonPayrollSetting(auth)
      : Promise.resolve(
          getDefaultSalonPayrollSetting(auth.organization.id, auth.salon.id),
        ),
    auth.access.canViewAllPayroll ? loadStaffRows(auth) : Promise.resolve([]),
    auth.access.canViewAllPayroll ? loadStaffPayrollSettings(auth) : Promise.resolve([]),
  ]);
  const period = resolvePayrollPeriod({
    cycleType: input.cycleType,
    endDate: input.endDate,
    preset: input.preset,
    salonSetting,
    startDate: input.startDate,
  });
  const snapshot = await loadPayrollSnapshot(auth, period);
  const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));
  const corrections = auth.access.canViewAllPayroll
    ? await loadPayrollCorrections(auth, period, staffById)
    : [];
  const summary = calculateSummary({ corrections, lines: snapshot.lines });

  return {
    access: auth.access,
    context: auth.context,
    corrections,
    period,
    run: snapshot.run,
    salonPayrollSetting: salonSetting,
    settings: latestSettingsWithStaff(staffRows, settings),
    staff: staffRows,
    staffLines: snapshot.lines,
    summary,
  };
}

export async function getPayrollTaxCompanyData(input: {
  cycleType?: string;
  endDate?: string;
  preset?: string;
  startDate?: string;
}) {
  const auth = await requirePayrollContext({ taxCompanyOnly: true });
  const salonSetting = await loadSalonPayrollSetting(auth);
  const period = resolvePayrollPeriod({
    cycleType: input.cycleType,
    endDate: input.endDate,
    preset: input.preset,
    salonSetting,
    startDate: input.startDate,
  });
  const snapshot = await loadPayrollSnapshot(auth, period);
  const staffLines = snapshot.lines.filter(
    (line) => line.tax_company_enabled_snapshot,
  );
  const summary = calculateSummary({ corrections: [], lines: staffLines });

  return {
    access: auth.access,
    context: auth.context,
    period,
    run: snapshot.run,
    staffLines,
    summary,
  };
}

export async function generatePayrollRun(input: {
  cycleType: PayrollCycleType;
  endDate: string;
  startDate: string;
}) {
  assertDateRange(input.startDate, input.endDate);

  const auth = await requirePayrollManageContext();
  const period: PayrollPeriod = {
    cycleType: input.cycleType,
    endDate: input.endDate,
    label: formatPeriodLabel(input.startDate, input.endDate),
    preset: input.cycleType === "custom" ? "custom" : "previous_month",
    startDate: input.startDate,
  };
  const existingRun = await loadPayrollRun(auth, period);

  if (existingRun) {
    return existingRun;
  }

  const { data: createdRun, error } = await auth.supabase
    .from("payroll_runs")
    .insert({
      cycle_type: input.cycleType,
      organization_id: auth.organization.id,
      period_end: input.endDate,
      period_start: input.startDate,
      salon_id: auth.salon.id,
      status: "draft",
    })
    .select(PAYROLL_RUN_SELECT)
    .single<PayrollRun>();

  if (error) {
    if (error.code === "23505") {
      const conflictedRun = await loadPayrollRun(auth, period);

      if (conflictedRun) {
        return conflictedRun;
      }
    }

    throw new Error(error.message);
  }

  return rebuildPayrollRunSnapshot(auth, createdRun);
}

export async function recalculatePayrollRun(payrollRunId: string) {
  if (!payrollRunId) {
    throw new Error("Payroll run is required.");
  }

  const auth = await requirePayrollManageContext();
  const run = await loadPayrollRunById(auth, payrollRunId);

  if (run.status !== "draft") {
    throw new Error("Only draft payroll can be recalculated.");
  }

  return rebuildPayrollRunSnapshot(auth, run);
}

export async function lockPayrollRun(payrollRunId: string) {
  if (!payrollRunId) {
    throw new Error("Payroll run is required.");
  }

  const auth = await requirePayrollManageContext();
  const run = await loadPayrollRunById(auth, payrollRunId);

  if (run.status !== "draft") {
    throw new Error("Only draft payroll can be locked.");
  }

  const now = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("payroll_runs")
    .update({
      locked_at: now,
      locked_by: auth.user.id,
      status: "locked",
    })
    .eq("id", run.id)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .select(PAYROLL_RUN_SELECT)
    .single<PayrollRun>();

  if (error) {
    throw new Error(error.message);
  }

  const { error: lockEarningsError } = await auth.supabase
    .from("pos_ticket_staff_earnings")
    .update({
      locked_at: now,
      payroll_batch_id: run.id,
    })
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("work_date", run.period_start)
    .lte("work_date", run.period_end)
    .is("locked_at", null);

  if (lockEarningsError) {
    throw new Error(lockEarningsError.message);
  }

  return data;
}

export async function markPayrollRunPaid(payrollRunId: string) {
  if (!payrollRunId) {
    throw new Error("Payroll run is required.");
  }

  const auth = await requirePayrollManageContext();
  const run = await loadPayrollRunById(auth, payrollRunId);

  if (run.status !== "locked" && run.status !== "needs_review") {
    throw new Error("Only locked payroll can be marked paid.");
  }

  const { data, error } = await auth.supabase
    .from("payroll_runs")
    .update({
      paid_at: new Date().toISOString(),
      paid_by: auth.user.id,
      status: "paid",
    })
    .eq("id", run.id)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .select(PAYROLL_RUN_SELECT)
    .single<PayrollRun>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updatePayrollStaffLine(input: {
  bonusAmount: number;
  checkNumber: string | null;
  lineId: string;
  note: string | null;
}) {
  if (!input.lineId) {
    throw new Error("Payroll staff line is required.");
  }

  if (!Number.isFinite(input.bonusAmount) || input.bonusAmount < 0) {
    throw new Error("Bonus must be a non-negative amount.");
  }

  const auth = await requirePayrollManageContext();
  const { data: line, error } = await auth.supabase
    .from("payroll_staff_lines")
    .select(PAYROLL_STAFF_LINE_SELECT)
    .eq("id", input.lineId)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<PayrollStaffLine>();

  if (error) {
    throw new Error(error.message);
  }

  if (!line) {
    throw new Error("Payroll staff line was not found.");
  }

  const run = await loadPayrollRunById(auth, line.payroll_run_id);

  if (run.status === "paid") {
    throw new Error("Paid payroll cannot be edited.");
  }

  const bonusAmount = roundMoney(input.bonusAmount);
  const finalStaffIncome = roundMoney(
    numberValue(line.cash_amount) +
      numberValue(line.check_net) +
      numberValue(line.tip_amount) +
      bonusAmount,
  );
  const { data: updatedLine, error: updateError } = await auth.supabase
    .from("payroll_staff_lines")
    .update({
      bonus_amount: bonusAmount,
      check_number: input.checkNumber?.trim() || null,
      final_staff_income: finalStaffIncome,
      note: input.note?.trim() || null,
    })
    .eq("id", input.lineId)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .select(PAYROLL_STAFF_LINE_SELECT)
    .single<PayrollStaffLine>();

  if (updateError) {
    throw new Error(updateError.message);
  }

  return updatedLine;
}

export async function updateSalonPayrollSetting(input: {
  biweeklyAnchorDate: string | null;
  cycleType: Exclude<PayrollCycleType, "custom">;
}) {
  const auth = await requirePayrollManageContext();

  if (input.cycleType !== "monthly" && input.cycleType !== "biweekly") {
    throw new Error("Payroll cycle is required.");
  }

  if (
    input.biweeklyAnchorDate &&
    !isDateInputValue(input.biweeklyAnchorDate)
  ) {
    throw new Error("Biweekly anchor date must use YYYY-MM-DD format.");
  }

  const payload = {
    biweekly_anchor_date:
      input.cycleType === "biweekly" ? input.biweeklyAnchorDate : null,
    cycle_type: input.cycleType,
    organization_id: auth.organization.id,
    salon_id: auth.salon.id,
  };
  const { data, error } = await auth.supabase
    .from("salon_payroll_settings")
    .upsert(payload, { onConflict: "salon_id" })
    .select(SALON_PAYROLL_SETTING_SELECT)
    .single<SalonPayrollSetting>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateStaffPayrollSetting(input: {
  applyTaxToFixedPay: boolean;
  checkRate: number;
  commissionRate: number;
  effectiveFrom: string;
  fixedPayAmount: number;
  legalName: string | null;
  payType: StaffPayType;
  staffId: string;
  taxCompanyEnabled: boolean;
  taxRate: number;
}) {
  const auth = await requirePayrollManageContext();

  if (!input.staffId) {
    throw new Error("Staff is required.");
  }

  if (input.payType !== "commission" && input.payType !== "fixed") {
    throw new Error("Pay type is required.");
  }

  if (!isDateInputValue(input.effectiveFrom)) {
    throw new Error("Effective from date is required.");
  }

  for (const [label, value] of [
    ["Commission rate", input.commissionRate],
    ["Check split rate", input.checkRate],
    ["Tax rate", input.taxRate],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`${label} must be between 0 and 100.`);
    }
  }

  if (!Number.isFinite(input.fixedPayAmount) || input.fixedPayAmount < 0) {
    throw new Error("Fixed pay amount must be a non-negative amount.");
  }

  const { data: staff, error: staffError } = await auth.supabase
    .from("staff")
    .select("id")
    .eq("id", input.staffId)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .maybeSingle<{ id: string }>();

  if (staffError) {
    throw new Error(staffError.message);
  }

  if (!staff) {
    throw new Error("Staff must belong to the current salon.");
  }

  const payload = {
    apply_tax_to_fixed_pay: input.applyTaxToFixedPay,
    check_rate: roundMoney(input.checkRate),
    commission_rate: roundMoney(input.commissionRate),
    effective_from: input.effectiveFrom,
    fixed_pay_amount: roundMoney(input.fixedPayAmount),
    legal_name: input.legalName?.trim() || null,
    organization_id: auth.organization.id,
    pay_type: input.payType,
    salon_id: auth.salon.id,
    staff_id: input.staffId,
    tax_company_enabled: input.taxCompanyEnabled,
    tax_rate: roundMoney(input.taxRate),
  };
  const { data: existing, error: existingError } = await auth.supabase
    .from("staff_payroll_settings")
    .select("id")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("staff_id", input.staffId)
    .eq("effective_from", input.effectiveFrom)
    .maybeSingle<{ id: string }>();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    const { data, error } = await auth.supabase
      .from("staff_payroll_settings")
      .update(payload)
      .eq("id", existing.id)
      .eq("organization_id", auth.organization.id)
      .eq("salon_id", auth.salon.id)
      .select(STAFF_PAYROLL_SETTING_SELECT)
      .single<StaffPayrollSetting>();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  const dayBeforeEffective = addDays(input.effectiveFrom, -1);
  const { error: closePreviousError } = await auth.supabase
    .from("staff_payroll_settings")
    .update({ effective_to: dayBeforeEffective })
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("staff_id", input.staffId)
    .is("effective_to", null)
    .lt("effective_from", input.effectiveFrom);

  if (closePreviousError) {
    throw new Error(closePreviousError.message);
  }

  const { data, error } = await auth.supabase
    .from("staff_payroll_settings")
    .insert(payload)
    .select(STAFF_PAYROLL_SETTING_SELECT)
    .single<StaffPayrollSetting>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
