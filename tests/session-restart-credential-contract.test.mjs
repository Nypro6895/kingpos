import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

// These are request-boundary contracts, not a WK cookie-persistence simulator.
// Execute the real proxy, refresh classifier, server auth gates and session route;
// replace only the SDK's wire boundary and the framework's request-local readers.
const require = createRequire(import.meta.url);
const ts = require('typescript'), sdk = require('@supabase/supabase-js');
const { NextRequest, NextResponse } = require('next/server');
function load(file, dependencies) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, Buffer, Headers, Request, Response, URL, AbortSignal, AbortController,
    DOMException, ReadableStream, performance,
    process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.invalid',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' } },
    // Refresh-map expiry is not the behavior under test. Each pipeline has its
    // own module instance, so no fixture can reuse another fixture's result.
    setTimeout: () => ({ unref() {} }), clearTimeout() {},
    fetch() { throw new Error('Live HTTP is forbidden in credential contracts'); },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: file });
  return exports;
}
const crypto = require('node:crypto');
const account = load('lib/account-security-shared.ts', {});
const accountStatus = load('lib/users/account-status.ts', {});
const policy = load('lib/supabase/session-policy.ts', {
  '@/lib/abuse-signals': { abuseSigningKey: () => null },
});
const rejection = load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': sdk });
const scope = load('lib/read-context-scope.ts', {
  'server-only': {}, 'node:async_hooks': require('node:async_hooks'),
});
const bounded = load('lib/bounded-get.ts', {});
const authRest = load('lib/supabase/auth-rest.ts', {
  '@/lib/bounded-get': bounded, '@/lib/read-context-scope': scope,
  '@/lib/app-local-command-trace': {
    measureAppLocalCommandBackend: (_kind, read) => read(),
    observeAppLocalCommandBackendStatus() {},
  },
  './auth-rejection': rejection,
});
const protocol = load('lib/app-local-command-trace-protocol.ts', {});
const ios = load('lib/ios-client.ts', {});
const expiredAccess = `synthetic.${Buffer.from(JSON.stringify({ exp: 1 })).toString('base64url')}.signature`;
const freshAccess = `synthetic.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
const loginId = '00000000-0000-4000-8000-000000000007';

function pipeline(options = {}) {
  const { access, refresh, remember, login,
  refreshError = null, refreshSession = { access_token: freshAccess, refresh_token: 'synthetic-rotated' },
  authError = null, status = 'active', statusError = null, loginError = null, revoked = false,
  authorization, beforeRefresh = async () => {},
  } = { access: freshAccess, login: loginId, ...options };
  const counts = { refresh: 0, auth: 0, account: 0, login: 0, route: 0 };
  const initial = new Map([
    ['sb-access-token', access], ['sb-refresh-token', refresh],
    [policy.REMEMBER_LOGIN_COOKIE, remember], [account.ACCOUNT_LOGIN_SESSION_COOKIE, login],
  ].filter(([, value]) => value !== undefined));
  const url = 'https://synthetic.invalid/api/auth/session';
  const request = new NextRequest(url, { headers: {
    cookie: [...initial].map(([name, value]) => `${name}=${value}`).join('; '),
    'x-reylumi-auth-unavailable': 'untrusted-client-value',
    ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
  } });
  const before = request.cookies.toString();
  const fakeSdk = { ...sdk, createClient(_url, _key, options) {
    assert.equal(options.auth.persistSession, false);
    assert.equal(options.auth.autoRefreshToken, false);
    return {
      auth: {
        async refreshSession(input) {
          counts.refresh++;
          assert.equal(input.refresh_token, refresh);
          await beforeRefresh();
          return { data: { session: refreshSession }, error: refreshError };
        },
        async getUser(token) {
          counts.auth++;
          const expected = authorization ?? (counts.refresh && !refreshError ? refreshSession?.access_token : access);
          assert.equal(token, expected, 'Server must validate the forwarded credential, never a fabricated session');
          assert.equal(options.global.headers.Authorization, `Bearer ${expected}`);
          return { data: { user: authError ? null : { id: 'synthetic-auth-user' } }, error: authError };
        },
      },
      from(table) {
        assert.ok(['users', 'account_login_sessions'].includes(table), 'Only existing auth status reads are allowed');
        const filters = new Map();
        const query = {
          select(columns) { assert.equal(columns, table === 'users' ? 'status' : 'revoked_at'); return query; },
          eq(name, value) { filters.set(name, value); return query; },
          async maybeSingle() {
            assert.equal(filters.get('auth_user_id'), 'synthetic-auth-user');
            if (table === 'users') {
              counts.account++;
              return { data: statusError ? null : { status }, error: statusError };
            }
            counts.login++;
            assert.equal(filters.get('id'), login);
            return { data: loginError ? null : { revoked_at: revoked ? '2026-01-01T00:00:00Z' : null }, error: loginError };
          },
        };
        return query;
      },
      rpc() { throw new Error('Unexpected account mutation or tombstone branch'); },
    };
  } };
  const refreshModule = load('lib/supabase/refresh-session.ts', {
    '@supabase/supabase-js': fakeSdk, '@/lib/account-security-shared': account,
    './session-policy': policy, './auth-rejection': rejection, 'node:crypto': crypto,
  });
  const proxy = load('proxy.ts', {
    'next/server': { NextResponse }, '@/lib/ios-client': ios,
    '@/lib/abuse-signals': { ABUSE_DEVICE_COOKIE: 'synthetic-device', ABUSE_HEADER: 'synthetic-safety',
      ABUSE_SIGNATURE_HEADER: 'synthetic-signature', abuseSigningKey: () => null },
    '@/lib/supabase/refresh-session': refreshModule, '@/lib/supabase/session-policy': policy,
    '@/lib/app-local-command-trace-protocol': protocol,
  });
  return { counts, async run() {
    const proxied = await proxy.proxy(request);
    assert.equal(proxied.status, 200);
    const forwarded = new Headers();
    for (const name of (proxied.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)) {
      const value = proxied.headers.get(`x-middleware-request-${name}`);
      if (value !== null) forwarded.set(name, value);
    }
    const forwardedRequest = new NextRequest(url, { headers: forwarded });
    const serverCookiesBefore = forwardedRequest.cookies.toString();
    const readers = { headers: async () => forwarded, cookies: async () => forwardedRequest.cookies };
    const server = load('lib/supabase/server.ts', {
      '@/lib/abuse-context': { safetyRequestHeaders: async () => ({}) },
      '@supabase/supabase-js': fakeSdk, '@/lib/account-security-shared': account,
      '@/lib/users/account-status': accountStatus, 'next/headers': readers,
      './session-policy': policy, './auth-rest': authRest,
      '@/lib/read-context-scope': scope, 'node:crypto': crypto,
    });
    const route = load('app/(app)/api/auth/session/route.ts', {
      '@/lib/supabase/server': server, 'next/headers': readers,
      '@/lib/supabase/session-policy': policy,
    });
    counts.route++;
    const response = await route.GET(new Request(url, { headers: forwarded }));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return { response, body: await response.json(), proxied, forwarded,
      cookies: forwardedRequest.cookies, before, after: request.cookies.toString(), counts,
      serverCookiesBefore, serverCookiesAfter: forwardedRequest.cookies.toString() };
  } };
}
function noCookieChanges(result) {
  assert.equal(result.after, result.before, 'Auth outcomes cannot delete or rewrite credentials');
  assert.equal(result.serverCookiesAfter, result.serverCookiesBefore, 'Server gates cannot mutate the request cookie jar');
  assert.equal(result.response.headers.has('set-cookie'), false, 'Session admission cannot persist or clear credentials');
  assert.equal(result.proxied.cookies.getAll().length, 0, 'No persistence changes on a non-refresh outcome');
}
function guest(result) {
  assert.equal(result.response.status, 200);
  assert.equal(result.body.authenticated, false);
  assert.equal(result.body.adminExpired, false);
}
function authenticated(result) {
  assert.equal(result.response.status, 200);
  assert.equal(result.body.authenticated, true);
  assert.equal(result.body.adminExpired, false);
  assert.equal(result.counts.auth, 1);
  assert.equal(result.counts.account, 1);
}

test('both credentials absent reaches the actual guest route without fabricating auth or trusting a client flag', async () => {
  const f = await pipeline({ access: undefined, login: undefined }).run();
  guest(f);
  assert.deepEqual(f.counts, { refresh: 0, auth: 0, account: 0, login: 0, route: 1 });
  assert.equal(f.forwarded.has('x-reylumi-auth-unavailable'), false);
  noCookieChanges(f);
});

test('missing access is restored from refresh before the actual server validates account and login session', async () => {
  const f = await pipeline({ access: undefined, refresh: 'synthetic-refresh', remember: '1' }).run();
  authenticated(f);
  assert.equal(f.counts.refresh, 1); assert.equal(f.counts.login, 1);
  assert.equal(f.cookies.get('sb-access-token')?.value, freshAccess);
  assert.equal(f.cookies.get(account.ACCOUNT_LOGIN_SESSION_COOKIE)?.value, loginId);
  const updates = f.proxied.cookies.getAll(); assert.equal(updates.length, 4);
  for (const cookie of updates) {
    assert.equal(cookie.maxAge, policy.REMEMBER_LOGIN_SECONDS);
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true);
  }
});

test('a pending refresh cannot forward a guest request or run server gates before its credential replacement settles', async () => {
  let started, release;
  const entered = new Promise(resolve => { started = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const p = pipeline({ access: undefined, refresh: 'synthetic-refresh', beforeRefresh: async () => {
    started(); await held;
  } });
  const response = p.run();
  await entered;
  assert.deepEqual(p.counts, { refresh: 1, auth: 0, account: 0, login: 0, route: 0 });
  release();
  authenticated(await response);
});

test('a fresh access credential works without refresh and remains subject to real account and login gates', async () => {
  const f = await pipeline().run();
  authenticated(f);
  assert.equal(f.counts.refresh, 0); assert.equal(f.counts.login, 1);
  noCookieChanges(f);
});

test('expired access without refresh is a confirmed guest only after the real server checks its rejection', async () => {
  const f = await pipeline({ access: expiredAccess, authError: new sdk.AuthApiError('Synthetic expired credential', 401) }).run();
  guest(f);
  assert.equal(f.counts.refresh, 0); assert.equal(f.counts.auth, 1);
  assert.equal(f.counts.account, 0); assert.equal(f.counts.login, 0);
  noCookieChanges(f);
});

test('missing Remember never opts into persistent cookies even when a missing access credential is refreshed', async () => {
  const f = await pipeline({ access: undefined, refresh: 'synthetic-refresh' }).run();
  authenticated(f);
  const updates = f.proxied.cookies.getAll(); assert.equal(updates.length, 4);
  for (const cookie of updates) {
    assert.equal(cookie.maxAge, undefined); assert.equal(cookie.expires, undefined);
    assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true);
  }
  assert.equal(f.cookies.get(policy.REMEMBER_LOGIN_COOKIE)?.value, '0');
});

test('missing or malformed login-session marker retains existing legacy compatibility, not a remembered lifetime', async () => {
  for (const login of [undefined, 'synthetic-malformed']) {
    const f = await pipeline({ login }).run();
    authenticated(f);
    assert.equal(f.counts.login, 0, 'Invalid IDs must not become a status query');
    assert.equal(f.counts.refresh, 0);
    noCookieChanges(f);
  }
});

test('a present revoked login-session marker denies valid access without removing credentials', async () => {
  const f = await pipeline({ revoked: true }).run();
  guest(f);
  assert.equal(f.counts.auth, 1); assert.equal(f.counts.account, 1); assert.equal(f.counts.login, 1);
  noCookieChanges(f);
});

test('an unavailable login-session status cannot turn a verified access credential into a guest', async () => {
  const f = await pipeline({ loginError: { code: '08006', message: 'Synthetic status outage' } }).run();
  assert.equal(f.response.status, 503); assert.equal('authenticated' in f.body, false);
  assert.equal(f.counts.login, 1); assert.equal(f.counts.refresh, 0);
  noCookieChanges(f);
});

test('a suspended account remains denied even when a missing login-session marker takes its legacy path', async () => {
  const f = await pipeline({ login: undefined, status: 'suspended' }).run();
  guest(f); assert.equal(f.counts.account, 1); assert.equal(f.counts.login, 0);
  noCookieChanges(f);
});

test('unknown400 or408 refreshing absent access returns trusted503 before any real server auth admission', async () => {
  for (const status of [400, 408]) {
    const f = await pipeline({ access: undefined, refresh: 'synthetic-refresh',
      refreshSession: null, refreshError: new sdk.AuthApiError('Synthetic unavailable refresh', status) }).run();
    assert.equal(f.response.status, 503); assert.equal('authenticated' in f.body, false);
    assert.equal(f.forwarded.get('x-reylumi-auth-unavailable'), '1');
    assert.deepEqual(f.counts, { refresh: 1, auth: 0, account: 0, login: 0, route: 1 });
    assert.equal(f.cookies.has('sb-access-token'), false);
    noCookieChanges(f);
  }
});

test('confirmed missing refresh or401/403 with absent access remains guest without retry or cookie deletion', async () => {
  for (const refreshError of [new sdk.AuthSessionMissingError(),
    new sdk.AuthApiError('Synthetic explicit denial', 401), new sdk.AuthApiError('Synthetic explicit denial', 403)]) {
    const f = await pipeline({ access: undefined, refresh: 'synthetic-refresh', refreshSession: null, refreshError }).run();
    guest(f); assert.equal(f.forwarded.has('x-reylumi-auth-unavailable'), false);
    assert.deepEqual(f.counts, { refresh: 1, auth: 0, account: 0, login: 0, route: 1 });
    noCookieChanges(f);
  }
});

test('fresh access still distinguishes unknown auth failures from confirmed401/403 through the actual server gate', async () => {
  for (const status of [400, 408, 503, 401, 403]) {
    const f = await pipeline({ authError: new sdk.AuthApiError('Synthetic access validation result', status) }).run();
    if ([401, 403].includes(status)) guest(f);
    else { assert.equal(f.response.status, 503); assert.equal('authenticated' in f.body, false); }
    assert.equal(f.counts.refresh, 0); assert.equal(f.counts.auth, 1);
    assert.equal(f.counts.account, 0); assert.equal(f.counts.login, 0);
    assert.equal(f.forwarded.has('x-reylumi-auth-unavailable'), false, 'This denial belongs to server validation, not proxy refresh');
    noCookieChanges(f);
  }
});

test('bearer authentication is validated normally and never causes the cookie refresh path to run', async () => {
  const f = await pipeline({ access: undefined, refresh: 'synthetic-refresh', authorization: freshAccess }).run();
  authenticated(f); assert.equal(f.counts.refresh, 0); assert.equal(f.counts.login, 1);
  noCookieChanges(f);
});
