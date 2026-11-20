import type { PayrollPeriod } from "@/types/payroll";
import type { PayrollLiveChange } from "@/types/payroll-live-history";
import { payrollPeriodHref } from "@/lib/payroll-period-rail";

export type PayrollContextTab = "analytics" | "differences" | "overview" | "staff" | "shop" | "gifts" | "rewards" | "discounts" | "tax" | "settings" | "tools" | "download" | "record";
type RouteParams = { tab?: unknown; inputEvent?: unknown };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function payrollFocusedEventId(value: unknown) {
  return typeof value === "string" && uuid.test(value) ? value.toLowerCase() : undefined;
}

export function payrollRecordTab(change: PayrollLiveChange): "staff" | "shop" | "record" {
  if (["staff_day", "pos_ticket_staff_earnings", "staff_payroll_settings", "payroll_settings", "payroll_period_staff_inputs"].includes(change.source_table)) return "staff";
  if (["daily_report", "pos_daily_closings"].includes(change.source_table)) return "shop";
  return "record";
}

/** Navigation over an already-authorized read. It never changes the selected pay period. */
export function resolvePayrollContextTab(params: RouteParams, canViewAllPayroll: boolean, history: readonly PayrollLiveChange[]): PayrollContextTab {
  const focused = payrollFocusedEventId(params.inputEvent);
  if (focused) {
    const record = history.find(row => row.id.toLowerCase() === focused);
    const target = record ? payrollRecordTab(record) : "record";
    return target === "shop" && !canViewAllPayroll ? "record" : target;
  }
  if (!canViewAllPayroll) return "staff";
  if (typeof params.tab === "string" && ["staff", "shop", "gifts", "rewards", "discounts", "tax", "settings", "tools", "download"].includes(params.tab)) return params.tab as PayrollContextTab;
  // Retired overview/analytics URLs land on Shop. Exact record links above retain their target.
  return "shop";
}

function capturedTicketDate(change: PayrollLiveChange) {
  const date = change.period_start;
  if (change.source_table !== "ticket" || date !== change.period_end || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

export function payrollRecordContextHref(change: PayrollLiveChange, period: PayrollPeriod) {
  const event = payrollFocusedEventId(change.id);
  if (!event) return undefined;
  if (change.source_table === "ticket") {
    const date = capturedTicketDate(change);
    return date ? `/staff/today?${new URLSearchParams({inputEvent:event,eventDate:date})}#input-history` : undefined;
  }
  const tab = payrollRecordTab(change);
  if (tab === "record") return undefined;
  return `${payrollPeriodHref(period, tab)}&${new URLSearchParams({inputEvent:event})}#input-history`;
}
