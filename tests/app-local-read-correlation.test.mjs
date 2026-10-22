import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';

const id = '10000000-0000-4000-8000-000000000001';
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const names = Object.keys(globals);
  new Function('require', 'exports', ...names, code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name} in ${file}`);
    return dependencies[name];
  }, exports, ...Object.values(globals));
  return exports;
}
function protocol(cryptoValue) {
  if (arguments.length === 0) cryptoValue = { randomUUID: () => id };
  return load('lib/read-request-trace-protocol.ts', { './app-local-command-trace-protocol': load('lib/app-local-command-trace-protocol.ts') }, { globalThis: { crypto: cryptoValue } });
}

test('diagnostic UUID generation cannot fail otherwise valid reads on old/custom WK runtimes', () => {
  for (const cryptoValue of [undefined, {}, { randomUUID: undefined }, { randomUUID: () => { throw new Error('unavailable'); } }, { randomUUID: () => 'invalid' }]) {
    assert.equal(protocol(cryptoValue).newReadRequestId(), undefined);
  }
  assert.equal(protocol().newReadRequestId(), id);
  assert.equal(protocol(undefined).newReadRequestId(new Headers({ 'X-Reylumi-Request-Id': id.toUpperCase() })), id);
  for (const value of ['private-secret', id + ',' + id, ' ' + id]) {
    assert.equal(protocol().readTraceRequestId(value), undefined);
  }
});

test('matching response echo is optional diagnostic metadata; legacy/mismatch never becomes correlation', () => {
  const p = protocol();
  for (const echo of [undefined, '20000000-0000-4000-8000-000000000002', 'private-secret']) {
    const value = p.responseReadTrace(new Response(null, { headers: echo ? { 'X-Reylumi-Request-Id': echo } : {} }), id, 'read');
    assert.deepEqual(value, { version: 1, kind: 'read', source: 'network' });
  }
  assert.equal(p.responseReadTrace(new Response(null, { headers: { 'X-Reylumi-Request-Id': id } }), id, 'context').requestId, id);
  assert.equal(p.responseReadTrace(new Response(null, { headers: { 'X-Reylumi-Request-Id': id } }), undefined, 'read').requestId, undefined);
});

test('bridge metadata is removed before DTO persistence and only held weakly; cache cannot claim an HTTP UUID', () => {
  const p = protocol();
  for (const source of ['network', 'joined', 'cache']) {
    const dto = { schemaVersion: 1, data: { marker: 'private-value' }, __reylumiReadTrace: { version: 1, kind: 'read', source, requestId: id, cookie: 'private-secret' } };
    const before = JSON.stringify({ schemaVersion: 1, data: dto.data });
    assert.equal(p.captureAppLocalReadTrace(dto), dto);
    assert.equal(JSON.stringify(dto), before);
    assert.deepEqual(Object.keys(dto), ['schemaVersion', 'data']);
    assert.deepEqual(p.appLocalReadTraceFields(dto), { readKind: 'read', readSource: source, ...(source === 'cache' ? {} : { requestId: id }) });
    assert.equal(p.getAppLocalReadTrace({ ...dto }), undefined, 'DTO copies do not inherit an HTTP identity');
  }
  const invalid = { data: true, __reylumiReadTrace: { version: 1, kind: 'private-secret', source: 'network', requestId: id } };
  p.captureAppLocalReadTrace(invalid); assert.equal(invalid.__reylumiReadTrace, undefined); assert.deepEqual(p.appLocalReadTraceFields(invalid), {});
});

function hostFixture({ echo = true, cryptoValue = { randomUUID: () => id }, status = 200, native = false } = {}) {
  const p = protocol(cryptoValue), calls = [];
  const scope = 'v3:' + 'a'.repeat(64);
  const window = { dispatchEvent() {}, location: { assign() {} } };
  if (native) {
    window.__reylumiAppLocalContext = { nonce: 'n', scopeEpoch: 1, generation: 'g' };
    window.__reylumiAppLocalTransport = { async request(request) {
      calls.push(request);
      return { schemaVersion: 1, status: 200, scope, data: { value: 1 }, __reylumiReadTrace: { version: 1, kind: request.kind, source: 'joined', requestId: id } };
    } };
  }
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const headers = new Headers(echo && init.headers?.['X-Reylumi-Request-Id'] ? { 'X-Reylumi-Request-Id': init.headers['X-Reylumi-Request-Id'] } : {});
    if (status === 304) { headers.set('x-reylumi-scope', scope); return new Response(null, { status, headers }); }
    return Response.json(status === 200 ? { schemaVersion: 1, status, scope, data: { value: 1 }, context: { scope }, grant: null } : { error: 'private-server-detail' }, { status, headers });
  };
  const host = load('lib/app-local-host.ts', {
    './bounded-get': { fetchBoundedGet: fetch, fetchWithDeadline: fetch },
    './experience-persistent-cache': { getExperienceDeviceGeneration: () => 'g', clearExperienceSnapshots: async () => {}, acceptExperienceOfflineGrant: async () => {} },
    './read-request-trace-protocol': p,
  }, { window, globalThis: { crypto: cryptoValue }, crypto: { getRandomValues: value => crypto.randomFillSync(value) } }).getAppLocalHost();
  return { host, p, calls, scope };
}

test('actual web host sends one read/context request, preserves 200/304/errors and does not change ETags/payloads', async () => {
  for (const status of [200, 304, 401, 403, 409, 503]) {
    const f = hostFixture({ status });
    let value;
    try { value = await f.host.read('staff.my-work', { tab: 'daily' }, { scope: f.scope, etag: '"existing"' }); }
    catch (error) { assert.ok(status >= 400); assert.equal(error.status, status); value = error; }
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].init.headers['X-Reylumi-Request-Id'], id);
    assert.equal(f.calls[0].init.headers['If-None-Match'], '"existing"');
    assert.deepEqual(f.p.appLocalReadTraceFields(value), { readKind: 'read', readSource: 'network', requestId: id });
    assert.equal(JSON.stringify(value).includes('__reylumiReadTrace'), false);
  }
  const f = hostFixture(); const value = await f.host.context('/staff/workday');
  assert.equal(f.calls.length, 1); assert.equal(f.p.appLocalReadTraceFields(value).readKind, 'context');
});

test('actual web host remains usable with no crypto or no response echo; native host strips joined delivery metadata', async () => {
  for (const options of [{ cryptoValue: null }, { cryptoValue: {} }, { cryptoValue: { randomUUID() { throw new Error('blocked'); } } }, { echo: false }]) {
    const f = hostFixture(options), value = await f.host.read('staff.my-work', {}, { scope: f.scope });
    assert.equal(value.status, 200); assert.equal(f.calls.length, 1);
    assert.equal(f.p.appLocalReadTraceFields(value).requestId, undefined);
  }
  const f = hostFixture({ native: true }); const value = await f.host.read('staff.my-work', {}, { scope: f.scope });
  assert.equal(f.calls.length, 1); assert.equal(Object.hasOwn(value, '__reylumiReadTrace'), false);
  assert.deepEqual(f.p.appLocalReadTraceFields(value), { readKind: 'read', readSource: 'joined', requestId: id });
});

test('JS diagnostic sanitizer admits fixed read correlation only and cannot assign cached/rendered content an HTTP identity', () => {
  const window = { __reylumiDiagnosticsEnabled: true };
  const trace = load('lib/experience-trace.ts', { './app-local-context-recovery': { APP_LOCAL_CONTEXT_REASONS: [] } }, { window });
  for (const [event, source] of [['cache.accept', 'network'], ['context.accept', 'joined'], ['cache.accept', 'cache'], ['data.visible', 'network']]) {
    trace.recordExperienceTrace(event, { readKind: 'read', readSource: source, requestId: id, cookie: 'private-secret' });
  }
  const rows = trace.getExperienceTraceSnapshot();
  assert.equal(rows[0].requestId, id); assert.equal(rows[1].requestId, id);
  assert.equal(rows[2].requestId, undefined); assert.equal(rows[3].requestId, undefined);
  assert.equal(JSON.stringify(rows).includes('private-secret'), false);
});

test('request-local nested semantic/backend timings remain diagnostic, overlap, and cannot alter response/ETag', async () => {
  let clock = 0;
  const { createReadRequestTiming } = load('lib/read-request-timing.ts');
  const timing = createReadRequestTiming(() => clock, id);
  await timing.measure('load', async () => {
    await timing.measure('auth_user', async () => { clock += 2; });
    await timing.measure('auth_status', async () => timing.measureBackend('rest', async () => { clock += 3; return new Response('x', { headers: { 'content-length': '1' } }); }));
    await timing.measure('auth_session', async () => { clock += 4; });
    await timing.measure('auth_tombstone', async () => { clock += 5; });
    await timing.measure('staff_resolve', async () => { clock += 6; });
    await timing.measure('staff_revalidate', async () => { clock += 7; });
  });
  const response = timing.finish(Response.json({ value: 1 }, { headers: { ETag: '"unchanged"' } }));
  assert.deepEqual(await response.json(), { value: 1 }); assert.equal(response.headers.get('etag'), '"unchanged"');
  assert.equal(response.headers.get('X-Reylumi-Request-Id'), id);
  const header = response.headers.get('server-timing');
  for (const stage of ['auth_user', 'auth_status', 'auth_session', 'auth_tombstone', 'staff_resolve', 'staff_revalidate']) assert.match(header, new RegExp(stage + ';dur='));
  assert.match(header, /backend_rest;dur=3.0;calls=1;bytes=1;sized=1/); assert.match(header, /load;dur=27.0/); assert.match(header, /total;dur=27.0/);
  assert.equal(/db|private|secret/.test(header), false);
});

test('actual SDK/server/Staff loader emit execution spans without adding calls or reusing final validation', async () => {
  const old = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://trace-fixture.invalid';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
  try {
    const reads = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
    const timingModule = load('lib/read-request-timing.ts');
    const rejection = load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } });
    const calls = [];
    let missingStatus = false;
    const scope = 'v3:' + 'b'.repeat(64);
    const context = { user: { id: 'synthetic-viewer', auth_user_id: 'synthetic-auth' }, currentSalon: { id: 'synthetic-salon' }, currentAccount: { id: 'synthetic-account' } };
    const staff = { id: 'synthetic-staff', salon_id: context.currentSalon.id, account_user_id: context.user.id, is_active: true };
    const backend = async (input, init = {}) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://trace-fixture.invalid');
      calls.push(url.pathname);
      await new Promise(resolve => setImmediate(resolve));
      let value;
      if (url.pathname === '/auth/v1/user') value = { id: 'synthetic-auth', email: 'fixture@example.invalid', user_metadata: {} };
      else if (url.pathname === '/rest/v1/users') value = missingStatus ? null : { status: 'active' };
      else if (url.pathname === '/rest/v1/account_login_sessions') value = { revoked_at: null };
      else if (url.pathname === '/rest/v1/staff') value = [staff];
      else if (url.pathname === '/rest/v1/rpc/auth_identity_is_deleted') value = false;
      else if (url.pathname === '/rest/v1/rpc/get_salon_business_timezone') value = 'America/Chicago';
      else if (url.pathname === '/rest/v1/rpc/get_my_staff_greeting_context') value = null;
      else assert.fail('Unexpected backend operation');
      assert.ok(['GET', 'POST'].includes(init.method ?? 'GET'));
      return Response.json(value);
    };
    const auth = load('lib/supabase/auth-rest.ts', {
      '@/lib/bounded-get': { fetchWithDeadline: backend, ReadConnectionError: class extends Error {} },
      '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, read) => read(), observeAppLocalCommandBackendStatus() {} },
      '@/lib/read-context-scope': reads, './auth-rejection': rejection,
    }, { fetch: backend });
    const server = load('lib/supabase/server.ts', {
      'node:crypto': crypto, '@supabase/supabase-js': { createClient },
      '@/lib/abuse-context': { safetyRequestHeaders: async () => ({}) },
      '@/lib/account-security-shared': { ACCOUNT_LOGIN_SESSION_COOKIE: 'login-session', isAccountLoginSessionId: value => value === 'synthetic-login' },
      '@/lib/users/account-status': load('lib/users/account-status.ts'),
      'next/headers': { headers: async () => new Headers(), cookies: async () => ({ get: name => ({ value: name === 'sb-access-token' ? 'synthetic-token' : name === 'login-session' ? 'synthetic-login' : '' }) }) },
      './session-policy': { ADMIN_SESSION_COOKIE: 'admin', REMEMBER_LOGIN_COOKIE: 'remember', sessionCookieOptions: () => ({}) },
      './auth-rest': auth, './auth-rejection': rejection, '@/lib/read-context-scope': reads,
    });
    const experience = { getExperienceContext: () => ({ scope }) };
    const portal = load('lib/staff-portal-identity.ts', {
      'server-only': {}, react: { cache: read => read }, '@/lib/current-context': { getCurrentStaffBusinessContext: async () => context },
      '@/lib/supabase/server': server, '@/lib/staff-account': load('lib/staff-account.ts', { 'server-only': {} }),
      '@/lib/experience-context': experience, '@/lib/read-context-scope': reads,
    });
    const loader = load('lib/staff-my-work-resource-server.ts', {
      'server-only': {}, '@/lib/experience-context': experience, '@/lib/payroll': {}, '@/lib/staff-portal-identity': portal,
      '@/lib/staff-profile': { getStaffProfileDisplayName: () => 'Synthetic', getStaffProfileAvatarUrl: () => null },
      '@/lib/staff-workdays': { getCurrentStaffAssignedWork: async () => ({ excludedTicketCount: 0, today: '2026-10-21', workTickets: [] }), getTodaysStaffWorkday: async () => ({ workday: null }), STAFF_WORKDAY_STATUS_LABELS: { not_checked_in: 'Not checked in' } },
      './staff-my-work-experience': load('lib/staff-my-work-experience.ts'),
    });
    const timing = timingModule.createReadRequestTiming(undefined, id);
    const value = await reads.runWithReadContext(async () => loader.loadStaffMyWorkResource(await portal.getStaffPortalIdentity(), {}, timing), timing);
    assert.equal(value.staff.id, staff.id);
    const response = timing.finish(Response.json({ ok: true }));
    const header = response.headers.get('server-timing');
    for (const stage of ['auth_user', 'auth_status', 'auth_session', 'staff_resolve', 'staff_revalidate']) assert.match(header, new RegExp(stage + ';dur='));
    for (const path of ['/auth/v1/user', '/rest/v1/users', '/rest/v1/account_login_sessions', '/rest/v1/staff']) assert.equal(calls.filter(value => value === path).length, 2, 'Initial and mandatory final validation retain exactly their prior calls');
    assert.equal(calls.length, 10);
    assert.match(header, /backend_auth;dur=[\d.]+;calls=2/);
    assert.match(header, /backend_rest;dur=[\d.]+;calls=6/);
    assert.match(header, /backend_rpc;dur=[\d.]+;calls=2/);
    assert.equal(header.includes('auth_tombstone'), false);
    missingStatus = true;
    const conditional = timingModule.createReadRequestTiming();
    await reads.runWithReadContext(() => server.createAuthenticatedSupabaseServerClient({ throwOnRejected: true, throwOnUnavailable: true }), conditional);
    assert.match(conditional.finish(new Response()).headers.get('server-timing'), /auth_tombstone;dur=/);
    assert.equal(calls.filter(value => value === '/rest/v1/rpc/auth_identity_is_deleted').length, 1);
    assert.equal(/synthetic|fixture|token|salon|viewer/.test(header), false);
  } finally {
    ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].forEach((name, index) => { if (old[index] === undefined) delete process.env[name]; else process.env[name] = old[index]; });
  }
});
