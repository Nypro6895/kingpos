import {
  TaxCompanyCalculationGuide,
  TaxCompanyLinesTable,
} from "@/app/payroll/tax-company-table";
import { getPayrollTaxCompanyData } from "@/lib/payroll";
import type { PayrollPeriod } from "@/types/payroll";
import Link from "next/link";

type PayrollTaxCompanyPageProps = {
  searchParams: Promise<{
    end?: string;
    month?: string;
    payroll_error?: string;
    payPeriodStart?: string;
    preset?: string;
    segment?: string;
    start?: string;
  }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function getPayrollHref(period: PayrollPeriod) {
  const params = new URLSearchParams({
    preset: period.preset,
    tab: "tax",
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

function NoPermissionState({ message }: { message: string }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
      <p className="text-sm font-medium text-zinc-500">Payroll</p>
      <h1 className="text-3xl font-semibold text-zinc-950">Tax company could not load</h1>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {message}
      </p>
      <Link className="text-sm font-medium text-zinc-700 underline" href="/payroll">
        Back to payroll
      </Link>
    </main>
  );
}

function monthInputFromPeriod(period: PayrollPeriod) {
  return period.startDate.slice(0, 7);
}

function PeriodSelector({
  period,
  periodOptions,
  scheduleSetup,
  salonPayrollSetting,
}: {
  period: PayrollPeriod;
  periodOptions: Awaited<ReturnType<typeof getPayrollTaxCompanyData>>["periodOptions"];
  scheduleSetup: Awaited<ReturnType<typeof getPayrollTaxCompanyData>>["scheduleSetup"];
  salonPayrollSetting: Awaited<ReturnType<typeof getPayrollTaxCompanyData>>["salonPayrollSetting"];
}) {
  const scheduleCycle = salonPayrollSetting.cycle_type;
  const missingBiweeklyAnchor = scheduleSetup.needsBiweeklyAnchor;

  return (
    <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <form
        action="/payroll/tax-company"
        className="flex flex-wrap items-end gap-3"
      >
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
              defaultValue={period.startDate}
              disabled={missingBiweeklyAnchor}
              name="payPeriodStart"
            >
              {missingBiweeklyAnchor ? (
                <option value="">Set anchor in Payroll Settings</option>
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
          Every-2-weeks payroll needs an anchor date. Update it in Payroll Settings.
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-600">
          Advanced custom range
        </summary>
        <form
          action="/payroll/tax-company"
          className="mt-3 flex flex-wrap items-end gap-3"
        >
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

export default async function PayrollTaxCompanyPage({
  searchParams,
}: PayrollTaxCompanyPageProps) {
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof getPayrollTaxCompanyData>>;

  try {
    data = await getPayrollTaxCompanyData({
      endDate: params.end,
      month: params.month,
      payPeriodStart: params.payPeriodStart,
      preset: params.preset,
      segment: params.segment,
      startDate: params.start,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tax company payroll could not be loaded.";
    return <NoPermissionState message={message} />;
  }

  const statementLabel = data.latestStatement
    ? `Printed Statement v${data.latestStatement.run.version}${
        data.latestStatement.run.status === "paid" ? " - paid" : ""
      }`
    : "Live Preview - not printed yet";
  const returnPath = getTaxCompanyHref(data.period);
  const payrollRunId = data.latestStatement?.run.id ?? null;
  const hasMissingLegalNames = data.lines.some(
    (line) => !line.staff_legal_name_snapshot,
  );
  const totalWageCheckNet = data.lines.reduce(
    (total, line) => total + line.base_check_amount,
    0,
  );
  const totalTax = data.lines.reduce((total, line) => total + line.tax_withheld, 0);
  const totalActualCheckPaid = data.lines.reduce(
    (total, line) => total + line.final_check_amount,
    0,
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-500">Payroll</p>
            <h1 className="mt-1 text-3xl font-semibold text-zinc-950">
              Payroll Tax Company
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              {data.period.label} - {statementLabel}
            </p>
          </div>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800"
            href={getPayrollHref(data.period)}
          >
            Payroll
          </Link>
        </div>
        <PeriodSelector
          period={data.period}
          periodOptions={data.periodOptions}
          scheduleSetup={data.scheduleSetup}
          salonPayrollSetting={data.salonPayrollSetting}
        />
      </header>

      {params.payroll_error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {params.payroll_error}
        </p>
      ) : null}

      {hasMissingLegalNames ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Missing legal name for one or more reportable staff.
        </p>
      ) : null}

      <section className="grid gap-4 md:grid-cols-5">
        <SummaryCard label="Reportable lines" value={`${data.lines.length}`} />
        <SummaryCard
          label="Reported Gross"
          value={formatMoney(data.summary.totalTaxCompanyTaxableGross)}
        />
        <SummaryCard label="Tax" value={formatMoney(totalTax)} />
        <SummaryCard
          label="Wage Check Net"
          value={formatMoney(totalWageCheckNet)}
        />
        <SummaryCard
          label="Actual Check Paid"
          value={formatMoney(totalActualCheckPaid)}
        />
      </section>

      <TaxCompanyLinesTable
        lines={data.lines}
        payrollRunId={payrollRunId}
        period={data.period}
        returnPath={returnPath}
        showBreakdown
      />

      <TaxCompanyCalculationGuide />
    </main>
  );
}
