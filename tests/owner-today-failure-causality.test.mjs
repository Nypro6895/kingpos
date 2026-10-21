import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';
import ts from 'typescript';

// No live SDK transport, environment files, production accounts or mutations.
// The actual route/adapters/Today/helpers/authenticated-client/SDK are exercised.
// Only selected membership reconstruction and unused financial report getters
// are replaced: this does not prove production membership-query cost or capacity.
const origin = 'https://today-causality.invalid';
const scopeId = 'v3:' + 'a'.repeat(64);
const day = '2026-10-21';
const codeCache = new Map();
const envNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const previousEnv = envNames.map(name => process.env[name]);
const originalFetch = globalThis.fetch;
let externalFetchAttempts = 0;
globalThis.fetch = () => { externalFetchAttempts++; throw new Error('Uninjected HTTP is forbidden in Today causal fixtures'); };
process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
after(() => {
  globalThis.fetch = originalFetch;
  envNames.forEach((name, index) => {
    if (previousEnv[index] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[index];
  });
  assert.equal(externalFetchAttempts, 0, 'Every HTTP request must hit only the injected backend');
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function until(predicate, label) {
  for (let i = 0; i < 1000; i++) { if (predicate()) return; await tick(); }
  assert.fail(`Synthetic backend did not reach ${label}`);
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
  const exports = {};
  const bindings = { console: { log() {}, warn() {}, error() {} }, ...globals };
  const names = Object.keys(bindings), values = Object.values(bindings);
  new Function('require', 'exports', ...names, code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name} in ${file}`);
    return dependencies[name];
  }, exports, ...values);
  return exports;
}

function fixture({ fail = {}, hold = {}, timers = false, capacity = Infinity, holdInitialAuth } = {}) {
  const request = new AsyncLocalStorage();
  const reads = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const events = [], failures = [], ownedTimers = new Map();
  let active = 0, maximumActive = 0, timerId = 0;
  const record = (kind, extra = {}) => events.push({ phase: request.getStore()?.phase ?? 'outside', kind, ...extra });
  const timerGlobals = timers ? {
    setTimeout(callback, ms) { const id = ++timerId; ownedTimers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { ownedTimers.delete(id); },
  } : {};
  const bounded = load('lib/bounded-get.ts', {}, { ...timerGlobals, fetch: backend });
  const timingModule = load('lib/read-request-timing.ts', {}, {
    console: { warn(_label, value) { failures.push({ phase: request.getStore()?.phase, ...value }); } },
  });
  const rejection = load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } });
  const auth = load('lib/supabase/auth-rest.ts', {
    '@/lib/bounded-get': bounded,
    '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, read) => read(), observeAppLocalCommandBackendStatus() {} },
    '@/lib/read-context-scope': reads,
    './auth-rejection': rejection,
  }, { fetch: backend });

  function operation(url) {
    if (url.pathname === '/auth/v1/user') return 'identity';
    if (url.pathname === '/rest/v1/users') return 'account-status';
    if (url.pathname === '/rest/v1/account_login_sessions') return 'login-session';
    if (url.pathname === '/rest/v1/rpc/get_salon_business_timezone') return 'timezone';
    if (url.pathname === '/rest/v1/rpc/get_salon_business_date') return 'business-date';
    if (url.pathname === '/rest/v1/rpc/get_customer_visit_queue') return 'waiting';
    if (url.pathname === '/rest/v1/today_quick_access_preferences') return 'quick-preferences';
    if (url.pathname === '/rest/v1/app_notifications') return 'notifications';
    if (url.pathname === '/rest/v1/staff_availability_rules') return 'hours';
    if (url.pathname === '/rest/v1/bookings') return 'bookings';
    if (url.pathname === '/rest/v1/staff') return 'staff';
    if (url.pathname === '/rest/v1/staff_workdays') return 'workdays';
    assert.fail('Unregistered synthetic backend operation');
  }
  async function backend(input, init = {}) {
    const url = new URL(String(input));
    assert.equal(url.origin, origin, 'All wire calls must remain injected .invalid requests');
    const kind = operation(url), method = init.method ?? 'GET';
    assert.ok(method === 'GET' || method === 'POST');
    if (method === 'POST') assert.ok(['timezone', 'business-date', 'waiting'].includes(kind), 'Only actual read-only Today RPCs are simulated');
    const phase = request.getStore()?.phase;
    const event = { phase, kind, method, aborted: Boolean(init.signal?.aborted), signal: init.signal };
    events.push(event);
    if (active >= capacity) {
      event.capacityRejected = true;
      return Response.json({ message: 'Synthetic capacity rejection', code: 'fixture_capacity' }, { status: 503 });
    }
    active++; maximumActive = Math.max(maximumActive, active);
    let rejectAbort;
    const cancellation = new Promise((_, reject) => { rejectAbort = reject; });
    // The fake network's initial tick may still be pending when cancelled.
    // Observe it immediately; the later race still receives the same rejection.
    void cancellation.catch(() => {});
    const aborted = () => { event.aborted = true; rejectAbort(init.signal.reason); };
    init.signal?.addEventListener('abort', aborted, { once: true });
    try {
      // Real asynchronous I/O keeps the production in-flight coalescer observable.
      await tick();
      if (kind === 'identity' && holdInitialAuth) await Promise.race([holdInitialAuth.promise, cancellation]);
      if (hold[kind]) await Promise.race([hold[kind].promise, cancellation]);
      const failure = fail[`${phase}:${kind}`] ?? fail[kind];
      if (failure === 'network') throw new TypeError('Synthetic transport unavailable');
      if (typeof failure === 'number') return Response.json({ message: 'Synthetic upstream failure', code: 'fixture_failure' }, { status: failure });
      let data = [];
      if (kind === 'identity') data = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.invalid', user_metadata: {} };
      if (kind === 'account-status') data = [{ status: 'active' }];
      if (kind === 'login-session') data = [{ revoked_at: null }];
      if (kind === 'timezone') data = 'UTC';
      if (kind === 'business-date') data = day;
      if (kind === 'quick-preferences') data = [{ shortcut_ids: [] }];
      return Response.json(data);
    } finally {
      active--;
      init.signal?.removeEventListener('abort', aborted);
    }
  }
  const accountStatus = load('lib/users/account-status.ts');
  const server = load('lib/supabase/server.ts', {
    'node:crypto': crypto, '@supabase/supabase-js': { createClient },
    '@/lib/abuse-context': { safetyRequestHeaders: async () => ({}) },
    '@/lib/account-security-shared': { ACCOUNT_LOGIN_SESSION_COOKIE: 'app-login-session', isAccountLoginSessionId: value => value === 'fixture-session' },
    '@/lib/users/account-status': accountStatus,
    '@/lib/read-context-scope': reads,
    'next/headers': { headers: async () => new Headers(), cookies: async () => ({
      get(name) { return name === 'sb-access-token' ? { value: 'fixture-access-token' } : name === 'app-login-session' ? { value: 'fixture-session' } : undefined; },
    }) },
    './session-policy': { ADMIN_SESSION_COOKIE: 'admin', REMEMBER_LOGIN_COOKIE: 'remember', sessionCookieOptions: () => ({}) },
    './auth-rest': auth,
    './auth-rejection': rejection,
  });
  const context = {
    scope: scopeId, user: { id: '00000000-0000-4000-8000-000000000002', first_name: 'Fixture' },
    currentAccount: { id: '00000000-0000-4000-8000-000000000003' },
    currentBusiness: { id: '00000000-0000-4000-8000-000000000004' },
    currentSalon: { id: '00000000-0000-4000-8000-000000000005', name: 'Synthetic salon' },
    currentMembership: {}, permissionCodes: ['staff.view', 'booking.view'],
  };
  const current = {
    isOwnerMembership: () => true, isSalonManageContext: value => Boolean(value.currentSalon),
    async getCurrentBusinessContext() {
      record('membership-boundary');
      assert.ok(await server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }));
      return context;
    },
  };
  // This substitutes React's request cache lifecycle, not a global identity cache.
  const react = { cache(read) {
    const key = Symbol('fixture-react-cache');
    return (...args) => reads.memoizeReadContext(key, () => read(...args));
  } };
  const clock = load('lib/salon-business-clock.ts', { 'server-only': {}, react, '@/lib/supabase/server': server, '@/lib/read-context-scope': reads });
  const hours = load('lib/salon-business-hours.ts', {
    'server-only': {}, '@/lib/supabase/server': server,
    '@/lib/salon-operating-status-core': load('lib/salon-operating-status-core.ts'),
  });
  const notifications = load('lib/app-notifications.ts', { 'server-only': {}, '@/lib/supabase/server': server });
  const quick = load('lib/today-quick-accesses.ts', {
    'server-only': {}, '@/lib/supabase/server': server, '@/lib/current-context': current,
    '@/lib/role-catalog-visibility': { SHOW_ROLE_PERMISSION_CATALOGS: true },
    '@/app/role-navigation': { ROLE_MORE_ITEMS: { owner: ['payroll', 'ticket', 'report', 'staff', 'services', 'customers', 'pos', 'setting'].map(id => ({ id: `owner-${id}`, href: '/fixture', label: id })) } },
  });
  const queue = load('lib/customer-visits.ts', { 'server-only': {}, '@/lib/supabase/postgrest-errors': { isMissingSupabaseColumnError: () => false }, '@/lib/read-context-scope': reads });
  const staff = load('lib/staff-workdays.ts', {
    'server-only': {}, '@/lib/salon-business-clock': clock, '@/lib/current-context': current,
    '@/lib/supabase/server': server, '@/lib/staff-account': { STAFF_ACCOUNT_SELECT: 'id' },
    '@/lib/supabase/postgrest-errors': { isMissingSupabaseColumnError: () => false }, '@/lib/staff-portal-identity': {},
  });
  const sections = load('lib/today-dashboard-sections.ts');
  const today = load('lib/today-dashboard.ts', {
    'server-only': {}, '@/lib/read-context-scope': reads, '@/lib/today-dashboard-sections': sections,
    '@/lib/salon-business-clock': clock, '@/lib/today-metric-assessment': load('lib/today-metric-assessment.ts', {
      './daily-pos-sales-comparison': load('lib/daily-pos-sales-comparison.ts'),
    }),
    '@/lib/app-notifications': notifications, '@/lib/salon-business-hours': hours, '@/lib/staff-workdays': staff,
    '@/lib/current-context': current, '@/lib/supabase/server': server, '@/lib/customer-visits': queue, '@/lib/today-quick-accesses': quick,
    '@/lib/bookings': { BOOKING_LINE_SELECT: 'id', BOOKING_SELECT: 'id', zonedDateTimeToUtcIso: ({ date, time }) => `${date}T${time}:00.000Z` },
    '@/lib/daily-pos-report': { DAILY_POS_REPORT_PERMISSIONS: { view: 'reports.view' } },
    '@/types/booking': { normalizeBookingStatus: value => value },
  });
  const requestContext = load('lib/request-business-context.ts', {
    'server-only': {}, react, '@/lib/current-context': current, '@/lib/bounded-get': bounded, '@/lib/read-context-scope': reads,
  });
  const common = {
    'server-only': {}, 'node:crypto': crypto, './read-context-scope': reads, './bounded-get': bounded,
    './request-business-context': requestContext, './experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
    './current-context': current, './staff-portal-identity': {}, './customer-bookings': {},
  };
  const role = load('lib/app-local-role-resources-server.ts', {
    ...common, './app-local-role-resources': load('lib/app-local-role-resources.ts'), './today-dashboard-sections': sections,
    './today-dashboard': today, './supabase/server': server, './account-social': {}, './customer-experience-resource-server': {},
    './staff-experience-resource-server': {}, './staff-my-work-resource-server': {}, './explore-reference-favorites': {},
  });
  const platform = load('lib/app-local-platform-resources-server.ts', {
    ...common, './app-local-platform-types': load('lib/app-local-platform-types.ts'), './app-local-role-resources-server': role,
    './market-experience-data': {}, '@/app/settings/settings-hub-actions': {}, './customer-activity': {}, './staff-workdays': staff,
    './market-plugins': {}, './booking-deposit-market': {}, './owner-transfer': {}, '@/app/my-place/actions': {}, './customer-identity-claims': {},
    './permissions': {}, './services': {}, './support-cases': {}, '@/app/role-navigation': {}, '@/app/campaigns/credit-actions': {},
  });
  const readers = Object.fromEntries([...readFileSync('app/api/app-local/read/route.ts', 'utf8').matchAll(/import \{ (\w+) \} from "(@\/lib\/app-local-[^"]+)";/g)]
    .map(([, name, file]) => [file, { [name]: async () => null }]));
  const native = load('app/api/app-local/read/route.ts', {
    ...readers, 'next/server': { connection: async () => {} }, 'next/headers': { headers: async () => new Headers() },
    '@/lib/app-local-scope-id': load('lib/app-local-scope-id.ts'), '@/lib/read-context-scope': reads,
    '@/lib/read-request-timing': timingModule, '@/lib/app-local-role-resources-server': role, '@/lib/app-local-platform-resources-server': platform,
  });
  function run(phase, { signal } = {}) {
    return request.run({ phase }, () => native.GET(new Request(origin + '/api/app-local/read?' + new URLSearchParams({
      name: 'page.owner-today', scope: scopeId, args: JSON.stringify({ date: day, phase }),
    }), { signal })));
  }
  return {
    run, events, failures, reads, today, context, server,
    count: kind => events.filter(event => event.kind === kind).length,
    maximumActive: () => maximumActive,
    fireTimer(ms) {
      const found = [...ownedTimers].find(([, timer]) => timer.ms === ms);
      assert.ok(found, `No active owned ${ms}ms timer`);
      ownedTimers.delete(found[0]); found[1].callback();
    },
  };
}

test('real native Today phase waits for both clock RPCs before section reads and revalidates settled auth', async () => {
  const timezone = deferred(), businessDate = deferred();
  const f = fixture({ hold: { timezone, 'business-date': businessDate } });
  const pending = f.run('extras');
  await until(() => f.count('timezone') === 1 && f.count('business-date') === 1, 'both clock RPCs');
  assert.equal(f.count('quick-preferences'), 0);
  assert.equal(f.count('notifications'), 0);
  assert.equal(f.count('identity'), 2, 'Request context and later clock each revalidate; concurrent clock factories join');
  timezone.resolve(); await tick();
  assert.equal(f.count('quick-preferences'), 0, 'Business-date clock still gates section fanout');
  businessDate.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(f.count('membership-boundary'), 1, 'Platform and role adapter share one request context');
  assert.equal(f.count('identity'), 3, 'Extras requires a new fresh check after the clock cohort settles');
  assert.equal(f.count('account-status'), 3);
  assert.equal(f.count('login-session'), 3);
  assert.equal(f.count('quick-preferences'), 1);
  assert.equal(f.count('notifications'), 1);
  assert.deepEqual(f.failures, []);
});

test('final upstream bookings503 remains phase503 while a separately requested real extras phase succeeds without cross-cancellation', async () => {
  const f = fixture({ fail: { 'bookings:bookings': 503 } });
  const [bookings, extras] = await Promise.all([f.run('bookings'), f.run('extras')]);
  assert.equal(bookings.status, 503); assert.equal(extras.status, 200);
  assert.equal(f.count('bookings'), 2, 'The bounded transport owns exactly two GET attempts; SDK adds no hidden retries');
  assert.deepEqual(f.failures.map(({ phase, backend, failureKind, attempts, upstreamStatus, ownedTimerFired, parentAborted }) =>
    ({ phase, backend, failureKind, attempts, upstreamStatus, ownedTimerFired, parentAborted })), [{
    phase: 'bookings', backend: 'rest', failureKind: 'http', attempts: 2, upstreamStatus: 503, ownedTimerFired: false, parentAborted: false,
  }]);
  assert.equal(f.events.some(event => event.phase === 'extras' && event.aborted), false);
  assert.equal((await extras.json()).data.dashboard.loadErrors.length, 0);
});

test('real preferences network failure preserves the existing extras200 with configuration loadError and reports network rather than an inferred timeout', async () => {
  const f = fixture({ fail: { 'quick-preferences': 'network' } });
  const response = await f.run('extras');
  assert.equal(response.status, 200);
  const data = (await response.json()).data.dashboard;
  assert.equal(data.loadErrors.length, 0, 'The existing quick-access getter returns a configuration error rather than throwing');
  assert.ok(data.quickAccesses.loadError);
  assert.equal(f.count('quick-preferences'), 2);
  assert.equal(f.count('notifications'), 1);
  assert.deepEqual(f.failures.map(({ failureKind, attempts, upstreamStatus, ownedTimerFired, parentAborted }) =>
    ({ failureKind, attempts, upstreamStatus, ownedTimerFired, parentAborted })), [{
    failureKind: 'network', attempts: 2, upstreamStatus: null, ownedTimerFired: false, parentAborted: false,
  }]);
});

test('ordinary final GET failure does not cancel a pending sibling GET inside the same real Today extras request', async () => {
  const notifications = deferred();
  const f = fixture({ fail: { 'quick-preferences': 503 }, hold: { notifications } });
  const pending = f.run('extras');
  await until(() => f.count('notifications') === 1, 'held notifications');
  await delay(300);
  assert.equal(f.count('quick-preferences'), 2);
  assert.equal(f.failures[0]?.failureKind, 'http');
  const sibling = f.events.find(event => event.kind === 'notifications');
  assert.equal(sibling.signal.aborted, false, 'A final response error does not withdraw same-request authority');
  notifications.resolve();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.ok((await response.json()).data.dashboard.quickAccesses.loadError);
});

test('actual owned Today12s deadline withdraws its request GET authority but not another phase request', async () => {
  const notifications = deferred(), quick = deferred();
  const f = fixture({ timers: true, hold: { notifications, 'quick-preferences': quick } });
  const pending = f.run('extras');
  await until(() => f.count('notifications') === 1 && f.count('quick-preferences') === 1, 'extras data cohort');
  const healthy = await f.run('shell');
  assert.equal(healthy.status, 200);
  f.fireTimer(12000);
  assert.equal((await pending).status, 503);
  await until(() => f.failures.length === 2, 'deadline cancellation provenance');
  assert.ok(f.failures.every(value => value.failureKind === 'parent-abort' && value.parentAborted && !value.ownedTimerFired));
  assert.equal(f.count('quick-preferences'), 1, 'Scope withdrawal cannot retry a cancelled GET');
  assert.equal(f.events.some(event => event.phase === 'shell' && event.aborted), false);
  notifications.resolve(); quick.resolve();
});

test('an actual5s GET attempt timer yields timeout provenance after its two attempts without firing the12s Today timer', async () => {
  const bookings = deferred();
  const f = fixture({ timers: true, hold: { bookings } });
  const pending = f.run('bookings');
  await until(() => f.count('bookings') === 1, 'first bookings attempt');
  await tick(); // Healthy hours GET finishes, leaving only the held bookings timer.
  f.fireTimer(5000);
  // Let the rejected first attempt install its existing retry-delay timer.
  await tick();
  f.fireTimer(250);
  await until(() => f.count('bookings') === 2, 'second bookings attempt');
  f.fireTimer(5000);
  assert.equal((await pending).status, 503);
  assert.deepEqual(f.failures.map(({ failureKind, attempts, ownedTimerFired, parentAborted }) =>
    ({ failureKind, attempts, ownedTimerFired, parentAborted })), [{
    failureKind: 'timeout', attempts: 2, ownedTimerFired: true, parentAborted: false,
  }]);
  bookings.resolve();
});

test('a caller abort reason is parent cancellation at the real GET boundary, never proof of a backend timeout', async () => {
  const notifications = deferred();
  const f = fixture({ hold: { notifications } });
  const controller = new AbortController();
  const pending = f.reads.runWithReadContext(() => f.reads.runWithReadAbortSignal(controller.signal,
    () => f.today.getTodayDashboard(f.context, { date: day, phase: 'extras' })), {
    measure: (_stage, read) => read(),
    measureBackend: (_kind, read) => read(),
    observeBackendFailure: (backend, value) => f.failures.push({ backend, ...value }),
  });
  await until(() => f.count('notifications') === 1, 'caller-held notification GET');
  controller.abort(new Error('Synthetic caller cancellation'));
  const result = await pending;
  assert.equal(result.loadErrors.length, 0, 'Existing notifications fallback is empty; this is not evidence of a successful backend read');
  assert.ok(f.failures.some(value => value.kind === 'parent-abort' && value.parentAborted && !value.ownedTimerFired));
  notifications.resolve();
});

test('waiting RPC upstream503 and network error each become503 without replay, but existing GET provenance cannot classify those POSTs', async () => {
  for (const failure of [503, 'network']) {
    const f = fixture({ fail: { waiting: failure } });
    const response = await f.run('waiting');
    assert.equal(response.status, 503);
    assert.equal(f.count('waiting'), 1, 'Read-only RPC POST is never automatically replayed');
    assert.equal(f.events.find(event => event.kind === 'waiting').method, 'POST');
    assert.deepEqual(f.failures, [], 'Current POST transport has duration/call metrics but no bounded-GET failure observer');
    assert.match(response.headers.get('server-timing'), /backend_rpc;dur=[\d.]+;calls=3/);
  }
});

test('real timezone RPC failure makes extras503 before its data getters; business-date RPC failure instead retains the existing fallback', async () => {
  const timezone = fixture({ fail: { timezone: 503 } });
  assert.equal((await timezone.run('extras')).status, 503);
  assert.equal(timezone.count('quick-preferences'), 0);
  assert.equal(timezone.count('notifications'), 0);
  assert.equal(timezone.count('timezone'), 1);
  assert.deepEqual(timezone.failures, [], 'A real clock RPC failure is outside the bounded GET observer');
  const businessDate = fixture({ fail: { 'business-date': 503 } });
  assert.equal((await businessDate.run('shell')).status, 200, 'Existing date fallback differs from the strict timezone RPC');
  assert.equal(businessDate.count('business-date'), 1);
  assert.deepEqual(businessDate.failures, []);
});

test('owned Today deadline returns503 and cancels a held waiting read RPC without replaying its POST', async () => {
  const waiting = deferred();
  const f = fixture({ timers: true, hold: { waiting } });
  const pending = f.run('waiting');
  await until(() => f.count('waiting') === 1, 'held waiting RPC');
  const wire = f.events.find(event => event.kind === 'waiting');
  assert.equal(wire.signal?.aborted, false, 'Only this known passive RPC receives the existing read scope signal');
  f.fireTimer(12000);
  assert.equal((await pending).status, 503);
  assert.equal(f.count('waiting'), 1);
  assert.equal(wire.aborted, true);
  assert.deepEqual(f.failures, [], 'The phase timeout is not a received upstream RPC status');
  waiting.resolve();
});

test('mock backend capacity alone can make concurrent real phase requests fail while the same phases succeed serially; this is a hypothesis fixture', async () => {
  // Five real operation families plus another independent shell HTTP request;
  // financial reports are outside this fixture's deliberately limited boundary.
  const phases = ['shell', 'staff', 'bookings', 'waiting', 'extras', 'shell'];
  const gate = deferred();
  const burst = fixture({ capacity: 3, holdInitialAuth: gate });
  const pending = phases.map(phase => burst.run(phase));
  // Three rejected identities exhaust the real two-attempt GET budget while
  // three accepted identities remain deliberately held by this fake backend.
  for (let i = 0; i < 30 && burst.events.filter(event => event.capacityRejected).length < 6; i++) await delay(20);
  assert.equal(burst.events.filter(event => event.capacityRejected).length, 6);
  gate.resolve();
  const responses = await Promise.all(pending);
  assert.equal(responses.filter(response => response.status === 503).length, 3);
  assert.equal(responses.filter(response => response.status === 200).length, 3);
  assert.equal(burst.maximumActive(), 3);
  const serial = fixture({ capacity: 3 });
  for (const phase of phases) assert.equal((await serial.run(phase)).status, 200, phase);
  assert.equal(serial.events.some(event => event.capacityRejected), false);
  assert.equal(serial.count('membership-boundary'), 6, 'Independent phase HTTP requests do not share authorization across requests');
  assert.equal(serial.count('identity'), 16, 'Four data phases use three auth cohorts each; each shell uses two');
});
