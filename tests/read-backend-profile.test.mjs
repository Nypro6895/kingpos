import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { isAuthSessionMissingError } from '@supabase/supabase-js';

function load(file, dependencies = {}, fetcher = () => { throw new Error('Unexpected transport'); }) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', 'fetch', code)(name => {
    if (name === './auth-rejection') return load('lib/supabase/auth-rejection.ts', { '@supabase/supabase-js': { isAuthSessionMissingError } });
    if (name === '@supabase/supabase-js' && !Object.hasOwn(dependencies, name)) return { isAuthSessionMissingError };
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, fetcher);
  return exports;
}

function fixture(fetcher) {
  const scope = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const timing = load('lib/read-request-timing.ts');
  const bounded = load('lib/bounded-get.ts', {}, fetcher);
  const auth = load('lib/supabase/auth-rest.ts', { '@/lib/bounded-get': bounded, '@/lib/read-context-scope': scope, '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, operation) => operation(), observeAppLocalCommandBackendStatus() {} } }, fetcher);
  return { ...timing, ...auth, scope, bounded };
}

function metrics(timing) {
  const header = timing.finish(new Response(null)).headers.get('server-timing');
  const result = {};
  for (const metric of header.split(', ')) {
    const [name, ...params] = metric.split(';');
    assert.match(name, /^(?:[a-z_]+)$/);
    result[name] = Object.fromEntries(params.map(value => {
      const match = /^(dur|calls|bytes|sized|count|attempts|http|network|timeout|body_limit|parent_abort|owned_timers)=(\d+(?:\.\d+)?)$/.exec(value);
      assert.ok(match, `Only fixed numeric parameters: ${value}`);
      return [match[1], Number(match[2])];
    }));
  }
  return { result, header };
}

test('fixed backend categories retain only logical calls, elapsed time and available Content-Length', async () => {
  let clock = 0;
  const f = fixture();
  const timing = f.createReadRequestTiming(() => clock);
  const response = new Response('private payload', { headers: { 'content-length': '15' } });
  assert.equal(await timing.measureBackend('auth', async () => { clock += 4; return response; }), response);
  await timing.measureBackend('rest', async () => { clock += 6; return new Response('private'); });
  await timing.measureBackend('rpc', async () => { clock += 7; return new Response(null, { headers: { 'content-length': '0' } }); });
  assert.equal(response.bodyUsed, false, 'Profiling never clones, parses or consumes the response');
  assert.deepEqual(metrics(timing).result, {
    backend_auth: { dur: 4, calls: 1, bytes: 15, sized: 1 },
    backend_rest: { dur: 6, calls: 1 },
    backend_rpc: { dur: 7, calls: 1, bytes: 0, sized: 1 },
    total: { dur: 17 },
  });
});

test('missing, malformed and unsafe lengths remain unknown; failures retain their exact rejection', async () => {
  let clock = 0;
  const f = fixture(), timing = f.createReadRequestTiming(() => clock);
  for (const length of [null, '-1', '1.5', 'not-a-number', '9007199254740992']) {
    await timing.measureBackend('rest', async () => {
      clock += 1;
      return new Response(null, { headers: length === null ? {} : { 'content-length': length } });
    });
  }
  const cause = new Error('Private transport detail');
  await assert.rejects(timing.measureBackend('rest', async () => { clock += 2; throw cause; }), error => error === cause);
  assert.deepEqual(metrics(timing).result.backend_rest, { dur: 7, calls: 6 });
  assert.equal(metrics(timing).header.includes('Private'), false);
});

test('async read scopes isolate overlapping requests and nested adapters keep their outer timing and memoization', async () => {
  const f = fixture(), first = f.createReadRequestTiming(), second = f.createReadRequestTiming(), ignored = f.createReadRequestTiming();
  const key = Symbol('request-specific-read');
  let reads = 0;
  const run = timing => f.scope.runWithReadContext(async () => {
    assert.equal(f.scope.getReadRequestTiming(), timing);
    await new Promise(resolve => setImmediate(resolve));
    return f.scope.runWithReadContext(async () => {
      assert.equal(f.scope.getReadRequestTiming(), timing);
      const read = () => f.scope.memoizeReadContext(key, async () => { reads++; await Promise.resolve(); return timing; });
      const [a, b] = await Promise.all([read(), read()]);
      assert.equal(a, timing); assert.equal(b, timing);
      await timing.measureBackend(timing === first ? 'auth' : 'rpc', async () => new Response(null));
    }, ignored);
  }, timing);
  await Promise.all([run(first), run(second)]);
  assert.equal(reads, 2);
  assert.equal(f.scope.getReadRequestTiming(), undefined);
  assert.equal(metrics(first).result.backend_auth.calls, 1);
  assert.equal(metrics(first).result.backend_rpc, undefined);
  assert.equal(metrics(second).result.backend_rpc.calls, 1);
  assert.equal(metrics(second).result.backend_auth, undefined);
  assert.deepEqual(Object.keys(metrics(ignored).result), ['total']);
  await f.scope.runWithReadContext(async () => assert.equal(f.scope.getReadRequestTiming(), undefined));
});

test('transport classification drops URL, query, headers, credentials, payload and error details', async () => {
  const calls = [];
  const f = fixture(async (input, init) => { calls.push({ input, init }); return new Response('private-response-body', { headers: { 'content-length': '21' } }); });
  const timing = f.createReadRequestTiming();
  const credentials = { authorization: 'Bearer private-access-token', cookie: 'private-session' };
  await f.scope.runWithReadContext(async () => {
    for (const path of ['/auth/v1/user?private-email=secret', '/rest/v1/users?private-record=secret', '/rest/v1/rpc/private_function?private-filter=secret', '/storage/v1/private-asset']) {
      await f.supabaseDeadlineFetch('https://private-project.invalid' + path, { method: 'POST', headers: credentials, body: 'private-request-body' });
    }
  }, timing);
  assert.equal(calls.length, 4);
  const { result, header } = metrics(timing);
  for (const kind of ['auth', 'rest', 'rpc']) assert.equal(result['backend_' + kind].calls, 1);
  assert.equal(/private|secret|Bearer|authorization|cookie|invalid|function|payload/i.test(header), false);
  assert.deepEqual(Object.keys(result), ['backend_auth', 'backend_rest', 'backend_rpc', 'total']);
});

test('existing GET retry policy remains two physical attempts but one logical call', async () => {
  let attempts = 0;
  const f = fixture(async () => new Response(attempts++ === 0 ? 'retry' : 'ok', {
    status: attempts === 1 ? 503 : 200,
    headers: { 'content-length': attempts === 1 ? '5' : '2' },
  }));
  const timing = f.createReadRequestTiming();
  const response = await f.scope.runWithReadContext(() => f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/users'), timing);
  assert.equal(attempts, 2);
  assert.equal(await response.text(), 'ok');
  assert.deepEqual({ ...metrics(timing).result.backend_rest, dur: 0 }, { dur: 0, calls: 1, bytes: 2, sized: 1 });
});

test('RPC POST keeps one attempt and original body/signal/options while denied GET is never retried', async () => {
  let attempts = 0;
  const controller = new AbortController(), original = new Response('rpc unavailable', { status: 503 });
  const init = { method: 'POST', body: 'private-arguments', signal: controller.signal, headers: { 'x-existing': 'unchanged' } };
  const f = fixture(async (_input, options) => { attempts++; assert.equal(options, init); return original; });
  const timing = f.createReadRequestTiming();
  const response = await f.scope.runWithReadContext(() => f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/rpc/get_business_date', init), timing);
  assert.equal(response, original); assert.equal(original.bodyUsed, false); assert.equal(attempts, 1);
  assert.equal(metrics(timing).result.backend_rpc.calls, 1);
  let deniedAttempts = 0;
  const denied = fixture(async () => { deniedAttempts++; return new Response(null, { status: 403 }); });
  const deniedTiming = denied.createReadRequestTiming();
  assert.equal((await denied.scope.runWithReadContext(() => denied.supabaseDeadlineFetch('https://fixture.invalid/auth/v1/user'), deniedTiming)).status, 403);
  assert.equal(deniedAttempts, 1); assert.equal(metrics(deniedTiming).result.backend_auth.calls, 1);
});

test('raw RPC timing does not wait for, buffer or consume a still-open response body', { timeout: 2000 }, async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('private body fragment')); } });
  const original = new Response(body), f = fixture(async () => original), timing = f.createReadRequestTiming();
  const response = await f.scope.runWithReadContext(() => f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/rpc/get_queue', { method: 'POST' }), timing);
  assert.equal(response, original); assert.equal(body.locked, false); assert.equal(response.bodyUsed, false);
  assert.equal(metrics(timing).result.backend_rpc.calls, 1);
  await response.body.cancel();
});

