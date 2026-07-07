import {
  generatePayroll,
  lockPayroll,
  markPayrollPaid,
  recalculatePayroll,
  savePayrollStaffLine,
  saveSalonPayrollSetting,
  saveStaffPayrollSetting,
} from "@/app/payroll/actions";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getPayrollPageData } from "@/lib/payroll";
import type {
  PayrollCorrectionListItem,
  PayrollPeriod,
  PayrollRun,
  PayrollRunStatus,
  PayrollStaffLineWithDailyTotals,
  PayrollSummary,
  SalonPayrollSetting,
  StaffPayrollSettingWithStaff,
} from "@/types/payroll";
import Link from "next/link";
import { redirect } from "next/navigation";

type PayrollPageProps = {
  searchParams: Promise<{
    cycleType?: string;
    end?: string;
    error?: string;
    preset?: string;
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

function formatPercent(value: number) {
  return `${Number(value).toFixed(2).replace(/\.00$/, "")}%`;
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
    end: input.period.endDate,
    preset: input.period.preset,
    start: input.period.startDate,
    tab: input.tab,
  });

  return `/payroll?${params.toString()}`;
}

function getTaxCompanyHref(period: PayrollPeriod) {
  const params = new URLSearchParams({
    end: period.endDate,
    preset: period.preset,
    start: period.startDate,
  });

  return `/payroll/tax-company?${params.toString()}`;
}

function getReturnPath(period: PayrollPeriod, tab: PayrollTab) {
  return getPayrollHref({ period, tab });
}

function getStatusLabel(status: PayrollRunStatus | "not_generated") {
  const labels = {
    draft: "Draft",
    locked: "Locked",
    needs_review: "Needs Review",
    not_generated: "Not Generated",
    paid: "Paid",
  };

  return labels[status];
}

function getDisplayStatus(
  run: PayrollRun | null,
  corrections: PayrollCorrectionListItem[],
) {
  if (!run) {
    return "not_generated" as const;
  }

  if (
    run.status === "locked" &&
    corrections.some((correction) => correction.correctionDate > run.generated_at)
  ) {
    return "needs_review" as const;
  }

  return run.status;
}

function statusBadgeClass(status: PayrollRunStatus | "not_generated") {
  if (status === "paid") {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }

  if (status === "locked") {
    return "bg-zinc-950 text-white border-zinc-950";
  }

  if (status === "needs_review") {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }

  return "bg-white text-zinc-700 border-zinc-300";
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
      <input name="period_start" type="hidden" value={period.startDate} />
      <input name="period_end" type="hidden" value={period.endDate} />
      <input name="cycle_type" type="hidden" value={period.cycleType} />
      <input name="return_to" type="hidden" value={returnPath} />
    </>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
    </section>
  );
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Payroll</h1>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function NoPermissionState({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Payroll</h1>
      <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
        {message}
      </p>
    </main>
  );
}

function PeriodSelector({
  activeTab,
  period,
}: {
  activeTab: PayrollTab;
  period: PayrollPeriod;
}) {
  return (
    <form
      action="/payroll"
      className="grid gap-3 border-b border-zinc-200 py-5 sm:grid-cols-[220px_180px_180px_auto]"
      method="get"
    >
      <input name="tab" type="hidden" value={activeTab} />
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500">Period</span>
        <select
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={period.preset}
          name="preset"
        >
          <option value="previous_month">Previous month</option>
          <option value="previous_biweekly">Previous biweekly period</option>
          <option value="custom">Custom date range</option>
        </select>
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500">Start</span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={period.startDate}
          name="start"
          type="date"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500">End</span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={period.endDate}
          name="end"
          type="date"
        />
      </label>
      <div className="flex items-end">
        <button
          className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white"
          type="submit"
        >
          Load
        </button>
      </div>
    </form>
  );
}

