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
  const client = { rpc: name => record(name, { data: name.endsWith('timezone') ? 'UTC' : '2026-10-12', error: null }), from(table) {
    assert.equal(table, 'bookings');
    const query = { select() { return query; }, eq() { return query; }, lt() { return query; }, gt() { return query; }, order() { return query; }, returns: () => record('bookings', { data: [], error: null }) }; return query;
  } };
  const sections={};new Function('exports',ts.transpileModule(readFileSync('lib/today-dashboard-sections.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(sections);
  const dependencies = {
    '@/lib/today-dashboard-sections':sections,
    '@/lib/read-context-scope':{getReadAbortSignal:()=>undefined,getReadRequestTiming:()=>undefined},
    '@/lib/dashboard-deadline': { withDashboardDeadline: async work => {
      let timer; try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Couldn't load — retry.")), 10); })]); } finally { clearTimeout(timer); }
    } },
    'server-only': {},
    '@/lib/salon-business-clock': { getContextBusinessTimezone: () => record('timezone', 'UTC') },
    '@/lib/today-metric-assessment': { backlogTone: () => 'default', waitingAssessment: () => '' },
    '@/lib/app-notifications': { getCurrentAppNotifications: () => record('notifications', []) },
    '@/lib/bookings': { BOOKING_SELECT: '', BOOKING_LINE_SELECT: '', zonedDateTimeToUtcIso: ({ date, time }) => `${date}T${time}:00Z` },
    '@/lib/daily-pos-report': { DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' }, createDailyPosReadContext:()=>({fixture:true}), getDailyPosReport: () => record('report', report), getDailyPosTodayFinancialData: () => record('financials', null) },
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
  assert.ok(!value.calls.includes('notifications'),'core leaves extras to their independent phase');
  await value.run({phase:'extras'});assert.ok(value.calls.includes('notifications')); 
  const full = await value.run();
  assert.deepEqual(full.pendingSections, { metrics: [], details: false });
  assert.equal(full.summary.sales.value, '$325.00');
  for (const area of ['hours', 'report', 'financials', 'staff-financials', 'notifications', 'shortcuts']) assert.ok(value.calls.includes(area), area);
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
  assert.ok(full.attention.some(item => item.id === 'notification:request'));
  assert.notEqual(full.summary.sales.value, '$0.00');
});

test('Today shell starts no optional reads; each requested phase settles independently',async()=>{
 const phases=['staff','bookings','waiting','financials','extras'];
 const shellFixture=fixture(),shell=await shellFixture.run({phase:'shell'});
 assert.deepEqual(shell.pendingSections.sections,phases);
 assert.deepEqual(shell.pendingSections.metrics,['staff','waiting','customers','sales']);
 for(const name of ['staff','bookings','waiting','report','financials','notifications','shortcuts'])assert.ok(!shellFixture.calls.includes(name),name);
 assert.ok(!shell.attention.some(item=>item.label==='All good'));
 for(const phase of phases){const f=fixture(),data=await f.run({phase});assert.ok(!data.pendingSections.sections.includes(phase));for(const other of phases.filter(x=>x!==phase))assert.ok(data.pendingSections.sections.includes(other),`${phase} must not settle ${other}`);
  if(phase!=='extras')assert.ok(!f.calls.includes('notifications'));
  if(phase!=='financials')assert.ok(!f.calls.includes('report'));
  assert.equal(f.calls.filter(name=>name==='get_salon_business_date').length,1);
 }
});

test('financial phase shares one read context and keeps measured clock/stage hooks',async()=>{
 const f=fixture(),sentinel={synthetic:'read-context'},seen=[],stages=[];
 f.dependencies['@/lib/read-context-scope'].getReadRequestTiming=()=>({measure:(stage,read)=>{stages.push(stage);return read();}});
 f.dependencies['@/lib/daily-pos-report'].createDailyPosReadContext=()=>sentinel;
 f.dependencies['@/lib/daily-pos-report'].getDailyPosReport=async(_date,_context,readContext)=>{seen.push(readContext);return{totals:{},metadata:{},openTickets:[]};};
 f.dependencies['@/lib/daily-pos-report'].getDailyPosTodayFinancialData=async input=>{seen.push(input.readContext);return null;};
 await f.run({phase:'financials'});
 assert.equal(seen.length,2);assert.ok(seen.every(value=>value===sentinel));assert.ok(stages.includes('clock'));assert.ok(stages.includes('financial_report'));assert.ok(stages.includes('financial_compare'));
});
