import {
  correctPortableClosedPosTicketInline,
  getPortableTicketData,
  type PortableTicketItemRow,
  type PortableTicketRow,
} from "@/app/pos/portable/actions";
import {
  DailyPosTicketCard,
  type EditablePosTicket,
} from "@/app/pos-tickets/closed-ticket-correction-form";
import Link from "next/link";

type PortableTicketPageProps = {
  searchParams: Promise<{
    date?: string;
    error?: string;
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

function formatLocalDateCompact(value: string, timeZone: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
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

function getPortableTicketFilterHref({
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

  return `/pos/portable/ticket?${params.toString()}`;
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ");
}

function turnSearchText(item: PortableTicketItemRow) {
  return `${item.runningTurnBig ?? "-"} | ${item.runningTurnSmall ?? "-"}`;
}

function itemLineTotal(item: PortableTicketItemRow) {
  if (item.turnParts.length === 0) {
    return item.lineTotal;
  }

  return item.turnParts.reduce((total, part) => total + part.amount, 0);
}

function normalizeServiceLookupName(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function resolvePortableTicketServiceId(
  item: PortableTicketItemRow,
  services: Array<{ id: string; name: string }>,
) {
  if (item.serviceId) {
    return item.serviceId;
  }

  const serviceName = normalizeServiceLookupName(item.serviceName);

  if (!serviceName || serviceName === "service") {
    return null;
  }

  return (
    services.find(
      (service) => normalizeServiceLookupName(service.name) === serviceName,
    )?.id ?? null
  );
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

function toEditableTicket(
  ticket: PortableTicketRow,
  services: Array<{ id: string; name: string }>,
): EditablePosTicket {
  return {
    adjustments: ticket.adjustments.map((adjustment) => ({
      action: adjustment.action,
      after_snapshot: adjustment.afterSnapshot,
      before_snapshot: adjustment.beforeSnapshot,
      created_at: adjustment.createdAt,
      created_by: adjustment.createdBy,
      created_by_user: adjustment.createdByUser
        ? {
            display_name: adjustment.createdByUser.displayName,
            email: adjustment.createdByUser.email,
            id: adjustment.createdByUser.id,
          }
        : null,
      id: adjustment.id,
      reason: adjustment.reason,
      ticket_id: adjustment.ticketId,
    })),
    customer: ticket.customerName
      ? {
          email: ticket.customerEmail,
          id: ticket.customerId ?? ticket.id,
          name: ticket.customerName,
          phone: ticket.customerPhone,
        }
      : null,
    discount_type: ticket.discountType,
    discount_value: ticket.discountValue,
    id: ticket.id,
    opened_at: ticket.openedAt,
    source_booking_id: ticket.sourceBookingId,
    staff_earnings: ticket.staffEarnings.map((earning) => ({
      manual_tip_amount: earning.manualTipAmount,
      staff_id: earning.staffId,
      tip_amount: earning.tipAmount,
      tip_is_manual: earning.tipIsManual,
    })),
    status: ticket.status,
    tax_rate: ticket.taxRate,
    ticket_items: ticket.items.map((item) => {
      const serviceId = resolvePortableTicketServiceId(item, services);
      const serviceName =
        item.serviceName ||
        services.find((service) => service.id === serviceId)?.name ||
        "Service";

      return {
        assigned_staff: item.staffId
          ? {
              display_name: item.staffName ?? "Select staff",
              id: item.staffId,
              job_title: null,
            }
          : null,
        assigned_staff_id: item.staffId,
        created_at: item.createdAt,
        id: item.id,
        line_total: itemLineTotal(item),
        running_turns: {
          big: item.runningTurnBig,
          small: item.runningTurnSmall,
        },
        service: serviceId
          ? {
              id: serviceId,
              name: serviceName,
            }
          : null,
        service_id: serviceId,
        turn_parts: item.turnParts.map((part) => ({
          amount: part.amount,
          created_at: part.createdAt,
          id: part.id,
          staff_id: part.staffId ?? undefined,
          ticket_id: part.ticketId,
          ticket_item_id: part.ticketItemId,
          turn_index: part.turnIndex,
          turn_type: part.turnType,
          work_date: part.workDate,
        })),
      };
    }),
    tip_type: ticket.tipType,
    tip_value: ticket.tipValue,
  };
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
    String(ticket.serviceCount),
    ...ticket.items.flatMap((item) => [
      item.staffName ?? "",
      item.serviceName,
      turnSearchText(item),
      String(item.runningTurnBig ?? ""),
      String(item.runningTurnSmall ?? ""),
      String(itemLineTotal(item)),
      formatMoney(itemLineTotal(item)),
      ...item.turnParts.flatMap((part) => [
        part.turnType,
        String(part.amount),
        formatMoney(part.amount),
      ]),
    ]),
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

function PortableDailyWorkLog({
  canEdit,
  dailyNumbers,
  isBusinessDateLocked,
  returnTo,
  selectedDateCompactLabel,
  selectedDateLabel,
  services,
  staff,
  tickets,
  timeZone,
}: {
  canEdit: boolean;
  dailyNumbers: Map<string, number>;
  isBusinessDateLocked: boolean;
  returnTo: string;
  selectedDateCompactLabel: string;
  selectedDateLabel: string;
  services: Array<{ id: string; name: string }>;
  staff: Array<{ display_name: string; id: string }>;
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
            <DailyPosTicketCard
              actions={{
                correctClosedTicket: correctPortableClosedPosTicketInline,
              }}
              businessDateCompactLabel={selectedDateCompactLabel}
              canApplyFinancialCorrection={false}
              canEdit={canEdit && !isBusinessDateLocked}
              dailyNumber={dailyNumbers.get(ticket.id) ?? 0}
              isBusinessDateLocked={isBusinessDateLocked}
              key={ticket.id}
              requireServiceForActiveLines={false}
              returnTo={returnTo}
              services={services}
              staff={staff}
              ticket={toEditableTicket(ticket, services)}
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
  const { date, error, q } = await searchParams;
  const selectedDate = isDateInputValue(date) ? date : undefined;
  const data = await getPortableTicketData(selectedDate);
  const searchQuery = q?.trim() ?? "";
  const selectedDateLabel = formatLocalDateHeader(data.date, data.timezone);
  const selectedDateCompactLabel = formatLocalDateCompact(
    data.date,
    data.timezone,
  );
  const todayHref = "/pos/portable/ticket";
  const returnTo = getPortableTicketFilterHref({
    date: data.date,
    q: searchQuery,
  });
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

        {error ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <PortableDailyWorkLog
          canEdit={data.canEdit}
          dailyNumbers={dailyNumbers}
          isBusinessDateLocked={data.isBusinessDateLocked}
          returnTo={returnTo}
          selectedDateCompactLabel={selectedDateCompactLabel}
          selectedDateLabel={selectedDateLabel}
          services={data.services}
          staff={data.staff}
          tickets={visibleTickets}
          timeZone={data.timezone}
        />
      </main>
    </section>
  );
}
