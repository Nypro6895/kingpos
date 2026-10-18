import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function scheduler() {
  const window = new EventTarget(), document = new EventTarget(), navigator = { onLine: true };
  document.visibilityState = 'visible';
  const timers = new Map(); let timerId = 0;
  const counts = new Map();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (event, callback) => { counts.set(event, (counts.get(event) ?? 0) + 1); add(event, callback); };
    target.removeEventListener = (event, callback) => { counts.set(event, counts.get(event) - 1); remove(event, callback); };
  }
  const exports = {};
  const source = ts.transpileModule(readFileSync('lib/read-refresh-scheduler.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'window', 'document', 'navigator', 'setTimeout', 'clearTimeout', source)(exports, window, document, navigator,
    callback => { timers.set(++timerId, callback); return timerId; }, id => timers.delete(id));
  return { ...exports, counts, document, navigator, timers, emit: (event, target = window) => target.dispatchEvent(new Event(event)),
    flush: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } } };
}

test('automatic reads share one lifecycle subscription and coalesce a web/native wake burst', () => {
  const shared = scheduler(), calls = [];
  const unsubscribers = [0, 1, 2].map(id => shared.subscribeReadRefresh(reason => calls.push([id, reason])));
  assert.deepEqual([...shared.counts.values()], [1, 1, 1, 1]);
  shared.emit('focus'); shared.emit('visibilitychange', shared.document); shared.emit('reylumi:foreground'); shared.emit('online');
  assert.equal(shared.timers.size, 1);
  shared.flush();
  assert.deepEqual(calls, [[0, 'foreground'], [1, 'foreground'], [2, 'foreground']]);
  unsubscribers.forEach(unsubscribe => unsubscribe());
  assert.ok([...shared.counts.values()].every(count => count === 0));
});

test('offline and hidden wakes wait for visibility/connectivity; detaching cancels work and reentry installs once', () => {
  const shared = scheduler(), calls = [];
  const unsubscribe = shared.subscribeReadRefresh(reason => calls.push(reason));
  shared.navigator.onLine = false; shared.emit('reylumi:foreground'); shared.flush();
  assert.equal(calls.length, 0); assert.equal(shared.timers.size, 0);
  shared.document.visibilityState = 'hidden'; shared.navigator.onLine = true; shared.emit('online'); shared.flush();
  assert.equal(calls.length, 0);
  shared.document.visibilityState = 'visible'; shared.emit('visibilitychange', shared.document); shared.flush();
  assert.deepEqual(calls, ['foreground']);
  shared.emit('focus'); unsubscribe(); shared.flush();
  assert.equal(calls.length, 1);
  const leave = shared.subscribeReadRefresh(reason => calls.push(reason));
  assert.ok([...shared.counts.values()].every(count => count === 1));
  shared.emit('focus'); shared.flush(); assert.deepEqual(calls, ['foreground', 'focus']);
  leave();
});
