import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
const bundled = await build({ entryPoints: ["lib/owner-tax-report-model.ts"], bundle: true, write: false, format: "cjs", platform: "node" });
const mod = { exports: {} };
new Function("module", "exports", bundled.outputFiles[0].text)(mod, mod.exports);
const { ownerTaxRunsInRange, ownerTaxInitialFilter, ownerTaxReportYears } = mod.exports;
const run = (id, start, end) => ({ id, period_start: start, period_end: end, version: 1, status: "printed", cycle_type: "biweekly" });
const runs = [run("nov", "2026-11-01", "2026-11-15"), run("oct2", "2026-10-16", "2026-10-31"), run("oct1", "2026-10-01", "2026-10-15"), run("cross", "2025-12-22", "2026-01-04")];

test("owner year summaries use the professional view's overlapping-period semantics", () => {
  assert.deepEqual(ownerTaxRunsInRange(runs, "2026").map((r) => r.id), ["nov", "oct2", "oct1", "cross"]);
  assert.deepEqual(ownerTaxRunsInRange(runs, "2025").map((r) => r.id), ["cross"]);
  assert.deepEqual(ownerTaxReportYears([runs[3]]), ["2026", "2025"]);
});
test("month and custom ranges select their published periods without jumping to unrelated latest values", () => {
  const month = ownerTaxInitialFilter(runs, { month: "2026-10" });
  assert.equal(month.selection, "summary");
  assert.deepEqual(ownerTaxRunsInRange(runs, "", month.start, month.end).map((r) => r.id), ["oct2", "oct1"]);
  assert.equal(ownerTaxInitialFilter(runs, { month: "2026-10", segment: "first" }).selection, "oct1");
  const annual = ownerTaxInitialFilter(runs, { start: "2026-01-01", end: "2026-12-31", preset: "custom" });
  assert.equal(annual.selection, "summary");
  assert.equal(ownerTaxRunsInRange(runs, "", annual.start, annual.end).length, 4);
});
test("missing or invalid requested periods stay empty instead of disclosing a different period", () => {
  for (const query of [{ month: "2024-10" }, { payPeriodStart: "2026-09-01" }, { month: "2026-99" }, { start: "2026-12-01", end: "2026-01-01" }]) {
    const selected = ownerTaxInitialFilter(runs, query);
    assert.equal(selected.selection, "summary");
    assert.equal(ownerTaxRunsInRange(runs, "", selected.start, selected.end).length, 0);
  }
  assert.equal(ownerTaxInitialFilter(runs).selection, "nov");
  assert.equal(ownerTaxInitialFilter(runs, { payPeriodStart: "2026-10-16" }).selection, "oct2");
});
