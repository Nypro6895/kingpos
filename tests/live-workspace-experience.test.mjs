import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { AsyncLocalStorage } from 'node:async_hooks';
import { isAuthSessionMissingError } from '@supabase/supabase-js';

function load(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', source)(name => {
    if (name === './read-request-metrics') return load('lib/read-request-metrics.ts');
    if (name === './experience-trace') return load('lib/experience-trace.ts');
    if (name === './app-local-context-recovery') return load('lib/app-local-context-recovery.ts');
    if (name === '@/lib/read-request-timing') return load('lib/read-request-timing.ts');
    if (name === '@/lib/today-dashboard-sections') return load('lib/today-dashboard-sections.ts');
    if (name === '@/lib/read-context-scope') return load('lib/read-context-scope.ts', {'server-only':{}, 'node:async_hooks':{AsyncLocalStorage}});
    if (name === '@/lib/supabase/auth-rejection') return authRejection;
    if (name === '@/lib/staff-portal-identity' && !(name in dependencies)) return load('lib/staff-portal-identity.ts', {
      'server-only': {}, react: { cache: read => read },
      '@/lib/current-context': { getCurrentStaffBusinessContext: () => assert.fail('Legacy unminted identity must not resolve a new context') },
      '@/lib/experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
      '@/lib/supabase/server': {
        createAuthenticatedSupabaseServerClient: () => assert.fail('Legacy unminted identity must not run fresh verification'),
        getAuthenticatedReadAuthority: () => assert.fail('Legacy unminted identity must not receive a capability'),
      },
      '@/lib/staff-account': { resolveStaffAccountForSalon: () => assert.fail('Legacy unminted identity must retain its existing resolver boundary') },
    });
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const authRejection = load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } });
const live = load('lib/experience-live-resource.ts');
const server = load('lib/experience-live-resource-server.ts', { 'server-only': {}, 'node:crypto': { createHash } });
const cache = load('lib/experience-resource-cache.ts');
const fetcher = load('lib/fetch-live-experience-resource.ts', { './experience-resource-cache': cache, './experience-live-resource': live, './bounded-get': load('lib/bounded-get.ts') });

test('section revisions ignore generated time; unchanged reads return 304 and changed reads merge only their section', async () => {
  const initial = server.createLiveResourceSnapshot({ title: 'Today', summary: { sales: 40 }, team: [{ id: 'a' }], generatedAt: 'first' }, ['generatedAt']);
  const same = server.createLiveResourceSnapshot({ ...initial.data, generatedAt: 'second' }, ['generatedAt']);
  assert.equal(initial.revision, same.revision);
  const unchanged = server.liveResourceResponse(new Request('https://example.test/api', { headers: { 'If-None-Match': `"${initial.revision}"` } }), same);
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), '');
  const next = server.createLiveResourceSnapshot({ ...same.data, summary: { sales: 55 } }, ['generatedAt']);
  const response = server.liveResourceResponse(new Request(live.liveResourceRequestUrl('https://example.test/api', 'scope', initial)), next);
  const patch = await response.json();
  assert.deepEqual(Object.keys(patch.data), ['summary', 'generatedAt']);
  const merged = live.mergeLiveResource(initial, patch);
  assert.equal(merged.data.team, initial.data.team);
  assert.equal(merged.data.title, initial.data.title);
  assert.equal(merged.data.summary.sales, 55);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.throws(() => live.mergeLiveResource(undefined, patch), /complete snapshot/);
  const invalid = server.liveResourceResponse(new Request('https://example.test/api?sections=%7Bbroken'), next);
  assert.deepEqual((await invalid.json()).data, next.data);
});

test('Today GET checks current authorization and workspace before loading or returning a matching ETag', async () => {
  let context = { user: { id: 'viewer' }, currentBusiness: {}, currentAccount: {}, currentSalon: { id: 'salon' }, scope: 'one', manage: true };
  let calls = 0, fail = false, noAccess = false;
  const GET = load('app/api/experience/today/route.ts', {
    'next/headers': { headers: async () => new Headers() },
    'next/server': { connection: async () => {} },
    '@/lib/current-context': { getCurrentBusinessContext: async () => context, isSalonManageContext: value => value.manage },
    '@/lib/experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
    '@/lib/experience-live-resource-server': server,
    '@/lib/today-dashboard': { getTodayDashboard: async (_context, { date }) => { calls++; return { date: date ?? 'current', summary: { sales: 80 }, noAccess, loadErrors: fail ? [{ area: 'report' }] : [], generatedAt: String(calls) }; } },
  }).GET;
  const first = await GET(new Request('https://example.test/api?scope=one&date=2026-10-11'));
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.equal((await first.json()).data.date, '2026-10-11');
  assert.equal((await GET(new Request('https://example.test/api?scope=one&date=2026-10-11', { headers: { 'if-none-match': etag } }))).status, 304);
  const beforeDenied = calls;
  context = { ...context, user: null };
  assert.equal((await GET(new Request('https://example.test/api?scope=one', { headers: { 'if-none-match': etag } }))).status, 401);
  context = { ...context, user: {}, scope: 'two' };
  assert.equal((await GET(new Request('https://example.test/api?scope=one'))).status, 409);
  context.manage = false;
  assert.equal((await GET(new Request('https://example.test/api?scope=two'))).status, 403);
  assert.equal(calls, beforeDenied);
  context.manage = true;
  assert.equal((await GET(new Request('https://example.test/api?scope=two&date=bad'))).status, 400);
  fail = true;
  assert.equal((await GET(new Request('https://example.test/api?scope=two'))).status, 503);
  fail = false; noAccess = true;
  assert.equal((await GET(new Request('https://example.test/api?scope=two'))).status, 403);
});

