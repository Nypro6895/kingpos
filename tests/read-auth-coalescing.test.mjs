import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import ts from 'typescript';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'console', code)(name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, { error() {}, log() {}, warn() {} });
  return exports;
}

// Only fake configuration is used; every SDK/transport operation below is mocked.
const configNames = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const previousConfig = configNames.map(name => process.env[name]);
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth-fixture.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-fixture-key';
after(() => configNames.forEach((name, index) => {
  if (previousConfig[index] === undefined) delete process.env[name];
  else process.env[name] = previousConfig[index];
}));

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const scope = load('lib/read-context-scope.ts', {
    'server-only': {}, 'node:async_hooks': { AsyncLocalStorage },
  });
  const request = new AsyncLocalStorage();
  const counts = { identity: 0, status: 0, session: 0, profile: 0, tombstone: 0, insert: 0 };
  const state = {
    authError: null, statusError: null, sessionError: null,
    status: 'active', revoked: false, missingProfile: false, tombstone: false,
  };
  const clientOptions = [];
  const accountStatus = load('lib/users/account-status.ts');
  const auth = load('lib/supabase/auth-rest.ts', {
    '@supabase/supabase-js': { isAuthSessionMissingError },
    '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, operation) => operation(), observeAppLocalCommandBackendStatus() {} },
    '@/lib/read-context-scope': scope,
    '@/lib/bounded-get': {
      ReadConnectionError: class extends Error {},
      fetchWithDeadline() { throw new Error('Unexpected real transport'); },
    },
  });
  const authUser = token => ({ id: `auth-${token}`, email: 'fixture@example.invalid', user_metadata: {} });
  const profile = token => ({ id: `user-${token}`, auth_user_id: `auth-${token}`, status: state.status });
  const sdk = {
    createClient(_url, _key, options) {
      clientOptions.push(options);
      const token = options.global?.headers?.Authorization?.replace('Bearer ', '') ?? 'anonymous';
      return {
        auth: {
          async getUser(accessToken) {
            counts.identity++;
            await tick();
            return { data: { user: state.authError ? null : authUser(accessToken) }, error: state.authError };
          },
        },
        from(table) {
          let selected, inserted = false;
          const filters = {};
          const query = {
            select(value) { selected = value; return query; },
            eq(key, value) { filters[key] = value; return query; },
            insert() { inserted = true; return query; },
            async maybeSingle() {
              const stage = inserted ? 'insert' : table === 'account_login_sessions' ? 'session' : selected === 'status' ? 'status' : 'profile';
              counts[stage]++;
              await tick();
              if (stage === 'session') {
                const revoked = typeof state.revoked === 'function' ? state.revoked(filters.id) : state.revoked;
                return { data: { revoked_at: revoked ? '2026-10-18T20:00:00Z' : null }, error: state.sessionError };
              }
              if (stage === 'status') return { data: { status: state.status }, error: state.statusError };
              if (stage === 'insert') return { data: profile(token), error: null };
              return { data: state.missingProfile ? null : profile(token), error: null };
            },
          };
          return query;
        },
        async rpc(name) {
          assert.equal(name, 'auth_identity_is_deleted');
          counts.tombstone++;
          await tick();
          return { data: state.tombstone, error: null };
        },
      };
    },
  };
  const server = load('lib/supabase/server.ts', {
    'node:crypto': crypto,
    '@/lib/abuse-context': { safetyRequestHeaders: async () => ({ 'x-safety-fixture': 'retained' }) },
    '@supabase/supabase-js': sdk,
    '@/lib/account-security-shared': {
      ACCOUNT_LOGIN_SESSION_COOKIE: 'app-login-session',
      isAccountLoginSessionId: value => typeof value === 'string' && value.startsWith('login-'),
    },
    '@/lib/users/account-status': accountStatus,
    'next/headers': {
      headers: async () => new Headers(),
      cookies: async () => ({
        get(name) {
          const value = name === 'sb-access-token' ? request.getStore()?.token : name === 'app-login-session' ? request.getStore()?.session : undefined;
          return value ? { value } : undefined;
        },
      }),
    },
    './session-policy': { ADMIN_SESSION_COOKIE: 'admin', REMEMBER_LOGIN_COOKIE: 'remember', sessionCookieOptions: () => ({}) },
    './auth-rest': auth,
    '@/lib/read-context-scope': scope,
  });
  const users = load('lib/users/current-user.ts', {
    react: { cache: read => read },
    '@/lib/supabase/server': server,
    '@/lib/users/account-status': accountStatus,
    '@/lib/supabase/auth-rest': auth,
  });
  const withRequest = (read, values = { token: 'one', session: 'login-one' }) => request.run(values, read);
  const withRead = (read, values) => withRequest(() => scope.runWithReadContext(read), values);
  return { scope, server, users, auth, counts, state, clientOptions, withRequest, withRead };
}

