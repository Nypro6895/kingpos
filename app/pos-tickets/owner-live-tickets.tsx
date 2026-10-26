"use client";
import { WorkspaceText } from "@/components/workspace-language";
import { ContextualSupport } from "@/components/contextual-support";
import { TicketFilters } from "./ticket-filters";
import {useState,useEffect,useRef} from 'react';
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









function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
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

function DailyWorkLog({
  canApplyFinancialCorrection,
  canEdit,
  dailyNumbers,
  groups,
  isBusinessDateLocked,
  returnTo,
  selectedDateCompactLabel,
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
      <section className="mt-1">
        <div className="rounded border border-dashed border-zinc-300 bg-zinc-50 p-6">
          <h2 className="text-lg font-semibold text-zinc-950">
            <WorkspaceText text="No POS work log for this date." />
          </h2>
        </div>
      </section>
    );
  }

  return (
    <div className="mt-1">
      {groups.map((dateGroup) => (
        <section key={dateGroup.dateKey}>
            <div className="bg-white">
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


type Props=Omit<Parameters<typeof DailyWorkLog>[0],'groups'|'dailyNumbers'>&{selectedDate:string;snapshotAt?:number;managedRead?:boolean;salonId:string;initialTickets:PosTicketWithRelations[];bounds:{openedFrom:string;openedTo:string};searchQuery:string};
export function OwnerLiveTickets({selectedDate,snapshotAt,salonId,initialTickets,bounds,searchQuery,managedRead=false,...props}:Props){
 const [query,setQuery]=useState(searchQuery);
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
 },{enabled:!managedRead,initialReconcile:false,snapshotAt});
 const dailyNumbers=buildDailyTicketNumbers(tickets);const groups=groupTicketsByDate(filterTicketsBySearch(tickets,query,dailyNumbers));
 return <><TicketFilters title="POS Tickets" actions={<ContextualSupport />} date={selectedDate} query={query} onQueryChange={setQuery}/><DailyWorkLog {...props} returnTo={getTicketFilterHref({date:selectedDate,q:query})} groups={groups} dailyNumbers={dailyNumbers}/></>;
}
