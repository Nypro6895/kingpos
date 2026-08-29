import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const todayDashboard = read("lib/today-dashboard.ts");
const dailyReport = read("lib/daily-pos-report.ts");
const salesComparison = read("lib/daily-pos-sales-comparison.ts");
const salonBusinessHours = read("lib/salon-business-hours.ts");
const quickAccesses = read("lib/today-quick-accesses.ts");
const quickAccessActions = read("app/staff/today/actions.ts");
const todayPage = read("app/staff/today/page.tsx");
const quickAccessEditor = read("app/staff/today/quick-access-editor.tsx");
const quickAccessMigration = read(
  "supabase/migrations/202608150001_today_quick_access_preferences.sql",
);
const quickAccessGrantMigration = read(
  "supabase/migrations/202608150002_today_quick_access_preferences_grants.sql",
);

test("Today staff services reuse daily report staff attribution", () => {
  assert.match(dailyReport, /buildStaffRowsFromEarnings\(earnings \?\? \[\]\)/);
  assert.match(dailyReport, /buildStaffRowsFromTickets\(finalizedTickets\)/);
  assert.match(
    dailyReport,
    /staffAttributionSource = "pos_ticket_staff_earnings"/,
  );
  assert.match(dailyReport, /staffAttributionSource =[\s\S]*"pos_ticket_items"/);
  assert.match(todayDashboard, /getDailyPosTodayFinancialData/);
  assert.match(todayDashboard, /financialRowsByStaffId/);
  assert.match(todayDashboard, /input\.financialRow\?\.totalEarned/);
  assert.doesNotMatch(todayDashboard, /serviceSales:\s*input\.activity\?\.assignedServiceAmount \?\? 0/);
});

test("Today waiting state consumes active customer visits and has no fake chart", () => {
  assert.match(todayDashboard, /getCustomerVisitQueueForSalonOrEmpty/);
  assert.match(todayDashboard, /function mapWaitingVisits/);
  assert.match(todayDashboard, /id: `visit:\$\{visit\.id\}`/);
  assert.match(todayDashboard, /source: visit\.source/);
  assert.match(todayDashboard, /dayView\.isCurrentDate\s*\?\s*mapWaitingVisits/);
  assert.doesNotMatch(todayDashboard, /mapWaitingClients\(bookings, clock\.date\)/);
  assert.match(
    todayDashboard.match(/function buildWaitingMetric[\s\S]*?function buildAttention/)?.[0] ?? "",
    /chart: null/,
  );
});

