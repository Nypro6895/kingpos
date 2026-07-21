import {
  markLatestPayrollStatementPaidAction,
  savePayrollStatementAction,
  saveSalonPayrollScheduleAction,
} from "@/app/payroll/actions";
import { PayrollScheduleForm } from "@/app/payroll/payroll-schedule-form";
import { StaffIncomeAutosaveInputs } from "@/app/payroll/staff-income-autosave-inputs";
import { ShopIncomeDailyTable } from "@/app/payroll/shop-income-daily-table";
import { StaffPayrollSettingInlineEdit } from "@/app/payroll/staff-payroll-setting-inline-edit";
import {
  TaxCompanyCalculationGuide,
  TaxCompanyLinesTable,
} from "@/app/payroll/tax-company-table";
import {
  DismissPayrollMismatchButton,
  MarkPaidButton,
} from "@/app/payroll/payroll-mismatch-controls";
import { getPayrollPageData } from "@/lib/payroll";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import {
  buildPayrollOverviewAnalytics,
  type OverviewServiceRankMode,
  type OverviewTrendMode,
  type PayrollOverviewAnalytics,
  type PayrollOverviewFilters,
} from "@/lib/payroll-overview-analytics";
import type {
  PayrollCorrectionListItem,
  PayrollPeriod,
  PayrollStaffDailyTotal,
  PayrollStaffLineWithDailyTotals,
  PayrollShopDailyRow,
  PayrollShopSummary,
  SalonPayrollSetting,
  StaffPayrollSetting,
  StaffPayrollSettingWithStaff,
} from "@/types/payroll";
import Link from "next/link";
import { type ReactNode } from "react";

type PayrollPageProps = {
  searchParams: Promise<{
    end?: string;
    month?: string;
    overviewRange?: string;
    overviewService?: string;
    overviewServiceRank?: string;
    overviewStaff?: string;
    overviewTrend?: string;
    payPeriodStart?: string;
    payroll_error?: string;
    editStaff?: string;
    preset?: string;
    segment?: string;
    start?: string;
    tab?: string;
  }>;
};

type PayrollTab = "overview" | "staff" | "shop" | "tax" | "settings";

const TABS: Array<{ id: PayrollTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "staff", label: "Staff Income" },
  { id: "shop", label: "Shop Income" },
  { id: "tax", label: "Tax Company" },
  { id: "settings", label: "Settings" },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatOptionalMoney(value: number | null, emptyLabel = "-") {
  return value === null ? emptyLabel : formatMoney(value);
}