async function actualSDKAuthError(code, status) {
  let requests = 0;
  const client = createClient('https://synthetic-auth.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      requests++;
      assert.equal(new URL(String(input)).origin, 'https://synthetic-auth.invalid');
      assert.equal(new URL(String(input)).pathname, '/auth/v1/user');
      assert.equal(init?.method, 'GET');
      return Response.json({ code, message: 'Synthetic authentication response' }, {
        status, headers: { 'X-Supabase-Api-Version': '2024-01-01' },
      });
    } },
  });
  const result = await client.auth.getUser('synthetic-access-token');
  assert.equal(requests, 1, 'Only the injected synthetic transport may run');
  assert.equal(result.data.user, null);
  assert.ok(result.error);
  return result.error;
}

test('real SDK missing-session response remains a confirmed rejection after its status and code are normalized', async () => {
  for (const status of [400, 401]) {
    const error = await actualSDKAuthError('session_not_found', status);
    assert.equal(isAuthSessionMissingError(error), true);
    assert.equal(error.status, 400);
    assert.equal(error.code, undefined, 'The SDK replaces the original server error');
    const f = fixture();
    assert.doesNotThrow(() => f.auth.assertAuthAvailable(error, error.status));
    assert.equal(f.auth.isAuthTemporarilyUnavailable(error, error.status), false);
  }
});

test('real SDK missing-session error leaves real account getters and session GET unauthenticated without private reads', async () => {
  const f = fixture();
  f.state.authError = await actualSDKAuthError('session_not_found', 401);
  const session = load('app/(app)/api/auth/session/route.ts', {
    '@/lib/supabase/server': f.server,
    'next/headers': { headers: async () => new Headers(), cookies: async () => { throw new Error('No admin cookie read expected'); } },
    '@/lib/supabase/session-policy': { ADMIN_SESSION_COOKIE: 'admin', readAdminSession() { throw new Error('No admin gate expected'); } },
  });
  const results = await f.withRead(() => Promise.all([
    f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }),
    f.server.getSupabaseAuthUser(),
    f.users.getCurrentKingUser(),
    session.GET(new Request('https://synthetic-auth.invalid/api/auth/session')),
  ]));
  assert.deepEqual(results.slice(0, 3), [null, null, null]);
  assert.equal(results[3].status, 200);
  assert.deepEqual(await results[3].json(), { authenticated: false, adminExpired: false });
  assert.equal(results[3].headers.get('cache-control'), 'no-store');
  assert.deepEqual(f.counts, { identity: 1, status: 0, session: 0, profile: 0, tombstone: 0, insert: 0 });
});

test('real SDK unknown400 and unavailable503 stay unavailable and never admit an account or turn session GET into guest success', async () => {
  for (const [code, status] of [['validation_failed', 400], ['unexpected_failure', 503]]) {
    const f = fixture();
    f.state.authError = await actualSDKAuthError(code, status);
    assert.equal(isAuthSessionMissingError(f.state.authError), false);
    const session = load('app/(app)/api/auth/session/route.ts', {
      '@/lib/supabase/server': f.server,
      'next/headers': { headers: async () => new Headers(), cookies: async () => { throw new Error('No cookie inspection expected'); } },
      '@/lib/supabase/session-policy': {},
    });
    const results = await f.withRead(() => Promise.allSettled([
      f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }),
      f.server.getSupabaseAuthUser(),
      f.users.getCurrentKingUser(),
      session.GET(new Request('https://synthetic-auth.invalid/api/auth/session')),
    ]));
    for (const result of results.slice(0, 3)) {
      assert.equal(result.status, 'rejected');
      assert.ok(result.reason instanceof f.auth.AuthAvailabilityError);
      assert.equal(result.reason.status, 503);
    }
    assert.equal(results[3].status, 'fulfilled');
    assert.equal(results[3].value.status, 503);
    assert.deepEqual(await results[3].value.json(), { error: 'Authentication temporarily unavailable' });
    assert.deepEqual(f.counts, { identity: 1, status: 0, session: 0, profile: 0, tombstone: 0, insert: 0 });
  }
});

