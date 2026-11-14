import type { PayrollStaffLineWithDailyTotals, StaffPayrollSetting } from "@/types/payroll";
import { moneyCents } from "@/lib/payroll-live-money";

/** Split existing final payouts for presentation; never recalculate earnings/tax. */
export function staffTakeHomeDisplay(line: PayrollStaffLineWithDailyTotals) {
  return {
    check: moneyCents(line.final_check_amount) / 100,
    cash: moneyCents(line.final_cash_amount) / 100,
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

type RowRule = {
  pay: string[]; checkRate: string; cashRate: string; taxRate: string;
  checkTax: boolean | null; cashTax: boolean | null;
  tipMethod: "Check" | "Cash"; tipTax: boolean;
};
const percent = (value: number) => `${Number(value.toFixed(2))}%`;
const distinct = (values: string[]) => [...new Set(values)];
const payoutMethod = (value: string) => value === "check" ? "Check" : "Cash";

/** Explanations only: money always comes from the calculated/saved line.
 * Never apply today's settings or multiply an aggregate by one tax rate.
 */
export function staffPayrollRowDisplay(line: PayrollStaffLineWithDailyTotals) {
  const snapshots = Array.isArray(line.settings_used_snapshot)
    ? line.settings_used_snapshot.filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s)) : [];
  const unknown = line.is_mixed_rate && !snapshots.length;
  const inputSnapshot = line.period_staff_input_snapshot && typeof line.period_staff_input_snapshot === "object"
    ? line.period_staff_input_snapshot as Record<string, unknown> : {};
  const bonusSettings = Array.isArray(inputSnapshot.bonusSettings)
    ? inputSnapshot.bonusSettings.filter((s): s is Record<string, unknown> => !!s && typeof s === "object") : [];
  const rules: RowRule[] = (snapshots.length ? snapshots : [null]).map(s => {
    const fixed = (s?.payType ?? line.pay_type_used) === "fixed";
    const checkRate = Number(s?.checkRate ?? line.check_rate_used);
    const wageTax = fixed ? (typeof s?.applyTaxToFixedPay === "boolean" ? s.applyTaxToFixedPay : null) : true;
    return {
      pay: fixed ? ["Fixed pay", new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(s?.fixedPayAmount ?? line.fixed_pay_amount_used))]
        : ["Commission", percent(Number(s?.commissionRate ?? line.commission_rate_used))],
      checkRate: percent(checkRate), cashRate: percent(100 - checkRate), taxRate: percent(Number(s?.taxRate ?? line.tax_rate_used)),
      checkTax: wageTax,
      cashTax: wageTax === false ? false : (s?.cashToTaxCompany ?? line.cash_to_tax_company_snapshot) ? wageTax : false,
      tipMethod: payoutMethod(String(s?.tipPayoutMethod ?? line.tip_payout_method_snapshot)),
      tipTax: Boolean(s?.taxTips ?? line.tax_tips_snapshot),
    };
  });
  const bonusMethods = distinct([
    ...(moneyCents(line.bonus_check_amount) !== 0 ? ["Check"] : []),
    ...(moneyCents(line.bonus_cash_amount) !== 0 ? ["Cash"] : []),
  ]);
  if (!bonusMethods.length) bonusMethods.push(...(bonusSettings.length
    ? distinct(bonusSettings.map(s => payoutMethod(String(s.bonusPayoutMethod)))) : [payoutMethod(line.bonus_payout_method_snapshot)]));
  const formula = (rule: RowRule, method: "Check" | "Cash") => {
    const taxed = method === "Check" ? rule.checkTax : rule.cashTax;
    return [method === "Check" ? rule.checkRate : rule.cashRate,
      ...(taxed === null ? ["Mixed settings"] : taxed ? ["−", "Tax", rule.taxRate] : []),
      ...(rule.tipMethod === method ? ["+", "Tip"] : []),
      ...(bonusMethods.includes(method) ? ["+", "Bonus"] : [])];
  };
  const oneFormula = (method: "Check" | "Cash") => {
    const formulas = distinct(rules.map(r => formula(r, method).join("\u0000")));
    return unknown || formulas.length !== 1 ? ["Mixed settings"] : formulas[0].split("\u0000");
  };
  const joined = (values: string[]) => distinct(values).join(" / ");
  // Bonus channel fields are gross, tip channel fields are net. Derive net
  // bonus from the final payout residual, retaining the engine's exact cents.
  const bonusNet = (moneyCents(line.final_check_amount) + moneyCents(line.final_cash_amount)
    - moneyCents(line.base_check_amount) - moneyCents(line.base_cash_amount)
    - moneyCents(line.tip_check_amount) - moneyCents(line.tip_cash_amount)) / 100;
  const tipTaxes = distinct(rules.map(r => r.tipTax ? `Tax\u0000${r.taxRate}` : "No tax"));
  // Old statements do not retain the period-end bonus tax rate. Do not borrow
  // a wage rate or today's setting to fill that gap.
  const bonusTaxes = distinct(bonusSettings.map(s => s.taxBonus ? `Tax\u0000${percent(Number(s.taxRate))}` : "No tax"));
  const wageTaxLabel = (method: "Check" | "Cash") => {
    const labels = distinct(rules.map(r => {
      const taxed = method === "Check" ? r.checkTax : r.cashTax;
      return taxed === null ? "Mixed settings" : taxed ? `Tax\u0000${r.taxRate}` : "No tax";
    }));
    return unknown || labels.length !== 1 ? ["Mixed settings"] : labels[0].split("\u0000");
  };
  return {
    wageTaxes: { check: wageTaxLabel("Check"), cash: wageTaxLabel("Cash") },
    checkFormula: oneFormula("Check"), cashFormula: oneFormula("Cash"),
    tip: {
      net: (moneyCents(line.tip_check_amount) + moneyCents(line.tip_cash_amount)) / 100,
      methods: unknown ? ["Mixed settings"] : distinct(rules.map(r => r.tipMethod)),
      tax: unknown || tipTaxes.length !== 1 ? ["Mixed settings"] : tipTaxes[0].split("\u0000"),
    },
    bonus: { net: bonusNet, methods: bonusMethods,
      tax: bonusTaxes.length > 1 ? ["Mixed settings"] : bonusTaxes.length ? bonusTaxes[0].split("\u0000") : line.tax_bonus_snapshot ? ["Tax"] : ["No tax"] },
    settings: unknown ? [["Mixed settings"]] : [
      ...distinct(rules.map(r => r.pay.join("\u0000"))).map(p => p.split("\u0000")),
      ["Cash", joined(rules.map(r => r.cashRate))], ["Check", joined(rules.map(r => r.checkRate))],
      ["Tax", joined(rules.map(r => r.taxRate))],
    ],
  };
}

export function staffPayrollPaymentRows(line: PayrollStaffLineWithDailyTotals) {
  const info = staffPayrollRowDisplay(line);
  const checkGross = moneyCents(line.check_gross);
  const cashGross = moneyCents(line.staff_commission_gross) - checkGross;
  const make = (label: string, gross: number, net: number, methods: string[], taxRule: string[], rate?: string) => ({
    label, gross: gross / 100, net: net / 100, tax: (gross - net) / 100, methods, taxRule, rate,
  });
  return [
    make("Check", checkGross, moneyCents(line.base_check_amount), ["Check"], info.wageTaxes.check, info.settings.find(s => s[0] === "Check")?.[1]),
    make("Cash", cashGross, moneyCents(line.base_cash_amount), ["Cash"], info.wageTaxes.cash, info.settings.find(s => s[0] === "Cash")?.[1]),
    make("Tip", moneyCents(line.tip_amount), moneyCents(info.tip.net), info.tip.methods, info.tip.tax),
    make("Bonus", moneyCents(line.bonus_amount), moneyCents(info.bonus.net), info.bonus.methods, info.bonus.tax),
  ];
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
