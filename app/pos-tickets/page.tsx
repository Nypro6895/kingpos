import { ClosedTicketCorrectionEditor } from "@/app/pos-tickets/closed-ticket-correction-form";
import { updatePosTicketNotes } from "@/app/pos-tickets/actions";
import {
  getCurrentSalonPosTickets,
  getCurrentSalonPosTicketOptions,
  POS_TICKET_PERMISSIONS,
} from "@/lib/pos-tickets";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { hasPermission } from "@/lib/permissions";
import { getTodayDate } from "@/lib/staff-workdays";
import type { PosTicketItemWithRelations } from "@/types/pos-ticket-item";
import type { Service } from "@/types/service";
import type { Staff } from "@/types/staff";
import type {
  PosTicketStatus,
  PosTicketWithRelations,
} from "@/types/pos-ticket";
import Link from "next/link";
import { redirect } from "next/navigation";

type PosTicketsPageProps = {
  searchParams: Promise<{
    date?: string;
    edit?: string;
    error?: string;
    q?: string;
  }>;
};

type StaffWorkLogGroup = {
  items: PosTicketItemWithRelations[];
  staffKey: string;
  staffName: string;
};

type DateGroup = {
  dateKey: string;
  tickets: PosTicketWithRelations[];
};

type StaffTurnSequence = {
  sequence: number;
  type: "big" | "small";
};

const STATUS_LABELS: Record<PosTicketStatus, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
  voided: "Voided",
};
const DAILY_WORK_LOG_SMALL_TURN_THRESHOLD = 25;

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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">
        Daily POS Work Log
      </h1>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function isDateInputValue(value: string | undefined) {
  return Boolean(value?.match(/^\d{4}-\d{2}-\d{2}$/));
}

function getTicketFilterHref({
  date,
  edit,
  q,
}: {
  date: string;
  edit?: string;
  q?: string;
}) {
  const params = new URLSearchParams({ date });

  if (q) {
    params.set("q", q);
  }

  if (edit) {
    params.set("edit", edit);
  }

  return `/pos-tickets?${params.toString()}`;
}

function getItemTurnType(item: PosTicketItemWithRelations): StaffTurnSequence["type"] {
  const quantity = item.quantity > 0 ? item.quantity : 1;
  const perServiceAmount =
    item.unit_price > 0 ? item.unit_price : item.line_total / quantity;

  return perServiceAmount >= DAILY_WORK_LOG_SMALL_TURN_THRESHOLD ? "big" : "small";
}

function getTurnLabel(turn: StaffTurnSequence | undefined) {
  if (!turn) {
    return "";
  }

  return turn.type === "big"
    ? `Big Turn ${turn.sequence}`
    : `Small Turn ${turn.sequence}`;
}