test("KPI and performance charts are server model data, not client fetches", () => {
  assert.match(todayDashboard, /buildBookingMetricChart/);
  assert.match(todayDashboard, /buildStaffMetricChart/);
  assert.match(todayDashboard, /activityPoints\.map/);
  assert.match(todayDashboard, /runningTotal \+= point\.total/);
  assert.match(todayDashboard, /kind: "sparkline"/);
  assert.match(todayDashboard, /kind: "bars"/);
  assert.match(todayDashboard, /ariaLabel:\s*"Appointments by scheduled hour for the selected day"[\s\S]*kind: "sparkline"/);
  assert.match(todayPage, /function MiniMetricChart/);
  assert.match(todayPage, /chart\.kind === "sparkline"/);
  assert.match(todayPage, /strokeWidth="1\.9"/);
  assert.match(todayPage, /function SalesActivityChart/);
  assert.match(todayPage, /const width = 760/);
  assert.match(todayPage, /formatShortMoney\(tick\)/);
  assert.doesNotMatch(todayPage, /fetch\(/);
});

test("Today hourly charts use canonical salon business-hour buckets", () => {
  assert.match(salonBusinessHours, /from\("staff_availability_rules"\)/);
  assert.match(salonBusinessHours, /\.eq\("rule_type", "working"\)/);
  assert.match(salonBusinessHours, /\.eq\("is_active", true\)/);
  assert.match(salonBusinessHours, /\.eq\("day_of_week", selectedDay\)/);
  assert.match(salonBusinessHours, /effective_start_date/);
  assert.match(salonBusinessHours, /effective_end_date/);
  assert.match(salonBusinessHours, /buildSalonBusinessHourBuckets/);
  assert.match(salonBusinessHours, /export function buildSalonActivityBuckets/);
  assert.match(salonBusinessHours, /label: "Before open"/);
  assert.match(salonBusinessHours, /label: "After hours"/);
  assert.match(salonBusinessHours, /isClosed: true/);
  assert.doesNotMatch(salonBusinessHours, /08:00|8 AM - 8 PM|20:00/);
  assert.match(dailyReport, /businessHours\?: SalonBusinessHoursWindow/);
  assert.match(dailyReport, /buildSalonActivityBuckets/);
  assert.match(todayDashboard, /buildSalonActivityBuckets/);
  assert.match(salonBusinessHours, /source: "business_hours" as const/);
  assert.match(salonBusinessHours, /source: "activity_hours_fallback"/);
  assert.match(salonBusinessHours, /source: "before_open" as const/);
  assert.match(salonBusinessHours, /source: "after_hours" as const/);
  assert.match(dailyReport, /isExceptional: bucket\.exceptional/);
});

test("Sales comparison is same-weekday, historical, and safe for all result states", () => {
  assert.match(salesComparison, /export function calculateDailyPosSalesComparison/);
  assert.match(salesComparison, /export function buildSameWeekdayComparisonDates/);
  assert.match(dailyReport, /function buildSalesComparison/);
  assert.match(salesComparison, /Array\.from\(\{ length: count \}/);
  assert.match(salesComparison, /addLocalDays\(input\.reportDate, -7 \* \(index \+ 1\)\)/);
  assert.match(dailyReport, /core\.reportDate < input\.reportDate/);
  assert.match(salesComparison, /positiveTotals\.length < 2/);
  assert.match(salesComparison, /average <= 0/);
  assert.match(salesComparison, /percent === 0/);
  assert.match(salesComparison, /status: "available"/);
  assert.match(salesComparison, /status: "flat"/);
  assert.match(salesComparison, /status: "insufficient_history"/);
  assert.match(salesComparison, /status: "zero_baseline"/);
  assert.match(salesComparison, /0% vs typical \$\{weekday\}/);
  assert.match(salesComparison, /Not enough history for comparison/);
  assert.match(salesComparison, /vs typical \$\{weekday\}/);
  assert.match(todayDashboard, /function visibleSalesTrend/);
  assert.match(todayDashboard, /comparison\.status === "insufficient_history"/);
  assert.match(todayDashboard, /comparison\.status === "zero_baseline"/);
  assert.match(todayPage, /trend\.direction === "up"/);
  assert.match(todayPage, /trend\.direction === "down"/);
  assert.match(todayPage, /bg-zinc-100 text-zinc-600/);
});

test("Today layout keeps Team and Performance full-width with compact staff rows", () => {
  assert.doesNotMatch(
    todayPage,
    /<section className="grid gap-5 xl:grid-cols-\[minmax\(0,1\.2fr\)_minmax\(320px,0\.8fr\)\]">/,
  );
  assert.match(todayPage, /<TeamPanel dashboard=\{dashboard\} \/>/);
  assert.match(todayPage, /<PerformancePanel dashboard=\{dashboard\} \/>/);
  assert.match(todayPage, /function displayStaffStatus/);
  assert.match(todayPage, /return "Active"/);
  assert.match(todayPage, /return "Unchecked"/);
  assert.match(todayPage, /return "Inactive"/);
  assert.match(todayPage, /whitespace-nowrap rounded-full px-1\.5/);
  assert.match(todayPage, /L \/ S/);
  assert.match(todayPage, /aria-label=\{`\$\{member\.turns\.large\} large turns and \$\{member\.turns\.small\} small turns`\}/);
  assert.match(todayPage, /formatShortMoney\(input\.value\)/);
  assert.match(todayPage, /Services\s*\{services\.label\}/);
  assert.match(todayPage, /Tips not attributed to this staff member/);
  assert.match(todayPage, /No turn activity yet/);
  assert.doesNotMatch(todayPage, /No sales"|No tips"/);
});

test("Day View validates URL date and propagates selected business date", () => {
  assert.match(todayDashboard, /type TodayDashboardOptions = \{/);
  assert.match(todayDashboard, /function buildDayView/);
  assert.match(todayDashboard, /selectedDateInput/);
  assert.match(todayDashboard, /rawDate > input\.currentDate/);
  assert.match(todayDashboard, /selectedDate = rawDate/);
  assert.match(todayDashboard, /date: dayView\.selectedDate/);
  assert.match(todayDashboard, /loadBusinessHoursDashboardData\(\{/);
  assert.match(todayDashboard, /dayView\.isCurrentDate/);
  assert.match(todayDashboard, /mapWaitingVisits\(waitingVisitsResult\.data \?\? \[\], clock\.date\)/);
  assert.match(todayPage, /searchParams: Promise/);
  assert.match(todayPage, /getTodayDashboard\(context, \{ date: params\.date \}\)/);
  assert.match(todayPage, /function DayViewControl/);
  assert.match(todayPage, /method="get"/);
  assert.match(todayPage, /max=\{dayView\.maxDate\}/);
});

test("Quick Access persists stable IDs with server-side allow-list validation", () => {
  assert.match(quickAccesses, /TODAY_QUICK_ACCESS_DEFINITIONS/);
  assert.match(quickAccesses, /TODAY_QUICK_ACCESS_MAX_SELECTED = 8/);
  assert.match(quickAccesses, /validateAuthorizedIds/);
  assert.match(quickAccesses, /Duplicate shortcuts are not allowed/);
  assert.match(quickAccesses, /That shortcut is not recognized/);
  assert.match(quickAccesses, /You do not have permission to save that shortcut/);
  assert.match(quickAccesses, /shortcut_ids: shortcutIds/);
  assert.match(quickAccesses, /PGRST205/);
  assert.match(quickAccesses, /42501/);
  assert.doesNotMatch(quickAccesses, /localStorage|sessionStorage/);
});

test("Quick Access actions re-resolve salon context and never accept raw URLs", () => {
  assert.match(quickAccessActions, /"use server"/);
  assert.match(quickAccessActions, /requireSalonManagePageContext\("\/staff\/today"\)/);
  assert.match(quickAccessActions, /readShortcutId/);
  assert.match(quickAccessActions, /readShortcutIds/);
  assert.match(quickAccessActions, /getAll\("shortcutIds"\)/);
  assert.match(quickAccessActions, /saveTodayQuickAccessesAction/);
  assert.match(quickAccessActions, /direction !== "up" && direction !== "down"/);
  assert.match(quickAccessActions, /revalidatePath\("\/staff\/today"\)/);
  assert.doesNotMatch(quickAccessActions, /href|url|destination/i);
});

test("Quick Access UI is a launcher by default and saves local edit batches", () => {
  assert.match(quickAccessEditor, /"use client"/);
  assert.match(quickAccessEditor, /Edit quick accesses/);
  assert.match(quickAccessEditor, /saveTodayQuickAccessesAction/);
  assert.match(quickAccessEditor, /formData\.append\("shortcutIds", shortcut\.id\)/);
  assert.match(quickAccessEditor, /router\.refresh\(\)/);
  assert.match(quickAccessEditor, /setDraft\(configuration\.selected\)/);
  assert.match(quickAccessEditor, /Add shortcut/);
  assert.match(quickAccessEditor, /Cancel/);
  assert.match(quickAccessEditor, /Save/);
  assert.doesNotMatch(todayPage, /moveTodayQuickAccessAction|removeTodayQuickAccessAction|addTodayQuickAccessAction/);
  assert.doesNotMatch(quickAccessEditor, /name="href"|name="url"|destination/i);
});

test("Quick Access preference table is scoped per user and salon with RLS", () => {
  assert.match(quickAccessMigration, /today_quick_access_preferences/);
  assert.match(
    quickAccessMigration,
    /constraint today_quick_access_preferences_unique unique \(user_id, salon_id\)/,
  );
  assert.match(quickAccessMigration, /shortcut_ids text\[\]/);
  assert.match(quickAccessMigration, /array_length\(shortcut_ids, 1\) <= 8/);
  assert.match(quickAccessMigration, /enable row level security/);
  assert.match(quickAccessMigration, /user_id = public\.current_public_user_id\(\)/);
  assert.match(
    quickAccessMigration,
    /public\.user_has_salon_permission\(salon_id, array\['staff\.view'\]\)/,
  );
  assert.match(
    quickAccessGrantMigration,
    /grant select, insert, update, delete\s+on table public\.today_quick_access_preferences\s+to authenticated;/,
  );
});
