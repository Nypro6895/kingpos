import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as crypto from 'node:crypto';

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === '@/lib/read-request-timing') return load('lib/read-request-timing.ts');
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

test('read metrics contain only fixed categories/counters and never keys, IDs, filters or errors', () => {
  const { createReadRequestMetrics, readResourceCategory, READ_RESOURCE_CATEGORIES, READ_REQUEST_OUTCOMES } = load('lib/read-request-metrics.ts');
  const store = createReadRequestMetrics();
  const secret = 'private-user-and-query-token';
  assert.equal(readResourceCategory(`/api/pos/owner/reports?scope=${secret}&search=${secret}`), 'reports');
  assert.equal(readResourceCategory(`/unknown/${secret}`), 'other');
  for (let i = 0; i < 1000; i++) {
    store.record(readResourceCategory(`/api/pos/owner/bookings?customer=${secret}-${i}`), 'network', i);
    store.record(`${secret}-${i}`, 'joined', Number.NaN);
    store.record('reports', `${secret}-${i}`, Infinity);
  }
  for (const category of READ_RESOURCE_CATEGORIES) for (const outcome of READ_REQUEST_OUTCOMES) store.record(category, outcome, Infinity);
  const snapshot = store.snapshot();
  assert.equal(snapshot.length, READ_RESOURCE_CATEGORIES.length * READ_REQUEST_OUTCOMES.length);
  assert.equal(JSON.stringify(snapshot).includes(secret), false);
  assert.deepEqual(Object.keys(snapshot[0]), ['category', 'outcome', 'count', 'durationMsTotal', 'durationMsMax']);
  assert.equal(snapshot.find(item => item.category === 'bookings' && item.outcome === 'network').count, 1001);
  assert.equal(snapshot.find(item => item.category === 'bookings' && item.outcome === 'network').durationMsMax, 999);
  snapshot[0].count = -1;
  assert.ok(store.snapshot()[0].count > 0, 'callers cannot mutate retained counters');
  store.reset(); assert.deepEqual(store.snapshot(), []);
});

test('shared process counters do not collect server reads and browser counters can be cleared', () => {
  const metrics = load('lib/read-request-metrics.ts');
  metrics.recordReadRequest('bookings', 'network', 20);
  assert.deepEqual(metrics.getReadRequestMetrics(), []);
  const oldWindow = globalThis.window;
  try {
    globalThis.window = {};
    metrics.recordReadRequest('bookings', 'cache-hit');
    assert.equal(metrics.getReadRequestMetrics()[0].count, 1);
    metrics.resetReadRequestMetrics();
    assert.deepEqual(metrics.getReadRequestMetrics(), []);
  } finally { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; }
});

