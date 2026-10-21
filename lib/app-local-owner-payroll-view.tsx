"use client";
import type { AppLocalOwnerPayrollData, AppLocalOwnerPayrollParams } from "./app-local-owner-page-types";
import { PayrollLedgerPanel } from "@/app/payroll/payroll-ledger-panel";
import { NavigationForm, NavigationSubmitButton } from "@/components/navigation-form";
import type { taxCompanySettings } from "@/lib/tax-company";
import { PayrollDisclosure } from "@/app/payroll/payroll-disclosure";
import { PayrollLiveRefresh } from "@/app/payroll/payroll-live-refresh";
import { PayrollEditBoundary, PayrollOutputGuard } from "@/app/payroll/payroll-edit-boundary";
import styles from "@/app/payroll/payroll-mobile.module.css";
import { WorkspaceText, WorkspaceElement, useWorkspaceTranslation } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";
import { DataDownloadPanel } from "@/app/payroll/data-download-panel";
import { PluginActivationPrompt, PluginActivationButton } from "@/app/settings/plugin-settings-row";
import { SubmitButton } from "@/components/submit-button";
import { PayrollFilterToolbar } from "@/app/payroll/payroll-filter-toolbar";
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
  DismissPayrollMismatchButton,
  MarkPaidButton,
} from "@/app/payroll/payroll-mismatch-controls";
import type { getPayrollPageData } from "@/lib/payroll";
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


type PayrollTab = "overview" | "staff" | "shop" | "tax" | "settings" | "tools" | "download";

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

  if (canViewAllPayroll && (value === "shop" || value === "tax" || value === "settings" || value === "tools" || value === "download")) {
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
    report: "1",
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
      <WorkspaceText text={formatPayoutMethod(method)} />
      {taxed ? (
        <>
          {" \u00b7 "}
          <WorkspaceText text="Tax" />
        </>
      ) : null}
    </span>
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

function ShopIncomeCard({ label, subLines, tone = "default", value }: {
  label: string; subLines: Array<{ label: string; value: string }>; tone?: "default" | "warning"; value: string;
}) {
  return <PayrollDisclosure className={styles.staffCard} summary={<div className={styles.staffSummary}><strong><WorkspaceText text={label} /></strong><strong className={tone === "warning" ? "text-rose-700" : ""}><WorkspaceText text={value} /></strong></div>}>
    <div className="p-4"><div className={styles.desktopOnly}><p className="text-xs font-medium uppercase tracking-wide text-zinc-500"><WorkspaceText text={label} /></p><p className={`mt-2 text-2xl font-semibold ${tone === "warning" ? "text-rose-700" : "text-zinc-950"}`}><WorkspaceText text={value} /></p></div>
    <dl className="grid gap-2 text-sm text-zinc-600 lg:mt-3">{subLines.map(line=><div className="flex items-center justify-between gap-3" key={line.label}><dt><WorkspaceText text={line.label} /></dt><dd className="font-medium text-zinc-800">{line.value}</dd></div>)}</dl></div>
  </PayrollDisclosure>;
}

function monthInputFromPeriod(period: PayrollPeriod) {
  return period.startDate.slice(0, 7);
}

function NoPermissionState({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <WorkspaceText text={message} />
      </p>
      <Link className="text-sm font-medium text-zinc-700 underline" href="/">
        <WorkspaceText text="Back to dashboard" />
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
    <div className="min-w-0 space-y-2">
    <PayrollFilterToolbar summary={<WorkspaceElement as="p" className="truncate" title={period.label}><WorkspaceText text={period.label} /></WorkspaceElement>} periodLabel={period.label} active={period.preset === "custom"}>
      <NavigationForm
        action="/payroll"
        className="flex flex-wrap items-end gap-3"
      >
        <input name="tab" type="hidden" value={activeTab} />
        {scheduleCycle === "monthly" ? (
          <label className="flex min-w-48 flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Month" />
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
              <WorkspaceText text="Month" />
              <input
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
                defaultValue={monthInputFromPeriod(period)}
                name="month"
                type="month"
              />
            </label>
            <label className="flex min-w-64 flex-col gap-1 text-sm font-medium text-zinc-700">
              <WorkspaceText text="Period" />
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
          <label className="flex min-w-0 w-full sm:w-72 flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Pay period" />
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              disabled={missingBiweeklyAnchor}
              name="payPeriodStart"
              defaultValue={period.startDate}
            >
              {missingBiweeklyAnchor ? (
                <option value=""><WorkspaceText text="Set anchor in Settings" /></option>
              ) : (
                periodOptions.map((option) => (
                  <option key={option.value} value={option.startDate}>
                    <WorkspaceText text={option.label} />
                  </option>
                ))
              )}
            </select>
          </label>
        ) : null}
        <NavigationSubmitButton pendingLabel="Loading…" className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          <WorkspaceText text="Apply" />
        </NavigationSubmitButton>
      </NavigationForm>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-600">
          <WorkspaceText text="Advanced custom range" />
        </summary>
        <NavigationForm action="/payroll" className="mt-3 flex flex-wrap items-end gap-3">
          <input name="tab" type="hidden" value={activeTab} />
          <input name="preset" type="hidden" value="custom" />
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Start" />
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.startDate}
              name="start"
              type="date"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="End" />
            <input
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.endDate}
              name="end"
              type="date"
            />
          </label>
          <NavigationSubmitButton pendingLabel="Loading…" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800">
            <WorkspaceText text="Apply Custom" />
          </NavigationSubmitButton>
        </NavigationForm>
      </details>
    </PayrollFilterToolbar>
      {missingBiweeklyAnchor ? (
        <p className="text-sm text-amber-700">
          <WorkspaceText text="Every-2-weeks payroll needs an anchor date. Update it in Settings." />
        </p>
      ) : null}
    </div>
  );
}

