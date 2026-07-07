import {
  markLatestPayrollStatementPaidAction,
  savePayrollPeriodStaffInputAction,
  savePayrollStatementAction,
  saveSalonPayrollScheduleAction,
  saveStaffPayrollSettingWithEffectiveDateAction,
} from "@/app/payroll/actions";
import { PayrollScheduleForm } from "@/app/payroll/payroll-schedule-form";
import { getPayrollPageData } from "@/lib/payroll";
import type {
  PayrollCorrectionListItem,
  PayrollPeriod,
  PayrollStaffDailyTotal,
  PayrollStaffLineWithDailyTotals,
  PayrollShopDailyRow,
  PayrollShopSummary,
  PayrollSummary,
  SalonPayrollSetting,
  StaffPayrollSettingWithStaff,
} from "@/types/payroll";
import Link from "next/link";
import { Fragment } from "react";

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
  staffCommissionPay: "Staff Commission Pay",
  staffProduction: "Staff production",
  tips: "Tips",
  totalActualIncome: "Actual income",
  totalBonus: "Bonus",
  totalCashPayout: "Cash payout",
  totalCheckGross: "Check gross",
  totalCheckNet: "Check net",
  totalFinalStaffIncome: "Final staff income",
  totalPosIncome: "POS income",
  totalShopShare: "Shop share",
  totalStaffCommissionPayout: "Staff Commission Pay",
  totalStaffGrossProduction: "Gross production",
  totalTaxWithheld: "Tax withheld",
  totalTip: "Tips",
};

const LINE_DIFF_LABELS: Record<string, string> = {
  bonus_amount: "Bonus",
  cash_amount: "Cash",
  check_gross: "Check gross",
  check_net: "Check net",
  check_number: "Check number",
  check_rate_used: "Check rate",
  commission_rate_used: "Commission rate",
  final_staff_income: "Final income",
  fixed_pay_amount_used: "Fixed pay",
  gross_sales: "Gross",
  is_mixed_rate: "Mixed rate",
  note: "Note",
  shop_share: "Shop share",
  staff_commission_gross: "Staff Commission Pay",
  tax_company_enabled: "Tax company",
  tax_rate_used: "Tax rate",
  tax_withheld: "Tax",
  tip_amount: "Tips",
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
              <th className="px-4 py-3 text-right">Tips</th>
              <th className="px-4 py-3 text-right">Staff Commission Pay</th>
              <th className="px-4 py-3 text-right">Cash</th>
              <th className="px-4 py-3 text-right">Check Gross</th>
              <th className="px-4 py-3 text-right">Tax</th>
              <th className="px-4 py-3 text-right">Check Net</th>
              <th className="px-4 py-3 text-right">Final</th>
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
                  <td className="px-4 py-3 text-right">{formatMoney(line.tip_amount)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.staff_commission_gross)}
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(line.cash_amount)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(line.check_gross)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(line.tax_withheld)}
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(line.check_net)}</td>
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
                  <td className="bg-zinc-50 px-4 py-3" colSpan={14}>
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

function correctionTypeLabel(value: string) {
  const labels: Record<string, string> = {
    credit_card_amount: "Credit card correction",
    daily_closing: "Daily closing adjustment",
    staff_earning: "Staff earning correction",
    ticket_correction: "Ticket correction",
  };

  return labels[value] ?? value.replaceAll("_", " ");
}

function shopStatusLabel(status: PayrollShopDailyRow["overShortStatus"]) {
  if (status === "balanced") {
    return "Balanced";
  }

  if (status === "over") {
    return "Over";
  }

  if (status === "short") {
    return "Short";
  }

  return "No closing input";
}

