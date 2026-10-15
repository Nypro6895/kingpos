import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function action(installed = true) {
  const state = { installed, calls: 0 };
  globalThis.__payrollDownloadTest = state;
  const result = await build({
    entryPoints: ["app/payroll/data-download-actions.ts"], bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{ name: "fixtures", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\// }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("market-plugins") ? `
        export async function marketPluginContext() { return { client: {}, salonId: 'salon-a' }; }
        export async function payrollDataPluginInstalled() { return globalThis.__payrollDownloadTest.installed; }
      ` : `
        export async function getPayrollPageData() {
          globalThis.__payrollDownloadTest.calls++;
          return { access: { canViewAllPayroll: true }, live: { shopDailyRows: [], lines: [{ staff_display_name_snapshot: '=HYPERLINK("bad")', gross_sales: 100, earned_amount: 50, tip_amount: 5, bonus_amount: 0, tax_withheld: 2, final_cash_amount: 53, final_check_amount: 0, final_staff_income: 53 }] } };
        }
      ` }));
    } }],
  });
  const module = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(module, module.exports);
  return { download: module.exports.downloadPayrollData, state };
}

test("Direct export calls are denied after plugin removal, before loading payroll", async () => {
  const { download, state } = await action(false);
  const result = await download({ start: "2026-10-01", end: "2026-10-08", categories: ["staff"] });
  assert.match(result.error, /Add Payroll Data Download/);
  assert.equal(state.calls, 0);
});

test("Invalid dates, reversed ranges and unknown categories cannot export", async () => {
  const { download, state } = await action();
  for (const input of [
    { start: "2026-02-30", end: "2026-03-01", categories: ["staff"] },
    { start: "2026-10-08", end: "2026-10-01", categories: ["staff"] },
    { start: "2025-01-01", end: "2026-10-01", categories: ["staff"] },
    { start: "2026-10-01", end: "2026-10-08", categories: ["secret"] },
  ]) assert.ok((await download(input)).error);
  assert.equal(state.calls, 0);
});

test("Selected staff CSV preserves numeric values and neutralizes spreadsheet formulas", async () => {
  const { download } = await action();
  const result = await download({ start: "2026-10-01", end: "2026-10-08", categories: ["staff"] });
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].name, "payroll-staff-2026-10-01-2026-10-08.csv");
  assert.ok(result.files[0].csv.includes(`"'=HYPERLINK(""bad"")"`));
  assert.ok(result.files[0].csv.includes('"100","50","5"'));
});
