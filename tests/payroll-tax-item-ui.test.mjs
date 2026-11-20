import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const stubs = {
  "@/components/workspace-language": 'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;',
  "@/components/submit-button": 'import React from "react";export const SubmitButton=props=>React.createElement("button",{...props,type:"submit"});',
  "next/link": 'import React from "react";export default function Link(props){return React.createElement("a",props)}',
  "@/app/payroll/actions": 'export async function saveStaffPayrollSettingWithEffectiveDateAction(){throw Error("No server action in UI fixture")}',
  "./direct-settings-actions": 'export async function saveDirectPayroll(salon,input){window.__savedPayroll={salon,input};return {ok:true}}export const saveDirectStaff=async()=>({ok:true}),runDirectStaffRequest=async()=>({ok:true});',
  "./settings-child-pages": 'import React from "react";export const useSettingsChildNavigation=()=>null;export const SettingsChildPage=({children})=>children;export const SettingsDetails=({children})=>React.createElement("div",null,children);',
  "./staff-hours-booking": 'export const StaffHoursBooking=()=>null;',
  "@/app/staff/staff-public-profile-editor": 'export const StaffPublicProfileEditor=()=>null;',
  "./settings-extra-actions": 'export async function saveSettingsPublicTeam(){return{ok:true}}',
  "./delete-unused-button": 'export const DeleteUnusedButton=()=>null;',
  "./direct-pos-actions": 'export async function resetDirectStaffPasscode(){return{ok:true}}',
  "./staff-customer-contact-actions": 'export async function saveStaffCustomerContacts(){return{ok:true}}',
};
const source = `
import React from 'react';import{createRoot}from'react-dom/client';
import{PayrollTaxItemFields}from'./app/payroll/payroll-tax-item-fields';
import{StaffPayrollSettingInlineEdit}from'./app/payroll/staff-payroll-setting-inline-edit';
import{PayrollSettingsPanel}from'./app/settings/team-payroll-panels';
import{payrollTaxSettingsFromForm,resolvePayrollTaxSettings}from'./lib/payroll-tax-settings';
const root=createRoot(document.getElementById('root'));let revision=0;
const schedule={id:'schedule',salon_id:'salon',cycle_type:'semi_monthly',biweekly_anchor_date:null};
const staff={id:'staff',display_name:'Anna Nguyen'};
window.renderTaxFixture=(mode,setting)=>{revision++;window.__setting=setting;let child;
if(mode==='widget')child=React.createElement('form',null,React.createElement(PayrollTaxItemFields,{setting}));
else if(mode==='inline')child=React.createElement(StaffPayrollSettingInlineEdit,{setting,salonPayrollSetting:schedule,staff,staffProfileAvatarUrl:null,staffProfileDisplayName:'Anna Nguyen',returnPath:'/payroll',period:{startDate:'2026-11-01',endDate:'2026-11-15',preset:'semi_monthly_first',cycleType:'semi_monthly',label:'November'}});
else child=React.createElement(PayrollSettingsPanel,{data:{kind:'payroll',canManage:true,salonId:'salon',schedule,today:'2026-11-17',staff:[{staff,setting,staffProfileDisplayName:'Anna Nguyen'}]},onSaved:async()=>{}});
root.render(React.createElement(React.Fragment,{key:revision},child));};
window.taxFormState=form=>{const values=new FormData(form);return{entries:[...values],items:payrollTaxSettingsFromForm(values),rules:resolvePayrollTaxSettings({...window.__setting,...Object.fromEntries(values),pay_type:values.get('pay_type')??window.__setting.pay_type,apply_tax_to_fixed_pay:values.has('apply_tax_to_fixed_pay')?['on','true'].includes(values.get('apply_tax_to_fixed_pay')):false,tax_tips:values.get('tax_tips')==='true',tax_bonus:values.get('tax_bonus')==='true',...payrollTaxSettingsFromForm(values)})}};
`;
const built = await build({
  stdin: { contents: source, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": process.cwd() }, loader: { ".css": "empty" },
  plugins: [{ name: "ui-isolation", setup(api) {
    api.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
    api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], resolveDir: process.cwd() }));
  } }],
});
const setting = { id: "setting", staff_id: "staff", pay_type: "commission", commission_rate: 60, fixed_pay_amount: 100, check_rate: 60, tax_rate: 10, apply_tax_to_fixed_pay: false, tax_tips: true, tax_bonus: false, cash_to_tax_company: true, tip_payout_method: "check", bonus_payout_method: "cash", effective_from: "2026-11-01", updated_at: "2026-11-17T00:00:00Z" };

async function fixture(fn) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: built.outputFiles[0].text });
  try { await fn(page); assert.deepEqual(errors, []); assert.deepEqual(requests, []); } finally { await browser.close(); }
}
async function render(page, mode, values = setting) {
  await page.evaluate(({ mode, values }) => window.renderTaxFixture(mode, values), { mode, values });
  if (mode === "team") {
    const section = page.getByRole("region", { name: "Anna Nguyen", exact: true });
    await section.getByRole("button", { name: "Edit", exact: true }).click();
  }
  await page.getByRole("region", { name: "Payroll item tax and sharing settings", exact: true }).waitFor();
  return page.locator("form").filter({ has: page.locator("input[name=show_tip_to_tax_company]") });
}
const state = form => form.evaluate(element => window.taxFormState(element));

