import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { AsyncLocalStorage } from 'node:async_hooks';

function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in deps, `Unexpected dependency ${name}`);
    return deps[name];
  }, exports);
  return exports;
}

const sections = load('lib/today-dashboard-sections.ts');
const day = '2026-10-18';
const hours = { buckets: [], closesAtLocal: '18:00', date: day, fallbackReason: null, isClosed: false, isFallback: false, opensAtLocal: '09:00', source: 'staff_availability_rules', spansOvernight: false, timeZone: 'UTC' };
const staff = [{ id: 'staff-a', display_name: 'Staff A', job_title: null, today_status: 'checked_in', today_workday: { check_in_at: `${day}T09:00:00.000Z`, check_out_at: null, queue_turn_count: 3 } }];
const quick = { available: [], canCustomize: true, loadError: null, maxSelected: 8, selected: [{ id: 'staff', label: 'Staff', href: '/staff', icon: 'staff', description: 'Staff' }] };
const report = {
  reportDate: day,
  totals: { expectedTotal: 145, totalDiscount: 5, totalStaffEarned: 120, totalTip: 20 },
  metadata: { excludedOpenTicketCount: 1, finalizedTicketCount: 2 },
};
const financialData = {
  activityPoints: [{ isExceptional: false, isLatest: true, label: '9 AM', service: 120, ticketCount: 2, tip: 20, total: 145 }],
  salesComparison: { direction: 'up', label: 'Up from previous days' },
  staffAttributionSource: 'earnings', tipAttributionSource: 'earnings',
  staffRows: [{ staffId: 'staff-a', staffName: 'Staff A', totalEarned: 120, tipAmount: 20, bigTurnCount: 2, smallTurnCount: 1, totalTurns: 3 }],
};
function fixture({ permissions = ['*'], fail = new Set(), reportWait, hoursWait, timing, timezoneWait, clockAuth } = {}) {
  const reads = [];
  const context = { user: { id: 'user-a', first_name: 'Owner' }, currentAccount: { id: 'account-a' }, currentSalon: { id: 'salon-a', name: 'Salon A' }, permissionCodes: permissions };
  const call = async (name, value) => {
    reads.push(name);
    if (fail.has(name)) throw new Error(`Unavailable ${name}`);
    if (name === 'report' && reportWait) await reportWait;
    if (name === 'hours' && hoursWait) await hoursWait;
    return structuredClone(value);
  };
  const db = {
    async rpc(name) { reads.push(name); return { data: day, error: null }; },
    from(name) {
      assert.equal(name, 'bookings');
      const builder = {
        select() { return this; }, eq() { return this; }, lt() { return this; }, gt() { return this; }, order() { return this; }, returns() { return this; },
        then(resolve, reject) {
          return call('bookings', [{ id: 'booking-a', confirmation_status: 'requested', customer_id: 'customer-a', customer: { id: 'customer-a', name: 'Customer A' }, end_at: `${day}T23:30:00.000Z`, start_at: `${day}T23:00:00.000Z`, status: 'pending', staff: null, staff_id: null, booking_lines: [] }])
            .then(data => ({ data, error: null }), error => ({ data: null, error: { message: error.message } })).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const server = load('lib/today-dashboard.ts', {
    'server-only': {},
    '@/lib/read-context-scope': { getReadRequestTiming: () => timing, getReadAbortSignal: () => undefined },
    '@/lib/today-dashboard-sections': sections,
    '@/lib/salon-business-clock': { getContextBusinessTimezone: async () => { reads.push('timezone'); if (clockAuth) await clockAuth(); if (timezoneWait) await timezoneWait; return 'UTC'; } },
    '@/lib/today-metric-assessment': { backlogTone: count => count > 0 ? 'warning' : 'default', waitingAssessment: timestamps => ({ tone: timestamps.length ? 'warning' : 'default', label: timestamps.length ? 'Clients waiting' : 'No clients waiting' }) },
    '@/lib/app-notifications': { getCurrentAppNotifications: () => call('notifications', [{ id: 'notice-a', title: 'Update', body: 'Review update', href: '/notifications' }]) },
    '@/lib/bookings': { BOOKING_LINE_SELECT: 'id', BOOKING_SELECT: 'id', zonedDateTimeToUtcIso: ({ date, time }) => `${date}T${time}:00.000Z` },
    '@/lib/daily-pos-report': { DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' }, createDailyPosReadContext: () => ({}), getDailyPosReport: () => call('report', report), getDailyPosTodayFinancialData: () => call('financials', financialData) },
    '@/lib/current-context': { isOwnerMembership: () => false },
    '@/lib/salon-business-hours': {
      getSalonBusinessHoursForDate: () => call('hours', hours),
      unavailableSalonBusinessHours: ({ date, timeZone, fallbackReason }) => ({ ...hours, date, timeZone, fallbackReason, isFallback: true }),
      getLocalDateHour: value => ({ date: value.slice(0, 10), hour: Number(value.slice(11, 13)) }),
      buildSalonActivityBuckets: ({ activeHours }) => [...activeHours].map(hour => ({ hours: [hour], exceptional: false, label: `${hour}` })),
    },
    '@/lib/staff-workdays': {
      getCurrentSalonStaffTodayBoard: async () => ({ staff: await call('staff', staff) }),
      getCurrentSalonStaffActivitySummaries: async () => new Map((await call('activity', [['staff-a', { assignedServiceAmount: 120, bigTurns: 2, smallTurns: 1, tipAmount: 20 }]]))),
      STAFF_WORKDAY_STATUS_LABELS: { checked_in: 'Checked in' },
    },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => { if (clockAuth) await clockAuth(); return db; } },
    '@/lib/customer-visits': { getCustomerVisitQueueForSalon: () => call('waiting', [{ id: 'visit-a', customerId: 'customer-a', customerName: 'Waiting client', checkedInAt: `${day}T10:00:00.000Z`, serviceLabel: 'Service', source: 'walk_in' }]) },
    '@/lib/today-quick-accesses': { getTodayQuickAccessConfiguration: () => call('quick', quick) },
    '@/types/booking': { normalizeBookingStatus: status => status === 'scheduled' ? 'confirmed' : status },
  });
  return { ...server, context, reads };
}

test('shell resolves only authoritative clock and leaves unread values unknown', async () => {
  const f = fixture();
  const shell = await f.getTodayDashboard(f.context, { phase: 'shell' });
  assert.deepEqual(f.reads, ['timezone', 'get_salon_business_date']);
  assert.deepEqual(shell.pendingSections.sections, sections.TODAY_DASHBOARD_SECTIONS);
  assert.deepEqual(Object.values(shell.summary).map(metric => metric.value), ['--', '--', '--', '--']);
  assert.deepEqual(shell.attention, []);
  assert.equal(shell.performance.emptyLabel, null);
});

test('the authoritative date read starts while display timezone is pending', async () => {
  let release;
  const timezoneWait = new Promise(resolve => { release = resolve; });
  const f = fixture({ timezoneWait });
  const pending = f.getTodayDashboard(f.context, { phase: 'shell' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.reads.includes('get_salon_business_date'), 'independent date RPC must not wait for the display timezone');
  release();
  const result = await pending;
  assert.equal(result.date, day);
  assert.equal(result.timezone, 'UTC');
  assert.deepEqual(f.reads, ['timezone', 'get_salon_business_date']);
});

test('parallel clock factories join pending raw authorization without caching a settled result', async () => {
  const reads = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  let release, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  const key = Symbol('controlled-clock-authorization');
  const clockAuth = () => reads.coalesceReadInFlight(key, 'same-private-request-authority', async () => { calls++; await held; });
  await reads.runWithReadContext(async () => {
    const f = fixture({ clockAuth });
    const pending = f.getTodayDashboard(f.context, { phase: 'shell' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'both independently authorized clock readers share only their pending raw check');
    release();
    await pending;
    assert.equal(calls, 1);
    await clockAuth();
    assert.equal(calls, 2, 'a subsequent authorization still performs a fresh read');
  });
});

test('each operational source avoids report, earnings, other operations and extras reads', async () => {
  for (const phase of ['staff', 'bookings', 'waiting']) {
    const f = fixture();
    const patch = await f.getTodayDashboard(f.context, { phase });
    assert.ok(f.reads.includes(phase));
    assert.equal(patch.pendingSections.sections.includes(phase), false);
    for (const other of ['staff', 'bookings', 'waiting', 'report', 'financials', 'activity', 'notifications', 'quick'].filter(item => item !== phase)) assert.equal(f.reads.includes(other), false, `${phase} must not read ${other}`);
    assert.equal(f.reads.filter(name => name.includes('timezone')).length, 1);
  }
});

test('slow financial report cannot delay staff, bookings or waiting phase completion', async () => {
  let release;
  const reportWait = new Promise(resolve => { release = resolve; });
  const f = fixture({ reportWait });
  let financialReady = false;
  const financial = f.getTodayDashboard(f.context, { phase: 'financials' }).then(value => { financialReady = true; return value; });
  for (const phase of ['staff', 'bookings', 'waiting']) {
    const patch = await f.getTodayDashboard(f.context, { phase });
    assert.equal(patch.loadErrors.length, 0);
  }
  assert.equal(financialReady, false);
  release();
  await financial;
});

test('staff and booking source reads start before a deferred business-hours chart dependency', async () => {
  for (const phase of ['staff', 'bookings']) {
    let release;
    const hoursWait = new Promise(resolve => { release = resolve; });
    const f = fixture({ hoursWait });
    let settled = false;
    const result = f.getTodayDashboard(f.context, { phase }).then(value => { settled = true; return value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(f.reads.includes(phase));
    assert.ok(f.reads.includes('hours'));
    assert.equal(settled, false);
    release();
    await result;
  }
});

test('all phase completion orders preserve legacy full financial and operational result', async () => {
  const f = fixture();
  const full = await f.getTodayDashboard(f.context, { phase: 'full' });
  const shell = await f.getTodayDashboard(f.context, { phase: 'shell' });
  const patches = Object.fromEntries(await Promise.all(sections.TODAY_DASHBOARD_SECTIONS.map(async phase => [phase, await f.getTodayDashboard(f.context, { phase })])));
  const normalize = value => {
    const rest = { ...value };
    delete rest.generatedAt;
    delete rest.pendingSections;
    return rest;
  };
  for (const order of [sections.TODAY_DASHBOARD_SECTIONS, [...sections.TODAY_DASHBOARD_SECTIONS].reverse(), ['financials', 'waiting', 'extras', 'staff', 'bookings']]) {
    const merged = order.reduce((base, phase) => sections.mergeTodayDashboardSection(base, patches[phase], phase), shell);
    assert.deepEqual(normalize(merged), normalize(full));
    assert.deepEqual(merged.pendingSections, { sections: [], metrics: [], details: false });
  }
});

test('failed financial group retains prior totals, trends and staff money together; retry clears only its error', async () => {
  const good = fixture();
  const base = await good.getTodayDashboard(good.context, { phase: 'full' });
  const broken = fixture({ fail: new Set(['financials']) });
  const patch = await broken.getTodayDashboard(broken.context, { phase: 'financials' });
  const merged = sections.mergeTodayDashboardSection(base, patch, 'financials');
  assert.deepEqual(merged.summary.sales, base.summary.sales);
  assert.deepEqual(merged.performance, base.performance);
  assert.deepEqual(merged.team, base.team);
  assert.equal(merged.loadErrors[0].section, 'financials');
  const staffRefresh = sections.mergeTodayDashboardSection(merged, await good.getTodayDashboard(good.context, { phase: 'staff' }), 'staff');
  assert.deepEqual(staffRefresh.team, base.team, 'a successful roster refresh retains the last successful money group during a financial error');
  const recovered = sections.mergeTodayDashboardSection(merged, await good.getTodayDashboard(good.context, { phase: 'financials' }), 'financials');
  assert.deepEqual(recovered.loadErrors, []);
});

test('failed booking read never erases warm bookings, waiting or financials', async () => {
  const good = fixture();
  const base = await good.getTodayDashboard(good.context, { phase: 'full' });
  const broken = fixture({ fail: new Set(['bookings']) });
  const patch = await broken.getTodayDashboard(broken.context, { phase: 'bookings' });
  const merged = sections.mergeTodayDashboardSection(base, patch, 'bookings');
  assert.deepEqual(merged.summary, base.summary);
  assert.deepEqual(merged.rightNow, base.rightNow);
  assert.deepEqual(merged.performance, base.performance);
  assert.ok(merged.attention.some(item => item.id === 'pending-bookings'));
});

test('fresh financial group clears missing-row money while staff remains the roster authority', async () => {
  const f = fixture();
  const base = await f.getTodayDashboard(f.context, { phase: 'full' });
  const patch = await f.getTodayDashboard(f.context, { phase: 'financials' });
  const stale = { ...base, team: [...base.team, { ...base.team[0], id: 'removed-staff', serviceSales: 999 }] };
  const merged = sections.mergeTodayDashboardSection(stale, patch, 'financials');
  assert.deepEqual(merged.team[0], base.team[0]);
  assert.equal(merged.team[1].id, 'removed-staff');
  assert.equal(merged.team[1].earnings, undefined);
  assert.equal(merged.team[1].serviceSales, undefined);
  assert.deepEqual(merged.team[1].financialAttribution, { services: 'unavailable', tips: 'unavailable' });
});

test('new staff survives older financial roster in both arrival orders with unknown money', async () => {
  const f = fixture();
  const shell = await f.getTodayDashboard(f.context, { phase: 'shell' });
  const staffPatch = await f.getTodayDashboard(f.context, { phase: 'staff' });
  staffPatch.team.push({ ...staffPatch.team[0], id: 'new-staff', displayName: 'New Staff' });
  const finance = await f.getTodayDashboard(f.context, { phase: 'financials' });
  for (const order of [['staff', 'financials'], ['financials', 'staff']]) {
    const merged = order.reduce((base, section) => sections.mergeTodayDashboardSection(base, section === 'staff' ? staffPatch : finance, section), shell);
    assert.deepEqual(merged.team.map(member => member.id), ['staff-a', 'new-staff']);
    assert.equal(merged.team[1].earnings, undefined);
    assert.equal(merged.team[1].serviceSales, undefined);
    assert.deepEqual(merged.team[1].financialAttribution, { services: 'unavailable', tips: 'unavailable' });
  }
});

test('permission and historical gates suppress reads and remove ineligible source requests', async () => {
  const denied = fixture({ permissions: [] });
  const noAccess = await denied.getTodayDashboard(denied.context, { phase: 'financials' });
  assert.equal(noAccess.noAccess, true);
  assert.deepEqual(denied.reads, ['timezone', 'get_salon_business_date']);
  assert.deepEqual(sections.getTodayDashboardSections(noAccess), []);
  const restricted = fixture({ permissions: ['staff.view'] });
  const shell = await restricted.getTodayDashboard(restricted.context, { phase: 'shell' });
  assert.deepEqual(sections.getTodayDashboardSections(shell), ['staff', 'extras']);
  for (const phase of ['bookings', 'waiting', 'financials']) await restricted.getTodayDashboard(restricted.context, { phase });
  assert.equal(restricted.reads.includes('report'), false);
  assert.equal(restricted.reads.includes('financials'), false);
  assert.equal(restricted.reads.includes('activity'), false);
  const historical = fixture();
  const old = await historical.getTodayDashboard(historical.context, { phase: 'waiting', date: '2026-10-17' });
  assert.equal(historical.reads.includes('waiting'), false);
  assert.equal(sections.getTodayDashboardSections(old).includes('waiting'), false);
});

test('foreign date, timezone and changed permission patches are not merged', async () => {
  const f = fixture();
  const base = await f.getTodayDashboard(f.context, { phase: 'shell' });
  const patch = await f.getTodayDashboard(f.context, { phase: 'financials' });
  for (const altered of [{ ...patch, date: '2026-10-17' }, { ...patch, timezone: 'America/Chicago' }, { ...patch, dayView: { ...patch.dayView, currentDate: '2026-10-19', isCurrentDate: false } }, { ...patch, permissions: { ...patch.permissions, canViewReports: false } }, { ...patch, noAccess: true }]) assert.equal(sections.mergeTodayDashboardSection(base, altered, 'financials'), base);
});

test('native permission key order preserves sections but every actual permission change still rejects them', async () => {
  const f = fixture();
  const shell = await f.getTodayDashboard(f.context, { phase: 'shell' });
  const patch = await f.getTodayDashboard(f.context, { phase: 'financials' });
  const reordered = { ...patch, permissions: Object.fromEntries(Object.entries(patch.permissions).reverse()) };
  assert.notEqual(JSON.stringify(shell.permissions), JSON.stringify(reordered.permissions));
  assert.equal(sections.getTodayDashboardPermissionsIdentity(shell.permissions), sections.getTodayDashboardPermissionsIdentity(reordered.permissions));
  const merged = sections.mergeTodayDashboardSection(shell, reordered, 'financials');
  assert.notEqual(merged, shell);
  assert.deepEqual(merged.summary.sales, patch.summary.sales);
  for (const key of Object.keys(patch.permissions)) {
    const changed = { ...reordered, permissions: { ...reordered.permissions, [key]: !patch.permissions[key] } };
    assert.notEqual(sections.getTodayDashboardPermissionsIdentity(shell.permissions), sections.getTodayDashboardPermissionsIdentity(changed.permissions), key);
    assert.equal(sections.mergeTodayDashboardSection(shell, changed, 'financials'), shell, key);
  }
  const missing = { ...patch.permissions }; delete missing.canViewReports;
  for (const permissions of [missing, { ...patch.permissions, unexpectedPermission: true }]) {
    assert.notEqual(sections.getTodayDashboardPermissionsIdentity(shell.permissions), sections.getTodayDashboardPermissionsIdentity(permissions));
    assert.equal(sections.mergeTodayDashboardSection(shell, { ...patch, permissions }, 'financials'), shell);
  }
});

test('same admitted resource scope accepts a renamed salon display label and keeps the shell header', async () => {
  const f = fixture();
  const shell = await f.getTodayDashboard(f.context, { phase: 'shell' });
  const staffPatch = await f.getTodayDashboard(f.context, { phase: 'staff' });
  staffPatch.salonName = 'Renamed Salon A';
  const merged = sections.mergeTodayDashboardSection(shell, staffPatch, 'staff');
  assert.equal(merged.summary.staff.value, '1');
  assert.equal(merged.pendingSections.sections.includes('staff'), false);
  assert.equal(merged.salonName, shell.salonName);
});

test('legacy core still omits financial/extras reads and keeps existing pending contract', async () => {
  const f = fixture();
  const core = await f.getTodayDashboard(f.context, { phase: 'core' });
  assert.deepEqual(core.pendingSections, { metrics: ['sales'], details: true });
  assert.deepEqual([...f.reads].sort(), ['timezone', 'get_salon_business_date', 'staff', 'bookings', 'waiting'].sort());
  assert.equal(core.team[0].earnings, undefined);
});

test('request profiling attributes only loaded Today sources and preserves their results', async () => {
  const expected = {
    shell: ['clock'],
    staff: ['clock', 'hours', 'staff_board'],
    bookings: ['clock', 'hours', 'bookings'],
    waiting: ['clock', 'waiting'],
    financials: ['clock', 'hours', 'staff_board', 'staff_activity', 'financial_report', 'financial_compare'],
    extras: ['clock', 'extras', 'extras'],
  };
  for (const [phase, names] of Object.entries(expected)) {
    const recorded = [];
    const profiled = fixture({ timing: { measure(stage, read) { recorded.push(stage); return read(); } } });
    const baseline = fixture();
    const actual = await profiled.getTodayDashboard(profiled.context, { phase });
    const before = await baseline.getTodayDashboard(baseline.context, { phase });
    assert.deepEqual(recorded.sort(), [...names].sort(), phase);
    assert.deepEqual(profiled.reads, baseline.reads, phase + ' must not add backend work');
    const actualData = Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'generatedAt'));
    const beforeData = Object.fromEntries(Object.entries(before).filter(([key]) => key !== 'generatedAt'));
    assert.deepEqual(actualData, beforeData, phase + ' must preserve dashboard data');
  }
});
