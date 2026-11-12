import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["lib/payroll-setting-period.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  alias: { "@": process.cwd() },
});
const {
  payrollSettingPeriod,
  nextPayrollSettingPeriod,
  requirePayrollSettingBoundary,
} = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].text).toString("base64")
);
import {
  latestTaxRuns,
  taxPeriodRuns,
  taxCurrentPaystub,
  summarizeTaxLines,
  taxReceiptCents,
  validateTaxFile,
  taxChangedLine,
  refreshTaxRunSelection,
} from "../lib/tax-workspace-model.ts";
import {
  resolvePostAuthRoute,
  sanitizeAuthReturnPath,
} from "../lib/auth-routing.ts";
const runs = [
  {
    id: "old",
    period_start: "2026-10-01",
    period_end: "2026-10-15",
    version: 1,
    status: "printed",
  },
  {
    id: "new",
    period_start: "2026-10-01",
    period_end: "2026-10-15",
    version: 2,
    status: "paid",
  },
  {
    id: "second",
    period_start: "2026-10-16",
    period_end: "2026-10-31",
    version: 1,
    status: "printed",
  },
  {
    id: "draft",
    period_start: "2026-11-01",
    period_end: "2026-11-15",
    version: 1,
    status: "draft",
  },
  {
    id: "year",
    period_start: "2025-12-01",
    period_end: "2025-12-31",
    version: 1,
    status: "paid",
  },
];
test("latest published versions only; calendar boundaries do not carry another period", () => {
  assert.deepEqual(
    latestTaxRuns(runs).map((x) => x.id),
    ["second", "new", "year"],
  );
  assert.deepEqual(
    taxPeriodRuns(runs, "previous_month", "2026-11-09").map((x) => x.id),
    ["second", "new"],
  );
  assert.deepEqual(taxPeriodRuns(runs, "current_month", "2026-11-09"), []);
  assert.deepEqual(
    taxPeriodRuns(runs, "previous_year", "2026-11-09").map((x) => x.id),
    ["year"],
  );
  assert.equal(
    taxPeriodRuns(runs, "previous_month", "2026-01-03")[0].id,
    "year",
  );
});
test("paystub version scope and integer cent aggregation", () => {
  const docs = [
    {
      id: "old",
      staff_id: "a",
      payroll_run_id: "old",
      kind: "paystub",
      archived_at: null,
    },
    {
      id: "archived",
      staff_id: "a",
      payroll_run_id: "new",
      kind: "paystub",
      archived_at: "2026-11-01",
    },
    {
      id: "removed",
      staff_id: "a",
      payroll_run_id: "new",
      kind: "paystub",
      owner_deleted_at: "2026-11-01",
    },
  ];
  assert.equal(taxCurrentPaystub(docs, "a", "new"), null);
  const summary = summarizeTaxLines([
    {
      staff_id: "a",
      reported_gross: 0.1,
      tax: 0.1,
      actual_check: 0.1,
      wage_check_net: 0.1,
    },
    {
      staff_id: "a",
      reported_gross: 0.2,
      tax: 0.2,
      actual_check: 0.2,
      wage_check_net: 0.2,
    },
  ]);
  assert.equal(summary[0].actual_check, 0.3);
  assert.equal(taxReceiptCents("350.10"), 35010);
  for (const bad of ["1.001", "-1", "1e2", "NaN", "1,000"])
    assert.throws(() => taxReceiptCents(bad));
});
test("changed payroll is compared within the same period, not by employee alone", () => {
  const line = {
    staff_id: "a",
    run_id: "new",
    reported_gross: 110,
    tax: 11,
    actual_check: 99,
  };
  const data = {
    runs,
    lines: [{ ...line, run_id: "old", reported_gross: 100 }, line],
  };
  assert.ok(taxChangedLine(data, line));
  assert.equal(taxChangedLine({ ...data, lines: [line] }, line), null);
});
test("Tax opt-in restores Tax only; existing personal defaults are preserved", () => {
  const personal = { id: "personal", type: "personal", salonMode: null },
    tax = { id: "tax", type: "tax", salonMode: null };
  assert.equal(
    resolvePostAuthRoute({ requestedPath: "/tax", workspaces: [personal, tax] })
      .workspaceId,
    "tax",
  );
  assert.equal(
    resolvePostAuthRoute({ requestedPath: "/tax", workspaces: [personal] })
      .redirectTo,
    "/tax",
  );
  assert.equal(
    resolvePostAuthRoute({
      requestedPath: "/explore",
      workspaces: [personal, tax],
      preferredWorkspaceId: "tax",
    }).workspaceId,
    "personal",
  );
  assert.equal(sanitizeAuthReturnPath("/tax/login"), "/explore");
});
test("file validation rejects wrong type and oversize before upload", () => {
  assert.doesNotThrow(() =>
    validateTaxFile({
      name: "paystub.pdf",
      type: "application/pdf",
      size: 500,
    }),
  );
  assert.throws(() =>
    validateTaxFile({ name: "a.svg", type: "image/svg+xml", size: 500 }),
  );
  assert.throws(() =>
    validateTaxFile({ name: "a.pdf", type: "application/pdf", size: 10485761 }),
  );
});

test("setting dates align to full calendar periods, including year rollover and anchored biweekly", () => {
  const semi = { cycle_type: "semi_monthly" };
  assert.equal(
    payrollSettingPeriod(semi, "2026-11-10").startDate,
    "2026-11-01",
  );
  assert.equal(
    nextPayrollSettingPeriod(semi, "2026-11-10").startDate,
    "2026-11-16",
  );
  assert.equal(
    nextPayrollSettingPeriod({ cycle_type: "monthly" }, "2026-12-20").startDate,
    "2027-01-01",
  );
  assert.equal(
    requirePayrollSettingBoundary(
      { cycle_type: "biweekly", biweekly_anchor_date: "2026-01-02" },
      "2026-01-16",
    ).endDate,
    "2026-01-29",
  );
  assert.throws(
    () => requirePayrollSettingBoundary(semi, "2026-11-10"),
    /whole payroll period/,
  );
  assert.throws(() => payrollSettingPeriod(semi, "2026-02-30"), /valid/);
});

test("year summaries add reported components across periods where reporting is switched on and off", () => {
  const line = {
    staff_id: "a",
    reported_wage: 1000,
    reported_gross: 1100,
    tax: 110,
    actual_check: 990,
    wage_check_net: 900,
    cash_reported: null,
    tip: 100,
    bonus: null,
    tax_rate: 10,
  };
  const result = summarizeTaxLines([
    line,
    { ...line, reported_gross: 1000, tip: null },
  ])[0];
  assert.equal(result.reported_wage, 2000);
  assert.equal(result.tip, 100);
  assert.equal(result.bonus, null);
  assert.equal(result.reported_gross, 2100);
});

test("refresh moves the open period to its new published statement without jumping to another month", () => {
  assert.equal(refreshTaxRunSelection(runs, "old"), "new");
  assert.equal(refreshTaxRunSelection(runs, "second"), "second");
  assert.equal(refreshTaxRunSelection(runs, "summary"), "summary");
  assert.equal(refreshTaxRunSelection(runs, ""), "");
});
