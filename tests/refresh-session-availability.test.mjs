import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url), ts = require('typescript');
const sdk = require('@supabase/supabase-js');
const { NextRequest, NextResponse } = require('next/server');
function load(file, dependencies, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Buffer, AbortSignal, AbortController, Headers, Request, Response, URL, performance,
    process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' } },
    setTimeout: () => ({ unref() {} }),
    fetch() { throw new Error('Live HTTP is forbidden in refresh tests'); },
    require(name) { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; },
    ...globals,
  }, { filename: file });
  return exports;
}
const policy = load('lib/supabase/session-policy.ts', { '@/lib/abuse-signals': { abuseSigningKey: () => null } });
const rejection = load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': sdk });
const expiredAccess = `synthetic.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`;
const newAccess = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
function fixture(error, { remember = '1', session = null } = {}) {
  const values = new Map([
    ['sb-access-token', expiredAccess], ['sb-refresh-token', 'synthetic-refresh-old'],
    ['reylumi-login-session', 'synthetic-login-session'], [policy.REMEMBER_LOGIN_COOKIE, remember],
  ]);
  const before = [...values]; let calls = 0;
  const request = {
    headers: new Headers(), nextUrl: { pathname: '/api/app-local/context' },
    cookies: { get: name => values.has(name) ? { value: values.get(name) } : undefined, set: (name, value) => values.set(name, value) },
  };
  const module = load('lib/supabase/refresh-session.ts', {
    '@supabase/supabase-js': { ...sdk, createClient(_url, _key, options) {
      assert.equal(options.auth.persistSession, false); assert.equal(options.auth.autoRefreshToken, false);
      return { auth: { refreshSession: async input => {
        assert.equal(input.refresh_token, 'synthetic-refresh-old'); calls++;
        return { data: { session }, error };
      } } };
    } },
    '@/lib/account-security-shared': { ACCOUNT_LOGIN_SESSION_COOKIE: 'reylumi-login-session' },
    './session-policy': policy, './auth-rejection': rejection, 'node:crypto': require('node:crypto'),
  });
  return { run: () => module.refreshRequestSession(request), values, before, calls: () => calls };
}
async function assertFailure(error, unavailable) {
  const f = fixture(error), result = await f.run();
  assert.equal(result.updates.length, 0);
  assert.equal(f.calls(), 1, 'Refresh is not replayed by this classifier');
  assert.deepEqual([...f.values], f.before, 'A failed refresh cannot delete or replace credentials or Remember choice');
  assert.equal(result.unavailable, unavailable);
}

test('unknown refresh400 remains unavailable rather than becoming a confirmed sign-out', async () => {
  for (const error of [new sdk.AuthApiError('Synthetic unknown400', 400), { status: 400, code: 'unknown_refresh_failure' }]) {
    await assertFailure(error, true);
  }
});

test('refresh408 remains unavailable and preserves all session cookies', async () => {
  await assertFailure(new sdk.AuthApiError('Synthetic request timeout', 408), true);
});

test('the actual SDK session-missing400 and explicit invalid-refresh codes remain confirmed rejections', async () => {
  await assertFailure(new sdk.AuthSessionMissingError(), false);
  for (const code of ['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used']) {
    await assertFailure(new sdk.AuthApiError('Synthetic confirmed missing refresh session', 400, code), false);
  }
});

test('actual refresh401 and403 remain confirmed rejections', async () => {
  for (const status of [401, 403]) await assertFailure(new sdk.AuthApiError('Synthetic explicit denial', status), false);
});

test('refresh service or network failures preserve credentials and remain unavailable', async () => {
  for (const error of [new sdk.AuthApiError('Synthetic throttle', 429), new sdk.AuthApiError('Synthetic server failure', 500), new sdk.AuthApiError('Synthetic outage', 503), new Error('Synthetic network failure'), null]) {
    await assertFailure(error, true);
  }
});

