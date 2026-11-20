import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function moduleAt(path, dependencies = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  return exports;
}
const operationsModule = moduleAt('lib/today-checkin-operations.ts');
const current = '2026-11-11';
function operations(date = current) {
  return {
    enabled: true, currentDay: date === current, businessDate: date,
    counts: { checkedIn: 55, waiting: 31, inService: 2, readyToPay: 3, submitted: 18, cancelled: 1 },
    staff: date === current ? { busy: 1, available: 1, offDuty: 1 } : null,
    staffStates: date === current ? [{ staffId: 'a', state: 'busy', visitIds: ['visit'] }, { staffId: 'b', state: 'available', visitIds: [] }, { staffId: 'c', state: 'offDuty', visitIds: [] }] : [],
  };
}
function fixture({ date = current, permissionCodes = [], owner = true, rpcError = false, bookingsError = false } = {}) {
  const calls = [];
  const context = { user: { id: 'owner', display_name: 'Owner' }, currentMembership: { role_code: owner ? 'OWNER' : 'MANAGER' }, currentAccount: { id: 'account' }, currentSalon: { id: 'salon', name: 'Salon' }, permissionCodes };
  const hours = { date, timeZone: 'UTC', buckets: [], isClosed: false, isFallback: false };
  const report = { reportDate: date, totals: { expectedTotal: 325, totalDiscount: 0, totalStaffEarned: 300, totalTip: 25 }, metadata: { finalizedTicketCount: 9 }, openTickets: [] };
  const record = (name, value) => { calls.push(name); return Promise.resolve(value); };
  const client = { rpc: (name, args) => record(name, name === 'phone_checkin_operations' ? { data: operations(args.p_date), error: rpcError ? { message: 'Offline' } : null } : { data: name.endsWith('timezone') ? 'UTC' : current, error: null }), from(table) {
    assert.equal(table, 'bookings');
    const query = { select() { return query; }, eq() { return query; }, lt() { return query; }, gt() { return query; }, order() { return query; }, returns: () => record('bookings', { data: [], error: bookingsError ? { message: 'Bookings unavailable' } : null }) }; return query;
  } };
  const dependencies = {
 '@/lib/appointment-state': {appointmentSummary:()=>''},
 '@/lib/today-dashboard-sections': {TODAY_DASHBOARD_SECTIONS:['staff','bookings','waiting','financials','extras'],isTodayDashboardSection:x=>['staff','bookings','waiting','financials','extras'].includes(x)},
 '@/lib/today-statistics-server':{loadTodayStatistics:async()=>null},
 '@/lib/today-statistics':{buildDayStatistics:()=>null},
 '@/lib/read-context-scope':{getReadAbortSignal:()=>undefined,getReadRequestTiming:()=>undefined},
    'server-only': {}, '@/lib/today-checkin-operations': operationsModule,
    '@/lib/dashboard-deadline': { withDashboardDeadline: async value => value },
    '@/lib/salon-business-clock': { getContextBusinessTimezone: () => 'UTC' },
    '@/lib/today-metric-assessment': { backlogTone: () => 'default', waitingAssessment: () => ({ tone: 'default', label: 'Waiting' }) },
    '@/lib/app-notifications': { getCurrentAppNotifications: () => [] },
    '@/lib/bookings': { BOOKING_SELECT: '', BOOKING_LINE_SELECT: '', zonedDateTimeToUtcIso: ({ date, time }) => `${date}T${time}:00Z` },
    '@/lib/daily-pos-report': { createDailyPosReadContext:()=>({}), DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' }, getDailyPosReport: () => record('report', report), getDailyPosTodayFinancialData: () => record('financials', null) },
    '@/lib/current-context': { isOwnerMembership: value => value?.role_code === 'OWNER' },
    '@/lib/salon-business-hours': { unavailableSalonBusinessHours: () => hours, getSalonBusinessHoursForDate: () => hours, buildSalonActivityBuckets: () => [], getLocalDateHour: () => 9 },
    '@/lib/staff-workdays': { STAFF_WORKDAY_STATUS_LABELS: { checked_in: 'Checked in', working: 'Working' }, getCurrentSalonStaffTodayBoard: () => ({ staff: ['a', 'b', 'c'].map(id => ({ id, display_name: id, today_status: 'checked_in', today_workday: null })) }), getCurrentSalonStaffActivitySummaries: () => new Map() },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: () => client },
    '@/lib/customer-visits': { getCustomerVisitQueueForSalon: ({limit}) => record('queue-limit:' + limit, Array.from({length: 25}, (_, i) => ({id: `v${i}`, customerName: `C${i}`, source: 'walk_in', checkedInAt: '2026-11-11T10:00:00Z'}))) },
    '@/lib/today-quick-accesses': { getTodayQuickAccessConfiguration: () => ({ available: [], selected: [] }) },
    '@/types/booking': { normalizeBookingStatus: value => value },
  };
  const module = moduleAt('lib/today-dashboard.ts', dependencies);
  return { calls, run: phase => module.getTodayDashboard(context, { date, phase }) };
}

