import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';

let compiled;
async function fixture() {
  compiled ??= build({ entryPoints: ['lib/app-local-host.ts'], bundle: true, write: false, format: 'cjs', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' } }).then(result => result.outputFiles[0].text);
  let now = 0, nextTimer = 0;
  const timers = new Map(), requests = [], replies = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (;;) {
        const next = [...timers].find(([, job]) => job.at <= now);
        if (!next) break;
        timers.delete(next[0]); next[1].fn();
      }
    },
  };
  const window = {
    __reylumiAppLocalContext: { version: 1, nonce: 'nonce-a', scopeEpoch: 1, generation: 'device-a' },
    __reylumiAppLocalTransport: {
      request(request) {
        requests.push(request);
        if (request.kind === 'cache' && request.name === 'cancel') return Promise.resolve({ ok: true });
        return new Promise((resolve, reject) => replies.set(request.id, { resolve, reject }));
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(await compiled, {
    module, exports: module.exports, window, crypto: webcrypto, console, URL, URLSearchParams,
    FormData, Blob, File, atob, btoa, AbortController, AbortSignal, DOMException,
    Response, Headers, Request, performance, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  return { host: module.exports.getAppLocalHost(), window, requests, replies, clock, timers };
}

function signalFixture() {
  const listeners = new Set();
  return {
    aborted: false, reason: undefined, listeners, removals: 0,
    addEventListener(name, listener) { assert.equal(name, 'abort'); listeners.add(listener); },
    removeEventListener(name, listener) { assert.equal(name, 'abort'); this.removals++; listeners.delete(listener); },
    abort(reason = new DOMException('Visitor left', 'AbortError')) {
      this.aborted = true; this.reason = reason;
      for (const listener of [...listeners]) listener();
    },
  };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

for (const [kind, timeout] of [['context', 25_000], ['read', 45_000]]) {
  test(`a lost native ${kind} callback times out once, cancels only its read work and releases listeners`, async () => {
    const f = await fixture(), signal = signalFixture();
    const operation = kind === 'context' ? f.host.context('/explore', { signal }) : f.host.read('explore.feed', {}, { signal, scope: 'scope-a' });
    let settled = false;
    const failed = assert.rejects(operation, error => { settled = true; return error.name === 'TimeoutError' && /try again/i.test(error.message); });
    const original = f.requests[0];
    f.clock.advance(timeout - 1); await flush();
    assert.equal(settled, false); assert.equal(f.requests.length, 1);
    f.clock.advance(1); await failed;
    assert.equal(f.timers.size, 0); assert.equal(signal.listeners.size, 0); assert.equal(signal.removals, 1);
    assert.equal(f.requests.length, 2);
    const cancel = f.requests[1];
    assert.equal(cancel.kind, 'cache'); assert.equal(cancel.name, 'cancel');
    assert.equal(cancel.args.requestId, original.id); assert.notEqual(cancel.id, original.id);
    assert.equal(cancel.nonce, original.nonce); assert.equal(cancel.scopeEpoch, original.scopeEpoch);
    // A delayed callback after the deadline must not replay the request.
    f.replies.get(original.id).resolve({ schemaVersion: 1, status: 200, scope: 'scope-a' });
    signal.abort(); f.clock.advance(90_000); await flush();
    assert.equal(f.requests.length, 2);
  });
}

for (const operation of ['get', 'remove']) {
  test(`a lost cache ${operation} callback is bounded without issuing a native command or cancellation`, async () => {
    const f = await fixture();
    const pending = f.host.cache(operation, { name: 'explore.feed', args: {}, scope: 'scope-a' });
    const failed = assert.rejects(pending, { name: 'TimeoutError' });
    f.clock.advance(25_000); await failed;
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].kind, 'cache');
    assert.equal(f.requests[0].args.op, operation); assert.equal(f.timers.size, 0);
    f.replies.get(f.requests[0].id).reject(Error('Late callback'));
    f.clock.advance(90_000); await flush(); assert.equal(f.requests.length, 1);
  });
}

test('successful native context, read and cache replies clear their deadlines and abort listeners', async () => {
  const f = await fixture(), contextSignal = signalFixture(), readSignal = signalFixture();
  const context = f.host.context('/explore', { signal: contextSignal });
  const read = f.host.read('explore.feed', {}, { signal: readSignal, scope: 'scope-a' });
  const cache = f.host.cache('get', { name: 'explore.feed', scope: 'scope-a' });
  assert.equal(f.timers.size, 3);
  f.replies.get(f.requests[0].id).resolve({ context: { scope: 'scope-a' } });
  f.replies.get(f.requests[1].id).resolve({ status: 200, scope: 'scope-a', data: { items: [1] } });
  f.replies.get(f.requests[2].id).resolve({ data: { items: [1] }, etag: 'r1', updatedAt: 10 });
  assert.equal((await context).context.scope, 'scope-a'); assert.equal((await read).data.items[0], 1);
  assert.equal((await cache).revision, 'r1'); assert.equal(f.timers.size, 0);
  assert.equal(contextSignal.listeners.size, 0); assert.equal(readSignal.listeners.size, 0);
  contextSignal.abort(); readSignal.abort(); f.clock.advance(90_000); await flush();
  assert.equal(f.requests.length, 3);
});

test('native rejection and visitor cancellation release deadlines without retrying', async () => {
  const f = await fixture(), signal = signalFixture();
  const failedContext = f.host.context('/explore', { signal });
  const contextFailure = assert.rejects(failedContext, /Network unavailable/);
  f.replies.get(f.requests[0].id).reject(Error('Network unavailable')); await contextFailure;
  assert.equal(f.timers.size, 0); assert.equal(signal.listeners.size, 0);
  const readSignal = signalFixture(), read = f.host.read('explore.feed', {}, { signal: readSignal });
  const readFailure = assert.rejects(read, { name: 'AbortError', message: 'Visitor left' });
  readSignal.abort(); await readFailure;
  assert.equal(f.timers.size, 0); assert.equal(readSignal.listeners.size, 0);
  f.clock.advance(90_000); await flush();
  assert.equal(f.requests.length, 3); assert.equal(f.requests[2].name, 'cancel');
  assert.equal(f.requests[2].args.requestId, f.requests[1].id);
});

test('business commands and hosted navigation have no new deadline, cancellation or replay', async () => {
  const f = await fixture();
  const command = f.host.command('portable.operations', { input: { id: 'operation-a' } }, { scope: 'scope-a' });
  const online = f.host.openOnline('/booking/checkout');
  let commandDone = false, onlineDone = false;
  command.then(() => { commandDone = true; }); online.then(() => { onlineDone = true; });
  assert.equal(f.timers.size, 0);
  f.clock.advance(3_600_000); await flush();
  assert.equal(commandDone, false); assert.equal(onlineDone, false);
  assert.equal(f.requests.length, 2); assert.equal(f.requests[0].kind, 'command'); assert.equal(f.requests[1].kind, 'online');
  assert.equal(f.requests[0].args.input.id, 'operation-a');
  f.replies.get(f.requests[0].id).resolve({ committed: true }); f.replies.get(f.requests[1].id).resolve({ ok: true });
  assert.equal((await command).committed, true); await online;
  assert.equal(f.requests.length, 2); assert.equal(f.timers.size, 0);
});

test('deadlines preserve epoch rejection and the exact acknowledged context transition', async () => {
  const f = await fixture();
  const read = f.host.read('explore.feed', {}, { scope: 'scope-a' });
  const rejected = assert.rejects(read, /account has changed/);
  f.window.__reylumiAppLocalContext = { ...f.window.__reylumiAppLocalContext, scopeEpoch: 2, nonce: 'nonce-b' };
  f.replies.get(f.requests[0].id).resolve({ status: 200, scope: 'scope-a', data: { old: true } }); await rejected;
  assert.equal(f.timers.size, 0);
  const context = f.host.context('/explore', { fresh: true });
  const next = { ...f.window.__reylumiAppLocalContext, scopeEpoch: 3, nonce: 'nonce-c' };
  f.window.__reylumiAppLocalContext = next;
  f.replies.get(f.requests[1].id).resolve({ host: next, context: { scope: 'scope-b' } });
  assert.equal((await context).context.scope, 'scope-b'); assert.equal(f.timers.size, 0);
  const changedDevice = f.host.context('/explore', { fresh: true });
  const deviceRejected = assert.rejects(changedDevice, /account has changed/);
  const other = { ...next, scopeEpoch: 4, nonce: 'nonce-d', generation: 'device-b' };
  f.window.__reylumiAppLocalContext = other;
  f.replies.get(f.requests[2].id).resolve({ host: other, context: { scope: 'other-account' } }); await deviceRejected;
  f.clock.advance(90_000); await flush(); assert.equal(f.timers.size, 0); assert.equal(f.requests.length, 3);
});
