import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isAuthSessionMissingError } from '@supabase/supabase-js';

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'console', code)(name => {
    if (name === './auth-rejection' || name === '@/lib/supabase/auth-rejection') return authRejection;
    if (name === '@supabase/supabase-js' && !(name in dependencies)) return { isAuthSessionMissingError };
    if (name === '@/lib/read-request-timing') return load('lib/read-request-timing.ts');
    if (name === '@/lib/read-context-scope') return { runWithReadContext: fn => fn(), getReadRequestTiming: () => undefined };
    if (name === '@/lib/today-dashboard-sections') return load('lib/today-dashboard-sections.ts');
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, { error() {} });
  return exports;
}
const authRejection = load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } });
const reads = load('lib/bounded-get.ts');
const auth = load('lib/supabase/auth-rest.ts', { '@/lib/bounded-get': reads, '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, operation) => operation(), observeAppLocalCommandBackendStatus() {} } });
const adminRow = { user_id: 'admin', membership_id: 'member', role_id: 'role', role_name: 'Admin', role_slug: 'admin', permissions: ['platform.access'] };

function adminFixture({ error = null, status = 200, row = adminRow, unavailableClient = false, validSession = true } = {}) {
  const clientOptions = [];
  const getter = load('lib/platform-admin/auth.ts', {
    'server-only': {}, react: { cache: fn => fn },
    'next/navigation': {}, '@/lib/auth-routing': {},
    '@/lib/platform-admin/permissions': {},
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'valid-session' }) }) },
    '@/lib/users/current-user': { getCurrentKingUser: async () => ({ id: 'admin' }) },
    '@/lib/supabase/session-policy': { ADMIN_SESSION_COOKIE: 'admin', readAdminSession: () => validSession },
    '@/lib/supabase/auth-rest': auth,
    '@/lib/supabase/server': {
      getAccessTokenFromRequest: async () => 'token',
      createAuthenticatedSupabaseServerClient: async options => {
        clientOptions.push(options);
        if (unavailableClient) {
          if (options.throwOnUnavailable) throw new auth.AuthAvailabilityError('Session status');
          return null;
        }
        return { rpc: () => ({ maybeSingle: async () => ({ data: row, error, status }) }) };
      },
    },
  });
  return { getter, clientOptions };
}

test('strict admin gate preserves verified grants and treats temporary RPC/client failure as unavailable', async () => {
  assert.equal((await adminFixture().getter.getVerifiedPlatformAdminContext()).membershipId, 'member');
  for (const failure of [{ error: { code: '08006', message: 'Connection failed' }, status: 503 }, { error: { message: 'fetch failed' }, status: 0 }, { unavailableClient: true }]) {
    const f = adminFixture(failure);
    await assert.rejects(f.getter.getVerifiedPlatformAdminContext(), auth.AuthAvailabilityError);
    assert.equal(f.clientOptions[0].throwOnUnavailable, true);
  }
});

test('confirmed absent/rejected admin access stays denied and legacy optional callers keep their behavior', async () => {
  for (const failure of [{ row: null }, { validSession: false }, { error: { status: 403 }, status: 403 }]) {
    assert.equal(await adminFixture(failure).getter.getVerifiedPlatformAdminContext(), null);
  }
  const legacy = adminFixture({ error: { code: '08006' }, status: 503 });
  assert.equal(await legacy.getter.getCurrentPlatformAdminContext(), null);
  assert.equal(legacy.clientOptions[0].throwOnUnavailable, false);
});