function formatPercent(value: number) {
  return `${Number(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function formatOnOff(value: boolean) {
  return value ? "On" : "Off";
}

function formatYesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function formatPayoutMethod(value: string) {
  return value === "check" ? "Check" : "Cash";
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRatioPercent(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedMoney(value: number) {
  const prefix = value > 0 ? "+" : "";

  return `${prefix}${formatMoney(value)}`;
}

const DATE_ONLY_DAY_MS = 24 * 60 * 60 * 1000;
const OVERVIEW_RANGES = ["today", "week", "month", "year"] as const;
type OverviewRange = (typeof OVERVIEW_RANGES)[number];

function dateOnlyFromUtcDateValue(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function dateFromDateOnlyValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDateOnlyDays(value: string, days: number) {
  return dateOnlyFromUtcDateValue(
    new Date(dateFromDateOnlyValue(value).getTime() + days * DATE_ONLY_DAY_MS),
  );
}

function getCurrentDateOnly() {
  return dateOnlyFromUtcDateValue(new Date());
}

function getWeekStartDate(value: string) {
  const date = dateFromDateOnlyValue(value);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return dateOnlyFromUtcDateValue(new Date(date.getTime() + mondayOffset * DATE_ONLY_DAY_MS));
}

function getOverviewRangeDates(range: OverviewRange) {
  const today = getCurrentDateOnly();
  const date = dateFromDateOnlyValue(today);

  if (range === "today") {
    return { endDate: today, startDate: today };
  }

  if (range === "week") {
    const startDate = getWeekStartDate(today);

    return { endDate: addDateOnlyDays(startDate, 6), startDate };
  }

  if (range === "year") {
    const year = date.getUTCFullYear();

    return {
      endDate: `${year}-12-31`,
      startDate: `${year}-01-01`,
    };
  }

  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const endDate = dateOnlyFromUtcDateValue(
    new Date(Date.UTC(year, date.getUTCMonth() + 1, 0)),
  );

  return {
    endDate,
    startDate: `${year}-${month}-01`,
  };
}

function getOverviewTrendMode(value: string | undefined): OverviewTrendMode {
  return value === "weekly" || value === "monthly" ? value : "daily";
}

function getOverviewServiceRankMode(
  value: string | undefined,
): OverviewServiceRankMode {
  return value === "count" ? "count" : "revenue";
}

function getOverviewRange(value: string | undefined): OverviewRange | null {
  return OVERVIEW_RANGES.includes(value as OverviewRange)
    ? (value as OverviewRange)
    : null;
}

function getActiveTab(value: string | undefined, canViewAllPayroll: boolean): PayrollTab {
  if (value === "staff") {
    return "staff";
  }

  if (canViewAllPayroll && (value === "shop" || value === "tax" || value === "settings")) {
    return value;
  }

  return "overview";
}

function getPayrollHref(input: {
  period: PayrollPeriod;
  tab: PayrollTab;
}) {
  const params = new URLSearchParams({
    preset: input.period.preset,
    tab: input.tab,
  });

  if (input.period.preset === "custom") {
    params.set("start", input.period.startDate);
    params.set("end", input.period.endDate);
  } else if (input.period.cycleType === "biweekly") {
    params.set("payPeriodStart", input.period.startDate);
  } else {
    params.set("month", input.period.startDate.slice(0, 7));
    if (input.period.cycleType === "semi_monthly") {
      params.set(
        "segment",
        input.period.preset === "semi_monthly_second" ? "second" : "first",
      );
    }
  }

  return `/payroll?${params.toString()}`;
}

function getTaxCompanyHref(period: PayrollPeriod) {
  const params = new URLSearchParams({
    preset: period.preset,
  });

  if (period.preset === "custom") {
    params.set("start", period.startDate);
    params.set("end", period.endDate);
  } else if (period.cycleType === "biweekly") {
    params.set("payPeriodStart", period.startDate);
  } else {
    params.set("month", period.startDate.slice(0, 7));
    if (period.cycleType === "semi_monthly") {
      params.set(
        "segment",
        period.preset === "semi_monthly_second" ? "second" : "first",
      );
    }
  }

  return `/payroll/tax-company?${params.toString()}`;
}

function setOverviewFilterParams(
  params: URLSearchParams,
  filters: PayrollOverviewFilters,
  range: OverviewRange | null,
) {
  params.set("overviewTrend", filters.trendMode);
  params.set("overviewServiceRank", filters.serviceRankMode);

  if (filters.staffId) {
    params.set("overviewStaff", filters.staffId);
  } else {
    params.delete("overviewStaff");
  }

  if (filters.serviceId) {
    params.set("overviewService", filters.serviceId);
  } else {
    params.delete("overviewService");
  }

  if (range) {
    params.set("overviewRange", range);
  } else {
    params.delete("overviewRange");
  }
}

function getOverviewHref(input: {
  filters: PayrollOverviewFilters;
  period: PayrollPeriod;
  range: OverviewRange | null;
  overrides?: Partial<PayrollOverviewFilters>;
}) {
  const params = new URLSearchParams(
    getPayrollHref({ period: input.period, tab: "overview" }).split("?")[1],
  );

  params.set("tab", "overview");
  setOverviewFilterParams(
    params,
    { ...input.filters, ...input.overrides },
    input.range,
  );

  return `/payroll?${params.toString()}`;
}

function getOverviewRangeHref(input: {
  filters: PayrollOverviewFilters;
  range: OverviewRange;
}) {
  const rangeDates = getOverviewRangeDates(input.range);
  const params = new URLSearchParams({
    end: rangeDates.endDate,
    preset: "custom",
    start: rangeDates.startDate,
    tab: "overview",
  });

  setOverviewFilterParams(params, input.filters, input.range);

  return `/payroll?${params.toString()}`;
}

const BANNER_CATEGORY_ORDER = [
  "income",
  "check",
  "cash payout",
  "paystub",
  "tax",
  "staff payout",
  "payroll",
];

function addBannerCategory(categories: Set<string>, category: string) {
  categories.add(category);
}

function addBannerCategoriesForField(categories: Set<string>, field: string) {
  if (
    [
      "bonus_amount",
      "earned_amount",
      "final_staff_income",
      "gross_sales",
      "staff_commission_gross",
      "tax_company_taxable_gross",
      "tip_amount",
    ].includes(field)
  ) {
    addBannerCategory(categories, "income");
  }

  if (
    [
      "base_check_amount",
      "bonus_check_amount",
      "check_gross",
      "check_net",
      "check_number",
      "final_check_amount",
      "tip_check_amount",
    ].includes(field)
  ) {
    addBannerCategory(categories, "check");
  }

  if (
    [
      "base_cash_amount",
      "bonus_cash_amount",
      "cash_amount",
      "final_cash_amount",
      "tip_cash_amount",
    ].includes(field)
  ) {
    addBannerCategory(categories, "cash payout");
  }

  if (field === "paystub") {
    addBannerCategory(categories, "paystub");
  }

  if (
    [
      "cash_to_tax_company",
      "tax_bonus",
      "tax_company_cash_amount",
      "tax_company_check_amount",
      "tax_company_enabled",
      "tax_rate_used",
      "tax_tips",
      "tax_withheld",
    ].includes(field)
  ) {
    addBannerCategory(categories, "tax");
  }

  if (field === "staff_status") {
    addBannerCategory(categories, "staff payout");
  }
}

function sortedBannerCategories(categories: Set<string>) {
  return Array.from(categories).sort((left, right) => {
    const leftIndex = BANNER_CATEGORY_ORDER.indexOf(left);
    const rightIndex = BANNER_CATEGORY_ORDER.indexOf(right);

    return (
      (leftIndex === -1 ? BANNER_CATEGORY_ORDER.length : leftIndex) -
        (rightIndex === -1 ? BANNER_CATEGORY_ORDER.length : rightIndex) ||
      left.localeCompare(right)
    );
  });
}

function getAffectedStaffSummary(
  difference: Awaited<ReturnType<typeof getPayrollPageData>>["difference"],
) {
  const staffById = new Map<
    string,
    { categories: Set<string>; staffId: string; staffName: string }
  >();

  for (const item of difference.actionItems) {
    const entry =
      staffById.get(item.staffId) ??
      {
        categories: new Set<string>(),
        staffId: item.staffId,
        staffName: item.staffName,
      };

    for (const change of item.changes) {
      addBannerCategoriesForField(entry.categories, change.field);
    }

    if (entry.categories.size === 0) {
      addBannerCategoriesForField(entry.categories, item.kind);
    }

    staffById.set(item.staffId, entry);
  }

  for (const staff of difference.staffDifferences) {
    const entry =
      staffById.get(staff.staffId) ??
      {
        categories: new Set<string>(),
        staffId: staff.staffId,
        staffName: staff.staffName,
      };

    for (const field of Object.keys(staff.differences)) {
      addBannerCategoriesForField(entry.categories, field);
    }

    if (entry.categories.size === 0) {
      addBannerCategory(entry.categories, "payroll");
    }

    staffById.set(staff.staffId, entry);
  }

  return Array.from(staffById.values())
    .map((entry) => ({
      categories: sortedBannerCategories(entry.categories),
      staffId: entry.staffId,
      staffName: entry.staffName,
    }))
    .sort((left, right) => left.staffName.localeCompare(right.staffName));
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);

  return `${dateLabel} at ${timeLabel}`;
}

function latestPayrollCorrection(corrections: PayrollCorrectionListItem[]) {
  return corrections
    .slice()
    .sort(
      (left, right) =>
        new Date(right.correctionDate).getTime() -
        new Date(left.correctionDate).getTime(),
    )[0];
}

function latestCorrectionNote(corrections: PayrollCorrectionListItem[]) {
  const correction = latestPayrollCorrection(corrections);

  if (!correction) {
    return null;
  }

  const changedBy = correction.changedByName?.trim() || "Admin";
  const staff = correction.staffName ? ` for ${correction.staffName}` : "";

  return `Latest change: ${changedBy} updated payroll${staff} on ${formatDateTime(
    correction.correctionDate,
  )}.`;
}

function getReturnPath(period: PayrollPeriod, tab: PayrollTab) {
  return getPayrollHref({ period, tab });
}

function getSettingsEditHref(period: PayrollPeriod, staffId: string) {
  const href = new URLSearchParams(getPayrollHref({ period, tab: "settings" }).split("?")[1]);
  href.set("editStaff", staffId);
  return `/payroll?${href.toString()}`;
}

function statusBadgeClass(kind: string) {
  if (kind === "paid") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (kind === "changed_since_print") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  if (kind === "printed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

function taxLineRateLabel(line: PayrollStaffLineWithDailyTotals) {
  if (line.is_mixed_rate && line.tax_withheld !== 0) {
    return "Mixed rate";
  }

  return formatPercent(line.tax_rate_used);
}

function dailyCommissionGross(dailyTotal: PayrollStaffDailyTotal) {
  if (dailyTotal.pay_type_used === "fixed") {
    return Number(dailyTotal.fixed_pay_amount_used ?? 0);
  }

  if (dailyTotal.pay_type_used === "commission") {
    return (
      (Number(dailyTotal.gross_sales) *
        Number(dailyTotal.commission_rate_used ?? 0)) /
      100
    );
  }

  return 0;
}

function CompactPayoutLabel({
  method,
  taxed,
}: {
  method: string;
  taxed: boolean;
}) {
  return (
    <span className="whitespace-nowrap text-[11px] font-medium text-zinc-500">
      {formatPayoutMethod(method)}
      {taxed ? (
        <>
          {" \u00b7 "}
          Tax
        </>
      ) : null}
    </span>
  );
}

function LedgerLine({
  children,
  emphasis = "normal",
  label,
  width = "wide",
}: {
  children: ReactNode;
  emphasis?: "normal" | "strong" | "total";
  label: string;
  width?: "short" | "wide";
}) {
  const valueClass =
    emphasis === "strong"
      ? "text-sm font-semibold text-zinc-950"
      : emphasis === "total"
        ? "text-[13px] font-semibold text-zinc-900"
        : "font-medium text-zinc-800";
  const gridClass =
    width === "short"
      ? "grid-cols-[54px_100px]"
      : "grid-cols-[82px_100px]";

  return (
    <div className={`grid ${gridClass} items-baseline gap-2`}>
      <dt className="text-zinc-500">{label}:</dt>
      <dd className={`min-w-0 text-right tabular-nums ${valueClass}`}>
        {children}
      </dd>
    </div>
  );
}

const INPUT_HISTORY_FIELD_LABELS: Record<string, string> = {
  bonus_amount: "Bonus",
  check_number: "Check #",
  note: "Note",
};

function inputHistoryLabel(changeType: string) {
  return changeType === "correction_request"
    ? "Correction request"
    : "Input update";
}

function inputHistoryFields(
  fieldChanges: Record<string, { current: unknown; previous: unknown }>,
) {
  const fields = Object.keys(fieldChanges);

  if (fields.length === 0) {
    return "No field changes";
  }

  return fields.map((field) => INPUT_HISTORY_FIELD_LABELS[field] ?? field).join(", ");
}

type SettingChange = {
  current: string;
  label: string;
  previous: string | null;
};

function settingCashToTaxCompany(setting: StaffPayrollSetting) {
  return Boolean(setting.cash_to_tax_company);
}

function describeSettingChanges(
  current: StaffPayrollSetting,
  previous: StaffPayrollSetting | null,
): SettingChange[] {
  if (!previous) {
    return [
      {
        current: "Saved",
        label: "Initial setting",
        previous: null,
      },
    ];
  }

  const changes: SettingChange[] = [];
  const addChange = (label: string, previousValue: string, currentValue: string) => {
    if (previousValue !== currentValue) {
      changes.push({
        current: currentValue,
        label,
        previous: previousValue,
      });
    }
  };

  addChange("Legal name", previous.legal_name ?? "-", current.legal_name ?? "-");
  addChange("Pay type", previous.pay_type, current.pay_type);
  addChange(
    "Commission rate",
    formatPercent(previous.commission_rate),
    formatPercent(current.commission_rate),
  );
  addChange(
    "Fixed pay",
    formatMoney(previous.fixed_pay_amount),
    formatMoney(current.fixed_pay_amount),
  );
  addChange(
    "Check split",
    formatPercent(previous.check_rate),
    formatPercent(current.check_rate),
  );
  addChange("Tax", formatPercent(previous.tax_rate), formatPercent(current.tax_rate));
  addChange(
    "Tax fixed",
    formatYesNo(previous.apply_tax_to_fixed_pay),
    formatYesNo(current.apply_tax_to_fixed_pay),
  );
  addChange(
    "Tax tip",
    formatYesNo(previous.tax_tips),
    formatYesNo(current.tax_tips),
  );
  addChange(
    "Tax bonus",
    formatYesNo(previous.tax_bonus),
    formatYesNo(current.tax_bonus),
  );

  const previousCashToTaxCompany = settingCashToTaxCompany(previous);
  const currentCashToTaxCompany = settingCashToTaxCompany(current);
  const showCashToTaxCompanyChange =
    previousCashToTaxCompany !== currentCashToTaxCompany;

  if (showCashToTaxCompanyChange) {
    addChange(
      "Tax cash",
      formatOnOff(previousCashToTaxCompany),
      formatOnOff(currentCashToTaxCompany),
    );
  }

  addChange(
    "Tip payout",
    formatPayoutMethod(previous.tip_payout_method),
    formatPayoutMethod(current.tip_payout_method),
  );
  addChange(
    "Bonus payout",
    formatPayoutMethod(previous.bonus_payout_method),
    formatPayoutMethod(current.bonus_payout_method),
  );

  return changes;
}

function HiddenPeriodFields({
  period,
  returnPath,
}: {
  period: PayrollPeriod;
  returnPath: string;
}) {
  return (
    <>
      <input name="cycle_type" type="hidden" value={period.cycleType} />
      <input name="period_start" type="hidden" value={period.startDate} />
      <input name="period_end" type="hidden" value={period.endDate} />
      <input name="return_to" type="hidden" value={returnPath} />
    </>
  );
}

function ShopIncomeCard({
  label,
  subLines,
  tone = "default",
  value,
}: {
  label: string;
  subLines: Array<{ label: string; value: string }>;
  tone?: "default" | "warning";
  value: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-white p-4 shadow-sm ${
        tone === "warning" ? "border-rose-200" : "border-zinc-200"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p
        className={`mt-2 text-2xl font-semibold ${
          tone === "warning" ? "text-rose-700" : "text-zinc-950"
        }`}
      >
        {value}
      </p>
      <dl className="mt-3 grid gap-1 text-sm text-zinc-600">
        {subLines.map((line) => (
          <div className="flex items-center justify-between gap-3" key={line.label}>
            <dt>{line.label}</dt>
            <dd className="font-medium text-zinc-800">{line.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function monthInputFromPeriod(period: PayrollPeriod) {
  return period.startDate.slice(0, 7);
}

function NoPermissionState({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
      <p className="text-sm font-medium text-zinc-500">Payroll</p>
      <h1 className="text-3xl font-semibold text-zinc-950">Payroll could not load</h1>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {message}
      </p>
      <Link className="text-sm font-medium text-zinc-700 underline" href="/">
        Back to dashboard
      </Link>
    </main>
  );
}

function PeriodSelector({
  activeTab,
  period,
  periodOptions,
  salonPayrollSetting,
  scheduleSetup,
}: {
  activeTab: PayrollTab;
  period: PayrollPeriod;
  periodOptions: Awaited<ReturnType<typeof getPayrollPageData>>["periodOptions"];
  salonPayrollSetting: SalonPayrollSetting;
  scheduleSetup: Awaited<ReturnType<typeof getPayrollPageData>>["scheduleSetup"];
}) {
  const scheduleCycle = salonPayrollSetting.cycle_type;
  const missingBiweeklyAnchor = scheduleSetup.needsBiweeklyAnchor;

  return (
    <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <form
        action="/payroll"
        className="flex flex-wrap items-end gap-3"
      >
        <input name="tab" type="hidden" value={activeTab} />
        {scheduleCycle === "monthly" ? (
          <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-zinc-700">
            Month
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={monthInputFromPeriod(period)}
              name="month"
              type="month"
            />
          </label>
        ) : null}
        {scheduleCycle === "semi_monthly" ? (
          <>
            <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-zinc-700">
              Month
              <input
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                defaultValue={monthInputFromPeriod(period)}
                name="month"
                type="month"
              />
            </label>
            <label className="flex min-w-64 flex-col gap-1 text-sm font-medium text-zinc-700">
              Period
              <select
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                defaultValue={
                  period.preset === "semi_monthly_second" ? "second" : "first"
                }
                name="segment"
              >
                <option value="first">First: 1 - 15</option>
                <option value="second">Second: 16 - end of month</option>
              </select>
            </label>
          </>
        ) : null}
        {scheduleCycle === "biweekly" ? (
          <label className="flex min-w-72 flex-col gap-1 text-sm font-medium text-zinc-700">
            Pay period
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              disabled={missingBiweeklyAnchor}
              name="payPeriodStart"
              defaultValue={period.startDate}
            >
              {missingBiweeklyAnchor ? (
                <option value="">Set anchor in Settings</option>
              ) : (
                periodOptions.map((option) => (
                  <option key={option.value} value={option.startDate}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
          </label>
        ) : null}
        <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Apply
        </button>
      </form>
      {missingBiweeklyAnchor ? (
        <p className="text-sm text-amber-700">
          Every-2-weeks payroll needs an anchor date. Update it in Settings.
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-600">
          Advanced custom range
        </summary>
        <form action="/payroll" className="mt-3 flex flex-wrap items-end gap-3">
          <input name="tab" type="hidden" value={activeTab} />
          <input name="preset" type="hidden" value="custom" />
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            Start
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.startDate}
              name="start"
              type="date"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            End
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.endDate}
              name="end"
              type="date"
            />
          </label>
          <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800">
            Apply Custom
          </button>
        </form>
      </details>
    </section>
  );
}

function TopActions({
  canManage,
  hasLiveDifference,
  latestStatement,
  period,
  returnPath,
}: {
  canManage: boolean;
  hasLiveDifference: boolean;
  latestStatement: Awaited<ReturnType<typeof getPayrollPageData>>["latestStatement"];
  period: PayrollPeriod;
  returnPath: string;
}) {
  const canMarkPaid = Boolean(latestStatement && latestStatement.run.status !== "paid");

  return (
    <div className="flex flex-wrap gap-2">
      <form action={savePayrollStatementAction}>
        <HiddenPeriodFields period={period} returnPath={returnPath} />
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={!canManage}
        >
          Print / Save Statement
        </button>
      </form>
      <button
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50"
        disabled
        title="Export is not implemented yet."
        type="button"
      >
        Export
      </button>
      <form action={markLatestPayrollStatementPaidAction}>
        <HiddenPeriodFields period={period} returnPath={returnPath} />
        <input
          name="payroll_run_id"
          type="hidden"
          value={latestStatement?.run.id ?? ""}
        />
        <MarkPaidButton
          canManage={canManage}
          canMarkPaid={canMarkPaid}
          hasLiveDifference={hasLiveDifference}
        />
      </form>
      {latestStatement && latestStatement.run.status !== "paid" && hasLiveDifference ? (
        <p className="basis-full text-xs font-medium text-amber-700">
          Review differences or print a new statement before marking paid.
        </p>
      ) : null}
    </div>
  );
}

function Tabs({
  activeTab,
  canViewAllPayroll,
  period,
}: {
  activeTab: PayrollTab;
  canViewAllPayroll: boolean;
  period: PayrollPeriod;
}) {
  const visibleTabs = canViewAllPayroll
    ? TABS
    : TABS.filter((tab) => tab.id === "overview" || tab.id === "staff");

  return (
    <nav className="flex flex-wrap gap-2 border-b border-zinc-200">
      {visibleTabs.map((tab) => {
        const active = tab.id === activeTab;

        return (
          <Link
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-zinc-950 text-zinc-950"
                : "border-transparent text-zinc-500 hover:text-zinc-950"
            }`}
            href={getPayrollHref({ period, tab: tab.id })}
            key={tab.id}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function DifferenceBanner({
  canManage,
  corrections,
  difference,
  period,
  returnPath,
}: {
  canManage: boolean;
  corrections: PayrollCorrectionListItem[];
  difference: Awaited<ReturnType<typeof getPayrollPageData>>["difference"];
  period: PayrollPeriod;
  returnPath: string;
}) {
  if (!difference.changed) {
    return null;
  }

  const affectedStaff = getAffectedStaffSummary(difference);
  const visibleAffectedStaff = affectedStaff.slice(0, 5);
  const moreAffectedStaffCount = Math.max(
    affectedStaff.length - visibleAffectedStaff.length,
    0,
  );
  const correctionNote = latestCorrectionNote(corrections);
  const staffIncomeHref = getPayrollHref({ period, tab: "staff" });

  return (
    <section
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
      id="payroll-differences"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Live payroll has changed since last print.</p>
          <p>
            The printed statement is outdated because payroll was changed after
            it was printed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md bg-zinc-950 px-3 py-2 font-medium text-white"
            href={staffIncomeHref}
          >
            Review Staff Income
          </Link>
          <form action={savePayrollStatementAction}>
            <HiddenPeriodFields period={period} returnPath={returnPath} />
            <button
              className="rounded-md border border-zinc-950 bg-white px-3 py-2 font-medium text-zinc-950 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400"
              disabled={!canManage}
            >
              Print New Statement
            </button>
          </form>
          <DismissPayrollMismatchButton targetId="payroll-differences" />
        </div>
      </div>
      {affectedStaff.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase text-amber-800">
            {affectedStaff.length} staff affected
          </p>
          <ul className="mt-2 grid gap-1.5 text-zinc-800 md:grid-cols-2">
            {visibleAffectedStaff.map((staff) => (
              <li key={staff.staffId}>
                <span className="font-medium text-zinc-950">{staff.staffName}</span>
                {" - "}
                {staff.categories.length > 0
                  ? `${staff.categories.join(" / ")} changed`
                  : "payroll changed"}
              </li>
            ))}
          </ul>
          {moreAffectedStaffCount > 0 ? (
            <p className="mt-2 text-sm font-medium text-amber-900">
              +{moreAffectedStaffCount} more staff affected
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-amber-200 bg-white/75 p-3">
          <p className="font-semibold text-zinc-950">Shop / POS totals changed</p>
          <p className="text-zinc-700">
            No staff payout action was detected, but the live shop totals differ
            from the printed statement.
          </p>
        </div>
      )}
      {correctionNote ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-white/70 p-3 text-zinc-800">
          {correctionNote}
        </p>
      ) : null}
    </section>
  );
}

