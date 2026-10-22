import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const load = (file, dependencies = {}) => {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports);
  return exports;
};
const { servicesCatalogPilotEnabled } = load('lib/services-catalog-pilot-flag.ts');
test('pilot requires explicit local opt-in and cannot be enabled in production', () => {
  assert.equal(servicesCatalogPilotEnabled({}), false);
  assert.equal(servicesCatalogPilotEnabled({ NODE_ENV: 'development', REYLUMI_SERVICES_CACHE_PILOT: '1' }), true);
  for (const env of [{ NODE_ENV: 'production' }, { VERCEL_ENV: 'production' }]) assert.equal(servicesCatalogPilotEnabled({ ...env, REYLUMI_SERVICES_CACHE_PILOT: '1' }), false);
});
const scope = 'v3:' + 'a'.repeat(64);
function fixture(options = {}) {
  const calls = [];
  const context = { user: { id: 'viewer-a' }, currentAccount: { id: 'account-a' }, currentSalon: { id: 'salon-a' }, ...(options.context ?? {}) };
  const admission = load('lib/services-catalog-admission-server.ts', {
    'server-only': {},
    './current-context': { isSalonManageContext: () => !options.notManage },
    './experience-context': { getExperienceContext: () => ({ scope, permissionRevision: 'services.view:owner:revision-1' }) },
    './permissions': { hasPermission: async permission => { calls.push(permission); if (options.permissionError) throw Error('Synthetic permission failure'); return options.allowed !== false; } },
    './services': { SERVICE_PERMISSIONS: { view: 'services.view' } },
    './services-catalog-cache': {},
    './bounded-get': { runReadWithDeadline: promise => promise },
  });
  const route = load('app/api/services/catalog-pilot/route.ts', {
    'next/server': { connection: async () => { calls.push('connection'); } },
    'next/headers': { headers: async () => new Headers(options.unavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/current-context': { getCurrentBusinessContext: async () => { calls.push('context'); if (options.contextError) throw Error('Synthetic failure'); return context; } },
    '@/lib/services-catalog-admission-server': admission,
    '@/lib/services-catalog-pilot-flag': { servicesCatalogPilotEnabled: () => options.enabled !== false },
    '@/lib/bounded-get': { runReadWithDeadline: promise => promise },
  });
  return { calls, get: (requested = scope) => route.GET(new Request('http://localhost/api/services/catalog-pilot?' + new URLSearchParams({ scope: requested }))) };
}
test('fresh admission requires exact original services.view and returns only partition fields', async () => {
  const f = fixture(), response = await f.get();
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('vary'), 'Cookie');
  assert.deepEqual(f.calls, ['connection', 'context', 'services.view']);
  assert.deepEqual(await response.json(), { schemaVersion: 1, partition: { viewerId: 'viewer-a', accountId: 'account-a', salonId: 'salon-a', scope, permissionRevision: 'services.view:owner:revision-1' } });
});
for (const [name, options, status] of [
  ['disabled', { enabled: false }, 404], ['anonymous', { context: { user: null } }, 401],
  ['missing account', { context: { currentAccount: null } }, 403], ['missing salon', { context: { currentSalon: null } }, 403],
  ['wrong workspace family', { notManage: true }, 403], ['revoked permission', { allowed: false }, 403],
  ['auth unavailable', { unavailable: true }, 503], ['context failure', { contextError: true }, 503], ['permission lookup failure', { permissionError: true }, 503],
]) test(`admission ${name} fails closed without a partition`, async () => {
  const f = fixture(options), response = await f.get(); assert.equal(response.status, status); assert.equal((await response.json()).partition, undefined);
  if (options.enabled === false || options.unavailable) assert.equal(f.calls.includes('context'), false);
});
test('requested stale scope cannot receive current account admission', async () => { const response = await fixture().get('v3:' + 'b'.repeat(64)); assert.equal(response.status, 409); assert.equal((await response.json()).partition, undefined); });

test('notify:false reset still synchronously withdraws pilot before original reset policy', () => {
  const calls = [];
  const { resetExperienceCaches } = load('lib/reset-experience-cache.ts', {
    '@/lib/experience-state': { clearExperienceState: () => calls.push('state') },
    '@/lib/experience-resource-cache': { resetExperienceResources: () => calls.push('reset'), suspendExperienceResources: () => calls.push('suspend') },
    '@/lib/experience-cache-events': { EXPERIENCE_RESET_EVENT: 'reset', broadcastExperienceReset: () => calls.push('broadcast') },
    '@/lib/experience-offline-client': { lockExperienceOffline: () => calls.push('lock') },
    '@/lib/services-catalog-runtime': { invalidateServicesCatalog: reason => calls.push('pilot:' + reason) },
  });
  resetExperienceCaches({ notify: false, reason: 'permissions', broadcast: false });
  assert.deepEqual(calls, ['pilot:permissions', 'lock', 'reset', 'state']);
});
