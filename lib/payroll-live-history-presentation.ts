import type { PayrollLiveChange } from "@/types/payroll-live-history";

/** One event is shared across pages; a Staff card shows only its own inputs. */
export function payrollHistoryForStaff(changes:PayrollLiveChange[],staffId:string):PayrollLiveChange[]{
 return changes.flatMap(change=>{
  if(change.staff_id===staffId)return [change];
  const projection=change.staff_projections?.find(row=>row.staff_id===staffId);
  return projection?[{...change,staff_id:staffId,staff_snapshot:{id:staffId,displayName:projection.staff_name},before_values:projection.before_values,after_values:projection.after_values}]:[];
 });
}

export function payrollHistoryStaffLabel(change: PayrollLiveChange, staffNames: Record<string, string>): string {
  return (change.staff_id && staffNames[change.staff_id]) || change.staff_snapshot?.displayName || "Staff";
}
