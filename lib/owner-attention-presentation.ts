import { describeFinancialInputChange, capturedFinancialRecordFacts } from "@/lib/financial-change-presentation";
import type { OwnerAttentionItem } from "@/types/owner-financial-attention";
import type { PayrollLiveChange } from "@/types/payroll-live-history";

export const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const asRows = (value: unknown) => Array.isArray(value) ? value.map(asObject) : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const attentionMoney = (value: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number(value));
export function attentionTicketAmounts(value: unknown) {
  const facts = asObject(value);
  const service = number(facts.service_total), discount = number(facts.discount_amount), tip = number(facts.tip_amount);
  const total = round(round((service - discount) * (1 + number(facts.tax_rate) / 100)) + tip);
  const paid = round(number(facts.recorded_payment_total));
  return { service, discount, tip, total, paid, remaining: round(total - paid) };
}
export function attentionChangeDetails(item: OwnerAttentionItem) {
  const facts = item.facts ?? {};
  const before = asObject(facts.before), after = asObject(facts.after);
  const record: PayrollLiveChange = {
    id: String(facts.eventId ?? item.item_key), salon_id: "", staff_id: null, source_table: "ticket", source_id: String(facts.ticketId ?? ""),
    period_start: item.business_date, period_end: item.business_date, before_values: before, after_values: after,
    actor_id: null, created_at: item.occurred_at, actor_name: String(facts.actor ?? "Unknown operator"),
    event_action: Object.keys(before).length ? "updated" : "created",
  };
  if (!Object.keys(before).length) return capturedFinancialRecordFacts(record);
  const description = describeFinancialInputChange(record);
  return [...description.details, ...description.groups.flatMap(group => group.details.map(detail => ({ ...detail, label: `${group.title} · ${detail.label}` })))];
}

export function attentionPresentation(item: OwnerAttentionItem) {
  const facts = item.facts ?? {}, before = asObject(facts.before), after = asObject(facts.after);
  const ticket = item.kind === "discount" || item.kind === "ticket_change";
  const edited = ticket && (facts.eventAction === "updated" || (facts.eventAction !== "created" && Object.keys(before).length > 0));
  const rawChanges = edited ? attentionChangeDetails(item).filter(row => row.before !== row.after) : [];
  const changes = rawChanges.filter(row => !(row.label === "Ticket payments" && rawChanges.some(other=>other.label.startsWith("Ticket payment changes ·"))));
  if (edited && [before,after].every(values=>["service_total","discount_amount","tax_rate","tip_amount"].every(key=>values[key] !== null && values[key] !== undefined))) {
    const oldTotal = attentionTicketAmounts(before).total, newTotal = attentionTicketAmounts(after).total;
    if (oldTotal !== newTotal) changes.push({label:"Ticket total",before:attentionMoney(oldTotal),after:attentionMoney(newTotal)});
  }
  changes.sort((a,b)=>priority(a.label)-priority(b.label));
  const rawNumber = String(after.ticket_number ?? before.ticket_number ?? item.label.match(/\bT\d+\b/)?.[0] ?? "Unknown");
  const title = ticket ? `${edited ? changes.some(row=>/discount/i.test(row.label)) ? "Discount edited" : "Ticket edited" : "Discount"} · Ticket ${rawNumber.replace(/^T0+(?=\d)/,"T")}` : item.label;
  const lines = asRows(after.lines);
  return { ticket, edited, title, changes, after, created: facts.eventAction === "created",
    actor: String(facts.actor || "Unknown operator"), source: String(facts.source || "Unknown"), customer: String(facts.customerName || after.customer_name || "Not recorded"),
    primary: !ticket ? item.detail : edited ? changes[0] ? changeText(changes[0]) + (changes.length>1 ? ` · +${changes.length-1} changes` : "") : "Earlier values not recorded" : `Discount: −${attentionMoney(after.discount_amount)}`,
    service: lines[0] ? `${String(lines[0].service_name ?? "Service")} · ${attentionMoney(lines[0].service_total)} · Staff: ${String(lines[0].staff_name ?? "Unassigned")}${lines.length>1 ? ` · +${lines.length-1} services` : ""}` : "Services not recorded",
  };
}
function priority(label: string) { return /discount/i.test(label) ? 0 : label === "Ticket total" ? 0.5 : /staff/i.test(label) ? 2 : /service|price|amount/i.test(label) ? 1 : 3; }
export function changeText(row: ReturnType<typeof attentionChangeDetails>[number]) {
  return row.comparison === "recorded" ? `Recorded ${row.label}: ${row.recordedSide === "before" ? row.before : row.after}` : `${row.label}: ${row.before} → ${row.after}`;
}
export function attentionTime(item: OwnerAttentionItem, timezone: string, today: string) {
  const date = new Date(item.occurred_at);
  const parts = new Intl.DateTimeFormat("en-US", {year:"numeric",month:"2-digit",day:"2-digit",timeZone:timezone}).formatToParts(date);
  const localDate = ["year","month","day"].map(key=>parts.find(part=>part.type===key)?.value).join("-");
  return `${localDate === today ? "Today" : new Intl.DateTimeFormat("en-US", {month:"short",day:"numeric",year:"numeric",timeZone:timezone}).format(date)}, ${new Intl.DateTimeFormat("en-US", {hour:"numeric",minute:"2-digit",timeZone:timezone}).format(date)}`;
}
