import styles from "./reports.module.css";
import { ReportDetails, ReportIcon } from "./report-ui";
import { WorkspaceText, WorkspaceElement } from "@/components/workspace-language";
import { CustomerName } from "@/components/customer-name";
import {ReportTicketHistoryRow} from "./report-ticket-history-row";
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
      ? styles.up
      : metric.direction === "down"
        ? styles.down
        : styles.neutral;
  const label =
    metric.percentChange === null
      ? metric.previous === 0 && metric.current > 0
        ? "New vs previous period"
        : "No previous period data"
      : `${metric.delta > 0 ? "+" : ""}${metric.percentChange.toFixed(1)}% vs previous`;

  return (
    <span
      className={`${styles.comparison} ${tone}`}
    >
      <span aria-hidden="true">{metric.direction === "up" ? "▲ " : metric.direction === "down" ? "▼ " : ""}</span><WorkspaceText text={label} />
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
    <section className={styles.metric}>
      <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
        <WorkspaceText text={label} />
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
            <WorkspaceText text="About this metric" />
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
    <section className="min-w-0 bg-zinc-50 p-5">
      <h2 className="text-base font-semibold text-zinc-950">
        <WorkspaceText text="No operational activity in this range." />
      </h2>
      <p className="mt-1 text-sm text-zinc-600">
        <WorkspaceText text="Closed POS tickets, bookings, and new customer records will appear here once activity is recorded for" /> <WorkspaceText text={report.range.label} />.
      </p>
    </section>
  );
}

function SummaryCards({ report }: { report: OperationalReportData }) {
  return (
    <div className={styles.metrics}>
      <MetricCard
        comparison={report.comparison.grossSales}
        label="Gross Sales"
        value={formatMoney(report.totals.grossSales)}
      />
      <MetricCard
        comparison={report.comparison.netSales}
        label="Net Sales"
        value={formatMoney(report.totals.netSales)}
      />
      <MetricCard
        comparison={report.comparison.totalRevenue}
        label="Ticket Revenue"
        value={formatMoney(report.totals.totalRevenue)}
      />
      <MetricCard
        comparison={report.comparison.ticketCount}
        label="Closed Tickets"
        value={formatNumber(report.totals.ticketCount)}
      />
    </div>
  );
}

