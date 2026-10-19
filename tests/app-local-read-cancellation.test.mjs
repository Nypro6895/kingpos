import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';

const scope = 'v3:' + 'a'.repeat(64), tick = () => new Promise(resolve => setImmediate(resolve));
const cancelled = () => Object.assign(new Error('Synthetic discarded response'), { name: 'AbortError', status: -999, reason: 'cancelled' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(plan) {
  const window = new EventTarget(), location = { pathname: '/staff/today', search: '' }, events = [], calls = [];
  window.__reylumiAppLocalContext = { generation: 'read-cancellation-fixture', scopeEpoch: 1 };
  for (const name of ['reylumi:app-local-reset', 'reylumi:app-local-access-changed']) window.addEventListener(name, () => events.push(name));
  const load = (file, dependencies = {}, source = readFileSync(file, 'utf8')) => {
    const exports = {}, code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'exports', 'window', 'navigator', 'document', 'location', code)(name => { assert.ok(name in dependencies, file + ': ' + name); return dependencies[name]; }, exports, window, { onLine: true }, { visibilityState: 'visible' }, location);
    return exports;
  };
  const trace = { recordExperienceTrace() {}, nextExperienceTraceOperation: () => 0 };
  const metrics = { recordReadRequest() {}, readResourceCategory: () => 'app-local' };
  const cache = load('lib/experience-resource-cache.ts', { './experience-trace': trace, './read-request-metrics': metrics });
  const recovery = load('lib/app-local-context-recovery.ts');
  const host = { isNative: true, cache: async () => null, read: async (name, args, options) => { calls.push({ name, args, options }); const next = plan(calls.length, options); return await next; } };
  const react = { useCallback: fn => fn, useEffect() {}, useSyncExternalStore: (_subscribe, get) => get() };
  const persistent = { getExperienceOfflineGrant: () => null, isExperienceSnapshotAuthorized: () => false, readExperienceSnapshot: async () => null, writeExperienceSnapshot: async () => false, removeExperienceSnapshot: async () => false };
  const source = process.env.TEST_RESOURCE_BASELINE === '1' ? execFileSync('git', ['show', '62f22d20c5fe9e048a679f9ba6c648d2115cd632:lib/app-local-resource.ts'], { encoding: 'utf8' }) : readFileSync('lib/app-local-resource.ts', 'utf8');
  const resources = load('lib/app-local-resource.ts', { react, './app-local-host': { getAppLocalHost: () => host }, './experience-persistent-cache': persistent, './app-local-data-policy': { appLocalReadIsDurable: () => false }, './app-local-resource-invalidation': { appLocalCommandAffectsResource: () => true }, './experience-resource-cache': cache, './read-refresh-scheduler': { canAutomaticallyRefreshRead: () => true, subscribeReadRefresh: () => () => {} }, './read-request-metrics': metrics, './experience-trace': trace, './app-local-context-recovery': recovery }, source);
  const name = 'page.owner-today', args = { date: '2026-10-19', phase: 'staff' };
  return { ...resources, window, location, calls, events, name, args, state: () => resources.useAppLocalResource(scope, name, args), refresh: () => resources.refreshAppLocalResource(scope, name, args) };
}
const reply = data => ({ schemaVersion: 1, status: 200, scope, etag: 'synthetic', updatedAt: Date.now(), data });
test('cold native phase discards one cancelled read then completes one current GET without global access withdrawal', async () => {
  const f = fixture(n => n === 1 ? Promise.reject(cancelled()) : reply({ staff: ['synthetic'] }));
  await f.refresh();
  assert.equal(f.calls.length, 2, JSON.stringify(f.state()));
  assert.deepEqual(f.state().data, { staff: ['synthetic'] });
  assert.equal(f.state().error, undefined); assert.deepEqual(f.events, []);
});
test('warm native phase keeps authorized data visible while its single cancellation revalidation is pending', async () => {
  const second = deferred(), f = fixture(n => n === 1 ? Promise.reject(cancelled()) : second.promise);
  f.seedAppLocalResource(scope, f.name, f.args, reply({ staff: ['old'] }));
  const pending = f.refresh(); await tick();
  assert.equal(f.calls.length, 2, JSON.stringify(f.state())); assert.deepEqual(f.state().data, { staff: ['old'] });
  second.resolve(reply({ staff: ['new'] })); await pending;
  assert.deepEqual(f.state().data, { staff: ['new'] }); assert.deepEqual(f.events, []);
});
test('repeated native cancellation settles with a retry action error and never retries indefinitely or revokes access', async () => {
  const f = fixture(() => Promise.reject(cancelled())); await f.refresh(); await tick();
  assert.equal(f.calls.length, 2, JSON.stringify(f.state())); assert.equal(f.state().refreshing, false);
  assert.match(f.state().error, /try again/i); assert.equal(f.state().accessDenied, undefined); assert.deepEqual(f.events, []);
});
test('navigation, generation, epoch and explicit invalidation prevent cancellation retry from publishing into a later page', async () => {
  for (const change of [f => { f.location.pathname = '/settings'; }, f => { f.window.__reylumiAppLocalContext.generation = 'other-device'; }, f => { f.window.__reylumiAppLocalContext.scopeEpoch++; }, f => f.resetAppLocalResources()]) {
    const first = deferred(), f = fixture(() => first.promise), pending = f.refresh(); await tick();
    change(f); first.reject(cancelled()); await pending; assert.equal(f.calls.length, 1); assert.equal(f.state().data, undefined); assert.deepEqual(f.events, []);
  }
});
test('a second read already started by cancellation cannot publish after the user leaves its page', async () => {
  const second = deferred(), f = fixture(n => n === 1 ? Promise.reject(cancelled()) : second.promise);
  const pending = f.refresh(); await tick(); assert.equal(f.calls.length, 2);
  f.location.pathname = '/settings'; second.resolve(reply({ staff: ['must-not-publish'] })); await pending;
  assert.equal(f.state().data, undefined); assert.deepEqual(f.events, []);
});
test('cancellation revalidation keeps the same conditional GET and accepts304 without downloading a replacement DTO', async () => {
  const f = fixture(n => n === 1 ? Promise.reject(cancelled()) : { schemaVersion: 1, status: 304, scope, etag: 'synthetic', updatedAt: Date.now() });
  f.seedAppLocalResource(scope, f.name, f.args, reply({ staff: ['retained'] })); await f.refresh();
  assert.equal(f.calls.length, 2); assert.ok(f.calls.every(call => call.options.etag === 'synthetic'));
  assert.deepEqual(f.state().data, { staff: ['retained'] }); assert.equal(f.state().error, undefined); assert.deepEqual(f.events, []);
});
test('a cancellation of a long read cannot replay its POST read body', async () => {
  const f = fixture(() => Promise.reject(cancelled()));
  await f.refreshAppLocalResource(scope, f.name, { query: 'x'.repeat(3000) });
  assert.equal(f.calls.length, 1); assert.deepEqual(f.events, []);
});
test('confirmed feature403 still withdraws its old DTO and is never treated as cancelled transport', async () => {
  const f = fixture(() => Promise.reject(Object.assign(new Error('Denied'), { status: 403 })));
  f.seedAppLocalResource(scope, f.name, f.args, reply({ staff: ['old'] })); await f.refresh();
  assert.equal(f.calls.length, 1); assert.equal(f.state().data, undefined); assert.equal(f.state().accessDenied, true);
});