test('successful refresh preserves explicit Remember true and false without extending opt-out', async () => {
  for (const remember of ['0', '1']) {
    const f = fixture(null, { remember, session: { access_token: newAccess, refresh_token: 'synthetic-refresh-new' } });
    const result = await f.run();
    assert.equal(result.unavailable, false); assert.equal(f.calls(), 1);
    assert.equal(f.values.get('sb-refresh-token'), 'synthetic-refresh-new');
    assert.equal(f.values.get(policy.REMEMBER_LOGIN_COOKIE), remember);
    assert.equal(result.updates.length, 4);
    for (const update of result.updates) {
      assert.equal(update.options.maxAge, remember === '1' ? policy.REMEMBER_LOGIN_SECONDS : undefined);
      assert.equal(update.options.httpOnly, true); assert.equal(update.options.secure, true);
    }
  }
});

// Execute actual refresh -> actual Next proxy request-header overrides -> actual
// app-local context route. Only Supabase and the business/lease backend are
// synthetic; no real account, HTTP request, credential or mutation is involved.
const protocol = load('lib/app-local-command-trace-protocol.ts', {});
const readTrace = load('lib/read-request-trace-protocol.ts', { './app-local-command-trace-protocol': protocol });
const ios = load('lib/ios-client.ts', {});
const timing = load('lib/read-request-timing.ts', {});
const scope = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': require('node:async_hooks') });
async function integrated(error, { remember = '1', success = false } = {}) {
  let refreshCalls = 0, businessCalls = 0, leaseCalls = 0;
  const url = 'https://synthetic.invalid/api/app-local/context?path=%2Fstaff%2Ftoday&generation=synthetic-generation-12345';
  const cookies = `sb-access-token=${expiredAccess}; sb-refresh-token=synthetic-refresh-old; reylumi-remember-login=${remember}; reylumi-login-session=synthetic-session`;
  const request = new NextRequest(url, { headers: { cookie: cookies, 'x-reylumi-auth-unavailable': 'spoofed-client-value', 'user-agent': 'ReylumiIOS/1.0' } });
  const before = request.cookies.toString();
  const refresh = load('lib/supabase/refresh-session.ts', {
    '@supabase/supabase-js': { ...sdk, createClient: () => ({ auth: { refreshSession: async () => {
      refreshCalls++;
      return { data: { session: success ? { access_token: newAccess, refresh_token: 'synthetic-refresh-new' } : null }, error };
    } } }) },
    '@/lib/account-security-shared': { ACCOUNT_LOGIN_SESSION_COOKIE: 'reylumi-login-session' },
    './session-policy': policy, './auth-rejection': rejection, 'node:crypto': require('node:crypto'),
  });
  const proxy = load('proxy.ts', {
    'next/server': { NextResponse }, '@/lib/ios-client': ios,
    '@/lib/abuse-signals': { ABUSE_DEVICE_COOKIE: 'synthetic-device', ABUSE_HEADER: 'synthetic-safety', ABUSE_SIGNATURE_HEADER: 'synthetic-signature', abuseSigningKey: () => null },
    '@/lib/supabase/refresh-session': refresh, '@/lib/supabase/session-policy': policy,
    '@/lib/app-local-command-trace-protocol': protocol,
  });
  const proxied = await proxy.proxy(request);
  assert.equal(proxied.status, 200);
  // NextResponse encodes request overrides for the routing layer. Decode those
  // actual headers rather than copying our original client-supplied header.
  const forwarded = new Headers();
  for (const name of (proxied.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)) {
    const value = proxied.headers.get(`x-middleware-request-${name}`);
    if (value !== null) forwarded.set(name, value);
  }
  const isFresh = () => new NextRequest(url, { headers: forwarded }).cookies.get('sb-access-token')?.value === newAccess;
  const business = () => ({ user: isFresh() ? { id: 'synthetic-user', display_name: 'Synthetic', language: 'en' } : null,
    currentSalon: isFresh() ? { id: 'synthetic-salon' } : null, activeRole: null, salonRole: null, accountRole: null,
    salonMode: 'owner', defaultRouteForCurrentContext: '/staff/today' });
  const route = load('app/api/app-local/context/route.ts', {
    'next/headers': { headers: async () => forwarded }, 'next/server': { connection: async () => {} },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => { businessCalls++; return business(); } },
    '@/lib/experience-context': { getExperienceContext: input => ({ authenticated: Boolean(input.user), viewerId: input.user?.id ?? null, workspaceId: input.user ? 'synthetic-owner' : 'personal', salonId: input.currentSalon?.id ?? null, scope: 'v3:' + 'a'.repeat(64), permissionRevision: 'synthetic-permission' }) },
    '@/lib/experience-offline-policy': { getExperienceOfflinePath: path => path },
    '@/app/api/experience/offline-context/route': { GET: async () => { leaseCalls++; return Response.json(isFresh() ? { version: 1, kind: 'owner' } : { error: 'Synthetic confirmed missing session' }, { status: isFresh() ? 200 : 401 }); } },
    '@/lib/staff-portal-identity': { getStaffPortalIdentity() { throw new Error('Owner path must not enter Staff identity'); } },
    '@/lib/current-context': { isSalonManageContext: input => Boolean(input.user), getCurrentStaffBusinessContext() { throw new Error('Owner path must not enter Staff workday'); } },
    '@/lib/app-local-portable-context-server': { readAppLocalPortableContext: async () => null },
    '@/lib/app-local-display-server': { readAppLocalDisplayContext: async () => null },
    '@/lib/read-context-scope': scope, '@/lib/read-request-timing': timing,
    '@/lib/read-request-trace-protocol': readTrace,
    '@/lib/staff-online-access-server': { getStaffOnlineOnlyAccess() { throw new Error('Owner path cannot acquire Staff proof'); } },
  });
  const response = await route.GET(new Request(url, { headers: forwarded }));
  return { response, body: await response.json(), forwarded, proxied, refreshCalls, businessCalls, leaseCalls, before, after: request.cookies.toString() };
}

