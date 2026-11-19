import test from "node:test";
import assert from "node:assert/strict";
import { calculatePayrollTaxSnapshot, mergePayrollTaxSnapshots, payrollTaxReportedAmounts, payrollTaxSettingsFromForm, resolvePayrollTaxSettings } from "../lib/payroll-tax-settings.ts";
import { api, fixtures, authFor, fixedSetting } from "./helpers/payroll-payment-fixture.mjs";

const base = { pay_type: "commission", tax_rate: 10, cash_to_tax_company: false, tax_tips: true, tax_bonus: true, tip_payout_method: "cash", bonus_payout_method: "check", tax_check: true, tax_cash: true, check_tax_rate: 10, cash_tax_rate: 15, tip_tax_rate: 20, bonus_tax_rate: 5 };
const keys = ["check_wage", "cash_wage", "tip", "bonus"];
const shows = ["show_check_to_tax_company", "show_cash_to_tax_company", "show_tip_to_tax_company", "show_bonus_to_tax_company"];
const cents = value => Math.round(value * 100);
function reconcile(snapshot) {
  for (const item of [...Object.values(snapshot.components), snapshot.totals]) {
    assert.equal(cents(item.gross), cents(item.tax) + cents(item.net));
    for (const key of ["gross", "tax", "net"]) assert.equal(cents(item[key]), cents(item["check_" + key]) + cents(item["cash_" + key]));
    for (const channel of ["check", "cash"]) assert.equal(cents(item[channel + "_gross"]), cents(item[channel + "_tax"]) + cents(item[channel + "_net"]));
  }
}

test("every visibility combination preserves independent four-item withholding and exact channel payout", () => {
  for (let mask = 0; mask < 16; mask++) {
    const setting = { ...base, ...Object.fromEntries(shows.map((field, index) => [field, Boolean(mask & (1 << index))])) };
    const value = calculatePayrollTaxSnapshot(setting, 600, 400, 150, 50);
    assert.deepEqual(value.totals, { gross: 1200, tax: 152.5, net: 1047.5, check_gross: 650, check_tax: 62.5, check_net: 587.5, cash_gross: 550, cash_tax: 90, cash_net: 460 });
    for (let index = 0; index < 4; index++) assert.equal(value.components[keys[index]].shown, Boolean(mask & (1 << index)));
    reconcile(value);
  }
});

test("Show and Apply tax are independent for every item, including zero rate and default-rate fallback", () => {
  for (let mask = 0; mask < 16; mask++) {
    const setting = { ...base, tax_check: Boolean(mask & 1), tax_cash: Boolean(mask & 2), tax_tips: Boolean(mask & 4), tax_bonus: Boolean(mask & 8), ...Object.fromEntries(shows.map(field => [field, true])) };
    const value = calculatePayrollTaxSnapshot(setting, 600, 400, 150, 50);
    assert.equal(value.totals.tax, (mask & 1 ? 60 : 0) + (mask & 2 ? 60 : 0) + (mask & 4 ? 30 : 0) + (mask & 8 ? 2.5 : 0));
    assert.equal(payrollTaxReportedAmounts(value).gross, 1200);
    reconcile(value);
  }
  const zero = calculatePayrollTaxSnapshot({ ...base, check_tax_rate: 0, cash_tax_rate: 0, tip_tax_rate: 0, bonus_tax_rate: 0 }, 600, 400, 150, 50);
  assert.equal(zero.totals.tax, 0); assert.equal(zero.components.check_wage.tax_applied, true); assert.equal(zero.components.check_wage.tax_rate, 0);
  const defaults = calculatePayrollTaxSnapshot({ ...base, check_tax_rate: null, cash_tax_rate: null, tip_tax_rate: null, bonus_tax_rate: null }, 600, 400, 150, 50);
  assert.equal(defaults.totals.tax, 120);
});

