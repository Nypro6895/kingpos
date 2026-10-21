import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import ts from 'typescript';
import { isAuthSessionMissingError } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const firstId = '8c311302-7765-4f91-8d2b-4bfb4f7e773a';
const secondId = '142ab151-7ccb-4942-92ef-438fc132cfe9';
let compiled;
async function traceModule() {
  compiled ??= build({
    entryPoints: ['lib/app-local-command-trace.ts'], bundle: true, write: false,
    format: 'cjs', platform: 'node', alias: { '@': process.cwd() },
    plugins: [{ name: 'server-marker', setup(builder) {
      builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'marker' }));
      builder.onLoad({ filter: /.*/, namespace: 'marker' }, () => ({ contents: '' }));
    } }],
  });
  const output = await compiled, module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
function load(file, dependencies = {}, fetcher) {
  const exports = {}, code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'fetch', code)(name => {
    if (name === '@supabase/supabase-js' && !Object.hasOwn(dependencies, name)) return { isAuthSessionMissingError };
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected ${file} dependency ${name}`);
    return dependencies[name];
  }, exports, fetcher);
  return exports;
}
async function fixture(fetcher) {
  const traces = await traceModule();
  const scope = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const bounded = load('lib/bounded-get.ts', {}, fetcher);
  const auth = load('lib/supabase/auth-rest.ts', {
    '@/lib/bounded-get': bounded, '@/lib/read-context-scope': scope,
    '@/lib/app-local-command-trace': traces,
  }, fetcher);
  const logs = [];
  const trace = (id = firstId, options = {}) => traces.createAppLocalCommandTrace(new Headers({ 'x-reylumi-request-id': id }), { log: entry => logs.push(entry), ...options });
  return { ...auth, traces, scope, bounded, trace, logs };
}
function metrics(trace) {
  const response = trace.finish(new Response(null)), header = response.headers.get('server-timing') ?? '';
  return { header, response, values: Object.fromEntries([...header.matchAll(/(?:^|,\s*)([a-z_]+);dur=([\d.]+)/g)].map(match => [match[1], Number(match[2])])) };
}

test('command-only scope measures an unchanged RPC POST once without activating read memoization or consuming its body', async () => {
  let calls = 0, f;
  const controller = new AbortController();
  const body = new ReadableStream({ start(sink) { sink.enqueue(new TextEncoder().encode('private response fragment')); } });
  const response = new Response(body, { status: 503 });
  const input = 'https://private.invalid/rest/v1/rpc/private_function?account=private-identity';
  const init = { method: 'POST', body: 'private arguments', signal: controller.signal, headers: { authorization: 'Bearer private-token', cookie: 'private-cookie' } };
  f = await fixture(async (url, options) => {
    calls++; assert.equal(url, input); assert.equal(options, init);
    assert.equal(f.scope.getReadAbortSignal(), undefined);
    assert.equal(f.scope.getReadRequestTiming(), undefined);
    return response;
  });
  const trace = f.trace(), key = Symbol('authority');
  let authorities = 0;
  const result = await trace.run(async () => {
    await f.scope.memoizeReadContext(key, async () => ++authorities);
    await f.scope.memoizeReadContext(key, async () => ++authorities);
    return f.supabaseDeadlineFetch(input, init);
  });
  assert.equal(result, response); assert.equal(authorities, 2); assert.equal(calls, 1);
  assert.equal(body.locked, false); assert.equal(response.bodyUsed, false);
  const observed = metrics(trace);
  assert.ok(Object.hasOwn(observed.values, 'backend_rpc'), 'Command RPC elapsed span must be present outside read scope');
  const resultLog = f.logs.find(entry => entry.state === 'result');
  assert.deepEqual(resultLog.backendStatuses, { rpc: { 503: 1 } }, 'Record the observed upstream HTTP status without consuming its body');
  assert.equal(resultLog.status, 200, 'An upstream failure cannot change the handler response chosen by the caller');
  assert.equal(/private|Bearer|cookie|arguments|function/i.test(JSON.stringify(f.logs) + observed.header), false);
  assert.equal(f.scope.getReadAbortSignal(), undefined);
  await body.cancel();
});

test('command observation retains the existing safe GET retry budget and confirmed403 without retry', async () => {
  let attempts = 0;
  const f = await fixture(async () => new Response(null, { status: attempts++ === 0 ? 503 : 200 }));
  const trace = f.trace();
  assert.equal((await trace.run(() => f.supabaseDeadlineFetch('https://fixture.invalid/auth/v1/user'))).status, 200);
  assert.equal(attempts, 2);
  assert.ok(Object.hasOwn(metrics(trace).values, 'backend_auth'));
  let deniedAttempts = 0;
  const denied = await fixture(async () => { deniedAttempts++; return new Response(null, { status: 403 }); });
  const deniedTrace = denied.trace();
  assert.equal((await deniedTrace.run(() => denied.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/memberships'))).status, 403);
  assert.equal(deniedAttempts, 1);
  assert.ok(Object.hasOwn(metrics(deniedTrace).values, 'backend_rest'));
});

test('terminal safe-GET HTTP503 remains observable after the existing transport converts it to a typed unavailable error', async () => {
  let attempts = 0;
  const f = await fixture(async () => { attempts++; return new Response(null, { status: 503 }); });
  const trace = f.trace();
  await assert.rejects(trace.run(() => f.supabaseDeadlineFetch('https://fixture.invalid/auth/v1/user')), error => {
    assert.ok(error instanceof f.bounded.ReadConnectionError);
    assert.equal(error.kind, 'network'); assert.equal(error.status, 503); assert.equal(error.name, 'AbortError');
    return true;
  });
  trace.finish(new Response(null, { status: 503 }));
  assert.equal(attempts, 2, 'The original two-attempt safe-read budget is unchanged');
  assert.deepEqual(f.logs.find(entry => entry.state === 'result').backendStatuses, { auth: { 503: 1 } });
});

test('overlapping command collectors retain their own correlation and backend kind without leaking to later work', async () => {
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(async input => {
    if (String(input).includes('/rpc/')) { entered(); await gate; }
    return new Response(null);
  });
  const a = f.trace(firstId), b = f.trace(secondId);
  const pending = a.run(() => f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/rpc/private_rpc', { method: 'POST' }));
  await ready;
  await b.run(() => f.supabaseDeadlineFetch('https://fixture.invalid/auth/v1/user'));
  release(); await pending;
  const first = metrics(a), second = metrics(b);
  assert.equal(first.response.headers.get('x-reylumi-request-id'), firstId);
  assert.equal(second.response.headers.get('x-reylumi-request-id'), secondId);
  assert.ok(Object.hasOwn(first.values, 'backend_rpc')); assert.equal(first.values.backend_auth, undefined);
  assert.ok(Object.hasOwn(second.values, 'backend_auth')); assert.equal(second.values.backend_rpc, undefined);
  let leaked = 0;
  const observe = a.observeBackend;
  a.observeBackend = (...args) => { leaked++; observe(...args); };
  await f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/no_scope');
  assert.equal(leaked, 0, 'Completed command observer must not collect later unrelated work');
});

test('observation errors cannot replace the original failed mutation or an already committed successful response', async () => {
  const cause = new Error('private transport detail');
  let calls = 0;
  const f = await fixture(async () => { calls++; throw cause; });
  const trace = f.trace(firstId, { log() { throw new Error('diagnostic sink failed'); } });
  await assert.rejects(trace.run(() => f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/rpc/private_write', { method: 'POST' })), error => error === cause);
  assert.equal(calls, 1); assert.ok(Object.hasOwn(metrics(trace).values, 'backend_rpc'));
  const committed = new Response('committed');
  const success = await fixture(async () => committed);
  const brokenClock = success.trace(firstId, { clock() { throw new Error('diagnostic clock failed'); }, log() { throw new Error('diagnostic sink failed'); } });
  assert.equal(await brokenClock.run(() => success.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/rpc/private_write', { method: 'POST' })), committed);
  assert.equal(committed.bodyUsed, false);
  assert.equal(brokenClock.finish(committed), committed);
});