function Tabs({ activeTab, canViewAllPayroll, period }: {
  activeTab: PayrollTab; canViewAllPayroll: boolean; period: PayrollPeriod;
}) {
  const desktopTabs = canViewAllPayroll ? [...TABS, { id: "tools" as const, label: "Tools" }] : TABS.filter(tab => tab.id === "overview" || tab.id === "staff");
  const mobileTabs: { id: PayrollTab; label: string }[] = canViewAllPayroll
    ? [{ id: "overview", label: "Overview" }, { id: "staff", label: "Staff" }, { id: "shop", label: "Shop" }, { id: "tools", label: "Tools" }]
    : [{ id: "overview", label: "Overview" }, { id: "staff", label: "Staff" }];
  return <>
    <nav className={styles.mobileNav} aria-label="Payroll sections">{mobileTabs.map(tab => <Link key={tab.id} href={getPayrollHref({ period, tab: tab.id })} aria-current={activeTab === tab.id || tab.id === "tools" && ["tax", "settings", "download"].includes(activeTab) ? "page" : undefined}><WorkspaceText text={tab.label} /></Link>)}</nav>
    <div className={styles.desktopNav}><div className="flex min-w-0 items-center gap-3"><nav aria-label="Payroll sections" className="flex min-w-0 flex-1 flex-wrap gap-1 border-b border-zinc-200">{desktopTabs.map(tab => <Link key={tab.id} href={getPayrollHref({ period, tab: tab.id })} aria-current={activeTab === tab.id ? "page" : undefined} className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === tab.id ? "border-zinc-950 text-zinc-950" : "border-transparent text-zinc-500"}`}><WorkspaceText text={tab.label} /></Link>)}</nav><ContextualSupport /></div></div>
  </>;
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
          <p className="font-semibold"><WorkspaceText text="Current calculations differ from this historical statement." /></p>
          <p>
            <WorkspaceText text="Review the historical statement and supporting records. No original snapshot will be reconstructed automatically." />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md bg-zinc-950 px-3 py-2 font-medium text-white"
            href={staffIncomeHref}
          >
            <WorkspaceText text="Review Staff Income" />
          </Link>
          <DismissPayrollMismatchButton targetId="payroll-differences" />
        </div>
      </div>
      {affectedStaff.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase text-amber-800">
            {affectedStaff.length} <WorkspaceText text="staff affected" />
          </p>
          <ul className="mt-2 grid gap-1.5 text-zinc-800 md:grid-cols-2">
            {visibleAffectedStaff.map((staff) => (
              <li key={staff.staffId}>
                <span className="font-medium text-zinc-950">{staff.staffName}</span>
                {" - "}
                <WorkspaceText text={staff.categories.length > 0
                  ? `${staff.categories.join(" / ")} changed`
                  : "payroll changed"} />
              </li>
            ))}
          </ul>
          {moreAffectedStaffCount > 0 ? (
            <p className="mt-2 text-sm font-medium text-amber-900">
              +{moreAffectedStaffCount} <WorkspaceText text="more staff affected" />
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-amber-200 bg-white/75 p-3">
          <p className="font-semibold text-zinc-950"><WorkspaceText text="Shop / POS totals changed" /></p>
          <p className="text-zinc-700">
            <WorkspaceText text="No staff payout action was detected, but the live shop totals differ from the printed statement." />
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
    <PayrollFilterToolbar
      periodLabel={period.label}
      active={Boolean(filters.staffId || filters.serviceId || (period.preset === "custom" && !range))}
      summary={<div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 rounded-md border border-zinc-200 bg-zinc-50 p-0.5">
          {ranges.map((option) => {
            const active = range === option.id;

            return (
              <Link
                className={`rounded px-2 py-2 sm:px-3 text-xs font-medium ${
                  active
                    ? "bg-white text-zinc-950 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-950"
                }`}
                href={getOverviewRangeHref({ filters, range: option.id })}
                key={option.id}
              >
                <WorkspaceText text={option.label} />
              </Link>
            );
          })}
        </div>

        <WorkspaceElement as="span" className="hidden min-w-0 truncate text-xs text-zinc-500 sm:block" title={period.label}><WorkspaceText text={period.label} /></WorkspaceElement>
      </div>}
    >
        <NavigationForm action="/payroll" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
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
            <WorkspaceText text="Start" />
            <input
              className="h-9 min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={period.startDate}
              name="start"
              type="date"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
            <WorkspaceText text="End" />
            <input
              className="h-9 min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={period.endDate}
              name="end"
              type="date"
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-zinc-600">
            <WorkspaceText text="Staff" />
            <select
              className="h-9 min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={filters.staffId ?? ""}
              name="overviewStaff"
            >
              <option value=""><WorkspaceText text="All Staff" /></option>
              {lines.map((line) => (
                <option key={line.staff_id} value={line.staff_id}>
                  {line.staff_display_name_snapshot}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-zinc-600">
            <WorkspaceText text="Service" />
            <select
              className="h-9 min-w-0 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              defaultValue={filters.serviceId ?? ""}
              name="overviewService"
            >
              <option value=""><WorkspaceText text="All Services" /></option>
              {serviceAnalytics.rows.map((service) => (
                <option key={service.serviceId} value={service.serviceId}>
                  {service.serviceName}
                </option>
              ))}
            </select>
          </label>
          <NavigationSubmitButton pendingLabel="Loading…" className="h-9 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white">
            <WorkspaceText text="Apply" />
          </NavigationSubmitButton>

        </NavigationForm>
        {filters.staffId || filters.serviceId ? (
          <span className="min-w-0 max-w-full break-words py-3 text-xs text-teal-700">
            {[lines.find((line) => line.staff_id === filters.staffId)?.staff_display_name_snapshot,
              serviceAnalytics.rows.find((service) => service.serviceId === filters.serviceId)?.serviceName].filter(Boolean).join(" · ")}
            <Link className="ml-2 underline" href={getOverviewHref({ filters, period, range, overrides: { staffId: null, serviceId: null } })}><WorkspaceText text="Clear" /></Link>
          </span>
        ) : null}
    </PayrollFilterToolbar>
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
    <section className={styles.snapshot}>
      {cards.map((card) => (
        <div
          className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
          key={card.label}
          data-metric={card.label}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <WorkspaceText text={card.label} />
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
                <WorkspaceText text={card.value === null
                  ? "N/A"
                  : card.label === "Over / Short"
                    ? formatSignedMoney(card.value)
                    : formatMoney(card.value)} />
              </p>
            </div>
            <Sparkline values={card.trend} />
          </div>
          <p className="mt-2 text-xs text-zinc-500">{card.helper}</p>
          <p className="mt-1 text-[11px] text-zinc-400"><WorkspaceText text="Previous period unavailable" /></p>
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
          <p className="font-semibold"><WorkspaceText text="Statement or correction activity needs review." /></p>
          <p className="mt-1 text-amber-900">
            {staffSummary} <WorkspaceText text="have" /> {fieldSummary} <WorkspaceText text="changes" />
            <WorkspaceText text={latestCorrection
              ? `, latest ${formatDateTime(latestCorrection.correctionDate)}`
              : ""} />
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-white"
            href={getPayrollHref({ period, tab: "staff" })}
          >
            <WorkspaceText text="View Details" />
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
        <h2 className="text-sm font-semibold text-zinc-950"><WorkspaceText text={title} /></h2>
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
              <WorkspaceText text={mode.label} />
            </Link>
          ))}
        </div>
      }
      className="lg:col-span-8"
      title="Revenue, Payroll & Shop Net Trend"
    >
      {analytics.trend.length === 0 ? (
        <div className="flex h-64 items-center justify-center rounded-md border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500">
          <WorkspaceText text="No trend data for this filter." />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <WorkspaceElement as="svg"
              aria-label="Revenue, staff payout, and shop net trend"
              className="h-56 w-full min-w-0 text-zinc-400"
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
            </WorkspaceElement>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <div className="flex flex-wrap gap-3">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-blue-600" />
                <WorkspaceText text="Revenue" />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-orange-500" />
                <WorkspaceText text="Staff Payout" />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-full bg-emerald-600" />
                <WorkspaceText text="Shop Net" />
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {analytics.trend.map((point, index) =>
                index % labelEvery === 0 || index === analytics.trend.length - 1 ? (
                  <span key={point.key}><WorkspaceText text={point.label} /></span>
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
      <span className="text-zinc-600"><WorkspaceText text={label} /></span>
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
            <WorkspaceText text="Money Received" />
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
            <WorkspaceText text="Money Paid / Deducted" />
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
  const __vt = useWorkspaceTranslation();
  return (
    <AnalyticsPanel
      action={
        <Link
          className="text-xs font-medium text-blue-700 hover:text-blue-900"
          href={getPayrollHref({ period, tab: "staff" })}
        >
          <WorkspaceText text="View all staff income -&gt;" />
        </Link>
      }
      className="lg:col-span-6"
      title="Staff Performance"
    >
      {analytics.staffPerformance.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          <WorkspaceText text="No staff income for this period." />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`min-w-full text-sm ${styles.responsiveTable}`}>
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4"><WorkspaceText text="Staff" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Service Sales" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Commission" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Tips" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Bonus" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Total Income" /></th>
                <th className="py-2 text-right"><WorkspaceText text="Growth %" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {analytics.staffPerformance.map((row) => (
                <tr key={row.staffId}>
                  <td data-label={__vt("Staff")} className="py-2 pr-4">
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
                  <td data-label={__vt("Service Sales")} className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.serviceSales)}
                  </td>
                  <td data-label={__vt("Commission")} className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.commission)}
                  </td>
                  <td data-label={__vt("Tips")} className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.tips)}
                  </td>
                  <td data-label={__vt("Bonus")} className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.bonus)}
                  </td>
                  <td data-label={__vt("Total Income")} className="py-2 pr-4 text-right font-semibold tabular-nums text-zinc-950">
                    {formatMoney(row.totalIncome)}
                  </td>
                  <td data-label={__vt("Growth %")} className="py-2 text-right text-zinc-500">
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
                <WorkspaceText text={mode.label} />
              </Link>
            ))}
          </div>
          <Link
            className="hidden text-xs font-medium text-blue-700 hover:text-blue-900 sm:inline"
            href="/services"
          >
            <WorkspaceText text="View all services -&gt;" />
          </Link>
        </div>
      }
      className="lg:col-span-6"
      title="Service Analytics"
    >
      {analytics.servicePerformance.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
          <WorkspaceText text="No service analytics for this period." />
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
      <h2 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Business Health" /></h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {analytics.health.map((metric) => (
          <div
            className="rounded-md border border-zinc-200 bg-zinc-50 p-3"
            key={metric.label}
          >
            <p className="text-xs font-medium text-zinc-500"><WorkspaceText text={metric.label} /></p>
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
  const __vt = useWorkspaceTranslation();
  return (
    <AnalyticsPanel title={title}>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5 text-center text-sm text-zinc-500">
          <WorkspaceText text={emptyLabel} />
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={`min-w-full text-sm ${styles.responsiveTable}`}>
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4">{columns === "weekly" ? <WorkspaceText text="Week" /> : <WorkspaceText text="Month" />}</th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Revenue" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Actual Received" /></th>
                <th className="py-2 pr-4 text-right"><WorkspaceText text="Staff Payout" /></th>
                {columns === "weekly" ? (
                  <th className="py-2 pr-4 text-right"><WorkspaceText text="Over / Short" /></th>
                ) : (
                  <th className="py-2 pr-4 text-right"><WorkspaceText text="Payroll Ratio" /></th>
                )}
                <th className="py-2 text-right"><WorkspaceText text="Shop Net" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr key={row.label}>
                  <td data-label={__vt("Period")} className="py-2 pr-4 font-medium text-zinc-950"><WorkspaceText text={row.label} /></td>
                  <td data-label={__vt("Revenue")} className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.revenue)}
                  </td>
                  <td data-label={__vt("Actual Received")} className="py-2 pr-4 text-right tabular-nums">
                    {formatOptionalMoney(row.actualReceived, "N/A")}
                  </td>
                  <td data-label={__vt("Staff Payout")} className="py-2 pr-4 text-right tabular-nums">
                    {formatMoney(row.staffPayout)}
                  </td>
                  {columns === "weekly" ? (
                    <td data-label={__vt("Over / Short")}
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
                    <td data-label={__vt("Payroll Ratio")} className="py-2 pr-4 text-right tabular-nums">
                      {formatRatioPercent(row.payrollRatio)}
                    </td>
                  )}
                  <td data-label={__vt("Shop Net")} className="py-2 text-right font-medium tabular-nums">
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
      <h2 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Key Insights" /></h2>
      {analytics.insights.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-500">
          <WorkspaceText text="No reliable insights yet." />
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
          <WorkspaceText text="No payroll data for this period." />
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
          <PayrollDisclosure summary="More analytics" className={styles.analytics}>
          <div className={styles.mobileOnly}><p className="text-sm"><WorkspaceText text="POS Revenue" />: {formatMoney(analytics.snapshot.posRevenue)}</p><p className="text-sm"><WorkspaceText text="Over / Short" />: {formatOptionalMoney(analytics.snapshot.overShort, "Missing actual input")}</p></div>
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
          </PayrollDisclosure>
        </>
      )}
    </section>
  );
}

function StaffIncomeTab({ canManage, lines, period }: {
  canManage: boolean; lines: PayrollStaffLineWithDailyTotals[]; period: PayrollPeriod;
}) {
  if (!lines.length) return <p className={styles.panel}><WorkspaceText text="No staff income lines for this period." /></p>;
  return <section className="grid gap-3">
    <div className={styles.heading}><h2 className="text-base font-semibold"><WorkspaceText text="Staff Income" /></h2><p className={styles.context}>{lines.length} <WorkspaceText text="Staff" /> · <WorkspaceText text="Current calculation" /></p></div>
    {lines.map(line => <PayrollDisclosure key={`${period.startDate}:${period.endDate}:${line.staff_id}`} className={styles.staffCard} summary={<div className={styles.staffSummary}>
      <div><strong>{line.staff_display_name_snapshot}</strong>{!line.staff_legal_name_snapshot && <small className="!text-amber-700"><WorkspaceText text="Missing legal name" /></small>}{line.final_check_amount < 0 && <small className="!text-rose-700"><WorkspaceText text="Check amount negative" /></small>}</div>
      <div className={styles.staffMoney}><strong>{formatMoney(line.final_staff_income)}</strong><small><WorkspaceText text="Cash" /> {formatMoney(line.final_cash_amount)}</small><small><WorkspaceText text="Check" /> {formatMoney(line.final_check_amount)}</small></div>
    </div>}>
      <div className={styles.staffBody}>
        <section className={styles.staffSection}><h3>{line.staff_display_name_snapshot} · <WorkspaceText text="Actual Payout" /></h3><dl className={styles.ledger}>
          <div><dt><WorkspaceText text="Cash" /></dt><dd>{formatMoney(line.final_cash_amount)}</dd></div>
          <div><dt><WorkspaceText text="Check" /></dt><dd className={line.final_check_amount < 0 ? "text-rose-700" : ""}>{formatMoney(line.final_check_amount)}</dd></div>
          <div><dt><WorkspaceText text="Total" /></dt><dd className="font-semibold">{formatMoney(line.final_staff_income)}</dd></div>
          <div><dt><WorkspaceText text="Tax" /></dt><dd>{taxLineRateLabel(line)} · {formatMoney(line.tax_withheld)}</dd></div>
          <div><dt><WorkspaceText text="Tip" /></dt><dd>{formatMoney(line.tip_amount)} <CompactPayoutLabel method={line.tip_payout_method_snapshot} taxed={line.tax_tips_snapshot} /></dd></div>
        </dl></section>
        <section className={styles.staffSection}><h3><WorkspaceText text="Wage / Net Details" /></h3><dl className={styles.ledger}>
          <div><dt><WorkspaceText text="Shop Gross" /></dt><dd>{formatMoney(line.gross_sales)}</dd></div>
          <div><dt><WorkspaceText text="Comm Gross" /></dt><dd>{formatMoney(line.staff_commission_gross)}</dd></div>
          <div><dt><WorkspaceText text="Cash Net" /></dt><dd>{formatMoney(line.base_cash_amount)}</dd></div>
          <div><dt><WorkspaceText text="Check Net" /></dt><dd>{formatMoney(line.check_net)}</dd></div>
        </dl></section>
        <section className={styles.staffSection}><h3><WorkspaceText text="Period adjustments" /></h3><StaffIncomeAutosaveInputs bonusAmount={line.bonus_amount} bonusPayoutMethod={line.bonus_payout_method_snapshot} canManage={canManage} checkNumber={line.check_number} cycleType={period.cycleType} note={line.note} periodEnd={period.endDate} periodStart={period.startDate} staffId={line.staff_id} taxBonus={line.tax_bonus_snapshot} /></section>
      </div>
      <details className="border-t p-4"><summary className="text-sm font-medium"><WorkspaceText text="Breakdown" /></summary>
        {line.dailyTotals.length ? <div className="grid gap-3">{line.dailyTotals.map(day => <div key={day.id} className="rounded-lg bg-zinc-50 p-3"><p className="mb-2 text-sm font-medium"><WorkspaceText text={formatDate(day.business_date)} /></p><dl className={styles.ledger}><div><dt><WorkspaceText text="Shop Gross" /></dt><dd>{formatMoney(day.gross_sales)}</dd></div><div><dt><WorkspaceText text="Comm Gross" /></dt><dd>{formatMoney(dailyCommissionGross(day))}</dd></div><div><dt><WorkspaceText text="Tip" /></dt><dd>{formatMoney(day.tip_amount)}</dd></div></dl></div>)}</div> : <p className="text-sm text-zinc-500"><WorkspaceText text="No daily rows for this staff member." /></p>}
        {Boolean(line.inputHistory?.length) && <details className="mt-3 border-t pt-2"><summary className="text-sm font-medium"><WorkspaceText text="Input history" /></summary><ul className="grid gap-2 text-sm">{line.inputHistory?.map(history => <li key={history.id}><WorkspaceText text={inputHistoryLabel(history.change_type)} /> · {inputHistoryFields(history.field_changes)}<p className="text-xs text-zinc-500"><WorkspaceText text={formatDateTime(history.created_at)} /></p></li>)}</ul></details>}
      </details>
    </PayrollDisclosure>)}
  </section>;
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
      <p className="text-sm text-zinc-500"><WorkspaceText text="Shop Net is before other operating expenses." /></p>
      <ShopIncomeDailyTable rows={rows} />
      <PayrollDisclosure summary="How shop income is calculated" className={styles.compactNote}>
        <h2 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Notes" /></h2>
        <dl className="mt-3 grid gap-2">
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Total Actual" /></dt>
            <dd><WorkspaceText text="Total money actually collected from daily input: Cash + Card + Other." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="POS" /></dt>
            <dd><WorkspaceText text="Expected collected amount recorded by POS for comparison with Actual." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Total Staff Obligation" /></dt>
            <dd><WorkspaceText text="Money handled for staff: Staff Pay + Tips Paid + Tax Withheld." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Staff Pay" /></dt>
            <dd><WorkspaceText text="Net commission or fixed pay after tax withholding." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Tips Paid" /></dt>
            <dd><WorkspaceText text="Tips paid to staff after optional tip tax withholding." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Tax Withheld" /></dt>
            <dd><WorkspaceText text="Staff income withheld for IRS. It is not shop profit." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Shop Net Income" /></dt>
            <dd><WorkspaceText text="Total Actual minus Total Staff Obligation, before future expenses." /></dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800"><WorkspaceText text="Corrections" /></dt>
            <dd><WorkspaceText text="Only after-close changes are counted here; same-day edits before closing are not." /></dd>
          </div>
        </dl>
      </PayrollDisclosure>
    </section>
  );
}

function TaxTab({ period, taxCompany, plugin, hasChanges, canManageConnection }: {
  period: PayrollPeriod; taxCompany: Awaited<ReturnType<typeof getPayrollPageData>>["taxCompany"];
  plugin: Awaited<ReturnType<typeof taxCompanySettings>> | null; hasChanges: boolean; canManageConnection: boolean;
}) {
  const statement = taxCompany.latestStatement;
  const paystubs = taxCompany.lines.filter(line => line.paystub).length;
  if (canManageConnection && plugin && !plugin.active) return <section className="grid gap-3">
    <PluginActivationPrompt pluginName="Tax Company" label="Connect your tax company" />
    {statement && <Link className={styles.action} href={getTaxCompanyHref(period)}><WorkspaceText text="View saved report and paystubs" /></Link>}
  </section>;
  const connections = plugin?.connections.filter(connection => connection.account_active).length ?? 0;
  const status = !canManageConnection ? "Connection managed by salon owner" : !plugin ? "Connection status unavailable" : !plugin.active ? "Plugin inactive" : !plugin.enabled || !connections ? "Ready to connect" : "Sharing enabled";
  return <section className="grid gap-4">
    <div className={styles.heading}><h2 className="text-lg font-semibold">Tax Company</h2><span className={styles.status}><WorkspaceText text={status} /></span></div>
    {canManageConnection && !plugin && <p role="alert" className={styles.warning}><WorkspaceText text="Tax Company status could not load. Your saved payroll reports remain available." /> <Link className="underline" href={getPayrollHref({ period, tab: "tax" })}><WorkspaceText text="Try again" /></Link></p>}
    <section className={styles.panel}><h2><WorkspaceText text="Saved payroll report" /></h2><p><WorkspaceText text={period.label} /></p>
      {statement ? <><p><WorkspaceText text="Statement v" />{statement.run.version} · <WorkspaceText text={statement.run.status === "paid" ? "Paid" : "Saved"} /></p><p>{paystubs} / {taxCompany.lines.length} <WorkspaceText text="Paystubs available" /></p>{hasChanges && <p className={styles.warning}><WorkspaceText text="Current payroll has changes. The tax company sees the saved version until you save a new statement." /></p>}</> : <p><WorkspaceText text="Save a statement before sharing this period with your tax company." /></p>}
      <Link className={`${styles.action} ${styles.primary}`} href={getTaxCompanyHref(period)}><WorkspaceText text="View report and paystubs" /></Link>
      <p className={styles.context}><WorkspaceText text="Reports and paystubs belong to the saved payroll version shown above." /></p>
    </section>
    <div className={styles.tools}>
      {canManageConnection && <Link className={styles.toolLink} href="/payroll/tax-company/settings"><span><strong><WorkspaceText text="Connection and access" /></strong><small><WorkspaceText text="Manage your tax company connection" /></small></span><span aria-hidden="true">→</span></Link>}
    </div>
  </section>;
}

function ToolsTab({ period, downloadEnabled, canActivate }: { period: PayrollPeriod; downloadEnabled: boolean | null; canActivate: boolean }) {
  const links: { tab: PayrollTab; title: string; subtitle: string }[] = [
    { tab: "settings", title: "Payroll settings", subtitle: "Schedule, compensation and withholding" },
    { tab: "tax", title: "Tax Company", subtitle: "Connection, saved reports and paystubs" },
    ...(downloadEnabled ? [{ tab: "download" as const, title: "Download", subtitle: "Payroll Data Download" }] : []),
  ];
  return <section className={styles.tools}>{links.map(link => <Link className={styles.toolLink} key={link.tab} href={getPayrollHref({ period, tab: link.tab })}><span><strong><WorkspaceText text={link.title} /></strong><small><WorkspaceText text={link.subtitle} /></small></span><span aria-hidden="true">→</span></Link>)}{canActivate && downloadEnabled === false && <PluginActivationButton pluginName="Payroll Data Download" label="Download payroll data" buttonLabel="Download" />}</section>;
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
        <WorkspaceText text="History" />
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
                  <WorkspaceText text={formatDate(version.effective_from)} />
                </span>
                <span className="text-zinc-500">
                  <WorkspaceText text="Changed" />{" "}
                  <WorkspaceText text={version.updated_at
                    ? formatDateTime(version.updated_at)
                    : "Unknown"} />
                </span>
                {changes.length > 0 ? (
                  <>
                    {changes.map((change) => (
                      <SettingChip key={change.label}>
                        <WorkspaceText text={change.previous
                          ? `${change.label}: ${change.previous} to ${change.current}`
                          : `${change.label}: ${change.current}`} />
                      </SettingChip>
                    ))}
                  </>
                ) : (
                  <span><WorkspaceText text="No manual field changes" /></span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">
          <WorkspaceText text="No effective setting history yet." />
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
        <WorkspaceText text={title} />
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
      <dt className="shrink-0 text-zinc-500"><WorkspaceText text={label} />:</dt>
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

function staffInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return parts.map((part) => part[0]?.toUpperCase()).join("") || "ST";
}

function StaffProfileAvatar({
  displayName,
  imageUrl,
}: {
  displayName: string;
  imageUrl: string | null;
}) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
      {imageUrl ? (
        <WorkspaceElement as="img"
          alt=""
          className="h-full w-full rounded-full object-cover"
          src={imageUrl}
        />
      ) : (
        staffInitials(displayName)
      )}
    </span>
  );
}

function SettingsReadContent({
  period,
  setting,
  staff,
  staffProfileAvatarUrl,
  staffProfileDisplayName,
  canManage,
}: {
  canManage: boolean;
  period: PayrollPeriod;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
  staffProfileAvatarUrl: string | null;
  staffProfileDisplayName: string;
}) {
  const payType = settingPayTypeLabel(setting);
  const isFixed = setting?.pay_type === "fixed";
  const taxCash = Boolean(setting?.cash_to_tax_company);
  const taxTip = Boolean(setting?.tax_tips);
  const taxBonus = Boolean(setting?.tax_bonus);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StaffProfileAvatar
            displayName={staffProfileDisplayName}
            imageUrl={staffProfileAvatarUrl}
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-zinc-950">
              {staffProfileDisplayName}
            </h3>
            {setting?.legal_name ? (
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                <WorkspaceText text="Legal name:" /> {setting.legal_name}
              </p>
            ) : null}
            <p className="mt-1 text-sm text-zinc-600">
              <WorkspaceText text="Effective from" /> <WorkspaceText text={formatSettingDate(setting?.effective_from)} />
            </p>
          </div>
        </div>
        {canManage && <Link
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50"
          href={getSettingsEditHref(period, staff.id)}
        >
          <WorkspaceText text="Edit" />
        </Link>}
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
              <WorkspaceText text={formatYesNo(Boolean(setting?.apply_tax_to_fixed_pay))} />
            </SettingField>
          ) : null}
          <SettingField label="Tax cash">
            <SettingStatus active={taxCash}><WorkspaceText text={formatOnOff(taxCash)} /></SettingStatus>
          </SettingField>
          <SettingField label="Tax tip">
            <SettingStatus active={taxTip}><WorkspaceText text={formatYesNo(taxTip)} /></SettingStatus>
          </SettingField>
          <SettingField label="Tax bonus">
            <SettingStatus active={taxBonus}><WorkspaceText text={formatYesNo(taxBonus)} /></SettingStatus>
          </SettingField>
        </SettingGroup>

        <SettingGroup title="Payout">
          <SettingField label="Tip payout">
            <WorkspaceText text={formatPayoutMethod(setting?.tip_payout_method ?? "cash")} />
          </SettingField>
          <SettingField label="Bonus payout">
            <WorkspaceText text={formatPayoutMethod(setting?.bonus_payout_method ?? "check")} />
          </SettingField>
        </SettingGroup>
      </div>
    </>
  );
}

function SettingsStaffCard({
  canManage,
  history,
  isEditing,
  period,
  returnPath,
  setting,
  staff,
  staffProfileAvatarUrl,
  staffProfileDisplayName,
}: {
  canManage: boolean;
  history: StaffPayrollSetting[];
  isEditing: boolean;
  period: PayrollPeriod;
  returnPath: string;
  setting: StaffPayrollSetting | null;
  staff: StaffPayrollSettingWithStaff["staff"];
  staffProfileAvatarUrl: string | null;
  staffProfileDisplayName: string;
}) {
  return (
    <PayrollDisclosure initiallyOpen={isEditing} className={styles.staffCard} summary={<div><strong>{staffProfileDisplayName}</strong><p className={styles.context}>{settingPayTypeLabel(setting)} · <WorkspaceText text="Effective from" /> <WorkspaceText text={formatSettingDate(setting?.effective_from)} /></p></div>}>
      <div className="grid gap-4 p-4">
      {isEditing ? (
        <StaffPayrollSettingInlineEdit
          period={period}
          returnPath={returnPath}
          setting={setting}
          staff={staff}
          staffProfileAvatarUrl={staffProfileAvatarUrl}
          staffProfileDisplayName={staffProfileDisplayName}
        />
      ) : (
        <SettingsReadContent canManage={canManage}
          period={period}
          setting={setting}
          staff={staff}
          staffProfileAvatarUrl={staffProfileAvatarUrl}
          staffProfileDisplayName={staffProfileDisplayName}
        />
      )}
      <SettingsHistory history={history} />
      </div>
    </PayrollDisclosure>
  );
}

function SettingsExplanationNote() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
      <h3 className="text-sm font-semibold text-zinc-950"><WorkspaceText text="Setting notes" /></h3>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Compensation" /></p>
          <p className="mt-1">
            <WorkspaceText text="Pay type controls whether staff is paid by commission or fixed pay. Commission split rate is the staff share of production. Check split controls how much base pay goes to check versus cash." />
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Tax reporting" /></p>
          <p className="mt-1">
            <WorkspaceText text="Tax rate is the withholding/reporting rate. Tax cash controls whether cash wage is shown on Tax Company. Tax tip and Tax bonus control whether tips and bonuses are included in tax reporting." />
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Payout" /></p>
          <p className="mt-1">
            <WorkspaceText text="Tip payout and Bonus payout decide whether those amounts are paid by check or cash. They do not change the amount earned." />
          </p>
        </div>
        <div>
          <p className="font-medium text-zinc-800"><WorkspaceText text="Effective date" /></p>
          <p className="mt-1">
            <WorkspaceText text="Settings apply from the effective date forward. Older payroll periods keep using the setting that was effective for that period." />
          </p>
        </div>
      </div>
      <p className="mt-3 border-t border-zinc-200 pt-3 text-xs text-zinc-500">
        <WorkspaceText text="Tax cash controls whether cash wage is reported to Tax Company. Tip and bonus payout methods do not decide whether those amounts are taxed." />
      </p>
    </section>
  );
}

function SettingsTab({
  canManage,
  editStaffId,
  period,
  returnPath,
  salonPayrollSetting,
  settings,
}: {
  canManage: boolean;
  editStaffId: string | undefined;
  period: PayrollPeriod;
  returnPath: string;
  salonPayrollSetting: SalonPayrollSetting;
  settings: StaffPayrollSettingWithStaff[];
}) {
  return (
    <section className="grid gap-6" id="payroll-settings">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-950"><WorkspaceText text="Shop Payroll Schedule" /></h2>
        <fieldset disabled={!canManage}><PayrollScheduleForm
          action={saveSalonPayrollScheduleAction}
          anchorDate={salonPayrollSetting.biweekly_anchor_date}
          cycleType={salonPayrollSetting.cycle_type}
          returnPath={returnPath}
        /></fieldset>
      </div>

      <div className="grid gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            <WorkspaceText text="Staff Payroll Settings" />
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            <WorkspaceText text="Staff-specific compensation, tax reporting, payout, and effective settings." />
          </p>
        </div>
        <div className="grid gap-3">
          {settings.map(
            ({
              history,
              setting,
              staff,
              staffProfileAvatarUrl,
              staffProfileDisplayName,
            }) => {
              const isEditing = canManage && editStaffId === staff.id;

              return (
                <SettingsStaffCard canManage={canManage}
                  history={history}
                  isEditing={isEditing}
                  key={staff.id}
                  period={period}
                  returnPath={returnPath}
                  setting={setting}
                  staff={staff}
                  staffProfileAvatarUrl={staffProfileAvatarUrl}
                  staffProfileDisplayName={staffProfileDisplayName}
                />
              );
            },
          )}
        </div>
        <PayrollDisclosure summary="Setting notes" className={styles.compactNote}><SettingsExplanationNote /></PayrollDisclosure>
      </div>
    </section>
  );
}

export function AppLocalOwnerPayrollView({ value, params }: { value: AppLocalOwnerPayrollData; params: AppLocalOwnerPayrollParams }) {
  const __vt = useWorkspaceTranslation();
  const { payroll: data, salonId, salonName, canManageConnection, taxPlugin, downloadEnabled } = value;
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
    <PayrollEditBoundary><PayrollLiveRefresh salonId={salonId} /><main className={`${styles.page} mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8`}>
      <header className={styles.heading}><div><h1>Payroll</h1><p className={styles.context}>{salonName}</p></div>{data.ledger.state !== "legacy_review" && <span className={styles.status}><WorkspaceText text={data.ledger.state === "closed" ? "Closed" : data.ledger.state === "open" ? "Current calculation" : "Needs review"} /></span>}</header>
      <Tabs
        activeTab={activeTab}
        canViewAllPayroll={data.access.canViewAllPayroll}
        period={data.period}
      />
      {(!["overview", "settings", "tools", "download"].includes(activeTab)) || visiblePayrollError ? <header className="flex flex-col gap-4">
        {visiblePayrollError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <WorkspaceText text={visiblePayrollError} />
          </p>
        ) : null}
        {["overview", "settings", "tools", "download"].includes(activeTab) ? null : (
          <PeriodSelector
            activeTab={activeTab}
            period={data.period}
            periodOptions={data.periodOptions}
            scheduleSetup={data.scheduleSetup}
            salonPayrollSetting={data.salonPayrollSetting}
          />
        )}
      </header> : null}

      {activeTab !== "overview" && data.difference.changed ? (
        <PayrollDisclosure summary="Review changes" className={styles.compactNote}><DifferenceBanner
          canManage={data.access.canManagePayroll}
          corrections={data.live.corrections}
          difference={data.difference}
          period={data.period}
          returnPath={returnPath}
        /></PayrollDisclosure>
      ) : null}

      {activeTab !== "settings" && activeTab !== "tools" && <PayrollLedgerPanel ledger={data.ledger} lines={data.live.lines} scope={value.payrollScope} />}
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
          summary={__vt(data.live.shopSummary)}
        />
      ) : null}
      {activeTab === "staff" || (activeTab === "shop" && data.access.canViewAllPayroll) ? (
        <footer className={styles.output} aria-label={__vt("Payroll output actions")}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span><WorkspaceText text="Total staff payout" /></span><strong>{formatMoney(data.live.lines.reduce((sum, line) => sum + line.final_staff_income, 0))}</strong></div>
          

        </footer>
      ) : null}
      {activeTab === "tax" && data.access.canViewAllPayroll ? (
        <TaxTab canManageConnection={canManageConnection} period={data.period} taxCompany={data.taxCompany} plugin={taxPlugin} hasChanges={data.difference.changed} />
      ) : null}
      {activeTab === "settings" && data.access.canViewAllPayroll ? (
        <SettingsTab canManage={data.access.canManagePayroll}
          editStaffId={params.editStaff}
          period={data.period}
          returnPath={returnPath}
          salonPayrollSetting={data.salonPayrollSetting}
          settings={data.staffPayrollSettings}
        />
      ) : null}
      {activeTab === "tools" && data.access.canViewAllPayroll && <ToolsTab period={data.period} downloadEnabled={downloadEnabled} canActivate={canManageConnection} />}
      {activeTab === "download" && downloadEnabled === false && canManageConnection && <PluginActivationButton pluginName="Payroll Data Download" label="Download payroll data" buttonLabel="Download" />}
      {activeTab === "download" && downloadEnabled && data.access.canViewAllPayroll ? <DataDownloadPanel key={`${salonId}-${data.period.startDate}-${data.period.endDate}`} startDate={data.period.startDate} endDate={data.period.endDate} /> : null}
      {canManageConnection && ["tools", "download"].includes(activeTab) && downloadEnabled === null && <p role="status" className="text-sm"><WorkspaceText text="Download status unavailable. Reload payroll." /></p>}
    </main></PayrollEditBoundary>
  );
}
