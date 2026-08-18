import {
  getCurrentStaffAnalysisPortalData,
  getCurrentStaffPayrollPortalData,
  type StaffAnalysisPortalData,
  type StaffPayrollPortalData,
} from "@/lib/payroll";
import {
  getCurrentSalonStaffActivitySummaries,
  getCurrentStaffAssignedWork,
  getTodaysStaffWorkday,
  STAFF_WORKDAY_STATUS_LABELS,
} from "@/lib/staff-workdays";
import { StaffPublicProfileEditor } from "@/app/staff/staff-public-profile-editor";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import type { StaffAssignedWorkTicket } from "@/lib/staff-workdays";
import type { Staff } from "@/types/staff";
import Link from "next/link";
import { redirect } from "next/navigation";

type StaffPortalTab = "daily" | "payroll" | "analysis";
type StaffPortalTabId = StaffPortalTab | "profile";
type StaffPortalPeriodTab = Exclude<StaffPortalTab, "daily">;
type StaffPortalPeriodData = Pick<
  StaffPayrollPortalData,
  "period" | "periodOptions" | "salonPayrollSetting"
>;
type StaffPortalTabItem = {
  href: string;
  id: StaffPortalTabId;
  label: string;
};

type StaffMyWorkSearchParams = {
  cycleType?: string | string[];
  end?: string | string[];
  error?: string | string[];
  month?: string | string[];
  payPeriodStart?: string | string[];
  profile?: string | string[];
  preset?: string | string[];
  segment?: string | string[];
  start?: string | string[];
  tab?: string | string[];
};

type StaffMyWorkPageProps = {
  searchParams?: Promise<StaffMyWorkSearchParams>;
};

const STAFF_PORTAL_TABS: Array<Omit<StaffPortalTabItem, "href">> = [
  { id: "daily", label: "Daily" },
  { id: "payroll", label: "My Pay" },
  { id: "analysis", label: "Analysis" },
  { id: "profile", label: "Profile Setting" },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "N/A";
  }

  const prefix = value > 0 ? "+" : "";

  return `${prefix}${formatNumber(value)}%`;
}

function formatMoneyDelta(value: number) {
  if (value === 0) {
    return formatMoney(0);
  }

  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function formatWorkDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);

  return {
    date: new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(date),
    weekday: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
    }).format(date),
  };
}

function getGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}

function formatTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatStatus(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getActiveTab(tab: string | string[] | undefined): StaffPortalTab {
  const value = Array.isArray(tab) ? tab[0] : tab;

  if (value === "payroll" || value === "analysis") {
    return value;
  }

  return "daily";
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dateFromDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateOnlyFromUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  return dateOnlyFromUtcDate(
    new Date(dateFromDateOnly(value).getTime() + days * 24 * 60 * 60 * 1000),
  );
}

function getWeekStart(value: string) {
  const date = dateFromDateOnly(value);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  return addDays(value, mondayOffset);
}

function getMonthStart(value: string) {
  return `${value.slice(0, 7)}-01`;
}

function getYearStart(value: string) {
  return `${value.slice(0, 4)}-01-01`;
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatFileSize(value: number | null | undefined) {
  if (!value || value <= 0) {
    return null;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function getPeriodOptionHref(
  data: StaffPortalPeriodData,
  option: StaffPortalPeriodData["periodOptions"][number],
  tab: StaffPortalPeriodTab,
) {
  const params = new URLSearchParams({ tab });
  const cycleType = data.salonPayrollSetting?.cycle_type ?? "monthly";

  if (cycleType === "biweekly") {
    params.set("payPeriodStart", option.startDate);
  } else if (cycleType === "semi_monthly") {
    params.set("month", option.startDate.slice(0, 7));
    params.set("segment", option.value);
  } else {
    params.set("month", option.value);
  }

  return `/staff/my-work?${params.toString()}`;
}

function buildStaffPortalTabs(params: StaffMyWorkSearchParams | undefined) {
  const periodParamNames = [
    "cycleType",
    "end",
    "month",
    "payPeriodStart",
    "preset",
    "segment",
    "start",
  ] as const;

  return STAFF_PORTAL_TABS.map((tab) => {
    if (tab.id === "profile") {
      return {
        ...tab,
        href: "/staff/my-work?profile=1",
      } satisfies StaffPortalTabItem;
    }

    const urlParams = new URLSearchParams();

    for (const name of periodParamNames) {
      const value = stringParam(params?.[name]);

      if (value) {
        urlParams.set(name, value);
      }
    }

    if (tab.id !== "daily") {
      urlParams.set("tab", tab.id);
    }

    const query = urlParams.toString();

    return {
      ...tab,
      href: query ? `/staff/my-work?${query}` : "/staff/my-work",
    } satisfies StaffPortalTabItem;
  });
}

function getAnalysisRangeOptions(today: string) {
  return [
    {
      endDate: today,
      id: "week",
      label: "This Week",
      startDate: getWeekStart(today),
    },
    {
      endDate: today,
      id: "month",
      label: "This Month",
      startDate: getMonthStart(today),
    },
    {
      endDate: today,
      id: "year",
      label: "This Year",
      startDate: getYearStart(today),
    },
  ];
}

function getAnalysisRangeHref(option: { endDate: string; startDate: string }) {
  const params = new URLSearchParams({
    end: option.endDate,
    preset: "custom",
    start: option.startDate,
    tab: "analysis",
  });

  return `/staff/my-work?${params.toString()}`;
}

function StaffPortalHeader({
  activeTab,
  dateLabel,
  profileActive,
  salonName,
  staffName,
  staffRole,
  tabs,
  weekday,
  workStatusLabel,
}: {
  activeTab: StaffPortalTab;
  dateLabel: string;
  profileActive: boolean;
  salonName: string;
  staffName: string;
  staffRole: string | null;
  tabs: StaffPortalTabItem[];
  weekday: string;
  workStatusLabel: string;
}) {
  const isCheckedIn = workStatusLabel !== STAFF_WORKDAY_STATUS_LABELS.not_checked_in;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500">
            Today is {weekday}, {dateLabel}
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight text-zinc-950 sm:text-3xl">
            {getGreeting()}, {staffName}
          </h1>
        </div>
        <span
          className={[
            "inline-flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold",
            isCheckedIn
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-800",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className={[
              "size-2 rounded-full",
              isCheckedIn ? "bg-emerald-500" : "bg-amber-500",
            ].join(" ")}
          />
          {workStatusLabel}
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-4 border-t border-zinc-100 pt-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-zinc-950">
            {salonName}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {staffRole?.trim() || "Staff"}
          </p>
        </div>
        <nav
          aria-label="Staff portal tabs"
          className="flex w-full gap-1 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-1 lg:w-auto"
        >
          {tabs.map((tab) => {
            const isActive =
              tab.id === "profile"
                ? profileActive
                : tab.id === activeTab && !profileActive;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={[
                  "inline-flex min-h-10 shrink-0 items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                  isActive
                    ? "bg-zinc-950 text-white shadow-sm"
                    : "text-zinc-600 hover:bg-white hover:text-zinc-950",
                ].join(" ")}
                href={tab.href}
                key={tab.id}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </section>
  );
}

function SummaryCard({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-2xl font-semibold leading-tight text-zinc-950">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-zinc-500">{detail}</p>
    </div>
  );
}

function TicketMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-zinc-950">
        {value}
      </p>
    </div>
  );
}

function StaffTicketCard({ ticket }: { ticket: StaffAssignedWorkTicket }) {
  const ticketTime = formatTime(ticket.openedAt ?? ticket.firstActivityAt);
  const turnLabel = ticket.hasEarning
    ? formatNumber(ticket.totalTurns)
    : "-";

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-zinc-500">
            {ticketTime} / {formatStatus(ticket.status)}
          </p>
          <h3 className="mt-1 break-words text-base font-semibold text-zinc-950">
            {ticket.customerName ?? "Walk-in customer"}
          </h3>
          <p className="mt-1 text-sm text-zinc-500">
            {ticket.ticketNumber ?? "Ticket"}
          </p>
          {ticket.customerPhone ? (
            <p className="mt-1 text-sm text-zinc-500">{ticket.customerPhone}</p>
          ) : null}
        </div>
        <span className="inline-flex w-fit rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-700">
          {formatStatus(ticket.status)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-zinc-100 py-3 sm:grid-cols-4">
        <TicketMetric label="Service amount" value={formatMoney(ticket.serviceTotal)} />
        <TicketMetric label="Tip" value={formatMoney(ticket.tipAmount)} />
        <TicketMetric label="Turn" value={turnLabel} />
        <TicketMetric label="Income" value={formatMoney(ticket.totalEarning)} />
      </div>

      <div className="mt-4">
        <p className="text-xs font-medium uppercase text-zinc-500">My services</p>
        {ticket.services.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">
            No service lines assigned to you are attached to this ticket.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-100">
            {ticket.services.map((service) => (
              <li
                className="grid gap-2 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                key={service.id}
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-zinc-950">
                    {service.serviceName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {formatTime(service.createdAt)} / Qty{" "}
                    {formatNumber(service.quantity)}
                  </p>
                </div>
                <p className="text-left font-semibold text-zinc-950 sm:text-right">
                  {formatMoney(service.lineTotal)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!ticket.hasEarning ? (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Earnings are pending for this ticket. Service lines are shown for reference.
        </p>
      ) : null}
    </article>
  );
}

function ticketServiceSummary(ticket: StaffAssignedWorkTicket) {
  if (ticket.services.length === 0) {
    return "No assigned services";
  }

  return ticket.services
    .map((service) => `${service.serviceName} x${formatNumber(service.quantity)}`)
    .join(", ");
}

function TicketStatusBadge({ status }: { status: string | null }) {
  const label = formatStatus(status);
  const tone =
    status === "closed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "open"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-700";

  return (
    <span
      className={`inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function StaffTicketTable({ tickets }: { tickets: StaffAssignedWorkTicket[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3" scope="col">
                Time
              </th>
              <th className="min-w-48 px-4 py-3" scope="col">
                Customer
              </th>
              <th className="whitespace-nowrap px-4 py-3" scope="col">
                Ticket
              </th>
              <th className="whitespace-nowrap px-4 py-3" scope="col">
                Status
              </th>
              <th className="min-w-72 px-4 py-3" scope="col">
                Services
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right" scope="col">
                Service
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right" scope="col">
                Tip
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right" scope="col">
                Turns
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right" scope="col">
                Income
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {tickets.map((ticket) => {
              const ticketTime = formatTime(ticket.openedAt ?? ticket.firstActivityAt);
              const turnLabel = ticket.hasEarning
                ? formatNumber(ticket.totalTurns)
                : "-";

              return (
                <tr className="hover:bg-zinc-50" key={ticket.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                    {ticketTime}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-950">
                      {ticket.customerName ?? "Walk-in customer"}
                    </p>
                    {ticket.customerPhone ? (
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {ticket.customerPhone}
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                    {ticket.ticketNumber ?? "Ticket"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <TicketStatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-700">
                    <span className="line-clamp-2">{ticketServiceSummary(ticket)}</span>
                    {!ticket.hasEarning ? (
                      <span className="mt-1 block text-xs text-amber-700">
                        Earnings pending
                      </span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-950">
                    {formatMoney(ticket.serviceTotal)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-950">
                    {formatMoney(ticket.tipAmount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-zinc-950">
                    {turnLabel}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-zinc-950">
                    {formatMoney(ticket.totalEarning)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:hidden">
        {tickets.map((ticket) => (
          <StaffTicketCard key={ticket.id} ticket={ticket} />
        ))}
      </div>
    </>
  );
}

function EmptyTickets({
  excludedTicketCount,
  hasTodayActivity,
  workStatus,
}: {
  excludedTicketCount: number;
  hasTodayActivity: boolean;
  workStatus: string;
}) {
  let message = "No tickets are assigned to you today yet.";

  if (excludedTicketCount > 0) {
    message =
      "Only cancelled or voided tickets were found today. They are excluded from Daily totals.";
  } else if (hasTodayActivity) {
    message =
      "You have activity today, but no ticket earnings are ready to show yet.";
  } else if (workStatus === "not_checked_in") {
    message = "You are not checked in yet, and no tickets are assigned for today.";
  }

  return (
    <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
      {message}
    </p>
  );
}

function PayrollPeriodSelector({
  data,
  tab,
  title = "Pay period",
}: {
  data: StaffPortalPeriodData;
  tab: StaffPortalPeriodTab;
  title?: string;
}) {
  if (!data.period) {
    return null;
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-zinc-500">{title}</p>
          <h2 className="mt-1 break-words text-lg font-semibold text-zinc-950 sm:text-xl">
            {data.period.label}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {formatDateOnly(data.period.startDate)} to{" "}
            {formatDateOnly(data.period.endDate)}
          </p>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:justify-end">
          {data.periodOptions.map((option) => {
            const isActive =
              data.period?.startDate === option.startDate &&
              data.period?.endDate === option.endDate;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={[
                  "inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                  isActive
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-950",
                ].join(" ")}
                href={getPeriodOptionHref(data, option, tab)}
                key={`${option.startDate}:${option.endDate}:${option.value}`}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </div>
      <form
        action="/staff/my-work"
        className="mt-3 grid gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
        method="get"
      >
        <input name="tab" type="hidden" value={tab} />
        <input name="preset" type="hidden" value="custom" />
        <label className="block">
          <span className="text-xs font-medium uppercase text-zinc-500">
            Start date
          </span>
          <input
            className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
            defaultValue={data.period.startDate}
            name="start"
            type="date"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase text-zinc-500">
            End date
          </span>
          <input
            className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
            defaultValue={data.period.endDate}
            name="end"
            type="date"
          />
        </label>
        <button
          className="min-h-10 self-end rounded-md bg-zinc-950 px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          type="submit"
        >
          Load
        </button>
      </form>
    </section>
  );
}

function PayrollLedgerCard({
  label,
  tone = "default",
  value,
}: {
  label: string;
  tone?: "default" | "strong";
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4">
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p
        className={[
          "mt-1 break-words text-2xl font-semibold leading-tight",
          tone === "strong" ? "text-zinc-950" : "text-zinc-800",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

function DetailGrid({
  items,
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div className="min-w-0 rounded-md bg-zinc-50 p-3" key={item.label}>
          <dt className="text-xs font-medium uppercase text-zinc-500">
            {item.label}
          </dt>
          <dd className="mt-1 break-words text-sm font-semibold text-zinc-950">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function getPayrollStatusCopy(data: StaffPayrollPortalData) {
  if (data.paystub?.view_url) {
    return {
      label: "Paystub available",
      message: "Your paystub is ready to view.",
    };
  }

  if (data.status.statementVersion) {
    return {
      label: "Finalized",
      message: `Statement version ${data.status.statementVersion}`,
    };
  }

  return {
    label: "In progress",
    message: "Live payroll for the selected period.",
  };
}

function PayrollPaystubCard({ data }: { data: StaffPayrollPortalData }) {
  const paystub = data.paystub;
  const fileSize = formatFileSize(paystub?.size_bytes);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">Paystub</h2>
          {paystub ? (
            <p className="mt-1 text-sm text-zinc-600">
              {paystub.file_name ?? "Paystub"} / Added{" "}
              {formatDateTime(paystub.created_at)}
              {fileSize ? ` / ${fileSize}` : ""}
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-600">
              No paystub has been posted for this period.
            </p>
          )}
        </div>
        {paystub?.view_url ? (
          <a
            aria-label="View or download paystub"
            className="inline-flex min-h-10 w-fit items-center rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            href={paystub.view_url}
            rel="noreferrer"
            target="_blank"
          >
            View / Download
          </a>
        ) : null}
      </div>
    </section>
  );
}

function PayrollBreakdownTable({ data }: { data: StaffPayrollPortalData }) {
  if (data.dailyRows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
        No daily payroll rows for this period.
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:hidden">
        {data.dailyRows.map((row) => (
          <article
            className="rounded-lg border border-zinc-200 bg-white p-4"
            key={row.id}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-zinc-950">
                {formatDateOnly(row.businessDate)}
              </h3>
              <p className="text-right text-sm font-semibold text-zinc-950">
                {formatMoney(row.commissionGross + row.tipAmount)}
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase text-zinc-500">
                  Shop Gross
                </dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  {formatMoney(row.shopGross)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-zinc-500">
                  Commission
                </dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  {formatMoney(row.commissionGross)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-zinc-500">Tip</dt>
                <dd className="mt-1 font-semibold text-zinc-950">
                  {formatMoney(row.tipAmount)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white sm:block">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Shop Gross</th>
              <th className="px-4 py-3 text-right">Commission Gross</th>
              <th className="px-4 py-3 text-right">Tip</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.dailyRows.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">
                  {formatDateOnly(row.businessDate)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                  {formatMoney(row.shopGross)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                  {formatMoney(row.commissionGross)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                  {formatMoney(row.tipAmount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-zinc-950">
                  {formatMoney(row.commissionGross + row.tipAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MyPayrollTab({ data }: { data: StaffPayrollPortalData }) {
  const line = data.line;
  const statusCopy = getPayrollStatusCopy(data);

  if (!data.period) {
    return (
      <section className="mt-8 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">My Payroll</h2>
        <p className="mt-2 text-sm text-zinc-600">
          No active staff profile is linked to your account for this work salon.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 grid gap-5">
      <PayrollPeriodSelector data={data} tab="payroll" />

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-zinc-500">Payroll status</p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-950">
              {statusCopy.label}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              {statusCopy.message}
            </p>
          </div>
          <span className="inline-flex w-fit rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-700">
            Read-only
          </span>
        </div>
      </section>

      {!line ? (
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
          No payroll line has been generated for you in this period.
        </p>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <PayrollLedgerCard
              label="Total"
              tone="strong"
              value={formatMoney(line.final_staff_income)}
            />
            <PayrollLedgerCard
              label="Cash Net"
              value={formatMoney(line.base_cash_amount)}
            />
            <PayrollLedgerCard
              label="Check Net"
              value={formatMoney(line.check_net)}
            />
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-zinc-950">Details</h2>
              <p className="mt-1 text-sm text-zinc-600">
                Read-only values from this payroll period.
              </p>
            </div>
            <DetailGrid
              items={[
                { label: "Cash", value: formatMoney(line.final_cash_amount) },
                { label: "Check", value: formatMoney(line.final_check_amount) },
                { label: "Shop Gross", value: formatMoney(line.gross_sales) },
                {
                  label: "Commission Gross",
                  value: formatMoney(line.staff_commission_gross),
                },
                { label: "Tax", value: formatMoney(line.tax_withheld) },
                { label: "Tip", value: formatMoney(line.tip_amount) },
                { label: "Bonus", value: formatMoney(line.bonus_amount) },
                {
                  label: "Check Number",
                  value: line.check_number?.trim() || "-",
                },
              ]}
            />
          </section>

          <PayrollPaystubCard data={data} />

          <section className="grid gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">
                Daily Breakdown
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Daily rows are calculated by the existing payroll engine.
              </p>
            </div>
            <PayrollBreakdownTable data={data} />
          </section>
        </>
      )}
    </section>
  );
}

function AnalysisTopServices({
  services,
}: {
  services: StaffAnalysisPortalData["workPerformance"]["topServices"];
}) {
  if (services.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
        No staff-assigned services were found for this period.
      </p>
    );
  }

  const maxRevenue = Math.max(0, ...services.map((service) => service.revenue));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="divide-y divide-zinc-100">
        {services.map((service) => {
          const width =
            maxRevenue === 0
              ? 0
              : Math.max(4, Math.round((service.revenue / maxRevenue) * 100));

          return (
            <div className="p-4" key={service.serviceId}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="break-words font-medium text-zinc-950">
                    {service.serviceName}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {formatNumber(service.count)} services / {service.ticketCount}{" "}
                    {service.ticketCount === 1 ? "ticket" : "tickets"}
                  </p>
                </div>
                <p className="shrink-0 font-semibold text-zinc-950">
                  {formatMoney(service.revenue)}
                </p>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-emerald-600"
                  style={{ width: `${width}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisRangeSelector({
  data,
  today,
}: {
  data: StaffAnalysisPortalData;
  today: string;
}) {
  if (!data.period) {
    return null;
  }

  const rangeOptions = getAnalysisRangeOptions(today);

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-zinc-500">Analysis range</p>
          <h2 className="mt-1 break-words text-lg font-semibold text-zinc-950 sm:text-xl">
            {data.period.label}
          </h2>
        </div>
        <nav
          aria-label="Analysis date ranges"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
        >
          {rangeOptions.map((option) => {
            const isActive =
              data.period?.startDate === option.startDate &&
              data.period?.endDate === option.endDate;

            return (
              <Link
                aria-current={isActive ? "page" : undefined}
                className={[
                  "inline-flex min-h-9 shrink-0 items-center rounded-md border px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950",
                  isActive
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-950",
                ].join(" ")}
                href={getAnalysisRangeHref(option)}
                key={option.id}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <details className="mt-3 border-t border-zinc-100 pt-3">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700">
          Custom range
        </summary>
        <form
          action="/staff/my-work"
          className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
          method="get"
        >
          <input name="tab" type="hidden" value="analysis" />
          <input name="preset" type="hidden" value="custom" />
          <label className="block">
            <span className="text-xs font-medium uppercase text-zinc-500">
              Start date
            </span>
            <input
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
              defaultValue={data.period.startDate}
              name="start"
              type="date"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase text-zinc-500">
              End date
            </span>
            <input
              className="mt-1 h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
              defaultValue={data.period.endDate}
              name="end"
              type="date"
            />
          </label>
          <button
            className="min-h-10 self-end rounded-md bg-zinc-950 px-4 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            type="submit"
          >
            Load
          </button>
        </form>
      </details>
    </section>
  );
}

function AnalysisIncomeTrend({
  trend,
}: {
  trend: StaffAnalysisPortalData["incomeTrend"];
}) {
  if (trend.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
        No payroll income rows were found for this period.
      </p>
    );
  }

  const visibleTrend = trend.filter(
    (point) =>
      point.income !== 0 ||
      point.cashNet !== 0 ||
      point.checkNet !== 0 ||
      point.taxAmount !== 0,
  );
  const rows = visibleTrend.length > 0 ? visibleTrend : trend;
  const maxIncome = Math.max(0, ...rows.map((point) => Math.abs(point.income)));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="grid gap-3">
        {rows.map((point) => {
          const width =
            maxIncome === 0
              ? 0
              : Math.max(4, Math.round((Math.abs(point.income) / maxIncome) * 100));

          return (
            <div
              className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_8rem] sm:items-center"
              key={point.businessDate}
            >
              <p className="text-sm font-medium text-zinc-700">
                {formatDateOnly(point.businessDate)}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                <div
                  className={[
                    "h-full rounded-full",
                    point.income < 0 ? "bg-red-500" : "bg-sky-600",
                  ].join(" ")}
                  style={{ width: `${width}%` }}
                />
              </div>
              <p className="text-sm font-semibold text-zinc-950 sm:text-right">
                {formatMoney(point.income)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AnalysisDailyActivity({
  trend,
}: {
  trend: StaffAnalysisPortalData["incomeTrend"];
}) {
  if (trend.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
        No daily payroll activity was found for this range.
      </p>
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:hidden">
        {trend.map((point) => (
          <article
            className="rounded-lg border border-zinc-200 bg-white p-4"
            key={point.businessDate}
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-semibold text-zinc-950">
                {formatDateOnly(point.businessDate)}
              </h3>
              <p className="text-right text-sm font-semibold text-zinc-950">
                {formatMoney(point.income)}
              </p>
            </div>
            <div className="mt-3">
              <DetailGrid
                items={[
                  { label: "Cash Net", value: formatMoney(point.cashNet) },
                  { label: "Check Net", value: formatMoney(point.checkNet) },
                  { label: "Tax", value: formatMoney(point.taxAmount) },
                ]}
              />
            </div>
          </article>
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white sm:block">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Cash Net</th>
              <th className="px-4 py-3 text-right">Check Net</th>
              <th className="px-4 py-3 text-right">Tax</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {trend.map((point) => (
              <tr key={point.businessDate}>
                <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-950">
                  {formatDateOnly(point.businessDate)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-zinc-950">
                  {formatMoney(point.income)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                  {formatMoney(point.cashNet)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                  {formatMoney(point.checkNet)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-zinc-700">
                  {formatMoney(point.taxAmount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AnalysisComparisonCard({
  comparison,
}: {
  comparison: StaffAnalysisPortalData["comparison"];
}) {
  if (!comparison) {
    return null;
  }

  const positive = comparison.deltaAmount > 0;
  const negative = comparison.deltaAmount < 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-zinc-950">
          Previous Period
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Compared with {comparison.previousLabel}.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-xs font-medium uppercase text-zinc-500">Current</p>
          <p className="mt-1 break-words font-semibold text-zinc-950">
            {formatMoney(comparison.currentIncome)}
          </p>
        </div>
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-xs font-medium uppercase text-zinc-500">Previous</p>
          <p className="mt-1 break-words font-semibold text-zinc-950">
            {formatMoney(comparison.previousIncome)}
          </p>
        </div>
        <div className="rounded-md bg-zinc-50 p-3">
          <p className="text-xs font-medium uppercase text-zinc-500">Change</p>
          <p
            className={[
              "mt-1 break-words font-semibold",
              positive
                ? "text-emerald-700"
                : negative
                  ? "text-red-700"
                  : "text-zinc-950",
            ].join(" ")}
          >
            {formatMoneyDelta(comparison.deltaAmount)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {formatPercent(comparison.deltaPercent)}
          </p>
        </div>
      </div>
    </section>
  );
}

function MyAnalysisTab({
  data,
  today,
}: {
  data: StaffAnalysisPortalData;
  today: string;
}) {
  const line = data.incomeLine;
  const performance = data.workPerformance;

  if (!data.period) {
    return (
      <section className="mt-8 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">My Analysis</h2>
        <p className="mt-2 text-sm text-zinc-600">
          No active staff profile is linked to your account for this work salon.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 grid gap-5">
      <AnalysisRangeSelector data={data} today={today} />

      <section className="grid gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase text-zinc-500">
              Personal Analysis
            </p>
            <h2 className="mt-1 text-xl font-semibold text-zinc-950">
              Income and activity
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <PayrollLedgerCard
            label="Total Income"
            tone="strong"
            value={formatMoney(line?.final_staff_income ?? 0)}
          />
          <PayrollLedgerCard
            label="Service"
            value={formatMoney(performance.serviceTotal)}
          />
          <PayrollLedgerCard label="Tip" value={formatMoney(performance.tipAmount)} />
          <PayrollLedgerCard
            label="Turns"
            tone="strong"
            value={formatNumber(performance.totalTurns)}
          />
          <PayrollLedgerCard
            label="Tickets"
            value={formatNumber(performance.ticketCount)}
          />
          <PayrollLedgerCard
            label="Avg Ticket"
            value={formatMoney(performance.averageTicket)}
          />
        </div>
        <p className="text-sm text-zinc-500">
          Turns: Big {formatNumber(performance.bigTurns)} / Small{" "}
          {formatNumber(performance.smallTurns)}. Income and activity are scoped to
          your staff profile.
        </p>
      </section>

      <AnalysisComparisonCard comparison={data.comparison} />

      <section className="grid gap-3">
        <div className="grid gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Income Trend</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Net income by day from payroll daily totals.
            </p>
          </div>
          <AnalysisIncomeTrend trend={data.incomeTrend} />
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
        <div className="grid gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Daily Activity</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Daily payroll rows for the selected range.
            </p>
          </div>
          <AnalysisDailyActivity trend={data.incomeTrend} />
        </div>
        <div className="grid gap-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Top Services</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Only services assigned to {data.staff?.display_name ?? "this staff"}.
            </p>
          </div>
          <AnalysisTopServices services={performance.topServices} />
        </div>
      </section>
    </section>
  );
}

function StaffPortalLoadError({ label = "Staff Portal" }: { label?: string }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <p className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        {label} could not load right now. Please refresh or try again after the
        current salon is available.
      </p>
    </main>
  );
}

function StaffProfileSettingsDrawer({
  closeHref,
  salonName,
  staff,
}: {
  closeHref: string;
  salonName: string;
  staff: Staff;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <Link
        aria-label="Close public profile settings"
        className="absolute inset-0 bg-zinc-950/30"
        href={closeHref}
      />
      <aside
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">
              Public Staff Profile
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Set the name and photo customers see in booking.
            </p>
          </div>
          <Link
            aria-label="Close public profile settings"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950"
            href={closeHref}
          >
            Close
          </Link>
        </header>
        <div className="px-6 py-5">
          <StaffPublicProfileEditor
            avatarUrl={getSalonProfileMediaUrl(staff.public_profile_photo_path)}
            bio={staff.public_bio}
            displayName={staff.display_name}
            jobTitle={staff.job_title}
            onlineBookingEnabled={staff.online_booking_enabled}
            ownerPublicEnabled={staff.owner_public_enabled}
            publicProfileVisible={staff.public_profile_visible}
            salonName={salonName}
            staffPublicConsentStatus={staff.staff_public_consent_status}
            specialties={staff.specialties}
            staffId={staff.id}
          />
        </div>
      </aside>
    </div>
  );
}

export default async function StaffMyWorkPage({
  searchParams,
}: StaffMyWorkPageProps) {
  const params = await searchParams;
  const activeTab = getActiveTab(params?.tab);
  const error = Array.isArray(params?.error) ? params?.error[0] : params?.error;
  const tabs = buildStaffPortalTabs(params);
  let assignedWork: Awaited<ReturnType<typeof getCurrentStaffAssignedWork>>;

  try {
    assignedWork = await getCurrentStaffAssignedWork();
  } catch (error) {
    console.error("Staff Daily load failed", error);
    return <StaffPortalLoadError label="Staff Daily" />;
  }

  const { context, excludedTicketCount, staff, today, workTickets } =
    assignedWork;

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
          Please select a salon first.
        </p>
      </main>
    );
  }

  if (!staff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          No active staff profile is linked to your account for this salon.
        </p>
      </main>
    );
  }

  let workday: Awaited<ReturnType<typeof getTodaysStaffWorkday>>["workday"] =
    null;
  let activityByStaffId: Awaited<
    ReturnType<typeof getCurrentSalonStaffActivitySummaries>
  >;

  try {
    [{ workday }, activityByStaffId] = await Promise.all([
      getTodaysStaffWorkday(context, { allowEmailFallback: false }),
      getCurrentSalonStaffActivitySummaries([staff.id], context),
    ]);
  } catch (error) {
    console.error("Staff Daily supporting data load failed", error);
    return <StaffPortalLoadError label="Staff Daily" />;
  }

  let payrollData: StaffPayrollPortalData | null = null;
  let analysisData: StaffAnalysisPortalData | null = null;

  if (activeTab === "payroll") {
    try {
      payrollData = await getCurrentStaffPayrollPortalData({
        cycleType: stringParam(params?.cycleType),
        endDate: stringParam(params?.end),
        month: stringParam(params?.month),
        payPeriodStart: stringParam(params?.payPeriodStart),
        preset: stringParam(params?.preset),
        segment: stringParam(params?.segment),
        startDate: stringParam(params?.start),
      });
    } catch (error) {
      console.error("Staff payroll portal load failed", error);
      return <StaffPortalLoadError label="My Payroll" />;
    }
  }

  if (activeTab === "analysis") {
    try {
      analysisData = await getCurrentStaffAnalysisPortalData({
        cycleType: stringParam(params?.cycleType),
        endDate: stringParam(params?.end),
        month: stringParam(params?.month),
        payPeriodStart: stringParam(params?.payPeriodStart),
        preset: stringParam(params?.preset),
        segment: stringParam(params?.segment),
        startDate: stringParam(params?.start),
      });
    } catch (error) {
      console.error("Staff analysis portal load failed", error);
      return <StaffPortalLoadError label="My Analysis" />;
    }
  }

  const activity = activityByStaffId.get(staff.id) ?? {
    assignedServiceAmount: 0,
    assignedServices: 0,
    bigTurns: 0,
    completedServices: 0,
    smallTurns: 0,
    tipAmount: 0,
    totalEarning: 0,
  };
  const workStatus = workday?.status ?? "not_checked_in";
  const workStatusLabel = STAFF_WORKDAY_STATUS_LABELS[workStatus];
  const { date: dateLabel, weekday } = formatWorkDate(today);
  const totalTurns = activity.bigTurns + activity.smallTurns;
  const hasTodayActivity =
    activity.assignedServiceAmount > 0 ||
    activity.tipAmount > 0 ||
    activity.totalEarning > 0 ||
    totalTurns > 0;
  const hasTicketsWithoutEarnings =
    workTickets.length > 0 && workTickets.every((ticket) => !ticket.hasEarning);
  const showProfileSettings =
    activeTab === "daily" && stringParam(params?.profile) === "1";

  return (
    <>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        <StaffPortalHeader
          activeTab={activeTab}
          dateLabel={dateLabel}
          profileActive={showProfileSettings}
          salonName={context.currentSalon.name}
          staffName={staff.display_name}
          staffRole={staff.job_title}
          tabs={tabs}
          weekday={weekday}
          workStatusLabel={workStatusLabel}
        />

        {error ? (
          <p className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {activeTab === "daily" ? (
          <>
            <section className="mt-6 grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                detail={`Big ${formatNumber(activity.bigTurns)} / Small ${formatNumber(
                  activity.smallTurns,
                )}`}
                label="Total turns"
                value={formatNumber(totalTurns)}
              />
              <SummaryCard
                detail="From staff ticket earnings"
                label="Service total"
                value={formatMoney(activity.assignedServiceAmount)}
              />
              <SummaryCard
                detail="Allocated to your staff profile"
                label="Tip"
                value={formatMoney(activity.tipAmount)}
              />
              <SummaryCard
                detail="Service total plus allocated tip"
                label="Today income"
                value={formatMoney(activity.totalEarning)}
              />
            </section>

            <section className="mt-8">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-950">
                    Today&apos;s Tickets
                  </h2>
                  <p className="text-sm text-zinc-600">
                    Only services assigned to {staff.display_name} are shown.
                  </p>
                </div>
                <p className="text-sm text-zinc-500">
                  {workTickets.length}{" "}
                  {workTickets.length === 1 ? "ticket" : "tickets"}
                </p>
              </div>

              {workTickets.length === 0 ? (
                <EmptyTickets
                  excludedTicketCount={excludedTicketCount}
                  workStatus={workStatus}
                  hasTodayActivity={hasTodayActivity}
                />
              ) : (
                <div className="space-y-3">
                  {hasTicketsWithoutEarnings ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                      Tickets are assigned to you, but earnings are not ready yet.
                    </p>
                  ) : null}
                  <StaffTicketTable tickets={workTickets} />
                </div>
              )}
            </section>
          </>
        ) : activeTab === "payroll" ? (
          payrollData ? (
            <MyPayrollTab data={payrollData} />
          ) : (
            <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              My Payroll could not load right now.
            </p>
          )
        ) : activeTab === "analysis" ? (
          analysisData ? (
            <MyAnalysisTab data={analysisData} today={today} />
          ) : (
            <p className="mt-8 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-700">
              My Analysis could not load right now.
            </p>
          )
        ) : null}
      </main>
      {showProfileSettings ? (
        <StaffProfileSettingsDrawer
          closeHref="/staff/my-work"
          salonName={context.currentSalon.name}
          staff={staff}
        />
      ) : null}
    </>
  );
}
