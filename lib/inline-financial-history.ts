import type { PayrollLiveChange } from "@/types/payroll-live-history";
import { hasMeaningfulFinancialInputChange } from "@/lib/financial-change-presentation";

export type FinancialHistoryObject = {
  ticketId?: string;
  staffId?: string;
  businessDate?: string;
  sourceKinds?: readonly string[];
};

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)]));
  return value;
}

// These are captured input facts, never a reconstruction of historical net pay.
export function isInlineFinancialEdit(change: PayrollLiveChange) {
  if (change.event_action === "draft" || change.event_action === "created" || !hasMeaningfulFinancialInputChange(change)) return false;
  if (Object.keys(change.before_values??{}).length===0) return false;
  return JSON.stringify(ordered(change.before_values ?? {})) !== JSON.stringify(ordered(change.after_values ?? {}));
}

export function financialHistoryMatchesObject(change: PayrollLiveChange, object: FinancialHistoryObject) {
  if (object.sourceKinds && !object.sourceKinds.includes(change.source_table)) return false;
  if (object.ticketId && (change.ticket_id ?? (change.source_table === "ticket" ? change.source_id : undefined)) !== object.ticketId) return false;
  if (object.businessDate && !(change.period_start <= object.businessDate && change.period_end >= object.businessDate)) return false;
  if (object.staffId && change.staff_id !== object.staffId && !change.staff_projections?.some(row => row.staff_id === object.staffId)) return false;
  return true;
}

/** Filters an already-authorized read; it does not grant access to any record. */
export function financialHistoryForObject(changes: readonly PayrollLiveChange[], object: FinancialHistoryObject = {}): PayrollLiveChange[] {
  const result: PayrollLiveChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    if (!financialHistoryMatchesObject(change, object)) continue;
    const projection = object.staffId && change.staff_id !== object.staffId ? change.staff_projections?.find(row => row.staff_id === object.staffId) : undefined;
    const own = projection ? {
      ...change, staff_id: projection.staff_id, staff_snapshot: { id: projection.staff_id, displayName: projection.staff_name },
      before_values: projection.before_values, after_values: projection.after_values, staff_projections: undefined,
    } : change;
    if (!isInlineFinancialEdit(own)) continue;
    const key = `${own.id}:${own.staff_id ?? ""}`;
    if (!seen.has(key)) { seen.add(key); result.push(own); }
  }
  return result;
}