test('actual proxy forwards unknown400 and408 as trusted unavailability and context returns503 before guest admission', async () => {
  for (const status of [400, 408]) {
    const f = await integrated(new sdk.AuthApiError('Synthetic unconfirmed refresh failure', status));
    assert.deepEqual({ trustedUnavailable: f.forwarded.get('x-reylumi-auth-unavailable'), status: f.response.status,
      hasDisplayContext: 'context' in f.body, businessCalls: f.businessCalls, leaseCalls: f.leaseCalls },
    { trustedUnavailable: '1', status: 503, hasDisplayContext: false, businessCalls: 0, leaseCalls: 0 },
    'An outage must stop before either guest or authenticated display admission');
    assert.equal(f.refreshCalls, 1); assert.equal(f.before, f.after);
    assert.equal(f.proxied.cookies.getAll().length, 0, 'Outage never deletes or rewrites session cookies');
  }
});

test('actual proxy clears spoofed unavailability while confirmed rejection remains a denied guest envelope', async () => {
  for (const error of [new sdk.AuthSessionMissingError(), new sdk.AuthApiError('Synthetic explicit denial', 401), new sdk.AuthApiError('Synthetic explicit denial', 403)]) {
    const f = await integrated(error);
    assert.equal(f.forwarded.has('x-reylumi-auth-unavailable'), false, 'Client-provided availability headers are never trusted');
    assert.equal(f.response.status, 200);
    assert.equal(f.body.context.authenticated, false); assert.equal(f.body.grantStatus, 401); assert.equal(f.body.grant, null);
    assert.equal(f.body.access.ownerWorkspace, false); assert.equal(f.body.access.staffWorkspace, false);
    assert.equal(f.businessCalls, 1); assert.equal(f.leaseCalls, 1);
    assert.equal(f.refreshCalls, 1); assert.equal(f.before, f.after); assert.equal(f.proxied.cookies.getAll().length, 0);
  }
});

test('actual proxy forwards successful rotated cookies, removes spoofed availability, and preserves Remember lifetime', async () => {
  for (const remember of ['0', '1']) {
    const f = await integrated(null, { remember, success: true });
    assert.equal(f.forwarded.has('x-reylumi-auth-unavailable'), false);
    assert.equal(f.response.status, 200); assert.equal(f.body.context.authenticated, true); assert.equal(f.body.grantStatus, 200);
    assert.equal(f.refreshCalls, 1); assert.equal(f.businessCalls, 1); assert.equal(f.leaseCalls, 1);
    const updates = f.proxied.cookies.getAll(); assert.equal(updates.length, 4);
    for (const update of updates) assert.equal(update.maxAge, remember === '1' ? policy.REMEMBER_LOGIN_SECONDS : undefined);
  }
});