function TopActions({
  canManage,
  period,
  run,
}: {
  canManage: boolean;
  period: PayrollPeriod;
  run: PayrollRun | null;
}) {
  const returnPath = getReturnPath(period, "overview");
  const canRecalculate = canManage && run?.status === "draft";
  const canLock = canManage && run?.status === "draft";
  const canMarkPaid =
    canManage && (run?.status === "locked" || run?.status === "needs_review");

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <form action={generatePayroll}>
        <HiddenPeriodFields period={period} returnPath={returnPath} />
        <button
          className="rounded bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
          disabled={!canManage || Boolean(run)}
          type="submit"
        >
          Generate Payroll
        </button>
      </form>
      <form action={recalculatePayroll}>
        <input name="payroll_run_id" type="hidden" value={run?.id ?? ""} />
        <input name="return_to" type="hidden" value={returnPath} />
        <button
          className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-400"
          disabled={!canRecalculate}
          type="submit"
        >
          Recalculate Draft
        </button>
      </form>
      <form action={lockPayroll}>
        <input name="payroll_run_id" type="hidden" value={run?.id ?? ""} />
        <input name="return_to" type="hidden" value={returnPath} />
        <button
          className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-400"
          disabled={!canLock}
          type="submit"
        >
          Lock Payroll
        </button>
      </form>
      <form action={markPayrollPaid}>
        <input name="payroll_run_id" type="hidden" value={run?.id ?? ""} />
        <input name="return_to" type="hidden" value={returnPath} />
        <button
          className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-400"
          disabled={!canMarkPaid}
          type="submit"
        >
          Mark Paid
        </button>
      </form>
      <button
        className="rounded border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-400"
        disabled
        type="button"
      >
        Export
      </button>
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
    <nav className="mt-6 flex flex-wrap gap-2 border-b border-zinc-200">
      {visibleTabs.map((tab) => {
        const href =
          tab.id === "tax"
            ? getTaxCompanyHref(period)
            : getPayrollHref({ period, tab: tab.id });

        return (
          <Link
            className={
              tab.id === activeTab
                ? "border-b-2 border-zinc-950 px-3 py-2 text-sm font-medium text-zinc-950"
                : "px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
            }
            href={href}
            key={tab.id}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

function OverviewTab({ summary }: { summary: PayrollSummary }) {
  return (
    <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard label="Total POS Income" value={formatMoney(summary.totalPosIncome)} />
      <SummaryCard
        label="Staff Gross Production"
        value={formatMoney(summary.totalStaffGrossProduction)}
      />
      <SummaryCard
        label="Staff Commission Payout"
        value={formatMoney(summary.totalStaffCommissionPayout)}
      />
      <SummaryCard label="Shop Share" value={formatMoney(summary.totalShopShare)} />
      <SummaryCard label="Cash Payout" value={formatMoney(summary.totalCashPayout)} />
      <SummaryCard label="Check Gross" value={formatMoney(summary.totalCheckGross)} />
      <SummaryCard label="Tax Withheld" value={formatMoney(summary.totalTaxWithheld)} />
      <SummaryCard label="Check Net" value={formatMoney(summary.totalCheckNet)} />
      <SummaryCard label="Tip" value={formatMoney(summary.totalTip)} />
      <SummaryCard label="Bonus" value={formatMoney(summary.totalBonus)} />
      <SummaryCard
        label="Corrections"
        value={String(summary.correctionAfterLockdayCount)}
      />
      <SummaryCard label="Missing Paystub" value={String(summary.missingPaystubCount)} />
    </section>
  );
}

function StaffIncomeTab({
  canManage,
  lines,
  period,
  run,
}: {
  canManage: boolean;
  lines: PayrollStaffLineWithDailyTotals[];
  period: PayrollPeriod;
  run: PayrollRun | null;
}) {
  if (!run) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        No payroll snapshot exists for this period.
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        No staff income lines for this period.
      </div>
    );
  }

  const returnPath = getReturnPath(period, "staff");
  const canEditLines = canManage && run.status !== "paid";

  return (
    <section className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <div className="min-w-[1900px]">
        <div className="grid grid-cols-[180px_repeat(9,110px)_130px_100px_110px_120px_180px_90px] bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
          <div>Staff</div>
          <div className="text-right">Gross</div>
          <div>Pay Type</div>
          <div className="text-right">Rate/Fixed</div>
          <div className="text-right">Commission</div>
          <div className="text-right">Shop</div>
          <div className="text-right">Cash</div>
          <div className="text-right">Check Gross</div>
          <div className="text-right">Tax</div>
          <div className="text-right">Check Net</div>
          <div>Check #</div>
          <div className="text-right">Tip</div>
          <div>Bonus</div>
          <div className="text-right">Final</div>
          <div>Note</div>
          <div></div>
        </div>
        <div className="divide-y divide-zinc-200">
          {lines.map((line) => (
            <div key={line.id}>
              <form
                action={savePayrollStaffLine}
                className="grid grid-cols-[180px_repeat(9,110px)_130px_100px_110px_120px_180px_90px] items-center gap-0 px-4 py-3 text-sm"
              >
                <input name="line_id" type="hidden" value={line.id} />
                <input name="return_to" type="hidden" value={returnPath} />
                <div>
                  <p className="font-medium text-zinc-950">
                    {line.staff_display_name_snapshot}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {line.staff_legal_name_snapshot || "-"}
                  </p>
                </div>
                <div className="text-right">{formatMoney(line.gross_sales)}</div>
                <div className="capitalize">{line.pay_type_used}</div>
                <div className="text-right">
                  {line.pay_type_used === "fixed"
                    ? formatMoney(line.fixed_pay_amount_used)
                    : formatPercent(line.commission_rate_used)}
                </div>
                <div className="text-right">
                  {formatMoney(line.staff_commission_gross)}
                </div>
                <div className="text-right">{formatMoney(line.shop_share)}</div>
                <div className="text-right">{formatMoney(line.cash_amount)}</div>
                <div className="text-right">{formatMoney(line.check_gross)}</div>
                <div className="text-right">{formatMoney(line.tax_withheld)}</div>
                <div className="text-right">{formatMoney(line.check_net)}</div>
                <div className="px-2">
                  <input
                    className="h-9 w-full rounded border border-zinc-300 bg-white px-2 text-sm disabled:bg-zinc-50"
                    defaultValue={line.check_number ?? ""}
                    disabled={!canEditLines}
                    name="check_number"
                  />
                </div>
                <div className="text-right">{formatMoney(line.tip_amount)}</div>
                <div className="px-2">
                  <input
                    className="h-9 w-full rounded border border-zinc-300 bg-white px-2 text-sm disabled:bg-zinc-50"
                    defaultValue={line.bonus_amount.toFixed(2)}
                    disabled={!canEditLines}
                    min="0"
                    name="bonus_amount"
                    step="0.01"
                    type="number"
                  />
                </div>
                <div className="text-right font-medium text-zinc-950">
                  {formatMoney(line.final_staff_income)}
                </div>
                <div className="px-2">
                  <input
                    className="h-9 w-full rounded border border-zinc-300 bg-white px-2 text-sm disabled:bg-zinc-50"
                    defaultValue={line.note ?? ""}
                    disabled={!canEditLines}
                    name="note"
                  />
                </div>
                <div className="text-right">
                  <button
                    className="rounded bg-zinc-950 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                    disabled={!canEditLines}
                    type="submit"
                  >
                    Save
                  </button>
                </div>
              </form>
              <details className="px-4 pb-3">
                <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                  Daily breakdown
                </summary>
                <div className="mt-2 overflow-hidden rounded border border-zinc-200">
                  <div className="grid grid-cols-5 bg-zinc-50 px-3 py-2 text-xs font-medium uppercase text-zinc-500">
                    <div>Date</div>
                    <div className="text-right">Gross</div>
                    <div className="text-right">Tip</div>
                    <div className="text-right">Correction</div>
                    <div>Final/Note</div>
                  </div>
                  {line.dailyTotals.map((daily) => (
                    <div
                      className="grid grid-cols-5 px-3 py-2 text-sm"
                      key={daily.id}
                    >
                      <div>{formatDate(daily.business_date)}</div>
                      <div className="text-right">
                        {formatMoney(daily.gross_sales)}
                      </div>
                      <div className="text-right">
                        {formatMoney(daily.tip_amount)}
                      </div>
                      <div className="text-right">
                        {formatMoney(daily.correction_delta)}
                      </div>
                      <div>{daily.note || "-"}</div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CorrectionTable({
  corrections,
}: {
  corrections: PayrollCorrectionListItem[];
}) {
  if (corrections.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        No corrections linked to this payroll period.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-[920px] w-full text-sm">
        <thead className="bg-zinc-50 text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Business Date</th>
            <th className="px-4 py-3 text-left font-medium">Correction Date</th>
            <th className="px-4 py-3 text-left font-medium">Staff</th>
            <th className="px-4 py-3 text-left font-medium">Ticket</th>
            <th className="px-4 py-3 text-left font-medium">Type</th>
            <th className="px-4 py-3 text-right font-medium">Delta</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {corrections.map((correction) => (
            <tr key={`${correction.source}:${correction.id}`}>
              <td className="px-4 py-3">{formatDate(correction.businessDate)}</td>
              <td className="px-4 py-3">
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(correction.correctionDate))}
              </td>
              <td className="px-4 py-3">{correction.staffName || "-"}</td>
              <td className="px-4 py-3">{correction.ticketNumber || "-"}</td>
              <td className="px-4 py-3">{correction.type}</td>
              <td className="px-4 py-3 text-right">
                {correction.delta === null ? "-" : formatMoney(correction.delta)}
              </td>
              <td className="px-4 py-3 capitalize">{correction.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShopIncomeTab({
  corrections,
  summary,
}: {
  corrections: PayrollCorrectionListItem[];
  summary: PayrollSummary;
}) {
  return (
    <section className="mt-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total POS Income" value={formatMoney(summary.totalPosIncome)} />
        <SummaryCard
          label="Staff Commission Payout"
          value={formatMoney(summary.totalStaffCommissionPayout)}
        />
        <SummaryCard label="Shop Commission Share" value={formatMoney(summary.totalShopShare)} />
        <SummaryCard label="Cash Payout" value={formatMoney(summary.totalCashPayout)} />
        <SummaryCard label="Check Gross" value={formatMoney(summary.totalCheckGross)} />
        <SummaryCard label="Tax Withheld" value={formatMoney(summary.totalTaxWithheld)} />
        <SummaryCard label="Tip Total" value={formatMoney(summary.totalTip)} />
        <SummaryCard label="Bonus Total" value={formatMoney(summary.totalBonus)} />
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Corrections</h2>
        <CorrectionTable corrections={corrections} />
      </section>
    </section>
  );
}

function SettingsTab({
  canManage,
  period,
  salonPayrollSetting,
  settings,
}: {
  canManage: boolean;
  period: PayrollPeriod;
  salonPayrollSetting: SalonPayrollSetting | null;
  settings: StaffPayrollSettingWithStaff[];
}) {
  const returnPath = getReturnPath(period, "settings");

  return (
    <section className="mt-6 space-y-8">
      <form
        action={saveSalonPayrollSetting}
        className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-[220px_220px_auto]"
      >
        <input name="return_to" type="hidden" value={returnPath} />
        <label>
          <span className="text-sm font-medium text-zinc-700">Cycle Type</span>
          <select
            className="mt-2 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm"
            defaultValue={salonPayrollSetting?.cycle_type ?? "monthly"}
            disabled={!canManage}
            name="cycle_type"
          >
            <option value="monthly">Monthly</option>
            <option value="biweekly">Biweekly</option>
          </select>
        </label>
        <label>
          <span className="text-sm font-medium text-zinc-700">Biweekly Anchor</span>
          <input
            className="mt-2 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm disabled:bg-zinc-50"
            defaultValue={salonPayrollSetting?.biweekly_anchor_date ?? ""}
            disabled={!canManage}
            name="biweekly_anchor_date"
            type="date"
          />
        </label>
        <div className="flex items-end">
          <button
            className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={!canManage}
            type="submit"
          >
            Save
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <div className="min-w-[1480px]">
          <div className="grid grid-cols-[170px_190px_130px_110px_120px_120px_100px_120px_120px_120px_130px_100px] bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
            <div>Staff</div>
            <div>Legal Name</div>
            <div>Pay Type</div>
            <div>Commission</div>
            <div>Fixed Pay</div>
            <div>Check Split</div>
            <div>Cash Split</div>
            <div>Tax Rate</div>
            <div>Apply Tax</div>
            <div>Tax Company</div>
            <div>Effective From</div>
            <div>Save</div>
          </div>
          <div className="divide-y divide-zinc-200">
            {settings.map(({ setting, staff }) => {
              const checkRate = setting?.check_rate ?? 60;
              const effectiveFrom = setting?.effective_from ?? period.startDate;

              return (
                <form
                  action={saveStaffPayrollSetting}
                  className="grid grid-cols-[170px_190px_130px_110px_120px_120px_100px_120px_120px_120px_130px_100px] items-center px-4 py-3 text-sm"
                  key={staff.id}
                >
                  <input name="return_to" type="hidden" value={returnPath} />
                  <input name="staff_id" type="hidden" value={staff.id} />
                  <div>
                    <p className="font-medium text-zinc-950">{staff.display_name}</p>
                    <p className="text-xs text-zinc-500">
                      {staff.is_active ? "Active" : "Inactive"}
                    </p>
                  </div>
                  <div className="px-2">
                    <input
                      className="h-9 w-full rounded border border-zinc-300 px-2 disabled:bg-zinc-50"
                      defaultValue={setting?.legal_name ?? ""}
                      disabled={!canManage}
                      name="legal_name"
                    />
                  </div>
                  <div className="px-2">
                    <select
                      className="h-9 w-full rounded border border-zinc-300 bg-white px-2 disabled:bg-zinc-50"
                      defaultValue={setting?.pay_type ?? "commission"}
                      disabled={!canManage}
                      name="pay_type"
                    >
                      <option value="commission">Commission</option>
                      <option value="fixed">Fixed</option>
                    </select>
                  </div>
                  <div className="px-2">
                    <input
                      className="h-9 w-full rounded border border-zinc-300 px-2 disabled:bg-zinc-50"
                      defaultValue={(setting?.commission_rate ?? 60).toString()}
                      disabled={!canManage}
                      max="100"
                      min="0"
                      name="commission_rate"
                      step="0.01"
                      type="number"
                    />
                  </div>
                  <div className="px-2">
                    <input
                      className="h-9 w-full rounded border border-zinc-300 px-2 disabled:bg-zinc-50"
                      defaultValue={(setting?.fixed_pay_amount ?? 0).toString()}
                      disabled={!canManage}
                      min="0"
                      name="fixed_pay_amount"
                      step="0.01"
                      type="number"
                    />
                  </div>
                  <div className="px-2">
                    <input
                      className="h-9 w-full rounded border border-zinc-300 px-2 disabled:bg-zinc-50"
                      defaultValue={checkRate.toString()}
                      disabled={!canManage}
                      max="100"
                      min="0"
                      name="check_rate"
                      step="0.01"
                      type="number"
                    />
                  </div>
                  <div className="text-right text-zinc-700">
                    {formatPercent(100 - checkRate)}
                  </div>
                  <div className="px-2">
                    <input
                      className="h-9 w-full rounded border border-zinc-300 px-2 disabled:bg-zinc-50"
                      defaultValue={(setting?.tax_rate ?? 0).toString()}
                      disabled={!canManage}
                      max="100"
                      min="0"
                      name="tax_rate"
                      step="0.01"
                      type="number"
                    />
                  </div>
                  <label className="flex items-center justify-center">
                    <input
                      className="size-4"
                      defaultChecked={setting?.apply_tax_to_fixed_pay ?? true}
                      disabled={!canManage}
                      name="apply_tax_to_fixed_pay"
                      type="checkbox"
                    />
                  </label>
                  <label className="flex items-center justify-center">
                    <input
                      className="size-4"
                      defaultChecked={setting?.tax_company_enabled ?? false}
                      disabled={!canManage}
                      name="tax_company_enabled"
                      type="checkbox"
                    />
                  </label>
                  <div className="px-2">
                    <input
                      className="h-9 w-full rounded border border-zinc-300 px-2 disabled:bg-zinc-50"
                      defaultValue={effectiveFrom}
                      disabled={!canManage}
                      name="effective_from"
                      type="date"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded bg-zinc-950 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
                      disabled={!canManage}
                      type="submit"
                    >
                      Save
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default async function PayrollPage({ searchParams }: PayrollPageProps) {
  const [params, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  let data: Awaited<ReturnType<typeof getPayrollPageData>>;

  try {
    data = await getPayrollPageData({
      cycleType: params.cycleType,
      endDate: params.end,
      preset: params.preset,
      startDate: params.start,
    });
  } catch (error) {
    return (
      <NoPermissionState
        message={error instanceof Error ? error.message : "Unable to load payroll."}
      />
    );
  }

  const activeTab = getActiveTab(params.tab, data.access.canViewAllPayroll);
  const displayStatus = getDisplayStatus(data.run, data.corrections);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 text-zinc-950 sm:px-6">
      <div className="border-b border-zinc-200 pb-4">
        <p className="text-sm font-medium text-zinc-500">Payroll</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">
              Payroll V1
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {data.context.currentSalon?.name} | {data.period.label}
            </p>
          </div>
          <span
            className={`inline-flex rounded border px-3 py-1 text-sm font-medium ${statusBadgeClass(displayStatus)}`}
          >
            {getStatusLabel(displayStatus)}
          </span>
        </div>
        {params.error ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {params.error}
          </p>
        ) : null}
        <TopActions
          canManage={data.access.canManagePayroll}
          period={data.period}
          run={data.run}
        />
      </div>

      <PeriodSelector activeTab={activeTab} period={data.period} />
      <Tabs
        activeTab={activeTab}
        canViewAllPayroll={data.access.canViewAllPayroll}
        period={data.period}
      />

      {activeTab === "overview" ? <OverviewTab summary={data.summary} /> : null}
      {activeTab === "staff" ? (
        <StaffIncomeTab
          canManage={data.access.canManagePayroll}
          lines={data.staffLines}
          period={data.period}
          run={data.run}
        />
      ) : null}
      {activeTab === "shop" && data.access.canViewAllPayroll ? (
        <ShopIncomeTab corrections={data.corrections} summary={data.summary} />
      ) : null}
      {activeTab === "settings" && data.access.canViewAllPayroll ? (
        <SettingsTab
          canManage={data.access.canManagePayroll}
          period={data.period}
          salonPayrollSetting={data.salonPayrollSetting}
          settings={data.settings}
        />
      ) : null}
    </main>
  );
}