function shopStatusBadgeClass(status: PayrollShopDailyRow["overShortStatus"]) {
  if (status === "balanced") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "over") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  if (status === "short") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }

  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function ShopCorrections({ corrections }: { corrections: PayrollCorrectionListItem[] }) {
  if (corrections.length === 0) {
    return <span className="text-zinc-400">-</span>;
  }

  return (
    <details>
      <summary className="cursor-pointer font-medium text-zinc-700">
        {corrections.length} correction{corrections.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-2 space-y-2 text-xs text-zinc-600">
        {corrections.map((correction) => (
          <li key={`${correction.source}-${correction.id}`}>
            <span className="font-medium text-zinc-800">
              {correctionTypeLabel(correction.type)}
            </span>
            {" - "}
            {correction.delta === null
              ? "Audit only"
              : correction.delta === 0
                ? "Audit only"
                : formatMoney(correction.delta)}
            {" - "}
            {correction.staffName ?? "Shop"}
            {" - "}
            {correction.status}
          </li>
        ))}
      </ul>
    </details>
  );
}

function ShopIncomeTab({
  rows,
  summary,
}: {
  rows: PayrollShopDailyRow[];
  summary: PayrollShopSummary;
}) {
  return (
    <section className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="Actual income"
          value={formatOptionalMoney(summary.totalActualIncome, "No manual input data")}
        />
        <SummaryCard label="POS income" value={formatMoney(summary.posIncome)} />
        <SummaryCard
          label="Manual input"
          value={formatOptionalMoney(summary.manualInputIncome, "No manual input data")}
        />
        <SummaryCard
          label="Over / Short"
          value={formatOptionalMoney(summary.overShortTotal, "No manual input data")}
        />
        <SummaryCard
          label="Staff Production"
          value={formatMoney(summary.staffProduction)}
        />
        <SummaryCard
          label="Staff Commission Pay"
          value={formatMoney(summary.staffCommissionPay)}
        />
        <SummaryCard label="Shop share" value={formatMoney(summary.shopShare)} />
        <SummaryCard label="Tips" value={formatMoney(summary.tips)} />
        <SummaryCard label="Cash" value={formatOptionalMoney(summary.cashAmount)} />
        <SummaryCard
          label="Credit card"
          value={formatOptionalMoney(summary.creditCardAmount)}
        />
        <SummaryCard label="Other" value={formatOptionalMoney(summary.otherAmount)} />
        <SummaryCard label="Corrections" value={`${summary.correctionCount}`} />
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">POS income</th>
                <th className="px-4 py-3 text-right">Manual input</th>
                <th className="px-4 py-3 text-right">Over / Short</th>
                <th className="px-4 py-3 text-right">Staff production</th>
                <th className="px-4 py-3 text-right">Staff commission pay</th>
                <th className="px-4 py-3 text-right">Tips</th>
                <th className="px-4 py-3 text-right">Shop share</th>
                <th className="px-4 py-3 text-right">Cash</th>
                <th className="px-4 py-3 text-right">Credit card</th>
                <th className="px-4 py-3 text-right">Other</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Corrections</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((row) => (
                <tr className="align-top" key={row.businessDate}>
                  <td className="px-4 py-3 font-medium text-zinc-950">
                    {formatDate(row.businessDate)}
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.posIncome)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatOptionalMoney(row.manualInputIncome, "No manual input")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatOptionalMoney(row.difference, "-")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.staffProduction)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatMoney(row.staffCommissionPay)}
                  </td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.tips)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(row.shopShare)}</td>
                  <td className="px-4 py-3 text-right">
                    {formatOptionalMoney(row.cashAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatOptionalMoney(row.creditCardAmount)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatOptionalMoney(row.otherAmount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full border px-2 py-1 text-xs font-semibold ${shopStatusBadgeClass(
                        row.overShortStatus,
                      )}`}
                    >
                      {shopStatusLabel(row.overShortStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ShopCorrections corrections={row.corrections} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 p-4">
          <h2 className="text-base font-semibold text-zinc-950">
            Staff Payroll Settings
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Staff</th>
                <th className="px-4 py-3">Pay type</th>
                <th className="px-4 py-3">Rate</th>
                <th className="px-4 py-3">Check split</th>
                <th className="px-4 py-3">Tax</th>
                <th className="px-4 py-3">Tax company</th>
                <th className="px-4 py-3">Effective</th>
                <th className="px-4 py-3">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {settings.map(({ history, setting, staff }) => {
                const isEditing = editStaffId === staff.id;
                const formId = `staff-setting-${staff.id}`;

                return (
                  <Fragment key={staff.id}>
                    <tr className="align-top">
                      <td className="px-4 py-3 font-medium text-zinc-950">
                        {isEditing ? (
                          <>
                            <form action={saveStaffPayrollSettingWithEffectiveDateAction} id={formId}>
                              <input name="return_to" type="hidden" value={returnPath} />
                              <input name="staff_id" type="hidden" value={staff.id} />
                            </form>
                            <p>{staff.display_name}</p>
                            <input
                              className="mt-2 w-40 rounded-md border border-zinc-300 px-2 py-1 text-sm"
                              defaultValue={setting?.legal_name ?? ""}
                              form={formId}
                              name="legal_name"
                              placeholder="Legal name"
                            />
                          </>
                        ) : (
                          staff.display_name
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <select
                            className="w-32 rounded-md border border-zinc-300 px-2 py-1"
                            defaultValue={setting?.pay_type ?? "commission"}
                            form={formId}
                            name="pay_type"
                          >
                            <option value="commission">Commission</option>
                            <option value="fixed">Fixed</option>
                          </select>
                        ) : (
                          setting?.pay_type ?? "commission"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <input
                              className="w-24 rounded-md border border-zinc-300 px-2 py-1"
                              defaultValue={setting?.commission_rate ?? 60}
                              form={formId}
                              max="100"
                              min="0"
                              name="commission_rate"
                              step="0.01"
                              type="number"
                            />
                            <input
                              className="w-28 rounded-md border border-zinc-300 px-2 py-1"
                              defaultValue={setting?.fixed_pay_amount ?? 0}
                              form={formId}
                              min="0"
                              name="fixed_pay_amount"
                              step="0.01"
                              type="number"
                            />
                          </div>
                        ) : setting?.pay_type === "fixed" ? (
                          formatMoney(setting.fixed_pay_amount)
                        ) : (
                          formatPercent(setting?.commission_rate ?? 60)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className="w-24 rounded-md border border-zinc-300 px-2 py-1"
                            defaultValue={setting?.check_rate ?? 60}
                            form={formId}
                            max="100"
                            min="0"
                            name="check_rate"
                            step="0.01"
                            type="number"
                          />
                        ) : (
                          formatPercent(setting?.check_rate ?? 60)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex flex-col gap-2">
                            <input
                              className="w-24 rounded-md border border-zinc-300 px-2 py-1"
                              defaultValue={setting?.tax_rate ?? 0}
                              form={formId}
                              max="100"
                              min="0"
                              name="tax_rate"
                              step="0.01"
                              type="number"
                            />
                            <label className="flex items-center gap-2 text-xs text-zinc-700">
                              <input
                                defaultChecked={setting?.apply_tax_to_fixed_pay ?? true}
                                form={formId}
                                name="apply_tax_to_fixed_pay"
                                type="checkbox"
                              />
                              Tax fixed
                            </label>
                          </div>
                        ) : (
                          formatPercent(setting?.tax_rate ?? 0)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            defaultChecked={setting?.tax_company_enabled ?? false}
                            form={formId}
                            name="tax_company_enabled"
                            type="checkbox"
                          />
                        ) : setting?.tax_company_enabled ? (
                          "Enabled"
                        ) : (
                          "Off"
                        )}
                      </td>
                      <td className="px-4 py-3">{setting?.effective_from ?? "Default"}</td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="rounded-md bg-zinc-950 px-3 py-2 text-xs font-medium text-white"
                              form={formId}
                            >
                              Save
                            </button>
                            <Link
                              className="rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800"
                              href={returnPath}
                            >
                              Cancel
                            </Link>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Link
                              className="font-medium text-zinc-800 underline"
                              href={getSettingsEditHref(period, staff.id)}
                            >
                              Edit
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                    {isEditing ? (
                      <tr>
                        <td className="bg-zinc-50 px-4 py-3" colSpan={8}>
                          <label className="flex max-w-sm flex-col gap-1 text-xs font-medium text-zinc-700">
                            Effective from
                            <input
                              className="rounded-md border border-zinc-300 px-2 py-1"
                              defaultValue={period.startDate}
                              form={formId}
                              name="effective_from"
                              required
                              type="date"
                            />
                            <span className="font-normal text-amber-700">
                              Past effective dates may change live payroll numbers for previous periods.
                            </span>
                          </label>
                        </td>
                      </tr>
                    ) : null}
                    <tr>
                      <td className="bg-zinc-50 px-4 py-2" colSpan={8}>
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                            History
                          </summary>
                          {history.length > 0 ? (
                            <div className="mt-2 overflow-x-auto">
                              <table className="min-w-full text-xs">
                                <thead className="text-left uppercase text-zinc-500">
                                  <tr>
                                    <th className="py-2 pr-4">Changed at</th>
                                    <th className="py-2 pr-4">Effective from</th>
                                    <th className="py-2 pr-4">Pay type</th>
                                    <th className="py-2 pr-4">Rate</th>
                                    <th className="py-2 pr-4">Check split</th>
                                    <th className="py-2 pr-4">Tax</th>
                                    <th className="py-2 pr-4">Tax company</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {history.map((version) => (
                                    <tr key={version.id || version.effective_from}>
                                      <td className="py-1 pr-4">
                                        {version.updated_at ? formatDate(version.updated_at.slice(0, 10)) : "-"}
                                      </td>
                                      <td className="py-1 pr-4">{version.effective_from}</td>
                                      <td className="py-1 pr-4">{version.pay_type}</td>
                                      <td className="py-1 pr-4">
                                        {version.pay_type === "fixed"
                                          ? formatMoney(version.fixed_pay_amount)
                                          : formatPercent(version.commission_rate)}
                                      </td>
                                      <td className="py-1 pr-4">{formatPercent(version.check_rate)}</td>
                                      <td className="py-1 pr-4">{formatPercent(version.tax_rate)}</td>
                                      <td className="py-1 pr-4">
                                        {version.tax_company_enabled ? "Enabled" : "Off"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-zinc-500">
                              No effective setting history yet.
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