function getStatusSubtitle(data: Awaited<ReturnType<typeof getPayrollPageData>>) {
  if (!data.latestStatement) {
    return "Live payroll - not printed yet";
  }

  if (data.latestStatement.run.status === "paid") {
    return `Statement v${data.latestStatement.run.version} marked paid`;
  }

  if (data.difference.changed) {
    return `Live payroll differs from statement v${data.latestStatement.run.version}`;
  }

  return `Latest statement v${data.latestStatement.run.version} - live matches statement`;
}

function OverviewFilters({
  filters,
  lines,
  period,
  range,
  serviceAnalytics,
}: {
  filters: PayrollOverviewFilters;
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
  range: OverviewRange | null;
  serviceAnalytics: Awaited<ReturnType<typeof getPayrollPageData>>["serviceAnalytics"];
}) {
  const ranges: Array<{ id: OverviewRange; label: string }> = [
    { id: "today", label: "Today" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
    { id: "year", label: "Year" },
  ];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
          {ranges.map((option) => {
            const active = range === option.id;

            return (
              <Link
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  active
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-950"
                }`}
                href={getOverviewRangeHref({ filters, range: option.id })}
                key={option.id}
              >
                {option.label}
              </Link>
            );
          })}
        </div>

        <form action="/payroll" className="flex flex-1 flex-wrap items-end gap-2">
          <input name="tab" type="hidden" value="overview" />
          <input name="preset" type="hidden" value="custom" />
          <input name="overviewTrend" type="hidden" value={filters.trendMode} />
          <input
            name="overviewServiceRank"
            type="hidden"
            value={filters.serviceRankMode}
          />
          {range ? <input name="overviewRange" type="hidden" value={range} /> : null}

          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
            Start
            <input
              className="h-9 w-36 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={period.startDate}
              name="start"
              type="date"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
            End
            <input
              className="h-9 w-36 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={period.endDate}
              name="end"
              type="date"
            />
          </label>
          <label className="flex min-w-40 flex-col gap-1 text-xs font-medium text-zinc-600">
            Staff
            <select
              className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={filters.staffId ?? ""}
              name="overviewStaff"
            >
              <option value="">All Staff</option>
              {lines.map((line) => (
                <option key={line.staff_id} value={line.staff_id}>
                  {line.staff_display_name_snapshot}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-44 flex-col gap-1 text-xs font-medium text-zinc-600">
            Service
            <select
              className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={filters.serviceId ?? ""}
              name="overviewService"
            >
              <option value="">All Services</option>
              {serviceAnalytics.rows.map((service) => (
                <option key={service.serviceId} value={service.serviceId}>
                  {service.serviceName}
                </option>
              ))}
            </select>
          </label>
          <button className="h-9 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white">
            Apply
          </button>
          <button
            className="h-9 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-500 disabled:cursor-not-allowed disabled:bg-zinc-50"
            disabled
            title="Export is not implemented yet."
            type="button"
          >
            Export
          </button>
        </form>
      </div>
    </section>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const cleanValues = values.filter((value) => Number.isFinite(value));

  if (cleanValues.length < 2) {
    return null;
  }

  const width = 96;
  const height = 28;
  const min = Math.min(...cleanValues);
  const max = Math.max(...cleanValues);
  const range = max - min || 1;
  const points = cleanValues
    .map((value, index) => {
      const x = (index / (cleanValues.length - 1)) * width;
      const y = height - ((value - min) / range) * height;

      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className="h-7 w-24 text-blue-500"
      preserveAspectRatio="none"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function BusinessSnapshotCards({ analytics }: { analytics: PayrollOverviewAnalytics }) {
  const snapshot = analytics.snapshot;
  const cards = [
    {
      helper: "Ticket/POS revenue",
      label: "POS Revenue",
      tone: "default",
      trend: analytics.trend.map((point) => point.revenue),
      value: snapshot.posRevenue,
    },
    {
      helper: "Cash + check + card received",
      label: "Actual Received",
      tone: "default",
      trend: [],
      value: snapshot.actualReceived,
    },
    {
      helper: "Cash payout + actual check paid",
      label: "Staff Payout",
      tone: "warning",
      trend: analytics.trend.map((point) => point.staffPayout),
      value: snapshot.staffPayout,
    },
    {
      helper: "After staff payout and payroll tax",
      label: "Shop Net",
      tone:
        snapshot.shopNet === null
          ? "default"
          : snapshot.shopNet < 0
            ? "negative"
            : "positive",
      trend: analytics.trend
        .map((point) => point.shopNet)
        .filter((value): value is number => value !== null),
      value: snapshot.shopNet,
    },
    {
      helper: "Actual received minus POS revenue",
      label: "Over / Short",
      tone:
        snapshot.overShort === null
          ? "default"
          : snapshot.overShort < 0
            ? "negative"
            : snapshot.overShort > 0
              ? "positive"
              : "default",
      trend: [],
      value: snapshot.overShort,
    },
  ];

  return (
    <section className="grid gap-3 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
          key={card.label}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {card.label}
              </p>
              <p
                className={`mt-2 text-2xl font-semibold tabular-nums ${
                  card.tone === "negative"
                    ? "text-rose-700"
                    : card.tone === "positive"
                      ? "text-emerald-700"
                      : card.tone === "warning"
                        ? "text-amber-700"
                        : "text-zinc-950"
                }`}
              >
                {card.value === null
                  ? "N/A"
                  : card.label === "Over / Short"
                    ? formatSignedMoney(card.value)
                    : formatMoney(card.value)}
              </p>
            </div>
            <Sparkline values={card.trend} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{card.helper}</p>
          <p className="mt-1 text-[11px] text-zinc-400">Previous period unavailable</p>
        </div>
      ))}
    </section>
  );
}

function CorrectionAlertBanner({
  corrections,
  difference,
  period,
}: {
  corrections: PayrollCorrectionListItem[];
  difference: Awaited<ReturnType<typeof getPayrollPageData>>["difference"];
  period: PayrollPeriod;
}) {
  if (!difference.changed && corrections.length === 0) {
    return null;
  }

  const affectedStaff = difference.changed ? getAffectedStaffSummary(difference) : [];
  const correctionStaffNames = Array.from(
    new Set(corrections.map((correction) => correction.staffName).filter(Boolean)),
  );
  const visibleStaff = affectedStaff.slice(0, 3);
  const categories = Array.from(
    new Set(affectedStaff.flatMap((staff) => staff.categories)),
  );
  const latestCorrection = latestPayrollCorrection(corrections);
  const staffSummary =
    visibleStaff.length > 0
      ? visibleStaff.map((staff) => staff.staffName).join(", ")
      : correctionStaffNames.length > 0
        ? correctionStaffNames.slice(0, 3).join(", ")
        : "Shop / POS totals";
  const fieldSummary = categories.length > 0 ? categories.join(", ") : "payroll";

  return (
    <section
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      id="overview-correction-alert"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Statement or correction activity needs review.</p>
          <p className="mt-1 text-amber-900">
            {staffSummary} have {fieldSummary} changes
            {latestCorrection
              ? `, latest ${formatDateTime(latestCorrection.correctionDate)}`
              : ""}
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-white"
            href={getPayrollHref({ period, tab: "staff" })}
          >
            View Details
          </Link>
          <DismissPayrollMismatchButton targetId="overview-correction-alert" />
        </div>
      </div>
    </section>
  );
}

function AnalyticsPanel({
  action,
  children,
  className = "",
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  title: string;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white p-4 shadow-sm ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ChartLine({
  color,
  getValue,
  max,
  min,
  points,
}: {
  color: string;
  getValue: (point: PayrollOverviewAnalytics["trend"][number]) => number | null;
  max: number;
  min: number;
  points: PayrollOverviewAnalytics["trend"];
}) {
  const width = 720;
  const height = 240;
  const paddingX = 28;
  const paddingY = 18;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2;
  const valueRange = max - min || 1;
  const coordinates = points
    .map((point, index) => {
      const value = getValue(point);

      if (value === null) {
        return null;
      }

      const x =
        paddingX +
        (points.length === 1 ? 0 : (index / (points.length - 1)) * chartWidth);
      const y = paddingY + chartHeight - ((value - min) / valueRange) * chartHeight;

      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .filter((point): point is string => point !== null);

  if (coordinates.length < 2) {
    return null;
  }

  return (
    <polyline
      fill="none"
      points={coordinates.join(" ")}
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="3"
    />
  );
}

function RevenuePayrollProfitChart({
  analytics,
  filters,
  period,
  range,
}: {
  analytics: PayrollOverviewAnalytics;
  filters: PayrollOverviewFilters;
  period: PayrollPeriod;
  range: OverviewRange | null;
}) {
  const modes: Array<{ id: OverviewTrendMode; label: string }> = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "monthly", label: "Monthly" },
  ];
  const values = analytics.trend
    .flatMap((point) => [point.revenue, point.staffPayout, point.shopNet])
    .filter((value): value is number => value !== null);
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const labelEvery = Math.max(1, Math.ceil(analytics.trend.length / 4));

  return (
    <AnalyticsPanel
      action={
        <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
          {modes.map((mode) => (
            <Link
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                filters.trendMode === mode.id
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-950"
              }`}
              href={getOverviewHref({
                filters,
                overrides: { trendMode: mode.id },
                period,
                range,
              })}
              key={mode.id}
            >
              {mode.label}
            </Link>
          ))}
        </div>
      }
      className="lg:col-span-8"
      title="Revenue, Payroll & Shop Net Trend"
    >
      {analytics.trend.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500">
          No trend data for this filter.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg
              aria-label="Revenue, staff payout, and shop net trend"
              className="h-72 min-w-[720px] text-zinc-400"
              preserveAspectRatio="none"
              viewBox="0 0 720 240"
            >
              <line stroke="#e4e4e7" strokeWidth="1" x1="28" x2="692" y1="222" y2="222" />
              <line stroke="#e4e4e7" strokeWidth="1" x1="28" x2="692" y1="120" y2="120" />
              <line stroke="#e4e4e7" strokeWidth="1" x1="28" x2="692" y1="18" y2="18" />
              <ChartLine
                color="#2563eb"
                getValue={(point) => point.revenue}
                max={max}
                min={min}
                points={analytics.trend}
              />
              <ChartLine
                color="#f97316"
                getValue={(point) => point.staffPayout}
                max={max}
                min={min}
                points={analytics.trend}
              />
              <ChartLine
                color="#059669"
                getValue={(point) => point.shopNet}
                max={max}
                min={min}
                points={analytics.trend}
              />
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <div className="flex flex-wrap gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-blue-600" />
                Revenue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-orange-500" />
                Staff Payout
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-emerald-600" />
                Shop Net
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {analytics.trend.map((point, index) =>
                index % labelEvery === 0 || index === analytics.trend.length - 1 ? (
                  <span key={point.key}>{point.label}</span>
                ) : null,
              )}
            </div>
          </div>
        </>
      )}
    </AnalyticsPanel>
  );
}

