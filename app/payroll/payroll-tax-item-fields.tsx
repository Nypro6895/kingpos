"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { resolvePayrollTaxSettings, type PayrollItemTaxSettings } from "@/lib/payroll-tax-settings";
import type { StaffPayrollSetting } from "@/types/payroll";

const items = [
  { key: "check_wage", label: "Check wages", show: "show_check_to_tax_company", apply: "tax_check", rate: "check_tax_rate" },
  { key: "cash_wage", label: "Cash wages", show: "show_cash_to_tax_company", apply: "tax_cash", rate: "cash_tax_rate" },
  { key: "tip", label: "Tip", show: "show_tip_to_tax_company", apply: "tax_tips", rate: "tip_tax_rate" },
  { key: "bonus", label: "Bonus", show: "show_bonus_to_tax_company", apply: "tax_bonus", rate: "bonus_tax_rate" },
] as const;

/** Nullable untouched controls preserve legacy rules when another field is saved. */
export function PayrollTaxItemFields({ setting }: { setting: Partial<StaffPayrollSetting> | null }) {
  const translate = useWorkspaceTranslation();
  const [overrides, setOverrides] = useState<PayrollItemTaxSettings>(() => Object.fromEntries(items.flatMap(item => [item.show, item.rate, ...(item.apply === "tax_check" || item.apply === "tax_cash" ? [item.apply] : [])]).map(field => [field, setting?.[field as keyof StaffPayrollSetting] ?? null])));
  const [tips, setTips] = useState(Boolean(setting?.tax_tips));
  const [bonus, setBonus] = useState(Boolean(setting?.tax_bonus));
  const previousWageRule = useRef({ payType: setting?.pay_type, fixed: setting?.apply_tax_to_fixed_pay, rules: resolvePayrollTaxSettings(setting ?? {}) });
  useEffect(() => {
    const previous = previousWageRule.current;
    if (previous.payType !== setting?.pay_type || previous.fixed !== setting?.apply_tax_to_fixed_pay) {
      setOverrides(value => ({ ...value, show_check_to_tax_company: value.show_check_to_tax_company ?? previous.rules.check_wage.shown, show_cash_to_tax_company: value.show_cash_to_tax_company ?? previous.rules.cash_wage.shown }));
    }
    previousWageRule.current = { payType: setting?.pay_type, fixed: setting?.apply_tax_to_fixed_pay, rules: resolvePayrollTaxSettings({ ...setting, ...overrides, tax_tips: tips, tax_bonus: bonus }) };
  }, [setting?.pay_type, setting?.apply_tax_to_fixed_pay, setting, overrides, tips, bonus]);
  const rules = resolvePayrollTaxSettings({ ...setting, ...overrides, tax_tips: tips, tax_bonus: bonus });
  return <section className="grid gap-3 min-w-0" aria-label={translate("Payroll item tax and sharing settings")}>
    <input type="hidden" name="tax_tips" value={String(tips)} />
    <input type="hidden" name="tax_bonus" value={String(bonus)} />
    <p className="text-xs text-zinc-500"><WorkspaceText text="Show controls what your tax company can see. Apply tax and the rate control withholding. Leaving a rate blank uses the default tax rate." /></p>
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map(item => <fieldset key={item.key} className="min-w-0 border-t border-zinc-200 pt-3">
        <legend className="px-1 text-sm font-semibold"><WorkspaceText text={item.label} /></legend>
        <input type="hidden" name={item.show} value={overrides[item.show] == null ? "" : String(overrides[item.show])} />
        {(item.apply === "tax_check" || item.apply === "tax_cash") && <input type="hidden" name={item.apply} value={overrides[item.apply] == null ? "" : String(overrides[item.apply])} />}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={rules[item.key].shown} aria-label={translate(`Show ${item.label} to tax company`)} onChange={event => setOverrides(value => ({ ...value, [item.show]: event.target.checked }))} /><WorkspaceText text="Show" /></label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={rules[item.key].applied} aria-label={translate(`Apply tax to ${item.label}`)} onChange={event => {
            setOverrides(value => ({ ...value, [item.show]: value[item.show] ?? rules[item.key].shown }));
            if (item.apply === "tax_tips") setTips(event.target.checked);
            else if (item.apply === "tax_bonus") setBonus(event.target.checked);
            else setOverrides(value => ({ ...value, [item.apply]: event.target.checked }));
          }} /><WorkspaceText text="Apply tax" /></label>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><span><WorkspaceText text="Rate" /> %</span><input name={item.rate} type="number" min="0" max="100" step="0.01" className="min-h-11 w-24 rounded-md border border-zinc-300 px-2" aria-label={translate(`${item.label} tax rate`)} placeholder={translate("Default")} value={overrides[item.rate] ?? ""} onChange={event => setOverrides(value => ({ ...value, [item.rate]: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
      </fieldset>)}
    </div>
  </section>;
}
