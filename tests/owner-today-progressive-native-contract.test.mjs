import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as crypto from 'node:crypto';
import * as asyncHooks from 'node:async_hooks';

function load(file, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in deps, `Unexpected dependency ${name} in ${file}`);
    return deps[name];
  }, exports);
  return exports;
}

function fixture() {
  const reads = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': asyncHooks });
  const roleMetadata = load('lib/app-local-role-resources.ts');
  const platformMetadata = load('lib/app-local-platform-types.ts');
  const phases = load('lib/today-dashboard-sections.ts');
  const contextKey = Symbol('fixture-authorized-context');
  let context = { scope: 'scope-a', user: { id: 'viewer' }, currentMembership: { role: 'owner' }, currentBusiness: {}, currentAccount: {}, currentSalon: { id: 'salon' } };
  let contextReads = 0, generatedAt = 0, value = 25, failure, denied = false;
  const dashboardReads = [];
  const common = {
    'server-only': {}, 'node:crypto': crypto,
    './read-context-scope': reads,
    './request-business-context': { getRequestBusinessContext: () => reads.memoizeReadContext(contextKey, async () => { contextReads++; return context; }) },
    './experience-context': { getExperienceContext: value => ({ scope: value.scope }) },
    './current-context': { isSalonManageContext: value => value.manage !== false, isOwnerMembership: () => true },
    './bounded-get': { runReadWithDeadline: async value => value },
    './staff-portal-identity': {}, './customer-bookings': {}, './permissions': {},
  };
  const role = load('lib/app-local-role-resources-server.ts', {
    ...common, './app-local-role-resources': roleMetadata,
    './today-dashboard-sections': phases,
    './supabase/server': {}, './account-social': {}, './customer-experience-resource-server': {},
    './staff-experience-resource-server': {}, './staff-my-work-resource-server': {}, './explore-reference-favorites': {},
    './today-dashboard': { getTodayDashboard: async (_context, options) => {
      dashboardReads.push(options);
      return {
        date: options.date ?? '2026-10-18', generatedAt: new Date(generatedAt++).toISOString(), noAccess: denied,
        phase: options.phase ?? 'full', summary: { sales: { value } },
        loadErrors: failure !== undefined && failure === options.phase ? [{ area: failure, message: 'Temporarily unavailable' }] : [],
      };
    } },
  });
  const platform = load('lib/app-local-platform-resources-server.ts', {
    ...common, './app-local-platform-types': platformMetadata, './app-local-role-resources-server': role,
    './market-experience-data': {}, '@/app/settings/settings-hub-actions': {}, './customer-activity': {}, './staff-workdays': {},
    './market-plugins': {}, './booking-deposit-market': {}, './owner-transfer': {}, '@/app/my-place/actions': {},
    './customer-identity-claims': {}, './services': {}, './support-cases': {}, '@/app/role-navigation': {}, '@/app/campaigns/credit-actions': {},
  });
  return {
    role, platform, phases, roleMetadata, platformMetadata, dashboardReads,
    get contextReads() { return contextReads; },
    setContext(value) { context = { ...context, ...value }; },
    setValue(next) { value = next; }, setFailure(next) { failure = next; }, setDenied(next) { denied = next; },
    read: args => platform.readAppLocalPlatformResource('page.owner-today', args, { scope: 'scope-a' }),
  };
}

test('native metadata keeps resource names and advertises independent phase cache keys', () => {
  const f = fixture();
  assert.deepEqual(f.roleMetadata.APP_LOCAL_READ_RESOURCES['owner.today'].params, ['date', 'phase']);
  assert.deepEqual(f.platformMetadata.APP_LOCAL_PLATFORM_READS['page.owner-today'].argumentKeys, ['date', 'phase']);
  assert.equal(f.platformMetadata.APP_LOCAL_PLATFORM_READS['page.owner-today'].retention, 'scoped');
  const transport = readFileSync('ios/Reylumi/ReylumiLocalAppTransport.swift', 'utf8');
  assert.match(transport, /Set\(args.keys\).isSubset\(of: Set\(keys\)\)/);
  assert.match(transport, /return name \+ ":" \+ SHA256.hash\(data: data\)/);
  const build = readFileSync('scripts/build-app-local-bundle.mjs', 'utf8');
  assert.match(build, /argumentKeys:rule.params/);
  assert.match(build, /argumentKeys:rule.argumentKeys/);
});

