import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const source = readFileSync(
  join(root, "lib/daily-pos-sales-comparison.ts"),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleContext = {
  exports: {},
  module: { exports: {} },
  Intl,
  Date,
  Math,
  Number,
  Set,
  Array,
};

moduleContext.exports = moduleContext.module.exports;
vm.runInNewContext(transpiled, moduleContext);

const {
  buildSameWeekdayComparisonDates,
  calculateDailyPosSalesComparison,
} = moduleContext.module.exports;

test("sales comparison returns positive percentage for same-weekday baseline", () => {
  const result = calculateDailyPosSalesComparison({
    comparableTotals: [100, 100, 100, 100],
    reportDate: "2026-08-15",
    selectedTotal: 108,
  });

  assert.equal(result.status, "available");
  assert.equal(result.direction, "up");
  assert.equal(result.percent, 8);
  assert.equal(result.label, "+8% vs typical Saturday");
  assert.equal(result.weekdayLabel, "Saturday");
});

test("sales comparison returns negative percentage for lower selected sales", () => {
  const result = calculateDailyPosSalesComparison({
    comparableTotals: [100, 100, 100, 100],
    reportDate: "2026-08-15",
    selectedTotal: 88,
  });

  assert.equal(result.status, "available");
  assert.equal(result.direction, "down");
  assert.equal(result.percent, 12);
  assert.equal(result.label, "-12% vs typical Saturday");
});

test("sales comparison returns flat copy instead of fake zero percent", () => {
  const result = calculateDailyPosSalesComparison({
    comparableTotals: [100, 100, 100, 100],
    reportDate: "2026-08-15",
    selectedTotal: 100,
  });

  assert.equal(result.status, "flat");
  assert.equal(result.direction, "flat");
  assert.equal(result.percent, 0);
  assert.equal(result.label, "0% vs typical Saturday");
});

test("sales comparison is safe without enough historical baseline", () => {
  const result = calculateDailyPosSalesComparison({
    comparableTotals: [100, 0],
    reportDate: "2026-08-15",
    selectedTotal: 50,
  });

  assert.equal(result.status, "insufficient_history");
  assert.equal(result.direction, "flat");
  assert.equal(result.label, "Not enough history for comparison");
});

test("same-weekday comparison dates are before selected business date", () => {
  const dates = buildSameWeekdayComparisonDates({
    reportDate: "2026-08-15",
  });

  assert.deepEqual(dates, [
    "2026-08-08",
    "2026-08-01",
    "2026-07-25",
    "2026-07-18",
  ]);
  assert.ok(dates.every((date) => date < "2026-08-15"));
});

test("comparison date math stays on local business date strings", () => {
  const dates = buildSameWeekdayComparisonDates({
    reportDate: "2026-03-08",
  });

  assert.deepEqual(dates, [
    "2026-03-01",
    "2026-02-22",
    "2026-02-15",
    "2026-02-08",
  ]);
});