test('request-local timing accumulates fixed stages including failed waits without altering error identity', async () => {
  const { createReadRequestTiming } = load('lib/read-request-timing.ts');
  let now = 0;
  const timing = createReadRequestTiming(() => now);
  await timing.measure('auth', async () => { now += 4; });
  const failure = new Error('private-query-details');
  await assert.rejects(timing.measure('load', async () => { now += 15; throw failure; }), error => error === failure);
  timing.measureSync('private-query-details', () => { now += 1; });
  const response = timing.finish(new Response(null, { status: 503, headers: { 'Cache-Control': 'private, no-store', 'Server-Timing': 'existing;dur=1' } }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('server-timing'), 'existing;dur=1, auth;dur=4.0, load;dur=15.0, total;dur=20.0');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('timed workspace responses preserve the exact ETag/body/security headers and 304 contract', async () => {
  const { createReadRequestTiming } = load('lib/read-request-timing.ts');
  const { workspaceResourceResponse } = load('lib/workspace-resource-response.ts', { 'server-only': {}, 'node:crypto': crypto });
  const data = { salonId: 'private-salon', values: [1, 2] };
  const request = new Request('https://fixture.test/api?private=filter');
  const plain = workspaceResourceResponse(request, data);
  const timed = workspaceResourceResponse(request, data, createReadRequestTiming());
  assert.equal(timed.headers.get('etag'), plain.headers.get('etag'));
  assert.equal(await timed.text(), await plain.text());
  const conditional = workspaceResourceResponse(new Request(request.url, { headers: { 'If-None-Match': timed.headers.get('etag') } }), data, createReadRequestTiming());
  assert.equal(conditional.status, 304); assert.equal(await conditional.text(), '');
  assert.equal(conditional.headers.get('cache-control'), 'private, no-store');
  assert.equal(conditional.headers.get('vary'), 'Cookie');
  assert.match(conditional.headers.get('server-timing'), /^serialize;dur=[\d.]+, total;dur=[\d.]+$/);
  assert.equal(conditional.headers.get('server-timing').includes('private'), false);
});

test('transport metrics count one sanitized outcome per read while preserving cancellation, access errors and fetch policy', async () => {
  class AccessError extends Error { constructor(status) { super('access changed'); this.status = status; } }
  const recorded = [], calls = [];
  let response = Response.json({ values: [1] }, { headers: { ETag: 'v1' } });
  let failure;
  const { readResourceCategory } = load('lib/read-request-metrics.ts');
  const { fetchWorkspaceResource } = load('lib/fetch-workspace-resource.ts', {
    './bounded-get': { fetchBoundedGet: async (...args) => { calls.push(args); if (failure) throw failure; return response; } },
    './experience-resource-cache': { ExperienceResourceAccessError: AccessError },
    './read-request-metrics': { readResourceCategory, recordReadRequest: (...args) => recorded.push(args) },
  });
  const controller = new AbortController();
  const fetcher = fetchWorkspaceResource('/api/pos/owner/reports?customer=private-customer', 'private-scope');
  const request = { signal: controller.signal, etag: 'v0', cached: { values: [] } };
  assert.deepEqual(await fetcher(request), { data: { values: [1] }, etag: 'v1' });
  assert.equal(calls[0][1].cache, 'no-store'); assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][1].headers['If-None-Match'], 'v0'); assert.equal(calls[0][2].maxAttempts, 1);
  response = new Response(null, { status: 304 });
  assert.deepEqual(await fetcher(request), { notModified: true });
  response = new Response(null, { status: 409 });
  await assert.rejects(fetcher(request), error => error instanceof AccessError && error.status === 409);
  failure = new Error('private-error');
  await assert.rejects(fetcher(request), error => error === failure);
  controller.abort();
  await assert.rejects(fetcher(request), error => error === failure);
  assert.deepEqual(recorded.map(([category, outcome]) => [category, outcome]), [
    ['reports', 'network'], ['reports', 'not-modified'], ['reports', 'access-denied'], ['reports', 'error'], ['reports', 'aborted'],
  ]);
  assert.equal(JSON.stringify(recorded).includes('private'), false);
  assert.ok(recorded.every(([, , duration]) => Number.isFinite(duration) && duration >= 0));
});

test('timed owner endpoints preserve DTOs, permission results and conditional status after authorized reads', async () => {
  const context = { user: { id: 'private-user' }, currentSalon: { id: 'private-salon' } };
  const { workspaceResourceResponse } = load('lib/workspace-resource-response.ts', { 'server-only': {}, 'node:crypto': crypto });
  let bookingReads = 0, reportReads = 0;
  const dependencies = {
    'next/server': { NextResponse: Response }, 'next/headers': { headers: async () => new Headers() },
    '@/lib/current-context': { getCurrentBusinessContext: async () => context, isSalonManageContext: () => true },
    '@/lib/experience-context': { getExperienceContext: () => ({ scope: 'current-scope' }) },
    '@/lib/permissions': { hasPermission: async () => true },
    '@/lib/workspace-resource-response': { workspaceResourceResponse },
    '@/lib/bookings': { BOOKING_PERMISSIONS: { view: 'bookings.view' }, getCurrentSalonBookingWorkspace: async (_params, received) => {
      assert.equal(received, context); bookingReads++;
      return { context: { secret: 'must-not-serialize' }, bookings: [{ id: 'one' }], requests: [], options: { timeBlocks: [] } };
    } },
    '@/lib/daily-pos-report': {
      getDailyPosReport: async () => { reportReads++; return { total: 25, lock: { isLocked: true } }; },
      canEditDailyPosClosing: async () => true, canApplyFinancialCorrections: async () => true,
    },
    '@/lib/operational-report': { getOperationalReport: async () => { throw new Error('closing view must not read overview'); } },
  };
  for (const [file, query] of [
    ['app/api/pos/owner/bookings/route.ts', 'resource=calendar'],
    ['app/api/pos/owner/reports/route.ts', 'view=closing'],
  ]) {
    const route = load(file, dependencies);
    const url = `https://fixture.test/api?scope=current-scope&${query}`;
    const response = await route.GET(new Request(url));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.salonId, 'private-salon');
    assert.equal(JSON.stringify(data).includes('must-not-serialize'), false);
    if (query.startsWith('view')) { assert.equal(data.canEdit, false); assert.equal(data.canApplyCorrection, true); }
    assert.match(response.headers.get('server-timing'), /auth;dur=[\d.]+, load;dur=[\d.]+, serialize;dur=[\d.]+, total;dur=[\d.]+/);
    assert.equal(response.headers.get('server-timing').includes('private'), false);
    const unchanged = await route.GET(new Request(url, { headers: { 'If-None-Match': response.headers.get('etag') } }));
    assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
    assert.equal(unchanged.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal(bookingReads, 2); assert.equal(reportReads, 2, 'ETag never skips the authorized database read');
});

test('app-local timing preserves auth/origin/scope denial, conditional reads and private response policy', async () => {
  let unavailable = false, reads = 0, status = 200, failure;
  const source = readFileSync('app/api/app-local/read/route.ts', 'utf8');
  const dependencies = Object.fromEntries([...source.matchAll(/import \{ (\w+) \} from "(@\/lib\/app-local-[^"]+)";/g)].map(([, name, path]) => [path, { [name]: async () => null }]));
  Object.assign(dependencies, {
    'next/server': { connection: async () => {} },
    'next/headers': { headers: async () => new Headers(unavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/app-local-scope-id': { isAppLocalScopeId: value => value === 'private-scope' },
    '@/lib/read-context-scope': { runWithReadContext: fn => fn() },
    '@/lib/app-local-owner-resources-server': { readAppLocalOwnerResource: async () => { reads++; if (failure) throw failure; return { status, scope: 'private-scope', etag: 'v1', data: { total: 5 } }; } },
  });
  const route = load('app/api/app-local/read/route.ts', dependencies);
  const request = (scope = 'private-scope') => new Request(`https://fixture.test/api/app-local/read?name=owner.test&scope=${scope}`);
  unavailable = true;
  assert.equal((await route.GET(request())).status, 503); assert.equal(reads, 0);
  unavailable = false;
  assert.equal((await route.GET(request('old-scope'))).status, 400); assert.equal(reads, 0);
  assert.equal((await route.POST(new Request('https://fixture.test/api/app-local/read', { method: 'POST', headers: { origin: 'https://other.test', 'content-type': 'application/json' }, body: '{}' }))).status, 403);
  assert.equal(reads, 0);
  const initial = await route.GET(request());
  assert.equal(initial.status, 200); assert.equal(reads, 1);
  assert.equal(initial.headers.get('cache-control'), 'private, no-store');
  assert.equal(initial.headers.get('vary'), 'Cookie, If-None-Match');
  assert.equal(initial.headers.get('x-reylumi-scope'), 'private-scope');
  assert.match(initial.headers.get('server-timing'), /auth;dur=[\d.]+, load;dur=[\d.]+, serialize;dur=[\d.]+, total;dur=[\d.]+/);
  assert.equal(initial.headers.get('server-timing').includes('private'), false);
  status = 304;
  const conditional = await route.GET(request());
  assert.equal(conditional.status, 304); assert.equal(await conditional.text(), '');
  assert.equal(conditional.headers.get('etag'), 'v1');
  failure = Object.assign(new Error('private-error-detail'), { status: 403 });
  const denied = await route.GET(request());
  assert.equal(denied.status, 403); assert.equal((await denied.text()).includes('private-error'), false);
  assert.match(denied.headers.get('server-timing'), /load;dur=/);
});