test('a matching plain error name without SDK error identity is not a confirmed missing session', () => {
  const f = fixture();
  const error = Object.assign(new Error('Synthetic unknown error'), { name: 'AuthSessionMissingError', status: 400 });
  assert.equal(isAuthSessionMissingError(error), false);
  assert.throws(() => f.auth.assertAuthAvailable(error, error.status), f.auth.AuthAvailabilityError);
  assert.equal(f.auth.isAuthTemporarilyUnavailable(error, error.status), false, 'Preserve the existing retry classifier for an unknown400');
});

test('parallel authenticated clients and the actual current-user branch join pending raw reads', async () => {
  for (const wrapped of [false, true]) {
    const f = fixture();
    const cohort = () => Promise.all([
      f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }),
      f.server.createAuthenticatedSupabaseServerClient(),
      f.users.getCurrentKingUser(),
    ]);
    const result = await (wrapped ? f.withRead(cohort) : f.withRequest(cohort));
    assert.ok(result[0]); assert.ok(result[1]);
    assert.equal(result[2].id, 'user-one');
    assert.deepEqual(f.counts, {
      identity: wrapped ? 1 : 3, status: wrapped ? 1 : 2, session: wrapped ? 1 : 2,
      profile: 1, tombstone: 0, insert: 0,
    });
    assert.notEqual(result[0], result[1]);
    assert.equal(f.clientOptions.filter(options => options.global?.headers?.['x-safety-fixture'] === 'retained').length, 2);
  }
});

test('non-read callers and separate HTTP read scopes always perform their own validations', async () => {
  for (const wrapped of [false, true]) {
    const f = fixture();
    const invoke = () => f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true });
    await Promise.all([1, 2].map(() => wrapped ? f.withRead(invoke) : f.withRequest(invoke)));
    assert.equal(f.counts.identity, 2);
    assert.equal(f.counts.status, 2);
    assert.equal(f.counts.session, 2);
  }
});

test('different tokens never share authority while session-cookie changes keep independent revocation reads', async () => {
  const f = fixture();
  await f.scope.runWithReadContext(() => Promise.all([
    f.withRequest(() => f.server.createAuthenticatedSupabaseServerClient()),
    f.withRequest(() => f.server.createAuthenticatedSupabaseServerClient(), { token: 'two', session: 'login-two' }),
  ]));
  assert.deepEqual([f.counts.identity, f.counts.status, f.counts.session], [2, 2, 2]);

  const sessions = fixture();
  sessions.state.revoked = id => id === 'login-revoked';
  const results = await sessions.scope.runWithReadContext(() => Promise.all([
    sessions.withRequest(() => sessions.server.createAuthenticatedSupabaseServerClient()),
    sessions.withRequest(() => sessions.server.createAuthenticatedSupabaseServerClient(), { token: 'one', session: 'login-revoked' }),
  ]));
  assert.ok(results[0]); assert.equal(results[1], null);
  assert.deepEqual([sessions.counts.identity, sessions.counts.status, sessions.counts.session], [1, 1, 2]);
});

test('settled validation cannot hide late session revocation or account suspension in the same read scope', async () => {
  const f = fixture();
  await f.withRead(async () => {
    assert.ok(await f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }));
    f.state.revoked = true;
    assert.equal(await f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), null);
    f.state.revoked = false; f.state.status = 'suspended';
    assert.equal(await f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), null);
    f.state.status = 'deleted';
    assert.equal(await f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), null);
  });
  assert.deepEqual([f.counts.identity, f.counts.status, f.counts.session], [4, 4, 4]);
});

