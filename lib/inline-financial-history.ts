import type { PayrollLiveChange } from "@/types/payroll-live-history";
import { financialHistoryRecordKind,isConfirmedFinancialInputChange,periodPaymentMetadataDetails } from "@/lib/financial-change-presentation";

export type FinancialHistoryObject = {
  ticketId?: string;
  staffId?: string;
  businessDate?: string;
  sourceKinds?: readonly string[];
};

// These are captured input facts, never a reconstruction of historical net pay.
export function isInlineFinancialEdit(change: PayrollLiveChange) {
  return isConfirmedFinancialInputChange(change);
}

export function financialHistoryMatchesObject(change: PayrollLiveChange, object: FinancialHistoryObject) {
  if (object.sourceKinds && !object.sourceKinds.includes(change.source_table)) return false;
  if (object.ticketId && (change.ticket_id ?? (change.source_table === "ticket" ? change.source_id : undefined)) !== object.ticketId) return false;
  if (object.businessDate && !(change.period_start <= object.businessDate && change.period_end >= object.businessDate)) return false;
  if (object.staffId && change.staff_id !== object.staffId && !change.staff_projections?.some(row => row.staff_id === object.staffId)) return false;
  return true;
}

/** Filters an already-authorized read; it does not grant access to any record. */
function recordsForObject(changes: readonly PayrollLiveChange[], object: FinancialHistoryObject,include:(row:PayrollLiveChange)=>boolean): PayrollLiveChange[] {
  const result: PayrollLiveChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    if (!financialHistoryMatchesObject(change, object)) continue;
    const projection = object.staffId && change.staff_id !== object.staffId ? change.staff_projections?.find(row => row.staff_id === object.staffId) : undefined;
    const own = projection ? {
      ...change, staff_id: projection.staff_id, staff_snapshot: { id: projection.staff_id, displayName: projection.staff_name },
      before_values: projection.before_values, after_values: projection.after_values, staff_projections: undefined,
    } : change;
    if (!include(own)) continue;
    const key = `${own.id}:${own.staff_id ?? ""}`;
    if (!seen.has(key)) { seen.add(key); result.push(own); }
  }
  return result;
}
export function financialHistoryForObject(changes:readonly PayrollLiveChange[],object:FinancialHistoryObject={}){return recordsForObject(changes,object,isInlineFinancialEdit);}
export function financialHistoryEarlierEvidenceForObject(changes:readonly PayrollLiveChange[],object:FinancialHistoryObject={}){return recordsForObject(changes,object,row=>financialHistoryRecordKind(row)==="earlier");}
export function periodPaymentDetailsForObject(changes:readonly PayrollLiveChange[],object:FinancialHistoryObject={}){
 return recordsForObject(changes,object,row=>["change","payment-details"].includes(financialHistoryRecordKind(row))&&periodPaymentMetadataDetails(row).some(detail=>detail.comparison!=="recorded"));
}