function AccountingLine({
  label,
  strong = false,
  tone = "default",
  value,
}: {
  label: string;
  strong?: boolean;
  tone?: "default" | "good" | "warning";
  value: number | null;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-zinc-100 py-2 last:border-b-0">
      <span className="text-zinc-600">{label}</span>
      <span
        className={`text-right tabular-nums ${
          strong ? "font-semibold" : "font-medium"
        } ${
          tone === "good"
            ? "text-emerald-700"
            : tone === "warning"
              ? "text-rose-700"
              : "text-zinc-950"
        }`}
      >
        {value === null ? "N/A" : formatMoney(value)}
      </span>
    </div>
  );
}

function PaymentAccountingSummary({
  analytics,
}: {
  analytics: PayrollOverviewAnalytics;
}) {
  const accounting = analytics.accounting;

  return (
    <AnalyticsPanel className="lg:col-span-4" title="Payment & Accounting Summary">
      <div className="grid gap-4 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
            Money Received
          </p>
          <AccountingLine label="Cash Received" value={accounting.cashReceived} />
          <AccountingLine label="Check Received" value={accounting.checkReceived} />
          <AccountingLine label="Card Received" value={accounting.cardReceived} />
          <AccountingLine
            label="Total Actual Received"
            strong
            value={accounting.totalActualReceived}
          />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-700">
            Money Paid / Deducted
          </p>
          <AccountingLine label="Cash Payout" value={accounting.cashPayout} />
          <AccountingLine
            label="Actual Check Paid"
            value={accounting.actualCheckPaid}
          />
          <AccountingLine label="Payroll Tax" value={accounting.payrollTax} />
          <AccountingLine
            label="Net After Payout & Tax"
            strong
            tone={
              accounting.netAfterPayoutAndTax !== null &&
              accounting.netAfterPayoutAndTax < 0
                ? "warning"
                : "good"
            }
            value={accounting.netAfterPayoutAndTax}
          />
        </div>
      </div>
    </AnalyticsPanel>
  );
}

