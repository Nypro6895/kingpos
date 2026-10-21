import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import ts from 'typescript';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';

function load(file, dependencies = {}, fetcher, logger = console) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'fetch', 'console', code)(name => {
    if (name === '@supabase/supabase-js' && !(name in dependencies)) return { isAuthSessionMissingError };
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, exports, fetcher, logger);
  return exports;
}
function fixture(fetcher) {
  const scope = load('lib/read-context-scope.ts', { 'server-only': {}, 'node:async_hooks': { AsyncLocalStorage } });
  const bounded = load('lib/bounded-get.ts', {}, fetcher);
  const rejection = load('lib/supabase/auth-rejection.ts');
  const auth = load('lib/supabase/auth-rest.ts', { './auth-rejection': rejection, '@/lib/bounded-get': bounded, '@/lib/read-context-scope': scope, '@/lib/app-local-command-trace': { measureAppLocalCommandBackend: (_kind, operation) => operation(), observeAppLocalCommandBackendStatus() {} } }, fetcher);
  const client = createClient('https://synthetic.invalid', 'synthetic-public-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: auth.supabaseDeadlineFetch } });
  return { scope, bounded, auth, client };
}
const unavailable = () => Response.json({ code: '08006', message: 'Synthetic unavailable read' }, { status: 503 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real PostgREST SDK has one two-attempt wire budget, not nested eight attempts', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return unavailable(); });
  const result = await f.scope.runWithReadContext(() => f.client.from('users').select('status'));
  assert.ok(result.error);
  assert.equal(calls, 2, `One bounded safe-GET operation produced ${calls} wire attempts`);
});

test('actual context deadline leaves no later SDK wire attempts after caller returns', async () => {
  let calls = 0, query;
  const f = fixture(async (_input, init) => {
    calls++;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1000);
      const cancel = () => { clearTimeout(timer); reject(init.signal.reason); };
      if (init.signal?.aborted) cancel(); else init.signal?.addEventListener('abort', cancel, { once: true });
    });
    return unavailable();
  });
  const request = load('lib/request-business-context.ts', {
    'server-only': {}, react: React, '@/lib/bounded-get': f.bounded, '@/lib/read-context-scope': f.scope,
    '@/lib/current-context': { getCurrentBusinessContext() {
      query = Promise.resolve(f.client.from('users').select('status')).then(result => { if (result.error) throw new f.auth.AuthAvailabilityError(); return result; });
      return query;
    } },
  });
  await assert.rejects(f.scope.runWithReadContext(() => request.getRequestBusinessContext()), error => error.status === 503);
  const whenCallerReturned = calls;
  await query.catch(() => {});
  assert.equal(calls, whenCallerReturned, `${calls - whenCallerReturned} backend requests started after the actual context caller returned`);
  assert.equal(calls, 2);
});

test('lazy read factory propagates its deadline to active and subsequent safe reads', async () => {
  let calls = 0, observedAbort = false, underlying;
  const f = fixture(async (_input, init) => {
    calls++;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => { observedAbort = true; reject(init.signal.reason); }, { once: true });
    });
  });
  await assert.rejects(f.bounded.runReadWithDeadline(signal => f.scope.runWithReadAbortSignal(signal, async () => {
    underlying = f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/users');
    await underlying;
    return f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/accounts');
  }), 40), error => error.status === 503);
  await underlying?.catch(() => {});
  await wait(60);
  assert.equal(observedAbort, true);
  assert.equal(calls, 1);
});

test('authoritative 401/403 HTTP status, headers and response bodies remain intact', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const f = fixture(async () => { calls++; return Response.json({ code: 'bad_jwt', message: 'Synthetic denied' }, { status, headers: { 'x-fixture': 'preserved' } }); });
    const response = await f.auth.supabaseDeadlineFetch('https://synthetic.invalid/auth/v1/user');
    assert.equal(response.status, status); assert.equal(response.headers.get('x-fixture'), 'preserved');
    assert.deepEqual(await response.json(), { code: 'bad_jwt', message: 'Synthetic denied' }); assert.equal(calls, 1);
  }
});

test('transient Auth read exhaustion stays unavailable and never emits signed-out', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return unavailable(); });
  const events = [];
  const subscription = f.client.auth.onAuthStateChange(event => events.push(event));
  const result = await f.client.auth.getUser('synthetic-only-jwt');
  assert.ok(result.error); assert.ok(![401, 403].includes(result.error.status));
  assert.throws(() => f.auth.assertAuthAvailable(result.error, result.error.status), error => error.status === 503);
  assert.equal(events.includes('SIGNED_OUT'), false); assert.equal(calls, 2);
  subscription.data.subscription.unsubscribe();
});

test('POST mutations are never retried or cancelled by a surrounding display-read budget', async () => {
  let calls = 0, completed = false, signal;
  const f = fixture(async (_input, init) => { calls++; signal = init?.signal; await wait(70); completed = true; return Response.json({ committed: true }); });
  let mutation;
  await assert.rejects(f.bounded.runReadWithDeadline(abort => f.scope.runWithReadAbortSignal(abort, () => {
    mutation = f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/rpc/synthetic_write', { method: 'POST', body: '{}' });
    return mutation;
  }), 20), error => error.status === 503);
  assert.deepEqual(await (await mutation).json(), { committed: true });
  assert.equal(completed, true); assert.equal(calls, 1); assert.equal(signal, undefined);
});

