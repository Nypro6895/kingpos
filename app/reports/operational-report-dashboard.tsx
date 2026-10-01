import { CustomerName } from "@/components/customer-name";
import type {
  OperationalReportBookingMetrics,
  OperationalReportComparisonMetric,
  OperationalReportData,
  OperationalReportPaymentRow,
  OperationalReportServiceRow,
  OperationalReportStaffRow,
  OperationalReportTicketRow,
  OperationalReportTrendPoint,
} from "@/lib/operational-report";
import { ReportRangeFilter } from "./report-controls";

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
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950">{value}</p>
      {comparison ? (
        <div className="mt-3">
          <ComparisonBadge metric={comparison} />
        </div>
      ) : null}
      {detail ? (
        <details className="mt-2 text-xs text-zinc-500">
          <summary className="w-fit cursor-pointer py-1 text-teal-700">
            About this metric
          </summary>
          <p className="mt-1 leading-5">{detail}</p>
        </details>
      ) : null}
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
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
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
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-2xl bg-zinc-50 px-5 py-4 sm:grid-cols-4">
      {[
        ["Collected", report.totals.collectedTotal],
        ["Tips", report.totals.tipTotal],
        ["Tax", report.totals.taxTotal],
        ["Discounts", report.totals.discountTotal],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-zinc-500">{label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatMoney(Number(value))}
          </dd>
          {label === "Collected" ? (
            <p className="mt-1 text-xs text-zinc-500">
              {formatMoney(report.totals.dueTotal)} remaining
            </p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function TrendChart({ points }: { points: OperationalReportTrendPoint[] }) {
  const high = Math.max(1, ...points.map((point) => point.totalRevenue));
  const low = Math.min(0, ...points.map((point) => point.totalRevenue));
  const width = Math.max(320, points.length * 42 + 66);
  const y = (value: number) => 20 + ((high - value) / (high - low)) * 160;
  const baseline = y(0);
  const step = (width - 66) / Math.max(1, points.length);
  return (
    <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-zinc-950">Daily revenue</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Closed-ticket revenue by business date.
      </p>
      <div
        className="mt-4 overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Daily revenue chart; scroll horizontally for more dates"
      >
        <svg
          width={width}
          height="224"
          viewBox={`0 0 ${width} 224`}
          role="img"
          aria-label="Daily revenue in USD. Exact values are available in the data table below."
          className="w-full"
          style={{ minWidth: width }}
        >
          {[high, (high + low) / 2, low].map((value, index) => (
            <g key={index}>
              <line
                x1="58"
                x2={width}
                y1={y(value)}
                y2={y(value)}
                stroke="#e4e4e7"
                strokeDasharray="3 4"
              />
              <text
                x="52"
                y={y(value) + 4}
                textAnchor="end"
                fontSize="10"
                fill="#71717a"
              >
                {formatMoney(value)}
              </text>
            </g>
          ))}
          <line
            x1="58"
            x2={width}
            y1={baseline}
            y2={baseline}
            stroke="#a1a1aa"
          />
          {points.map((point, index) => (
            <g key={point.date}>
              <title>
                {point.label}: {formatExactMoney(point.totalRevenue)},{" "}
                {point.ticketCount} tickets
              </title>
              <rect
                x={62 + index * step}
                y={Math.min(y(point.totalRevenue), baseline)}
                width={Math.max(1, step - 10)}
                height={Math.abs(y(point.totalRevenue) - baseline)}
                rx="2"
                fill={point.totalRevenue < 0 ? "#be123c" : "#0f766e"}
              />
              <text
                x={62 + index * step + (step - 10) / 2}
                y="202"
                textAnchor="middle"
                fontSize="10"
                fill="#71717a"
              >
                {point.date.slice(5)}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <p className="text-xs text-zinc-500">
        {points[0]?.label} to {points.at(-1)?.label} / USD
      </p>
      <details className="mt-3 text-sm">
        <summary className="w-fit cursor-pointer py-2 font-medium text-teal-700">
          View daily values
        </summary>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              Daily revenue and closed tickets
            </caption>
            <thead>
              <tr className="border-b">
                <th className="py-2">Date</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">Tickets</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date} className="border-b border-zinc-100">
                  <th className="py-2 font-normal">{point.label}</th>
                  <td className="text-right tabular-nums">
                    {formatExactMoney(point.totalRevenue)}
                  </td>
                  <td className="text-right">{point.ticketCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
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
              className="rounded-2xl border border-zinc-200 bg-white p-4"
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
                  <p className="truncate text-xs text-zinc-500">
                    {row.category}
                  </p>
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

function StaffPerformance({
  rows,
  source,
}: {
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
        <div>
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 sm:hidden">
            {rows.map((row) => (
              <li key={row.staffId} className="p-4">
                <p className="break-words font-semibold">{row.staffName}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Service sales", formatMoney(row.serviceSales)],
                    ["Tips", formatMoney(row.tips)],
                    ["Turns", formatNumber(row.totalTurns)],
                    ["Tickets", formatNumber(row.ticketCount)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-zinc-500">{label}</dt>
                      <dd className="mt-1 font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white sm:block">
            <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
              <div className="col-span-5 lg:col-span-3">Staff</div>
              <div className="col-span-3 text-right">Service Sales</div>
              <div className="hidden text-right lg:col-span-2 lg:block">
                Tips
              </div>
              <div className="col-span-2 text-right">Turns</div>
              <div className="col-span-2 text-right">Tickets</div>
            </div>
            <ul className="divide-y divide-zinc-200">
              {rows.map((row) => (
                <li
                  className="grid grid-cols-12 gap-2 px-4 py-3 text-sm"
                  key={row.staffId}
                >
                  <div className="col-span-5 lg:col-span-3 min-w-0">
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
    {
      className: "bg-emerald-500",
      label: "Completed",
      value: metrics.completed,
    },
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
  const total = Math.max(
    1,
    parts.reduce((sum, part) => sum + part.value, 0),
  );

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
          <section className="rounded-2xl border border-zinc-200 bg-white p-4">
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
        <h2 className="text-lg font-semibold text-zinc-950">
          Ticket Drill-Down
        </h2>
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
              <li
                className="grid grid-cols-12 gap-2 px-4 py-3 text-sm"
                key={row.id}
              >
                <div className="col-span-4 min-w-0">
                  <p className="truncate font-semibold text-zinc-950">
                    #{row.ticketNumber}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {formatDateTime(row.closedAt ?? row.openedAt, timeZone)}
                  </p>
                </div>
                <div className="hidden min-w-0 text-zinc-700 sm:col-span-3 sm:block">
                  <p className="truncate"><CustomerName name={row.customerName} fallback="Walk-in" /></p>
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
    <section className="grid gap-5">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
            Owner Report
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-zinc-950">
            Reports
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            Sales and business performance for {salonName}.
          </p>
        </div>
        <ReportRangeFilter
          report={report}
          selectedClosingDate={selectedClosingDate}
        />
      </header>

      <EmptyState report={report} />
      <p className="text-xs text-zinc-500">
        Compared with {formatDate(report.range.previousStartDate)} to{" "}
        {formatDate(report.range.previousEndDate)} (same number of days).
      </p>
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