function StaffPerformancePanel({
  analytics,
  period,
}: {
  analytics: PayrollOverviewAnalytics;
  period: PayrollPeriod;
}) {
  return (
    <AnalyticsPanel
      action={
        <Link
          className="text-xs font-medium text-blue-700 hover:text-blue-900"
          href={getPayrollHref({ period, tab: "staff" })}
        >
          View all staff income -&gt;
        </Link>
      }
      className="lg:col-span-6"
      title="Staff Performance"
    >
      {analytics.staffPerformance.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          No staff income for this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4">Staff</th>
                <th className="py-2 pr-4 text-right">Service Sales</th>
                <th className="py-2 pr-4 text-right">Commission</th>
                <th className="py-2 pr-4 text-right">Tips</th>
                <th className="py-2 pr-4 text-right">Bonus</th>
                <th className="py-2 pr-4 text-right">Total Income</th>
                <th className="py-2 text-right">Growth %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {analytics.staffPerformance.map((row) => (
                <tr key={row.staffId}>
                  <td className="py-2 pr-4">
                    <div className="font-medium text-zinc-950">{row.staffName}</div>
                    {row.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.tags.map((tag) => (
                          <span
                            className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700"
                            key={tag}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.serviceSales)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.commission)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.tips)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.bonus)}
                  </td>
                  <td className="py-2 pr-4 text-right font-semibold tabular-nums text-zinc-950">
                    {formatMoney(row.totalIncome)}
                  </td>
                  <td className="py-2 text-right text-zinc-500">
                    {formatRatioPercent(row.growthPercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsPanel>
  );
}

function ServiceAnalyticsPanel({
  analytics,
  filters,
  period,
  range,
}: {
  analytics: PayrollOverviewAnalytics;
  filters: PayrollOverviewFilters;
  period: PayrollPeriod;
  range: OverviewRange | null;
}) {
  const rankModes: Array<{ id: OverviewServiceRankMode; label: string }> = [
    { id: "revenue", label: "By Revenue" },
    { id: "count", label: "By Count" },
  ];
  const maxRevenue = Math.max(
    1,
    ...analytics.servicePerformance.map((row) => row.revenue),
  );
  const maxCount = Math.max(1, ...analytics.servicePerformance.map((row) => row.count));

  return (
    <AnalyticsPanel
      action={
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
            {rankModes.map((mode) => (
              <Link
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  filters.serviceRankMode === mode.id
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-950"
                }`}
                href={getOverviewHref({
                  filters,
                  overrides: { serviceRankMode: mode.id },
                  period,
                  range,
                })}
                key={mode.id}
              >
                {mode.label}
              </Link>
            ))}
          </div>
          <Link
            className="hidden text-xs font-medium text-blue-700 hover:text-blue-900 sm:inline"
            href="/services"
          >
            View all services -&gt;
          </Link>
        </div>
      }
      className="lg:col-span-6"
      title="Service Analytics"
    >
      {analytics.servicePerformance.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          No service analytics for this period.
        </p>
      ) : (
        <div className="grid gap-3">
          {analytics.servicePerformance.map((row) => {
            const basis =
              filters.serviceRankMode === "count"
                ? row.count / maxCount
                : row.revenue / maxRevenue;

            return (
              <div className="grid gap-1" key={row.serviceId}>
                <div className="grid grid-cols-[1fr_auto] gap-3 text-sm">
                  <span className="truncate font-medium text-zinc-950">
                    {row.serviceName}
                  </span>
                  <span className="text-right tabular-nums text-zinc-700">
                    {formatCount(row.count)} / {formatMoney(row.revenue)} /{" "}
                    {formatRatioPercent(row.percentOfRevenue)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${Math.max(3, basis * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AnalyticsPanel>
  );
}

function BusinessHealthCards({ analytics }: { analytics: PayrollOverviewAnalytics }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">Business Health</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {analytics.health.map((metric) => (
          <div
            className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
            key={metric.label}
          >
            <p className="text-xs font-medium text-zinc-500">{metric.label}</p>
            <p
              className={`mt-1 text-lg font-semibold tabular-nums ${
                metric.tone === "warning"
                  ? "text-amber-700"
                  : metric.tone === "good"
                    ? "text-emerald-700"
                    : "text-zinc-950"
              }`}
            >
              {metric.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryTable({
  columns,
  emptyLabel,
  rows,
  title,
}: {
  columns: "weekly" | "monthly";
  emptyLabel: string;
  rows: PayrollOverviewAnalytics["weeklySummary"];
  title: string;
}) {
  return (
    <AnalyticsPanel title={title}>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center text-sm text-zinc-500">
          {emptyLabel}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4">{columns === "weekly" ? "Week" : "Month"}</th>
                <th className="py-2 pr-4 text-right">Revenue</th>
                <th className="py-2 pr-4 text-right">Actual Received</th>
                <th className="py-2 pr-4 text-right">Staff Payout</th>
                {columns === "weekly" ? (
                  <th className="py-2 pr-4 text-right">Over / Short</th>
                ) : (
                  <th className="py-2 pr-4 text-right">Payroll Ratio</th>
                )}
                <th className="py-2 text-right">Shop Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="py-2 pr-4 font-medium text-zinc-950">{row.label}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.revenue)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatOptionalMoney(row.actualReceived, "N/A")}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.staffPayout)}
                  </td>
                  {columns === "weekly" ? (
                    <td
                      className={`py-2 pr-4 text-right tabular-nums ${
                        row.overShort !== null && row.overShort < 0
                          ? "text-rose-700"
                          : row.overShort !== null && row.overShort > 0
                            ? "text-emerald-700"
                            : "text-zinc-700"
                      }`}
                    >
                      {row.overShort === null ? "N/A" : formatSignedMoney(row.overShort)}
                    </td>
                  ) : (
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatRatioPercent(row.payrollRatio)}
                    </td>
                  )}
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatOptionalMoney(row.shopNet, "N/A")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AnalyticsPanel>
  );
}

function WeeklyMonthlySummary({ analytics }: { analytics: PayrollOverviewAnalytics }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <SummaryTable
        columns="weekly"
        emptyLabel="No weekly summary for this filter."
        rows={analytics.weeklySummary}
        title="Weekly Summary"
      />
      <SummaryTable
        columns="monthly"
        emptyLabel="No monthly summary for this filter."
        rows={analytics.monthlySummary}
        title="Monthly Summary"
      />
    </section>
  );
}

function KeyInsightsPanel({ analytics }: { analytics: PayrollOverviewAnalytics }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">Key Insights</h2>
      {analytics.insights.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
          No reliable insights yet.
        </p>
      ) : (
        <ul className="mt-3 grid gap-2 text-sm text-zinc-700">
          {analytics.insights.map((insight) => (
            <li className="rounded-md bg-zinc-50 px-3 py-2" key={insight}>
              {insight}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OverviewTab({
  corrections,
  difference,
  filters,
  lines,
  period,
  range,
  serviceAnalytics,
  shopDailyRows,
  shopSummary,
}: {
  corrections: PayrollCorrectionListItem[];
  difference: Awaited<ReturnType<typeof getPayrollPageData>>["difference"];
  filters: PayrollOverviewFilters;
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
  range: OverviewRange | null;
  serviceAnalytics: Awaited<ReturnType<typeof getPayrollPageData>>["serviceAnalytics"];
  shopDailyRows: PayrollShopDailyRow[];
  shopSummary: PayrollShopSummary;
}) {
  const analytics = buildPayrollOverviewAnalytics({
    filters,
    lines,
    period,
    serviceAnalytics,
    shopDailyRows,
    shopSummary,
  });

  return (
    <section className="grid gap-4">
      <OverviewFilters
        filters={filters}
        lines={lines}
        period={period}
        range={range}
        serviceAnalytics={serviceAnalytics}
      />
      {!analytics.hasPayrollData ? (
        <p className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 shadow-sm">
          No payroll data for this period.
        </p>
      ) : (
        <>
          <BusinessSnapshotCards analytics={analytics} />
          <CorrectionAlertBanner
            corrections={corrections}
            difference={difference}
            period={period}
          />
          {analytics.filterNotice ? (
            <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              {analytics.filterNotice}
            </p>
          ) : null}
          <section className="grid gap-4 lg:grid-cols-12">
            <RevenuePayrollProfitChart
              analytics={analytics}
              filters={filters}
              period={period}
              range={range}
            />
            <PaymentAccountingSummary analytics={analytics} />
          </section>
          <section className="grid gap-4 lg:grid-cols-12">
            <StaffPerformancePanel analytics={analytics} period={period} />
            <ServiceAnalyticsPanel
              analytics={analytics}
              filters={filters}
              period={period}
              range={range}
            />
          </section>
          <BusinessHealthCards analytics={analytics} />
          <WeeklyMonthlySummary analytics={analytics} />
          <KeyInsightsPanel analytics={analytics} />
        </>
      )}
    </section>
  );
}

function StaffIncomeTab({
  canManage,
  lines,
  period,
}: {
  canManage: boolean;
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No staff income lines for this period.
      </p>
    );
  }

  return (
    <section className="grid gap-2">
      <div className="hidden rounded border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 md:grid md:grid-cols-[minmax(145px,0.78fr)_minmax(150px,0.8fr)_minmax(195px,1fr)_minmax(230px,1.1fr)]">
        <span>Staff</span>
        <span>Actual Payout</span>
        <span>Wage / Net Details</span>
        <span>Tax / Add-ons / Inputs</span>
      </div>
      {lines.map((line) => (
        <section
          className="overflow-hidden rounded border border-zinc-200 bg-white text-xs"
          key={line.staff_id}
        >
            <div className="grid gap-0 md:grid-cols-[minmax(145px,0.78fr)_minmax(150px,0.8fr)_minmax(195px,1fr)_minmax(230px,1.1fr)]">
              <section className="border-b border-zinc-100 px-3 py-2 md:border-b-0 md:border-r">
                <p className="truncate text-sm font-semibold text-zinc-950">
                  {line.staff_display_name_snapshot}
                </p>
                {!line.staff_legal_name_snapshot ? (
                  <p className="mt-0.5 text-[11px] font-medium text-amber-700">
                    Missing legal name
                  </p>
                ) : null}
              </section>

              <section className="border-b border-zinc-100 px-3 py-2 md:border-b-0 md:border-r">
                <dl className="grid gap-1">
                  <LedgerLine emphasis="strong" label="Cash" width="short">
                    {formatMoney(line.final_cash_amount)}
                  </LedgerLine>
                  <LedgerLine emphasis="strong" label="Check" width="short">
                    <span
                      className={
                        line.final_check_amount < 0 ? "text-rose-700" : undefined
                      }
                    >
                      {formatMoney(line.final_check_amount)}
                    </span>
                  </LedgerLine>
                  <LedgerLine emphasis="total" label="Total" width="short">
                    {formatMoney(line.final_staff_income)}
                  </LedgerLine>
                </dl>
              </section>

              <section className="border-b border-zinc-100 px-3 py-2 md:border-b-0 md:border-r">
                <dl className="grid gap-1">
                  <LedgerLine label="Shop Gross">
                    {formatMoney(line.gross_sales)}
                  </LedgerLine>
                  <LedgerLine label="Comm Gross">
                    {formatMoney(line.staff_commission_gross)}
                  </LedgerLine>
                  <LedgerLine label="Cash Net">
                    {formatMoney(line.base_cash_amount)}
                  </LedgerLine>
                  <LedgerLine label="Check Net">
                    {formatMoney(line.check_net)}
                  </LedgerLine>
                </dl>
              </section>

              <section className="px-3 py-2">
                <dl className="grid gap-1">
                  <LedgerLine label="Tax" width="short">
                    {taxLineRateLabel(line)} {formatMoney(line.tax_withheld)}
                  </LedgerLine>
                  <LedgerLine label="Tip" width="short">
                    <span className="flex items-baseline justify-end gap-1.5">
                      <span>{formatMoney(line.tip_amount)}</span>
                      <CompactPayoutLabel
                        method={line.tip_payout_method_snapshot}
                        taxed={line.tax_tips_snapshot}
                      />
                    </span>
                  </LedgerLine>
                </dl>
                <div className="mt-1.5">
                  <StaffIncomeAutosaveInputs
                    bonusAmount={line.bonus_amount}
                    bonusPayoutMethod={line.bonus_payout_method_snapshot}
                    canManage={canManage}
                    checkNumber={line.check_number}
                    cycleType={period.cycleType}
                    note={line.note}
                    periodEnd={period.endDate}
                    periodStart={period.startDate}
                    staffId={line.staff_id}
                    taxBonus={line.tax_bonus_snapshot}
                  />
                </div>
              </section>
            </div>

            <details className="border-t border-zinc-100 bg-white px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-zinc-700">
                Breakdown
              </summary>
              {line.dailyTotals.length > 0 ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="text-left uppercase text-zinc-500">
                      <tr>
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4 text-right">Shop Gross</th>
                        <th className="py-2 pr-4 text-right">Comm Gross</th>
                        <th className="py-2 pr-4 text-right">Tip</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {line.dailyTotals.map((dailyTotal) => (
                        <tr key={dailyTotal.id}>
                          <td className="py-2 pr-4 text-zinc-700">
                            {formatDate(dailyTotal.business_date)}
                          </td>
                          <td className="py-2 pr-4 text-right text-zinc-900">
                            {formatMoney(dailyTotal.gross_sales)}
                          </td>
                          <td className="py-2 pr-4 text-right text-zinc-900">
                            {formatMoney(dailyCommissionGross(dailyTotal))}
                          </td>
                          <td className="py-2 pr-4 text-right font-medium text-zinc-900">
                            {formatMoney(dailyTotal.tip_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">
                  No daily rows for this staff member.
                </p>
              )}
              {line.inputHistory?.length ? (
                <div className="mt-3 border-t border-zinc-200 pt-3">
                  <p className="text-xs font-semibold text-zinc-700">
                    Input history
                  </p>
                  <ul className="mt-2 grid gap-1.5 text-xs text-zinc-600">
                    {line.inputHistory.map((history) => (
                      <li
                        className="flex flex-wrap items-center gap-x-3 gap-y-1"
                        key={history.id}
                      >
                        <span className="font-medium text-zinc-900">
                          {inputHistoryLabel(history.change_type)}
                        </span>
                        <span>{inputHistoryFields(history.field_changes)}</span>
                        <span className="text-zinc-500">
                          {formatDateTime(history.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
        </section>
      ))}
    </section>
  );
}

function ShopIncomeTab({
  rows,
  summary,
}: {
  rows: PayrollShopDailyRow[];
  summary: PayrollShopSummary;
}) {
  const hasActual = summary.totalActualIncome !== null;
  const shopNetIsNegative =
    summary.shopNetIncome !== null && summary.shopNetIncome < 0;

  return (
    <section className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <ShopIncomeCard
          label="Total Actual"
          subLines={[
            { label: "Cash", value: formatOptionalMoney(summary.cashAmount) },
            { label: "Card", value: formatOptionalMoney(summary.creditCardAmount) },
            { label: "Other", value: formatOptionalMoney(summary.otherAmount) },
          ]}
          value={formatOptionalMoney(
            summary.totalActualIncome,
            "Missing actual input",
          )}
        />
        <ShopIncomeCard
          label="Total Staff Obligation"
          subLines={[
            { label: "Staff Pay", value: formatMoney(summary.staffNetPay) },
            { label: "Tips Paid", value: formatMoney(summary.tipsPaid) },
            { label: "Tax Withheld", value: formatMoney(summary.taxWithheld) },
          ]}
          value={formatMoney(summary.totalStaffObligation)}
        />
        <ShopIncomeCard
          label="Shop Net Income"
          subLines={[
            {
              label: "Actual",
              value: hasActual ? formatMoney(summary.totalActualIncome ?? 0) : "-",
            },
            {
              label: "Staff Obligation",
              value: formatMoney(summary.totalStaffObligation),
            },
          ]}
          tone={shopNetIsNegative ? "warning" : "default"}
          value={formatOptionalMoney(summary.shopNetIncome, "Missing actual input")}
        />
      </div>
      <ShopIncomeDailyTable rows={rows} />
      <section className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-950">Notes</h2>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="font-medium text-zinc-800">Total Actual</dt>
            <dd>Total money actually collected from daily input: Cash + Card + Other.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">POS</dt>
            <dd>Expected collected amount recorded by POS for comparison with Actual.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">Total Staff Obligation</dt>
            <dd>Money handled for staff: Staff Pay + Tips Paid + Tax Withheld.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">Staff Pay</dt>
            <dd>Net commission or fixed pay after tax withholding.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">Tips Paid</dt>
            <dd>Tips paid to staff after optional tip tax withholding.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">Tax Withheld</dt>
            <dd>Staff income withheld for IRS. It is not shop profit.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">Shop Net Income</dt>
            <dd>Total Actual minus Total Staff Obligation, before future expenses.</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">Corrections</dt>
            <dd>Only after-close changes are counted here; same-day edits before closing are not.</dd>
          </div>
        </dl>
      </section>
    </section>
  );
}

function TaxTab({
  period,
  taxCompany,
}: {
  period: PayrollPeriod;
  taxCompany: Awaited<ReturnType<typeof getPayrollPageData>>["taxCompany"];
}) {
  const taxLines = taxCompany.lines;
  const returnPath = getPayrollHref({ period, tab: "tax" });
  const payrollRunId = taxCompany.latestStatement?.run.id ?? null;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-zinc-950">Tax company preview</p>
          <p className="text-sm text-zinc-500">
            {taxLines.length} reportable staff line{taxLines.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          href={getTaxCompanyHref(period)}
        >
          Open Tax Company
        </Link>
      </div>
      <TaxCompanyLinesTable
        lines={taxLines}
        payrollRunId={payrollRunId}
        returnPath={returnPath}
      />
      <TaxCompanyCalculationGuide />
    </section>
  );
}

function SettingChip({ children }: { children: ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded bg-white px-2 py-1 text-zinc-700 ring-1 ring-zinc-200">
      {children}
    </span>
  );
}

function formatSettingDate(value: string | null | undefined) {
  return value ? formatDate(value) : "Default";
}

function settingPayTypeLabel(setting: StaffPayrollSetting | null) {
  return setting?.pay_type === "fixed" ? "Fixed" : "Commission";
}

function SettingsHistory({ history }: { history: StaffPayrollSetting[] }) {
  return (
    <details className="border-t border-zinc-100 pt-3">
      <summary className="cursor-pointer text-xs font-medium text-zinc-600">
        History
      </summary>
      {history.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {history.map((version, index) => {
            const changes = describeSettingChanges(
              version,
              history[index + 1] ?? null,
            );

            return (
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-zinc-50 px-3 py-2 text-xs text-zinc-700"
                key={version.id || version.effective_from}
              >
                <span className="font-medium text-zinc-900">
                  {formatDate(version.effective_from)}
                </span>
                <span className="text-zinc-500">
                  Changed{" "}
                  {version.updated_at
                    ? formatDateTime(version.updated_at)
                    : "Unknown"}
                </span>
                {changes.length > 0 ? (
                  <>
                    {changes.map((change) => (
                      <SettingChip key={change.label}>
                        {change.previous
                          ? `${change.label}: ${change.previous} to ${change.current}`
                          : `${change.label}: ${change.current}`}
                      </SettingChip>
                    ))}
                  </>
                ) : (
                  <span>No manual field changes</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          No effective setting history yet.
        </p>
      )}
    </details>
  );
}

function SettingGroup({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h4>
      <dl className="grid gap-2">{children}</dl>
    </section>
  );
}

function SettingField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
      <dt className="shrink-0 text-zinc-500">{label}:</dt>
      <dd className="min-w-0 font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

function SettingStatus({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2 py-0.5 text-xs font-medium ${
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-zinc-200 bg-zinc-50 text-zinc-600"
      }`}
    >
      {children}
    </span>
  );
}

function SettingsReadContent({
  period,
  setting,
  staff,
}: {
  period: PayrollPeriod;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
}) {
  const payType = settingPayTypeLabel(setting);
  const isFixed = setting?.pay_type === "fixed";
  const taxCash = Boolean(setting?.cash_to_tax_company);
  const taxTip = Boolean(setting?.tax_tips);
  const taxBonus = Boolean(setting?.tax_bonus);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-950">
            {staff.display_name}
          </h3>
          {setting?.legal_name ? (
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              Legal name: {setting.legal_name}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-zinc-600">
            Effective from {formatSettingDate(setting?.effective_from)}
          </p>
        </div>
        <Link
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
          href={getSettingsEditHref(period, staff.id)}
        >
          Edit
        </Link>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <SettingGroup title="Compensation">
          <SettingField label="Pay type">{payType}</SettingField>
          {isFixed ? (
            <SettingField label="Fixed pay">
              {formatMoney(setting?.fixed_pay_amount ?? 0)}
            </SettingField>
          ) : (
            <SettingField label="Commission split rate">
              {formatPercent(setting?.commission_rate ?? 60)}
            </SettingField>
          )}
          <SettingField label="Check split">
            {formatPercent(setting?.check_rate ?? 60)}
          </SettingField>
        </SettingGroup>

        <SettingGroup title="Tax reporting">
          <SettingField label="Tax rate">
            {formatPercent(setting?.tax_rate ?? 0)}
          </SettingField>
          {isFixed ? (
            <SettingField label="Tax fixed">
              {formatYesNo(Boolean(setting?.apply_tax_to_fixed_pay))}
            </SettingField>
          ) : null}
          <SettingField label="Tax cash">
            <SettingStatus active={taxCash}>{formatOnOff(taxCash)}</SettingStatus>
          </SettingField>
          <SettingField label="Tax tip">
            <SettingStatus active={taxTip}>{formatYesNo(taxTip)}</SettingStatus>
          </SettingField>
          <SettingField label="Tax bonus">
            <SettingStatus active={taxBonus}>{formatYesNo(taxBonus)}</SettingStatus>
          </SettingField>
        </SettingGroup>

        <SettingGroup title="Payout">
          <SettingField label="Tip payout">
            {formatPayoutMethod(setting?.tip_payout_method ?? "cash")}
          </SettingField>
          <SettingField label="Bonus payout">
            {formatPayoutMethod(setting?.bonus_payout_method ?? "check")}
          </SettingField>
        </SettingGroup>
      </div>
    </>
  );
}

function SettingsStaffCard({
  history,
  isEditing,
  period,
  returnPath,
  setting,
  staff,
}: {
  history: StaffPayrollSetting[];
  isEditing: boolean;
  period: PayrollPeriod;
  returnPath: string;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
}) {
  return (
    <section className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      {isEditing ? (
        <StaffPayrollSettingInlineEdit
          period={period}
          returnPath={returnPath}
          setting={setting}
          staff={staff}
        />
      ) : (
        <SettingsReadContent period={period} setting={setting} staff={staff} />
      )}
      <SettingsHistory history={history} />
    </section>
  );
}

function SettingsExplanationNote() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
      <h3 className="text-sm font-semibold text-zinc-950">Setting notes</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-medium text-zinc-800">Compensation</p>
          <p className="mt-1">
            Pay type controls whether staff is paid by commission or fixed pay.
            Commission split rate is the staff share of production. Check split
            controls how much base pay goes to check versus cash.
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800">Tax reporting</p>
          <p className="mt-1">
            Tax rate is the withholding/reporting rate. Tax cash controls whether
            cash wage is shown on Tax Company. Tax tip and Tax bonus control
            whether tips and bonuses are included in tax reporting.
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800">Payout</p>
          <p className="mt-1">
            Tip payout and Bonus payout decide whether those amounts are paid by
            check or cash. They do not change the amount earned.
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800">Effective date</p>
          <p className="mt-1">
            Settings apply from the effective date forward. Older payroll periods
            keep using the setting that was effective for that period.
          </p>
        </div>
      </div>
      <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        Tax cash controls whether cash wage is reported to Tax Company. Tip and
        bonus payout methods do not decide whether those amounts are taxed.
      </p>
    </section>
  );
}

function SettingsTab({
  editStaffId,
  period,
  returnPath,
  salonPayrollSetting,
  settings,
}: {
  editStaffId: string | undefined;
  period: PayrollPeriod;
  returnPath: string;
  salonPayrollSetting: SalonPayrollSetting;
  settings: StaffPayrollSettingWithStaff[];
}) {
  return (
    <section className="grid gap-6" id="payroll-settings">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-950">Shop Payroll Schedule</h2>
        <PayrollScheduleForm
          action={saveSalonPayrollScheduleAction}
          anchorDate={salonPayrollSetting.biweekly_anchor_date}
          cycleType={salonPayrollSetting.cycle_type}
          returnPath={returnPath}
        />
      </div>

      <div className="grid gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Staff Payroll Settings
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Staff-specific compensation, tax reporting, payout, and effective settings.
          </p>
        </div>
        <div className="grid gap-3">
          {settings.map(({ history, setting, staff }) => {
            const isEditing = editStaffId === staff.id;

            return (
              <SettingsStaffCard
                history={history}
                isEditing={isEditing}
                key={staff.id}
                period={period}
                returnPath={returnPath}
                setting={setting}
                staff={staff}
              />
            );
          })}
        </div>
        <SettingsExplanationNote />
      </div>
    </section>
  );
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const params = await searchParams;
  await requireSalonManagePageContext("/payroll");
  let data: Awaited<ReturnType<typeof getPayrollPageData>>;

  try {
    data = await getPayrollPageData({
      endDate: params.end,
      month: params.month,
      payPeriodStart: params.payPeriodStart,
      preset: params.preset,
      segment: params.segment,
      startDate: params.start,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payroll could not be loaded.";
    return <NoPermissionState message={message} />;
  }

  const activeTab = getActiveTab(params.tab, data.access.canViewAllPayroll);
  const returnPath = getReturnPath(data.period, activeTab);
  const overviewRange = getOverviewRange(params.overviewRange);
  const overviewStaffId =
    params.overviewStaff &&
    data.live.lines.some((line) => line.staff_id === params.overviewStaff)
      ? params.overviewStaff
      : null;
  const overviewServiceId =
    params.overviewService &&
    data.serviceAnalytics.rows.some(
      (service) => service.serviceId === params.overviewService,
    )
      ? params.overviewService
      : null;
  const overviewFilters: PayrollOverviewFilters = {
    serviceId: overviewServiceId,
    serviceRankMode: getOverviewServiceRankMode(params.overviewServiceRank),
    staffId: overviewStaffId,
    trendMode: getOverviewTrendMode(params.overviewTrend),
  };
  const visiblePayrollError =
    params.payroll_error?.includes("Biweekly payroll requires") &&
    data.salonPayrollSetting.cycle_type === "monthly"
      ? null
      : params.payroll_error;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Payroll</p>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold text-zinc-950">Payroll V1</h1>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusBadgeClass(
                  data.status.kind,
                )}`}
              >
                {data.status.label}
              </span>
            </div>
            <p className="mt-2 text-sm text-zinc-500">
              {data.period.label} - {getStatusSubtitle(data)}
            </p>
          </div>
          <TopActions
            canManage={data.access.canManagePayroll}
            hasLiveDifference={data.difference.changed}
            latestStatement={data.latestStatement}
            period={data.period}
            returnPath={returnPath}
          />
        </div>
        {visiblePayrollError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {visiblePayrollError}
          </p>
        ) : null}
        {activeTab === "overview" ? null : (
          <PeriodSelector
            activeTab={activeTab}
            period={data.period}
            periodOptions={data.periodOptions}
            scheduleSetup={data.scheduleSetup}
            salonPayrollSetting={data.salonPayrollSetting}
          />
        )}
      </header>

      {activeTab === "overview" ? null : (
        <DifferenceBanner
          canManage={data.access.canManagePayroll}
          corrections={data.live.corrections}
          difference={data.difference}
          period={data.period}
          returnPath={returnPath}
        />
      )}
      <Tabs
        activeTab={activeTab}
        canViewAllPayroll={data.access.canViewAllPayroll}
        period={data.period}
      />

      {activeTab === "overview" ? (
        <OverviewTab
          corrections={data.live.corrections}
          difference={data.difference}
          filters={overviewFilters}
          lines={data.live.lines}
          period={data.period}
          range={overviewRange}
          serviceAnalytics={data.serviceAnalytics}
          shopDailyRows={data.live.shopDailyRows}
          shopSummary={data.live.shopSummary}
        />
      ) : null}
      {activeTab === "staff" ? (
        <StaffIncomeTab
          canManage={data.access.canManagePayroll}
          lines={data.live.lines}
          period={data.period}
        />
      ) : null}
      {activeTab === "shop" && data.access.canViewAllPayroll ? (
        <ShopIncomeTab
          rows={data.live.shopDailyRows}
          summary={data.live.shopSummary}
        />
      ) : null}
      {activeTab === "tax" && data.access.canViewAllPayroll ? (
        <TaxTab period={data.period} taxCompany={data.taxCompany} />
      ) : null}
      {activeTab === "settings" && data.access.canViewAllPayroll ? (
        <SettingsTab
          editStaffId={params.editStaff}
          period={data.period}
          returnPath={returnPath}
          salonPayrollSetting={data.salonPayrollSetting}
          settings={data.staffPayrollSettings}
        />
      ) : null}
    </main>
  );
}