test('actual context twelve-second deadline aborts a successful sequential read chain', async () => {
  let calls = 0, activeAborts = 0, chain;
  const f = fixture(async (_input, init) => {
    calls++;
    await new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); activeAborts++; reject(init.signal.reason); };
      const timer = setTimeout(() => { init.signal.removeEventListener('abort', cancel); resolve(); }, 2500);
      init.signal.addEventListener('abort', cancel, { once: true });
    });
    return Response.json([{ status: 'active' }]);
  });
  const request = load('lib/request-business-context.ts', {
    'server-only': {}, react: React, '@/lib/bounded-get': f.bounded, '@/lib/read-context-scope': f.scope,
    '@/lib/current-context': { getCurrentBusinessContext() {
      chain = (async () => {
        for (let index = 0; index < 8; index++) {
          const result = await f.client.from('users').select('status');
          if (result.error) throw new f.auth.AuthAvailabilityError();
        }
        return {};
      })();
      return chain;
    } },
  });
  const began = performance.now();
  await assert.rejects(f.scope.runWithReadContext(() => request.getRequestBusinessContext()), error => error.status === 503);
  const elapsed = performance.now() - began, atReturn = calls;
  assert.ok(elapsed >= 11800 && elapsed < 13500, `Actual context deadline elapsed ${elapsed}ms`);
  await chain.catch(() => {}); await wait(60);
  assert.equal(calls, 5); assert.equal(calls, atReturn); assert.equal(activeAborts, 1);
});

test('a prestarted read in the same request scope is withdrawn by its context deadline', async () => {
  let aborted = false, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(async (_input, init) => {
    started();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 250);
      init.signal.addEventListener('abort', () => { aborted = true; clearTimeout(timer); reject(init.signal.reason); }, { once: true });
    });
    return Response.json([]);
  });
  await f.scope.runWithReadContext(async () => {
    const existing = f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/users');
    await ready;
    await assert.rejects(f.bounded.runReadWithDeadline(signal => f.scope.runWithReadAbortSignal(signal, () => existing), 20), error => error.status === 503);
    await existing.catch(() => {});
  });
  assert.equal(aborted, true);
});

test('deadline cancellation is isolated from another request and later request', async () => {
  const hits = [];
  const f = fixture(async (input, init) => {
    hits.push(String(input));
    if (String(input).endsWith('/slow')) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    await wait(45); return Response.json({ ok: true });
  });
  const a = f.scope.runWithReadContext(() => f.bounded.runReadWithDeadline(signal => f.scope.runWithReadAbortSignal(signal, () => f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/slow')), 20));
  const b = f.scope.runWithReadContext(() => f.bounded.runReadWithDeadline(signal => f.scope.runWithReadAbortSignal(signal, () => f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/healthy')), 150));
  await assert.rejects(a, error => error.status === 503);
  assert.deepEqual(await (await b).json(), { ok: true });
  assert.equal((await f.scope.runWithReadContext(() => f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/later'))).status, 200);
  assert.equal(hits.length, 3);
});

test('caller abort and an earlier parent deadline terminate nested reads without replay', async () => {
  let calls = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(async (_input, init) => { calls++; started(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); });
  const caller = new AbortController(), reason = new DOMException('Synthetic caller cancelled', 'AbortError');
  const pending = f.scope.runWithReadContext(() => f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/users', { signal: caller.signal }));
  const denied = assert.rejects(pending, error => error === reason);
  await ready; caller.abort(reason); await denied;
  assert.equal(calls, 1);
  let child;
  await assert.rejects(f.bounded.runReadWithDeadline(parent => f.scope.runWithReadAbortSignal(parent, () => {
    child = f.bounded.runReadWithDeadline(signal => f.scope.runWithReadAbortSignal(signal, () => f.auth.supabaseDeadlineFetch('https://synthetic.invalid/rest/v1/users')), 200);
    return child;
  }), 20), error => error.status === 503);
  await child.catch(() => {}); await wait(40);
  assert.equal(calls, 2);
});

test('real SDK flattening retains independent request-local HTTP and network failure provenance', async () => {
  for (const httpFailure of [true, false]) {
    let calls = 0; const events = [];
    const timing = load('lib/read-request-timing.ts', {}, undefined, { warn(_label, event) { events.push(event); } }).createReadRequestTiming();
    const f = fixture(async () => { calls++; if (httpFailure) return unavailable(); throw TypeError('private connection information'); });
    const result = await f.scope.runWithReadContext(async () => await f.client.from('users').select('status'), timing);
    assert.ok(result.error); assert.equal(calls, 2); assert.equal(events.length, 1);
    assert.deepEqual(events[0], { version: 1, backend: 'rest', failureKind: httpFailure ? 'http' : 'network', attempts: 2, upstreamStatus: httpFailure ? 503 : null, ownedTimerFired: false, parentAborted: false });
    assert.equal(JSON.stringify(events).includes('private'), false);
    assert.match(timing.finish(new Response()).headers.get('server-timing'), /backend_rest_failure;count=1;attempts=2/);
    assert.equal(result.error.message.startsWith('AbortError:'), true, 'SDK terminal-error policy is unchanged; subtype is separate evidence');
  }
});

test('real SDK parent cancellation with an unknown reason is not recorded as an owned timeout', async () => {
  const events = [], controller = new AbortController(); let started, calls = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const timing = load('lib/read-request-timing.ts', {}, undefined, { warn(_label, event) { events.push(event); } }).createReadRequestTiming();
  const f = fixture(async (_input, init) => { calls++; started(); return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })); });
  const pending = f.scope.runWithReadContext(async () => await f.client.from('users').select('status').abortSignal(controller.signal), timing);
  await ready; controller.abort(new Error('private cancellation reason'));
  const result = await pending;
  assert.ok(result.error); assert.equal(calls, 1);
  assert.deepEqual(events, [{ version: 1, backend: 'rest', failureKind: 'parent-abort', attempts: 1, upstreamStatus: null, ownedTimerFired: false, parentAborted: true }]);
});
