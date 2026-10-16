"use client";
import {NavigationForm,NavigationSubmitButton} from "@/components/navigation-form";
import {PayrollFilterToolbar} from "@/app/payroll/payroll-filter-toolbar";
import styles from "@/app/payroll/payroll-mobile.module.css";
import {WorkspaceText,useWorkspaceTranslation} from "@/components/workspace-language";
import {TaxCompanyCalculationGuide,TaxCompanyLinesTable} from "@/app/payroll/tax-company-table";
import type {PayrollPeriod} from "@/types/payroll";
import type {AppLocalPayrollTaxData} from "@/lib/app-local-payroll-tax-metadata";
import Link from "next/link";
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
    report: "1",
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
  periodOptions: AppLocalPayrollTaxData["periodOptions"];
  scheduleSetup: AppLocalPayrollTaxData["scheduleSetup"];
  salonPayrollSetting: AppLocalPayrollTaxData["salonPayrollSetting"];
}) {
  const scheduleCycle = salonPayrollSetting.cycle_type;
  const missingBiweeklyAnchor = scheduleSetup.needsBiweeklyAnchor;

  return (
    <PayrollFilterToolbar summary={<WorkspaceText text={period.label} />} periodLabel={period.label} active={period.preset === "custom"}>
      <NavigationForm
        action="/payroll/tax-company"
        className="flex flex-wrap items-end gap-3"
      >
        <input name="report" type="hidden" value="1" />
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
          <label className="flex min-w-0 w-full flex-col gap-1 text-sm font-medium text-zinc-700">
            <WorkspaceText text="Pay period" />
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue={period.startDate}
              disabled={missingBiweeklyAnchor}
              name="payPeriodStart"
            >
              {missingBiweeklyAnchor ? (
                <option value=""><WorkspaceText text="Set anchor in Payroll Settings" /></option>
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
      {missingBiweeklyAnchor ? (
        <p className="text-sm text-amber-700">
          <WorkspaceText text="Every-2-weeks payroll needs an anchor date. Update it in Payroll Settings." />
        </p>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-zinc-600">
          <WorkspaceText text="Advanced custom range" />
        </summary>
        <NavigationForm
          action="/payroll/tax-company"
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <input name="preset" type="hidden" value="custom" />
          <input name="report" type="hidden" value="1" />
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
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500"><WorkspaceText text={label} /></p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
    </div>
  );
}

export function AppLocalPayrollTax({data,params}:{data:AppLocalPayrollTaxData;params:{payroll_error?:string}}){const __vt=useWorkspaceTranslation();
  const statementLabel = data.latestStatement
    ? `Saved Statement v${data.latestStatement.run.version}${
        data.latestStatement.run.status === "paid" ? " - paid" : ""
      }`
    : "Awaiting saved statement";
  const returnPath = getTaxCompanyHref(data.period);
  const payrollRunId = data.latestStatement?.run.id ?? null;
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
    <main className={`${styles.page} mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8`}>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><h1 className="mb-2 text-xl font-semibold"><WorkspaceText text="Tax payroll report" /></h1>
            <p className="text-sm text-zinc-500">
              <WorkspaceText text={data.period.label} /> - <WorkspaceText text={statementLabel} />
            </p>
          </div>
          <Link
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800"
            href={getPayrollHref(data.period)}
          >
            <WorkspaceText text="Payroll" />
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

      <p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600"><WorkspaceText text="This report uses the saved payroll version. Current edits are shared only after saving a new statement." /></p>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard label={__vt("Reportable lines")} value={`${data.lines.length}`} />
        <SummaryCard
          label={__vt("Reported Gross")}
          value={formatMoney(data.summary.totalTaxCompanyTaxableGross)}
        />
        <SummaryCard label={__vt("Tax")} value={formatMoney(totalTax)} />
        <SummaryCard
          label={__vt("Wage Check Net")}
          value={formatMoney(totalWageCheckNet)}
        />
        <SummaryCard
          label={__vt("Actual Check Paid")}
          value={formatMoney(totalActualCheckPaid)}
        />
      </section>

      <TaxCompanyLinesTable
        canUpload={data.access.canManagePayroll || data.access.canViewTaxCompany}
        lines={data.lines}
        payrollRunId={payrollRunId}
        returnPath={returnPath}
      />

      <TaxCompanyCalculationGuide />
    </main>
  );
}
