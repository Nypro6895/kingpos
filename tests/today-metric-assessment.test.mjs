import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
function load(path, dependencies = {}) {
  const evaluatedModule = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    {
      module: evaluatedModule,
      exports: evaluatedModule.exports,
      require: (name) => dependencies[name],
      Date,
      Intl,
      Math,
      Number,
      Array,
    },
  );
  return evaluatedModule.exports;
}
const {
  backlogTone,
  waitingAssessment,
  recentComparisonDates,
  sameTimeSalesComparison,
} = load("lib/today-metric-assessment.ts", {
  "./daily-pos-sales-comparison": load("lib/daily-pos-sales-comparison.ts"),
});
test("seven preceding calendar dates cross month and leap year boundaries", () => {
  assert.deepEqual(Array.from(recentComparisonDates("2024-03-01")), [
    "2024-02-29",
    "2024-02-28",
    "2024-02-27",
    "2024-02-26",
    "2024-02-25",
    "2024-02-24",
    "2024-02-23",
  ]);
});
test("sales uses seven days including zero and respects inclusive $100 neutral band", () => {
  const base = {
    totals: [700, 700, 0, 0, 0, 0, 0],
    historyDays: 2,
    sameTime: true,
  };
  assert.equal(
    sameTimeSalesComparison({ ...base, selectedTotal: 300 }).direction,
    "flat",
  );
  assert.equal(
    sameTimeSalesComparison({ ...base, selectedTotal: 100 }).direction,
    "flat",
  );
  assert.equal(
    sameTimeSalesComparison({ ...base, selectedTotal: 300.01 }).direction,
    "up",
  );
  assert.equal(
    sameTimeSalesComparison({ ...base, selectedTotal: 99.99 }).direction,
    "down",
  );
  assert.equal(
    sameTimeSalesComparison({ ...base, selectedTotal: 200 }).average,
    200,
  );
});
test("insufficient, incomplete, zero baseline and full day labels are honest", () => {
  const base = {
    totals: Array(7).fill(0),
    selectedTotal: 500,
    historyDays: 2,
    sameTime: true,
  };
  assert.equal(sameTimeSalesComparison(base).status, "zero_baseline");
  assert.equal(
    sameTimeSalesComparison({ ...base, historyDays: 1 }).status,
    "insufficient_history",
  );
  assert.equal(
    sameTimeSalesComparison({ ...base, totals: [200] }).status,
    "insufficient_history",
  );
  assert.doesNotMatch(
    sameTimeSalesComparison({
      ...base,
      totals: Array(7).fill(200),
      sameTime: false,
    }).label,
    /at this time/,
  );
});
test("backlog severity and longest wait boundaries", () => {
  assert.equal(backlogTone(0), "good");
  assert.equal(backlogTone(1), "warning");
  assert.equal(backlogTone(4), "warning");
  assert.equal(backlogTone(5), "danger");
  const now = "2026-09-23T18:00:00Z";
  assert.equal(waitingAssessment([], now).tone, "good");
  assert.equal(
    waitingAssessment(["2026-09-23T17:31:00Z"], now).tone,
    "warning",
  );
  assert.equal(waitingAssessment(["2026-09-23T17:30:00Z"], now).tone, "danger");
  assert.equal(
    waitingAssessment(["2026-09-23T18:30:00Z"], now).label,
    "Longest wait: 0 min",
  );
});
