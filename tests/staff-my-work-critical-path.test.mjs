import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';
import ts from 'typescript';

// Actual named-read route, adapter, loader, Staff getters, session gates and SDK.
// Only membership reconstruction, presentation-only URL helpers and the selected
// pay-tab boundary are injected. Every wire operation is a synthetic read.
const origin = 'https://staff-critical-path.invalid';
const codeCache = new Map();
const envNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const previousEnv = envNames.map(name => process.env[name]);
const previousFetch = globalThis.fetch;
let externalFetchAttempts = 0;
globalThis.fetch = () => { externalFetchAttempts++; throw new Error('Uninjected network is forbidden'); };
process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
after(() => {
  globalThis.fetch = previousFetch;
  envNames.forEach((name, i) => {
    if (previousEnv[i] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[i];
  });
  assert.equal(externalFetchAttempts, 0);
});

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function until(predicate, label) {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await tick(); }
  assert.fail('Synthetic read did not reach ' + label);
}
function load(file, dependencies = {}, globals = {}) {
  let code = codeCache.get(file);
  if (!code) {
    code = ts.transpileModule(readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    codeCache.set(file, code);
  }
  const exports = {}, bindings = { console: { log() {}, warn() {}, error() {} }, ...globals };
  new Function('require', 'exports', ...Object.keys(bindings), code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name} in ${file}`);
    return dependencies[name];
  }, exports, ...Object.values(bindings));
  return exports;
}

function fixture({ hold = {}, fail = {}, snapshotDate = '2026-10-21', missingUser = false,
  missingStaff = false, duplicateStaff = false, selectedData = null, populated = false, now } = {}) {
  const request = new AsyncLocalStorage();
  const reads = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const timing = load('lib/read-request-timing.ts', {}, now ? { performance: { now } } : {});
  const events = [], payCalls = [];
  const ids = suffix => ({
    auth: `00000000-0000-4000-8000-0000000000${suffix}1`,
    viewer: `00000000-0000-4000-8000-0000000000${suffix}2`,
    salon: `00000000-0000-4000-8000-0000000000${suffix}3`,
    account: `00000000-0000-4000-8000-0000000000${suffix}4`,
    staff: `00000000-0000-4000-8000-0000000000${suffix}5`,
  });
  const contextFor = suffix => {
    const id = ids(suffix);
    return {
      user: missingUser ? null : { id: id.viewer, auth_user_id: id.auth, status: 'active', first_name: 'Synthetic', avatar_url: null },
      accountId: id.account, currentAccount: { id: id.account, status: 'active' },
      currentSalon: { id: id.salon, status: 'active' }, currentStaffSalon: { id: id.salon },
      currentWorkspace: { id: 'staff:' + id.salon }, workspaceType: 'salon', salonMode: 'staff',
      activeRole: { code: 'staff' }, currentMembership: null, permissionCodes: [], permissions: [],
    };
  };
  const staffFor = suffix => ({ id: ids(suffix).staff, salon_id: ids(suffix).salon,
    account_user_id: ids(suffix).viewer, is_active: true, display_name: 'Synthetic Staff', public_profile_photo_path: null });
  const experience = load('lib/experience-context.ts', { 'server-only': {}, 'node:crypto': crypto });
  const scopeFor = suffix => experience.getExperienceContext(contextFor(suffix)).scope;

  function operation(url) {
    if (url.pathname === '/auth/v1/user') return 'auth';
    if (url.pathname === '/rest/v1/users') return 'status';
    if (url.pathname === '/rest/v1/account_login_sessions') return 'session';
    if (url.pathname === '/rest/v1/staff') return 'staff';
    if (url.pathname === '/rest/v1/staff_workdays') return 'attendance';
    if (url.pathname === '/rest/v1/rpc/get_salon_business_timezone') return 'timezone';
    if (url.pathname === '/rest/v1/rpc/get_my_staff_daily_snapshot') return 'snapshot';
    if (url.pathname === '/rest/v1/rpc/get_my_staff_greeting_context') return 'greeting';
    assert.fail('Unregistered synthetic backend read');
  }
  async function backend(input, init = {}) {
    const url = new URL(String(input));
    assert.equal(url.origin, origin);
    const kind = operation(url), suffix = request.getStore().suffix, id = ids(suffix);
    const method = init.method ?? 'GET';
    assert.equal(method, ['timezone', 'snapshot', 'greeting'].includes(kind) ? 'POST' : 'GET');
    const event = { suffix, kind, method, completed: false, signal: init.signal };
    events.push(event);
    if (method === 'POST') {
      assert.deepEqual(JSON.parse(init.body), { p_salon_id: id.salon });
    }
    if (kind === 'staff' || kind === 'attendance') {
      assert.equal(url.searchParams.get('salon_id'), 'eq.' + id.salon);
    }
    if (kind === 'attendance') {
      event.workDate = url.searchParams.get('work_date');
      assert.equal(url.searchParams.get('staff_id'), 'eq.' + id.staff);
    }
    await tick();
    if (hold[kind]) await hold[kind].promise;
    const failure = fail[kind];
    if (failure === 'network') throw new TypeError('Synthetic transport error');
    if (failure) return Response.json({ code: 'fixture_failure', message: 'Synthetic unavailable read' }, { status: failure });
    let data;
    if (kind === 'auth') data = { id: id.auth, aud: 'authenticated', role: 'authenticated', user_metadata: {} };
    if (kind === 'status') data = { status: 'active' };
    if (kind === 'session') data = { revoked_at: null };
    if (kind === 'staff') data = missingStaff ? [] : duplicateStaff ? [staffFor(suffix), { ...staffFor(suffix), id: ids('9').staff }] : [staffFor(suffix)];
    if (kind === 'timezone') data = 'UTC';
    if (kind === 'snapshot') {
      const ticket = { id: 'synthetic-ticket', ticket_number: null, status: 'closed', opened_at: null, closed_at: null, customer: null };
      data = { date: snapshotDate, staff_id: id.staff,
        earnings: populated ? [
          { id: 'synthetic-earning', staff_id: id.staff, ticket_id: ticket.id, ticket, service_total: '25', tip_amount: '3', total_earning: '28', big_turn_count: '1', small_turn_count: '0' },
          { id: 'excluded-earning', staff_id: id.staff, ticket_id: 'excluded-ticket', ticket: { ...ticket, id: 'excluded-ticket', status: 'cancelled' } },
        ] : [],
        items: populated ? [{ id: 'synthetic-item', assigned_staff_id: id.staff, pos_ticket_id: ticket.id, ticket,
          created_at: '2000-02-29T12:00:00Z', line_total: '25', quantity: '1', unit_price: '25', service: { id: 'synthetic-service', name: 'Synthetic service' } }] : [],
      };
    }
    if (kind === 'greeting') data = { date: snapshotDate, worked_yesterday: false, yesterday_services: 0, history_available: true };
    if (kind === 'attendance') data = { id: id.staff, salon_id: id.salon, staff_id: id.staff, work_date: snapshotDate, status: 'checked_in' };
    event.completed = true;
    return Response.json(data);
  }
  const bounded = load('lib/bounded-get.ts', {}, { fetch: backend });
  const auth = load('lib/supabase/auth-rest.ts', {
    '@/lib/bounded-get': bounded, '@/lib/read-context-scope': reads,
    '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, read) => read(), observeAppLocalCommandBackendStatus() {} },
    './auth-rejection': load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } }),
  }, { fetch: backend });
  const server = load('lib/supabase/server.ts', {
    'node:crypto': crypto, '@supabase/supabase-js': { createClient },
    '@/lib/abuse-context': { safetyRequestHeaders: async () => ({}) },
    '@/lib/account-security-shared': { ACCOUNT_LOGIN_SESSION_COOKIE: 'synthetic-session', isAccountLoginSessionId: value => value === 'synthetic-session-id' },
    '@/lib/users/account-status': load('lib/users/account-status.ts'), '@/lib/read-context-scope': reads,
    'next/headers': { headers: async () => new Headers(), cookies: async () => ({ get(name) {
      if (name === 'sb-access-token') return { value: 'synthetic-token-' + request.getStore().suffix };
      if (name === 'synthetic-session') return { value: 'synthetic-session-id' };
    } }) },
    './session-policy': { ADMIN_SESSION_COOKIE: 'admin', REMEMBER_LOGIN_COOKIE: 'remember', sessionCookieOptions: () => ({}) },
    './auth-rest': auth,
    './auth-rejection': load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } }),
  });
  const current = {
    getCurrentStaffBusinessContext: async () => contextFor(request.getStore().suffix),
    getCurrentBusinessContext: async () => contextFor(request.getStore().suffix),
  };
  // No global React cache substitute: separate requests must rerun every gate.
  const react = { cache: read => read };
  const account = load('lib/staff-account.ts', { 'server-only': {} });
  const identity = load('lib/staff-portal-identity.ts', {
    'server-only': {}, react, '@/lib/current-context': current,
    '@/lib/experience-context': experience, '@/lib/read-context-scope': reads,
    '@/lib/supabase/server': server, '@/lib/staff-account': account,
  });
  const clock = load('lib/salon-business-clock.ts', { 'server-only': {}, react, '@/lib/supabase/server': server, '@/lib/read-context-scope': reads });
  const workdays = load('lib/staff-workdays.ts', {
    'server-only': {}, '@/lib/salon-business-clock': clock, '@/lib/current-context': current,
    '@/lib/staff-account': account, '@/lib/supabase/server': server,
    '@/lib/supabase/postgrest-errors': { isMissingSupabaseColumnError: () => false }, '@/lib/staff-portal-identity': identity,
  });
  const profile = load('lib/staff-profile.ts', {
    'server-only': {}, '@/lib/account-avatar': { safeAccountAvatarUrl: () => null },
    '@/lib/salon-profile-media': { SALON_PROFILE_MEDIA_BUCKET: 'synthetic', normalizeSalonProfileMediaPath: value => value ?? null },
    '@/lib/supabase/server': server,
  });
  const pay = name => async input => {
    const suffix = request.getStore().suffix;
    payCalls.push({ name, input, suffix });
    if (hold.pay) await hold.pay.promise;
    if (fail.pay) throw new Error('Synthetic selected pay tab failure');
    return typeof selectedData === 'function' ? selectedData({ context: contextFor(suffix), staff: staffFor(suffix) }) : selectedData;
  };
  const resource = load('lib/staff-my-work-resource-server.ts', {
    'server-only': {}, '@/lib/experience-context': experience,
    '@/lib/payroll': { getCurrentStaffPayrollPortalData: pay('payroll'), getCurrentStaffAnalysisPortalData: pay('analysis') },
    '@/lib/staff-portal-identity': identity, '@/lib/staff-profile': profile, '@/lib/staff-workdays': workdays,
    './staff-my-work-experience': load('lib/staff-my-work-experience.ts'), '@/lib/read-context-scope': reads,
  });
  const role = load('lib/app-local-role-resources-server.ts', {
    'server-only': {}, 'node:crypto': crypto, './request-business-context': {}, './experience-context': experience,
    './current-context': {}, './supabase/server': server, './customer-bookings': {}, './account-social': {},
    './customer-experience-resource-server': {}, './staff-experience-resource-server': {},
    './staff-portal-identity': identity, './staff-my-work-resource-server': resource, './today-dashboard': {},
    './today-dashboard-sections': {}, './explore-reference-favorites': {}, './bounded-get': bounded,
    './read-context-scope': reads, './app-local-role-resources': load('lib/app-local-role-resources.ts'),
  });
  const readers = Object.fromEntries([...readFileSync('app/api/app-local/read/route.ts', 'utf8').matchAll(/import \{ (\w+) \} from "(@\/lib\/app-local-[^"]+)";/g)]
    .map(([, name, file]) => [file, { [name]: async () => null }]));
  const route = load('app/api/app-local/read/route.ts', {
    ...readers, 'next/server': { connection: async () => {} }, 'next/headers': { headers: async () => new Headers() },
    '@/lib/app-local-scope-id': load('lib/app-local-scope-id.ts'), '@/lib/read-context-scope': reads,
    '@/lib/read-request-timing': timing, '@/lib/app-local-role-resources-server': role,
    '@/lib/read-request-trace-protocol': load('lib/read-request-trace-protocol.ts', { './app-local-command-trace-protocol': load('lib/app-local-command-trace-protocol.ts') }),
  });
  function run({ suffix = '1', tab = 'daily', scope = scopeFor(suffix), staffId = ids(suffix).staff, signal, etag } = {}) {
    const requestURL = origin + '/api/app-local/read?' + new URLSearchParams({ name: 'staff.my-work', scope, args: JSON.stringify({ staffId, tab }) });
    return request.run({ suffix }, () => route.GET(new Request(requestURL, { signal, headers: etag ? { 'if-none-match': etag } : {} })));
  }
  return { run, events, payCalls, ids, scopeFor, contextFor, staffFor,
    count: kind => events.filter(event => event.kind === kind).length };
}

test('independent timezone and greeting reads start while real AssignedWork snapshot is still held', { timeout: 5000 }, async () => {
  const snapshot = deferred(), f = fixture({ hold: { snapshot } });
  const pending = f.run();
  try {
    await until(() => f.count('snapshot') === 1, 'held real Staff snapshot');
    await tick();
    assert.equal(f.count('greeting'), 1, 'Salon-only greeting must not wait for AssignedWork');
    assert.equal(f.count('timezone'), 2, 'Independent display timezone must overlap AssignedWork, alongside its own clock lookup');
    assert.equal(f.count('attendance'), 0, 'Attendance must wait for the authoritative snapshot date');
  } finally {
    snapshot.resolve();
    const response = await pending;
    assert.equal(response.status, 200);
  }
});

test('complete Daily DTO retains authoritative snapshot date, attendance, empty state, and stable ETag', async () => {
  const f = fixture({ snapshotDate: '2000-02-29' });
  const first = await f.run(), value = await first.json();
  assert.equal(first.status, 200);
  assert.equal(value.data.today, '2000-02-29');
  assert.deepEqual(value.data.workTickets, []);
  assert.equal(value.data.excludedTicketCount, 0);
  assert.equal(value.data.workStatus, 'checked_in');
  assert.equal(value.data.salonTimezone, 'UTC');
  assert.equal(value.data.greetingHistory.date, '2000-02-29');
  assert.equal(value.data.staff.id, f.ids('1').staff);
  assert.equal(value.scope, f.scopeFor('1'));
  assert.equal(f.events.find(event => event.kind === 'attendance').workDate, 'eq.2000-02-29');
  assert.equal(f.payCalls.length, 0);
  assert.equal((await f.run({ etag: first.headers.get('etag') })).status, 304);
  for (const kind of ['snapshot', 'greeting']) assert.equal(f.count(kind), 2, 'One read RPC per resource request, including 304 validation');
  const populated = await fixture({ populated: true }).run();
  assert.equal(populated.status, 200);
  const data = (await populated.json()).data;
  assert.equal(data.workTickets.length, 1); assert.equal(data.excludedTicketCount, 1);
  assert.equal(data.workTickets[0].totalEarning, 28);
  assert.equal(data.workTickets[0].serviceTotal, 25);
  assert.equal(data.workTickets[0].services[0].lineTotal, 25);
});

test('caller-stage Server-Timing separates identity and overlapping helper awaits without arbitrary labels', async () => {
  let clock = 0;
  const snapshot = deferred(), greeting = deferred();
  const f = fixture({ hold: { snapshot, greeting }, now: () => clock });
  const pending = f.run();
  let response;
  try {
    await until(() => f.count('snapshot') === 1 && f.count('greeting') === 1, 'overlapping held caller stages');
    clock = 20; snapshot.resolve();
    await until(() => f.events.some(event => event.kind === 'attendance' && event.completed), 'dependent attendance completion');
    await tick();
    clock = 30; greeting.resolve();
    response = await pending;
  } finally {
    snapshot.resolve(); greeting.resolve(); await pending;
  }
  assert.equal(response.status, 200);
  const header = response.headers.get('server-timing');
  for (const name of ['staff_identity', 'staff_assigned', 'staff_attendance', 'staff_timezone', 'staff_greeting']) {
    assert.match(header, new RegExp('(?:^|, )' + name + ';dur=\\d+(?:\\.\\d+)?(?:,|$)'));
  }
  assert.equal(header.includes('staff-critical-path.invalid'), false);
  assert.equal(header.includes('00000000-'), false);
  assert.equal(header.includes('synthetic-token'), false);
  const duration = name => Number(new RegExp('(?:^|, )' + name + ';dur=(\\d+(?:\\.\\d+)?)').exec(header)?.[1]);
  assert.equal(duration('staff_identity'), 0);
  assert.equal(duration('staff_assigned'), 20);
  assert.equal(duration('staff_attendance'), 0);
  assert.equal(duration('staff_timezone'), 0);
  assert.equal(duration('staff_greeting'), 30);
  assert.equal(duration('load'), 30, 'Overlapping helper spans must not be added into caller wall time');
  assert.equal(duration('total'), 30);
});

test('concurrent distinct Staff requests keep SDK arguments, dates, identities and envelopes isolated', async () => {
  const snapshot = deferred(), f = fixture({ hold: { snapshot } });
  const a = f.run({ suffix: '1' }), b = f.run({ suffix: '2' });
  await until(() => f.count('snapshot') === 2, 'two scoped snapshots');
  snapshot.resolve();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.status, 200); assert.equal(rb.status, 200);
  const [va, vb] = await Promise.all([ra.json(), rb.json()]);
  assert.equal(va.scope, f.scopeFor('1')); assert.equal(vb.scope, f.scopeFor('2'));
  assert.notEqual(va.scope, vb.scope);
  assert.equal(va.data.staff.id, f.ids('1').staff); assert.equal(vb.data.staff.id, f.ids('2').staff);
  for (const suffix of ['1', '2']) for (const kind of ['snapshot', 'greeting', 'attendance']) {
    assert.equal(f.events.filter(event => event.suffix === suffix && event.kind === kind).length, 1);
  }
});

test('greeting remains optional but timezone failure and unique Staff failures remain denied', async () => {
  const greeting = fixture({ fail: { greeting: 503 } });
  const allowed = await greeting.run();
  assert.equal(allowed.status, 200); assert.equal((await allowed.json()).data.greetingHistory, null);
  assert.equal(greeting.count('greeting'), 1, 'Read-only RPC POST is not replayed');
  const timezone = fixture({ fail: { timezone: 503 } });
  assert.equal((await timezone.run()).status, 503);
  for (const options of [{ missingStaff: true }, { duplicateStaff: true }]) {
    const f = fixture(options), response = await f.run();
    assert.equal(response.status, options.missingStaff ? 403 : 503);
    assert.equal(f.count('snapshot'), 0); assert.equal(f.count('greeting'), 0);
  }
});

test('401, wrong scope, wrong Staff and caller cancellation cannot start protected MyWork reads', async () => {
  const guest = fixture({ missingUser: true });
  assert.equal((await guest.run()).status, 401); assert.equal(guest.events.length, 0);
  for (const args of [{ scope: 'v3:' + '0'.repeat(64) }, { staffId: '00000000-0000-4000-8000-000000000099' }]) {
    const f = fixture(); assert.equal((await f.run(args)).status, 409);
    assert.equal(f.count('snapshot'), 0); assert.equal(f.count('timezone'), 0); assert.equal(f.count('greeting'), 0);
  }
  const stopped = fixture(), controller = new AbortController(); controller.abort();
  assert.equal((await stopped.run({ signal: controller.signal })).status, 503);
  assert.equal(stopped.events.length, 0);
});

test('selected pay tab still starts independently, Daily waits for complete result, and rejected tabs stay unavailable', async () => {
  const snapshot = deferred(), pay = deferred();
  const selectedData = ({ context, staff }) => ({ context, staff, settings: {}, dailyRows: [], line: null,
    paystub: null, period: {}, periodOptions: [], status: 'ready', latestStatement: null });
  const f = fixture({ hold: { snapshot, pay }, selectedData });
  let settled = false;
  const pending = f.run({ tab: 'payroll' }).then(response => { settled = true; return response; });
  await until(() => f.count('snapshot') === 1, 'Daily before selected pay settles');
  assert.equal(f.payCalls.length, 1); assert.equal(f.payCalls[0].name, 'payroll');
  snapshot.resolve(); await until(() => f.count('attendance') === 1, 'attendance');
  await tick(); assert.equal(settled, false, 'The complete selected-tab DTO remains mandatory');
  pay.resolve();
  const response = await pending; assert.equal(response.status, 200);
  assert.equal((await response.json()).data.payrollData.status, 'ready');
  for (const options of [{ fail: { pay: true } }, { selectedData: ({ context, staff }) => ({ context, staff: { ...staff, id: f.ids('2').staff } }) }]) {
    const bad = fixture(options); assert.equal((await bad.run({ tab: 'analysis' })).status, 503);
    assert.equal(bad.payCalls.length, 1);
  }
});
