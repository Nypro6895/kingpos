import type { PayrollLiveChange } from "@/types/payroll-live-history";

export const STAFF_PAY_CHANGE_LABELS: Record<string, string> = {
  bonus_amount: "Bonus", note: "Note", service_total: "Service sales", tip_amount: "Tips", work_date: "Business date",
  pay_type: "Pay type", commission_rate: "Commission %", fixed_pay_amount: "Fixed pay", check_rate: "Check %", tax_rate: "Tax %",
  apply_tax_to_fixed_pay: "Tax fixed pay", tax_tips: "Tax tips", tax_bonus: "Tax bonus", tip_payout_method: "Tip payout",
  bonus_payout_method: "Bonus payout", cash_to_tax_company: "Cash reported", tax_company_enabled: "Tax company",
  effective_from: "Effective from", effective_to: "Effective to", cycle_type: "Pay cycle", biweekly_anchor_date: "Anchor date",
  show_check_to_tax_company: "Show check wages to Tax", show_cash_to_tax_company: "Show cash wages to Tax",
  show_tip_to_tax_company: "Show tips to Tax", show_bonus_to_tax_company: "Show bonus to Tax",
  tax_check: "Withhold from check wages", tax_cash: "Withhold from cash wages",
  check_tax_rate: "Check wage withholding rate", cash_tax_rate: "Cash wage withholding rate",
  tip_tax_rate: "Tip withholding rate", bonus_tax_rate: "Bonus withholding rate",
};
const fieldsBySource: Record<string, string[]> = {
  payroll_period_staff_inputs: ["bonus_amount", "note"],
  staff_payroll_settings: ["pay_type", "commission_rate", "fixed_pay_amount", "check_rate", "tax_rate", "apply_tax_to_fixed_pay", "tax_tips", "tax_bonus", "tip_payout_method", "bonus_payout_method", "cash_to_tax_company", "tax_company_enabled", "effective_from", "effective_to", "show_check_to_tax_company", "show_cash_to_tax_company", "show_tip_to_tax_company", "show_bonus_to_tax_company", "tax_check", "tax_cash", "check_tax_rate", "cash_tax_rate", "tip_tax_rate", "bonus_tax_rate"],
  salon_payroll_settings: ["cycle_type", "biweekly_anchor_date"],
  pos_ticket_staff_earnings: ["service_total", "tip_amount", "work_date"],
};

export function staffPayChangedFields(change: PayrollLiveChange) {
  return (fieldsBySource[change.source_table] ?? []).filter(field =>
    JSON.stringify(change.before_values[field] ?? null) !== JSON.stringify(change.after_values[field] ?? null));
}

/** History is already self-scoped by the server/RLS. Never show salon-wide Daily Report data. */
export function staffPayChanges(changes: PayrollLiveChange[], staffId?: string) {
  return changes.filter(change => change.staff_id && (!staffId || change.staff_id === staffId) && staffPayChangedFields(change).length)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}

export function staffPayChangeValue(field: string, input: unknown) {
  if (input === null || input === undefined || input === "") return "—";
  if (typeof input === "boolean") return input ? "Yes" : "No";
  if (typeof input === "number") return ["bonus_amount", "service_total", "tip_amount", "fixed_pay_amount"].includes(field)
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(input) : `${input}%`;
  return String(input);
}