function groupItemsByStaff(items: PosTicketItemWithRelations[]) {
  const groups = new Map<string, StaffWorkLogGroup>();

  for (const item of items) {
    const staffName = item.assigned_staff?.display_name ?? "Unassigned";
    const key = item.assigned_staff_id ?? "unassigned";
    const group = groups.get(key);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(key, {
      items: [item],
      staffKey: key,
      staffName,
    });
  }

  return Array.from(groups.values());
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

function sortTicketsForDailySequence(tickets: PosTicketWithRelations[]) {
  return [...tickets].sort(
    (left, right) =>
      new Date(left.opened_at).getTime() - new Date(right.opened_at).getTime() ||
      left.ticket_sequence - right.ticket_sequence,
  );
}

function buildStaffTurnSequences(tickets: PosTicketWithRelations[]) {
  const counters = new Map<string, { big: number; small: number }>();
  const sequences = new Map<string, StaffTurnSequence>();

  for (const ticket of sortTicketsForDailySequence(tickets)) {
    for (const item of ticket.ticket_items ?? []) {
      const staffKey = item.assigned_staff_id ?? "unassigned";
      const turnType = getItemTurnType(item);
      const current = counters.get(staffKey) ?? { big: 0, small: 0 };
      const sequence = current[turnType] + 1;

      counters.set(staffKey, {
        ...current,
        [turnType]: sequence,
      });
      sequences.set(item.id, {
        sequence,
        type: turnType,
      });
    }
  }

  return sequences;
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
    ticket.customer?.name ?? "",
    formatTime(ticket.opened_at),
    ...(ticket.ticket_items ?? []).flatMap((item) => [
      item.assigned_staff?.display_name ?? "",
      item.service?.name ?? "",
      String(item.line_total),
      formatMoney(item.line_total),
    ]),
  ];
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: ticket.ticket_items ?? [],
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getServiceRowTipDisplay(
  item: PosTicketItemWithRelations,
  ticket: PosTicketWithRelations,
  totalTip: number,
) {
  if (totalTip === 0) {
    return formatMoney(0);
  }

  const staffId = item.assigned_staff_id;

  if (!staffId) {
    return "";
  }

  const earning = ticket.staff_earnings?.find(
    (staffEarning) => staffEarning.staff_id === staffId,
  );

  if (!earning) {
    return "";
  }

  if (earning.tip_amount === 0) {
    return formatMoney(0);
  }

  if (earning.service_total <= 0) {
    return "";
  }

  return formatMoney(roundMoney((earning.tip_amount * item.line_total) / earning.service_total));
}

function TicketWorkLogCard({
  canEdit,
  dailyNumber,
  filterHref,
  ticket,
  turnSequences,
}: {
  canEdit: boolean;
  dailyNumber: number;
  filterHref: (edit?: string) => string;
  ticket: PosTicketWithRelations;
  turnSequences: Map<string, StaffTurnSequence>;
}) {
  const items = ticket.ticket_items ?? [];
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items,
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });

  return (
    <article className="border-b border-zinc-200 last:border-b-0">
      <div className="grid items-center gap-2 bg-zinc-50 px-3 py-2 text-sm sm:grid-cols-[48px_80px_minmax(150px,1fr)_110px_150px_130px_56px]">
        <span className="font-semibold text-zinc-950">#{dailyNumber}</span>
        <span className="text-zinc-700">{formatTime(ticket.opened_at)}</span>
        <span className="min-w-0 truncate font-medium text-zinc-950">
          {ticket.customer?.name ?? "Walk-in Customer"}
        </span>
        <span className="text-zinc-700">
          Total: <span className="font-semibold text-zinc-950">{formatMoney(totals.subtotal)}</span>
        </span>
        <span className="text-zinc-700">
          After Discount:{" "}
          <span className="font-semibold text-zinc-950">
            {formatMoney(totals.taxable_amount)}
          </span>
        </span>
        <span className="text-zinc-700">
          Tip: <span className="font-semibold text-zinc-950">{formatMoney(totals.tip_amount)}</span>
        </span>
        {canEdit ? (
          <Link
            className="justify-self-start rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-950 sm:justify-self-end"
            href={filterHref(ticket.id)}
          >
            Edit
          </Link>
        ) : null}
      </div>
      <div className="divide-y divide-zinc-100">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-zinc-500">No services recorded.</div>
        ) : (
          items.map((item) => {
            const rowTip = getServiceRowTipDisplay(item, ticket, totals.tip_amount);

            return (
              <div
                className="grid gap-2 px-3 py-1.5 text-sm sm:grid-cols-[116px_minmax(140px,180px)_minmax(180px,1fr)_100px_100px]"
                key={item.id}
              >
                <span className="font-medium text-zinc-700">
                  {getTurnLabel(turnSequences.get(item.id))}
                </span>
                <span className="min-w-0 truncate font-medium text-zinc-800">
                  {item.assigned_staff?.display_name ?? "Unassigned"}
                </span>
                <span className="min-w-0 truncate text-zinc-700">
                  {item.service?.name ?? "Service"}
                </span>
                <span className="font-medium text-zinc-950">
                  {formatMoney(item.line_total)}
                </span>
                <span className="text-zinc-700">
                  {rowTip ? `Tip: ${rowTip}` : ""}
                </span>
              </div>
            );
          })
        )}
      </div>
    </article>
  );
}

