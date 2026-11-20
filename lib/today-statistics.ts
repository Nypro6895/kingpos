import { calculateTicketTotals } from "./pos-ticket-calculations";

export type StatisticsTicket = {
  id: string; closed_at: string | null; status: string;
  discount_type: "fixed_amount" | "percentage"; discount_value: number;
  tax_rate: number; tip_type: "fixed_amount" | "percentage"; tip_value: number;
  payments?: { payment_method: string; amount: number }[] | null;
  ticket_items?: { is_removed?: boolean; quantity: number; line_total: number;
    service_name_snapshot?: string | null; service_category_snapshot?: string | null;
    service?: { name: string; category: string | null } | null;
    turn_parts?: { amount: number }[] | null;
  }[] | null;
};
export type ServiceMixItem = { label: string; count: number; sales: number };
export type DayStatistics = {
  checkIns: number | null; closedTickets: number | null;
  hours: { hour: number; checkIns: number | null; sales: number | null }[];
  services: ServiceMixItem[] | null;
  giftCardsSold: { count: number; amount: number } | null;
  giftCardsRedeemed: { count: number; amount: number } | null;
  promotions: { count: number; amount: number } | null;
  errors: string[];
};

export function localHour(instant: string, timeZone: string) {
  if (!Number.isFinite(Date.parse(instant))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const read = (key: string) => parts.find(p => p.type === key)?.value;
  return { date: `${read("year")}-${read("month")}-${read("day")}`, hour: Number(read("hour")) };
}

/** Read-only presentation aggregates. Never feeds Payroll, closing, or ticket writes. */
export function buildDayStatistics(input: {
  date: string; timeZone: string; now: string;
  visits: { id: string; checked_in_at: string; status: string }[] | null;
  tickets: StatisticsTicket[] | null;
  errors?: string[];
  giftFlow?: { counterSales: number; counterSalesCount: number; redeemed: number; redeemedCount: number } | null;
}): DayStatistics {
  const now = localHour(input.now, input.timeZone);
  const lastHour = now?.date === input.date ? now.hour : 23;
  const hours = Array.from({ length: lastHour + 1 }, (_, hour) => ({ hour, checkIns: input.visits ? 0 : null, sales: input.tickets ? 0 : null }));
  let checkIns = 0, closedTickets = 0, redeemedCount = 0, redeemedCents = 0, discountCount = 0, discountCents = 0;
  const seen = new Set<string>();
  for (const visit of input.visits ?? []) {
    const local = localHour(visit.checked_in_at, input.timeZone);
    if (seen.has(visit.id) || visit.status === "cancelled" || !local || local.date !== input.date || visit.checked_in_at > input.now) continue;
    seen.add(visit.id); checkIns++;
    if (hours[local.hour]) hours[local.hour].checkIns!++;
  }
  const mix = new Map<string, { count: number; cents: number }>();
  const seenTickets = new Set<string>();
  for (const ticket of input.tickets ?? []) {
    if (seenTickets.has(ticket.id) || ticket.status !== "closed" || !ticket.closed_at || ticket.closed_at > input.now) continue;
    const local = localHour(ticket.closed_at, input.timeZone);
    if (!local || local.date !== input.date) continue;
    seenTickets.add(ticket.id); closedTickets++;
    const items = (ticket.ticket_items ?? []).filter(i => !i.is_removed);
    let serviceCents = 0;
    const totals = calculateTicketTotals({ discountType: ticket.discount_type, discountValue: Number(ticket.discount_value), taxRate: Number(ticket.tax_rate), tipType: ticket.tip_type, tipValue: Number(ticket.tip_value), items: items.map(item => {
      const cents = item.turn_parts?.length ? item.turn_parts.reduce((sum, part) => sum + Math.round(Number(part.amount) * 100), 0) : Math.round(Number(item.line_total) * 100);
      serviceCents += cents;
      const label = item.service_name_snapshot?.trim() || item.service?.name?.trim() || "Other services";
      const row = mix.get(label) ?? { count: 0, cents: 0 };
      row.count += Number(item.quantity); row.cents += cents; mix.set(label, row);
      return { line_total: cents / 100 };
    }) });
    if (hours[local.hour]) hours[local.hour].sales = (hours[local.hour].sales ?? 0) + serviceCents / 100;
    const discount = Math.round(totals.discount_amount * 100);
    if (discount > 0) { discountCount++; discountCents += discount; }
    const redemption = (ticket.payments ?? []).filter(p => p.payment_method === "gift_card").reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
    if (redemption > 0) { redeemedCount++; redeemedCents += redemption; }
  }
  if (input.giftFlow?.counterSalesCount) mix.set("Gift card",{count:input.giftFlow.counterSalesCount,cents:input.giftFlow.counterSales});
  return { checkIns: input.visits ? checkIns : null, closedTickets: input.tickets ? closedTickets : null, hours: hours.map(h => ({ ...h, sales: h.sales === null ? null : Math.round(h.sales * 100) / 100 })), services: input.tickets ? [...mix].map(([label, row]) => ({ label, count: row.count, sales: row.cents / 100 })).sort((a,b) => b.count - a.count || a.label.localeCompare(b.label)) : null, giftCardsSold: input.giftFlow ? { count: input.giftFlow.counterSalesCount, amount: input.giftFlow.counterSales / 100 } : null, giftCardsRedeemed: input.giftFlow ? { count: input.giftFlow.redeemedCount, amount: input.giftFlow.redeemed / 100 } : input.tickets ? { count: redeemedCount, amount: redeemedCents / 100 } : null, promotions: input.tickets ? { count: discountCount, amount: discountCents / 100 } : null, errors: input.errors ?? [] };
}

/** Shape-preserving cubic interpolation: smooth curves without invented negative values. */
export function smoothLine(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  return points.map((point, i) => `${i ? "L" : "M"}${point.x},${point.y}`).join(" ");
}

/** Keep independently fetched operations and money series isolated. */
export function mergeDayStatistics(base: DayStatistics | null | undefined, patch: DayStatistics | null | undefined, source: "visits" | "tickets"): DayStatistics | null {
  if (!patch) return base ?? null;
  if (!base) return patch;
  const visits = source === "visits" ? patch : base, tickets = source === "tickets" ? patch : base;
  const allHours = [...new Set([...visits.hours, ...tickets.hours].map(h => h.hour))].sort((a,b)=>a-b);
  return { ...tickets, checkIns: visits.checkIns,
    hours: allHours.map(hour=>({ hour, checkIns: visits.hours.find(h=>h.hour===hour)?.checkIns ?? null, sales: tickets.hours.find(h=>h.hour===hour)?.sales ?? null })),
    errors: [...visits.errors.filter(e=>e.startsWith("Check-ins")), ...tickets.errors.filter(e=>!e.startsWith("Check-ins"))] };
}