test('bounded transport options and timeout rejection are unchanged by profiling', async () => {
  const scope = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const timingModule = load('lib/read-request-timing.ts'), bounded = load('lib/bounded-get.ts');
  const cause = new bounded.ReadConnectionError('timeout');
  const init = { method: 'HEAD', headers: { authorization: 'private-token' } };
  let calls = 0;
  const auth = load('lib/supabase/auth-rest.ts', {
    '@/lib/read-context-scope': scope, '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, operation) => operation(), observeAppLocalCommandBackendStatus() {} },
    '@/lib/bounded-get': {
      ReadConnectionError: bounded.ReadConnectionError,
      fetchWithDeadline(input, options, policy) {
        calls++; assert.equal(input, 'https://fixture.invalid/rest/v1/users');
        assert.equal(options.method, init.method); assert.equal(options.headers, init.headers);
        assert.ok(options.signal instanceof AbortSignal); assert.equal(init.signal, undefined, 'Caller input is not mutated');
        const { onFailure, ...transportPolicy } = policy;
        assert.equal(typeof onFailure, 'function');
        assert.deepEqual(transportPolicy, { timeoutMs: 5000, totalTimeoutMs: 10250, maxAttempts: 2, retryDelayMs: 250 });
        return Promise.reject(cause);
      },
    },
  });
  const timing = timingModule.createReadRequestTiming();
  await assert.rejects(scope.runWithReadContext(() => auth.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/users', init), timing), error => error === cause);
  assert.equal(calls, 1); assert.equal(metrics(timing).result.backend_rest.calls, 1);
});

test('caller cancellation preserves reason, stops retries and records only the attempted logical call', async () => {
  const controller = new AbortController(), reason = new DOMException('Private cancellation detail', 'AbortError');
  let attempts = 0;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(async (_input, init) => { attempts++; started(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); });
  const timing = f.createReadRequestTiming();
  const pending = f.scope.runWithReadContext(() => f.supabaseDeadlineFetch('https://fixture.invalid/rest/v1/users', { signal: controller.signal }), timing);
  const rejected = assert.rejects(pending, error => error === reason);
  await ready; controller.abort(reason); await rejected;
  assert.equal(attempts, 1); assert.equal(metrics(timing).result.backend_rest.calls, 1);
  assert.equal(metrics(timing).header.includes('Private'), false);
});

test('all inner stage names are fixed and unrecognized runtime values never enter timing headers', async () => {
  let clock = 0;
  const f = fixture(), timing = f.createReadRequestTiming(() => clock);
  const stages = ['clock', 'hours', 'staff_board', 'staff_activity', 'bookings', 'waiting', 'financial_report', 'financial_compare', 'extras'];
  for (const stage of stages) await timing.measure(stage, async () => { clock++; });
  await timing.measure('private-arbitrary-stage', async () => { clock++; });
  await timing.measureBackend('private-service', async () => new Response(null));
  assert.deepEqual(Object.keys(metrics(timing).result), [...stages, 'total']);
  assert.equal(metrics(timing).header.includes('private'), false);
});