test("showing fixed exempt wages cannot start withholding or change take-home", () => {
  const setting = { ...fixedSetting, tax_rate: 20, apply_tax_to_fixed_pay: false, show_check_to_tax_company: true, show_cash_to_tax_company: true };
  const result = api.calculateDailyPayroll({ businessDate: "2026-10-01", correctionDelta: 0, earning: undefined, fixedDailyAmount: 100, accountId: "account", payrollRunId: "run", salonId: "salon", staffId: "anna", setting });
  assert.equal(result.baseCheckAmount, 50); assert.equal(result.baseCashAmount, 50); assert.equal(result.taxWithheld, 0);
  assert.equal(result.reportingSnapshot.components.check_wage.shown, true); assert.equal(result.reportingSnapshot.components.check_wage.tax_applied, false);
  assert.equal(result.taxCompanyReportedWageGross, 100);
  assert.equal(resolvePayrollTaxSettings(fixedSetting).check_wage.shown, false);
});

test("mixed days retain conservative visibility, exact channels and unknown mixed rates", () => {
  const first = calculatePayrollTaxSnapshot({ ...base, show_cash_to_tax_company: true, show_tip_to_tax_company: true }, 600, 400, 150, 0);
  const second = calculatePayrollTaxSnapshot({ ...base, show_cash_to_tax_company: false, show_tip_to_tax_company: true, cash_tax_rate: 0, tip_payout_method: "check", tip_tax_rate: 5 }, 60, 40, 15, 0);
  const value = mergePayrollTaxSnapshots([first, second]);
  assert.equal(value.components.cash_wage.shown, false); assert.equal(value.components.cash_wage.tax_rate, null);
  assert.equal(value.components.tip.payout_method, "mixed"); assert.equal(value.components.tip.tax_rate, null);
  assert.equal(value.components.tip.check_net, 14.25); assert.equal(value.components.tip.cash_net, 120);
  reconcile(value);
});

test("source periods and partial downloads retain exact snapshots and settle bonus once", async () => {
  const tables = fixtures();
  tables.staff_payroll_settings = [{ ...fixedSetting, ...base, staff_id: "anna", commission_rate: 100, check_rate: 60, effective_from: "2026-10-01", show_check_to_tax_company: false, show_cash_to_tax_company: true }];
  tables.pos_ticket_staff_earnings = [{ staff_id: "anna", salon_id: "salon", work_date: "2026-10-01", service_total: 1000, tip_amount: 150 }, { staff_id: "anna", salon_id: "salon", work_date: "2026-10-08", service_total: 100, tip_amount: 15 }];
  const run = async (startDate, endDate) => (await api.calculateLivePayrollForAuth(authFor(tables), { startDate, endDate, cycleType: "custom", preset: "custom" })).lines[0];
  const whole = await run("2026-10-01", "2026-10-15"), first = await run("2026-10-01", "2026-10-14"), end = await run("2026-10-15", "2026-10-15");
  for (const line of [whole, first, end]) {
    const value = line.tax_reporting_snapshot; reconcile(value);
    assert.equal(value.totals.net, line.final_staff_income); assert.equal(value.totals.tax, line.tax_withheld);
    assert.equal(value.totals.check_net, line.final_check_amount); assert.equal(value.totals.cash_net, line.final_cash_amount);
  }
  assert.equal(first.tax_reporting_snapshot.components.bonus.gross, 0); assert.equal(end.tax_reporting_snapshot.components.bonus.gross, 100);
  assert.deepEqual(mergePayrollTaxSnapshots([first.tax_reporting_snapshot, end.tax_reporting_snapshot]).totals, whole.tax_reporting_snapshot.totals);
  assert.equal(end.tax_reporting_snapshot.components.check_wage.shown, false, "zero-wage settlement must not invent default visibility");
  assert.equal(end.tax_reporting_snapshot.components.cash_wage.tax_rate, 15, "zero-wage settlement must not invent default rate");
});

test("form parsing distinguishes missing, untouched legacy null, explicit false and explicit zero", () => {
  assert.deepEqual(payrollTaxSettingsFromForm(new FormData()), {});
  const form = new FormData(); form.set("show_cash_to_tax_company", ""); form.set("tax_cash", "false"); form.set("cash_tax_rate", "0");
  assert.deepEqual(payrollTaxSettingsFromForm(form), { show_cash_to_tax_company: null, tax_cash: false, cash_tax_rate: 0 });
  form.set("tax_cash", "not-a-boolean"); assert.throws(() => payrollTaxSettingsFromForm(form), /Show and Apply/);
});