function MoneyBreakdownCards({ report }: { report: OperationalReportData }) {
  return (
    <dl className={styles.moneyBreakdown}>
      {[
        ["Collected", report.totals.collectedTotal],
        ["Tips", report.totals.tipTotal],
        ["Tax", report.totals.taxTotal],
        ["Discounts", report.totals.discountTotal],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-zinc-500"><WorkspaceText text={label} /></dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums">
            {formatMoney(Number(value))}
          </dd>
          {label === "Collected" ? (
            <p className="mt-1 text-xs text-zinc-500">
              {formatMoney(report.totals.dueTotal)} <WorkspaceText text="remaining" />
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
    <section className={styles.chart}>
      <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Daily revenue" /></h2>
      <p className="mt-1 text-sm text-zinc-500">
        <WorkspaceText text="Closed-ticket revenue by business date." />
      </p>
      <WorkspaceElement as="div"
        className="mt-4 overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Daily revenue chart; scroll horizontally for more dates"
      >
        <WorkspaceElement as="svg"
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
                <WorkspaceText text={point.label} />: {formatExactMoney(point.totalRevenue)},{" "}
                {point.ticketCount} <WorkspaceText text="tickets" />
              </title>
              <rect
                x={62 + index * step}
                y={Math.min(y(point.totalRevenue), baseline)}
                width={Math.max(1, step - 10)}
                height={Math.abs(y(point.totalRevenue) - baseline)}
                rx="2"
                fill={point.totalRevenue < 0 ? "#dc2626" : index === points.length - 1 ? "#f26f3d" : "#008f8a"}
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
        </WorkspaceElement>
      </WorkspaceElement>
      <p className="text-xs text-zinc-500">
        <WorkspaceText text={points[0]?.label} /> <WorkspaceText text="to" /> <WorkspaceText text={points.at(-1)?.label} /> / USD
      </p>
      <details className="mt-3 text-sm">
        <summary className="w-fit cursor-pointer py-2 font-medium text-teal-700">
          <WorkspaceText text="View daily values" />
        </summary>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              <WorkspaceText text="Daily revenue and closed tickets" />
            </caption>
            <thead>
              <tr className="border-b">
                <th className="py-2"><WorkspaceText text="Date" /></th>
                <th className="text-right"><WorkspaceText text="Revenue" /></th>
                <th className="text-right"><WorkspaceText text="Tickets" /></th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.date} className="border-b border-zinc-100">
                  <th className="py-2 font-normal"><WorkspaceText text={point.label} /></th>
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
  return <section className={styles.payments}>
    <h2><WorkspaceText text="Payments" /></h2>
    {rows.length === 0 ? <p className="text-sm text-zinc-500"><WorkspaceText text="No payments recorded for this range." /></p> : rows.map((row) => <div className={styles.payment} key={row.method}>
      <ReportIcon kind={row.method === "cash" ? "cash" : row.method.includes("card") ? "card" : "other"} />
      <span><WorkspaceText text={methodLabel(row.method)} /></span>
      <strong>{formatMoney(row.amount)}</strong>
      <small>{formatPercent(row.percentOfCollected)}</small>
    </div>)}
  </section>;
}

function ServiceBreakdown({ rows }: { rows: OperationalReportServiceRow[] }) {
  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-950"><WorkspaceText text="Service Mix" /></h2>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="POS service snapshots ranked by gross sales." />
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="bg-zinc-50 p-4 text-sm text-zinc-600">
          <WorkspaceText text="No service lines found on closed tickets for this range." />
        </p>
      ) : (
        <div className="min-w-0 overflow-hidden border-y border-zinc-200 bg-white">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
            <div className="col-span-6"><WorkspaceText text="Service" /></div>
            <div className="col-span-2 text-right"><WorkspaceText text="Items" /></div>
            <div className="hidden text-right sm:col-span-2 sm:block"><WorkspaceText text="Mix" /></div>
            <div className="col-span-4 text-right sm:col-span-2"><WorkspaceText text="Sales" /></div>
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
          <WorkspaceText text="Staff Performance" />
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="Source:" /> {source.replaceAll("_", " ")}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="bg-zinc-50 p-4 text-sm text-zinc-600">
          <WorkspaceText text="No staff-attributed sales found for this range." />
        </p>
      ) : (
        <div>
          <ul className="divide-y divide-zinc-100 border-y border-zinc-200 sm:hidden">
            {rows.map((row) => (
              <li key={row.staffId} className="py-4">
                <p className="break-words font-semibold">{row.staffName}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Service sales", formatMoney(row.serviceSales)],
                    ["Tips", formatMoney(row.tips)],
                    ["Turns", formatNumber(row.totalTurns)],
                    ["Tickets", formatNumber(row.ticketCount)],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-zinc-500"><WorkspaceText text={label} /></dt>
                      <dd className="mt-1 font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden min-w-0 overflow-hidden border-y border-zinc-200 bg-white sm:block">
            <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
              <div className="col-span-5 lg:col-span-3"><WorkspaceText text="Staff" /></div>
              <div className="col-span-3 text-right"><WorkspaceText text="Service Sales" /></div>
              <div className="hidden text-right lg:col-span-2 lg:block">
                <WorkspaceText text="Tips" />
              </div>
              <div className="col-span-2 text-right"><WorkspaceText text="Turns" /></div>
              <div className="col-span-2 text-right"><WorkspaceText text="Tickets" /></div>
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
                      {formatMoney(row.averageTicket)} <WorkspaceText text="avg ticket" />
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
          <WorkspaceElement as="span"
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
            <span className="text-zinc-600"><WorkspaceText text={part.label} /></span>
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
          <WorkspaceText text="Bookings and Customers" />
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="Appointment status and customer records scoped to this salon." />
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
          <section className="min-w-0 border-y border-zinc-200 bg-white py-4">
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
          <WorkspaceText text="Ticket Drill-Down" />
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          <WorkspaceText text="Most recent closed POS tickets in the selected range." />
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="bg-zinc-50 p-4 text-sm text-zinc-600">
          <WorkspaceText text="No closed tickets to show." />
        </p>
      ) : (
        <div className="min-w-0 overflow-hidden border-y border-zinc-200 bg-white">
          <div className="grid grid-cols-12 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
            <div className="col-span-4"><WorkspaceText text="Ticket" /></div>
            <div className="hidden sm:col-span-3 sm:block"><WorkspaceText text="Customer" /></div>
            <div className="col-span-4 text-right sm:col-span-3"><WorkspaceText text="Revenue" /></div>
            <div className="col-span-4 text-right sm:col-span-2"><WorkspaceText text="Payment" /></div>
          </div>
          <ul className="divide-y divide-zinc-200">
            {rows.map((row) => (
              <li key={row.id}><ReportTicketHistoryRow ticketId={row.id}>
                <div className="col-span-4 min-w-0">
                  <p className="truncate font-semibold text-zinc-950">
                    #{row.ticketNumber}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    <WorkspaceText text={formatDateTime(row.closedAt ?? row.openedAt, timeZone)} />
                  </p>
                </div>
                <div className="hidden min-w-0 text-zinc-700 sm:col-span-3 sm:block">
                  <p className="truncate"><CustomerName name={row.customerName} fallback="Walk-in" /></p>
                </div>
                <div className="col-span-4 text-right font-semibold text-zinc-950 sm:col-span-3">
                  {formatMoney(row.totals.totalRevenue)}
                </div>
                <div className="col-span-4 text-right capitalize text-zinc-700 sm:col-span-2">
                  <WorkspaceText text={row.paymentStatus} />
                </div>
              </ReportTicketHistoryRow></li>
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
    <section className="min-w-0 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-950"><WorkspaceText text="Data Notes" /></h2>
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
}: {
  report: OperationalReportData;
  salonName: string;
  selectedClosingDate: string;
}) {
  return (
    <section className={styles.overview}>
      <h1 className="sr-only"><WorkspaceText text="Reports for" /> {salonName}</h1>

      <EmptyState report={report} />
      <p className={styles.comparisonNote}>
        <WorkspaceText text="Compared with" /> <WorkspaceText text={formatDate(report.range.previousStartDate)} /> <WorkspaceText text="to" />{" "}
        <WorkspaceText text={formatDate(report.range.previousEndDate)} /> <WorkspaceText text="(same number of days)." />
      </p>
      <SummaryCards report={report} />
      <div className={styles.average}><span><WorkspaceText text="Average Ticket" /></span><strong>{formatMoney(report.totals.averageTicket)}</strong></div>
      <TrendChart points={report.trend} />
      <MoneyBreakdownCards report={report} />
      <PaymentBreakdown rows={report.paymentBreakdown} />
      <div>
        <ReportDetails title="Service Mix"><ServiceBreakdown rows={report.serviceBreakdown} /></ReportDetails>
        <ReportDetails title="Staff Performance"><StaffPerformance rows={report.staffRows} source={report.staffAttributionSource} /></ReportDetails>
        <ReportDetails title="Bookings and Customers"><BookingCustomerSection report={report} /></ReportDetails>
        <ReportDetails title="Ticket Drill-Down"><RecentTickets rows={report.recentTickets} timeZone={report.range.timeZone} /></ReportDetails>
      </div>
      <ReportDetails title="About these metrics">
        <dl className="grid gap-2 text-xs text-zinc-500">
          <div><dt><WorkspaceText text="Gross Sales" /></dt><dd><WorkspaceText text="POS item subtotal before discounts, tax, and tip." /></dd></div>
          <div><dt><WorkspaceText text="Net Sales" /></dt><dd><WorkspaceText text="Gross sales after discounts, before tax and tip." /></dd></div>
          <div><dt><WorkspaceText text="Ticket Revenue" /></dt><dd><WorkspaceText text="Net sales plus tax and tip from closed tickets." /></dd></div>
          <div><dt><WorkspaceText text="Payments" /></dt><dd><WorkspaceText text="Tender totals recorded on closed POS tickets." /></dd></div>
        </dl>
      </ReportDetails>
      <DataNotes report={report} />
    </section>
  );
}
