import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function fixture() {
  const calls = [];
  const context = { user: { id: 'owner', display_name: 'Owner' }, currentMembership: { role_code: 'OWNER' }, currentAccount: { id: 'account' }, currentSalon: { id: 'salon', name: 'Salon' }, permissionCodes: [] };
  const hours = { date: '2026-10-12', timeZone: 'UTC', buckets: [], isClosed: false, isFallback: false };
  const report = { reportDate: '2026-10-12', totals: { expectedTotal: 325, totalDiscount: 0, totalStaffEarned: 300, totalTip: 25 }, metadata: { finalizedTicketCount: 2 }, openTickets: [] };
  const record = (name, value) => { calls.push(name); return Promise.resolve(value); };
  const operationsModule = {};
  new Function('exports', ts.transpileModule(readFileSync('lib/today-checkin-operations.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(operationsModule);
  const client = { rpc: name => record(name, { data: name === 'phone_checkin_operations' ? { enabled: false, currentDay: true, businessDate: '2026-10-12', counts: { checkedIn: 0, waiting: 0, inService: 0, readyToPay: 0, submitted: 0, cancelled: 0 }, staff: { busy: 0, available: 0, offDuty: 0 }, staffStates: [] } : name.endsWith('timezone') ? 'UTC' : '2026-10-12', error: null }), from(table) {
    assert.equal(table, 'bookings');
    const query = { select() { return query; }, eq() { return query; }, lt() { return query; }, gt() { return query; }, order() { return query; }, returns: () => record('bookings', { data: [], error: null }) }; return query;
  } };
  const dependencies = {
 '@/lib/appointment-state': {appointmentSummary:()=>''},
 '@/lib/today-dashboard-sections': {TODAY_DASHBOARD_SECTIONS:['staff','bookings','waiting','financials','extras'],isTodayDashboardSection:x=>['staff','bookings','waiting','financials','extras'].includes(x)},
 '@/lib/today-statistics-server':{loadTodayStatistics:async()=>null},
 '@/lib/today-statistics':{buildDayStatistics:()=>null},
 '@/lib/read-context-scope':{getReadAbortSignal:()=>undefined,getReadRequestTiming:()=>undefined},
    '@/lib/today-checkin-operations': operationsModule,
    '@/lib/dashboard-deadline': { withDashboardDeadline: async work => {
      let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Couldn't load — retry.")), 10); })]); } finally { clearTimeout(timer); }
    } },
    'server-only': {},
    '@/lib/salon-business-clock': { getContextBusinessTimezone: () => record('timezone', 'UTC') },
    '@/lib/today-metric-assessment': { backlogTone: () => 'default', waitingAssessment: () => '' },
    '@/lib/app-notifications': { getCurrentAppNotifications: () => record('notifications', []) },
    '@/lib/bookings': { BOOKING_SELECT: '', BOOKING_LINE_SELECT: '', zonedDateTimeToUtcIso: ({ date, time }) => `${date}T${time}:00Z` },
    '@/lib/daily-pos-report': { createDailyPosReadContext:()=>({}), DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' }, getDailyPosReport: () => record('report', report), getDailyPosTodayFinancialData: () => record('financials', null) },
    '@/lib/current-context': { isOwnerMembership: membership => membership?.role_code === 'OWNER' },
    '@/lib/salon-business-hours': { unavailableSalonBusinessHours: () => hours, getSalonBusinessHoursForDate: () => record('hours', hours), buildSalonActivityBuckets: () => [], getLocalDateHour: () => 9 },
    '@/lib/staff-workdays': { STAFF_WORKDAY_STATUS_LABELS: { working: 'Working' }, getCurrentSalonStaffTodayBoard: () => record('staff', { staff: [{ id: 'staff', display_name: 'Staff', today_status: 'working', today_workday: null }] }), getCurrentSalonStaffActivitySummaries: () => record('staff-financials', new Map()) },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: () => client },
    '@/lib/customer-visits': { getCustomerVisitQueueForSalon: () => record('waiting', []) },
    '@/lib/today-quick-accesses': { getTodayQuickAccessConfiguration: () => record('shortcuts', { available: [], selected: [] }) },
    '@/types/booking': { normalizeBookingStatus: value => value },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync('lib/today-dashboard.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  return { calls, context, dependencies, run: options => exports.getTodayDashboard(context, options) };
}

test('Today first frame has actual staff and appointments without any optional financial reads', async () => {
  const value = fixture();
  const core = await value.run({ phase: 'core' });
  assert.equal(core.summary.staff.value, '1');
  assert.equal(core.summary.customers.value, '0');
  assert.deepEqual(core.pendingSections, { metrics: ['sales'], details: true });
  assert.equal(core.team[0].serviceSales, undefined);
  for (const area of ['hours', 'report', 'financials', 'staff-financials', 'shortcuts']) assert.ok(!value.calls.includes(area), area);
  assert.ok(!value.calls.includes('notifications'), 'shipped attention panel owns a separate read');
  const full = await value.run();
  assert.deepEqual(full.pendingSections, { metrics: [], details: false });
  assert.equal(full.summary.sales.value, '$325.00');
  for (const area of ['hours', 'report', 'financials', 'staff-financials', 'shortcuts']) assert.ok(value.calls.includes(area), area);
});

test('Today report-only viewers wait for their actual customer total and no-access viewers start no detail reads', async () => {
  const value = fixture();
  value.context.currentMembership.role_code = 'MANAGER';
  value.context.permissionCodes = ['staff.view', 'reports.view'];
  const core = await value.run({ phase: 'core' });
  assert.deepEqual(core.pendingSections.metrics, ['sales', 'customers']);
  assert.ok(!value.calls.includes('bookings'));
  value.calls.length = 0;
  value.context.permissionCodes = [];
  const denied = await value.run({ phase: 'core' });
  assert.equal(denied.noAccess, true);
  assert.ok(!value.calls.includes('staff'));
  assert.ok(!value.calls.includes('report'));
});

test('Hanging financial reads settle with explicit errors and do not hide attention', async () => {
  const value = fixture();
  value.dependencies['@/lib/daily-pos-report'].getDailyPosReport = () => new Promise(() => {});
  value.dependencies['@/lib/daily-pos-report'].getDailyPosTodayFinancialData = () => new Promise(() => {});
  value.dependencies['@/lib/app-notifications'].getCurrentAppNotifications = async () => [{id:'request',title:'Appointment request',href:'/bookings'}];
  const full = await value.run();
  assert.equal(full.pendingSections.details, false);
  assert.ok(full.loadErrors.some(item => item.area === 'financials'));
  assert.ok(full.loadErrors.some(item => item.area === 'reports'));
  assert.ok(!full.attention.some(item => item.id === 'notification:request'), 'attention now loads in its independent shipped panel');
  assert.notEqual(full.summary.sales.value, '$0.00');
});