test('each supported phase reaches the existing authorized loader while omitted phase preserves legacy full', async () => {
  const f = fixture();
  const phases = ['shell', ...f.phases.TODAY_DASHBOARD_SECTIONS];
  for (const phase of phases) {
    const response = await f.read({ date: '2026-10-18', phase });
    assert.equal(response.status, 200);
    assert.equal(response.data.dashboard.phase, phase);
    assert.equal(response.data.isOwner, true);
    assert.deepEqual(f.dashboardReads.at(-1), { date: '2026-10-18', phase });
  }
  const legacy = await f.read({ date: '2026-10-18' });
  assert.equal(legacy.data.dashboard.phase, 'full');
  assert.deepEqual(f.dashboardReads.at(-1), { date: '2026-10-18' });
});

test('native phase validation rejects unsupported or malformed arguments without loading financial records', async () => {
  const f = fixture();
  for (const phase of ['', 'core', 'full', 'all', 'constructor', 'staff,financials', 1, {}, []]) {
    await assert.rejects(f.read({ date: '2026-10-18', phase }), error => error.status === 400);
  }
  await assert.rejects(f.read({ date: 'not-a-date', phase: 'shell' }), error => error.status === 400);
  await assert.rejects(f.read({ phase: 'shell', includePrivate: 'true' }), error => error.status === 400);
  assert.equal(f.dashboardReads.length, 0);
});

test('phase failure is isolated while scope, sign-in, management and noAccess gates stay authoritative', async () => {
  const f = fixture(); f.setFailure('financials');
  await assert.rejects(f.read({ phase: 'financials' }), error => error.status === 503);
  assert.equal((await f.read({ phase: 'staff' })).status, 200);
  assert.equal((await f.read({ phase: 'shell' })).status, 200);
  const before = f.dashboardReads.length;
  f.setContext({ scope: 'scope-b' });
  await assert.rejects(f.read({ phase: 'shell' }), error => error.status === 409);
  assert.equal(f.dashboardReads.length, before);
  f.setContext({ scope: 'scope-a', user: null });
  await assert.rejects(f.read({ phase: 'shell' }), error => error.status === 401);
  assert.equal(f.dashboardReads.length, before);
  f.setContext({ user: { id: 'viewer' }, manage: false });
  await assert.rejects(f.read({ phase: 'shell' }), error => error.status === 403);
  assert.equal(f.dashboardReads.length, before);
  f.setContext({ manage: true }); f.setDenied(true);
  await assert.rejects(f.read({ phase: 'shell' }), error => error.status === 403);
});

test('wrapper ETags ignore only volatile dashboard generatedAt and still change for actual section data', async () => {
  const f = fixture(), args = { date: '2026-10-18', phase: 'financials' };
  const first = await f.read(args);
  const repeated = await f.platform.readAppLocalPlatformResource('page.owner-today', args, { scope: 'scope-a', etag: first.etag });
  assert.equal(repeated.status, 304);
  assert.equal(repeated.data, undefined);
  f.setValue(45);
  const changed = await f.platform.readAppLocalPlatformResource('page.owner-today', args, { scope: 'scope-a', etag: first.etag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.etag, first.etag);
  assert.equal(changed.data.dashboard.summary.sales.value, 45);
  assert.ok(changed.data.dashboard.generatedAt, 'original display timestamp is preserved');
});

test('nested page and role adapters join one read context without sharing identity across later requests', async () => {
  const f = fixture();
  await f.read({ phase: 'shell' });
  assert.equal(f.contextReads, 1, 'outer page context and nested role context use one authorized request snapshot');
  await f.read({ phase: 'staff' });
  assert.equal(f.contextReads, 2, 'the next independent read rechecks identity');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.platform.readAppLocalPlatformResource('page.owner-today', { phase: 'shell' }, { scope: 'scope-a', signal: controller.signal }));
  assert.equal(f.contextReads, 2, 'cancelled request does not start identity or records');
});
