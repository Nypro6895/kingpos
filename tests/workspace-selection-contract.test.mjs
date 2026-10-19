import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import test from 'node:test';
import * as React from 'react';
import ts from 'typescript';

// Actual route/adapters, in-memory cookies and synthetic authority only. This
// test never contacts a server or creates/changes a business record.
function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => {
    assert.ok(name in dependencies, `Unexpected ${file} dependency ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

function fixture({ revoked = false, cookieFailure = false, cookieFailureAfter = 0, destinationAllowed = true, authenticated = true } = {}) {
  const trace = [], updates = [], jar = new Map();
  const staff = { id: 'staff:fixture', type: 'salon', salonMode: 'staff', accountId: 'fixture-account', salonId: 'fixture-salon' };
  const owner = { ...staff, id: 'manage:fixture', salonMode: 'manage' };
  const scope = 'v3:' + 'a'.repeat(64);
  const context = { scope, user: authenticated ? { id: 'fixture-viewer' } : null, workspaceOptions: revoked ? [staff] : [staff, owner], currentWorkspace: staff };
  const state = { context, authUnavailable: false, staffContext: undefined };
  const cookies = {
    get: name => jar.has(name) ? { name, value: jar.get(name) } : undefined,
    set(name, value, options) {
      if (cookieFailureAfter && updates.length === cookieFailureAfter) throw Error('Synthetic partial cookie writer failure');
      updates.push({ operation: 'set', name, value, ...options }); jar.set(name, value);
    },
    delete(name) { updates.push({ operation: 'delete', name }); jar.delete(name); },
  };
  const source = readFileSync('lib/current-context.ts', 'utf8');
  const ast = ts.createSourceFile('context.ts', source, ts.ScriptTarget.Latest, true);
  const wanted = new Set(['setWorkspaceCookie', 'writeNormalizedWorkspaceContextCookies']);
  const cookieCode = ast.statements.filter(s => ts.isFunctionDeclaration(s) && wanted.has(s.name?.text)).map(s => s.getText(ast)).join('\n');
  const cookieModule = {};
  new Function('exports', 'CURRENT_ACCOUNT_COOKIE', 'SELECTED_WORKSPACE_COOKIE', 'CURRENT_MANAGE_SALON_COOKIE', 'LEGACY_CURRENT_SALON_COOKIE', 'CURRENT_STAFF_SALON_COOKIE', ts.transpileModule(cookieCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(cookieModule, 'kingpos-current-account-id', 'kingpos-selected-workspace', 'kingpos-current-manage-salon-id', 'kingpos-current-salon-id', 'kingpos-current-staff-salon-id');
  const currentModule = {
    getCurrentBusinessContext: async () => { trace.push('business-context'); return state.context; },
    getCurrentStaffBusinessContext: async () => state.staffContext ?? { ...state.context, scope: 'v3:' + 'b'.repeat(64) },
    getWorkspaceLandingHref: workspace => workspace.salonMode === 'manage' ? '/staff/today' : '/staff/my-work',
    isWorkspaceDestinationAllowed: () => destinationAllowed,
    setNormalizedWorkspaceContext: async workspace => {
      trace.push('write-workspace');
      if (cookieFailure) throw Error('Synthetic cookie writer failed');
      cookieModule.writeNormalizedWorkspaceContextCookies(cookies, workspace);
    },
    isOwnerMembership: () => true, isSalonManageContext: () => true,
  };
  const nextResponse = { redirect(url) { const response = new Response(null, { status: 307, headers: { location: url.toString() } }); response.cookies = { getAll: () => [] }; return response; } };
  const revalidate = { revalidatePath: (...args) => trace.push('revalidate:' + args.join(',')) };
  const selection = existsSync('lib/workspace-selection.ts') ? load('lib/workspace-selection.ts', { 'server-only': {}, '@/lib/current-context': currentModule, 'next/cache': revalidate }) : {};
  const workspace = load('app/(app)/workspace/open/route.ts', {
    '@/lib/auth-routing': { loginHrefForReturnPath: path => '/login?next=' + encodeURIComponent(path) },
    '@/lib/current-context': currentModule, '@/lib/workspace-selection': selection,
    'next/cache': revalidate, 'next/server': { NextResponse: nextResponse },
  });
  const nextHeaders = { headers: async () => new Headers(state.authUnavailable ? { 'x-reylumi-auth-unavailable': '1' } : {}), cookies: async () => cookies };
  const requestContext = load('lib/request-business-context.ts', { 'server-only': {}, react: React, '@/lib/current-context': currentModule,
    '@/lib/read-context-scope': load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } }),
    '@/lib/bounded-get': load('lib/bounded-get.ts', {}),
  });
  const staffIdentity = { getStaffPortalIdentity: async () => ({ context: state.staffContext ?? { ...state.context, scope: 'v3:' + 'b'.repeat(64) }, staff: state.staffContext ? { id: 'fixture-staff' } : null }) };
  const experience = { getExperienceContext: value => ({ scope: value.scope }) };
  const shell = load('lib/app-local-shell-server.ts', {
    'server-only': {}, 'node:crypto': crypto, 'next/headers': nextHeaders, 'next/server': { NextRequest: Request },
    './request-business-context': requestContext, './experience-context': experience, './current-context': currentModule,
    './staff-portal-identity': staffIdentity, '@/app/salon-switcher': {}, '@/components/abuse-notice': {}, './vietnamese-plugin': {},
    './explore-advertising': {}, './owner-campaigns': {}, './workspace-pending': {}, './workspace-language-server': {}, './bounded-get': { runReadWithDeadline: value => value },
    '@/app/(app)/api/auth/session/route': {}, '@/app/(app)/api/auth/logout/route': {},
    '@/app/(app)/workspace/open/route': workspace, '@/lib/workspace-selection': selection,
    '@/app/api/public-booking/context/route': {}, '@/app/api/explore/advertising/route': {}, './app-local-shell-metadata': {},
  });
  const noopHTTP = async () => ({ handled: false });
  const route = load('app/api/app-local/command/route.ts', {
    'next/server': { connection: async () => {} }, 'next/headers': nextHeaders,
    '@/lib/request-business-context': requestContext, '@/lib/experience-context': experience,
    '@/lib/staff-portal-identity': staffIdentity, '@/lib/current-context': currentModule,
    '@/lib/app-local-commands-server.generated': {}, '@/lib/app-local-command-codec': {},
    '@/lib/app-local-http-server': { runAppLocalHttpCommand: noopHTTP }, '@/lib/app-local-role-http-server': { runAppLocalRoleHttpCommand: noopHTTP },
    '@/lib/app-local-personal-resources-server': { runAppLocalPersonalCommand: noopHTTP }, '@/lib/app-local-explore-server': { runAppLocalExploreHttpCommand: noopHTTP },
    '@/lib/app-local-public-server': { runAppLocalPublicHttpCommand: noopHTTP },
    '@/lib/app-local-upload-server': { runAppLocalUploadCommand: noopHTTP, AppLocalUploadError: class extends Error {} }, '@/lib/app-local-shell-server': shell,
    '@/lib/app-local-portable-http-server': {}, '@/lib/app-local-portable-context-server': {},
    '@/lib/app-local-scope-id': { isAppLocalScopeId: s => /^v3:[a-f0-9]{64}$/.test(s), isAppLocalPortableScopeId: () => false },
    '@/lib/app-local-portable-actions.generated.json': {}, '@/lib/app-local-display-server': {},
  });
  const command = async (args = { workspaceId: owner.id }, origin = 'https://reylumi.com', requestedScope = scope) => {
    const request = new Request('https://reylumi.com/api/app-local/command', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'shell.switch-workspace', args, requestId: crypto.randomUUID(), scope: requestedScope }) });
    const response = await route.POST(request);
    return { status: response.status, body: await response.json() };
  };
  const web = query => workspace.GET(new Request('https://reylumi.com/workspace/open?' + query));
  return { command, web, updates, trace, state, staff, owner, scope };
}

test('workspace command performs one fresh prewrite selection, commits the original five cookie operations and returns the allowed destination', async () => {
  const f = fixture();
  const result = await f.command();
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true, data: { path: '/staff/today' } });
  assert.equal(f.trace.filter(value => value === 'business-context').length, 1, 'one command must not reread the same complete prewrite context');
  assert.deepEqual(f.updates.map(({ operation, name, value }) => ({ operation, name, ...(value ? { value } : {}) })), [
    { operation: 'set', name: 'kingpos-selected-workspace', value: f.owner.id },
    { operation: 'set', name: 'kingpos-current-account-id', value: f.owner.accountId },
    { operation: 'set', name: 'kingpos-current-manage-salon-id', value: f.owner.salonId },
    { operation: 'set', name: 'kingpos-current-salon-id', value: f.owner.salonId },
    { operation: 'delete', name: 'kingpos-current-staff-salon-id' },
  ]);
  assert.equal(f.trace.filter(value => value === 'revalidate:/,layout').length, 1);
});

test('a revoked target is a failed command, never an error redirect reported as success', async () => {
  const f = fixture({ revoked: true }), result = await f.command();
  assert.equal(result.status, 403); assert.equal(result.body.ok, false);
  assert.equal(f.updates.length, 0); assert.ok(!f.trace.includes('revalidate:/,layout'));
});

test('cookie commit failure is unconfirmed, never a successful workspace navigation', async () => {
  const f = fixture({ cookieFailure: true }), result = await f.command();
  assert.equal(result.status, 503); assert.equal(result.body.ok, false);
  assert.equal(f.updates.length, 0); assert.ok(!f.trace.includes('revalidate:/,layout'));
});

test('partial cookie delivery remains unconfirmed and never retries the committed prefix', async () => {
  const f = fixture({ cookieFailureAfter: 2 }), result = await f.command();
  assert.equal(result.status, 503); assert.equal(result.body.ok, false); assert.equal(result.body.data, undefined);
  assert.equal(f.updates.length, 2); assert.equal(f.trace.filter(value => value === 'write-workspace').length, 1);
  assert.ok(!f.trace.includes('revalidate:/,layout'));
});

test('native target shortcuts remain origin and membership bound', async () => {
  for (const args of [{ workspaceId: 'missing' }, { workspaceId: 'manage:fixture', destination: 'https://evil.invalid/staff/today' }, { workspaceId: 'manage:fixture', destination: '//evil.invalid/staff/today' }]) {
    const f = fixture(), result = await f.command(args);
    assert.equal(result.body.ok, false); assert.ok([400, 403].includes(result.status)); assert.equal(f.updates.length, 0);
  }
  const denied = fixture({ destinationAllowed: false }), result = await denied.command();
  assert.equal(result.status, 403); assert.equal(result.body.ok, false); assert.equal(denied.updates.length, 0);
  const origin = fixture(), rejected = await origin.command(undefined, 'https://evil.invalid');
  assert.equal(rejected.status, 403); assert.equal(origin.trace.length, 0); assert.equal(origin.updates.length, 0);
});

test('selection contexts are never retained across commands or after a membership change', async () => {
  const f = fixture();
  assert.equal((await f.command()).body.ok, true);
  const writes = f.updates.length;
  f.state.context = { ...f.state.context, workspaceOptions: [f.staff] };
  const rejected = await f.command();
  assert.equal(rejected.status, 403); assert.equal(rejected.body.ok, false); assert.equal(f.updates.length, writes);
  assert.equal(f.trace.filter(value => value === 'business-context').length, 2);
});

test('sign-out, wrong scope and unavailable authentication cannot select or commit a workspace', async () => {
  const guest = fixture({ authenticated: false }), signedOut = await guest.command();
  assert.equal(signedOut.status, 401); assert.equal(signedOut.body.ok, false); assert.equal(guest.updates.length, 0);
  const wrong = fixture(), scopeMismatch = await wrong.command(undefined, undefined, 'v3:' + 'c'.repeat(64));
  assert.equal(scopeMismatch.status, 409); assert.equal(scopeMismatch.body.ok, false); assert.equal(wrong.updates.length, 0);
  const outage = fixture(); outage.state.authUnavailable = true;
  const unavailable = await outage.command();
  assert.equal(unavailable.status, 503); assert.equal(unavailable.body.ok, false); assert.equal(outage.trace.length, 0); assert.equal(outage.updates.length, 0);
});

test('staff fallback authority cannot replace the fresh root target membership list', async () => {
  const f = fixture(), staffScope = 'v3:' + 'd'.repeat(64);
  // The displayed staff portal can have its own context. The target Owner
  // membership is checked against the same fresh root account used by GET.
  f.state.staffContext = { ...f.state.context, scope: staffScope, workspaceOptions: [f.staff] };
  assert.equal((await f.command(undefined, undefined, staffScope)).body.ok, true);
  assert.equal(f.updates[0].value, f.owner.id);
  const written = f.updates.length;
  // Conversely, a stale alternate context cannot manufacture a revoked root
  // membership even when it still contains the old Owner option.
  f.state.staffContext = { ...f.state.staffContext, workspaceOptions: [f.staff, f.owner] };
  f.state.context = { ...f.state.context, workspaceOptions: [f.staff] };
  const rejected = await f.command(undefined, undefined, staffScope);
  assert.equal(rejected.status, 403); assert.equal(rejected.body.ok, false); assert.equal(f.updates.length, written);
});

test('web workspace entry retains document redirects, cookie normalization and error destinations', async () => {
  const success = fixture(), response = await success.web('workspace_id=manage%3Afixture');
  assert.equal(response.status, 307); assert.equal(response.headers.get('location'), 'https://reylumi.com/staff/today'); assert.equal(success.updates.length, 5);
  for (const options of [{ revoked: true }, { cookieFailure: true }]) {
    const failed = fixture(options), result = await failed.web('workspace_id=manage%3Afixture');
    assert.equal(result.status, 307); assert.ok(new URL(result.headers.get('location')).searchParams.has('error')); assert.equal(failed.updates.length, 0);
  }
  const guest = fixture({ authenticated: false }), login = await guest.web('workspace_id=manage%3Afixture');
  assert.equal(login.status, 307); assert.equal(new URL(login.headers.get('location')).pathname, '/login'); assert.equal(guest.updates.length, 0);
});
