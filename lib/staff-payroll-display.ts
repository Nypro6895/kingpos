import type { PayrollStaffLineWithDailyTotals, StaffPayrollSetting } from "@/types/payroll";
import { moneyCents } from "@/lib/payroll-live-money";

/** Split existing final payouts for presentation; never recalculate earnings/tax. */
export function staffTakeHomeDisplay(line: PayrollStaffLineWithDailyTotals) {
  return {
    check: (moneyCents(line.final_check_amount) - moneyCents(line.tip_check_amount)) / 100,
    cash: (moneyCents(line.final_cash_amount) - moneyCents(line.tip_cash_amount)) / 100,
    tip: (moneyCents(line.tip_check_amount) + moneyCents(line.tip_cash_amount)) / 100,
    net: line.final_staff_income,
  };
}

export function staffCompactSettings(line: PayrollStaffLineWithDailyTotals) {
  const snapshots = Array.isArray(line.settings_used_snapshot) ? line.settings_used_snapshot.filter((value): value is Record<string, unknown> => !!value && typeof value === "object") : [];
  const unique = (values: string[]) => [...new Set(values)];
  const percent = (n: unknown) => `${Number(Number(n ?? 0).toFixed(2))}%`;
  // A mixed period must not be described using a synthetic 0% or today's settings.
  if (!snapshots.length && line.is_mixed_rate) return { pay: ["Mixed"], cash: ["Mixed"], tax: ["Mixed"], tip: ["Mixed"], fixed: false };
  return {
    pay: unique(snapshots.length ? snapshots.map(s => s.payType === "fixed" ? `$${Number(s.fixedPayAmount ?? 0).toFixed(2)}` : percent(s.commissionRate)) : [line.pay_type_used === "fixed" ? `$${line.fixed_pay_amount_used.toFixed(2)}` : percent(line.commission_rate_used)]),
    cash: unique(snapshots.length ? snapshots.map(s => percent(100 - Number(s.checkRate ?? 0))) : [percent(100 - line.check_rate_used)]),
    tax: unique(snapshots.length ? snapshots.map(s => percent(s.taxRate)) : [percent(line.tax_rate_used)]),
    tip: unique(snapshots.length ? snapshots.map(s => s.tipPayoutMethod === "check" ? "Check" : "Cash") : [line.tip_payout_method_snapshot === "check" ? "Check" : "Cash"]),
    fixed: line.pay_type_used === "fixed",
  };
}

export type StaffPayRule = { commission: number | null; fixed: number | null; tax: number; tipsTax: boolean; bonusTax: boolean; fixedTax: boolean; from: string | null; to: string | null };

export function staffPayRules(line: PayrollStaffLineWithDailyTotals | null, settings: StaffPayrollSetting[]): StaffPayRule[] {
  // Saved statements must describe their saved settings, not today's owner settings.
  const snapshots = Array.isArray(line?.settings_used_snapshot) ? line.settings_used_snapshot : [];
  const rules: StaffPayRule[] = snapshots.filter((value): value is Record<string, unknown> => !!value && typeof value === "object").map(value => ({
    commission: value.payType === "fixed" ? null : Number(value.commissionRate ?? 0),
    fixed: value.payType === "fixed" ? Number(value.fixedPayAmount ?? 0) : null,
    tax: Number(value.taxRate ?? 0), tipsTax: value.taxTips === true, bonusTax: line?.tax_bonus_snapshot ?? value.taxBonus === true,
    fixedTax: value.applyTaxToFixedPay === true, from: typeof value.effectiveFrom === "string" ? value.effectiveFrom : null,
    to: typeof value.effectiveTo === "string" ? value.effectiveTo : null,
  }));
  if (!rules.length && line?.is_mixed_rate) return [];
  if (!rules.length && line) rules.push({ commission: line.pay_type_used === "commission" ? line.commission_rate_used : null, fixed: line.pay_type_used === "fixed" ? line.fixed_pay_amount_used : null, tax: line.tax_rate_used, tipsTax: line.tax_tips_snapshot, bonusTax: line.tax_bonus_snapshot, fixedTax: true, from: null, to: null });
  if (!rules.length) rules.push(...settings.map(s => ({ commission: s.pay_type === "commission" ? s.commission_rate : null, fixed: s.pay_type === "fixed" ? s.fixed_pay_amount : null, tax: s.tax_rate, tipsTax: s.tax_tips, bonusTax: s.tax_bonus, fixedTax: s.apply_tax_to_fixed_pay, from: s.effective_from, to: s.effective_to })));
  return [...new Map(rules.map(rule => [JSON.stringify(rule), rule])).values()].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
}