test('My Work GET binds the actual resolved staff workspace, validates requested tab/period, and preserves failed pay tabs', async () => {
  let identity = { context: { user: {}, currentSalon: {}, currentAccount: {}, scope: 'staff-one' }, staff: { id: 'staff' } };
  let calls = 0, payroll = true;
  const GET = load('app/api/experience/my-work/route.ts', {
    'next/headers': { headers: async () => new Headers() },
    'next/server': { connection: async () => {} },
    '@/lib/experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
    '@/lib/experience-live-resource-server': server,
    '@/lib/staff-portal-identity': { getStaffPortalIdentity: async () => identity },
    '@/lib/staff-offline-binding-server': {}, '@/lib/staff-my-work-resource-server': { loadStaffMyWorkResource: async (_identity, params) => { calls++; return { tab: params.tab, payrollData: payroll ? {} : null, analysisData: {}, generatedAt: String(calls) }; } },
  }).GET;
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one&staffId=staff&tab=payroll&payPeriodStart=2026-10-01%3A2026-10-15'))).status, 200);
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one&staffId=staff&tab=other'))).status, 400);
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one&staffId=staff&payPeriodStart=other'))).status, 400);
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-two&staffId=staff'))).status, 409);
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one&staffId=another-profile'))).status, 409);
  assert.equal(calls, 1);
  payroll = false;
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one&staffId=staff&tab=payroll'))).status, 503);
  identity.staff = null;
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one'))).status, 403);
  identity.context.user = null;
  assert.equal((await GET(new Request('https://example.test/api?scope=staff-one'))).status, 401);
});

test('live GET request fences precede auth and escape error handlers during prerender', async () => {
  const fenceError = new Error('request fence');
  let authCalls = 0;
  const dependencies = {
    'next/headers': { headers: async () => new Headers() },
    'next/server': { connection: async () => { throw fenceError; } },
    '@/lib/current-context': { getCurrentBusinessContext: async () => { authCalls++; }, isSalonManageContext: () => true },
    '@/lib/experience-context': {}, '@/lib/experience-live-resource-server': server, '@/lib/today-dashboard': {},
    '@/lib/staff-portal-identity': { getStaffPortalIdentity: async () => { authCalls++; } },
    '@/lib/staff-offline-binding-server': {}, '@/lib/staff-my-work-resource-server': {},
  };
  for (const file of ['app/api/experience/today/route.ts', 'app/api/experience/my-work/route.ts']) {
    const GET = load(file, dependencies).GET;
    await assert.rejects(GET(new Request('https://example.test/api')), error => error === fenceError);
  }
  assert.equal(authCalls, 0);
});

test('client conditional fetch preserves unchanged references and classifies access rejection so stale data cannot stay visible', async t => {
  const snapshot = server.createLiveResourceSnapshot({ sales: 1, settings: { name: 'Salon' } });
  let status = 200, requested;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requested = { url, options };
    if (status !== 200) return new Response(null, { status });
    return server.liveResourceResponse(new Request(`https://example.test${url}`, options), server.createLiveResourceSnapshot({ ...snapshot.data, sales: 2 }));
  });
  const signal = new AbortController().signal;
  const fetchResource = fetcher.fetchLiveExperienceResource('/api/today?date=2026-10-11', 'scoped');
  const result = await fetchResource({ signal, etag: `"${snapshot.revision}"`, cached: snapshot });
  assert.equal(result.data.data.settings, snapshot.data.settings);
  assert.equal(result.data.data.sales, 2);
  assert.notEqual(requested.options.signal, signal, 'transport signal adds a finite deadline while forwarding caller cancellation');
  assert.equal(requested.options.signal.aborted, false);
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(new URL(`https://example.test${requested.url}`).searchParams.get('scope'), 'scoped');
  for (status of [401, 403, 409]) await assert.rejects(fetchResource({ signal, cached: snapshot }), cache.ExperienceResourceAccessError);
  status = 503;
  await assert.rejects(fetchResource({ signal, cached: snapshot }), error => !(error instanceof cache.ExperienceResourceAccessError));
  status = 304;
  assert.deepEqual(await fetchResource({ signal, cached: snapshot }), { notModified: true });
});

