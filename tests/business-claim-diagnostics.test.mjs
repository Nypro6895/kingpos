import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, dependencies, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, Error, FormData,
    require(name) { assert.ok(name in dependencies, `Unexpected import: ${name}`); return dependencies[name]; },
    ...globals,
  });
  return exports;
}

function diagnosticsFixture() {
  const logs = [];
  let now = 100;
  const diagnostics = load('lib/business-claim-diagnostics.ts', { 'server-only': {} }, {
    performance: { now: () => now }, console: { error: (...args) => logs.push(args) },
  });
  return { diagnostics, logs, advance: () => { now += 8123; } };
}

test('returned timeout records its exact safe message, SQLSTATE and RPC elapsed time', async () => {
  const { diagnostics, logs, advance } = diagnosticsFixture();
  const result = { data: null, status: 500, error: { code: '57014', message: 'canceling statement due to statement timeout', details: '', hint: '' } };
  assert.equal(await diagnostics.withBusinessClaimLookupDiagnostics('suggestions', async () => { advance(); return result; }), result);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].code, '57014');
  assert.equal(logs[0][1].message, result.error.message);
  assert.equal(logs[0][1].elapsedMs, 8123);
  assert.equal(logs[0][1].details.httpStatus, 500);
});

test('raw messages, SQL details, hints, stacks, causes and request data cannot enter the log', async () => {
  const { diagnostics, logs } = diagnosticsFixture();
  const privateText = 'Alice Doe alice@example.invalid +15551234567 123 Private Street Bearer SECRET https://db.invalid/?token=SECRET';
  const result = { data: { secret: privateText }, error: { code: '22P02', message: privateText, details: privateText, hint: privateText, stack: privateText, cause: { message: privateText } } };
  await diagnostics.withBusinessClaimLookupDiagnostics('create', async () => result);
  assert.equal(logs[0][1].code, '22P02');
  assert.equal(logs[0][1].details.detailsOmitted, true);
  for (const text of ['Alice', 'alice@', '15551234567', 'Private Street', 'SECRET', 'db.invalid']) assert.ok(!JSON.stringify(logs).includes(text));
  await diagnostics.withBusinessClaimLookupDiagnostics('create', async () => ({ error: { code: privateText, message: privateText } }));
  assert.equal(logs[1][1].code, 'unknown');
  assert.ok(!JSON.stringify(logs).includes(privateText));
});

test('thrown transport failure is logged once and rethrown unchanged', async () => {
  const { diagnostics, logs, advance } = diagnosticsFixture();
  const error = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET', message: 'private host and token' } });
  await assert.rejects(diagnostics.withBusinessClaimLookupDiagnostics('suggestions', async () => { advance(); throw error; }), caught => caught === error);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].code, 'ECONNRESET');
  assert.equal(logs[0][1].elapsedMs, 8123);
  assert.ok(!JSON.stringify(logs).includes('private host'));
});

test('successful lookup is returned unchanged with no log and no retry', async () => {
  const { diagnostics, logs } = diagnosticsFixture();
  const result = { data: [{ salon_id: 'private-id' }], error: null };
  let calls = 0;
  assert.equal(await diagnostics.withBusinessClaimLookupDiagnostics('suggestions', async () => { calls++; return result; }), result);
  assert.equal(calls, 1); assert.equal(logs.length, 0);
});

function actionFixture(rpcError) {
  const f = diagnosticsFixture(), calls = [];
  const client = { rpc: async name => { calls.push(name); f.advance(); return { data: null, error: rpcError, status: 500 }; } };
  const dependencies = {
    '@/lib/business-claim-diagnostics': f.diagnostics,
    '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: async () => client },
    '@/lib/users/current-user': { getCurrentKingUser: async () => ({ id: 'private-user', status: 'active' }) },
    '@/lib/current-context': {
      getCurrentBusinessContext: async () => ({ user: { id: 'private-user' } }),
      getCreateSalonAccount: () => ({ id: 'private-account', status: 'active' }),
    },
    '@/lib/routes': { routes: { salons: { create: () => '/salons/new', list: () => '/salons' } }, withSearchParams: (path, params) => `${path}?${new URLSearchParams(params)}` },
    'next/navigation': { redirect: href => { throw Object.assign(new Error('redirect'), { href }); } },
    '@supabase/supabase-js': { createClient: () => { throw new Error('Service client is forbidden in lookup'); } },
    'node:crypto': {}, 'next/cache': {}, '@/lib/business-claim-provider': {},
    '@/lib/platform-admin/auth': {}, '@/lib/platform-admin/permissions': {}, '@/lib/permissions': {},
  };
  return { ...f, calls, dependencies };
}

test('suggestions action keeps the public error and logs no input or user identity', async () => {
  const f = actionFixture({ code: '57014', message: 'canceling statement due to statement timeout' });
  const action = load('app/claim/actions.ts', f.dependencies);
  const result = await action.findBusinessClaimMatchesAction({ name: 'Drayko', phone: '', address: '', unit: '', city: '', state: '' });
  assert.equal(result.error, 'Could not check existing salons. Please try again.');
  assert.equal(result.matches.length, 0);
  assert.deepEqual(f.calls, ['find_business_claim_matches']);
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0][1].phase, 'suggestions');
  assert.ok(!JSON.stringify(f.logs).match(/Drayko|private-user|private-account/));
});

test('create action still blocks creation after lookup error and records the second call site', async () => {
  const f = actionFixture({ code: 'PGRST202', message: 'private parameters', details: 'private payload' });
  const action = load('app/salons/actions.ts', f.dependencies);
  const form = new FormData(); form.set('name', 'Drayko'); form.set('create_request_key', 'private-request');
  await assert.rejects(action.createSalonAction(form), error => error.href?.includes('Unable+to+check+existing+salons'));
  assert.deepEqual(f.calls, ['find_business_claim_matches']);
  assert.equal(f.logs.length, 1); assert.equal(f.logs[0][1].phase, 'create');
  assert.equal(f.logs[0][1].code, 'PGRST202');
  assert.ok(!JSON.stringify(f.logs).match(/Drayko|private-/));
});
