import type { PayrollLiveChange } from "@/types/payroll-live-history";

export function payrollHistoryStaffLabel(change: PayrollLiveChange, staffNames: Record<string, string>): string {
  if (change.staff_id && staffNames[change.staff_id]) return staffNames[change.staff_id];
  const original = change.staff_snapshot;
  if (!original) return "";
  return original.displayName ? `${original.displayName} (${original.id})` : original.id;
}
