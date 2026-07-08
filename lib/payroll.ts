import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { getUtcBoundsForLocalDate, isDateInputValue } from "@/lib/daily-pos-report";
import { hasPermission } from "@/lib/permissions";
import { calculateTaxCompanyReporting } from "@/lib/payroll-tax-company";
import { STAFF_SELECT } from "@/lib/staff";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { CurrentBusinessContext } from "@/lib/current-context";
import type {
  PayrollCorrectionListItem,
  PayrollCycleType,
  PayrollLiveSnapshot,
  PayrollPaystub,
  PayrollPeriod,
  PayrollPeriodOption,
  PayrollPeriodPreset,
  PayrollPeriodStaffInput,
  PayrollPayoutMethod,
  PayrollShopDailyRow,
  PayrollShopSummary,
  PayrollRun,
  PayrollStaffDailyTotal,
  PayrollStaffLine,
  PayrollStaffLineWithDailyTotals,
  PayrollStatementDifference,
  PayrollStatementSnapshot,
  PayrollStatusView,
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
  "id, organization_id, salon_id, staff_id, legal_name, pay_type, commission_rate, fixed_pay_amount, check_rate, tax_rate, apply_tax_to_fixed_pay, tax_tips, tax_bonus, tax_company_enabled, cash_to_tax_company, tip_payout_method, bonus_payout_method, effective_from, effective_to, created_at, updated_at";
export const PAYROLL_PERIOD_STAFF_INPUT_SELECT =
  "id, organization_id, salon_id, staff_id, period_start, period_end, cycle_type, check_number, bonus_amount, note, updated_by, created_at, updated_at";
export const PAYROLL_RUN_SELECT =
  "id, organization_id, salon_id, period_start, period_end, cycle_type, status, version, settings_snapshot, correction_snapshot, generated_at, printed_at, printed_by, locked_at, locked_by, paid_at, paid_by, created_at, updated_at";
export const PAYROLL_STAFF_LINE_SELECT =
  "id, payroll_run_id, organization_id, salon_id, staff_id, staff_display_name_snapshot, staff_legal_name_snapshot, gross_sales, pay_type_used, commission_rate_used, fixed_pay_amount_used, staff_commission_gross, shop_share, check_rate_used, base_check_amount, base_cash_amount, cash_amount, check_gross, tax_rate_used, tax_withheld, check_net, check_number, tip_amount, tip_check_amount, tip_cash_amount, tip_payout_method_snapshot, tip_allocation_method, bonus_amount, bonus_check_amount, bonus_cash_amount, bonus_payout_method_snapshot, earned_amount, final_check_amount, final_cash_amount, final_staff_income, tax_bonus_snapshot, tax_tips_snapshot, tax_company_reported_wage_gross, tax_company_taxable_gross, tax_company_enabled_snapshot, cash_to_tax_company_snapshot, tax_company_check_amount, tax_company_cash_amount, is_mixed_rate, settings_used_snapshot, period_staff_input_snapshot, note, created_at, updated_at";
export const PAYROLL_STAFF_DAILY_TOTAL_SELECT =
  "id, payroll_run_id, organization_id, salon_id, staff_id, business_date, gross_sales, tip_amount, correction_delta, pay_type_used, commission_rate_used, fixed_pay_amount_used, check_rate_used, tax_rate_used, settings_used_snapshot, note, created_at, updated_at";
export const PAYROLL_PAYSTUB_SELECT =
  "id, payroll_run_id, organization_id, salon_id, staff_id, uploaded_by, file_url_or_path, file_name, mime_type, size_bytes, note, created_at, updated_at";

const DEFAULT_COMMISSION_RATE = 60;
const DEFAULT_CHECK_RATE = 60;
const DEFAULT_TAX_RATE = 0;
const DEFAULT_TIP_PAYOUT_METHOD = "cash" satisfies PayrollPayoutMethod;
const DEFAULT_BONUS_PAYOUT_METHOD = "check" satisfies PayrollPayoutMethod;
const PAYROLL_PAYSTUB_BUCKET = "payroll-paystubs";
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
  admin_note: string | null;
  business_date: string;
  correction_type: string;
  id: string;
  money_delta: number;
  old_value_json: unknown;
  reason: string;
  requested_at: string;
  requested_by: string;
  requested_value_json: unknown;
  status: string;
  target_id: string | null;
  target_type: string;
};

type FinancialAdjustmentRow = {
  actual_total_delta: number;
  business_date: string;
  correction_request_id: string | null;
  created_at: string;
  created_by: string;
  expected_total_delta: number;
  id: string;
  note: string | null;
  service_delta: number;
  staff_id: string | null;
  target_id: string | null;
  target_type: string;
  ticket_id: string | null;
  tip_delta: number;
};

type TicketForAdjustmentRow = {
  id: string;
  opened_at: string;
  ticket_number: string | null;
};

type TicketAdjustmentRow = {
  action: string;
  after_snapshot: unknown;
  before_snapshot: unknown;
  created_at: string;
  created_by: string;
  id: string;
  reason: string;
  ticket_id: string;
};

type DailyClosingRow = {
  cash_amount: number;
  closed_at: string | null;
  credit_card_amount: number;
  locked_at: string | null;
  other_amount: number;
  report_date: string;
  status: string;
};

type DailyEarningAccumulator = {
  grossSales: number;
  hasManualTip: boolean;
  tipAmount: number;
};

type DailyPayrollResult = {
  baseCashAmount: number;
  baseCheckAmount: number;
  checkGross: number;
  checkNet: number;
  cashAmount: number;
  dailyTotal: PayrollStaffDailyTotal;
  payTaxWithheld: number;
  setting: StaffPayrollSetting;
  staffPay: number;
  taxCompanyCashReported: number;
  taxCompanyReportedWageGross: number;
  taxCompanyTaxableGross: number;
  tipCashAmount: number;
  tipCheckAmount: number;
  taxWithheld: number;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function moneyChanged(left: number, right: number) {
  return Math.round((left - right) * 100) !== 0;
}

function parseDateParts(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return { day, month, year };
}

function dateOnlyFromUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(value: string, days: number) {
  return dateOnlyFromUtcDate(new Date(dateFromDateOnly(value).getTime() + days * DAY_MS));
}

function getDateRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function firstDayOfMonth(date: Date) {
  return dateOnlyFromUtcDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
  );
}

function lastDayOfMonth(date: Date) {
  return dateOnlyFromUtcDate(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)),
  );
}

function getCurrentMonthPeriod(referenceDate = new Date()) {
  return {
    endDate: lastDayOfMonth(referenceDate),
    startDate: firstDayOfMonth(referenceDate),
  };
}

function monthInputFromDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function parseMonthInput(value: string | null | undefined, referenceDate = new Date()) {
  if (value && /^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    if (month >= 1 && month <= 12) {
      return { month, value, year };
    }
  }

  const fallback = monthInputFromDate(referenceDate);
  const [year, month] = fallback.split("-").map(Number);
  return { month, value: fallback, year };
}

function getMonthPeriod(monthValue: string | null | undefined, referenceDate = new Date()) {
  const { month, value, year } = parseMonthInput(monthValue, referenceDate);
  const startDate = dateOnlyFromUtcDate(new Date(Date.UTC(year, month - 1, 1)));
  const endDate = dateOnlyFromUtcDate(new Date(Date.UTC(year, month, 0)));

  return { endDate, monthValue: value, startDate };
}

function getSemiMonthlyPeriod(input: {
  month?: string | null;
  referenceDate?: Date;
  segment?: string | null;
}) {
  const month = getMonthPeriod(input.month, input.referenceDate);
  const secondStart = `${month.monthValue}-16`;
  const segment = input.segment === "second" ? "second" : "first";

  if (segment === "second") {
    return {
      endDate: month.endDate,
      preset: "semi_monthly_second" as const,
      segment,
      startDate: secondStart,
    };
  }

  return {
    endDate: `${month.monthValue}-15`,
    preset: "semi_monthly_first" as const,
    segment,
    startDate: month.startDate,
  };
}

function getPreviousMonthPeriod(referenceDate = new Date()) {
  const previousMonth = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() - 1, 1),
  );

  return {
    endDate: lastDayOfMonth(previousMonth),
    startDate: firstDayOfMonth(previousMonth),
  };
}

function getBiweeklyPeriods(anchorDate: string, referenceDate = new Date()) {
  const referenceDateOnly = dateOnlyFromUtcDate(referenceDate);
  const elapsedDays = Math.floor(
    (dateFromDateOnly(referenceDateOnly).getTime() -
      dateFromDateOnly(anchorDate).getTime()) /
      DAY_MS,
  );
  const offset = ((elapsedDays % 14) + 14) % 14;
  const currentStart = addDays(referenceDateOnly, -offset);
  const currentEnd = addDays(currentStart, 13);

  return {
    current: {
      endDate: currentEnd,
      startDate: currentStart,
    },
    previous: {
      endDate: addDays(currentStart, -1),
      startDate: addDays(currentStart, -14),
    },
  };
}

function formatDateForLabel(value: string) {
  const { day, month, year } = parseDateParts(value);
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatPeriodLabel(startDate: string, endDate: string) {
  return `${formatDateForLabel(startDate)} - ${formatDateForLabel(endDate)}`;
}

function normalizePreset(
  value: string | null | undefined,
  cycleType: Exclude<PayrollCycleType, "custom">,
): PayrollPeriodPreset {
  if (value === "custom") {
    return value;
  }

  if (cycleType === "biweekly") {
    if (value === "previous_pay_period" || value === "current_pay_period") {
      return value;
    }

    return "current_pay_period";
  }

  if (cycleType === "semi_monthly") {
    if (value === "semi_monthly_first" || value === "semi_monthly_second") {
      return value;
    }

    return "semi_monthly_first";
  }

  if (value === "previous_month" || value === "current_month") {
    return value;
  }

  return "current_month";
}

function assertDateRange(startDate: string, endDate: string) {
  if (!isDateInputValue(startDate) || !isDateInputValue(endDate)) {
    throw new Error("Start and end dates are required.");
  }

  if (startDate > endDate) {
    throw new Error("Start date must be before end date.");
  }
}

function hasValidDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
  return Boolean(
    startDate &&
      endDate &&
      isDateInputValue(startDate) &&
      isDateInputValue(endDate) &&
      startDate <= endDate,
  );
}

function getDefaultSalonPayrollSetting(
  organizationId: string,
  salonId: string,
): SalonPayrollSetting {
  const now = new Date().toISOString();

  return {
    biweekly_anchor_date: null,
    created_at: now,
    cycle_type: "monthly",
    id: "",
    organization_id: organizationId,
    salon_id: salonId,
    updated_at: now,
  };
}

export function resolvePayrollPeriod(input: {
  cycleType?: string | null;
  endDate?: string | null;
  month?: string | null;
  payPeriodStart?: string | null;
  preset?: string | null;
  referenceDate?: Date;
  segment?: string | null;
  salonSetting: SalonPayrollSetting | null;
  startDate?: string | null;
}): PayrollPeriod {
  const settingCycle = input.salonSetting?.cycle_type ?? "monthly";
  const requestedCycle: Exclude<PayrollCycleType, "custom"> = settingCycle;
  const preset = normalizePreset(input.preset, requestedCycle);
  const hasCustomRange = hasValidDateRange(input.startDate, input.endDate);

  if (preset === "custom" && hasCustomRange) {
    const startDate = input.startDate ?? "";
    const endDate = input.endDate ?? "";
    assertDateRange(startDate, endDate);

    return {
      cycleType: "custom",
      endDate,
      label: formatPeriodLabel(startDate, endDate),
      preset: "custom",
      startDate,
    };
  }

  if (requestedCycle === "semi_monthly") {
    const semiPeriod = getSemiMonthlyPeriod({
      month: input.month,
      referenceDate: input.referenceDate,
      segment:
        input.segment ??
        (preset === "semi_monthly_second" ? "second" : "first"),
    });

    return {
      cycleType: "semi_monthly",
      endDate: semiPeriod.endDate,
      label: formatPeriodLabel(semiPeriod.startDate, semiPeriod.endDate),
      preset: semiPeriod.preset,
      startDate: semiPeriod.startDate,
    };
  }

  if (requestedCycle === "biweekly") {
    const anchorDate = input.salonSetting?.biweekly_anchor_date;

    if (!anchorDate) {
      const fallback = getCurrentMonthPeriod(input.referenceDate);

      return {
        cycleType: "custom",
        endDate: fallback.endDate,
        label: formatPeriodLabel(fallback.startDate, fallback.endDate),
        preset: "custom",
        startDate: fallback.startDate,
      };
    }

    const periods = getBiweeklyPeriods(anchorDate, input.referenceDate);
    const requestedStart =
      input.payPeriodStart && isDateInputValue(input.payPeriodStart)
        ? input.payPeriodStart
        : null;
    const period = requestedStart
      ? { endDate: addDays(requestedStart, 13), startDate: requestedStart }
      : preset === "previous_pay_period"
        ? periods.previous
        : periods.current;

    return {
      cycleType: "biweekly",
      endDate: period.endDate,
      label: formatPeriodLabel(period.startDate, period.endDate),
      preset: preset === "previous_pay_period" ? "previous_pay_period" : "current_pay_period",
      startDate: period.startDate,
    };
  }

  const period =
    input.month
      ? getMonthPeriod(input.month, input.referenceDate)
      : preset === "previous_month"
      ? getPreviousMonthPeriod(input.referenceDate)
      : getCurrentMonthPeriod(input.referenceDate);

  return {
    cycleType: "monthly",
    endDate: period.endDate,
    label: formatPeriodLabel(period.startDate, period.endDate),
    preset: preset === "previous_month" ? "previous_month" : "current_month",
    startDate: period.startDate,
  };
}