function EditTicketModal({
  error,
  filterHref,
  services,
  staff,
  ticket,
  turnSequences,
}: {
  error?: string;
  filterHref: (edit?: string) => string;
  services: Service[];
  staff: Staff[];
  ticket: PosTicketWithRelations;
  turnSequences: Map<string, StaffTurnSequence>;
}) {
  const totals = calculateTicketTotals({
    discountType: ticket.discount_type,
    discountValue: ticket.discount_value,
    items: ticket.ticket_items ?? [],
    taxRate: ticket.tax_rate,
    tipType: ticket.tip_type,
    tipValue: ticket.tip_value,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-lg border border-zinc-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Edit Work Log</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {ticket.customer?.name ?? "Walk-in Customer"} ·{" "}
              {formatTime(ticket.opened_at)}
            </p>
          </div>
          <Link
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-950"
            href={filterHref()}
          >
            Close
          </Link>
        </div>

        {error ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
          <p>
            <span className="block text-zinc-500">Customer</span>
            <span className="font-medium text-zinc-950">
              {ticket.customer?.name ?? "Walk-in Customer"}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Opened</span>
            <span className="font-medium text-zinc-950">
              {formatTime(ticket.opened_at)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Status</span>
            <span className="font-medium text-zinc-950">
              {STATUS_LABELS[ticket.status]}
            </span>
          </p>
        </div>

        <div className="mt-5 border-t border-zinc-200 pt-4">
          <h3 className="text-sm font-semibold text-zinc-950">Staff and Services</h3>
          {ticket.status === "closed" ? (
            <ClosedTicketCorrectionEditor
              items={ticket.ticket_items ?? []}
              returnTo={filterHref()}
              services={services}
              staff={staff}
              ticketId={ticket.id}
              turnLabels={Object.fromEntries(
                (ticket.ticket_items ?? []).map((item) => [
                  item.id,
                  getTurnLabel(turnSequences.get(item.id)),
                ]),
              )}
            />
          ) : (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {groupItemsByStaff(ticket.ticket_items ?? []).map((group) => (
                <div className="rounded border border-zinc-200 p-3" key={group.staffKey}>
                  <p className="font-semibold text-zinc-950">{group.staffName}</p>
                  <ul className="mt-2 space-y-2">
                    {group.items.map((item) => {
                      const turnDisplay = getTurnLabel(turnSequences.get(item.id));

                      return (
                        <li className="text-sm" key={item.id}>
                          <div className="flex justify-between gap-3">
                            <span>{item.service?.name ?? "Service"}</span>
                            <span className="font-medium">
                              {formatMoney(item.line_total)}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500">{turnDisplay}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 border-t border-zinc-200 pt-4 text-sm md:grid-cols-5">
          <p>
            <span className="block text-zinc-500">Subtotal</span>
            <span className="font-medium text-zinc-950">
              {formatMoney(totals.subtotal)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Discount</span>
            <span className="font-medium text-zinc-950">
              {formatMoney(totals.discount_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">After Discount</span>
            <span className="font-medium text-zinc-950">
              {formatMoney(totals.taxable_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Tip</span>
            <span className="font-medium text-zinc-950">
              {formatMoney(totals.tip_amount)}
            </span>
          </p>
          <p>
            <span className="block text-zinc-500">Total</span>
            <span className="font-medium text-zinc-950">
              {formatMoney(totals.total)}
            </span>
          </p>
        </div>

        {ticket.status !== "closed" ? (
          <form action={updatePosTicketNotes} className="mt-5 border-t border-zinc-200 pt-4">
            <input name="ticket_id" type="hidden" value={ticket.id} />
            <label className="block text-sm font-medium text-zinc-700">
              Notes
              <textarea
                className="mt-2 min-h-24 w-full rounded border border-zinc-300 px-3 py-2 text-sm text-zinc-950"
                defaultValue={ticket.notes ?? ""}
                name="notes"
              />
            </label>
            <div className="mt-4 flex flex-wrap justify-between gap-3">
              <p className="text-xs text-zinc-500">Future audit section</p>
              <div className="flex gap-2">
                <Link
                  className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-950"
                  href={filterHref()}
                >
                  Cancel
                </Link>
                <button
                  className="rounded bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
                  type="submit"
                >
                  Save Notes
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
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
          placeholder="Customer, staff, service, ticket #, amount, or time"
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
  canEdit,
  dailyNumbers,
  filterHref,
  groups,
  selectedDateLabel,
  turnSequences,
}: {
  canEdit: boolean;
  dailyNumbers: Map<string, number>;
  filterHref: (edit?: string) => string;
  groups: DateGroup[];
  selectedDateLabel: string;
  turnSequences: Map<string, StaffTurnSequence>;
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
              <TicketWorkLogCard
                canEdit={canEdit}
                dailyNumber={dailyNumbers.get(ticket.id) ?? 0}
                filterHref={filterHref}
                key={ticket.id}
                ticket={ticket}
                turnSequences={turnSequences}
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
  const [{ date, edit, error, q }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

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
  const todayHref = getTicketFilterHref({ date: today });
  const filterHref = (editTicketId?: string) =>
    getTicketFilterHref({
      date: selectedDate,
      edit: editTicketId,
      q: searchQuery,
    });
  const [canManageTickets, canVoidTickets, { tickets }] = await Promise.all([
    hasPermission(POS_TICKET_PERMISSIONS.manage, context),
    hasPermission(POS_TICKET_PERMISSIONS.void, context),
    getCurrentSalonPosTickets(getUtcBoundsForLocalDate(selectedDate, timeZone)),
  ]);
  const canCorrectTickets = canManageTickets || canVoidTickets;
  const ticketOptions = canCorrectTickets
    ? await getCurrentSalonPosTicketOptions(context)
    : { services: [], staff: [] };
  const dailyNumbers = buildDailyTicketNumbers(tickets);
  const turnSequences = buildStaffTurnSequences(tickets);
  const visibleTickets = filterTicketsBySearch(tickets, searchQuery, dailyNumbers);
  const groups = groupTicketsByDate(visibleTickets);
  const editTicket = edit ? tickets.find((ticket) => ticket.id === edit) : null;

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

      <DailyWorkLog
        canEdit={canCorrectTickets}
        dailyNumbers={dailyNumbers}
        filterHref={filterHref}
        groups={groups}
        selectedDateLabel={selectedDateLabel}
        turnSequences={turnSequences}
      />

      {editTicket ? (
        <EditTicketModal
          error={error}
          filterHref={filterHref}
          services={ticketOptions.services}
          staff={ticketOptions.staff}
          ticket={editTicket}
          turnSequences={turnSequences}
        />
      ) : null}
    </main>
  );
}
