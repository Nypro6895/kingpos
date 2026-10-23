import test from "node:test";
import assert from "node:assert/strict";
import { rankMarketApps } from "../lib/market-ranking.ts";

const apps = [
  { id: "preview", publisher: "Reylumi" },
  { id: "third-party", publisher: "Partner", available: true },
  { id: "payroll", publisher: "Reylumi", available: true },
  { id: "campaigns", publisher: "Reylumi", available: true },
];
test("Without installation data, usable Reylumi plugins lead, then usable partners, then previews", () => {
  assert.deepEqual(rankMarketApps(apps).map(app => app.id), ["payroll", "campaigns", "third-party", "preview"]);
  assert.equal(apps[0].id, "preview");
});
test("Installation totals rank first; equal totals use availability and publisher", () => {
  assert.deepEqual(rankMarketApps(apps, { "third-party": 10, payroll: 2, campaigns: 2 }).map(app => app.id), ["third-party", "payroll", "campaigns", "preview"]);
});
test("Invalid totals cannot override fallback ranking", () => {
  assert.deepEqual(rankMarketApps(apps, { preview: NaN, "third-party": -5, payroll: Infinity }).map(app => app.id), ["payroll", "campaigns", "third-party", "preview"]);
});
