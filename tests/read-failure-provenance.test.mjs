import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies = {}, logger = console) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', 'console', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, exports, logger);
  return exports;
}
const bounded = load('lib/bounded-get.ts');
const options = (events, fetcher, extra = {}) => ({ timeoutMs: 100, totalTimeoutMs: 250, maxAttempts: 2, retryDelayMs: 0, onFailure: value => events.push(value), fetcher, ...extra });

test('bounded reads distinguish final upstream status from network exhaustion without leaking the input', async () => {
  for (const status of [429, 503]) {
    const events = []; let calls = 0;
    const response = await bounded.fetchBoundedGet('https://private.invalid/query?token=secret', {}, options(events, async () => { calls++; return Response.json({ private: 'body' }, { status }); }));
    assert.equal(response.status, status); assert.equal(calls, 2);
    assert.deepEqual(events, [{ kind: 'http', attempts: 2, upstreamStatus: status, ownedTimerFired: false, parentAborted: false }]);
    assert.equal(JSON.stringify(events).includes('secret'), false);
  }
  const events = []; let calls = 0;
  await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', {}, options(events, async () => { calls++; throw TypeError('private network details'); })), error => error.kind === 'network');
  assert.equal(calls, 2);
  assert.deepEqual(events, [{ kind: 'network', attempts: 2, ownedTimerFired: false, parentAborted: false }]);
});

test('owned header and body timers are observed while a caller abort keeps its original identity', async () => {
  for (const body of [false, true]) {
    const events = [];
    const fetcher = async () => body ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })) : new Promise(() => {});
    await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', {}, options(events, fetcher, { timeoutMs: 15, maxAttempts: 1 })), error => error.kind === 'timeout');
    assert.equal(events.length, 1); assert.equal(events[0].kind, 'timeout'); assert.equal(events[0].ownedTimerFired, true); assert.equal(events[0].parentAborted, false);
    assert.equal(events[0].upstreamStatus, body ? 200 : undefined);
  }
  const events = [], controller = new AbortController(), reason = { private: 'do not copy this reason' };
  let started; const ready = new Promise(resolve => { started = resolve; });
  const pending = bounded.fetchBoundedGet('https://private.invalid', { signal: controller.signal }, options(events, async () => { started(); return new Promise(() => {}); }));
  const denied = assert.rejects(pending, error => error === reason); await ready; controller.abort(reason); await denied;
  assert.deepEqual(events, [{ kind: 'parent-abort', attempts: 1, ownedTimerFired: false, parentAborted: true }]);
});

test('body limits and failed second attempts never inherit a previous HTTP status', async () => {
  const events = [];
  await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', {}, options(events, async () => new Response('oversize'), { maxBodyBytes: 2 })), error => error.kind === 'body-limit');
  assert.deepEqual(events, [{ kind: 'body-limit', attempts: 1, upstreamStatus: 200, ownedTimerFired: false, parentAborted: false }]);
  const later = []; let calls = 0;
  await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', {}, options(later, async () => { if (++calls === 1) return new Response('busy', { status: 503 }); throw TypeError('network'); })), error => error.kind === 'network');
  assert.deepEqual(later, [{ kind: 'network', attempts: 2, ownedTimerFired: false, parentAborted: false }]);
});

test('observers cannot change denials, mutation delivery or original thrown errors', async () => {
  for (const status of [401, 403]) {
    let calls = 0;
    const response = await bounded.fetchBoundedGet('https://private.invalid', {}, options([], async () => { calls++; return new Response('denied', { status }); }, { onFailure() { throw Error('diagnostic only'); } }));
    assert.equal(response.status, status); assert.equal(await response.text(), 'denied'); assert.equal(calls, 1);
  }
  let calls = 0, observations = 0;
  const response = await bounded.fetchWithDeadline('https://private.invalid', { method: 'POST', body: 'original' }, options([], async (_input, init) => { calls++; assert.equal(init.body, 'original'); return new Response('busy', { status: 503 }); }, { onFailure() { observations++; } }));
  assert.equal(response.status, 503); assert.equal(calls, 1); assert.equal(observations, 0);
  const original = new bounded.ReadConnectionError('network');
  await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', {}, options([], async () => { throw original; }, { maxAttempts: 1, onFailure() { throw Error('diagnostic only'); } })), error => error === original);
});

test('an AbortError name alone is not evidence of a timer or parent cancellation', async () => {
  const events = [];
  await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', {}, options(events, async () => { throw new DOMException('unknown source', 'AbortError'); }, { maxAttempts: 1 })), error => error.kind === 'network');
  assert.deepEqual(events, [{ kind: 'network', attempts: 1, ownedTimerFired: false, parentAborted: false }]);
  const controller = new AbortController(), reason = new DOMException('untrusted timeout label', 'TimeoutError'), cancelled = [];
  controller.abort(reason);
  await assert.rejects(bounded.fetchBoundedGet('https://private.invalid', { signal: controller.signal }, options(cancelled, () => assert.fail('Pre-aborted reads cannot transmit'))), error => error === reason);
  assert.deepEqual(cancelled, [{ kind: 'parent-abort', attempts: 0, ownedTimerFired: false, parentAborted: true }]);
});

test('request-local failure counters and bounded logs allow only fixed safe fields', async () => {
  const logs = [], api = load('lib/read-request-timing.ts', {}, { warn(...args) { logs.push(args); } });
  const a = api.createReadRequestTiming(() => 0), b = api.createReadRequestTiming(() => 0);
  const value = { kind: 'network', attempts: 2, ownedTimerFired: false, parentAborted: false, url: 'secret', message: 'secret', cookie: 'secret' };
  for (let index = 0; index < 12; index++) a.observeBackendFailure('rest', value);
  a.observeBackendFailure('unknown-secret', value);
  a.observeBackendFailure('rest', { ...value, kind: 'unknown-secret' });
  const header = a.finish(new Response()).headers.get('server-timing');
  assert.match(header, /backend_rest_failure;count=12;attempts=24;http=0;network=12;timeout=0;body_limit=0;parent_abort=0;owned_timers=0/);
  assert.equal(logs.length, 8); assert.equal(JSON.stringify(logs).includes('secret'), false);
  assert.equal(b.finish(new Response()).headers.get('server-timing').includes('failure'), false);
  const broken = load('lib/read-request-timing.ts', {}, { warn() { throw Error('logger unavailable'); } }).createReadRequestTiming();
  assert.doesNotThrow(() => broken.observeBackendFailure('auth', { kind: 'parent-abort', attempts: 0, ownedTimerFired: false, parentAborted: true }));
});
