import type { PayrollPayoutMethod, PayrollTaxComponent, PayrollTaxReportingSnapshot, StaffPayrollSetting } from "@/types/payroll";

export const payrollTaxSettingFields = [
  "show_check_to_tax_company", "show_cash_to_tax_company", "show_tip_to_tax_company", "show_bonus_to_tax_company",
  "tax_check", "tax_cash", "check_tax_rate", "cash_tax_rate", "tip_tax_rate", "bonus_tax_rate",
] as const;
export const payrollTaxComponentKeys = ["check_wage", "cash_wage", "tip", "bonus"] as const;
export type PayrollItemTaxSettings = Partial<Pick<StaffPayrollSetting, typeof payrollTaxSettingFields[number]>>;
export function payrollTaxSettingsFromForm(form: FormData): PayrollItemTaxSettings {
  return Object.fromEntries(payrollTaxSettingFields.filter(field => form.has(field)).map(field => {
    const value = String(form.get(field) ?? "").trim();
    if (!value) return [field, null];
    if (field.endsWith("_rate")) return [field, Number(value)];
    if (value !== "true" && value !== "false") throw new Error("Choose Show and Apply tax separately for each payroll item.");
    return [field, value === "true"];
  })) as PayrollItemTaxSettings;
}
const amountFields = ["gross", "tax", "net", "check_gross", "check_tax", "check_net", "cash_gross", "cash_tax", "cash_net"] as const;
const cents = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100);
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** NULL preserves the old rule. Visibility never decides whether tax is withheld. */
export function resolvePayrollTaxSettings(setting: Partial<StaffPayrollSetting>) {
  const wageEligible = setting.pay_type !== "fixed" || Boolean(setting.apply_tax_to_fixed_pay);
  const defaultRate = Number(setting.tax_rate ?? 0);
  return {
    check_wage: { shown: setting.show_check_to_tax_company ?? wageEligible, applied: setting.tax_check ?? wageEligible, rate: setting.check_tax_rate ?? defaultRate },
    cash_wage: { shown: setting.show_cash_to_tax_company ?? (Boolean(setting.cash_to_tax_company) && wageEligible), applied: setting.tax_cash ?? (Boolean(setting.cash_to_tax_company) && wageEligible), rate: setting.cash_tax_rate ?? defaultRate },
    tip: { shown: setting.show_tip_to_tax_company ?? Boolean(setting.tax_tips), applied: Boolean(setting.tax_tips), rate: setting.tip_tax_rate ?? defaultRate },
    bonus: { shown: setting.show_bonus_to_tax_company ?? Boolean(setting.tax_bonus), applied: Boolean(setting.tax_bonus), rate: setting.bonus_tax_rate ?? defaultRate },
  };
}

function component(gross: number, tax: number, rule: { shown: boolean; applied: boolean; rate: number }, method: PayrollPayoutMethod): PayrollTaxComponent {
  gross = money(gross); tax = money(tax);
  const net = (cents(gross) - cents(tax)) / 100;
  return { shown: rule.shown, gross, tax_applied: rule.applied, tax_rate: rule.rate, tax, net, payout_method: method,
    check_gross: method === "check" ? gross : 0, check_tax: method === "check" ? tax : 0, check_net: method === "check" ? net : 0,
    cash_gross: method === "cash" ? gross : 0, cash_tax: method === "cash" ? tax : 0, cash_net: method === "cash" ? net : 0 };
}

export function payrollTaxSnapshotFromComponents(components: PayrollTaxReportingSnapshot["components"]): PayrollTaxReportingSnapshot {
  const totals = Object.fromEntries(amountFields.map(field => [field, payrollTaxComponentKeys.reduce((sum, key) => sum + cents(components[key][field]), 0) / 100])) as PayrollTaxReportingSnapshot["totals"];
  return { version: 1, components, totals };
}

export function payrollTaxSnapshotOnlyComponent(snapshot: PayrollTaxReportingSnapshot, selected: typeof payrollTaxComponentKeys[number]) {
  return payrollTaxSnapshotFromComponents(Object.fromEntries(payrollTaxComponentKeys.map(key => [key, key === selected ? snapshot.components[key] : {
    ...snapshot.components[key], ...Object.fromEntries(amountFields.map(field => [field, 0])),
  }])) as PayrollTaxReportingSnapshot["components"]);
}

