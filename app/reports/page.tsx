import { DailyClosingForm } from "@/app/reports/daily-closing-form";
import {
  canApplyFinancialCorrections,
  canEditDailyPosClosing,
  DAILY_POS_REPORT_PERMISSIONS,
  getDailyPosReport,
  getDefaultReportDate,
  isDateInputValue,
  normalizeReportDate,
} from "@/lib/daily-pos-report";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import type { DailyPosReportStaffRow } from "@/types/pos-daily-closing";
import Link from "next/link";
import { redirect } from "next/navigation";

type ReportsPageProps = {
  searchParams: Promise<{
    date?: string;
  }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function parseDateParts(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return {
    day: Number(day),
    month: Number(month),
    year: Number(year),
  };
}

function formatDateHeader(value: string, timeZone: string) {
  const parts = parseDateParts(value);

  if (!parts) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function getReportHref(date: string) {
  return `/reports?${new URLSearchParams({ date }).toString()}`;
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
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
      <h1 className="text-3xl font-semibold text-zinc-950">Reports</h1>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function NoPermissionState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Reports</h1>
      <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
        You do not have permission to view reports.
      </p>
    </main>
  );
}

function DateSelector({
  selectedDate,
  today,
}: {
  selectedDate: string;
  today: string;
}) {
  return (
    <form
      action="/reports"
      className="mt-5 flex flex-col gap-3 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end"
      method="get"
    >
      <label className="block sm:w-56">
        <span className="text-xs font-medium uppercase text-zinc-500">
          Business Date
        </span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={selectedDate}
          name="date"
          type="date"
        />
      </label>
      <button
        className="h-10 rounded bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Load
      </button>
      <Link
        className="inline-flex h-10 items-center rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-950"
        href={getReportHref(today)}
      >
        Today
      </Link>
    </form>
  );
}

function StaffReportTable({ rows }: { rows: DailyPosReportStaffRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">
          No finalized staff rows for this date.
        </h2>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-6">Staff</div>
        <div className="col-span-3 text-right">Total Earned</div>
        <div className="hidden text-right sm:col-span-2 sm:block">Tip</div>
        <div className="col-span-3 text-right sm:col-span-1">Turns</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {rows.map((row) => (
          <li className="grid grid-cols-12 px-4 py-3 text-sm" key={row.staffId}>
            <div className="col-span-6 font-medium text-zinc-950">
              {row.staffName}
            </div>
            <div className="col-span-3 text-right text-zinc-950">
              {formatMoney(row.totalEarned)}
            </div>
            <div className="hidden text-right text-zinc-700 sm:col-span-2 sm:block">
              {formatMoney(row.tipAmount)}
            </div>
            <div className="col-span-3 text-right text-zinc-700 sm:col-span-1">
              {row.totalTurns}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const [{ date }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  const canViewReports = await hasPermission(
    DAILY_POS_REPORT_PERMISSIONS.view,
    context,
  );

  if (!canViewReports) {
    return <NoPermissionState />;
  }

  const selectedDate = normalizeReportDate(
    isDateInputValue(date) ? date : undefined,
    context,
  );
  const today = getDefaultReportDate(context);
  const [report, canEditPermission, canRequestCorrection, canApplyCorrection] =
    await Promise.all([
    getDailyPosReport(selectedDate, context),
    canEditDailyPosClosing(context),
    hasPermission(DAILY_POS_REPORT_PERMISSIONS.requestCorrection, context),
    canApplyFinancialCorrections(context),
  ]);
  const canEdit = canEditPermission && !report.lock.isLocked;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 text-zinc-950 sm:px-6">
      <div className="border-b border-zinc-200 pb-4">
        <p className="text-sm font-medium text-zinc-500">Reports</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal">
          Daily POS Closing
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          {context.currentSalon.name} on{" "}
          {formatDateHeader(report.reportDate, context.user.timezone)}
        </p>
      </div>

      <DateSelector selectedDate={report.reportDate} today={today} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryCard
          label="Total Staff Earned"
          value={formatMoney(report.totals.totalStaffEarned)}
        />
        <SummaryCard
          label="Total Tip"
          value={formatMoney(report.totals.totalTip)}
        />
        <SummaryCard
          label="Total Discount"
          value={formatMoney(report.totals.totalDiscount)}
        />
        <SummaryCard
          label="Gift Card"
          value={formatMoney(report.totals.totalGiftCard)}
        />
        <SummaryCard
          label="Expected Total"
          value={formatMoney(report.totals.expectedTotal)}
        />
      </div>

      {report.lock.liveTotalsDifferFromSnapshot ? (
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Current POS data differs from the locked snapshot. Corrections are
          recorded through adjustment records.
        </p>
      ) : null}

      <DailyClosingForm
        adjustmentTotals={report.adjustmentTotals}
        canApplyCorrection={canApplyCorrection}
        canEdit={canEdit}
        canRequestCorrection={canRequestCorrection}
        closingInputs={report.closingInputs}
        corrections={report.corrections}
        expectedTotal={report.totals.expectedTotal}
        key={report.reportDate}
        lock={report.lock}
        reportDate={report.reportDate}
        snapshotTotals={report.snapshotTotals}
      />

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">
              Staff Daily Report
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Finalized POS staff earnings and turn totals for this business date.
            </p>
          </div>
        </div>
        <StaffReportTable rows={report.staffRows} />
      </section>

      <section className="mt-8 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-zinc-950">Verification</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Tickets
            </dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-950">
              {report.metadata.ticketCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Finalized
            </dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-950">
              {report.metadata.finalizedTicketCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Open Excluded
            </dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-950">
              {report.metadata.excludedOpenTicketCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Void/Cancel Excluded
            </dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-950">
              {report.metadata.excludedVoidedTicketCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase text-zinc-500">
              Gift Card Payments
            </dt>
            <dd className="mt-1 text-lg font-semibold text-zinc-950">
              {formatMoney(report.totals.giftCardPaymentTotal)}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