export function getPayrollPeriodOptions(input: {
  referenceDate?: Date;
  salonSetting: SalonPayrollSetting;
}): PayrollPeriodOption[] {
  const referenceDate = input.referenceDate ?? new Date();

  if (input.salonSetting.cycle_type === "biweekly") {
    const anchorDate = input.salonSetting.biweekly_anchor_date;

    if (!anchorDate) {
      return [];
    }

    const periods = getBiweeklyPeriods(anchorDate, referenceDate);
    const options: PayrollPeriodOption[] = [];
    let startDate = addDays(periods.current.startDate, -28);

    for (let index = 0; index < 5; index += 1) {
      const endDate = addDays(startDate, 13);
      options.push({
        endDate,
        label: formatPeriodLabel(startDate, endDate),
        startDate,
        value: startDate,
      });
      startDate = addDays(startDate, 14);
    }

    return options;
  }

  if (input.salonSetting.cycle_type === "semi_monthly") {
    const month = getMonthPeriod(monthInputFromDate(referenceDate), referenceDate);
    return [
      {
        endDate: `${month.monthValue}-15`,
        label: `${formatDateForLabel(month.startDate)} - ${formatDateForLabel(`${month.monthValue}-15`)}`,
        startDate: month.startDate,
        value: "first",
      },
      {
        endDate: month.endDate,
        label: `${formatDateForLabel(`${month.monthValue}-16`)} - ${formatDateForLabel(month.endDate)}`,
        startDate: `${month.monthValue}-16`,
        value: "second",
      },
    ];
  }

  const month = getMonthPeriod(monthInputFromDate(referenceDate), referenceDate);
  return [
    {
      endDate: month.endDate,
      label: formatPeriodLabel(month.startDate, month.endDate),
      startDate: month.startDate,
      value: month.monthValue,
    },
  ];
}

function getStaffName(staff: Staff | undefined, staffId: string) {
  return staff?.display_name || `${staffId.slice(0, 8)}...`;
}

function getLegalName(setting: StaffPayrollSetting | null) {
  return setting?.legal_name?.trim() || null;
}

function getDefaultStaffPayrollSetting(input: {
  organizationId: string;
  salonId: string;
  staff?: Staff;
  staffId: string;
}): StaffPayrollSetting {
  const now = new Date().toISOString();

  return {
    apply_tax_to_fixed_pay: true,
    bonus_payout_method: DEFAULT_BONUS_PAYOUT_METHOD,
    cash_to_tax_company: false,
    check_rate: DEFAULT_CHECK_RATE,
    commission_rate: DEFAULT_COMMISSION_RATE,
    created_at: now,
    effective_from: "1900-01-01",
    effective_to: null,
    fixed_pay_amount: 0,
    id: "",
    legal_name: null,
    organization_id: input.organizationId,
    pay_type: "commission",
    salon_id: input.salonId,
    staff_id: input.staffId,
    tax_bonus: false,
    tax_company_enabled: false,
    tax_rate: DEFAULT_TAX_RATE,
    tax_tips: false,
    tip_payout_method: DEFAULT_TIP_PAYOUT_METHOD,
    updated_at: now,
  };
}

function normalizeStaffPayrollSetting(setting: StaffPayrollSetting): StaffPayrollSetting {
  const taxCompanyEnabled = Boolean(setting.tax_company_enabled);
  const tipPayoutMethod =
    setting.tip_payout_method === "check" || setting.tip_payout_method === "cash"
      ? setting.tip_payout_method
      : DEFAULT_TIP_PAYOUT_METHOD;
  const bonusPayoutMethod =
    setting.bonus_payout_method === "check" ||
    setting.bonus_payout_method === "cash"
      ? setting.bonus_payout_method
      : DEFAULT_BONUS_PAYOUT_METHOD;

  return {
    ...setting,
    bonus_payout_method: bonusPayoutMethod,
    cash_to_tax_company: Boolean(setting.cash_to_tax_company),
    check_rate: numberValue(setting.check_rate),
    commission_rate: numberValue(setting.commission_rate),
    fixed_pay_amount: numberValue(setting.fixed_pay_amount),
    tax_bonus: Boolean(setting.tax_bonus),
    tax_company_enabled: taxCompanyEnabled,
    tax_rate: numberValue(setting.tax_rate),
    tax_tips: Boolean(setting.tax_tips),
    tip_payout_method: tipPayoutMethod,
  };
}

function isTaxCompanyReportableSetting(setting: StaffPayrollSetting) {
  return (
    numberValue(setting.tax_rate) > 0 ||
    Boolean(setting.tax_tips) ||
    Boolean(setting.tax_bonus) ||
    Boolean(setting.cash_to_tax_company) ||
    (setting.pay_type === "fixed" && Boolean(setting.apply_tax_to_fixed_pay))
  );
}

function settingsByStaffId(settings: StaffPayrollSetting[]) {
  const map = new Map<string, StaffPayrollSetting[]>();

  for (const setting of settings.map(normalizeStaffPayrollSetting)) {
    const list = map.get(setting.staff_id) ?? [];
    list.push(setting);
    map.set(setting.staff_id, list);
  }

  for (const list of map.values()) {
    list.sort((left, right) => right.effective_from.localeCompare(left.effective_from));
  }

  return map;
}

function settingOverlapsPeriod(setting: StaffPayrollSetting, period: PayrollPeriod) {
  return (
    setting.effective_from <= period.endDate &&
    (setting.effective_to === null || setting.effective_to >= period.startDate)
  );
}

function pickEffectiveSetting(input: {
  businessDate: string;
  organizationId: string;
  salonId: string;
  settingsByStaffId: Map<string, StaffPayrollSetting[]>;
  staff?: Staff;
  staffId: string;
}) {
  const settings = input.settingsByStaffId.get(input.staffId) ?? [];
  const match = settings.find(
    (setting) =>
      setting.effective_from <= input.businessDate &&
      (setting.effective_to === null || setting.effective_to >= input.businessDate),
  );

  return (
    match ??
    getDefaultStaffPayrollSetting({
      organizationId: input.organizationId,
      salonId: input.salonId,
      staff: input.staff,
      staffId: input.staffId,
    })
  );
}

function latestSettingForPeriod(input: {
  organizationId: string;
  period: PayrollPeriod;
  salonId: string;
  settingsByStaffId: Map<string, StaffPayrollSetting[]>;
  staff?: Staff;
  staffId: string;
}) {
  return pickEffectiveSetting({
    businessDate: input.period.endDate,
    organizationId: input.organizationId,
    salonId: input.salonId,
    settingsByStaffId: input.settingsByStaffId,
    staff: input.staff,
    staffId: input.staffId,
  });
}

function serializeSetting(setting: StaffPayrollSetting) {
  return {
    applyTaxToFixedPay: setting.apply_tax_to_fixed_pay,
    bonusPayoutMethod: setting.bonus_payout_method,
    cashToTaxCompany: Boolean(setting.cash_to_tax_company),
    checkRate: numberValue(setting.check_rate),
    commissionRate: numberValue(setting.commission_rate),
    effectiveFrom: setting.effective_from,
    effectiveTo: setting.effective_to,
    fixedPayAmount: roundMoney(numberValue(setting.fixed_pay_amount)),
    id: setting.id || null,
    legalName: setting.legal_name,
    payType: setting.pay_type,
    staffId: setting.staff_id,
    taxBonus: setting.tax_bonus,
    taxCompanyEnabled: setting.tax_company_enabled,
    taxRate: numberValue(setting.tax_rate),
    taxTips: setting.tax_tips,
    tipPayoutMethod: setting.tip_payout_method,
  };
}

function serializeInput(input: PayrollPeriodStaffInput | null) {
  if (!input) {
    return {};
  }

  return {
    bonusAmount: roundMoney(numberValue(input.bonus_amount)),
    checkNumber: input.check_number,
    id: input.id,
    note: input.note,
    staffId: input.staff_id,
    updatedAt: input.updated_at,
    updatedBy: input.updated_by,
  };
}

