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