test('joining unavailable transports preserves each strict/optional decision in either caller order', async () => {
  for (const stage of ['authError', 'statusError', 'sessionError']) {
    for (const strictFirst of [false, true]) {
      const f = fixture();
      f.state[stage] = { status: 503, code: '08006', message: 'Fixture connection unavailable' };
      const options = strictFirst ? [true, false] : [false, true];
      const results = await f.withRead(() => Promise.allSettled(options.map(throwOnUnavailable => f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable }))));
      const strict = results[options.indexOf(true)], optional = results[options.indexOf(false)];
      assert.equal(strict.status, 'rejected');
      assert.ok(strict.reason instanceof f.auth.AuthAvailabilityError);
      assert.equal(optional.status, 'fulfilled'); assert.equal(optional.value, null);
      assert.equal(f.counts.identity, 1);
      assert.equal(f.counts.status, stage === 'authError' ? 0 : 1);
      assert.equal(f.counts.session, stage === 'authError' ? 0 : 1);
    }
  }
});

test('confirmed invalid identity remains denied before account or session reads', async () => {
  for (const status of [401, 403]) {
    const f = fixture(); f.state.authError = { status, message: 'Rejected fixture identity' };
    assert.deepEqual(await f.withRead(() => Promise.all([
      f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }),
      f.server.createAuthenticatedSupabaseServerClient(),
      f.server.getSupabaseAuthUser(),
    ])), [null, null, null]);
    assert.deepEqual([f.counts.identity, f.counts.status, f.counts.session], [1, 0, 0]);
  }
});

test('shared identity keeps getSupabaseAuthUser default strict and optional error handling independent', async () => {
  const f = fixture(); f.state.authError = { status: 503, message: 'Fixture unavailable' };
  const result = await f.withRead(() => Promise.allSettled([
    f.server.getSupabaseAuthUser({ throwOnUnavailable: false }), f.users.getCurrentKingUser(),
  ]));
  assert.equal(result[0].value, null);
  assert.equal(result[1].status, 'rejected');
  assert.ok(result[1].reason instanceof f.auth.AuthAvailabilityError);
  assert.equal(f.counts.identity, 1); assert.equal(f.counts.profile, 0);
});

test('missing/legacy session cookie and missing session schema retain existing compatibility behavior', async () => {
  const f = fixture();
  assert.ok(await f.withRead(() => f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }), { token: 'one', session: undefined }));
  assert.equal(f.counts.session, 0);
  f.state.sessionError = { code: '42P01', message: 'Missing legacy table' };
  assert.ok(await f.withRead(() => f.server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true })));
});

test('current-user fallback keeps tombstones authoritative and never memoizes profile creation', async () => {
  const f = fixture(); f.state.missingProfile = true; f.state.tombstone = true;
  await f.withRead(async () => {
    assert.equal(await f.users.getCurrentKingUser(), null);
    assert.equal(f.counts.insert, 0);
    f.state.tombstone = false;
    assert.equal((await f.users.getCurrentKingUser()).id, 'user-one');
    assert.equal((await f.users.getCurrentKingUser()).id, 'user-one');
  });
  assert.deepEqual([f.counts.identity, f.counts.profile, f.counts.tombstone, f.counts.insert], [3, 3, 3, 2]);
});

test('pending helper clears rejected or synchronously throwing reads and preserves settled context memoization', async () => {
  const f = fixture(), rawKey = Symbol('raw'), contextKey = Symbol('context');
  let rawCalls = 0, contextCalls = 0;
  await f.scope.runWithReadContext(async () => {
    const read = () => { rawCalls++; throw new Error('Fixture synchronous failure'); };
    const failed = await Promise.allSettled([
      f.scope.coalesceReadInFlight(rawKey, 'same', read),
      f.scope.coalesceReadInFlight(rawKey, 'same', read),
    ]);
    assert.equal(rawCalls, 1); assert.equal(failed[0].status, 'rejected'); assert.equal(failed[1].status, 'rejected');
    assert.equal(await f.scope.coalesceReadInFlight(rawKey, 'same', async () => ++rawCalls), 2);
    const context = () => f.scope.memoizeReadContext(contextKey, async () => ++contextCalls);
    assert.equal(await context(), 1);
    assert.equal(await f.scope.runWithReadContext(context), 1);
    assert.equal(contextCalls, 1);
  });
});
