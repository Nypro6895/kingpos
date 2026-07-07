import { savePayrollStaffLine } from "@/app/payroll/actions";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getPayrollTaxCompanyData } from "@/lib/payroll";
import type {
  PayrollPeriod,
  PayrollRun,
  PayrollStaffLineWithDailyTotals,
} from "@/types/payroll";
import Link from "next/link";
import { redirect } from "next/navigation";

type TaxCompanyPageProps = {
  searchParams: Promise<{
    end?: string;
    error?: string;
    preset?: string;
    start?: string;
  }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatPercent(value: number) {
  return `${Number(value).toFixed(2).replace(/\.00$/, "")}%`;
}

function getTaxCompanyHref(period: PayrollPeriod) {
  const params = new URLSearchParams({
    end: period.endDate,
    preset: period.preset,
    start: period.startDate,
  });

  return `/payroll/tax-company?${params.toString()}`;
}

function PeriodSelector({ period }: { period: PayrollPeriod }) {
  return (
    <form
      action="/payroll/tax-company"
      className="grid gap-3 border-b border-zinc-200 py-5 sm:grid-cols-[220px_180px_180px_auto]"
      method="get"
    >
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

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Payroll Tax Company</h1>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function NoPermissionState({ message }: { message: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Payroll Tax Company</h1>
      <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
        {message}
      </p>
    </main>
  );
}

function TaxTable({
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
        No tax-company staff lines for this period.
      </div>
    );
  }

  const returnPath = getTaxCompanyHref(period);
  const canEditLines = canManage && run.status !== "paid";

  return (
    <section className="mt-6 overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <div className="min-w-[1560px]">
        <div className="grid grid-cols-[190px_190px_130px_120px_100px_120px_120px_100px_110px_120px_170px_90px] bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
          <div>Legal Name</div>
          <div>Period</div>
          <div>Check Number</div>
          <div className="text-right">Check Gross</div>
          <div className="text-right">Tax Rate</div>
          <div className="text-right">Tax Withheld</div>
          <div className="text-right">Check Net</div>
          <div className="text-right">Tip</div>
          <div>Bonus</div>
          <div>Paystub</div>
          <div>Note</div>
          <div></div>
        </div>
        <div className="divide-y divide-zinc-200">
          {lines.map((line) => (
            <form
              action={savePayrollStaffLine}
              className="grid grid-cols-[190px_190px_130px_120px_100px_120px_120px_100px_110px_120px_170px_90px] items-center px-4 py-3 text-sm"
              key={line.id}
            >
              <input name="line_id" type="hidden" value={line.id} />
              <input name="return_to" type="hidden" value={returnPath} />
              <div>
                <p className="font-medium text-zinc-950">
                  {line.staff_legal_name_snapshot || line.staff_display_name_snapshot}
                </p>
                <p className="text-xs text-zinc-500">
                  {line.staff_display_name_snapshot}
                </p>
              </div>
              <div>{period.label}</div>
              <div className="px-2">
                <input
                  className="h-9 w-full rounded border border-zinc-300 bg-white px-2 text-sm disabled:bg-zinc-50"
                  defaultValue={line.check_number ?? ""}
                  disabled={!canEditLines}
                  name="check_number"
                />
              </div>
              <div className="text-right">{formatMoney(line.check_gross)}</div>
              <div className="text-right">{formatPercent(line.tax_rate_used)}</div>
              <div className="text-right">{formatMoney(line.tax_withheld)}</div>
              <div className="text-right">{formatMoney(line.check_net)}</div>
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
              <div>
                <span
                  className={
                    line.paystub
                      ? "inline-flex rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                      : "inline-flex rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
                  }
                >
                  {line.paystub ? "Attached" : "Missing"}
                </span>
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
          ))}
        </div>
      </div>
    </section>
  );
}

export default async function PayrollTaxCompanyPage({
  searchParams,
}: TaxCompanyPageProps) {
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

  let data: Awaited<ReturnType<typeof getPayrollTaxCompanyData>>;

  try {
    data = await getPayrollTaxCompanyData({
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

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 text-zinc-950 sm:px-6">
      <div className="border-b border-zinc-200 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-zinc-500">Payroll</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">
              Tax Company
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              {data.context.currentSalon?.name} | {data.period.label}
            </p>
          </div>
          <Link
            className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-950"
            href={`/payroll?${new URLSearchParams({
              end: data.period.endDate,
              preset: data.period.preset,
              start: data.period.startDate,
              tab: "staff",
            }).toString()}`}
          >
            Payroll
          </Link>
        </div>
        {params.error ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {params.error}
          </p>
        ) : null}
      </div>

      <PeriodSelector period={data.period} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-zinc-500">Check Gross</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatMoney(data.summary.totalCheckGross)}
          </p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-zinc-500">Tax Withheld</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatMoney(data.summary.totalTaxWithheld)}
          </p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-zinc-500">Check Net</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatMoney(data.summary.totalCheckNet)}
          </p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-zinc-500">Tip</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {formatMoney(data.summary.totalTip)}
          </p>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase text-zinc-500">
            Missing Paystub
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">
            {data.summary.missingPaystubCount}
          </p>
        </section>
      </div>

      <TaxTable
        canManage={data.access.canManagePayroll}
        lines={data.staffLines}
        period={data.period}
        run={data.run}
      />
    </main>
  );
}