test('Today counts each visit once and is independent from capped waiting previews, booking counts and financial tickets', async () => {
  const fixtureValue = fixture({bookingsError: true});
  const value = await fixtureValue.run('core');
  assert.equal(value.summary.customers.label, 'Checked in');
  assert.equal(value.summary.customers.value, '55');
  assert.equal(value.summary.waiting.value, '31');
  assert.equal(value.rightNow.waitingClients.length, 5, 'preview stays compact while KPI uses complete aggregation');
  assert.equal(value.attention.find(item => item.id === 'waiting-clients').count, 31);
  assert.equal(value.summary.staff.label, 'Staff available');
  assert.equal(value.summary.staff.value, '1', 'attendance alone does not mean actively serving');
  assert.deepEqual(value.team.map(row => row.operationalState), ['busy', 'available', 'offDuty']);
  assert.equal(value.checkinOperations.counts.submitted, 18, 'never substitute booking completion or report ticket count');
  assert.equal(value.team[0].serviceSales, undefined, 'core does not expose financials');
  assert.ok(!fixtureValue.calls.includes('report'));
});

test('operational dashboard works without booking or financial permissions, and no-access reads remain denied', async () => {
  const restricted = fixture({owner: false, permissionCodes: ['staff.view']});
  const value = await restricted.run('core');
  assert.equal(value.noAccess, false);
  assert.equal(value.summary.customers.value, '55');
  assert.equal(value.summary.customers.href, null);
  assert.equal(value.summary.waiting.href, null);
  assert.equal(value.performance.sales, null);
  assert.equal(value.team[0].serviceSales, undefined);
  assert.ok(!restricted.calls.includes('bookings'));
  const denied = fixture({owner: false});
  assert.equal((await denied.run('core')).noAccess, true);
  assert.ok(!denied.calls.includes('phone_checkin_operations'));
});

test('historical visit totals do not claim live staff availability', async () => {
  const value = operationsModule.parseTodayCheckinOperations(operations('2026-11-10'),'2026-11-10');
  assert.equal(value.counts.checkedIn,55);
  assert.equal(value.staff,null);
  assert.deepEqual(value.staffStates,[]);
  assert.equal(value.currentDay,false);
});

test('failed aggregate reads show unavailable counts instead of false zeros or capped totals', async () => {
  const value = await fixture({rpcError: true}).run('core');
  assert.equal(value.checkinOperations, null);
  assert.equal(value.summary.customers.value, '--');
  assert.equal(value.summary.waiting.value, '--');
  assert.equal(value.summary.staff.value, '--');
  assert.ok(value.loadErrors.some(row => row.area === 'checkin_operations'));
  assert.ok(!value.attention.some(row => row.id === 'all-good'));
});

test('malformed or wrong-date operational responses cannot create plausible dashboard totals', () => {
  assert.throws(() => operationsModule.parseTodayCheckinOperations(operations(), '2026-11-10'));
  const bad = operations(); bad.counts.waiting = -1;
  assert.throws(() => operationsModule.parseTodayCheckinOperations(bad, current));
  const brokenStaff = operations(); brokenStaff.staffStates[0].state = 'done';
  assert.throws(() => operationsModule.parseTodayCheckinOperations(brokenStaff, current));
});

test('progressive section refresh preserves aggregate check-ins and reads operational totals only once per staff refresh', async()=>{
 const f=fixture();const shell=await f.run('shell');assert.ok(!f.calls.includes('phone_checkin_operations'));
 const staff=await f.run('staff');assert.equal(f.calls.filter(x=>x==='phone_checkin_operations').length,1);
 const {mergeTodayDashboardSection:merge}=moduleAt('lib/today-dashboard-sections.ts',{'./today-statistics':{mergeDayStatistics:()=>null}});
 let result=merge(shell,staff,'staff');assert.equal(result.checkinOperations.counts.checkedIn,55);
 for(const section of ['bookings','waiting','financials','extras']){const patch=await f.run(section);result=merge(result,patch,section);assert.equal(result.summary.customers.value,'55',section);assert.equal(result.summary.waiting.value,'31',section);assert.equal(result.checkinOperations.counts.submitted,18,section);}
 assert.equal(f.calls.filter(x=>x==='phone_checkin_operations').length,1);
});
