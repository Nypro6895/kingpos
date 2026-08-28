import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("operational report business logic lives in a server service", () => {
  const service = read("lib/operational-report.ts");
  const page = read("app/reports/page.tsx");
  const dashboard = read("app/reports/operational-report-dashboard.tsx");

  assert.match(service, /import "server-only"/);
  assert.match(service, /export async function getOperationalReport/);
  assert.match(service, /calculateTicketTotals/);
  assert.match(page, /getOperationalReport\(params, context\)/);
  assert.doesNotMatch(page, /calculateTicketTotals/);
  assert.doesNotMatch(dashboard, /calculateTicketTotals/);
});

test("operational report queries remain salon scoped", () => {
  const service = read("lib/operational-report.ts");

  assert.match(service, /requirePermission\(DAILY_POS_REPORT_PERMISSIONS\.view/);
  assert.match(service, /\.eq\("salon_id", auth\.salon\.id\)/);
  assert.match(service, /\.eq\("location_id", auth\.salon\.id\)/);
  assert.match(service, /Booking metrics require booking\.view permission/);
  assert.match(service, /customers\.view permission/);
});

test("reports route keeps daily closing and adds operational range controls", () => {
  const page = read("app/reports/page.tsx");
  const dashboard = read("app/reports/operational-report-dashboard.tsx");

  assert.match(page, /<DailyClosingForm/);
  assert.match(page, /<OperationalReportDashboard/);
  assert.match(dashboard, /This Week/);
  assert.match(dashboard, /This Month/);
  assert.match(dashboard, /name="preset" type="hidden" value="custom"/);
  assert.match(dashboard, /Ticket Drill-Down/);
});
