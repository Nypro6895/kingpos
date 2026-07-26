import {
  getPortableTicketData,
  type PortableTicketRow,
} from "@/app/pos/portable/actions";
import Link from "next/link";

type PortableTicketPageProps = {
  searchParams: Promise<{
    date?: string;
    q?: string;
  }>;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

function formatLocalDateHeader(value: string, timeZone: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "short",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function formatTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function isDateInputValue(value: string | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ");
}

function statusClass(value: string) {
  if (value === "closed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (value === "cancelled" || value === "voided") {
    return "border-zinc-200 bg-zinc-100 text-zinc-600";
  }

  return "border-orange-200 bg-orange-50 text-orange-800";
}

function buildDailyTicketNumbers(tickets: PortableTicketRow[]) {
  const numbers = new Map<string, number>();

  [...tickets]
    .sort(
      (left, right) =>
        new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime() ||
        left.ticketSequence - right.ticketSequence,
    )
    .forEach((ticket, index) => numbers.set(ticket.id, index + 1));

  return numbers;
}

function ticketMatchesSearch(
  ticket: PortableTicketRow,
  query: string,
  dailyNumber: number,
  timeZone: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [
    String(dailyNumber),
    `#${dailyNumber}`,
    ticket.ticketNumber,
    statusLabel(ticket.status),
    ticket.customerName ?? "Walk-in Customer",
    ticket.customerPhone ?? "",
    formatTime(ticket.openedAt, timeZone),
    ticket.closedAt ? formatTime(ticket.closedAt, timeZone) : "",
    `${ticket.serviceCount} services`,
    String(ticket.serviceCount),
    String(ticket.subtotal),
    formatMoney(ticket.subtotal),
    String(ticket.tipAmount),
    formatMoney(ticket.tipAmount),
    String(ticket.total),
    formatMoney(ticket.total),
    String(ticket.paid),
    formatMoney(ticket.paid),
    String(Math.max(0, ticket.remaining)),
    formatMoney(Math.max(0, ticket.remaining)),
  ];

  return searchableValues.some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function filterTicketsBySearch(
  tickets: PortableTicketRow[],
  query: string,
  dailyNumbers: Map<string, number>,
  timeZone: string,
) {
  return tickets.filter((ticket) =>
    ticketMatchesSearch(
      ticket,
      query,
      dailyNumbers.get(ticket.id) ?? 0,
      timeZone,
    ),
  );
}

function sortTicketsForWorkLog(tickets: PortableTicketRow[]) {
  return [...tickets].sort(
    (left, right) =>
      new Date(right.openedAt).getTime() - new Date(left.openedAt).getTime() ||
      right.ticketSequence - left.ticketSequence,
  );
}

function PortableWorkLogFilters({
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
      action="/pos/portable/ticket"
      className="mt-4 grid gap-3 border-b border-zinc-200 pb-4 sm:grid-cols-[180px_minmax(260px,1fr)_auto_auto]"
      method="get"
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
          placeholder="Search customer, ticket #, status, amount"
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

function PortableDailyTicketCard({
  dailyNumber,
  ticket,
  timeZone,
}: {
  dailyNumber: number;
  ticket: PortableTicketRow;
  timeZone: string;
}) {
  return (
    <article className="border-b border-zinc-200 last:border-b-0">
      <div className="grid items-center gap-2 bg-zinc-50 px-3 py-2 text-sm sm:grid-cols-[48px_80px_minmax(150px,1fr)_110px_130px_120px]">
        <span className="font-semibold text-zinc-950">#{dailyNumber}</span>
        <span className="text-zinc-700">
          {formatTime(ticket.openedAt, timeZone)}
        </span>
        <span className="min-w-0 truncate font-medium text-zinc-950">
          {ticket.customerName ?? "Walk-in Customer"}
          {ticket.customerPhone ? (
            <span className="ml-2 font-normal text-zinc-500">
              {ticket.customerPhone}
            </span>
          ) : null}
        </span>
        <span className="text-zinc-700">
          Total:{" "}
          <span className="font-semibold text-zinc-950">
            {formatMoney(ticket.subtotal)}
          </span>
        </span>
        <span className="text-zinc-700">
          After Discount:{" "}
          <span className="font-semibold text-zinc-950">
            {formatMoney(ticket.subtotal - ticket.discountAmount)}
          </span>
        </span>
        <span className="text-zinc-700">
          Tip:{" "}
          <span className="font-semibold text-zinc-950">
            {formatMoney(ticket.tipAmount)}
          </span>
        </span>
      </div>
      <div className="grid items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(120px,0.9fr)_minmax(160px,1fr)_minmax(180px,1.4fr)_110px_110px]">
        <span className="min-w-0 truncate font-semibold text-zinc-950">
          {ticket.ticketNumber}
        </span>
        <span className="min-w-0 truncate text-zinc-700">
          {ticket.serviceCount} services
        </span>
        <span className="min-w-0 truncate text-zinc-700">
          {ticket.closedAt
            ? `Closed ${formatTime(ticket.closedAt, timeZone)}`
            : "Open ticket"}
        </span>
        <span className="font-medium text-zinc-950">
          Paid {formatMoney(ticket.paid)}
        </span>
        <span className="font-medium text-zinc-950">
          Remaining {formatMoney(Math.max(0, ticket.remaining))}
        </span>
      </div>
      <div className="border-t border-zinc-100 bg-white px-3 py-2">
        <span
          className={[
            "inline-flex rounded-md border px-2 py-1 text-xs font-semibold capitalize",
            statusClass(ticket.status),
          ].join(" ")}
        >
          {statusLabel(ticket.status)}
        </span>
      </div>
    </article>
  );
}

function PortableDailyWorkLog({
  dailyNumbers,
  selectedDateLabel,
  tickets,
  timeZone,
}: {
  dailyNumbers: Map<string, number>;
  selectedDateLabel: string;
  tickets: PortableTicketRow[];
  timeZone: string;
}) {
  if (tickets.length === 0) {
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
      <section>
        <div className="mb-3 flex items-baseline justify-between border-b border-zinc-300 pb-2">
          <h2 className="text-lg font-semibold text-zinc-950">
            {selectedDateLabel}
          </h2>
        </div>
        <div className="overflow-hidden rounded border border-zinc-200 bg-white">
          {tickets.map((ticket) => (
            <PortableDailyTicketCard
              dailyNumber={dailyNumbers.get(ticket.id) ?? 0}
              key={ticket.id}
              ticket={ticket}
              timeZone={timeZone}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export default async function PortableTicketPage({
  searchParams,
}: PortableTicketPageProps) {
  const { date, q } = await searchParams;
  const selectedDate = isDateInputValue(date) ? date : undefined;
  const data = await getPortableTicketData(selectedDate);
  const searchQuery = q?.trim() ?? "";
  const selectedDateLabel = formatLocalDateHeader(data.date, data.timezone);
  const todayHref = "/pos/portable/ticket";
  const dailyNumbers = buildDailyTicketNumbers(data.tickets);
  const visibleTickets = sortTicketsForWorkLog(
    filterTicketsBySearch(
      data.tickets,
      searchQuery,
      dailyNumbers,
      data.timezone,
    ),
  );

  return (
    <section
      className="h-full overflow-auto px-4 py-6 text-zinc-950 sm:px-6"
      data-portable-pos-page="ticket"
    >
      <main className="mx-auto w-full max-w-7xl">
        <div className="border-b border-zinc-200 pb-4">
          <h1 className="text-2xl font-semibold tracking-normal">
            Daily POS Work Log
          </h1>
          <p className="mt-1 text-sm text-zinc-600">
            Staff income history, customer visit history, and daily salon operations.
          </p>
          <p className="mt-1 text-xs font-medium text-zinc-500">
            {data.salonName}
          </p>
        </div>

        <PortableWorkLogFilters
          query={searchQuery}
          selectedDate={data.date}
          todayHref={todayHref}
        />

        {data.setupMessage ? (
          <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {data.setupMessage}
          </p>
        ) : null}

        <PortableDailyWorkLog
          dailyNumbers={dailyNumbers}
          selectedDateLabel={selectedDateLabel}
          tickets={visibleTickets}
          timeZone={data.timezone}
        />
      </main>
    </section>
  );
}
