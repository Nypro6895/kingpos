import {
  markLatestPayrollStatementPaidAction,
  savePayrollPeriodStaffInputAction,
  savePayrollStatementAction,
  saveSalonPayrollScheduleAction,
} from "@/app/payroll/actions";
import { PayrollScheduleForm } from "@/app/payroll/payroll-schedule-form";
import { ShopIncomeDailyTable } from "@/app/payroll/shop-income-daily-table";
import { StaffPayrollSettingInlineEdit } from "@/app/payroll/staff-payroll-setting-inline-edit";
import { getPayrollPageData } from "@/lib/payroll";
import type {
  PayrollPeriod,
  PayrollStaffDailyTotal,
  PayrollStaffLineWithDailyTotals,
  PayrollShopDailyRow,
  PayrollShopSummary,
  PayrollSummary,
  SalonPayrollSetting,
  StaffPayrollSetting,
  StaffPayrollSettingWithStaff,
} from "@/types/payroll";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";

type PayrollPageProps = {
  searchParams: Promise<{
    end?: string;
    month?: string;
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

const SUMMARY_LABELS: Record<string, string> = {
  cashAmount: "Cash",
  correctionAfterLockdayCount: "Corrections",
  correctionCount: "Corrections",
  creditCardAmount: "Credit card",
  manualInputIncome: "Manual input income",
  missingPaystubCount: "Missing paystubs",
  otherAmount: "Other",
  overShortTotal: "Over / Short",
  posIncome: "POS income",
  shopShare: "Shop share",
  shopNetIncome: "Shop net income",
  staffCommissionPay: "Staff Commission Pay",
  staffNetPay: "Staff pay",
  staffProduction: "Staff production",
  tips: "Tips",
  tipsPaid: "Tips paid",
  totalActualIncome: "Actual income",
  totalStaffObligation: "Staff obligation",
  totalBonus: "Bonus",
  totalCashPayout: "Cash payout",
  totalCheckGross: "Check gross",
  totalCheckNet: "Check amount",
  totalFinalStaffIncome: "Final staff income",
  totalPosIncome: "POS income",
  totalShopShare: "Shop share",
  totalStaffCommissionPayout: "Staff Commission Pay",
  totalStaffGrossProduction: "Gross production",
  totalTaxWithheld: "Tax withheld",
  totalTaxCompanyAmount: "Tax company total",
  totalTaxCompanyCashAmount: "Tax company cash",
  totalTaxCompanyCheckAmount: "Tax company check",
  totalTip: "Tips",
};

const LINE_DIFF_LABELS: Record<string, string> = {
  base_cash_amount: "Base cash",
  base_check_amount: "Base check",
  bonus_amount: "Bonus",
  bonus_cash_amount: "Bonus cash",
  bonus_check_amount: "Bonus check",
  bonus_payout_method: "Bonus",
  cash_amount: "Cash",
  cash_to_tax_company: "Tax cash",
  check_gross: "Check gross",
  check_net: "Check net",
  check_number: "Check number",
  check_rate_used: "Check rate",
  commission_rate_used: "Commission rate",
  final_staff_income: "Final income",
  final_cash_amount: "Cash amount",
  final_check_amount: "Check amount",
  earned_amount: "Earned",
  fixed_pay_amount_used: "Fixed pay",
  gross_sales: "Gross",
  is_mixed_rate: "Mixed rate",
  note: "Note",
  shop_share: "Shop share",
  staff_commission_gross: "Staff Commission Pay",
  tax_company_cash_amount: "Tax company cash",
  tax_company_check_amount: "Tax company check",
  tax_company_enabled: "Tax company",
  tax_rate_used: "Tax rate",
  tax_withheld: "Tax",
  tip_amount: "Tips",
  tip_cash_amount: "Tip cash",
  tip_check_amount: "Tip check",
  tip_payout_method: "Tip",
};

const COUNT_DIFF_FIELDS = new Set([
  "correctionAfterLockdayCount",
  "correctionCount",
  "missingPaystubCount",
]);

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

function formatDifferenceValue(field: string, value: number) {
  return COUNT_DIFF_FIELDS.has(field) ? `${value}` : formatMoney(value);
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

function rateLabel(line: PayrollStaffLineWithDailyTotals) {
  if (line.is_mixed_rate) {
    return "Mixed";
  }

  if (line.pay_type_used === "fixed") {
    return `Fixed ${formatMoney(line.fixed_pay_amount_used)}`;
  }

  return formatPercent(line.commission_rate_used);
}

function dailyRateLabel(dailyTotal: PayrollStaffDailyTotal) {
  if (dailyTotal.pay_type_used === "fixed") {
    return `Fixed ${formatMoney(dailyTotal.fixed_pay_amount_used ?? 0)}`;
  }

  if (dailyTotal.pay_type_used === "commission") {
    return formatPercent(dailyTotal.commission_rate_used ?? 0);
  }

  return "-";
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
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
  latestStatement,
  period,
  returnPath,
}: {
  canManage: boolean;
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
        <button
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
          disabled={!canManage || !canMarkPaid}
        >
          Mark Paid
        </button>
      </form>
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
  difference,
  period,
  returnPath,
}: {
  canManage: boolean;
  difference: Awaited<ReturnType<typeof getPayrollPageData>>["difference"];
  period: PayrollPeriod;
  returnPath: string;
}) {
  if (!difference.changed) {
    return null;
  }

  const summaryEntries = Object.entries(difference.summaryDifferences).slice(0, 6);
  const staffEntries = difference.staffDifferences.slice(0, 4);

  return (
    <section
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      id="payroll-differences"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Live payroll has changed since last print.</p>
          <p>Live payroll differs from the latest saved statement for this period.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className="rounded-md border border-amber-300 px-3 py-2 font-medium text-amber-900"
            href="#payroll-differences"
          >
            View Difference
          </a>
          <form action={savePayrollStatementAction}>
            <HiddenPeriodFields period={period} returnPath={returnPath} />
            <button
              className="rounded-md bg-zinc-950 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!canManage}
            >
              Print New Statement
            </button>
          </form>
        </div>
      </div>
      {summaryEntries.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {summaryEntries.map(([field, value]) => (
            <div className="rounded-md bg-white/70 p-2" key={field}>
              <p className="text-xs font-medium uppercase text-amber-700">
                {SUMMARY_LABELS[field] ?? field}
              </p>
              <p className="font-semibold">
                {formatDifferenceValue(field, value.previous)}
                {" -> "}
                {formatDifferenceValue(field, value.current)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      {staffEntries.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {staffEntries.map((staff) => {
            const firstDifference = Object.entries(staff.differences)[0];

            return (
              <li key={staff.staffId}>
                {staff.staffName}:{" "}
                {firstDifference
                  ? firstDifference[0] === "check_number" ||
                    firstDifference[0] === "note" ||
                    firstDifference[0] === "tax_company_enabled" ||
                    firstDifference[0] === "cash_to_tax_company" ||
                    firstDifference[0] === "tip_payout_method" ||
                    firstDifference[0] === "bonus_payout_method" ||
                    firstDifference[0] === "is_mixed_rate"
                    ? `${LINE_DIFF_LABELS[firstDifference[0]] ?? firstDifference[0]} changed`
                    : `${LINE_DIFF_LABELS[firstDifference[0]] ?? firstDifference[0]} ${formatMoney(
                        firstDifference[1].previous,
                      )} -> ${formatMoney(firstDifference[1].current)}`
                  : "changed"}
              </li>
            );
          })}
        </ul>
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

function OverviewTab({
  shopSummary,
  summary,
}: {
  shopSummary: PayrollShopSummary;
  summary: PayrollSummary;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <SummaryCard label="POS Income" value={formatMoney(summary.totalPosIncome)} />
      <SummaryCard
        label="Actual Income"
        value={formatOptionalMoney(
          shopSummary.totalActualIncome,
          "No manual input data",
        )}
      />
      <SummaryCard
        label="Over / Short"
        value={formatOptionalMoney(shopSummary.overShortTotal, "No manual input data")}
      />
      <SummaryCard
        label="Staff Production"
        value={formatMoney(summary.totalStaffGrossProduction)}
      />
      <SummaryCard
        label="Staff Commission Pay"
        value={formatMoney(summary.totalStaffCommissionPayout)}
      />
      <SummaryCard label="Cash Payout" value={formatMoney(summary.totalCashPayout)} />
      <SummaryCard label="Check Gross" value={formatMoney(summary.totalCheckGross)} />
      <SummaryCard label="Tax Withheld" value={formatMoney(summary.totalTaxWithheld)} />
      <SummaryCard label="Check Net" value={formatMoney(summary.totalCheckNet)} />
      <SummaryCard label="Tips" value={formatMoney(summary.totalTip)} />
      <SummaryCard label="Bonus" value={formatMoney(summary.totalBonus)} />
      <SummaryCard
        label="Final Staff Income"
        value={formatMoney(summary.totalFinalStaffIncome)}
      />
      <SummaryCard label="Shop Share" value={formatMoney(summary.totalShopShare)} />
      <SummaryCard label="Corrections" value={`${summary.correctionAfterLockdayCount}`} />
    </section>
  );
}

function StaffIncomeTab({
  canManage,
  lines,
  period,
  returnPath,
}: {
  canManage: boolean;
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
  returnPath: string;
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No staff income lines for this period.
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Staff</th>
              <th className="px-4 py-3">Rate</th>
              <th className="px-4 py-3 text-right">Gross</th>
              <th className="px-4 py-3 text-right">Tax</th>
              <th className="px-4 py-3 text-right">Earned</th>
              <th className="px-4 py-3 text-right">Check amount</th>
              <th className="px-4 py-3 text-right">Cash amount</th>
              <th className="px-4 py-3 text-right">Tip check</th>
              <th className="px-4 py-3 text-right">Tip cash</th>
              <th className="px-4 py-3 text-right">Bonus check</th>
              <th className="px-4 py-3 text-right">Bonus cash</th>
              <th className="px-4 py-3 text-right">Total received</th>
              <th className="px-4 py-3">Check #</th>
              <th className="px-4 py-3 text-right">Bonus</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">Save</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {lines.map((line) => {
              const formId = `payroll-input-${line.staff_id}`;

              return (
                <Fragment key={line.staff_id}>
                  <tr className="align-middle">
                  <td className="px-4 py-3">
                    <form action={savePayrollPeriodStaffInputAction} id={formId}>
                      <HiddenPeriodFields period={period} returnPath={returnPath} />
                      <input name="staff_id" type="hidden" value={line.staff_id} />
                    </form>
                    <p className="font-medium text-zinc-950">
                      {line.staff_display_name_snapshot}
                    </p>
                    {line.tax_company_enabled_snapshot && !line.staff_legal_name_snapshot ? (
                      <p className="text-xs font-medium text-amber-700">
                        Missing legal name
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{rateLabel(line)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(line.gross_sales)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.tax_withheld)}
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(line.earned_amount)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.final_check_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.final_cash_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.tip_check_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.tip_cash_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.bonus_check_amount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.bonus_cash_amount)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatMoney(line.final_staff_income)}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="w-28 rounded-md border border-zinc-300 px-2 py-1"
                      defaultValue={line.check_number ?? ""}
                      disabled={!canManage}
                      form={formId}
                      name="check_number"
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-right"
                      defaultValue={line.bonus_amount}
                      disabled={!canManage}
                      form={formId}
                      min="0"
                      name="bonus_amount"
                      step="0.01"
                      type="number"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="w-48 rounded-md border border-zinc-300 px-2 py-1"
                      defaultValue={line.note ?? ""}
                      disabled={!canManage}
                      form={formId}
                      name="note"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="rounded-md border border-zinc-300 px-3 py-1 font-medium disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
                      disabled={!canManage}
                      form={formId}
                    >
                      Save
                    </button>
                  </td>
                </tr>
                <tr>
                  <td className="bg-zinc-50 px-4 py-3" colSpan={16}>
                    <details>
                      <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                        Daily breakdown
                      </summary>
                      {line.dailyTotals.length > 0 ? (
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-full text-xs">
                            <thead className="text-left uppercase text-zinc-500">
                              <tr>
                                <th className="py-2 pr-4">Date</th>
                                <th className="py-2 pr-4 text-right">Gross</th>
                                <th className="py-2 pr-4 text-right">Tips</th>
                                <th className="py-2 pr-4">Rate used</th>
                                <th className="py-2 pr-4 text-right">Correction</th>
                              </tr>
                            </thead>
                            <tbody>
                              {line.dailyTotals.map((dailyTotal) => (
                                <tr key={dailyTotal.id}>
                                  <td className="py-1 pr-4">
                                    {formatDate(dailyTotal.business_date)}
                                  </td>
                                  <td className="py-1 pr-4 text-right">
                                    {formatMoney(dailyTotal.gross_sales)}
                                  </td>
                                  <td className="py-1 pr-4 text-right">
                                    {formatMoney(dailyTotal.tip_amount)}
                                  </td>
                                  <td className="py-1 pr-4">
                                    {dailyRateLabel(dailyTotal)}
                                  </td>
                                  <td className="py-1 pr-4 text-right">
                                    {formatMoney(dailyTotal.correction_delta)}
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
                    </details>
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
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
  lines,
  period,
}: {
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
}) {
  const taxLines = lines.filter((line) => line.tax_company_enabled_snapshot);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-zinc-950">Tax company preview</p>
          <p className="text-sm text-zinc-500">
            {taxLines.length} enabled staff line{taxLines.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          href={getTaxCompanyHref(period)}
        >
          Open Tax Company
        </Link>
      </div>
      {taxLines.some((line) => !line.staff_legal_name_snapshot) ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some enabled staff are missing legal names.
        </p>
      ) : null}
      <StaffIncomeTab canManage={false} lines={taxLines} period={period} returnPath="" />
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
                    ? formatDate(version.updated_at.slice(0, 10))
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
            cash payout is shown on Tax Company. Tax tip controls whether tips are
            included in tax reporting.
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
        Tax cash only controls Tax Company visibility for cash payout. It does not
        change what the staff actually receives.
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
        <PeriodSelector
          activeTab={activeTab}
          period={data.period}
          periodOptions={data.periodOptions}
          scheduleSetup={data.scheduleSetup}
          salonPayrollSetting={data.salonPayrollSetting}
        />
      </header>

      <DifferenceBanner
        canManage={data.access.canManagePayroll}
        difference={data.difference}
        period={data.period}
        returnPath={returnPath}
      />
      <Tabs
        activeTab={activeTab}
        canViewAllPayroll={data.access.canViewAllPayroll}
        period={data.period}
      />

      {activeTab === "overview" ? (
        <OverviewTab
          shopSummary={data.live.shopSummary}
          summary={data.live.summary}
        />
      ) : null}
      {activeTab === "staff" ? (
        <StaffIncomeTab
          canManage={data.access.canManagePayroll}
          lines={data.live.lines}
          period={data.period}
          returnPath={returnPath}
        />
      ) : null}
      {activeTab === "shop" && data.access.canViewAllPayroll ? (
        <ShopIncomeTab
          rows={data.live.shopDailyRows}
          summary={data.live.shopSummary}
        />
      ) : null}
      {activeTab === "tax" && data.access.canViewAllPayroll ? (
        <TaxTab lines={data.live.lines} period={data.period} />
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
