"use client";
import Form from "next/form";
import {useState,useEffect,useRef} from 'react';import Link from 'next/link';
import {usePosResourceRefresh} from '@/lib/pos-workspace-sync';
import {DailyPosTicketCard} from './closed-ticket-correction-form';
import {calculateTicketTotals} from '@/lib/pos-ticket-calculations';
import {searchTextMatches} from '@/lib/search-normalization';
import type {PosTicketWithRelations} from '@/types/pos-ticket';import type {Staff} from '@/types/staff';import type {Service} from '@/types/service';
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
  return new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date());
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

  return searchTextMatches(searchableValues, query);
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
    <Form
      action="/pos-tickets"
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
    </Form>
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


type Props=Omit<Parameters<typeof DailyWorkLog>[0],'groups'|'dailyNumbers'>&{snapshotAt?:number;salonId:string;initialTickets:PosTicketWithRelations[];bounds:{openedFrom:string;openedTo:string};searchQuery:string};
export function OwnerLiveTickets({snapshotAt,salonId,initialTickets,bounds,searchQuery,...props}:Props){
 const [live,setLive]=useState<{base:PosTicketWithRelations[];tickets:PosTicketWithRelations[]}|null>(null);
 const tickets=live?.base===initialTickets?live.tickets:initialTickets;
 const generation=useRef(0);
 useEffect(()=>{generation.current++;},[initialTickets]);
 usePosResourceRefresh(salonId,'tickets',async ids=>{
   const snapshotGeneration=generation.current;
   const query=new URLSearchParams(bounds);if(ids?.length)query.set('ids',ids.join(','));
   const response=await fetch('/api/pos/owner/tickets?'+query.toString(),{cache:'no-store',signal:AbortSignal.timeout(10000)});
   if(!response.ok)return;const next=await response.json();if(next.salonId!==salonId||snapshotGeneration!==generation.current)return;
   setLive(previous=>{
     const current=previous?.base===initialTickets?previous.tickets:initialTickets;
     return {base:initialTickets,tickets:(ids?.length?[...current.filter(t=>!ids.includes(t.id)),...next.tickets]:next.tickets).sort((a:PosTicketWithRelations,b:PosTicketWithRelations)=>b.opened_at.localeCompare(a.opened_at))};
   });
 },{initialReconcile:false,snapshotAt});
 const dailyNumbers=buildDailyTicketNumbers(tickets);const groups=groupTicketsByDate(filterTicketsBySearch(tickets,searchQuery,dailyNumbers));
 return <DailyWorkLog {...props} groups={groups} dailyNumbers={dailyNumbers}/>;
}
