import { DailyPosTicketCard } from "@/app/pos-tickets/closed-ticket-correction-form";
import {
  canApplyFinancialCorrections,
  FINANCIAL_CORRECTION_PERMISSIONS,
  isDailyClosingLocked,
} from "@/lib/daily-pos-report";
import {
  getCurrentSalonPosTickets,
  getCurrentSalonPosTicketOptions,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { hasPermission } from "@/lib/permissions";
import { requireSalonManagePageContext } from "@/lib/route-context-guards";
import { getTodayDate } from "@/lib/staff-workdays";
import type { PosTicketWithRelations } from "@/types/pos-ticket";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import Link from "next/link";

type PosTicketsPageProps = {
  searchParams: Promise<{
    date?: string;
    error?: string;
    q?: string;
  }>;
};

type DateGroup = {
  dateKey: string;
  tickets: PosTicketWithRelations[];
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatDateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function parseLocalDateParts(value: string) {
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

function getLocalDateString(timeZone: string) {
  return getTodayDate(timeZone);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const getPart = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const zonedTimeAsUtc = Date.UTC(
    getPart("year"),
    getPart("month") - 1,
    getPart("day"),
    getPart("hour"),
    getPart("minute"),
    getPart("second"),
    date.getUTCMilliseconds(),
  );

  return zonedTimeAsUtc - date.getTime();
}

function getUtcInstantForLocalDateTime(
  dateString: string,
  timeZone: string,
  hour: number,
) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    throw new Error("Invalid POS work log date.");
  }

  const localTimeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour);
  const offset = getTimeZoneOffsetMs(new Date(localTimeAsUtc), timeZone);
  const firstPass = localTimeAsUtc - offset;
  const verifiedOffset = getTimeZoneOffsetMs(new Date(firstPass), timeZone);

  return new Date(localTimeAsUtc - verifiedOffset);
}

function getNextLocalDateString(dateString: string) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    throw new Error("Invalid POS work log date.");
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1))
    .toISOString()
    .slice(0, 10);
}

function getUtcBoundsForLocalDate(dateString: string, timeZone: string) {
  const start = getUtcInstantForLocalDateTime(dateString, timeZone, 0);
  const nextDate = getNextLocalDateString(dateString);
  const nextStart = getUtcInstantForLocalDateTime(nextDate, timeZone, 0);

  return {
    openedFrom: start.toISOString(),
    openedTo: new Date(nextStart.getTime() - 1).toISOString(),
  };
}

function formatLocalDateHeader(dateString: string, timeZone: string) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    return dateString;
  }

  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
    year: "numeric",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function formatLocalDateCompact(dateString: string, timeZone: string) {
  const parts = parseLocalDateParts(dateString);

  if (!parts) {
    return dateString;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    year: "numeric",
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isDateInputValue(value: string | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function getTicketFilterHref({
  date,
  q,
}: {
  date: string;
  q?: string;
}) {
  const params = new URLSearchParams({ date });

  if (q) {
    params.set("q", q);
  }

  return `/pos-tickets?${params.toString()}`;
}

function getItemDisplayTotal(item: PosTicketWithRelations["ticket_items"][number]) {
  const parts = item.turn_parts ?? [];

  if (parts.length === 0) {
    return item.line_total;
  }

  return parts.reduce((total, part) => total + part.amount, 0);
}

function buildDailyTicketNumbers(tickets: PosTicketWithRelations[]) {
  const byDate = new Map<string, PosTicketWithRelations[]>();
  const numbers = new Map<string, number>();

  for (const ticket of tickets) {
    const dateKey = formatDateKey(ticket.opened_at);
    byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), ticket]);
  }

  for (const ticketsForDate of byDate.values()) {
    ticketsForDate
      .sort(
        (left, right) =>
          new Date(left.opened_at).getTime() - new Date(right.opened_at).getTime() ||
          left.ticket_sequence - right.ticket_sequence,
      )
      .forEach((ticket, index) => numbers.set(ticket.id, index + 1));
  }

  return numbers;
}

