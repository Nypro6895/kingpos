import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = new Map();
function load(file, dependencies = {}, globals = {}) {
  if (!compiled.has(file)) compiled.set(file, ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), compiled.get(file))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, exports, ...Object.values(globals));
  return exports;
}
const { servicesCatalogPilotEnabled } = load('lib/services-catalog-pilot-flag.ts');
const reasons = ['logout', 'expired', 'identity', 'permissions', 'workspace'];
const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ failure = 'none', optionalHookFailure = false, sessionStorageFailure = false, browser = true } = {}) {
  const calls = [], storage = new Map([
    ['unrelated', 'preserved'], ['kingpos-explore-continuous-feed:a', 'feed'], ['explore-sections:a', 'feed'],
    ['kingpos.publicBookingDraft.a', 'draft'], ['kingpos.publicBookingDraft.a.auth', 'handoff'],
  ]);
  const sessionStorage = {
    get length() { return storage.size; }, key(index) { return [...storage.keys()][index] ?? null; },
    removeItem(key) { calls.push(['storage', key]); storage.delete(key); },
  };
  const globals = { window: browser ? {
    get sessionStorage() { if (sessionStorageFailure) throw Error('Optional session storage unavailable'); return sessionStorage; },
    dispatchEvent(event) { calls.push(['event', event.type, event.detail]); return true; },
  } : undefined, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
  const runtime = load('lib/services-catalog-runtime.ts', {
    './services-catalog-cache': { createServicesCatalogStore: () => {
      calls.push(['store']); if (failure === 'store-construction') throw Error('Synthetic construction failure');
      return { purge() {
        calls.push(['purge']);
        if (failure === 'purge-sync') throw Error('Synthetic synchronous purge failure');
        if (failure === 'purge-async') return Promise.reject(Error('Synthetic asynchronous purge failure'));
        return Promise.resolve();
      } };
    } },
  }, globals);
  runtime.subscribeServicesCatalogInvalidation(() => { calls.push(['subscriber-throwing']); if (failure === 'listener') throw Error('Synthetic listener failure'); });
  runtime.subscribeServicesCatalogInvalidation(() => calls.push(['subscriber-after']));
  const reset = load('lib/reset-experience-cache.ts', {
    '@/lib/experience-state': { clearExperienceState: () => calls.push(['state']) },
    '@/lib/experience-resource-cache': { resetExperienceResources: scope => calls.push(['reset', scope]), suspendExperienceResources: () => calls.push(['suspend']) },
    '@/lib/experience-cache-events': { EXPERIENCE_RESET_EVENT: 'experience-reset', broadcastExperienceReset: reason => calls.push(['broadcast', reason]) },
    '@/lib/experience-offline-client': { lockExperienceOffline: options => calls.push(['lock', options]) },
    '@/lib/services-catalog-runtime': optionalHookFailure ? { invalidateServicesCatalog: reason => { calls.push(['hook', reason]); throw Error('Synthetic optional hook failure'); } } : runtime,
  }, globals);
  return { calls, storage, runtime, reset: reset.resetExperienceCaches };
}

function core(calls) { return calls.filter(([name]) => ['lock', 'suspend', 'reset', 'state', 'event', 'broadcast'].includes(name)); }

for (const reason of reasons) for (const failure of ['listener', 'store-construction', 'purge-sync', 'purge-async']) {
  test(`notify:false ${reason}: ${failure} cannot interrupt core reset or later subscribers`, async () => {
    const f = fixture({ failure });
    assert.doesNotThrow(() => f.reset({ reason, scope: 'scope-old', notify: false, broadcast: true, preserveBookingHandoff: true }));
    await flush();
    assert.equal(f.runtime.servicesCatalogRuntimeRevision(), 1);
    assert.ok(f.calls.some(([name]) => name === 'subscriber-after'));
    assert.deepEqual(core(f.calls), [
      ['lock', { scope: 'scope-old', rotateGeneration: true }],
      reason === 'logout' || reason === 'expired' ? ['suspend'] : ['reset', 'scope-old'],
      ['state'], ['broadcast', reason],
    ]);
    assert.deepEqual([...f.storage], [['unrelated', 'preserved'], ['kingpos.publicBookingDraft.a.auth', 'handoff']]);
    if (reason === 'workspace') assert.equal(f.calls.some(([name]) => name === 'store' || name === 'purge'), false, 'Workspace movement preserves catalog partitions');
    else assert.equal(f.calls.some(([name]) => name === 'store'), true);
  });
}

test('production/flag-off mode still isolates the optional hook and reaches core cleanup', async () => {
  for (const env of [{}, { NODE_ENV: 'production' }, { VERCEL_ENV: 'production', REYLUMI_SERVICES_CACHE_PILOT: '1' }]) {
    assert.equal(servicesCatalogPilotEnabled(env), false);
    const f = fixture({ failure: 'listener' });
    assert.doesNotThrow(() => f.reset({ reason: 'logout', notify: false })); await flush();
    assert.deepEqual(core(f.calls), [['lock', { scope: undefined, rotateGeneration: true }], ['suspend'], ['state'], ['broadcast', 'logout']]);
    assert.ok(f.calls.some(([name]) => name === 'purge'), 'Disabled mode may remove pilot-only data');
  }
});

test('an unexpected throw from the optional hook itself is contained by the reset boundary', () => {
  for (const reason of reasons) {
    const f = fixture({ optionalHookFailure: true });
    assert.doesNotThrow(() => f.reset({ reason, scope: 'scope-old', notify: false, broadcast: true }));
    assert.deepEqual(core(f.calls), [
      ['lock', { scope: 'scope-old', rotateGeneration: true }], reason === 'logout' || reason === 'expired' ? ['suspend'] : ['reset', 'scope-old'],
      ['state'], ['broadcast', reason],
    ]);
    assert.deepEqual([...f.storage], [['unrelated', 'preserved']]);
  }
});

test('cross-tab receiver keeps rotateGeneration:false and existing explicit suspend/broadcast policy', async () => {
  const f = fixture({ failure: 'purge-async' });
  f.reset({ reason: 'permissions', scope: 'scope-received', notify: false, broadcast: false, suspend: true, bookingDrafts: false }); await flush();
  assert.deepEqual(core(f.calls), [['lock', { scope: 'scope-received', rotateGeneration: false }], ['suspend'], ['state']]);
  assert.deepEqual([...f.storage], [['unrelated', 'preserved'], ['kingpos.publicBookingDraft.a', 'draft'], ['kingpos.publicBookingDraft.a.auth', 'handoff']]);
});

test('notify:true event and default broadcast choices remain unchanged after a subscriber failure', async () => {
  for (const reason of reasons) {
    const f = fixture({ failure: 'listener' }); f.reset({ reason }); await flush();
    const suspended = reason === 'logout' || reason === 'expired';
    assert.deepEqual(core(f.calls), [
      ['lock', { scope: undefined, rotateGeneration: true }], suspended ? ['suspend'] : ['reset', undefined], ['state'],
      ['event', 'experience-reset', { reason, suspended }], ...(suspended ? [['broadcast', reason]] : []),
    ]);
  }
});

test('failure of optional session storage still reaches original notifications and broadcast', async () => {
  const f = fixture({ failure: 'purge-async', sessionStorageFailure: true }); f.reset({ reason: 'expired' }); await flush();
  assert.deepEqual(core(f.calls), [['lock', { scope: undefined, rotateGeneration: true }], ['suspend'], ['state'], ['event', 'experience-reset', { reason: 'expired', suspended: true }], ['broadcast', 'expired']]);
});

test('scope observation still withdraws synchronously without purging same-account salon partitions', () => {
  const f = fixture({ failure: 'listener' });
  assert.doesNotThrow(() => f.runtime.observeServicesCatalogScope('scope-a'));
  assert.equal(f.runtime.servicesCatalogScopeActive('scope-a'), true); assert.equal(f.runtime.servicesCatalogRuntimeRevision(), 1);
  f.runtime.observeServicesCatalogScope('scope-a'); assert.equal(f.runtime.servicesCatalogRuntimeRevision(), 1);
  f.runtime.observeServicesCatalogScope('scope-b'); assert.equal(f.runtime.servicesCatalogRuntimeRevision(), 2);
  assert.equal(f.calls.filter(([name]) => name === 'subscriber-after').length, 2);
  assert.equal(f.calls.some(([name]) => name === 'store' || name === 'purge'), false);
});

test('subscriber changes during invalidation are deferred until the next event', () => {
  const f = fixture(), calls = [];
  f.runtime.subscribeServicesCatalogInvalidation(() => { calls.push('existing'); f.runtime.subscribeServicesCatalogInvalidation(() => calls.push('added')); });
  f.runtime.invalidateServicesCatalog('workspace'); assert.deepEqual(calls, ['existing']);
  f.runtime.invalidateServicesCatalog('workspace'); assert.deepEqual(calls, ['existing', 'existing', 'added']);
});

test('a rejected async subscriber is handled without interrupting synchronous withdrawal or core reset', async () => {
  const f = fixture();
  f.runtime.subscribeServicesCatalogInvalidation(async () => { throw Error('Synthetic async subscriber failure'); });
  f.reset({ reason: 'logout', notify: false });
  assert.deepEqual(core(f.calls), [['lock', { scope: undefined, rotateGeneration: true }], ['suspend'], ['state'], ['broadcast', 'logout']]);
  assert.equal(f.runtime.servicesCatalogRuntimeRevision(), 1);
  await flush();
});

test('non-browser runtime remains a no-op and reset retains its original core calls', () => {
  const f = fixture({ browser: false, failure: 'store-construction' });
  f.reset({ reason: 'identity', notify: false, broadcast: false });
  assert.equal(f.runtime.servicesCatalogRuntimeRevision(), 0);
  assert.deepEqual(core(f.calls), [['lock', { scope: undefined, rotateGeneration: false }], ['reset', undefined], ['state']]);
});