test('the actual context endpoint returns 503 for unverified admin access and 403 only for confirmed denial', async () => {
  let admin = adminRow, cause, contextReads = 0, adminReads = 0, unavailable = false;
  const GET = load('app/api/experience/context/route.ts', {
    'next/server': { connection: async () => {} },
    'next/headers': { headers: async () => new Headers(unavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}) },
    '@/lib/request-business-context': { getRequestBusinessContext: async () => { contextReads++; return { scope: 'business' }; } },
    '@/lib/platform-admin/auth': { getVerifiedPlatformAdminContext: async () => { adminReads++; if (cause) throw cause; return admin; } },
    '@/lib/experience-context': { getExperienceContext: context => context, getAdminExperienceContext: () => ({ scope: 'verified-admin' }) },
    '@/lib/platform-admin/permissions': { PLATFORM_ADMIN_PERMISSIONS: { access: 'platform.access' } },
    '@/lib/bounded-get': reads,
  }).GET;
  const request = () => new Request('https://fixture.test/api/experience/context?admin=1');
  assert.equal((await GET(request())).status, 200);
  cause = new auth.AuthAvailabilityError('Admin access');
  assert.equal((await GET(request())).status, 503);
  cause = undefined; admin = null;
  assert.equal((await GET(request())).status, 403);
  const before = [contextReads, adminReads]; unavailable = true;
  const response = await GET(request());
  assert.equal(response.status, 503);
  assert.deepEqual([contextReads, adminReads], before);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('all retained live GET handlers stop before private/auth reads when refresh availability is unverified', async () => {
  let privateReads = 0;
  const forbiddenRead = async () => { privateReads++; throw new Error('Private read must not start'); };
  const dependencies = {
    'next/server': { connection: async () => {}, NextResponse: class extends Response {} },
    'next/headers': { headers: async () => new Headers({ 'x-reylumi-auth-unavailable': '1' }) },
    '@/lib/current-context': { getCurrentBusinessContext: forbiddenRead },
    '@/lib/request-business-context': { getRequestBusinessContext: forbiddenRead },
    '@/lib/experience-context': {}, '@/lib/experience-live-resource-server': {}, '@/lib/workspace-resource-response': {},
    '@/lib/staff-offline-binding-server': {}, '@/lib/today-dashboard': {}, '@/lib/staff-my-work-resource-server': {},
    '@/lib/staff-portal-identity': { getStaffPortalIdentity: forbiddenRead },
    '@/lib/market-experience-data': {}, '@/lib/permissions': {},
    '@/lib/bookings': {}, '@/lib/daily-pos-report': {}, '@/lib/operational-report': {},
    '@/lib/workspace-pending': {}, '@/lib/notification-center': {}, '@/lib/notification-categories': {},
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: forbiddenRead },
  };
  for (const file of ['app/api/experience/today/route.ts', 'app/api/experience/my-work/route.ts', 'app/api/experience/market/route.ts', 'app/api/pos/owner/bookings/route.ts', 'app/api/pos/owner/reports/route.ts', 'app/api/notifications/route.ts', 'app/api/notifications/preferences/route.ts']) {
    const response = await load(file, dependencies).GET(new Request('https://fixture.test/api'));
    assert.equal(response.status, 503, file);
    assert.match(response.headers.get('cache-control'), /no-store/, file);
  }
  assert.equal(privateReads, 0);
});

test('admin and workspace validation start independently but no private context is returned before both complete', async () => {
  let finishContext, finishAdmin, complete = false;
  const started = [], deadlines = [];
  const context = new Promise(resolve => { finishContext = resolve; });
  const admin = new Promise(resolve => { finishAdmin = resolve; });
  const GET = load('app/api/experience/context/route.ts', {
    'next/server': { connection: async () => {} },
    'next/headers': { headers: async () => new Headers() },
    '@/lib/request-business-context': { getRequestBusinessContext: () => { started.push('context'); return context; } },
    '@/lib/platform-admin/auth': { getVerifiedPlatformAdminContext: () => { started.push('admin'); return admin; } },
    '@/lib/experience-context': { getExperienceContext: value => value, getAdminExperienceContext: () => ({ scope: 'verified-admin' }) },
    '@/lib/platform-admin/permissions': { PLATFORM_ADMIN_PERMISSIONS: { access: 'platform.access' } },
    '@/lib/bounded-get': { runReadWithDeadline: (read, timeout) => { deadlines.push(timeout); return read; } },
  }).GET;
  const pending = GET(new Request('https://fixture.test/api/experience/context?admin=1')).then(response => { complete = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ['context', 'admin']);
  assert.deepEqual(deadlines, [8_000, 12_000]);
  finishAdmin(adminRow);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(complete, false);
  finishContext({ scope: 'business' });
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).scope, 'verified-admin');
});

test('notification preference GET distinguishes temporary session failures from confirmed sign-out', async () => {
  let unavailable = true;
  const GET = load('app/api/notifications/preferences/route.ts', {
    'next/headers': { headers: async () => new Headers() },
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async options => {
      assert.equal(options.throwOnUnavailable, true);
      if (unavailable) throw new auth.AuthAvailabilityError();
      return null;
    } },
    '@/lib/current-context': {}, '@/lib/permissions': {}, '@/lib/notification-categories': {},
  }).GET;
  assert.equal((await GET()).status, 503);
  unavailable = false;
  assert.equal((await GET()).status, 401);
});