function ticketMatchesSearch(
  ticket: PosTicketWithRelations,
  query: string,
  dailyNumber: number,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [
    String(dailyNumber),
    `#${dailyNumber}`,
    ticket.source_booking_id ? "from appointment" : "",
    ticket.source_booking_id ?? "",
    ticket.customer?.name ?? "",
    formatTime(ticket.opened_at),
    ...(ticket.ticket_items ?? []).flatMap((item) => [
      item.assigned_staff?.display_name ?? "",
      item.service?.name ?? "",
      String(getItemDisplayTotal(item)),
      formatMoney(getItemDisplayTotal(item)),
      ...(item.turn_parts ?? []).map((part) => formatMoney(part.amount)),
    ]),
  ];
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: (ticket.ticket_items ?? []).map((item) => ({
      line_total: getItemDisplayTotal(item),
    })),
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });

  searchableValues.push(String(totals.subtotal), formatMoney(totals.subtotal));

  return searchableValues.some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function filterTicketsBySearch(
  tickets: PosTicketWithRelations[],
  query: string,
  dailyNumbers: Map<string, number>,
) {
  return tickets.filter((ticket) =>
    ticketMatchesSearch(ticket, query, dailyNumbers.get(ticket.id) ?? 0),
  );
}

function groupTicketsByDate(tickets: PosTicketWithRelations[]) {
  const dateMap = new Map<string, PosTicketWithRelations[]>();

  for (const ticket of tickets) {
    const dateKey = formatDateKey(ticket.opened_at);

    dateMap.set(dateKey, [...(dateMap.get(dateKey) ?? []), ticket]);
  }

  return Array.from(dateMap.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map<DateGroup>(([dateKey, dateTickets]) => ({
      dateKey,
      tickets: [...dateTickets].sort(
        (left, right) =>
          new Date(right.opened_at).getTime() - new Date(left.opened_at).getTime() ||
          right.ticket_sequence - left.ticket_sequence,
      ),
    }));
}

function WorkLogFilters({
  query,
  selectedDate,
  todayHref,
}: {
  query: string;
  selectedDate: string;
  todayHref: string;
}) {
  return (
    <form
      action="/pos-tickets"
      method="get"
      className="mt-4 grid gap-3 border-b border-zinc-200 pb-4 sm:grid-cols-[180px_minmax(260px,1fr)_auto_auto]"
    >
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500">Date</span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={selectedDate}
          name="date"
          type="date"
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium uppercase text-zinc-500">Search</span>
        <input
          className="mt-1 h-10 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
          defaultValue={query}
          name="q"
          placeholder="Search customer, staff, service, ticket #"
          type="search"
        />
      </label>
      <button
        className="h-10 self-end rounded bg-zinc-950 px-4 text-sm font-medium text-white"
        type="submit"
      >
        Search
      </button>
      <Link
        className="inline-flex h-10 items-center self-end rounded border border-zinc-300 px-3 text-sm font-medium text-zinc-950"
        href={todayHref}
      >
        Today
      </Link>
    </form>
  );
}

function DailyWorkLog({
  canApplyFinancialCorrection,
  canEdit,
  dailyNumbers,
  groups,
  isBusinessDateLocked,
  returnTo,
  selectedDateCompactLabel,
  selectedDateLabel,
  services,
  staff,
}: {
  canApplyFinancialCorrection: boolean;
  canEdit: boolean;
  dailyNumbers: Map<string, number>;
  groups: DateGroup[];
  isBusinessDateLocked: boolean;
  returnTo: string;
  selectedDateCompactLabel: string;
  selectedDateLabel: string;
  services: Service[];
  staff: Staff[];
}) {
  if (groups.length === 0) {
    return (
      <section className="mt-6">
        <div className="mb-3 flex items-baseline justify-between border-b border-zinc-300 pb-2">
          <h2 className="text-lg font-semibold text-zinc-950">
            {selectedDateLabel}
          </h2>
        </div>
        <div className="rounded border border-dashed border-zinc-300 bg-zinc-50 p-6">
          <h2 className="text-lg font-semibold text-zinc-950">
            No POS work log for this date.
          </h2>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {groups.map((dateGroup) => (
        <section key={dateGroup.dateKey}>
          <div className="mb-3 flex items-baseline justify-between border-b border-zinc-300 pb-2">
            <h2 className="text-lg font-semibold text-zinc-950">
              {selectedDateLabel}
            </h2>
          </div>
          <div className="overflow-hidden rounded border border-zinc-200 bg-white">
            {dateGroup.tickets.map((ticket) => (
              <DailyPosTicketCard
                businessDateCompactLabel={selectedDateCompactLabel}
                canApplyFinancialCorrection={canApplyFinancialCorrection}
                canEdit={canEdit}
                dailyNumber={dailyNumbers.get(ticket.id) ?? 0}
                isBusinessDateLocked={isBusinessDateLocked}
                key={ticket.id}
                returnTo={returnTo}
                services={services}
                staff={staff}
                ticket={ticket}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default async function PosTicketsPage({
  searchParams,
}: PosTicketsPageProps) {
  const [{ date, error, q }, context] = await Promise.all([
    searchParams,
    requireSalonManagePageContext("/pos-tickets"),
  ]);

  const canViewTickets = await hasPermission(POS_TICKET_PERMISSIONS.view, context);

  if (!canViewTickets) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">
          Daily POS Work Log
        </h1>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view POS tickets.
        </p>
      </main>
    );
  }

  const timeZone = context.user.timezone;
  const selectedDate = isDateInputValue(date)
    ? date!
    : getLocalDateString(timeZone);
  const today = getLocalDateString(timeZone);
  const searchQuery = q?.trim() ?? "";
  const selectedDateLabel = formatLocalDateHeader(selectedDate, timeZone);
  const selectedDateCompactLabel = formatLocalDateCompact(selectedDate, timeZone);
  const todayHref = getTicketFilterHref({ date: today });
  const returnTo = getTicketFilterHref({ date: selectedDate, q: searchQuery });
  const [
    canManageTickets,
    canVoidTickets,
    canRequestStaffCorrection,
    canApplyFinancialCorrection,
    isSelectedDateLocked,
    { tickets },
  ] = await Promise.all([
    hasPermission(POS_TICKET_PERMISSIONS.manage, context),
    hasPermission(POS_TICKET_PERMISSIONS.void, context),
    hasPermission(FINANCIAL_CORRECTION_PERMISSIONS.request, context),
    canApplyFinancialCorrections(context),
    isDailyClosingLocked(selectedDate, context),
    getCurrentSalonPosTickets(getUtcBoundsForLocalDate(selectedDate, timeZone)),
  ]);
  const canCorrectTickets = canManageTickets || canVoidTickets;
  const canEditDailyTickets = isSelectedDateLocked
    ? canCorrectTickets || canRequestStaffCorrection || canApplyFinancialCorrection
    : canCorrectTickets;
  const ticketOptions = canEditDailyTickets
    ? await getCurrentSalonPosTicketOptions(context)
    : { services: [], staff: [] };
  const dailyNumbers = buildDailyTicketNumbers(tickets);
  const visibleTickets = filterTicketsBySearch(tickets, searchQuery, dailyNumbers);
  const groups = groupTicketsByDate(visibleTickets);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 text-zinc-950 sm:px-6">
      <div className="border-b border-zinc-200 pb-4">
        <h1 className="text-2xl font-semibold tracking-normal">
          Daily POS Work Log
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Staff income history, customer visit history, and daily salon operations.
        </p>
      </div>

      <WorkLogFilters
        query={searchQuery}
        selectedDate={selectedDate}
        todayHref={todayHref}
      />

      {error ? (
        <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <DailyWorkLog
        canApplyFinancialCorrection={canApplyFinancialCorrection}
        canEdit={canEditDailyTickets}
        dailyNumbers={dailyNumbers}
        groups={groups}
        isBusinessDateLocked={isSelectedDateLocked}
        returnTo={returnTo}
        selectedDateCompactLabel={selectedDateCompactLabel}
        selectedDateLabel={selectedDateLabel}
        services={ticketOptions.services}
        staff={ticketOptions.staff}
      />
    </main>
  );
}