function settingSignature(setting: StaffPayrollSetting) {
  return JSON.stringify({
    applyTaxToFixedPay: setting.apply_tax_to_fixed_pay,
    bonusPayoutMethod: setting.bonus_payout_method,
    cashToTaxCompany: Boolean(setting.cash_to_tax_company),
    checkRate: numberValue(setting.check_rate),
    commissionRate: numberValue(setting.commission_rate),
    effectiveFrom: setting.effective_from,
    fixedPayAmount: roundMoney(numberValue(setting.fixed_pay_amount)),
    payType: setting.pay_type,
    taxBonus: setting.tax_bonus,
    taxCompanyEnabled: setting.tax_company_enabled,
    taxRate: numberValue(setting.tax_rate),
    taxTips: setting.tax_tips,
    tipPayoutMethod: setting.tip_payout_method,
  });
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

async function requirePayrollContext(
  options: { taxCompanyOnly?: boolean } = {},
): Promise<PayrollAuthContext> {
  const context = await getCurrentBusinessContext();

  if (!context.user) {
    throw new Error("You must be logged in to view payroll.");
  }

  if (!context.currentOrganization) {
    throw new Error("Create an organization before using payroll.");
  }

  if (!context.currentSalon) {
    throw new Error("Please select a salon before using payroll.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const [canManagePayroll, canViewPayroll, canViewTaxCompany, linkedStaffId] =
    await Promise.all([
      hasPermission(PAYROLL_PERMISSIONS.manage, context),
      hasPermission(PAYROLL_PERMISSIONS.view, context),
      hasPermission(PAYROLL_PERMISSIONS.taxCompany, context),
      getLinkedCurrentStaffId(context, supabase),
    ]);
  const canViewAllPayroll = canManagePayroll || canViewPayroll;
  const canOpen = options.taxCompanyOnly
    ? canViewAllPayroll || canViewTaxCompany
    : canViewAllPayroll || Boolean(linkedStaffId);

  if (!canOpen) {
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
  let query = auth.supabase
    .from("staff")
    .select(STAFF_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .order("display_name", { ascending: true });

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    query = query.eq("id", auth.access.linkedStaffId);
  }

  const { data, error } = await query.returns<Staff[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadStaffPayrollSettings(auth: PayrollAuthContext) {
  let query = auth.supabase
    .from("staff_payroll_settings")
    .select(STAFF_PAYROLL_SETTING_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .order("effective_from", { ascending: false });

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    query = query.eq("staff_id", auth.access.linkedStaffId);
  }

  const { data, error } = await query.returns<StaffPayrollSetting[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadPayrollPeriodStaffInputs(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
) {
  let query = auth.supabase
    .from("payroll_period_staff_inputs")
    .select(PAYROLL_PERIOD_STAFF_INPUT_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("period_start", period.startDate)
    .eq("period_end", period.endDate);

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    query = query.eq("staff_id", auth.access.linkedStaffId);
  }

  const { data, error } = await query.returns<PayrollPeriodStaffInput[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((input) => ({
    ...input,
    bonus_amount: numberValue(input.bonus_amount),
  }));
}

function latestSettingsWithStaff(
  staffRows: Staff[],
  settings: StaffPayrollSetting[],
): StaffPayrollSettingWithStaff[] {
  const settingMap = settingsByStaffId(settings);

  return staffRows.map((staff) => ({
    history: settingMap.get(staff.id) ?? [],
    setting: settingMap.get(staff.id)?.[0] ?? null,
    staff,
  }));
}

async function loadStaffEarningsForPeriod(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
) {
  let query = auth.supabase
    .from("pos_ticket_staff_earnings")
    .select(
      "ticket_id, staff_id, work_date, service_total, tip_amount, tip_is_manual, manual_tip_amount",
    )
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("work_date", period.startDate)
    .lte("work_date", period.endDate);

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    query = query.eq("staff_id", auth.access.linkedStaffId);
  }

  const { data, error } = await query.returns<StaffEarningRow[]>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function loadFinancialAdjustmentDeltasByStaffDate(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
) {
  let query = auth.supabase
    .from("pos_financial_adjustments")
    .select("business_date, staff_id, service_delta, tip_delta")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("business_date", period.startDate)
    .lte("business_date", period.endDate)
    .not("staff_id", "is", null);

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    query = query.eq("staff_id", auth.access.linkedStaffId);
  }

  const { data, error } = await query.returns<
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

function extractStaffIdFromCorrectionJson(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const correctionRows = Array.isArray(record.corrections)
    ? record.corrections
    : [];
  const nestedStaffIds = new Set<string>();

  for (const row of correctionRows) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const correction = row as Record<string, unknown>;
    const oldValue =
      correction.oldValue && typeof correction.oldValue === "object"
        ? (correction.oldValue as Record<string, unknown>)
        : null;
    const requestedValue =
      correction.requestedValue && typeof correction.requestedValue === "object"
        ? (correction.requestedValue as Record<string, unknown>)
        : null;
    const candidates = [
      correction.staffId,
      correction.staff_id,
      oldValue?.staffId,
      oldValue?.staff_id,
      requestedValue?.staffId,
      requestedValue?.staff_id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate) {
        nestedStaffIds.add(candidate);
      }
    }
  }

  if (nestedStaffIds.size === 1) {
    return Array.from(nestedStaffIds)[0];
  }

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

function summarizeCorrectionValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
  } catch {
    return null;
  }
}

function serializeCorrectionValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value || null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

async function loadPayrollUserLabels(auth: PayrollAuthContext, userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));

  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await auth.supabase
    .from("users")
    .select("id, display_name, email")
    .in("id", ids)
    .returns<Array<{ display_name: string | null; email: string | null; id: string }>>();

  if (error) {
    throw new Error(error.message);
  }

  return new Map(
    (data ?? []).map((user) => [
      user.id,
      user.display_name ?? user.email ?? user.id,
    ]),
  );
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
    .select(
      "id, ticket_id, action, reason, before_snapshot, after_snapshot, created_by, created_at",
    )
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

  const userLabels = await loadPayrollUserLabels(
    auth,
    (adjustments ?? []).map((adjustment) => adjustment.created_by),
  );

  return (adjustments ?? []).map<PayrollCorrectionListItem>((adjustment) => {
    const ticket = ticketById.get(adjustment.ticket_id);

    return {
      businessDate: ticket?.opened_at.slice(0, 10) ?? period.startDate,
      changedById: adjustment.created_by,
      correctionDate: adjustment.created_at,
      correctionRequestId: null,
      delta: null,
      id: adjustment.id,
      changedByName: userLabels.get(adjustment.created_by) ?? adjustment.created_by,
      newValue: summarizeCorrectionValue(adjustment.after_snapshot),
      oldValue: summarizeCorrectionValue(adjustment.before_snapshot),
      rawNewValue: serializeCorrectionValue(adjustment.after_snapshot),
      rawOldValue: serializeCorrectionValue(adjustment.before_snapshot),
      source: "ticket_adjustment",
      staffId: null,
      staffName: null,
      status: "recorded",
      ticketId: adjustment.ticket_id,
      ticketNumber: ticket?.ticket_number ?? null,
      note: adjustment.reason,
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
        "id, business_date, target_type, target_id, correction_type, old_value_json, requested_value_json, money_delta, reason, admin_note, status, requested_by, requested_at",
      )
      .eq("organization_id", auth.organization.id)
      .eq("salon_id", auth.salon.id)
      .gte("business_date", period.startDate)
      .lte("business_date", period.endDate)
      .returns<FinancialCorrectionRequestRow[]>(),
    auth.supabase
      .from("pos_financial_adjustments")
      .select(
        "id, business_date, correction_request_id, target_type, target_id, staff_id, ticket_id, service_delta, tip_delta, expected_total_delta, actual_total_delta, note, created_by, created_at",
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

  const userLabels = await loadPayrollUserLabels(auth, [
    ...(requestsResult.data ?? []).map((request) => request.requested_by),
    ...(adjustmentsResult.data ?? []).map((adjustment) => adjustment.created_by),
  ]);
  const requests = (requestsResult.data ?? []).map<PayrollCorrectionListItem>(
    (request) => {
      const staffId = extractStaffIdFromCorrectionJson(request.requested_value_json);

      return {
        businessDate: request.business_date,
        changedById: request.requested_by,
        correctionDate: request.requested_at,
        correctionRequestId: request.id,
        delta: numberValue(request.money_delta),
        id: request.id,
        changedByName: userLabels.get(request.requested_by) ?? request.requested_by,
        note: request.admin_note?.trim() || request.reason?.trim() || null,
        newValue: summarizeCorrectionValue(request.requested_value_json),
        oldValue: summarizeCorrectionValue(request.old_value_json),
        rawNewValue: serializeCorrectionValue(request.requested_value_json),
        rawOldValue: serializeCorrectionValue(request.old_value_json),
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
        numberValue(adjustment.actual_total_delta) +
          numberValue(adjustment.expected_total_delta),
      );

      return {
        businessDate: adjustment.business_date,
        changedById: adjustment.created_by,
        correctionDate: adjustment.created_at,
        correctionRequestId: adjustment.correction_request_id,
        delta,
        id: adjustment.id,
        changedByName:
          userLabels.get(adjustment.created_by) ?? adjustment.created_by,
        note: adjustment.note?.trim() || null,
        newValue: null,
        oldValue: null,
        rawNewValue: null,
        rawOldValue: null,
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

function calculateDailyPayroll(input: {
  businessDate: string;
  correctionDelta: number;
  earning: DailyEarningAccumulator | undefined;
  fixedDailyAmount: number;
  organizationId: string;
  payrollRunId: string;
  salonId: string;
  setting: StaffPayrollSetting;
  staffId: string;
}) {
  const grossSales = roundMoney(numberValue(input.earning?.grossSales));
  const tipAmount = roundMoney(numberValue(input.earning?.tipAmount));
  const commissionRate = numberValue(input.setting.commission_rate);
  const checkRate = numberValue(input.setting.check_rate);
  const taxRate = numberValue(input.setting.tax_rate);
  const commissionPay =
    input.setting.pay_type === "commission"
      ? roundMoney((grossSales * commissionRate) / 100)
      : 0;
  const fixedPay =
    input.setting.pay_type === "fixed" ? roundMoney(input.fixedDailyAmount) : 0;
  const staffPay = roundMoney(commissionPay + fixedPay);
  const checkGross = roundMoney((staffPay * checkRate) / 100);
  const cashAmount = roundMoney(staffPay - checkGross);
  const taxCash = Boolean(input.setting.cash_to_tax_company);
  const reporting = calculateTaxCompanyReporting({
    bonusAmount: 0,
    bonusPayoutMethod: input.setting.bonus_payout_method,
    staffCommissionGross:
      input.setting.pay_type === "fixed" && !input.setting.apply_tax_to_fixed_pay
        ? 0
        : staffPay,
    taxBonus: false,
    taxCash,
    taxRate,
    taxTips: Boolean(input.setting.tax_tips),
    tipAmount,
    tipPayoutMethod: input.setting.tip_payout_method,
    wageCashGross:
      input.setting.pay_type === "fixed" && !input.setting.apply_tax_to_fixed_pay
        ? 0
        : cashAmount,
    wageCheckGross:
      input.setting.pay_type === "fixed" && !input.setting.apply_tax_to_fixed_pay
        ? 0
        : checkGross,
  });
  const payTaxWithheld = roundMoney(
    (reporting.reportedWageGross * taxRate) / 100,
  );
  const taxWithheld = reporting.taxAmount;
  const checkNet = reporting.wageCheckNet;

  return {
    baseCashAmount: cashAmount,
    baseCheckAmount: checkNet,
    cashAmount,
    checkGross,
    checkNet,
    dailyTotal: {
      business_date: input.businessDate,
      check_rate_used: checkRate,
      commission_rate_used:
        input.setting.pay_type === "commission" ? commissionRate : 0,
      correction_delta: roundMoney(input.correctionDelta),
      created_at: new Date().toISOString(),
      fixed_pay_amount_used: fixedPay,
      gross_sales: grossSales,
      id: `live-${input.staffId}-${input.businessDate}`,
      note: null,
      organization_id: input.organizationId,
      pay_type_used: input.setting.pay_type,
      payroll_run_id: input.payrollRunId,
      salon_id: input.salonId,
      settings_used_snapshot: serializeSetting(input.setting),
      staff_id: input.staffId,
      tax_rate_used: taxRate,
      tip_amount: tipAmount,
      updated_at: new Date().toISOString(),
    },
    payTaxWithheld,
    setting: input.setting,
    staffPay,
    taxCompanyCashReported: reporting.cashReported,
    taxCompanyReportedWageGross: reporting.reportedWageGross,
    taxCompanyTaxableGross: reporting.taxableGross,
    tipCashAmount: reporting.tipPaidByCash,
    tipCheckAmount: reporting.tipPaidByCheck,
    taxWithheld,
  } satisfies DailyPayrollResult;
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
      (line) => isTaxCompanyReportableLine(line) && !line.paystub,
    ).length,
    totalBonus: sum((line) => numberValue(line.bonus_amount)),
    totalCashPayout: sum((line) => numberValue(line.final_cash_amount)),
    totalCheckGross: sum((line) => numberValue(line.check_gross)),
    totalCheckNet: sum((line) => numberValue(line.final_check_amount)),
    totalFinalStaffIncome: sum((line) => numberValue(line.final_staff_income)),
    totalPosIncome: sum(
      (line) => numberValue(line.gross_sales) + numberValue(line.tip_amount),
    ),
    totalShopShare: sum((line) => numberValue(line.shop_share)),
    totalStaffCommissionPayout: sum((line) =>
      numberValue(line.staff_commission_gross),
    ),
    totalStaffGrossProduction: sum((line) => numberValue(line.gross_sales)),
    totalTaxWithheld: sum((line) => numberValue(line.tax_withheld)),
    totalTaxCompanyAmount: sum(
      (line) =>
        numberValue(line.tax_company_check_amount) +
        numberValue(line.tax_company_cash_amount),
    ),
    totalTaxCompanyCashAmount: sum((line) =>
      numberValue(line.tax_company_cash_amount),
    ),
    totalTaxCompanyCheckAmount: sum((line) =>
      numberValue(line.tax_company_check_amount),
    ),
    totalTaxCompanyReportedWageGross: sum((line) =>
      numberValue(line.tax_company_reported_wage_gross),
    ),
    totalTaxCompanyTaxableGross: sum((line) =>
      numberValue(line.tax_company_taxable_gross),
    ),
    totalTip: sum((line) => numberValue(line.tip_amount)),
  } satisfies PayrollSummary;
}

function settingSnapshotRecords(snapshot: unknown) {
  const snapshots = Array.isArray(snapshot) ? snapshot : [snapshot];

  return snapshots.filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
}

function lineHasPayrollData(line: PayrollStaffLineWithDailyTotals) {
  return [
    line.bonus_amount,
    line.check_gross,
    line.final_cash_amount,
    line.final_check_amount,
    line.gross_sales,
    line.staff_commission_gross,
    line.tax_withheld,
    line.tip_amount,
  ].some((value) => moneyChanged(numberValue(value), 0));
}

function lineHasTaxRate(line: PayrollStaffLineWithDailyTotals) {
  if (numberValue(line.tax_rate_used) > 0) {
    return true;
  }

  return settingSnapshotRecords(line.settings_used_snapshot).some(
    (snapshot) => numberValue(snapshot.taxRate as number | string | null) > 0,
  );
}

function lineHasTaxFixed(line: PayrollStaffLineWithDailyTotals) {
  const records = settingSnapshotRecords(line.settings_used_snapshot);
  const matchedSnapshot = records.some(
    (snapshot) =>
      snapshot.payType === "fixed" &&
      (typeof snapshot.applyTaxToFixedPay === "boolean"
        ? snapshot.applyTaxToFixedPay
        : true),
  );

  if (records.length > 0) {
    return matchedSnapshot;
  }

  return line.pay_type_used === "fixed";
}

function isTaxCompanyReportableLine(line: PayrollStaffLineWithDailyTotals) {
  if (!lineHasPayrollData(line)) {
    return false;
  }

  return (
    numberValue(line.tax_company_taxable_gross) > 0 ||
    moneyChanged(numberValue(line.final_check_amount), 0) ||
    numberValue(line.tax_withheld) > 0 ||
    lineHasTaxRate(line) ||
    lineHasTaxFixed(line) ||
    Boolean(line.tax_tips_snapshot) ||
    Boolean(line.tax_bonus_snapshot) ||
    Boolean(line.cash_to_tax_company_snapshot)
  );
}

function attachStatementPaystubsToLines(input: {
  latestStatement: PayrollStatementSnapshot | null;
  lines: PayrollStaffLineWithDailyTotals[];
}) {
  if (!input.latestStatement) {
    return input.lines;
  }

  const paystubByStaffId = new Map(
    input.latestStatement.paystubs.map((paystub) => [paystub.staff_id, paystub]),
  );

  return input.lines.map((line) => ({
    ...line,
    paystub: paystubByStaffId.get(line.staff_id) ?? line.paystub,
  }));
}

async function loadDailyClosingRows(auth: PayrollAuthContext, period: PayrollPeriod) {
  const { data, error } = await auth.supabase
    .from("pos_daily_closings")
    .select(
      "report_date, cash_amount, credit_card_amount, other_amount, status, closed_at, locked_at",
    )
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .gte("report_date", period.startDate)
    .lte("report_date", period.endDate)
    .returns<DailyClosingRow[]>();

  if (error) {
    return [];
  }

  return (data ?? []).map((row) => ({
    ...row,
    cash_amount: numberValue(row.cash_amount),
    credit_card_amount: numberValue(row.credit_card_amount),
    other_amount: numberValue(row.other_amount),
  }));
}

function dailyStaffPay(dailyTotal: PayrollStaffDailyTotal) {
  if (dailyTotal.pay_type_used === "fixed") {
    return numberValue(dailyTotal.fixed_pay_amount_used);
  }

  return roundMoney(
    (numberValue(dailyTotal.gross_sales) *
      numberValue(dailyTotal.commission_rate_used)) /
      100,
  );
}

function settingSnapshotBoolean(
  snapshot: unknown,
  key: "applyTaxToFixedPay" | "cashToTaxCompany" | "taxBonus" | "taxTips",
  fallback: boolean,
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return fallback;
  }

  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : fallback;
}

function settingSnapshotPayoutMethod(
  snapshot: unknown,
  key: "bonusPayoutMethod" | "tipPayoutMethod",
  fallback: PayrollPayoutMethod,
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return fallback;
  }

  const value = (snapshot as Record<string, unknown>)[key];
  return value === "check" || value === "cash" ? value : fallback;
}

function dailyTaxBreakdown(dailyTotal: PayrollStaffDailyTotal) {
  const staffPay = dailyStaffPay(dailyTotal);
  const checkGross = roundMoney(
    (staffPay * numberValue(dailyTotal.check_rate_used)) / 100,
  );
  const cashGross = roundMoney(staffPay - checkGross);
  const taxRate = numberValue(dailyTotal.tax_rate_used);
  const applyTaxToFixedPay = settingSnapshotBoolean(
    dailyTotal.settings_used_snapshot,
    "applyTaxToFixedPay",
    true,
  );
  const taxCash = settingSnapshotBoolean(
    dailyTotal.settings_used_snapshot,
    "cashToTaxCompany",
    false,
  );
  const taxTips = settingSnapshotBoolean(
    dailyTotal.settings_used_snapshot,
    "taxTips",
    false,
  );
  const tipPayoutMethod = settingSnapshotPayoutMethod(
    dailyTotal.settings_used_snapshot,
    "tipPayoutMethod",
    DEFAULT_TIP_PAYOUT_METHOD,
  );
  const taxableStaffPay =
    dailyTotal.pay_type_used === "fixed" && !applyTaxToFixedPay ? 0 : staffPay;
  const reporting = calculateTaxCompanyReporting({
    bonusAmount: 0,
    bonusPayoutMethod: DEFAULT_BONUS_PAYOUT_METHOD,
    staffCommissionGross: taxableStaffPay,
    taxBonus: false,
    taxCash,
    taxRate,
    taxTips,
    tipAmount: numberValue(dailyTotal.tip_amount),
    tipPayoutMethod,
    wageCashGross:
      dailyTotal.pay_type_used === "fixed" && !applyTaxToFixedPay ? 0 : cashGross,
    wageCheckGross:
      dailyTotal.pay_type_used === "fixed" && !applyTaxToFixedPay ? 0 : checkGross,
  });
  const payTaxWithheld = roundMoney(
    (reporting.reportedWageGross * taxRate) / 100,
  );
  const tipTaxWithheld = roundMoney((reporting.reportedTip * taxRate) / 100);

  return {
    payTaxWithheld,
    tipTaxWithheld,
    totalTaxWithheld: reporting.taxAmount,
  };
}

function correctionHappenedAfterClosing(
  correction: PayrollCorrectionListItem,
  closing: DailyClosingRow | undefined,
) {
  const cutoff = closing?.closed_at ?? closing?.locked_at;

  if (!cutoff) {
    return false;
  }

  return correction.correctionDate > cutoff;
}

function buildShopDailyRows(input: {
  closingRows: DailyClosingRow[];
  corrections: PayrollCorrectionListItem[];
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
}) {
  const correctionsByDate = new Map<string, PayrollCorrectionListItem[]>();

  for (const correction of input.corrections) {
    const closing = input.closingRows.find(
      (row) => row.report_date === correction.businessDate,
    );

    if (!correctionHappenedAfterClosing(correction, closing)) {
      continue;
    }

    const list = correctionsByDate.get(correction.businessDate) ?? [];
    list.push(correction);
    correctionsByDate.set(correction.businessDate, list);
  }

  const closingByDate = new Map(input.closingRows.map((row) => [row.report_date, row]));
  const rows = getDateRange(input.period.startDate, input.period.endDate).map((businessDate) => {
    let staffProduction = 0;
    let tips = 0;
    let shopShare = 0;
    let staffCommissionPay = 0;
    let staffNetPay = 0;
    let staffObligation = 0;
    let taxWithheld = 0;
    let tipsPaid = 0;

    for (const line of input.lines) {
      for (const dailyTotal of line.dailyTotals) {
        if (dailyTotal.business_date !== businessDate) {
          continue;
        }

        const staffPay = dailyStaffPay(dailyTotal);
        const taxBreakdown = dailyTaxBreakdown(dailyTotal);
        const tipAmount = numberValue(dailyTotal.tip_amount);
        staffProduction += numberValue(dailyTotal.gross_sales);
        tips += tipAmount;
        staffCommissionPay += staffPay;
        staffNetPay += staffPay - taxBreakdown.payTaxWithheld;
        tipsPaid += tipAmount - taxBreakdown.tipTaxWithheld;
        taxWithheld += taxBreakdown.totalTaxWithheld;
        staffObligation += staffPay + tipAmount;
        shopShare += numberValue(dailyTotal.gross_sales) - staffPay;
      }
    }

    const posIncome = roundMoney(staffProduction + tips);
    const closing = closingByDate.get(businessDate);
    const manualInputIncome = closing
      ? roundMoney(
          numberValue(closing.cash_amount) +
            numberValue(closing.credit_card_amount) +
            numberValue(closing.other_amount),
        )
      : null;
    const difference =
      manualInputIncome === null ? null : roundMoney(manualInputIncome - posIncome);
    const overShortStatus: PayrollShopDailyRow["overShortStatus"] =
      difference === null
        ? "no_closing_input"
        : difference < 0
          ? "short"
          : difference > 0
            ? "over"
            : "balanced";

    return {
      actualIncome: manualInputIncome,
      businessDate,
      cashAmount: closing ? numberValue(closing.cash_amount) : null,
      corrections: correctionsByDate.get(businessDate) ?? [],
      creditCardAmount: closing ? numberValue(closing.credit_card_amount) : null,
      difference,
      manualInputIncome,
      otherAmount: closing ? numberValue(closing.other_amount) : null,
      overShortStatus,
      posIncome,
      shopShare: roundMoney(shopShare),
      shopNetIncome:
        manualInputIncome === null
          ? null
          : roundMoney(manualInputIncome - staffObligation),
      staffCommissionPay: roundMoney(staffCommissionPay),
      staffNetPay: roundMoney(staffNetPay),
      staffObligation: roundMoney(staffObligation),
      staffProduction: roundMoney(staffProduction),
      taxWithheld: roundMoney(taxWithheld),
      tipsPaid: roundMoney(tipsPaid),
      tips: roundMoney(tips),
    } satisfies PayrollShopDailyRow;
  });

  return rows;
}

function buildShopSummary(rows: PayrollShopDailyRow[]) {
  const sum = (selector: (row: PayrollShopDailyRow) => number) =>
    roundMoney(rows.reduce((total, row) => total + selector(row), 0));
  const nullableSum = (selector: (row: PayrollShopDailyRow) => number | null) => {
    const values = rows.map(selector).filter((value): value is number => value !== null);
    return values.length === 0
      ? null
      : roundMoney(values.reduce((total, value) => total + value, 0));
  };

  return {
    cashAmount: nullableSum((row) => row.cashAmount),
    correctionCount: rows.reduce((total, row) => total + row.corrections.length, 0),
    creditCardAmount: nullableSum((row) => row.creditCardAmount),
    manualInputIncome: nullableSum((row) => row.manualInputIncome),
    otherAmount: nullableSum((row) => row.otherAmount),
    overShortTotal: nullableSum((row) => row.difference),
    posIncome: sum((row) => row.posIncome),
    shopShare: sum((row) => row.shopShare),
    shopNetIncome: nullableSum((row) => row.shopNetIncome),
    staffCommissionPay: sum((row) => row.staffCommissionPay),
    staffNetPay: sum((row) => row.staffNetPay),
    totalStaffObligation: sum((row) => row.staffObligation),
    staffProduction: sum((row) => row.staffProduction),
    taxWithheld: sum((row) => row.taxWithheld),
    tipsPaid: sum((row) => row.tipsPaid),
    tips: sum((row) => row.tips),
    totalActualIncome: nullableSum((row) => row.actualIncome),
  } satisfies PayrollShopSummary;
}

async function calculateLivePayrollForAuth(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
): Promise<PayrollLiveSnapshot> {
  const [staffRows, staffSettings, earnings, correctionDeltas, periodInputs] =
    await Promise.all([
      loadStaffRows(auth),
      loadStaffPayrollSettings(auth),
      loadStaffEarningsForPeriod(auth, period),
      loadFinancialAdjustmentDeltasByStaffDate(auth, period),
      loadPayrollPeriodStaffInputs(auth, period),
    ]);
  const staffById = new Map(staffRows.map((staff) => [staff.id, staff]));
  const settingMap = settingsByStaffId(staffSettings);
  const inputByStaffId = new Map(periodInputs.map((input) => [input.staff_id, input]));
  const dailyEarningsByStaffDate = new Map<string, DailyEarningAccumulator>();
  const hasManualTipByStaffId = new Map<string, boolean>();
  const staffIds = new Set<string>();

  for (const earning of earnings) {
    const staffId = earning.staff_id;
    staffIds.add(staffId);
    hasManualTipByStaffId.set(
      staffId,
      Boolean(hasManualTipByStaffId.get(staffId) || earning.tip_is_manual),
    );

    const dailyKey = `${staffId}:${earning.work_date}`;
    const daily = dailyEarningsByStaffDate.get(dailyKey) ?? {
      grossSales: 0,
      hasManualTip: false,
      tipAmount: 0,
    };
    daily.grossSales = roundMoney(daily.grossSales + numberValue(earning.service_total));
    daily.tipAmount = roundMoney(daily.tipAmount + numberValue(earning.tip_amount));
    daily.hasManualTip = Boolean(daily.hasManualTip || earning.tip_is_manual);
    dailyEarningsByStaffDate.set(dailyKey, daily);
  }

  for (const input of periodInputs) {
    if (
      numberValue(input.bonus_amount) > 0 ||
      Boolean(input.check_number?.trim()) ||
      Boolean(input.note?.trim())
    ) {
      staffIds.add(input.staff_id);
    }
  }

  for (const setting of staffSettings) {
    if (
      settingOverlapsPeriod(setting, period) &&
      (setting.pay_type === "fixed" || isTaxCompanyReportableSetting(setting))
    ) {
      staffIds.add(setting.staff_id);
    }
  }

  for (const staff of staffRows) {
    const latestSetting = latestSettingForPeriod({
      organizationId: auth.organization.id,
      period,
      salonId: auth.salon.id,
      settingsByStaffId: settingMap,
      staff,
      staffId: staff.id,
    });

    if (
      staff.is_active &&
      (latestSetting.pay_type === "fixed" ||
        isTaxCompanyReportableSetting(latestSetting))
    ) {
      staffIds.add(staff.id);
    }
  }

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    for (const staffId of Array.from(staffIds)) {
      if (staffId !== auth.access.linkedStaffId) {
        staffIds.delete(staffId);
      }
    }
  }

  const periodDates = getDateRange(period.startDate, period.endDate);
  const lines: PayrollStaffLineWithDailyTotals[] = [];

  for (const staffId of Array.from(staffIds)) {
    const staff = staffById.get(staffId);
    const input = inputByStaffId.get(staffId) ?? null;
    const latestSetting = latestSettingForPeriod({
      organizationId: auth.organization.id,
      period,
      salonId: auth.salon.id,
      settingsByStaffId: settingMap,
      staff,
      staffId,
    });
    const dailyResults: DailyPayrollResult[] = [];
    const settingSignatures = new Set<string>();
    const payTypes = new Set<StaffPayType>();
    const commissionRates = new Set<number>();
    const checkRates = new Set<number>();
    const taxRates = new Set<number>();
    const tipPayoutMethods = new Set<PayrollPayoutMethod>();
    const cashToTaxCompanyValues = new Set<boolean>();
    const taxTipsValues = new Set<boolean>();
    let grossSales = 0;
    let tipAmount = 0;
    let staffPay = 0;
    let fixedPayAmount = 0;
    let checkGross = 0;
    let baseCashAmount = 0;
    let tipCheckAmount = 0;
    let tipCashAmount = 0;
    let taxWithheld = 0;
    let taxCompanyCashReported = 0;
    let taxCompanyReportedWageGross = 0;
    let taxCompanyTaxableGross = 0;

    for (const businessDate of periodDates) {
      const setting = pickEffectiveSetting({
        businessDate,
        organizationId: auth.organization.id,
        salonId: auth.salon.id,
        settingsByStaffId: settingMap,
        staff,
        staffId,
      });
      const dailyKey = `${staffId}:${businessDate}`;
      const earning = dailyEarningsByStaffDate.get(dailyKey);
      const fixedDailyAmount =
        setting.pay_type === "fixed"
          ? numberValue(setting.fixed_pay_amount) / periodDates.length
          : 0;
      const correctionDelta = correctionDeltas.get(dailyKey) ?? 0;
      const shouldIncludeDaily =
        Boolean(earning) ||
        numberValue(correctionDelta) !== 0 ||
        numberValue(fixedDailyAmount) > 0;

      if (!shouldIncludeDaily) {
        continue;
      }

      const dailyResult = calculateDailyPayroll({
        businessDate,
        correctionDelta,
        earning,
        fixedDailyAmount,
        organizationId: auth.organization.id,
        payrollRunId: "",
        salonId: auth.salon.id,
        setting,
        staffId,
      });
      dailyResults.push(dailyResult);
      settingSignatures.add(settingSignature(setting));
      payTypes.add(setting.pay_type);
      checkRates.add(numberValue(setting.check_rate));
      taxRates.add(numberValue(setting.tax_rate));
      tipPayoutMethods.add(setting.tip_payout_method);
      cashToTaxCompanyValues.add(Boolean(setting.cash_to_tax_company));
      taxTipsValues.add(Boolean(setting.tax_tips));

      if (setting.pay_type === "commission") {
        commissionRates.add(numberValue(setting.commission_rate));
      }

      grossSales += dailyResult.dailyTotal.gross_sales;
      tipAmount += dailyResult.dailyTotal.tip_amount;
      staffPay += dailyResult.staffPay;
      fixedPayAmount += numberValue(dailyResult.dailyTotal.fixed_pay_amount_used);
      checkGross += dailyResult.checkGross;
      baseCashAmount += dailyResult.baseCashAmount;
      tipCheckAmount += dailyResult.tipCheckAmount;
      tipCashAmount += dailyResult.tipCashAmount;
      taxWithheld += dailyResult.taxWithheld;
      taxCompanyCashReported += dailyResult.taxCompanyCashReported;
      taxCompanyReportedWageGross += dailyResult.taxCompanyReportedWageGross;
      taxCompanyTaxableGross += dailyResult.taxCompanyTaxableGross;
    }

    if (dailyResults.length === 0) {
      settingSignatures.add(settingSignature(latestSetting));
      payTypes.add(latestSetting.pay_type);
      checkRates.add(numberValue(latestSetting.check_rate));
      taxRates.add(numberValue(latestSetting.tax_rate));
      tipPayoutMethods.add(latestSetting.tip_payout_method);
      cashToTaxCompanyValues.add(Boolean(latestSetting.cash_to_tax_company));
      taxTipsValues.add(Boolean(latestSetting.tax_tips));

      if (latestSetting.pay_type === "commission") {
        commissionRates.add(numberValue(latestSetting.commission_rate));
      }
    }

    const bonusAmount = roundMoney(numberValue(input?.bonus_amount));
    const bonusPayoutMethod = latestSetting.bonus_payout_method;
    const bonusCheckAmount = bonusPayoutMethod === "check" ? bonusAmount : 0;
    const bonusCashAmount = bonusPayoutMethod === "cash" ? bonusAmount : 0;
    const taxBonus = Boolean(latestSetting.tax_bonus);
    const reportedBonus = taxBonus ? bonusAmount : 0;
    const bonusTaxWithheld = roundMoney(
      (reportedBonus * numberValue(latestSetting.tax_rate)) / 100,
    );
    const taxFixedReportable =
      dailyResults.some(
        (result) =>
          result.setting.pay_type === "fixed" &&
          Boolean(result.setting.apply_tax_to_fixed_pay),
      ) ||
      (dailyResults.length === 0 &&
        latestSetting.pay_type === "fixed" &&
        Boolean(latestSetting.apply_tax_to_fixed_pay));
    const cashToTaxCompany = cashToTaxCompanyValues.has(true);
    const shouldIncludeLine =
      grossSales !== 0 ||
      tipAmount !== 0 ||
      staffPay !== 0 ||
      bonusAmount !== 0 ||
      Boolean(input?.check_number?.trim()) ||
      Boolean(input?.note?.trim());

    if (!shouldIncludeLine) {
      continue;
    }

    const isMixedRate =
      settingSignatures.size > 1 ||
      payTypes.size > 1 ||
      checkRates.size > 1 ||
      taxRates.size > 1;
    const payTypeUsed = payTypes.size === 1 ? Array.from(payTypes)[0] : latestSetting.pay_type;
    const staffCommissionGross = roundMoney(staffPay);
    const roundedCheckGross = roundMoney(checkGross);
    const roundedTaxWithheld = roundMoney(taxWithheld + bonusTaxWithheld);
    const roundedBaseCheckAmount = roundMoney(roundedCheckGross - roundedTaxWithheld);
    const roundedBaseCashAmount = roundMoney(baseCashAmount);
    const roundedTip = roundMoney(tipAmount);
    const roundedTipCheckAmount = roundMoney(tipCheckAmount);
    const roundedTipCashAmount = roundMoney(tipCashAmount);
    const roundedBonusCheckAmount = roundMoney(bonusCheckAmount);
    const roundedBonusCashAmount = roundMoney(bonusCashAmount);
    const reportedWageGross = roundMoney(taxCompanyReportedWageGross);
    const taxableGross = roundMoney(
      taxCompanyTaxableGross + reportedBonus,
    );
    const roundedCashReported = roundMoney(
      taxCompanyCashReported +
        (taxBonus && bonusPayoutMethod === "cash" ? bonusAmount : 0),
    );
    const finalCheckAmount = roundMoney(
      roundedCheckGross +
        roundedTipCheckAmount +
        roundedBonusCheckAmount -
        roundedTaxWithheld,
    );
    const finalCashAmount = roundMoney(
      roundedBaseCashAmount + roundedTipCashAmount + roundedBonusCashAmount,
    );
    const finalStaffIncome = roundMoney(finalCheckAmount + finalCashAmount);
    const earnedAmount = roundMoney(staffCommissionGross + roundedTip + bonusAmount);
    const hasPayrollData = [
      bonusAmount,
      finalCashAmount,
      finalCheckAmount,
      grossSales,
      roundedCheckGross,
      roundedTaxWithheld,
      roundedTip,
      staffCommissionGross,
    ].some((value) => moneyChanged(value, 0));
    const hasTaxRate = Array.from(taxRates).some((taxRate) => taxRate > 0);
    const taxCompanyReportable =
      hasPayrollData &&
      (taxableGross > 0 ||
        moneyChanged(finalCheckAmount, 0) ||
        roundedTaxWithheld > 0 ||
        hasTaxRate ||
        taxFixedReportable ||
        taxTipsValues.has(true) ||
        taxBonus ||
        cashToTaxCompany);
    const taxCompanyCheckAmount = taxCompanyReportable ? finalCheckAmount : 0;
    const taxCompanyCashAmount = taxCompanyReportable ? roundedCashReported : 0;
    const tipPayoutMethodSnapshot =
      tipPayoutMethods.size === 1
        ? Array.from(tipPayoutMethods)[0]
        : latestSetting.tip_payout_method;
    const settingsUsedSnapshot =
      dailyResults.length > 0
        ? dailyResults.map((result) => serializeSetting(result.setting))
        : [serializeSetting(latestSetting)];

    lines.push({
      base_cash_amount: roundedBaseCashAmount,
      base_check_amount: roundedBaseCheckAmount,
      bonus_amount: bonusAmount,
      bonus_cash_amount: roundedBonusCashAmount,
      bonus_check_amount: roundedBonusCheckAmount,
      bonus_payout_method_snapshot: bonusPayoutMethod,
      cash_amount: finalCashAmount,
      cash_to_tax_company_snapshot: cashToTaxCompany,
      check_gross: roundedCheckGross,
      check_net: roundedBaseCheckAmount,
      check_number: input?.check_number?.trim() || null,
      check_rate_used: isMixedRate ? 0 : Array.from(checkRates)[0] ?? 0,
      commission_rate_used:
        !isMixedRate && payTypeUsed === "commission"
          ? Array.from(commissionRates)[0] ?? 0
          : 0,
      created_at: new Date().toISOString(),
      dailyTotals: dailyResults
        .map((result) => result.dailyTotal)
        .sort((left, right) => left.business_date.localeCompare(right.business_date)),
      earned_amount: earnedAmount,
      final_cash_amount: finalCashAmount,
      final_check_amount: finalCheckAmount,
      final_staff_income: finalStaffIncome,
      fixed_pay_amount_used: roundMoney(fixedPayAmount),
      gross_sales: roundMoney(grossSales),
      id: `live-${staffId}`,
      input,
      is_mixed_rate: isMixedRate,
      note: input?.note?.trim() || null,
      organization_id: auth.organization.id,
      pay_type_used: payTypeUsed,
      payroll_run_id: "",
      paystub: null,
      period_staff_input_snapshot: serializeInput(input),
      salon_id: auth.salon.id,
      settings_used_snapshot: settingsUsedSnapshot,
      shop_share: roundMoney(grossSales - staffCommissionGross),
      staff_commission_gross: staffCommissionGross,
      staff_display_name_snapshot: getStaffName(staff, staffId),
      staff_id: staffId,
      staff_legal_name_snapshot: getLegalName(latestSetting),
      tax_bonus_snapshot: taxBonus,
      tax_company_cash_amount: taxCompanyCashAmount,
      tax_company_check_amount: taxCompanyCheckAmount,
      tax_company_enabled_snapshot: taxCompanyReportable,
      tax_company_reported_wage_gross: reportedWageGross,
      tax_company_taxable_gross: taxableGross,
      tax_rate_used: isMixedRate ? 0 : Array.from(taxRates)[0] ?? 0,
      tax_tips_snapshot: taxTipsValues.has(true),
      tax_withheld: roundedTaxWithheld,
      tip_allocation_method: getTipAllocationMethod({
        hasManualTip: Boolean(hasManualTipByStaffId.get(staffId)),
        tipAmount: roundedTip,
      }),
      tip_amount: roundedTip,
      tip_cash_amount: roundedTipCashAmount,
      tip_check_amount: roundedTipCheckAmount,
      tip_payout_method_snapshot: tipPayoutMethodSnapshot,
      updated_at: new Date().toISOString(),
    });
  }

  lines.sort((left, right) =>
    left.staff_display_name_snapshot.localeCompare(right.staff_display_name_snapshot),
  );

  const [corrections, closingRows] = await Promise.all([
    loadPayrollCorrections(auth, period, staffById),
    loadDailyClosingRows(auth, period),
  ]);
  const shopDailyRows = buildShopDailyRows({
    closingRows,
    corrections,
    lines,
    period,
  });

  return {
    corrections,
    lines,
    periodInputs,
    shopDailyRows,
    shopSummary: buildShopSummary(shopDailyRows),
    summary: calculateSummary({ corrections, lines }),
  };
}

export async function calculateLivePayroll(period: PayrollPeriod) {
  const auth = await requirePayrollContext();
  return calculateLivePayrollForAuth(auth, period);
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
    throw new Error("Payroll statement was not found.");
  }

  return data;
}

async function loadLatestPayrollRun(auth: PayrollAuthContext, period: PayrollPeriod) {
  const { data, error } = await auth.supabase
    .from("payroll_runs")
    .select(PAYROLL_RUN_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("period_start", period.startDate)
    .eq("period_end", period.endDate)
    .in("status", ["printed", "paid"])
    .order("version", { ascending: false })
    .order("printed_at", { ascending: false })
    .limit(1)
    .maybeSingle<PayrollRun>();

  if (error) {
    throw new Error(error.message);
  }

  return data ?? null;
}

async function loadPayrollLines(
  auth: PayrollAuthContext,
  run: PayrollRun,
) {
  let query = auth.supabase
    .from("payroll_staff_lines")
    .select(PAYROLL_STAFF_LINE_SELECT)
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id)
    .order("staff_display_name_snapshot", { ascending: true });

  if (
    !auth.access.canViewAllPayroll &&
    !auth.access.canViewTaxCompany &&
    auth.access.linkedStaffId
  ) {
    query = query.eq("staff_id", auth.access.linkedStaffId);
  }

  const { data, error } = await query.returns<PayrollStaffLine[]>();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((line) => ({
    ...line,
    base_cash_amount: numberValue(line.base_cash_amount),
    base_check_amount: numberValue(line.base_check_amount),
    bonus_amount: numberValue(line.bonus_amount),
    bonus_cash_amount: numberValue(line.bonus_cash_amount),
    bonus_check_amount: numberValue(line.bonus_check_amount),
    cash_amount: numberValue(line.cash_amount),
    check_gross: numberValue(line.check_gross),
    check_net: numberValue(line.check_net),
    check_rate_used: numberValue(line.check_rate_used),
    commission_rate_used: numberValue(line.commission_rate_used),
    earned_amount: numberValue(line.earned_amount),
    final_cash_amount: numberValue(line.final_cash_amount),
    final_check_amount: numberValue(line.final_check_amount),
    final_staff_income: numberValue(line.final_staff_income),
    fixed_pay_amount_used: numberValue(line.fixed_pay_amount_used),
    gross_sales: numberValue(line.gross_sales),
    shop_share: numberValue(line.shop_share),
    staff_commission_gross: numberValue(line.staff_commission_gross),
    tax_company_cash_amount: numberValue(line.tax_company_cash_amount),
    tax_company_check_amount: numberValue(line.tax_company_check_amount),
    tax_company_reported_wage_gross: numberValue(
      line.tax_company_reported_wage_gross,
    ),
    tax_company_taxable_gross: numberValue(line.tax_company_taxable_gross),
    tax_rate_used: numberValue(line.tax_rate_used),
    tax_withheld: numberValue(line.tax_withheld),
    tip_amount: numberValue(line.tip_amount),
    tip_cash_amount: numberValue(line.tip_cash_amount),
    tip_check_amount: numberValue(line.tip_check_amount),
  }));
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

  return (data ?? []).map((dailyTotal) => ({
    ...dailyTotal,
    check_rate_used:
      dailyTotal.check_rate_used === null
        ? null
        : numberValue(dailyTotal.check_rate_used),
    commission_rate_used:
      dailyTotal.commission_rate_used === null
        ? null
        : numberValue(dailyTotal.commission_rate_used),
    correction_delta: numberValue(dailyTotal.correction_delta),
    fixed_pay_amount_used:
      dailyTotal.fixed_pay_amount_used === null
        ? null
        : numberValue(dailyTotal.fixed_pay_amount_used),
    gross_sales: numberValue(dailyTotal.gross_sales),
    tax_rate_used:
      dailyTotal.tax_rate_used === null ? null : numberValue(dailyTotal.tax_rate_used),
    tip_amount: numberValue(dailyTotal.tip_amount),
  }));
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

  return Promise.all(
    (data ?? []).map(async (paystub) => ({
      ...paystub,
      view_url: await createPaystubViewUrl(auth, paystub.file_url_or_path),
    })),
  );
}

async function createPaystubViewUrl(
  auth: PayrollAuthContext,
  fileUrlOrPath: string | null,
) {
  if (!fileUrlOrPath) {
    return null;
  }

  if (/^https?:\/\//i.test(fileUrlOrPath)) {
    return fileUrlOrPath;
  }

  const { data, error } = await auth.supabase.storage
    .from(PAYROLL_PAYSTUB_BUCKET)
    .createSignedUrl(fileUrlOrPath, 60 * 60);

  if (error) {
    return null;
  }

  return data.signedUrl;
}

async function loadPayrollSnapshot(
  auth: PayrollAuthContext,
  run: PayrollRun,
): Promise<PayrollStatementSnapshot> {
  const lines = await loadPayrollLines(auth, run);
  const staffIds = lines.map((line) => line.staff_id);
  const [dailyTotals, paystubs] = await Promise.all([
    loadPayrollDailyTotals(auth, run, staffIds),
    loadPayrollPaystubs(auth, run, staffIds),
  ]);
  const dailyTotalsByStaffId = new Map<string, PayrollStaffDailyTotal[]>();
  const paystubByStaffId = new Map<string, PayrollPaystub>();

  for (const dailyTotal of dailyTotals) {
    const list = dailyTotalsByStaffId.get(dailyTotal.staff_id) ?? [];
    list.push(dailyTotal);
    dailyTotalsByStaffId.set(dailyTotal.staff_id, list);
  }

  for (const paystub of paystubs) {
    paystubByStaffId.set(paystub.staff_id, paystub);
  }

  const corrections = Array.isArray(run.correction_snapshot)
    ? (run.correction_snapshot as PayrollCorrectionListItem[])
    : [];
  const statementSettings =
    run.settings_snapshot &&
    typeof run.settings_snapshot === "object" &&
    !Array.isArray(run.settings_snapshot)
      ? (run.settings_snapshot as {
          shopDailyRows?: unknown;
          shopSummary?: unknown;
        })
      : {};
  const shopDailyRows = Array.isArray(statementSettings.shopDailyRows)
    ? (statementSettings.shopDailyRows as PayrollShopDailyRow[])
    : [];
  const shopSummary =
    statementSettings.shopSummary &&
    typeof statementSettings.shopSummary === "object" &&
    !Array.isArray(statementSettings.shopSummary)
      ? (statementSettings.shopSummary as PayrollShopSummary)
      : null;
  const linesWithDetails = lines.map<PayrollStaffLineWithDailyTotals>((line) => ({
    ...line,
    dailyTotals: dailyTotalsByStaffId.get(line.staff_id) ?? [],
    input: null,
    paystub: paystubByStaffId.get(line.staff_id) ?? null,
  }));

  return {
    lines: linesWithDetails,
    paystubs,
    run,
    shopDailyRows,
    shopSummary,
    summary: calculateSummary({ corrections, lines: linesWithDetails }),
  };
}

async function loadLatestPayrollSnapshot(
  auth: PayrollAuthContext,
  period: PayrollPeriod,
) {
  const run = await loadLatestPayrollRun(auth, period);

  if (!run) {
    return null;
  }

  return loadPayrollSnapshot(auth, run);
}

async function buildTaxCompanyLinesForAuth(input: {
  auth: PayrollAuthContext;
  latestStatement?: PayrollStatementSnapshot | null;
  live?: PayrollLiveSnapshot;
  period: PayrollPeriod;
}) {
  const [live, latestStatement] = await Promise.all([
    input.live ?? calculateLivePayrollForAuth(input.auth, input.period),
    input.latestStatement === undefined
      ? loadLatestPayrollSnapshot(input.auth, input.period)
      : Promise.resolve(input.latestStatement),
  ]);
  const lines = attachStatementPaystubsToLines({
    latestStatement,
    lines: live.lines,
  }).filter(isTaxCompanyReportableLine);

  return {
    latestStatement,
    lines,
    source: "live" as const,
    summary: calculateSummary({ corrections: live.corrections, lines }),
  };
}

export async function buildTaxCompanyLines(input: {
  cycleType?: string | null;
  endDate?: string | null;
  month?: string | null;
  payPeriodStart?: string | null;
  preset?: string | null;
  segment?: string | null;
  startDate?: string | null;
}) {
  const auth = await requirePayrollContext({ taxCompanyOnly: true });
  const salonPayrollSetting = await loadSalonPayrollSetting(auth);
  const period = resolvePayrollPeriod({
    cycleType: input.cycleType,
    endDate: input.endDate,
    month: input.month,
    payPeriodStart: input.payPeriodStart,
    preset: input.preset,
    segment: input.segment,
    salonSetting: salonPayrollSetting,
    startDate: input.startDate,
  });
  const taxCompany = await buildTaxCompanyLinesForAuth({
    auth,
    period,
  });

  return {
    ...taxCompany,
    period,
    periodOptions: getPayrollPeriodOptions({ salonSetting: salonPayrollSetting }),
    scheduleSetup: getPayrollScheduleSetup(salonPayrollSetting),
    salonPayrollSetting,
  };
}

export async function getLatestPayrollStatement(period: PayrollPeriod) {
  const auth = await requirePayrollContext();
  return loadLatestPayrollSnapshot(auth, period);
}

function emptyDifference(): PayrollStatementDifference {
  return {
    actionItems: [],
    changed: false,
    staffDifferences: [],
    summaryDifferences: {},
  };
}

function differenceValue(current: number, previous: number) {
  return {
    current: roundMoney(current),
    delta: roundMoney(current - previous),
    previous: roundMoney(previous),
  };
}

type PayrollActionItem = PayrollStatementDifference["actionItems"][number];
type PayrollActionChange = PayrollActionItem["changes"][number];

function moneyActionChange(input: {
  current: number | null | undefined;
  field: string;
  label: string;
  previous: number | null | undefined;
}) {
  const current = numberValue(input.current);
  const previous = numberValue(input.previous);

  if (!moneyChanged(current, previous)) {
    return null;
  }

  return {
    current: roundMoney(current),
    delta: roundMoney(current - previous),
    field: input.field,
    label: input.label,
    previous: roundMoney(previous),
    valueType: "money" as const,
  } satisfies PayrollActionChange;
}

function statusActionChange(input: {
  current: boolean;
  currentText: string;
  field: string;
  label: string;
  previous: boolean;
  previousText: string;
}) {
  if (input.current === input.previous) {
    return null;
  }

  return {
    current: input.current ? 1 : 0,
    currentText: input.currentText,
    delta: null,
    field: input.field,
    label: input.label,
    previous: input.previous ? 1 : 0,
    previousText: input.previousText,
    valueType: "status" as const,
  } satisfies PayrollActionChange;
}

function payrollActionStatus(input: {
  currentText: string;
  field: string;
  label: string;
  previousText: string;
}) {
  return {
    current: null,
    currentText: input.currentText,
    delta: null,
    field: input.field,
    label: input.label,
    previous: null,
    previousText: input.previousText,
    valueType: "status" as const,
  } satisfies PayrollActionChange;
}

function lineRequiresPaystub(line: PayrollStaffLineWithDailyTotals | undefined) {
  if (!line) {
    return false;
  }

  return (
    Boolean(line.tax_company_enabled_snapshot) ||
    moneyChanged(numberValue(line.final_check_amount), 0) ||
    moneyChanged(numberValue(line.tax_withheld), 0) ||
    moneyChanged(numberValue(line.tax_company_taxable_gross), 0)
  );
}

function paystubRelevantFieldsChanged(input: {
  currentLine: PayrollStaffLineWithDailyTotals;
  previousLine: PayrollStaffLineWithDailyTotals;
}) {
  const fields: Array<keyof PayrollStaffLineWithDailyTotals> = [
    "check_gross",
    "final_check_amount",
    "tax_company_taxable_gross",
    "tax_withheld",
  ];

  return fields.some((field) =>
    moneyChanged(
      numberValue(input.currentLine[field] as number | null | undefined),
      numberValue(input.previousLine[field] as number | null | undefined),
    ),
  );
}

function getPayrollActionDescriptor(input: {
  cashChanged: boolean;
  checkChanged: boolean;
  paystubMissing: boolean;
  paystubOutdated: boolean;
  staffAdded: boolean;
  staffRemoved: boolean;
  taxChanged: boolean;
}) {
  if (input.staffAdded) {
    return {
      action: "Create check/paystub if needed",
      kind: "staff_added" as const,
      priority: 5,
      title: "New staff payout added",
    };
  }

  if (input.staffRemoved) {
    return {
      action: "Void check / cancel paystub if already issued",
      kind: "staff_removed" as const,
      priority: 5,
      title: "Staff payout removed",
    };
  }

  if (input.checkChanged) {
    return {
      action:
        input.paystubMissing || input.paystubOutdated || input.taxChanged
          ? "Reprint check and regenerate paystub"
          : "Reprint check / void old check",
      kind: "check_changed" as const,
      priority: 1,
      title: "Check amount changed",
    };
  }

  if (input.cashChanged) {
    return {
      action: "Adjust cash payout",
      kind: "cash_changed" as const,
      priority: 2,
      title: "Cash payout changed",
    };
  }

  if (input.paystubMissing) {
    return {
      action: "Generate paystub",
      kind: "paystub_missing" as const,
      priority: 3,
      title: "Paystub missing",
    };
  }

  if (input.paystubOutdated) {
    return {
      action: "Regenerate paystub",
      kind: "paystub_outdated" as const,
      priority: 3,
      title: "Paystub outdated",
    };
  }

  if (input.taxChanged) {
    return {
      action: "Regenerate paystub / review tax report",
      kind: "tax_changed" as const,
      priority: 4,
      title: "Tax withheld changed",
    };
  }

  return {
    action: "Void check / cancel paystub if already issued",
    kind: "staff_removed" as const,
    priority: 5,
    title: "Staff payout removed",
  };
}

function buildPayrollActionItems(
  live: PayrollLiveSnapshot,
  statement: PayrollStatementSnapshot,
) {
  const liveByStaffId = new Map(live.lines.map((line) => [line.staff_id, line]));
  const statementByStaffId = new Map(
    statement.lines.map((line) => [line.staff_id, line]),
  );
  const staffIds = new Set([
    ...Array.from(liveByStaffId.keys()),
    ...Array.from(statementByStaffId.keys()),
  ]);
  const items: PayrollActionItem[] = [];

  for (const staffId of staffIds) {
    const currentLine = liveByStaffId.get(staffId);
    const previousLine = statementByStaffId.get(staffId);
    const staffName =
      currentLine?.staff_display_name_snapshot ??
      previousLine?.staff_display_name_snapshot ??
      "Staff";
    const staffAdded = Boolean(currentLine && !previousLine);
    const staffRemoved = Boolean(previousLine && !currentLine);
    const changes: PayrollActionChange[] = [];

    if (staffAdded) {
      changes.push(
        payrollActionStatus({
          currentText: "Added",
          field: "staff_status",
          label: "Staff payout",
          previousText: "Not on statement",
        }),
      );
      for (const change of [
        moneyActionChange({
          current: currentLine?.final_check_amount,
          field: "final_check_amount",
          label: "Check amount",
          previous: 0,
        }),
        moneyActionChange({
          current: currentLine?.final_cash_amount,
          field: "final_cash_amount",
          label: "Cash payout",
          previous: 0,
        }),
        moneyActionChange({
          current: currentLine?.tax_withheld,
          field: "tax_withheld",
          label: "Tax withheld",
          previous: 0,
        }),
      ]) {
        if (change) {
          changes.push(change);
        }
      }

      if (lineRequiresPaystub(currentLine)) {
        changes.push(
          payrollActionStatus({
            currentText: "Required",
            field: "paystub",
            label: "Paystub",
            previousText: "Not uploaded",
          }),
        );
      }
    } else if (staffRemoved) {
      changes.push(
        payrollActionStatus({
          currentText: "Removed",
          field: "staff_status",
          label: "Staff payout",
          previousText: "Printed",
        }),
      );
      for (const change of [
        moneyActionChange({
          current: 0,
          field: "final_check_amount",
          label: "Check amount",
          previous: previousLine?.final_check_amount,
        }),
        moneyActionChange({
          current: 0,
          field: "final_cash_amount",
          label: "Cash payout",
          previous: previousLine?.final_cash_amount,
        }),
        moneyActionChange({
          current: 0,
          field: "tax_withheld",
          label: "Tax withheld",
          previous: previousLine?.tax_withheld,
        }),
      ]) {
        if (change) {
          changes.push(change);
        }
      }
    } else if (currentLine && previousLine) {
      for (const change of [
        moneyActionChange({
          current: currentLine.final_check_amount,
          field: "final_check_amount",
          label: "Check amount",
          previous: previousLine.final_check_amount,
        }),
        moneyActionChange({
          current: currentLine.final_cash_amount,
          field: "final_cash_amount",
          label: "Cash payout",
          previous: previousLine.final_cash_amount,
        }),
        moneyActionChange({
          current: currentLine.tax_withheld,
          field: "tax_withheld",
          label: "Tax withheld",
          previous: previousLine.tax_withheld,
        }),
        moneyActionChange({
          current: currentLine.tax_company_taxable_gross,
          field: "tax_company_taxable_gross",
          label: "Taxable income",
          previous: previousLine.tax_company_taxable_gross,
        }),
      ]) {
        if (change) {
          changes.push(change);
        }
      }

      for (const change of [
        statusActionChange({
          current: currentLine.cash_to_tax_company_snapshot,
          currentText: currentLine.cash_to_tax_company_snapshot ? "On" : "Off",
          field: "cash_to_tax_company",
          label: "Tax cash",
          previous: previousLine.cash_to_tax_company_snapshot,
          previousText: previousLine.cash_to_tax_company_snapshot ? "On" : "Off",
        }),
        statusActionChange({
          current: currentLine.tax_tips_snapshot,
          currentText: currentLine.tax_tips_snapshot ? "Taxed" : "Not taxed",
          field: "tax_tips",
          label: "Tip tax",
          previous: previousLine.tax_tips_snapshot,
          previousText: previousLine.tax_tips_snapshot ? "Taxed" : "Not taxed",
        }),
        statusActionChange({
          current: currentLine.tax_bonus_snapshot,
          currentText: currentLine.tax_bonus_snapshot ? "Taxed" : "Not taxed",
          field: "tax_bonus",
          label: "Bonus tax",
          previous: previousLine.tax_bonus_snapshot,
          previousText: previousLine.tax_bonus_snapshot ? "Taxed" : "Not taxed",
        }),
      ]) {
        if (change) {
          changes.push(change);
        }
      }

      const payrollImpactChanged = changes.some((change) =>
        [
          "cash_to_tax_company",
          "final_check_amount",
          "tax_bonus",
          "tax_company_taxable_gross",
          "tax_tips",
          "tax_withheld",
        ].includes(change.field),
      );
      const paystubMissing =
        payrollImpactChanged && lineRequiresPaystub(currentLine) && !previousLine.paystub;
      const paystubOutdated =
        !paystubMissing &&
        Boolean(previousLine.paystub) &&
        paystubRelevantFieldsChanged({ currentLine, previousLine });

      if (paystubMissing) {
        changes.push(
          payrollActionStatus({
            currentText: "Required",
            field: "paystub",
            label: "Paystub",
            previousText: "Not uploaded",
          }),
        );
      } else if (paystubOutdated) {
        changes.push(
          payrollActionStatus({
            currentText: "Needs replacement",
            field: "paystub",
            label: "Paystub",
            previousText: "Uploaded",
          }),
        );
      }
    }

    const checkChanged = changes.some(
      (change) => change.field === "final_check_amount",
    );
    const cashChanged = changes.some(
      (change) => change.field === "final_cash_amount",
    );
    const paystubMissing = changes.some(
      (change) =>
        change.field === "paystub" && change.currentText === "Required",
    );
    const paystubOutdated = changes.some(
      (change) =>
        change.field === "paystub" && change.currentText === "Needs replacement",
    );
    const taxChanged = changes.some((change) =>
      [
        "cash_to_tax_company",
        "tax_bonus",
        "tax_company_taxable_gross",
        "tax_tips",
        "tax_withheld",
      ].includes(change.field),
    );

    if (
      !checkChanged &&
      !cashChanged &&
      !paystubMissing &&
      !paystubOutdated &&
      !taxChanged &&
      !staffAdded &&
      !staffRemoved
    ) {
      continue;
    }

    const descriptor = getPayrollActionDescriptor({
      cashChanged,
      checkChanged,
      paystubMissing,
      paystubOutdated,
      staffAdded,
      staffRemoved,
      taxChanged,
    });

    items.push({
      ...descriptor,
      changes,
      staffId,
      staffName,
    });
  }

  return items.sort(
    (left, right) =>
      left.priority - right.priority || left.staffName.localeCompare(right.staffName),
  );
}

export function compareLivePayrollToStatement(
  live: PayrollLiveSnapshot,
  statement: PayrollStatementSnapshot | null,
): PayrollStatementDifference {
  if (!statement) {
    return emptyDifference();
  }

  const summaryFields: Array<keyof PayrollSummary> = [
    "correctionAfterLockdayCount",
    "totalBonus",
    "totalCashPayout",
    "totalCheckGross",
    "totalCheckNet",
    "totalFinalStaffIncome",
    "totalPosIncome",
    "totalShopShare",
    "totalStaffCommissionPayout",
    "totalStaffGrossProduction",
    "totalTaxWithheld",
    "totalTaxCompanyAmount",
    "totalTaxCompanyCashAmount",
    "totalTaxCompanyCheckAmount",
    "totalTaxCompanyReportedWageGross",
    "totalTaxCompanyTaxableGross",
    "totalTip",
  ];
  const shopSummaryFields: Array<keyof PayrollShopSummary> = [
    "cashAmount",
    "correctionCount",
    "creditCardAmount",
    "manualInputIncome",
    "otherAmount",
    "overShortTotal",
    "posIncome",
    "shopShare",
    "shopNetIncome",
    "staffCommissionPay",
    "staffNetPay",
    "staffProduction",
    "taxWithheld",
    "tips",
    "tipsPaid",
    "totalActualIncome",
    "totalStaffObligation",
  ];
  const lineFields: Array<keyof PayrollStaffLine> = [
    "base_cash_amount",
    "base_check_amount",
    "bonus_amount",
    "bonus_cash_amount",
    "bonus_check_amount",
    "cash_amount",
    "check_gross",
    "check_net",
    "check_rate_used",
    "commission_rate_used",
    "earned_amount",
    "final_cash_amount",
    "final_check_amount",
    "final_staff_income",
    "fixed_pay_amount_used",
    "gross_sales",
    "shop_share",
    "staff_commission_gross",
    "tax_company_cash_amount",
    "tax_company_check_amount",
    "tax_company_reported_wage_gross",
    "tax_company_taxable_gross",
    "tax_rate_used",
    "tax_withheld",
    "tip_amount",
    "tip_cash_amount",
    "tip_check_amount",
  ];
  const summaryDifferences: PayrollStatementDifference["summaryDifferences"] = {};

  for (const field of summaryFields) {
    const current = numberValue(live.summary[field]);
    const previous = numberValue(statement.summary[field]);

    if (moneyChanged(current, previous)) {
      summaryDifferences[field] = differenceValue(current, previous);
    }
  }

  if (statement.shopSummary) {
    for (const field of shopSummaryFields) {
      const currentValue = live.shopSummary[field];
      const previousValue = statement.shopSummary[field];
      const current = numberValue(currentValue);
      const previous = numberValue(previousValue);
      const changed =
        currentValue === null || previousValue === null
          ? currentValue !== previousValue
          : moneyChanged(current, previous);

      if (changed) {
        summaryDifferences[field] = differenceValue(current, previous);
      }
    }
  }

  const liveByStaffId = new Map(live.lines.map((line) => [line.staff_id, line]));
  const statementByStaffId = new Map(
    statement.lines.map((line) => [line.staff_id, line]),
  );
  const staffIds = new Set([
    ...Array.from(liveByStaffId.keys()),
    ...Array.from(statementByStaffId.keys()),
  ]);
  const staffDifferences: PayrollStatementDifference["staffDifferences"] = [];

  for (const staffId of staffIds) {
    const currentLine = liveByStaffId.get(staffId);
    const previousLine = statementByStaffId.get(staffId);
    const differences: Record<string, ReturnType<typeof differenceValue>> = {};

    for (const field of lineFields) {
      const current = numberValue(currentLine?.[field] as number | undefined);
      const previous = numberValue(previousLine?.[field] as number | undefined);

      if (moneyChanged(current, previous)) {
        differences[field] = differenceValue(current, previous);
      }
    }

    const currentTaxCompany = currentLine?.tax_company_enabled_snapshot ? 1 : 0;
    const previousTaxCompany = previousLine?.tax_company_enabled_snapshot ? 1 : 0;

    if (currentTaxCompany !== previousTaxCompany) {
      differences.tax_company_enabled = differenceValue(
        currentTaxCompany,
        previousTaxCompany,
      );
    }

    const currentCashToTaxCompany = currentLine?.cash_to_tax_company_snapshot ? 1 : 0;
    const previousCashToTaxCompany = previousLine?.cash_to_tax_company_snapshot ? 1 : 0;

    if (currentCashToTaxCompany !== previousCashToTaxCompany) {
      differences.cash_to_tax_company = differenceValue(
        currentCashToTaxCompany,
        previousCashToTaxCompany,
      );
    }

    const currentTaxTips = currentLine?.tax_tips_snapshot ? 1 : 0;
    const previousTaxTips = previousLine?.tax_tips_snapshot ? 1 : 0;

    if (currentTaxTips !== previousTaxTips) {
      differences.tax_tips = differenceValue(currentTaxTips, previousTaxTips);
    }

    const currentTaxBonus = currentLine?.tax_bonus_snapshot ? 1 : 0;
    const previousTaxBonus = previousLine?.tax_bonus_snapshot ? 1 : 0;

    if (currentTaxBonus !== previousTaxBonus) {
      differences.tax_bonus = differenceValue(currentTaxBonus, previousTaxBonus);
    }

    if (
      (currentLine?.tip_payout_method_snapshot ?? "") !==
      (previousLine?.tip_payout_method_snapshot ?? "")
    ) {
      differences.tip_payout_method = differenceValue(1, 0);
    }

    if (
      (currentLine?.bonus_payout_method_snapshot ?? "") !==
      (previousLine?.bonus_payout_method_snapshot ?? "")
    ) {
      differences.bonus_payout_method = differenceValue(1, 0);
    }

    const currentMixed = currentLine?.is_mixed_rate ? 1 : 0;
    const previousMixed = previousLine?.is_mixed_rate ? 1 : 0;

    if (currentMixed !== previousMixed) {
      differences.is_mixed_rate = differenceValue(currentMixed, previousMixed);
    }

    if ((currentLine?.check_number ?? "") !== (previousLine?.check_number ?? "")) {
      differences.check_number = differenceValue(1, 0);
    }

    if ((currentLine?.note ?? "") !== (previousLine?.note ?? "")) {
      differences.note = differenceValue(1, 0);
    }

    if (Object.keys(differences).length > 0) {
      staffDifferences.push({
        differences,
        staffId,
        staffName:
          currentLine?.staff_display_name_snapshot ??
          previousLine?.staff_display_name_snapshot ??
          staffId,
      });
    }
  }

  const actionItems = buildPayrollActionItems(live, statement);

  return {
    actionItems,
    changed:
      Object.keys(summaryDifferences).length > 0 ||
      staffDifferences.length > 0 ||
      actionItems.length > 0,
    staffDifferences,
    summaryDifferences,
  };
}

function getPayrollStatusView(
  statement: PayrollStatementSnapshot | null,
  difference: PayrollStatementDifference,
): PayrollStatusView {
  if (!statement) {
    return {
      kind: "live",
      label: "Live",
      statementVersion: null,
    };
  }

  if (statement.run.status === "paid") {
    return {
      kind: "paid",
      label: "Paid",
      statementVersion: statement.run.version,
    };
  }

  if (difference.changed) {
    return {
      kind: "changed_since_print",
      label: "Changed since last print",
      statementVersion: statement.run.version,
    };
  }

  return {
    kind: "printed",
    label: "Printed",
    statementVersion: statement.run.version,
  };
}

function getPayrollScheduleSetup(salonSetting: SalonPayrollSetting) {
  const needsBiweeklyAnchor =
    salonSetting.cycle_type === "biweekly" && !salonSetting.biweekly_anchor_date;

  return {
    message: needsBiweeklyAnchor
      ? "Every-2-weeks payroll needs an anchor date."
      : null,
    needsBiweeklyAnchor,
  };
}

function periodFromDates(input: {
  cycleType: PayrollCycleType;
  endDate: string;
  startDate: string;
}): PayrollPeriod {
  assertDateRange(input.startDate, input.endDate);

  return {
    cycleType: input.cycleType,
    endDate: input.endDate,
    label: formatPeriodLabel(input.startDate, input.endDate),
    preset: "custom",
    startDate: input.startDate,
  };
}

function statementSettingsSnapshot(live: PayrollLiveSnapshot) {
  return {
    inputs: live.periodInputs.map(serializeInput),
    lines: live.lines.map((line) => ({
      bonusPayoutMethod: line.bonus_payout_method_snapshot,
      cashToTaxCompany: line.cash_to_tax_company_snapshot,
      input: line.period_staff_input_snapshot,
      isMixedRate: line.is_mixed_rate,
      settings: line.settings_used_snapshot,
      staffId: line.staff_id,
      taxBonus: line.tax_bonus_snapshot,
      taxCompanyEnabled: line.tax_company_enabled_snapshot,
      taxTips: line.tax_tips_snapshot,
      tipPayoutMethod: line.tip_payout_method_snapshot,
    })),
    shopDailyRows: live.shopDailyRows,
    shopSummary: live.shopSummary,
  };
}

export async function savePayrollStatementFromLivePayroll(input: {
  cycleType: PayrollCycleType;
  endDate: string;
  startDate: string;
}) {
  const auth = await requirePayrollManageContext();
  const period = periodFromDates(input);
  const live = await calculateLivePayrollForAuth(auth, period);
  const { data: latestRun, error: latestRunError } = await auth.supabase
    .from("payroll_runs")
    .select("version")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("period_start", period.startDate)
    .eq("period_end", period.endDate)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();

  if (latestRunError) {
    throw new Error(latestRunError.message);
  }

  const now = new Date().toISOString();
  const nextVersion = numberValue(latestRun?.version) + 1 || 1;
  const { data: run, error: runError } = await auth.supabase
    .from("payroll_runs")
    .insert({
      correction_snapshot: live.corrections,
      cycle_type: period.cycleType,
      generated_at: now,
      organization_id: auth.organization.id,
      period_end: period.endDate,
      period_start: period.startDate,
      printed_at: now,
      printed_by: auth.user.id,
      salon_id: auth.salon.id,
      settings_snapshot: statementSettingsSnapshot(live),
      status: "printed",
      version: nextVersion,
    })
    .select(PAYROLL_RUN_SELECT)
    .single<PayrollRun>();

  if (runError) {
    throw new Error(runError.message);
  }

  const lineRows = live.lines.map((line) => ({
    base_cash_amount: line.base_cash_amount,
    base_check_amount: line.base_check_amount,
    bonus_amount: line.bonus_amount,
    bonus_cash_amount: line.bonus_cash_amount,
    bonus_check_amount: line.bonus_check_amount,
    bonus_payout_method_snapshot: line.bonus_payout_method_snapshot,
    cash_amount: line.cash_amount,
    cash_to_tax_company_snapshot: line.cash_to_tax_company_snapshot,
    check_gross: line.check_gross,
    check_net: line.check_net,
    check_number: line.check_number,
    check_rate_used: line.check_rate_used,
    commission_rate_used: line.commission_rate_used,
    earned_amount: line.earned_amount,
    final_cash_amount: line.final_cash_amount,
    final_check_amount: line.final_check_amount,
    final_staff_income: line.final_staff_income,
    fixed_pay_amount_used: line.fixed_pay_amount_used,
    gross_sales: line.gross_sales,
    is_mixed_rate: line.is_mixed_rate,
    note: line.note,
    organization_id: auth.organization.id,
    pay_type_used: line.pay_type_used,
    payroll_run_id: run.id,
    period_staff_input_snapshot: line.period_staff_input_snapshot,
    salon_id: auth.salon.id,
    settings_used_snapshot: line.settings_used_snapshot,
    shop_share: line.shop_share,
    staff_commission_gross: line.staff_commission_gross,
    staff_display_name_snapshot: line.staff_display_name_snapshot,
    staff_id: line.staff_id,
    staff_legal_name_snapshot: line.staff_legal_name_snapshot,
    tax_bonus_snapshot: line.tax_bonus_snapshot,
    tax_company_cash_amount: line.tax_company_cash_amount,
    tax_company_check_amount: line.tax_company_check_amount,
    tax_company_enabled_snapshot: line.tax_company_enabled_snapshot,
    tax_company_reported_wage_gross: line.tax_company_reported_wage_gross,
    tax_company_taxable_gross: line.tax_company_taxable_gross,
    tax_rate_used: line.tax_rate_used,
    tax_tips_snapshot: line.tax_tips_snapshot,
    tax_withheld: line.tax_withheld,
    tip_allocation_method: line.tip_allocation_method,
    tip_amount: line.tip_amount,
    tip_cash_amount: line.tip_cash_amount,
    tip_check_amount: line.tip_check_amount,
    tip_payout_method_snapshot: line.tip_payout_method_snapshot,
  }));
  const dailyRows = live.lines.flatMap((line) =>
    line.dailyTotals.map((dailyTotal) => ({
      business_date: dailyTotal.business_date,
      check_rate_used: dailyTotal.check_rate_used,
      commission_rate_used: dailyTotal.commission_rate_used,
      correction_delta: dailyTotal.correction_delta,
      fixed_pay_amount_used: dailyTotal.fixed_pay_amount_used,
      gross_sales: dailyTotal.gross_sales,
      note: dailyTotal.note,
      organization_id: auth.organization.id,
      pay_type_used: dailyTotal.pay_type_used,
      payroll_run_id: run.id,
      salon_id: auth.salon.id,
      settings_used_snapshot: dailyTotal.settings_used_snapshot,
      staff_id: dailyTotal.staff_id,
      tax_rate_used: dailyTotal.tax_rate_used,
      tip_amount: dailyTotal.tip_amount,
    })),
  );

  if (lineRows.length > 0) {
    const { error } = await auth.supabase.from("payroll_staff_lines").insert(lineRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (dailyRows.length > 0) {
    const { error } = await auth.supabase
      .from("payroll_staff_daily_totals")
      .insert(dailyRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  return loadPayrollSnapshot(auth, run);
}

export async function markPayrollStatementPaid(payrollRunId: string) {
  if (!payrollRunId) {
    throw new Error("Payroll statement is required.");
  }

  const auth = await requirePayrollManageContext();
  const run = await loadPayrollRunById(auth, payrollRunId);

  if (run.status === "paid") {
    return run;
  }

  const now = new Date().toISOString();
  const { data, error } = await auth.supabase
    .from("payroll_runs")
    .update({
      paid_at: now,
      paid_by: auth.user.id,
      printed_at: run.printed_at ?? now,
      printed_by: run.printed_by ?? auth.user.id,
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

function sanitizeStorageFileName(value: string) {
  const trimmed = value.trim() || "paystub";
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function uploadPayrollPaystub(input: {
  file: File;
  payrollRunId: string;
  staffId: string;
}) {
  const auth = await requirePayrollContext({ taxCompanyOnly: true });

  if (!auth.access.canManagePayroll && !auth.access.canViewTaxCompany) {
    throw new Error("You do not have permission to upload paystubs.");
  }

  if (!input.payrollRunId || !input.staffId) {
    throw new Error("Payroll statement and staff member are required.");
  }

  if (!input.file || input.file.size <= 0) {
    throw new Error("Choose a paystub file to upload.");
  }

  const maxSizeBytes = 10 * 1024 * 1024;

  if (input.file.size > maxSizeBytes) {
    throw new Error("Paystub file must be 10 MB or smaller.");
  }

  const run = await loadPayrollRunById(auth, input.payrollRunId);

  if (run.status !== "printed" && run.status !== "paid") {
    throw new Error("Upload paystubs after the payroll statement is printed.");
  }

  const { data: line, error: lineError } = await auth.supabase
    .from("payroll_staff_lines")
    .select("id")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("payroll_run_id", run.id)
    .eq("staff_id", input.staffId)
    .maybeSingle<{ id: string }>();

  if (lineError) {
    throw new Error(lineError.message);
  }

  if (!line) {
    throw new Error("Paystub upload is only available for payroll staff lines.");
  }

  const fileName = sanitizeStorageFileName(input.file.name);
  const storagePath = [
    auth.organization.id,
    auth.salon.id,
    run.id,
    input.staffId,
    `${Date.now()}-${fileName}`,
  ].join("/");
  const { error: uploadError } = await auth.supabase.storage
    .from(PAYROLL_PAYSTUB_BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.file.type || undefined,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data, error } = await auth.supabase
    .from("payroll_paystubs")
    .upsert(
      {
        file_name: input.file.name || fileName,
        file_url_or_path: storagePath,
        mime_type: input.file.type || null,
        organization_id: auth.organization.id,
        payroll_run_id: run.id,
        salon_id: auth.salon.id,
        size_bytes: input.file.size,
        staff_id: input.staffId,
        uploaded_by: auth.user.id,
      },
      { onConflict: "payroll_run_id,staff_id" },
    )
    .select(PAYROLL_PAYSTUB_SELECT)
    .single<PayrollPaystub>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    ...data,
    view_url: await createPaystubViewUrl(auth, data.file_url_or_path),
  };
}

export async function updatePayrollPeriodStaffInput(input: {
  bonusAmount: number;
  checkNumber: string | null;
  cycleType: PayrollCycleType;
  endDate: string;
  note: string | null;
  staffId: string;
  startDate: string;
}) {
  const auth = await requirePayrollManageContext();
  assertDateRange(input.startDate, input.endDate);

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
    throw new Error("Staff member was not found.");
  }

  const { data, error } = await auth.supabase
    .from("payroll_period_staff_inputs")
    .upsert(
      {
        bonus_amount: Math.max(0, roundMoney(numberValue(input.bonusAmount))),
        check_number: input.checkNumber?.trim() || null,
        cycle_type: input.cycleType,
        note: input.note?.trim() || null,
        organization_id: auth.organization.id,
        period_end: input.endDate,
        period_start: input.startDate,
        salon_id: auth.salon.id,
        staff_id: input.staffId,
        updated_by: auth.user.id,
      },
      { onConflict: "salon_id,staff_id,period_start,period_end" },
    )
    .select(PAYROLL_PERIOD_STAFF_INPUT_SELECT)
    .single<PayrollPeriodStaffInput>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateSalonPayrollSetting(input: {
  biweeklyAnchorDate: string | null;
  cycleType: Exclude<PayrollCycleType, "custom">;
}) {
  const auth = await requirePayrollManageContext();

  if (
    input.cycleType !== "monthly" &&
    input.cycleType !== "semi_monthly" &&
    input.cycleType !== "biweekly"
  ) {
    throw new Error("Payroll cycle is required.");
  }

  if (input.cycleType === "biweekly" && !input.biweeklyAnchorDate) {
    throw new Error("Biweekly payroll requires an anchor date.");
  }

  if (
    input.biweeklyAnchorDate &&
    !isDateInputValue(input.biweeklyAnchorDate)
  ) {
    throw new Error("Anchor date must be a valid date.");
  }

  const { data, error } = await auth.supabase
    .from("salon_payroll_settings")
    .upsert(
      {
        biweekly_anchor_date:
          input.cycleType === "biweekly" ? input.biweeklyAnchorDate : null,
        cycle_type: input.cycleType,
        organization_id: auth.organization.id,
        salon_id: auth.salon.id,
      },
      { onConflict: "salon_id" },
    )
    .select(SALON_PAYROLL_SETTING_SELECT)
    .single<SalonPayrollSetting>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateStaffPayrollSetting(input: {
  applyTaxToFixedPay: boolean;
  bonusPayoutMethod: PayrollPayoutMethod;
  cashToTaxCompany: boolean;
  checkRate: number;
  commissionRate: number;
  effectiveFrom: string;
  fixedPayAmount: number;
  legalName: string | null;
  payType: StaffPayType;
  staffId: string;
  taxBonus: boolean;
  taxRate: number;
  taxTips: boolean;
  tipPayoutMethod: PayrollPayoutMethod;
}) {
  const auth = await requirePayrollManageContext();

  if (!input.staffId) {
    throw new Error("Staff member is required.");
  }

  if (!isDateInputValue(input.effectiveFrom)) {
    throw new Error("Effective date is required.");
  }

  if (input.payType !== "commission" && input.payType !== "fixed") {
    throw new Error("Pay type is required.");
  }

  if (input.tipPayoutMethod !== "check" && input.tipPayoutMethod !== "cash") {
    throw new Error("Tip payout method is required.");
  }

  if (
    input.bonusPayoutMethod !== "check" &&
    input.bonusPayoutMethod !== "cash"
  ) {
    throw new Error("Bonus payout method is required.");
  }

  const checkRate = Math.min(100, Math.max(0, numberValue(input.checkRate)));
  const commissionRate = Math.min(
    100,
    Math.max(0, numberValue(input.commissionRate)),
  );
  const taxRate = Math.min(100, Math.max(0, numberValue(input.taxRate)));
  const fixedPayAmount = Math.max(0, roundMoney(numberValue(input.fixedPayAmount)));
  const cashToTaxCompany = Boolean(input.cashToTaxCompany);
  const taxCompanyEnabled =
    taxRate > 0 ||
    Boolean(input.taxTips) ||
    Boolean(input.taxBonus) ||
    cashToTaxCompany ||
    (input.payType === "fixed" && Boolean(input.applyTaxToFixedPay));
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
    throw new Error("Staff member was not found.");
  }

  const { data: existingSetting, error: existingSettingError } = await auth.supabase
    .from("staff_payroll_settings")
    .select("id")
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("staff_id", input.staffId)
    .eq("effective_from", input.effectiveFrom)
    .maybeSingle<{ id: string }>();

  if (existingSettingError) {
    throw new Error(existingSettingError.message);
  }

  const settingPayload = {
    apply_tax_to_fixed_pay: input.applyTaxToFixedPay,
    bonus_payout_method: input.bonusPayoutMethod,
    cash_to_tax_company: cashToTaxCompany,
    check_rate: checkRate,
    commission_rate: commissionRate,
    fixed_pay_amount: fixedPayAmount,
    legal_name: input.legalName?.trim() || null,
    pay_type: input.payType,
    tax_bonus: input.taxBonus,
    tax_company_enabled: taxCompanyEnabled,
    tax_rate: taxRate,
    tax_tips: input.taxTips,
    tip_payout_method: input.tipPayoutMethod,
  };

  if (existingSetting) {
    const { data, error } = await auth.supabase
      .from("staff_payroll_settings")
      .update(settingPayload)
      .eq("id", existingSetting.id)
      .eq("organization_id", auth.organization.id)
      .eq("salon_id", auth.salon.id)
      .eq("staff_id", input.staffId)
      .select(STAFF_PAYROLL_SETTING_SELECT)
      .single<StaffPayrollSetting>();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  const previousEffectiveTo = addDays(input.effectiveFrom, -1);
  const { error: closePreviousError } = await auth.supabase
    .from("staff_payroll_settings")
    .update({ effective_to: previousEffectiveTo })
    .eq("organization_id", auth.organization.id)
    .eq("salon_id", auth.salon.id)
    .eq("staff_id", input.staffId)
    .lt("effective_from", input.effectiveFrom)
    .or(`effective_to.is.null,effective_to.gte.${input.effectiveFrom}`);

  if (closePreviousError) {
    throw new Error(closePreviousError.message);
  }

  const { data, error } = await auth.supabase
    .from("staff_payroll_settings")
    .insert({
      ...settingPayload,
      effective_from: input.effectiveFrom,
      effective_to: null,
      organization_id: auth.organization.id,
      salon_id: auth.salon.id,
      staff_id: input.staffId,
    })
    .select(STAFF_PAYROLL_SETTING_SELECT)
    .single<StaffPayrollSetting>();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getPayrollPageData(input: {
  cycleType?: string | null;
  endDate?: string | null;
  month?: string | null;
  payPeriodStart?: string | null;
  preset?: string | null;
  segment?: string | null;
  startDate?: string | null;
}) {
  const auth = await requirePayrollContext();
  const salonPayrollSetting = auth.access.canViewAllPayroll
    ? await loadSalonPayrollSetting(auth)
    : getDefaultSalonPayrollSetting(auth.organization.id, auth.salon.id);
  const period = resolvePayrollPeriod({
    cycleType: input.cycleType,
    endDate: input.endDate,
    month: input.month,
    payPeriodStart: input.payPeriodStart,
    preset: input.preset,
    segment: input.segment,
    salonSetting: salonPayrollSetting,
    startDate: input.startDate,
  });
  const [live, latestStatement, staffRows, staffSettings] = await Promise.all([
    calculateLivePayrollForAuth(auth, period),
    loadLatestPayrollSnapshot(auth, period),
    auth.access.canViewAllPayroll ? loadStaffRows(auth) : Promise.resolve([]),
    auth.access.canViewAllPayroll
      ? loadStaffPayrollSettings(auth)
      : Promise.resolve([]),
  ]);
  const difference = compareLivePayrollToStatement(live, latestStatement);
  const taxCompany = await buildTaxCompanyLinesForAuth({
    auth,
    latestStatement,
    live,
    period,
  });

  return {
    access: auth.access,
    context: auth.context,
    difference,
    latestStatement,
    live,
    period,
    periodOptions: getPayrollPeriodOptions({ salonSetting: salonPayrollSetting }),
    scheduleSetup: getPayrollScheduleSetup(salonPayrollSetting),
    salonPayrollSetting,
    staffPayrollSettings: latestSettingsWithStaff(staffRows, staffSettings),
    status: getPayrollStatusView(latestStatement, difference),
    taxCompany,
  };
}

export async function getPayrollTaxCompanyData(input: {
  cycleType?: string | null;
  endDate?: string | null;
  month?: string | null;
  payPeriodStart?: string | null;
  preset?: string | null;
  segment?: string | null;
  startDate?: string | null;
}) {
  const auth = await requirePayrollContext({ taxCompanyOnly: true });
  const salonPayrollSetting = await loadSalonPayrollSetting(auth);
  const period = resolvePayrollPeriod({
    cycleType: input.cycleType,
    endDate: input.endDate,
    month: input.month,
    payPeriodStart: input.payPeriodStart,
    preset: input.preset,
    segment: input.segment,
    salonSetting: salonPayrollSetting,
    startDate: input.startDate,
  });
  const taxCompany = await buildTaxCompanyLinesForAuth({
    auth,
    period,
  });

  return {
    access: auth.access,
    context: auth.context,
    latestStatement: taxCompany.latestStatement,
    lines: taxCompany.lines,
    period,
    periodOptions: getPayrollPeriodOptions({ salonSetting: salonPayrollSetting }),
    scheduleSetup: getPayrollScheduleSetup(salonPayrollSetting),
    salonPayrollSetting,
    source: taxCompany.source,
    summary: taxCompany.summary,
  };
}
