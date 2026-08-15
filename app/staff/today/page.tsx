import Link from "next/link";

import { QuickAccessPanel } from "@/app/staff/today/quick-access-editor";
import {
  getTodayDashboard,
  type TodayAttentionItem,
  type TodayClientPresence,
  type TodayDashboard,
  type TodayDayView,
  type TodayMetric,
  type TodayMetricChart,
  type TodayPerformance,
  type TodayTeamMember,
  type TodayUpcomingBooking,
} from "@/lib/today-dashboard";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import type { StaffWorkdayStatus } from "@/types/staff-workday";

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatDashboardDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    weekday: "long",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function dateHref(date: string, currentDate: string) {
  if (date === currentDate) {
    return "/staff/today";
  }

  return `/staff/today?${new URLSearchParams({ date }).toString()}`;
}

function formatTime(value: string | null | undefined, timeZone: string) {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function getGreeting(timeZone: string) {
  const hourText = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone,
  }).format(new Date());
  const hour = Number.parseInt(hourText, 10);

  if (!Number.isFinite(hour)) {
    return "Hello";
  }

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatShortMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "ST";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function hasTeamActivity(member: TodayTeamMember) {
  return (
    member.turns.total > 0 ||
    (member.serviceSales ?? 0) > 0 ||
    (member.tips ?? 0) > 0 ||
    (member.earnings ?? 0) > 0
  );
}

function ChevronDownIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DayViewControl({ dayView }: { dayView: TodayDayView }) {
  return (
    <div className="relative">
      <details className="group">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-amber-200 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <span className="text-amber-700">
            <SectionIcon name="calendar" />
          </span>
          <span>Day view</span>
          <ChevronDownIcon />
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl">
          <div className="grid gap-2">
            <Link
              className="flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-zinc-800 transition hover:bg-amber-50 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              href={dayView.todayHref}
            >
              Today
            </Link>
            <Link
              className="flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-zinc-800 transition hover:bg-amber-50 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              href={dateHref(dayView.previousDate, dayView.currentDate)}
            >
              Previous day
            </Link>
            {dayView.nextDate ? (
              <Link
                className="flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-zinc-800 transition hover:bg-amber-50 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                href={dateHref(dayView.nextDate, dayView.currentDate)}
              >
                Next day
              </Link>
            ) : null}
          </div>
          <form className="mt-3 border-t border-zinc-100 pt-3" method="get">
            <label
              className="text-xs font-semibold uppercase tracking-normal text-zinc-500"
              htmlFor="today-date"
            >
              Choose date
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="min-h-11 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                defaultValue={dayView.selectedDate}
                id="today-date"
                max={dayView.maxDate}
                name="date"
                type="date"
              />
              <button
                className="min-h-11 rounded-md bg-amber-600 px-3 text-sm font-semibold text-white transition hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                type="submit"
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      </details>
      {dayView.invalidDate ? (
        <p className="mt-2 text-xs font-medium text-amber-700">
          Showing today; selected date was unavailable.
        </p>
      ) : null}
    </div>
  );
}

function formatCheckIn(member: TodayTeamMember, timeZone: string) {
  if (!member.checkInAt) {
    return member.status === "not_checked_in" ? "Not yet" : "-";
  }

  return formatTime(member.checkInAt, timeZone);
}

function TurnPair({ member }: { member: TodayTeamMember }) {
  if (!hasTeamActivity(member) && member.turns.total === 0) {
    return (
      <span
        aria-label="No turn activity yet"
        className="text-zinc-500"
        title="No turn activity yet"
      >
        -
      </span>
    );
  }

  return (
    <span
      aria-label={`${member.turns.large} large turns and ${member.turns.small} small turns`}
      className="inline-flex items-baseline gap-1.5 font-mono tabular-nums"
    >
      <span className="font-semibold text-zinc-950">{member.turns.large}</span>
      <span aria-hidden="true" className="text-zinc-300">
        /
      </span>
      <span className="text-zinc-500">{member.turns.small}</span>
    </span>
  );
}

function staffMoneyDisplay(input: {
  emptyLabel: string;
  kind: "services" | "tips";
  member: TodayTeamMember;
  value: number | undefined;
}) {
  if (
    input.kind === "tips" &&
    input.member.financialAttribution?.tips === "unallocated"
  ) {
    return {
      label: "-",
      title: "Tips not attributed to this staff member",
    };
  }

  if (typeof input.value !== "number" || input.value <= 0) {
    return { label: input.emptyLabel, title: null };
  }

  return { label: formatShortMoney(input.value), title: null };
}

function StaffAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={classNames(
        "flex shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 font-semibold text-amber-800",
        size === "sm" ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm",
      )}
    >
      {getInitials(name)}
    </div>
  );
}

function MetricIcon({ label }: { label: string }) {
  const path =
    label.startsWith("Sales")
      ? "M7 20V4m10 16V4M4 8h16M4 16h16"
      : label === "Appointments"
        ? "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 10h.01M12 14h.01M16 14h.01"
        : label === "Tickets"
          ? "M6 2h12v20l-3-2-3 2-3-2-3 2V2Zm3 7h6m-6 4h6"
        : label === "Waiting"
          ? "M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
          : "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75";

  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  );
}

function MiniMetricChart({ chart }: { chart: TodayMetricChart | null }) {
  if (!chart || chart.points.length === 0) {
    return null;
  }

  const points = chart.points;
  const max = Math.max(...points.map((point) => Math.max(0, point.value)), 1);
  const hasSignal = points.some((point) => point.value > 0);
  const width = chart.kind === "sparkline" ? 132 : 116;
  const height = chart.kind === "sparkline" ? 34 : 28;

  if (chart.kind === "sparkline") {
    const top = 4;
    const bottom = height - 5;
    const usableHeight = bottom - top;
    const coordinates =
      points.length === 1
        ? [
            [0, bottom - (Math.max(0, points[0].value) / max) * usableHeight],
            [
              width,
              bottom - (Math.max(0, points[0].value) / max) * usableHeight,
            ],
          ]
        : points.map((point, index) => {
            const x = (index / (points.length - 1)) * width;
            const y = bottom - (Math.max(0, point.value) / max) * usableHeight;

            return [x, y];
          });
    const path =
      coordinates.length <= 2
        ? coordinates
            .map(
              ([x, y], index) =>
                `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`,
            )
            .join(" ")
        : `${coordinates
            .map(([x, y], index) => {
              if (index === 0) {
                return `M${x.toFixed(1)} ${y.toFixed(1)}`;
              }

              const [previousX, previousY] = coordinates[index - 1];
              const midX = (previousX + x) / 2;
              const midY = (previousY + y) / 2;

              return `Q${previousX.toFixed(1)} ${previousY.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
            })
            .join(" ")} T${coordinates[coordinates.length - 1][0].toFixed(1)} ${coordinates[coordinates.length - 1][1].toFixed(1)}`;

    return (
      <svg
        aria-label={chart.ariaLabel}
        className="h-9 w-full text-amber-500"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <desc>
          {points
            .map((point) => `${point.label}: ${point.value}`)
            .join(", ")}
        </desc>
        {!hasSignal ? (
          <path
            className="stroke-zinc-200"
            d={`M0 ${bottom} L${width} ${bottom}`}
            fill="none"
            strokeLinecap="round"
            strokeWidth="1.4"
          />
        ) : null}
        <path
          className={hasSignal ? "stroke-amber-500" : "stroke-zinc-200"}
          d={path}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
        />
      </svg>
    );
  }

  const gap = 3;
  const barWidth = Math.max(4, (width - gap * (points.length - 1)) / points.length);

  return (
    <svg
      aria-label={chart.ariaLabel}
      className="mt-3 h-8 w-full text-amber-500"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <desc>
        {points
          .map((point) => `${point.label}: ${point.value}`)
          .join(", ")}
      </desc>
      {points.map((point, index) => {
        const barHeight = Math.max(
          hasSignal ? 2 : 1,
          (Math.max(0, point.value) / max) * (height - 4),
        );
        const x = index * (barWidth + gap);
        const y = height - barHeight;

        return (
          <rect
            className={
              point.afterHours
                ? "fill-orange-300"
                : point.highlight
                  ? "fill-amber-500"
                  : "fill-zinc-300"
            }
            height={barHeight}
            key={`${point.label}:${index}`}
            rx="2"
            width={barWidth}
            x={x}
            y={y}
          />
        );
      })}
    </svg>
  );
}

function TrendPill({ trend }: { trend: TodayMetric["trend"] }) {
  if (!trend) {
    return null;
  }

  const path =
    trend.direction === "up"
      ? "M7 17 17 7M9 7h8v8"
      : trend.direction === "down"
        ? "M7 7 17 17M17 9v8H9"
        : "M5 12h14";

  return (
    <p
      className={classNames(
        "mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold",
        trend.direction === "up"
          ? "bg-teal-50 text-teal-700"
          : trend.direction === "down"
            ? "bg-orange-50 text-orange-700"
            : "bg-zinc-100 text-zinc-600",
      )}
    >
      <span className="min-w-0 truncate">{trend.label}</span>
      <svg
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
      >
        <path d={path} />
      </svg>
    </p>
  );
}

function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}

function SectionIcon({
  name,
}: {
  name: "alert" | "calendar" | "chart" | "clock" | "team";
}) {
  const path =
    name === "team"
      ? "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"
      : name === "chart"
        ? "M4 19V5m5 14v-8m5 8V7m5 12v-5"
        : name === "clock"
          ? "M12 6v6l4 2m6-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"
          : name === "calendar"
            ? "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
            : "M12 9v4m0 4h.01M10.3 3.9 1.7-1 1.7 1 8.3 14.4-1.7 3H3.7l-1.7-3 8.3-14.4Z";

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  );
}

function metricToneClass(metric: TodayMetric) {
  if (metric.restricted) {
    return "border-zinc-200 bg-zinc-50 text-zinc-500";
  }

  if (metric.tone === "warning") {
    return "border-amber-200 bg-white text-amber-800";
  }

  return "border-zinc-200 bg-white text-zinc-700";
}

function statusToneClass(status: StaffWorkdayStatus | "not_checked_in") {
  if (status === "checked_in" || status === "working") {
    return "bg-emerald-50 text-emerald-700";
  }

  if (status === "break") {
    return "bg-amber-50 text-amber-700";
  }

  if (status === "not_checked_in") {
    return "bg-zinc-50 text-zinc-600";
  }

  return "bg-zinc-100 text-zinc-600";
}

function statusDotClass(status: StaffWorkdayStatus | "not_checked_in") {
  if (status === "checked_in" || status === "working") {
    return "bg-emerald-500";
  }

  if (status === "break") {
    return "bg-amber-500";
  }

  if (status === "not_checked_in") {
    return "border border-zinc-400 bg-white";
  }

  return "bg-zinc-400";
}

function displayStaffStatus(status: StaffWorkdayStatus | "not_checked_in") {
  if (status === "checked_in" || status === "working") {
    return "Active";
  }

  if (status === "break") {
    return "Break";
  }

  if (status === "not_checked_in") {
    return "Unchecked";
  }

  return "Inactive";
}

function attentionToneClass(tone: TodayAttentionItem["tone"]) {
  if (tone === "good") {
    return "bg-emerald-500";
  }

  return tone === "warning" ? "bg-amber-500" : "bg-orange-400";
}

function bookingStatusLabel(status: TodayUpcomingBooking["status"]) {
  return status
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function Card({
  action,
  children,
  icon,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  icon?: "alert" | "calendar" | "chart" | "clock" | "team";
  title: string;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-[0_10px_30px_rgba(24,24,27,0.04)]">
      <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
              <SectionIcon name={icon} />
            </span>
          ) : null}
          <h2 className="truncate text-base font-semibold text-zinc-950">
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="inline-flex shrink-0 items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:border-amber-300 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      href={href}
    >
      <span>{label}</span>
      <ArrowIcon />
    </Link>
  );
}

function MetricCard({ metric }: { metric: TodayMetric }) {
  const body = (
    <div
      className={classNames(
        "flex h-full min-h-28 flex-col justify-between rounded-xl border p-3 shadow-[0_8px_24px_rgba(24,24,27,0.04)] transition sm:min-h-32 sm:p-4",
        metricToneClass(metric),
        metric.href ? "hover:-translate-y-0.5 hover:shadow-md" : null,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
          <MetricIcon label={metric.label} />
        </span>
        <p className="min-w-0 truncate text-sm font-semibold text-zinc-600">
          {metric.label}
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_6.5rem] sm:items-end">
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-none text-zinc-950 sm:text-3xl">
            {metric.value}
          </p>
          <TrendPill trend={metric.trend} />
          {metric.detail ? (
            <p className="mt-2 text-xs leading-5 text-zinc-600 sm:text-sm">
              {metric.detail}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 sm:pb-1">
          <MiniMetricChart chart={metric.chart} />
        </div>
      </div>
    </div>
  );

  if (metric.href) {
    return (
      <Link
        className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        href={metric.href}
      >
        {body}
      </Link>
    );
  }

  return body;
}

function SummaryGrid({ dashboard }: { dashboard: TodayDashboard }) {
  const metrics = [
    dashboard.summary.sales,
    dashboard.summary.customers,
    dashboard.summary.waiting,
    dashboard.summary.staff,
  ];

  return (
    <section
      aria-label={
        dashboard.dayView.isCurrentDate
          ? "Today summary"
          : "Selected day summary"
      }
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {metrics.map((metric) => (
        <MetricCard key={metric.label} metric={metric} />
      ))}
    </section>
  );
}

function EmptyLine({ label }: { label: string }) {
  return (
    <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-zinc-500">
      {label}
    </p>
  );
}

function CompactEmptyState({
  detail,
  title,
}: {
  detail: string;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-4">
      <p className="text-sm font-semibold text-zinc-950">{title}</p>
      <p className="mt-1 text-sm leading-5 text-zinc-600">{detail}</p>
    </div>
  );
}

function WaitingClientRow({
  client,
  timeZone,
}: {
  client: TodayClientPresence;
  timeZone: string;
}) {
  const content = (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-amber-100 text-sm font-semibold text-amber-800">
        {getInitials(client.displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="break-words text-sm font-semibold text-zinc-950">
            {client.displayName}
          </p>
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            Waiting
          </span>
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          {client.serviceLabel ?? "Service not selected"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Checked in from appointment
          {client.appointmentAt
            ? ` / ${formatTime(client.appointmentAt, timeZone)}`
            : ""}
          {client.assignedStaff ? ` / ${client.assignedStaff.name}` : ""}
        </p>
      </div>
    </div>
  );

  if (client.href) {
    return (
      <Link
        className="block hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        href={client.href}
      >
        {content}
      </Link>
    );
  }

  return content;
}

function UpcomingBookingRow({
  booking,
  timeZone,
}: {
  booking: TodayUpcomingBooking;
  timeZone: string;
}) {
  return (
    <Link
      className="block hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      href={booking.href}
    >
      <div className="flex items-start gap-3 py-3">
        <div className="w-16 shrink-0 text-sm font-semibold text-zinc-950">
          {formatTime(booking.startAt, timeZone)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-zinc-950">
            {booking.customerName}
          </p>
          <p className="mt-1 text-sm text-zinc-600">
            {booking.serviceLabel ?? "Service not selected"}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {bookingStatusLabel(booking.status)}
            {booking.assignedStaff ? ` / ${booking.assignedStaff.name}` : ""}
          </p>
        </div>
      </div>
    </Link>
  );
}

function RightNowPanel({ dashboard }: { dashboard: TodayDashboard }) {
  const hasWaiting = dashboard.rightNow.waitingClients.length > 0;
  const hasUpcoming = dashboard.rightNow.upcomingBookings.length > 0;
  const canViewBookings = dashboard.permissions.canViewBookings;
  const isCurrentDate = dashboard.dayView.isCurrentDate;

  return (
    <Card
      action={
        dashboard.rightNow.scheduleHref ? (
          <ActionLink
            href={dashboard.rightNow.scheduleHref}
            label="View schedule"
          />
        ) : null
      }
      icon={isCurrentDate ? "clock" : "calendar"}
      title={isCurrentDate ? "Right Now" : "Day Schedule"}
    >
      {!canViewBookings ? (
        <CompactEmptyState
          detail="Booking access is required to show waiting clients and upcoming appointments."
          title="Schedule unavailable"
        />
      ) : !isCurrentDate ? (
        hasUpcoming ? (
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-zinc-950">
                Appointments
              </h3>
              <span className="text-xs font-medium text-zinc-500">
                {dashboard.rightNow.upcomingBookings.length}
              </span>
            </div>
            <div className="divide-y divide-zinc-100">
              {dashboard.rightNow.upcomingBookings.map((booking) => (
                <UpcomingBookingRow
                  booking={booking}
                  key={booking.id}
                  timeZone={dashboard.timezone}
                />
              ))}
            </div>
          </div>
        ) : (
          <CompactEmptyState
            detail="This date has no scheduled appointments."
            title="No appointments recorded"
          />
        )
      ) : !hasWaiting && !hasUpcoming ? (
        <CompactEmptyState
          detail="No clients waiting or upcoming appointments remaining today."
          title="Quiet right now"
        />
      ) : (
        <div
          className={classNames(
            "grid gap-5",
            hasWaiting && hasUpcoming ? "lg:grid-cols-2" : null,
          )}
        >
          {hasWaiting ? (
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-zinc-950">Waiting</h3>
                <span className="text-xs font-medium text-zinc-500">
                  {dashboard.rightNow.waitingClients.length}
                </span>
              </div>
              <div className="divide-y divide-zinc-100">
                {dashboard.rightNow.waitingClients.map((client) => (
                  <WaitingClientRow
                    client={client}
                    key={client.id}
                    timeZone={dashboard.timezone}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyLine label="No clients waiting right now." />
          )}

          {hasUpcoming ? (
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-zinc-950">Upcoming</h3>
                <span className="text-xs font-medium text-zinc-500">
                  {dashboard.rightNow.upcomingBookings.length}
                </span>
              </div>
              <div className="divide-y divide-zinc-100">
                {dashboard.rightNow.upcomingBookings.map((booking) => (
                  <UpcomingBookingRow
                    booking={booking}
                    key={booking.id}
                    timeZone={dashboard.timezone}
                  />
                ))}
              </div>
            </div>
          ) : (
            <EmptyLine label="No upcoming appointments remaining today." />
          )}
        </div>
      )}
    </Card>
  );
}

function AttentionPanel({ items }: { items: TodayAttentionItem[] }) {
  return (
    <Card icon="alert" title="Needs Attention">
      <div className="divide-y divide-zinc-100">
        {items.map((item) => {
          const content = (
            <div className="flex items-start gap-3 py-3">
              <span
                className={classNames(
                  "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                  attentionToneClass(item.tone),
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-zinc-950">
                  {item.label}
                </p>
                <p className="mt-1 text-sm leading-5 text-zinc-600">
                  {item.detail}
                </p>
              </div>
              {item.href ? (
                <span className="mt-0.5 shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                  {item.actionLabel ?? "View"}
                </span>
              ) : null}
            </div>
          );

          return item.href ? (
            <Link
              className="block hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              href={item.href}
              key={item.id}
            >
              {content}
            </Link>
          ) : (
            <div key={item.id}>{content}</div>
          );
        })}
      </div>
    </Card>
  );
}

function StaffStatusBadge({
  status,
}: {
  status: StaffWorkdayStatus | "not_checked_in";
}) {
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-5",
        statusToneClass(status),
      )}
    >
      <span
        aria-hidden="true"
        className={classNames("h-1.5 w-1.5 rounded-full", statusDotClass(status))}
      />
      {displayStaffStatus(status)}
    </span>
  );
}

function TeamMobileRow({
  canViewFinancials,
  member,
  timeZone,
}: {
  canViewFinancials: boolean;
  member: TodayTeamMember;
  timeZone: string;
}) {
  const services = canViewFinancials
    ? staffMoneyDisplay({
        emptyLabel: "-",
        kind: "services",
        member,
        value: member.serviceSales,
      })
    : null;
  const tips = canViewFinancials
    ? staffMoneyDisplay({
        emptyLabel: "-",
        kind: "tips",
        member,
        value: member.tips,
      })
    : null;

  return (
    <li className="py-3">
      <div className="flex min-w-0 items-center gap-3">
        <StaffAvatar name={member.displayName} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-zinc-950">
                {member.displayName}
              </p>
            </div>
            <StaffStatusBadge status={member.status} />
            <span className="shrink-0 text-sm text-zinc-800">
              <TurnPair member={member} />
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span className="whitespace-nowrap">
              {formatCheckIn(member, timeZone)}
            </span>
            {services ? (
              <span
                aria-label={services.title ?? undefined}
                className="whitespace-nowrap font-medium text-zinc-700"
                title={services.title ?? undefined}
              >
                Services {services.label}
              </span>
            ) : null}
            {tips ? (
              <span
                aria-label={tips.title ?? undefined}
                className="whitespace-nowrap"
                title={tips.title ?? undefined}
              >
                Tips {tips.label}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function TeamPanel({ dashboard }: { dashboard: TodayDashboard }) {
  return (
    <Card
      action={<ActionLink href="/staff" label="Staff" />}
      icon="team"
      title="Team Today"
    >
      {dashboard.team.length > 0 ? (
        <>
          <ul className="divide-y divide-zinc-100 md:hidden">
            {dashboard.team.map((member) => (
              <TeamMobileRow
                canViewFinancials={dashboard.permissions.canViewStaffFinancials}
                key={member.id}
                member={member}
                timeZone={dashboard.timezone}
              />
            ))}
          </ul>

          <div className="hidden md:block">
            <table className="w-full table-fixed text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-100 text-xs font-medium text-zinc-500">
                  <th className="w-[34%] py-2 pr-3">Staff</th>
                  <th className="w-[12%] py-2 pr-3">Status</th>
                  <th className="w-[13%] py-2 pr-3">Check-in</th>
                  <th className="w-[13%] py-2 pr-3">
                    <span className="block">Turns</span>
                    <span className="block text-[11px] font-normal text-zinc-400">
                      L / S
                    </span>
                  </th>
                  {dashboard.permissions.canViewStaffFinancials ? (
                    <>
                      <th className="w-[14%] py-2 pr-3">Services</th>
                      <th className="w-[14%] py-2">Tips</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {dashboard.team.map((member) => (
                  <tr key={member.id}>
                    <td className="py-3 pr-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <StaffAvatar name={member.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-zinc-950">
                            {member.displayName}
                          </p>
                          <p className="truncate text-xs text-zinc-500">
                            {member.jobTitle ?? "Staff"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <StaffStatusBadge status={member.status} />
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-zinc-700">
                      {formatCheckIn(member, dashboard.timezone)}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-zinc-700">
                      <TurnPair member={member} />
                    </td>
                    {dashboard.permissions.canViewStaffFinancials ? (
                      <>
                        <td className="whitespace-nowrap py-3 pr-3 text-zinc-700">
                          {(() => {
                            const services = staffMoneyDisplay({
                              emptyLabel: "-",
                              kind: "services",
                              member,
                              value: member.serviceSales,
                            });

                            return (
                              <span
                                aria-label={services.title ?? undefined}
                                title={services.title ?? undefined}
                              >
                                {services.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="whitespace-nowrap py-3 text-zinc-700">
                          {(() => {
                            const tips = staffMoneyDisplay({
                              emptyLabel: "-",
                              kind: "tips",
                              member,
                              value: member.tips,
                            });

                            return (
                              <span
                                aria-label={tips.title ?? undefined}
                                title={tips.title ?? undefined}
                              >
                                {tips.label}
                              </span>
                            );
                          })()}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <EmptyLine
          label={
            dashboard.dayView.isCurrentDate
              ? "No active staff records for today."
              : "No staff records for this date."
          }
        />
      )}
    </Card>
  );
}

function hasSalesActivity(performance: TodayPerformance) {
  return Boolean(
    performance.sales &&
      (performance.sales.ticketCount > 0 ||
        performance.sales.total > 0 ||
        performance.sales.service > 0 ||
        performance.sales.tip > 0),
  );
}

function SalesSummary({ performance }: { performance: TodayPerformance }) {
  if (!performance.sales) {
    return <EmptyLine label="Reports access is required to show sales totals." />;
  }

  const rows = [
    [
      "Services",
      performance.sales.service > 0
        ? formatShortMoney(performance.sales.service)
        : "-",
    ],
    [
      "Tips",
      performance.sales.tip > 0 ? formatShortMoney(performance.sales.tip) : "-",
    ],
    [
      "Tickets",
      performance.sales.ticketCount > 0
        ? `${performance.sales.ticketCount}`
        : "-",
    ],
  ];
  const hasActivity = hasSalesActivity(performance);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-zinc-500">Total sales</p>
        <p className="mt-1 text-3xl font-semibold text-zinc-950 sm:text-4xl">
          {formatMoney(performance.sales.total)}
        </p>
        <TrendPill trend={performance.sales.comparison} />
        {!hasActivity ? (
          <p className="mt-2 text-sm text-zinc-600">
            Performance will appear after the first completed ticket.
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {rows.map(([label, value]) => (
          <div
            className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3"
            key={label}
          >
            <dt className="text-xs font-medium text-zinc-500">{label}</dt>
            <dd className="mt-1 whitespace-nowrap text-sm font-semibold tabular-nums text-zinc-950">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {performance.sales.discount > 0 ? (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Discounts applied: -{formatMoney(performance.sales.discount)}
        </div>
      ) : null}
    </div>
  );
}

function shortHourLabel(label: string) {
  if (label === "Before open") {
    return "Before";
  }

  if (label === "After hours") {
    return "After hrs";
  }

  return label
    .replace(" after hours", "*")
    .replace(" AM", "a")
    .replace(" PM", "p")
    .replace(" ", "");
}

function SalesActivityChart({
  dateLabel,
  performance,
}: {
  dateLabel: string;
  performance: TodayPerformance;
}) {
  const points = performance.salesTrend;

  if (!performance.sales || points.length === 0) {
    return null;
  }

  const hasSignal = points.some((point) => point.total > 0);
  const max = Math.max(...points.map((point) => Math.max(0, point.total)), 1);
  const width = 760;
  const height = 250;
  const chartLeft = 48;
  const chartRight = 14;
  const chartTop = 18;
  const chartBottom = 206;
  const chartWidth = width - chartLeft - chartRight;
  const chartHeight = chartBottom - chartTop;
  const slotWidth = chartWidth / points.length;
  const barWidth = Math.min(22, Math.max(4, slotWidth * 0.42));
  const labelStep = Math.max(1, Math.ceil(points.length / 12));
  const ticks = hasSignal ? [max, max / 2, 0] : [0];
  const ticketCount = points.reduce((total, point) => total + point.ticketCount, 0);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-950">Hourly sales</h3>
        <span className="shrink-0 text-xs font-medium text-zinc-500">
          {ticketCount > 0
            ? `${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`
            : "No tickets"}
        </span>
      </div>
      <svg
        aria-label={`Hourly sales chart for ${dateLabel}`}
        className="h-64 w-full max-w-full overflow-hidden"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <desc>
          {points
            .map((point) => `${point.label}: ${formatMoney(point.total)}`)
            .join(", ")}
        </desc>
        {ticks.map((tick) => {
          const y = chartBottom - (tick / max) * chartHeight;

          return (
            <g key={tick}>
              <line
                className="stroke-zinc-200"
                strokeWidth={tick === 0 ? "1.1" : "0.8"}
                x1={chartLeft}
                x2={width - chartRight}
                y1={y}
                y2={y}
              />
              <text
                className="fill-zinc-500 text-[11px]"
                textAnchor="end"
                x={chartLeft - 8}
                y={y + 4}
              >
                {tick === 0 ? "$0" : formatShortMoney(tick)}
              </text>
            </g>
          );
        })}
        {points.map((point, index) => {
          const barHeight = Math.max(
            hasSignal ? 3 : 1.5,
            (Math.max(0, point.total) / max) * chartHeight,
          );
          const x = chartLeft + index * slotWidth + (slotWidth - barWidth) / 2;
          const y = chartBottom - barHeight;
          const showLabel =
            index === 0 ||
            index === points.length - 1 ||
            index % labelStep === 0;

          return (
            <g key={`${point.label}:${index}`}>
              <rect
                className={
                  point.afterHours
                    ? "fill-orange-300"
                    : point.latest
                      ? "fill-amber-500"
                      : "fill-amber-300"
                }
                height={barHeight}
                rx="2.5"
                width={barWidth}
                x={x}
                y={y}
              />
              {showLabel ? (
                <text
                  className="fill-zinc-500 text-[10px]"
                  textAnchor="middle"
                  x={x + barWidth / 2}
                  y="236"
                >
                  {shortHourLabel(point.label)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StaffBars({
  canViewFinancials,
  bars,
}: {
  bars: TodayPerformance["staffBars"];
  canViewFinancials: boolean;
}) {
  if (!canViewFinancials) {
    return (
      <EmptyLine label="Staff sales require payroll, reports, or ticket access." />
    );
  }

  if (bars.length === 0) {
    return null;
  }

  const max = Math.max(...bars.map((bar) => bar.value), 1);

  return (
    <div className="space-y-3">
      {bars.map((bar) => (
        <div key={bar.staffId}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className="truncate text-sm font-medium text-zinc-700">
              {bar.label}
            </p>
            <p className="shrink-0 text-sm font-semibold text-zinc-950">
              {formatCompactMoney(bar.value)}
            </p>
          </div>
          <div className="h-2 overflow-hidden rounded-md bg-zinc-100">
            <div
              className="h-full rounded-md bg-amber-500"
              style={{ width: `${Math.max(8, (bar.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function BookingStatusCounts({ performance }: { performance: TodayPerformance }) {
  const total =
    performance.bookingStatus.active +
    performance.bookingStatus.completed +
    performance.bookingStatus.upcoming;

  if (total === 0) {
    return null;
  }

  const rows = [
    ["Active", performance.bookingStatus.active],
    ["Completed", performance.bookingStatus.completed],
    ["Upcoming", performance.bookingStatus.upcoming],
  ];

  return (
    <dl className="grid grid-cols-3 gap-2">
      {rows.map(([label, value]) => (
        <div className="border-t border-zinc-200 pt-3" key={label}>
          <dt className="text-xs font-medium text-zinc-500">{label}</dt>
          <dd className="mt-1 text-lg font-semibold text-zinc-950">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PerformancePanel({ dashboard }: { dashboard: TodayDashboard }) {
  const reportsHref = dashboard.permissions.canViewReports
    ? `/reports?${new URLSearchParams({
        date: dashboard.date,
      }).toString()}`
    : null;
  const showStaffBars =
    dashboard.permissions.canViewStaffFinancials &&
    dashboard.performance.staffBars.length > 0;
  const showBookingCounts =
    dashboard.performance.bookingStatus.active +
      dashboard.performance.bookingStatus.completed +
      dashboard.performance.bookingStatus.upcoming >
    0;
  const isClosedEmptyDay = dashboard.performance.emptyLabel === "Closed day.";
  const title = dashboard.dayView.isCurrentDate
    ? "Today Performance"
    : "Day Performance";

  return (
    <Card
      action={
        reportsHref ? <ActionLink href={reportsHref} label="Reports" /> : null
      }
      icon="chart"
      title={title}
    >
      <div className="space-y-5">
        <div className="grid gap-6 lg:grid-cols-[minmax(260px,0.45fr)_minmax(0,1.55fr)]">
          <SalesSummary performance={dashboard.performance} />
          {isClosedEmptyDay ? (
            <CompactEmptyState
              detail="No sales activity was recorded for this selected date."
              title="Closed day"
            />
          ) : (
            <SalesActivityChart
              dateLabel={formatDashboardDate(dashboard.date)}
              performance={dashboard.performance}
            />
          )}
        </div>

        {showStaffBars ? (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-950">
              Top Staff
            </h3>
            <StaffBars
              bars={dashboard.performance.staffBars}
              canViewFinancials={dashboard.permissions.canViewStaffFinancials}
            />
          </div>
        ) : null}

        {showBookingCounts ? (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-zinc-950">
              Appointments
            </h3>
            <BookingStatusCounts performance={dashboard.performance} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function LoadErrorsBanner({ errors }: { errors: TodayDashboard["loadErrors"] }) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">Some Today sections could not load.</p>
      <ul className="mt-2 space-y-1">
        {errors.map((error) => (
          <li key={`${error.area}:${error.message}`}>
            {error.area}: {error.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RestrictedDashboard({ dashboard }: { dashboard: TodayDashboard }) {
  return (
    <main className="min-h-screen bg-[#fbfaf8] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold text-zinc-950">
            {getGreeting(dashboard.timezone)}, {dashboard.greetingName}{" "}
            <span aria-hidden="true">{"\uD83D\uDC4B"}</span>
          </h1>
          <p className="mt-2 text-sm font-medium text-zinc-500">
            {dashboard.salonName}
            {" \u00B7 "}
            {formatDashboardDate(dashboard.date)}
          </p>
        </header>
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-950">
            Permission required
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            Today requires staff view permission for this salon workspace.
          </p>
        </section>
      </div>
    </main>
  );
}

type StaffTodayPageProps = {
  searchParams: Promise<{ date?: string | string[] | undefined }>;
};

export default async function StaffTodayPage({
  searchParams,
}: StaffTodayPageProps) {
  const context = await requireSalonManagePageContext("/staff/today");
  const params = await searchParams;
  const dashboard = await getTodayDashboard(context, { date: params.date });

  if (dashboard.noAccess) {
    return <RestrictedDashboard dashboard={dashboard} />;
  }

  return (
    <main
      className="min-h-screen bg-[#fbfaf8] px-4 py-6 sm:px-6 lg:px-8"
      data-today-dashboard="owner-manager"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-semibold tracking-normal text-zinc-950 sm:text-4xl">
                {getGreeting(dashboard.timezone)}, {dashboard.greetingName}{" "}
                <span aria-hidden="true">{"\uD83D\uDC4B"}</span>
              </h1>
            </div>
            <div className="shrink-0 self-start">
              <DayViewControl dayView={dashboard.dayView} />
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-sm font-medium text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 break-words">
              {dashboard.salonName}
              {" \u00B7 "}
              {formatDashboardDate(dashboard.date)}
            </p>
            <p className="shrink-0 text-xs text-zinc-400 sm:text-sm">
              Updated {formatTime(dashboard.generatedAt, dashboard.timezone)}
            </p>
          </div>
        </header>

        <LoadErrorsBanner errors={dashboard.loadErrors} />
        <SummaryGrid dashboard={dashboard} />

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <RightNowPanel dashboard={dashboard} />
          <AttentionPanel items={dashboard.attention} />
        </section>

        <TeamPanel dashboard={dashboard} />
        <PerformancePanel dashboard={dashboard} />

        <QuickAccessPanel
          configuration={dashboard.quickAccesses}
          key={dashboard.quickAccesses.selected
            .map((shortcut) => shortcut.id)
            .join(":")}
        />
      </div>
    </main>
  );
}
