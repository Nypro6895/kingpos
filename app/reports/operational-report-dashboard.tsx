import type {
  OperationalReportBookingMetrics,
  OperationalReportComparisonMetric,
  OperationalReportData,
  OperationalReportPaymentRow,
  OperationalReportPreset,
  OperationalReportServiceRow,
  OperationalReportStaffRow,
  OperationalReportTicketRow,
  OperationalReportTrendPoint,
} from "@/lib/operational-report";
import Link from "next/link";

const PRESETS: Array<{ label: string; value: OperationalReportPreset }> = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "this_week" },
  { label: "This Month", value: "this_month" },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatExactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercent(value: number | null) {
  return value === null ? "N/A" : `${value.toFixed(1)}%`;
}

function formatDate(value: string, timeZone = "UTC") {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatDateTime(value: string | null, timeZone: string) {
  if (!value) {
    return "Not closed";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function methodLabel(method: string) {
  return method
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function getReportsHref(input: {
  date?: string;
  end?: string;
  preset?: OperationalReportPreset;
  start?: string;
}) {
  const params = new URLSearchParams();

  if (input.preset) {
    params.set("preset", input.preset);
  }

  if (input.start) {
    params.set("start", input.start);
  }

  if (input.end) {
    params.set("end", input.end);
  }

  if (input.date) {
    params.set("date", input.date);
  }

  const query = params.toString();

  return query ? `/reports?${query}` : "/reports";
}

function ComparisonBadge({
  metric,
}: {
  metric: OperationalReportComparisonMetric;
}) {
  const tone =
    metric.direction === "up"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : metric.direction === "down"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-zinc-200 bg-zinc-50 text-zinc-600";
  const label =
    metric.percentChange === null
      ? metric.previous === 0 && metric.current > 0
        ? "New vs previous period"
        : "No previous period data"
      : `${metric.delta > 0 ? "+" : ""}${metric.percentChange.toFixed(1)}% vs previous`;

  return (
    <span
      className={`inline-flex min-h-6 items-center rounded border px-2 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function MetricCard({
  comparison,
  detail,
  label,
  value,
}: {
  comparison?: OperationalReportComparisonMetric;
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
      <div className="mt-3 min-h-6">
        {comparison ? <ComparisonBadge metric={comparison} /> : null}
      </div>
      {detail ? <p className="mt-2 text-sm text-zinc-600">{detail}</p> : null}
    </section>
  );
}

function RangeSelector({
  report,
  selectedClosingDate,
}: {
  report: OperationalReportData;
  selectedClosingDate: string;
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Date Range</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {formatDate(report.range.startDate)} to{" "}
            {formatDate(report.range.endDate)} in {report.range.timeZone}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const active = report.range.preset === preset.value;

            return (
              <Link
                className={[
                  "inline-flex min-h-10 items-center rounded-md border px-3 text-sm font-semibold transition",
                  active
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50",
                ].join(" ")}
                href={getReportsHref({
                  date: selectedClosingDate,
                  preset: preset.value,
                })}
                key={preset.value}
              >
                {preset.label}
              </Link>
            );
          })}
        </div>
      </div>

      <form
        action="/reports"
        className="grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        method="get"
      >
        <input name="preset" type="hidden" value="custom" />
        <input name="date" type="hidden" value={selectedClosingDate} />
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
            Start
          </span>
          <input
            className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
            defaultValue={report.range.startDate}
            name="start"
            type="date"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
            End
          </span>
          <input
            className="mt-1 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
            defaultValue={report.range.endDate}
            max={report.range.businessDate}
            name="end"
            type="date"
          />
        </label>
        <button
          className="min-h-11 self-end rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white"
          type="submit"
        >
          Apply
        </button>
      </form>
    </section>
  );
}

function EmptyState({ report }: { report: OperationalReportData }) {
  if (!report.isEmpty) {
    return null;
  }

  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5">
      <h2 className="text-base font-semibold text-zinc-950">
        No operational activity in this range.
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        Closed POS tickets, bookings, and new customer records will appear here
        once activity is recorded for {report.range.label}.
      </p>
    </section>
  );
}

function SummaryCards({ report }: { report: OperationalReportData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        comparison={report.comparison.grossSales}
        detail="POS item subtotal before discounts, tax, and tip."
        label="Gross Sales"
        value={formatMoney(report.totals.grossSales)}
      />
      <MetricCard
        comparison={report.comparison.netSales}
        detail="Gross sales after discounts, before tax and tip."
        label="Net Sales"
        value={formatMoney(report.totals.netSales)}
      />
      <MetricCard
        comparison={report.comparison.totalRevenue}
        detail="Net sales plus tax and tip from closed tickets."
        label="Ticket Revenue"
        value={formatMoney(report.totals.totalRevenue)}
      />
      <MetricCard
        comparison={report.comparison.ticketCount}
        detail={`${formatMoney(report.totals.averageTicket)} average ticket`}
        label="Closed Tickets"
        value={formatNumber(report.totals.ticketCount)}
      />
    </div>
  );
}

function MoneyBreakdownCards({ report }: { report: OperationalReportData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        detail={`${formatMoney(report.totals.dueTotal)} remaining`}
        label="Collected"
        value={formatMoney(report.totals.collectedTotal)}
      />
      <MetricCard label="Tips" value={formatMoney(report.totals.tipTotal)} />
      <MetricCard label="Tax" value={formatMoney(report.totals.taxTotal)} />
      <MetricCard
        label="Discounts"
        value={formatMoney(report.totals.discountTotal)}
      />
    </div>
  );
}

function TrendChart({ points }: { points: OperationalReportTrendPoint[] }) {
  const max = Math.max(1, ...points.map((point) => point.totalRevenue));

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">Daily Trend</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Closed-ticket revenue by business date.
        </p>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[42rem] items-end gap-2"
          style={{
            gridTemplateColumns: `repeat(${points.length}, minmax(2.5rem, 1fr))`,
          }}
        >
          {points.map((point) => {
            const height = Math.max(
              8,
              Math.round((point.totalRevenue / max) * 150),
            );

            return (
              <div className="grid gap-2" key={point.date}>
                <div className="flex h-40 items-end rounded-md bg-zinc-100 px-1">
                  <div
                    aria-label={`${point.label}: ${formatExactMoney(point.totalRevenue)}`}
                    className="w-full rounded bg-zinc-950"
                    style={{ height }}
                    title={`${point.label}: ${formatExactMoney(point.totalRevenue)}`}
                  />
                </div>
                <div className="text-center">
                  <p className="truncate text-xs font-semibold text-zinc-700">
                    {point.label}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {point.ticketCount} tickets
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PaymentBreakdown({ rows }: { rows: OperationalReportPaymentRow[] }) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">Payments</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Tender totals recorded on closed POS tickets.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
          No payments recorded for this range.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {rows.map((row) => (
            <section
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
              key={row.method}
            >
              <p className="text-sm font-semibold text-zinc-950">
                {methodLabel(row.method)}
              </p>
              <p className="mt-2 text-2xl font-semibold text-zinc-950">
                {formatMoney(row.amount)}
              </p>
              <p className="mt-2 text-sm text-zinc-500">
                {formatPercent(row.percentOfCollected)} of collected
              </p>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function ServiceBreakdown({ rows }: { rows: OperationalReportServiceRow[] }) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">Service Mix</h2>
        <p className="mt-1 text-sm text-zinc-600">
          POS service snapshots ranked by gross sales.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
          No service lines found on closed tickets for this range.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
            <div className="col-span-6">Service</div>
            <div className="col-span-2 text-right">Items</div>
            <div className="hidden text-right sm:col-span-2 sm:block">Mix</div>
            <div className="col-span-4 text-right sm:col-span-2">Sales</div>
          </div>
          <ul className="divide-y divide-zinc-200">
            {rows.map((row) => (
              <li
                className="grid grid-cols-12 gap-2 px-4 py-3 text-sm"
                key={row.serviceId ?? `${row.serviceName}:${row.category}`}
              >
                <div className="col-span-6 min-w-0">
                  <p className="truncate font-semibold text-zinc-950">
                    {row.serviceName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">{row.category}</p>
                </div>
                <div className="col-span-2 text-right text-zinc-700">
                  {formatNumber(row.itemCount)}
                </div>
                <div className="hidden text-right text-zinc-700 sm:col-span-2 sm:block">
                  {formatPercent(row.percentOfGrossSales)}
                </div>
                <div className="col-span-4 text-right font-semibold text-zinc-950 sm:col-span-2">
                  {formatMoney(row.revenue)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StaffPerformance({ rows, source }: {
  rows: OperationalReportStaffRow[];
  source: OperationalReportData["staffAttributionSource"];
}) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Staff Performance
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Source: {source.replaceAll("_", " ")}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
          No staff-attributed sales found for this range.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
            <div className="col-span-5">Staff</div>
            <div className="col-span-3 text-right">Service Sales</div>
            <div className="hidden text-right lg:col-span-2 lg:block">Tips</div>
            <div className="col-span-2 text-right">Turns</div>
            <div className="col-span-2 text-right">Tickets</div>
          </div>
          <ul className="divide-y divide-zinc-200">
            {rows.map((row) => (
              <li className="grid grid-cols-12 gap-2 px-4 py-3 text-sm" key={row.staffId}>
                <div className="col-span-5 min-w-0">
                  <p className="truncate font-semibold text-zinc-950">
                    {row.staffName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {formatMoney(row.averageTicket)} avg ticket
                  </p>
                </div>
                <div className="col-span-3 text-right font-semibold text-zinc-950">
                  {formatMoney(row.serviceSales)}
                </div>
                <div className="hidden text-right text-zinc-700 lg:col-span-2 lg:block">
                  {formatMoney(row.tips)}
                </div>
                <div className="col-span-2 text-right text-zinc-700">
                  {formatNumber(row.totalTurns)}
                </div>
                <div className="col-span-2 text-right text-zinc-700">
                  {formatNumber(row.ticketCount)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BookingStatusBar({
  metrics,
}: {
  metrics: OperationalReportBookingMetrics;
}) {
  const parts = [
    { className: "bg-emerald-500", label: "Completed", value: metrics.completed },
    {
      className: "bg-zinc-900",
      label: "Active",
      value: metrics.checkedIn + metrics.inService,
    },
    { className: "bg-amber-500", label: "Confirmed", value: metrics.confirmed },
    {
      className: "bg-rose-500",
      label: "Lost",
      value: metrics.cancelled + metrics.noShow,
    },
  ];
  const total = Math.max(1, parts.reduce((sum, part) => sum + part.value, 0));

  return (
    <div className="grid gap-3">
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100">
        {parts.map((part) => (
          <span
            className={part.className}
            key={part.label}
            style={{ width: `${(part.value / total) * 100}%` }}
            title={`${part.label}: ${part.value}`}
          />
        ))}
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-4">
        {parts.map((part) => (
          <div className="flex items-center gap-2" key={part.label}>
            <span className={`h-2.5 w-2.5 rounded-full ${part.className}`} />
            <span className="text-zinc-600">{part.label}</span>
            <span className="ml-auto font-semibold text-zinc-950">
              {formatNumber(part.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingCustomerSection({ report }: { report: OperationalReportData }) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">
          Bookings and Customers
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Appointment status and customer records scoped to this salon.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              comparison={report.comparison.bookings}
              label="Booked"
              value={formatNumber(report.bookingMetrics.booked)}
            />
            <MetricCard
              label="Completed"
              value={formatNumber(report.bookingMetrics.completed)}
            />
            <MetricCard
              label="Completion Rate"
              value={formatPercent(report.bookingMetrics.completionRate)}
            />
          </div>
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
            <BookingStatusBar metrics={report.bookingMetrics} />
          </section>
        </div>
        <section className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            comparison={report.comparison.customerCount}
            detail={`${formatNumber(report.customerMetrics.returningCustomers)} returning`}
            label="Active Customers"
            value={formatNumber(report.customerMetrics.activeCustomers)}
          />
          <MetricCard
            detail={`${formatNumber(report.customerMetrics.linkedCustomers)} linked to accounts`}
            label="New Customer Records"
            value={formatNumber(report.customerMetrics.newCustomerRecords)}
          />
        </section>
      </div>
    </section>
  );
}

function RecentTickets({
  rows,
  timeZone,
}: {
  rows: OperationalReportTicketRow[];
  timeZone: string;
}) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950">Ticket Drill-Down</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Most recent closed POS tickets in the selected range.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
          No closed tickets to show.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
            <div className="col-span-4">Ticket</div>
            <div className="hidden sm:col-span-3 sm:block">Customer</div>
            <div className="col-span-4 text-right sm:col-span-3">Revenue</div>
            <div className="col-span-4 text-right sm:col-span-2">Payment</div>
          </div>
          <ul className="divide-y divide-zinc-200">
            {rows.map((row) => (
              <li className="grid grid-cols-12 gap-2 px-4 py-3 text-sm" key={row.id}>
                <div className="col-span-4 min-w-0">
                  <p className="truncate font-semibold text-zinc-950">
                    #{row.ticketNumber}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {formatDateTime(row.closedAt ?? row.openedAt, timeZone)}
                  </p>
                </div>
                <div className="hidden min-w-0 text-zinc-700 sm:col-span-3 sm:block">
                  <p className="truncate">{row.customerName ?? "Walk-in"}</p>
                </div>
                <div className="col-span-4 text-right font-semibold text-zinc-950 sm:col-span-3">
                  {formatMoney(row.totals.totalRevenue)}
                </div>
                <div className="col-span-4 text-right capitalize text-zinc-700 sm:col-span-2">
                  {row.paymentStatus}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DataNotes({ report }: { report: OperationalReportData }) {
  const uniqueGaps = Array.from(new Set(report.dataGaps));

  if (uniqueGaps.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-950">Data Notes</h2>
      <ul className="mt-3 grid gap-2 text-sm text-amber-900">
        {uniqueGaps.map((gap) => (
          <li key={gap}>{gap}</li>
        ))}
      </ul>
    </section>
  );
}

export function OperationalReportDashboard({
  report,
  salonName,
  selectedClosingDate,
}: {
  report: OperationalReportData;
  salonName: string;
  selectedClosingDate: string;
}) {
  return (
    <section className="grid gap-8">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(21rem,0.44fr)] lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
            Owner Report
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-zinc-950">
            Operational Reporting
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            Sales, staff, booking, customer, and payment metrics for {salonName}.
            Figures are generated server-side from salon-scoped POS and booking
            data.
          </p>
        </div>
        <RangeSelector
          report={report}
          selectedClosingDate={selectedClosingDate}
        />
      </header>

      <EmptyState report={report} />
      <SummaryCards report={report} />
      <MoneyBreakdownCards report={report} />
      <TrendChart points={report.trend} />
      <PaymentBreakdown rows={report.paymentBreakdown} />
      <ServiceBreakdown rows={report.serviceBreakdown} />
      <StaffPerformance
        rows={report.staffRows}
        source={report.staffAttributionSource}
      />
      <BookingCustomerSection report={report} />
      <RecentTickets
        rows={report.recentTickets}
        timeZone={report.range.timeZone}
      />
      <DataNotes report={report} />
    </section>
  );
}
