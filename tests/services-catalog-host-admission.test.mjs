import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import ts from 'typescript';

// Real named reader, shared feature-admission helper, HTTP read route and web
// host adapter. Only identity/permissions/DB rows are synthetic; no live account.
const compiled = new Map();
function load(file, dependencies = {}) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  const exports = {};
  new Function('require', 'exports', compiled.get(file))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name} in ${file}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const platformTypes = load('lib/app-local-platform-types.ts');
const cache = load('lib/services-catalog-cache.ts');
const experience = load('lib/experience-context.ts', { 'server-only': {}, 'node:crypto': crypto });
const bounded = load('lib/bounded-get.ts');
const scopeModule = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
const names = ['page.services-catalog-admission', 'page.services-catalog'];
const origin = 'https://catalog-host.invalid';

function fixture(options = {}) {
  const calls = [];
  const context = {
    user: { id: 'viewer-a', status: 'active' }, accountId: 'account-a', workspaceType: 'salon', salonMode: 'manage',
    currentAccount: { id: 'account-a', status: 'active' }, currentSalon: { id: 'salon-a', status: 'active' },
    currentWorkspace: { id: 'workspace-a' }, activeRole: { code: 'owner' }, permissionCodes: ['services.view'], permissions: [],
    currentMembership: { updated_at: '2026-10-21', status: 'active' }, ...(options.context ?? {}),
  };
  const current = { isSalonManageContext: () => !options.notManage };
  const services = { SERVICE_PERMISSIONS: { view: 'services.view' }, getCurrentSalonServicesWorkspace: async supplied => {
    calls.push('workspace'); assert.equal(supplied, context, 'The original reader uses this request context');
    if (options.dataError) throw Error('Synthetic data failure');
    if (options.afterRead) await options.afterRead();
    return options.workspace ?? { canManage: true, staff: [{ id: 'PRIVATE_STAFF' }], addOnLinks: [{ id: 'PRIVATE_ASSIGNMENT' }], services: [{
      id: 'service-a', salon_id: 'salon-a', name: 'Manicure', category: 'Nails', description: null, base_price: '25.00', duration_minutes: 30,
      bookingStaffIds: ['PRIVATE_STAFF'], privateFutureField: 'NEVER_SEND',
    }] };
  } };
  const permissions = { hasPermission: async (permission, supplied) => {
    calls.push(permission); assert.equal(permission, 'services.view'); assert.equal(supplied, context);
    if (options.permissionError) throw Error('Synthetic permission lookup failure');
    if (options.afterPermission) await options.afterPermission();
    return options.allowed !== false;
  } };
  const helper = load('lib/services-catalog-admission-server.ts', {
    'server-only': {}, './current-context': current, './experience-context': experience, './permissions': permissions,
    './services': services, './bounded-get': bounded, './services-catalog-cache': cache,
  });
  const flag = { servicesCatalogPilotEnabled: () => options.enabled !== false };
  const platform = load('lib/app-local-platform-resources-server.ts', {
    'server-only': {}, 'node:crypto': crypto, './read-context-scope': scopeModule,
    './request-business-context': { getRequestBusinessContext: async () => { calls.push('context'); if (options.contextError) throw Error('Synthetic context failure'); return context; } },
    './experience-context': experience, './services-catalog-admission-server': helper, './services-catalog-pilot-flag': flag,
    './app-local-platform-types': platformTypes, './bounded-get': bounded, './current-context': current, './permissions': permissions, './services': services,
    './app-local-role-resources-server': { AppLocalRoleReadError: class extends Error { constructor(status, message) { super(message); this.status = status; } } },
    ...Object.fromEntries(['./market-experience-data', '@/app/settings/settings-hub-actions', './customer-activity', './staff-portal-identity', './staff-workdays', './market-plugins', './booking-deposit-market', './owner-transfer', '@/app/my-place/actions', './customer-identity-claims', './support-cases', '@/app/role-navigation', '@/app/campaigns/credit-actions', './customer-bookings'].map(name => [name, {}])),
  });
  const otherReaders = Object.fromEntries([...readFileSync('app/api/app-local/read/route.ts', 'utf8').matchAll(/import \{ (\w+) \} from "(@\/lib\/app-local-[^"]+)";/g)].map(([, name, file]) => [file, { [name]: async () => null }]));
  const route = load('app/api/app-local/read/route.ts', {
    ...otherReaders, '@/lib/app-local-platform-resources-server': platform,
    'next/server': { connection: async () => {} },
    'next/headers': { headers: async () => new Headers(options.unavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/app-local-scope-id': load('lib/app-local-scope-id.ts'), '@/lib/read-context-scope': scopeModule,
    '@/lib/read-request-timing': load('lib/read-request-timing.ts'),
  });
  const scope = experience.getExperienceContext(context).scope;
  const request = (name, { requestedScope = scope, args = {}, etag, signal } = {}) => route.GET(new Request(origin + '/api/app-local/read?' + new URLSearchParams({ name, scope: requestedScope, args: JSON.stringify(args) }), { signal, ...(etag ? { headers: { 'If-None-Match': etag } } : {}) }));
  const host = load('lib/app-local-host.ts', {
    './bounded-get': { ...bounded, fetchWithDeadline: (input, init) => route.GET(new Request(new URL(String(input), origin), init)) },
    './experience-persistent-cache': {},
  }).getAppLocalHost();
  return { calls, context, scope, request, host, platform };
}

test('both named pilot resources are explicitly non-durable with no request arguments', () => {
  for (const name of names) assert.deepEqual(platformTypes.APP_LOCAL_PLATFORM_READS[name], { argumentKeys: [], retention: 'none' });
  assert.equal(platformTypes.APP_LOCAL_PLATFORM_READS['page.services'].retention, 'scoped', 'Original manager read is unchanged');
});

test('host admission uses one request context and services.view, returning only exact partition', async () => {
  const f = fixture(), response = await f.host.read(names[0], {}, { scope: f.scope });
  assert.equal(response.status, 200); assert.equal(response.scope, f.scope); assert.equal(response.offline, undefined);
  assert.deepEqual(response.data, { schemaVersion: 1, partition: { viewerId: 'viewer-a', accountId: 'account-a', salonId: 'salon-a', scope: f.scope, permissionRevision: experience.getExperienceContext(f.context).permissionRevision } });
  assert.deepEqual(f.calls, ['context', 'services.view']);
});

test('host catalog data projects six fields and never transports manager/private extras', async () => {
  const f = fixture(), response = await f.host.read(names[1], {}, { scope: f.scope });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { services: [{ id: 'service-a', name: 'Manicure', category: 'Nails', description: null, basePrice: 25, durationMinutes: 30 }] });
  assert.deepEqual(f.calls, ['context', 'services.view', 'workspace']);
  assert.equal(/PRIVATE|NEVER_SEND|canManage|bookingStaff|staff/.test(JSON.stringify(response)), false);
});

const callCounts = calls => ({ context: calls.filter(call => call === 'context').length, permission: calls.filter(call => call === 'services.view').length, workspaceReader: calls.filter(call => call === 'workspace').length });
const countDelta = (after, before) => Object.fromEntries(Object.keys(after).map(key => [key, after[key] - before[key]]));

test('legacy service 304 still resolves context, checks permission and runs the workspace reader', async t => {
  const options = {}, f = fixture(options), first = await f.request('page.services'), etag = first.headers.get('etag');
  assert.equal(first.status, 200); assert.ok(etag);
  const before = callCounts(f.calls), conditional = await f.request('page.services', { etag });
  const conditionalWork = countDelta(callCounts(f.calls), before);
  assert.equal(conditional.status, 304); assert.equal(await conditional.text(), '');
  assert.deepEqual(conditionalWork, { context: 1, permission: 1, workspaceReader: 1 });
  // Equality is calculated from the fully loaded authorized DTO; it saves the
  // response body, not the context/permission/workspace loading work above.
  options.allowed = false;
  const beforeDenial = callCounts(f.calls), denied = await f.request('page.services', { etag });
  assert.equal(denied.status, 403);
  assert.deepEqual(countDelta(callCounts(f.calls), beforeDenial), { context: 1, permission: 1, workspaceReader: 0 });
  t.diagnostic(JSON.stringify({ resource: 'page.services', matchingEtagStatus: 304, conditionalWork, measurement: 'Synthetic dependency invocation counts; not DB query counts or real latency.' }));
});

test('ETags never substitute a 304 for fresh pilot admission or fresh catalog', async t => {
  for (const name of names) {
    const f = fixture(), first = await f.request(name), etag = first.headers.get('etag');
    assert.equal(first.status, 200); assert.ok(etag);
    const before = callCounts(f.calls);
    const second = await f.request(name, { etag });
    assert.equal(second.status, 200); assert.equal((await second.json()).status, 200);
    assert.equal(second.headers.get('cache-control'), 'private, no-store');
    const conditionalWork = countDelta(callCounts(f.calls), before);
    assert.deepEqual(conditionalWork, { context: 1, permission: 1, workspaceReader: name === 'page.services-catalog' ? 1 : 0 });
    t.diagnostic(JSON.stringify({ resource: name, matchingEtagStatus: 200, conditionalWork, measurement: 'Synthetic dependency invocation counts; not DB query counts or real latency.' }));
  }
});

for (const [label, options, status] of [
  ['disabled', { enabled: false }, 404], ['anonymous', { context: { user: null } }, 401],
  ['missing account', { context: { currentAccount: null } }, 403], ['missing salon', { context: { currentSalon: null } }, 403],
  ['wrong workspace', { notManage: true }, 403], ['permission revoked', { allowed: false }, 403],
  ['auth unavailable', { unavailable: true }, 503], ['context lookup failed', { contextError: true }, 503],
  ['permission lookup failed', { permissionError: true }, 503],
]) test(`named pilot reads preserve ${label} response classification`, async () => {
  for (const name of names) {
    const f = fixture(options), response = await f.request(name);
    assert.equal(response.status, status); const body = await response.json();
    assert.equal(body.partition, undefined); assert.equal(body.data, undefined); assert.equal(f.calls.includes('workspace'), false);
    if (options.enabled === false || options.unavailable) assert.equal(f.calls.includes('context'), false);
  }
});

test('stale or foreign scope is rejected before any catalog data lookup', async () => {
  for (const name of names) {
    const f = fixture(), response = await f.request(name, { requestedScope: 'v3:' + 'b'.repeat(64) });
    assert.equal(response.status, 409); assert.equal(f.calls.includes('workspace'), false);
  }
});

test('caller cannot inject salon/account/permission fields into a pilot read', async () => {
  for (const name of names) for (const args of [{ salonId: 'foreign' }, { accountId: 'foreign' }, { permissionRevision: 'owner' }, { schemaVersion: '1' }]) {
    const f = fixture(), response = await f.request(name, { args }); assert.equal(response.status, 400); assert.deepEqual(f.calls, []);
  }
});

test('permission role changes produce a new full partition scope', async () => {
  const owner = fixture(), staff = fixture({ context: { activeRole: { code: 'manager' }, permissionCodes: ['services.view', 'services.manage'] } });
  assert.notEqual(owner.scope, staff.scope);
  const first = await owner.host.read(names[0], {}, { scope: owner.scope }), next = await staff.host.read(names[0], {}, { scope: staff.scope });
  assert.notEqual(first.data.partition.permissionRevision, next.data.partition.permissionRevision);
});

test('data failure or invalid catalog projection remains 503 without private fallback', async () => {
  for (const options of [{ dataError: true }, { workspace: { services: [{ id: 'a', name: 'x', category: null, description: null, base_price: NaN, duration_minutes: 20 }] } }]) {
    const f = fixture(options), response = await f.request(names[1]); assert.equal(response.status, 503); assert.equal((await response.json()).data, undefined);
  }
});

test('cancellation during permission or data work cannot deliver a late DTO', async () => {
  for (const name of names) {
    const controller = new AbortController();
    const f = fixture(name === names[0] ? { afterPermission: () => controller.abort() } : { afterRead: () => controller.abort() });
    const response = await f.request(name, { signal: controller.signal });
    assert.equal(response.status, 503); assert.equal((await response.json()).data, undefined);
  }
});