test("actual tax item widget serializes booleans once and keeps Show, Apply tax and rates independent", async () => fixture(async page => {
  const form = await render(page, "widget");
  await page.getByRole("checkbox", { name: "Apply tax to Tip", exact: true }).uncheck();
  assert.equal(await page.getByRole("checkbox", { name: "Show Tip to tax company", exact: true }).isChecked(), true);
  await page.getByRole("checkbox", { name: "Show Cash wages to tax company", exact: true }).uncheck();
  assert.equal(await page.getByRole("checkbox", { name: "Apply tax to Cash wages", exact: true }).isChecked(), true);
  await page.getByRole("spinbutton", { name: "Cash wages tax rate", exact: true }).fill("20");
  const result = await state(form);
  assert.equal(result.items.show_tip_to_tax_company, true);
  assert.equal(result.items.show_cash_to_tax_company, false);
  assert.equal(result.items.cash_tax_rate, 20);
  assert.deepEqual(result.entries.filter(([name]) => name === "tax_tips"), [["tax_tips", "false"]]);
  assert.ok(result.entries.filter(([name]) => /^(show_|tax_check$|tax_cash$)/.test(name)).every(([, value]) => ["", "true", "false"].includes(value)));
}));

test("actual Team and inline compensation forms preserve existing item overrides and true tip/bonus values", async () => fixture(async page => {
  const explicit = { ...setting, tax_bonus: true, show_check_to_tax_company: true, show_cash_to_tax_company: false, show_tip_to_tax_company: true, show_bonus_to_tax_company: false, tax_check: true, tax_cash: true, check_tax_rate: 20, cash_tax_rate: 5, tip_tax_rate: 0, bonus_tax_rate: 15 };
  for (const mode of ["team", "inline"]) {
    const form = await render(page, mode, explicit), before = await state(form);
    if (mode === "team") await form.locator("input[name=commission_rate]").fill("45");
    else { await page.getByRole("button", { name: /Commission split rate/ }).click();await form.locator("input[type=number]").first().fill("45"); }
    const after = await state(form);
    assert.deepEqual(after.items, before.items, mode);
    assert.deepEqual(after.entries.filter(([name]) => name === "tax_tips"), [["tax_tips", "true"]], mode);
    assert.deepEqual(after.entries.filter(([name]) => name === "tax_bonus"), [["tax_bonus", "true"]], mode);
    assert.equal(after.rules.cash_wage.shown, false);assert.equal(after.rules.cash_wage.applied, true);
    if (mode === "team") {
      await form.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.waitForFunction(() => window.__savedPayroll?.input.commissionRate === 45);
      const payload = await page.evaluate(() => window.__savedPayroll.input);
      assert.equal(payload.taxTips, true);assert.equal(payload.taxBonus, true);
      assert.deepEqual(payload.itemTaxSettings, before.items);
    }
  }
}));

test("changing pay type or the fixed-pay exemption cannot silently change displayed Show values after serialization", async () => fixture(async page => {
  for (const mode of ["team", "inline"]) {
    const form = await render(page, mode);
    const shownBefore = await page.getByRole("checkbox", { name: /Show (Check|Cash) wages to tax company/ }).evaluateAll(inputs => inputs.map(input => input.checked));
    if (mode === "team") await form.locator("select[name=pay_type]").selectOption("fixed");
    else { await page.getByRole("button", { name: /Pay type:/ }).click();await form.locator("select").first().selectOption("fixed"); }
    const result = await state(form);
    assert.deepEqual([result.rules.check_wage.shown, result.rules.cash_wage.shown], shownBefore, `${mode}: serialized visibility must match the displayed independent Show controls`);
    if (mode === "team") await form.locator("input[name=apply_tax_to_fixed_pay]").check();
    else {
      await page.getByText("More details", { exact: true }).click();
      await page.getByRole("button", { name: /Default tax on fixed pay:/ }).click();
      await form.locator("select").first().selectOption("true");
    }
    const fixed = await state(form);
    assert.deepEqual([fixed.rules.check_wage.shown, fixed.rules.cash_wage.shown], shownBefore, `${mode}: exemption change cannot alter visibility`);
    if (mode === "team") { await form.locator("input[name=tax_rate]").fill("25");await form.locator("input[name=tax_rate]").press("Tab"); }
    else { await page.getByRole("button", { name: /Default tax rate:/ }).click();await form.locator("input[type=number]").first().fill("25");await form.locator("input[type=number]").first().press("Tab"); }
    const rate = await state(form);
    assert.deepEqual([rate.rules.check_wage.shown, rate.rules.cash_wage.shown], shownBefore, `${mode}: rate change cannot alter visibility`);
    assert.equal(rate.rules.check_wage.rate, 25);
    assert.equal(rate.items.check_tax_rate, null, "Default-rate change does not invent an item override");
  }
}));
