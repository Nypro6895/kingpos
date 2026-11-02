import { calculateTicketTotals } from "./pos-ticket-calculations";
import type { DailyOverviewVisit, DailyReportOverview } from "@/types/daily-report-overview";
import type { DailyPosReport } from "@/types/pos-daily-closing";
import type { PosTicketDiscountType, PosTicketTipType } from "@/types/pos-ticket";

export type OverviewTicket = {
  id: string; ticket_number: string | null; customer_id: string | null; opened_at: string; status: string;
  discount_type: PosTicketDiscountType; discount_value: number; tax_rate: number; tip_type: PosTicketTipType; tip_value: number;
  customer: { name: string | null } | null;
  ticket_items: { id: string; service_name_snapshot: string; assigned_staff_id: string | null; line_total: number; is_removed: boolean;
    assigned_staff: { id: string; display_name: string } | null;
    turn_parts: { staff_id: string; amount: number; staff: { id: string; display_name: string } | null }[] }[];
};
export type OverviewVisit = {
  id: string; customer_id: string; checked_in_at: string; ticket_id: string | null; status: string;
  customer: { name: string | null } | null;
  requested: { sort_order: number; service: { name: string } | null }[];
};
export type OverviewWorkday = { staff_id: string; check_in_at: string | null; check_in_sequence: number | null; staff: { display_name: string } | null };

/** Link by the recorded visit/ticket relationship, never by name or phone. */
export function buildDailyReportOverview(input: { date: string; timeZone: string; tickets: OverviewTicket[]; visits: OverviewVisit[]; workdays: OverviewWorkday[]; report: DailyPosReport; notes?: string[] }): DailyReportOverview {
  const tickets = new Map(input.tickets.map(t => [t.id, t]));
  const represented = new Set<string>();
  function ticketRow(t: OverviewTicket, visit?: OverviewVisit): DailyOverviewVisit {
    represented.add(t.id);
    const items = t.ticket_items.filter(i => !i.is_removed);
    const lines = items.map(i => {
      const people = new Map<string, { id: string; name: string }>();
      if (i.assigned_staff_id) people.set(i.assigned_staff_id, { id: i.assigned_staff_id, name: i.assigned_staff?.display_name ?? "Staff" });
      for (const p of i.turn_parts ?? []) people.set(p.staff_id, { id: p.staff_id, name: p.staff?.display_name ?? "Staff" });
      return { name: i.service_name_snapshot, staff: [...people.values()], amount: i.turn_parts?.length ? i.turn_parts.reduce((n,p) => n + Number(p.amount), 0) : Number(i.line_total) };
    });
    const total = calculateTicketTotals({ items: lines.map(l => ({ line_total: l.amount })), discountType: t.discount_type, discountValue: Number(t.discount_value), taxRate: Number(t.tax_rate), tipType: t.tip_type, tipValue: Number(t.tip_value) });
    const status = t.status === "closed" ? "submitted" : t.status === "voided" ? "voided" : t.status === "cancelled" ? "cancelled" : "open";
    return { id: visit?.id ?? `ticket:${t.id}`, customerName: visit?.customer?.name ?? t.customer?.name ?? "Walk-in", checkedInAt: visit?.checked_in_at ?? null, ticketId: t.id, ticketNumber: t.ticket_number || t.id.slice(0,8), status, lines, amount: status === "submitted" ? total.total : null };
  }
  const rows: DailyOverviewVisit[] = [];
  for (const v of input.visits) {
    const t = v.ticket_id ? tickets.get(v.ticket_id) : null;
    // A multi-customer ticket is grouped once; all check-in events still count.
    if (t && represented.has(t.id)) {
      const existing = rows.find(r => r.ticketId === t.id);
      if (existing && v.customer?.name && !existing.customerName.split(" / ").includes(v.customer.name)) existing.customerName += ` / ${v.customer.name}`;
    } else if (t) rows.push(ticketRow(t, v));
    else rows.push({ id: v.id, customerName: v.customer?.name ?? "Customer", checkedInAt: v.checked_in_at, ticketId: v.ticket_id, ticketNumber: null, status: v.status === "cancelled" ? "cancelled" : "checked_in", lines: [...v.requested].sort((a,b) => a.sort_order-b.sort_order).map(r => ({ name: r.service?.name ?? "Service", staff: [], amount: null })), amount: null });
  }
  for (const t of input.tickets) if (!represented.has(t.id)) rows.push(ticketRow(t));
  const byStaff = new Map(input.workdays.map(w => [w.staff_id, { id: w.staff_id, name: w.staff?.display_name ?? "Staff", checkedInAt: w.check_in_at, sequence: w.check_in_sequence, turns: 0, posAmount: 0 }]));
  for (const r of input.report.staffRows) {
    const w = byStaff.get(r.staffId);
    byStaff.set(r.staffId, { id: r.staffId, name: r.staffName, checkedInAt: w?.checkedInAt ?? null, sequence: w?.sequence ?? null, turns: r.totalTurns, posAmount: r.totalEarned });
  }
  return { date: input.date, timeZone: input.timeZone, updatedAt: new Date().toISOString(), staff: [...byStaff.values()].sort((a,b) => (a.sequence ?? Infinity)-(b.sequence ?? Infinity) || (a.checkedInAt ?? "z").localeCompare(b.checkedInAt ?? "z") || a.name.localeCompare(b.name)), visits: rows.sort((a,b) => (b.checkedInAt ?? "").localeCompare(a.checkedInAt ?? "")), checkInCount: input.visits.length, submittedCount: new Set(input.tickets.filter(t => t.status === "closed").map(t => t.id)).size, notes: input.notes ?? [] };
}