test('malformed live responses cannot replace a retained authorized read model', async t => {
  const snapshot = server.createLiveResourceSnapshot({ sales: 1 });
  let body;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const fetchResource = fetcher.fetchLiveExperienceResource('/api/today', 'scope');
  for (body of [null, { ...snapshot, partial: false, data: [] }, { ...snapshot, partial: true, sections: { sales: 2 } }, { ...snapshot, partial: false, updatedAt: 'invalid' }]) {
    await assert.rejects(fetchResource({ signal: new AbortController().signal, cached: snapshot }), /response is invalid/);
  }
  assert.equal(snapshot.data.sales, 1);
});

test('My Work read model emits only its own authorized display data and preserves published payroll amounts', async () => {
  const context = { scope: 'own-staff', user: { avatar_url: null, token: 'never-send' }, currentSalon: { id: 'salon' } };
  const staff = { id: 'staff', public_profile_photo_path: null };
  const payroll = { context, staff, settings: [], dailyRows: [], line: { final_staff_income: 123, status: 'paid' }, paystub: null, period: {}, periodOptions: [], status: { kind: 'paid' }, latestStatement: { run: { paid_at: '2026-10-11', other_secret: 'omit' }, otherStaffLines: ['omit'] }, salonPayrollSetting: { other_metadata: 'omit' } };
  const model = load('lib/staff-my-work-resource-server.ts', {
    'server-only': {}, '@/lib/experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
    '@/lib/payroll': { getCurrentStaffPayrollPortalData: async () => payroll, getCurrentStaffAnalysisPortalData: async () => null },
    '@/lib/staff-profile': { getStaffProfileAvatarUrl: () => null, getStaffProfileDisplayName: () => 'Staff' },
    '@/lib/staff-workdays': { getCurrentStaffAssignedWork: async () => ({ excludedTicketCount: 1, today: '2026-10-11', workTickets: [{ id: 'own-ticket', status: 'closed' }] }), getTodaysStaffWorkday: async () => ({ workday: { status: 'working' } }), STAFF_WORKDAY_STATUS_LABELS: { working: 'Working' } },
    './staff-my-work-experience': load('lib/staff-my-work-experience.ts'),
  }).loadStaffMyWorkResource;
  const identity = { context, staff, supabase: { rpc: async name => ({ error: null, data: name === 'get_salon_business_timezone' ? 'America/Chicago' : null }) } };
  const result = await model(identity, { tab: 'payroll' });
  assert.equal(result.payrollData.line.final_staff_income, 123);
  assert.equal(result.payrollData.status.kind, 'paid');
  assert.deepEqual(result.payrollData.latestStatement, { run: { paid_at: '2026-10-11' } });
  assert.equal(result.today, '2026-10-11');
  assert.doesNotMatch(JSON.stringify(result), /never-send|otherStaffLines|other_secret|other_metadata|"context"/);
  payroll.staff = { id: 'another-staff' };
  await assert.rejects(model(identity, { tab: 'payroll' }), /identity could not be verified/);
});


test('legacy My Work GET preserves only typed confirmed rejection and keeps unknown failures503', async () => {
  let boundary = 'identity', failure, loads = 0;
  const identity = { context: { user: {}, currentSalon: {}, currentAccount: {}, scope: 'staff-scope' }, staff: { id: 'staff' } };
  const GET = load('app/api/experience/my-work/route.ts', {
    'next/headers': { headers: async () => new Headers() }, 'next/server': { connection: async () => {} },
    '@/lib/experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
    '@/lib/experience-live-resource-server': server,
    '@/lib/staff-portal-identity': { getStaffPortalIdentity: async () => { if (boundary === 'identity') throw failure; return identity; } },
    '@/lib/staff-offline-binding-server': {},
    '@/lib/staff-my-work-resource-server': { loadStaffMyWorkResource: async () => { loads++; throw failure; } },
  }).GET;
  for (boundary of ['identity', 'loader']) {
    for (const status of [401, 403]) {
      failure = new authRejection.AuthRejectionError(status);
      const response = await GET(new Request('https://example.test/api?scope=staff-scope&staffId=staff'));
      assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(await response.json(), { error: 'Your access has changed. Please sign in again.' });
    }
    for (failure of [new Error('Synthetic unavailable'), Object.assign(new Error('Untrusted status property'), { status: 401 }), Object.assign(new Error('Unknown SDK error'), { status: 400 })]) {
      assert.equal((await GET(new Request('https://example.test/api?scope=staff-scope&staffId=staff'))).status, 503);
    }
  }
  assert.equal(loads, 5, 'Identity rejection cannot reach data loading');
});