export function calculatePayrollTaxSnapshot(setting: Partial<StaffPayrollSetting>, checkGross: number, cashGross: number, tip: number, bonus = 0): PayrollTaxReportingSnapshot {
  const rules = resolvePayrollTaxSettings(setting);
  const tax = (gross: number, key: typeof payrollTaxComponentKeys[number]) => rules[key].applied ? money(gross * rules[key].rate / 100) : 0;
  let checkTax = tax(checkGross, "check_wage"), cashTax = tax(cashGross, "cash_wage"), tipTax = tax(tip, "tip");
  // Preserve the established aggregate/residual cent allocation when only Show
  // changes. Explicit item tax overrides opt into independent item calculation.
  const legacyTax = setting.tax_check == null && setting.tax_cash == null && setting.check_tax_rate == null && setting.cash_tax_rate == null && setting.tip_tax_rate == null && setting.bonus_tax_rate == null;
  if (legacyTax) {
    const rate = Number(setting.tax_rate ?? 0);
    const eligible = setting.pay_type !== "fixed" || Boolean(setting.apply_tax_to_fixed_pay);
    const wageGross = eligible ? (setting.cash_to_tax_company ? money(checkGross + cashGross) : checkGross) : 0;
    const wageTax = money(wageGross * rate / 100);
    checkTax = eligible ? money(checkGross * rate / 100) : 0;
    cashTax = money(wageTax - checkTax);
    tipTax = setting.tax_tips ? money(money(money(wageGross + tip) * rate / 100) - wageTax) : 0;
  }
  return payrollTaxSnapshotFromComponents({
    check_wage: component(checkGross, checkTax, rules.check_wage, "check"),
    cash_wage: component(cashGross, cashTax, rules.cash_wage, "cash"),
    tip: component(tip, tipTax, rules.tip, setting.tip_payout_method === "check" ? "check" : "cash"),
    bonus: component(bonus, tax(bonus, "bonus"), rules.bonus, setting.bonus_payout_method === "cash" ? "cash" : "check"),
  });
}

/** All nonzero contributors must permit sharing. Mixed rates stay unknown. */
export function mergePayrollTaxSnapshots(snapshots: PayrollTaxReportingSnapshot[]): PayrollTaxReportingSnapshot {
  const empty = calculatePayrollTaxSnapshot({}, 0, 0, 0);
  const components = Object.fromEntries(payrollTaxComponentKeys.map(key => {
    const all = snapshots.map(snapshot => snapshot.components[key]);
    const contributing = all.filter(item => item.gross !== 0 || item.tax !== 0 || item.net !== 0);
    const rows = contributing.length ? contributing : all.length ? all.slice(-1) : [empty.components[key]];
    const first = rows[0] ?? empty.components[key];
    const value = { ...first };
    for (const field of amountFields) value[field] = all.reduce((sum, item) => sum + cents(item[field]), 0) / 100;
    value.shown = rows.every(item => item.shown);
    value.tax_applied = rows.every(item => item.tax_applied === first.tax_applied) ? first.tax_applied : null;
    value.tax_rate = rows.every(item => item.tax_rate === first.tax_rate) ? first.tax_rate : null;
    value.payout_method = rows.every(item => item.payout_method === first.payout_method) ? first.payout_method : "mixed";
    return [key, value];
  })) as PayrollTaxReportingSnapshot["components"];
  return payrollTaxSnapshotFromComponents(components);
}

export function payrollTaxReportedAmounts(snapshot: PayrollTaxReportingSnapshot) {
  const rows = Object.values(snapshot.components).filter(item => item.shown);
  const wages = [snapshot.components.check_wage, snapshot.components.cash_wage].filter(item => item.shown);
  return { wage: wages.reduce((sum, item) => sum + cents(item.gross), 0) / 100,
    gross: rows.reduce((sum, item) => sum + cents(item.gross), 0) / 100,
    cash: rows.reduce((sum, item) => sum + cents(item.cash_gross), 0) / 100 };
}
