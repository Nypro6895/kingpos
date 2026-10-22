import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const original = readFileSync('lib/services-catalog-native-runtime.ts', 'utf8');
const source = original.replace(/import \{([^}]+)\} from "\.\/services-catalog-runtime";/, 'const {$1} = globalThis.__catalogRuntimeFixture;');
const compiled = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
let serial = 0;
async function fixture({ native = true, metadata = true } = {}) {
  const previousWindow = globalThis.window;
  const window = new EventTarget();
  if (native) window.__reylumiAppLocalTransport = { request: async () => { throw new Error('Lifecycle must never request authority'); } };
  if (metadata) window.__reylumiAppLocalContext = { version: 1, nonce: 'not-persisted', scopeEpoch: 1, generation: 'g1' };
  const actions = [];
  let active = null;
  const store = {
    observeNativeGeneration: async generation => { actions.push(['bind', generation]); },
    removeScope: async scope => { actions.push(['remove', scope]); },
  };
  globalThis.window = window;
  globalThis.__catalogRuntimeFixture = {
    getServicesCatalogStore: () => store,
    invalidateServicesCatalog: reason => { actions.push(['invalidate', reason]); },
    observeServicesCatalogScope: scope => { if (scope !== active) { active = scope; actions.push(['active', scope]); } },
    servicesCatalogScopeActive: scope => scope === active,
    servicesCatalogActiveScope: () => active,
  };
  const module = await import(`data:text/javascript;base64,${Buffer.from(compiled + '\n// fixture ' + serial++).toString('base64')}`);
  let cleanup;
  const result = {
    window, actions, store,
    install: enabled => { cleanup = module.installServicesCatalogNativeLifecycle(enabled); return cleanup; },
    active: scope => { active = scope; },
    event: (name, detail) => window.dispatchEvent(Object.assign(new Event('reylumi:app-local-' + name), { detail })),
    context: (scope = 'scope-a', viewerId = 'viewer-a', extras = {}) => result.event('context', { schemaVersion: 1, context: { scope, viewerId, authenticated: true }, ...extras }),
    clear: () => { actions.length = 0; },
    dispose: () => { cleanup?.(); globalThis.window = previousWindow; delete globalThis.__catalogRuntimeFixture; },
  };
  return result;
}

test('SSR, ordinary web, and absent native metadata install no hook and touch no storage', async () => {
  for (const options of [{ native: false }, { metadata: false }]) {
    const f = await fixture(options);
    try { f.install(true); f.install(false); f.event('reset', { reason: 'logout' }); assert.deepEqual(f.actions, []); }
    finally { f.dispose(); }
  }
  const f = await fixture();
  try { delete globalThis.window; f.install(true); assert.deepEqual(f.actions, []); }
  finally { f.dispose(); }
});

test('installation binds only native generation once and default-off rollback clears only pilot runtime', async () => {
  const f = await fixture();
  try {
    const dispose = f.install(true); assert.equal(f.install(true), dispose);
    assert.deepEqual(f.actions, [['bind', 'g1']]); f.clear();
    const off = f.install(false); assert.equal(f.install(false), off);
    f.event('reset', { reason: 'logout' });
    assert.deepEqual(f.actions, [['invalidate', 'reset']]); f.clear();
    f.install(true); assert.deepEqual(f.actions, [['bind', 'g1']]);
  } finally { f.dispose(); }
});

test('same-scope context and online-only 503 do not abort a valid native admission', async () => {
  const f = await fixture();
  try {
    f.install(); f.active('scope-a'); f.context(); f.clear();
    f.context(); f.context('scope-a', 'viewer-a', { grantStatus: 503, offlineState: 'online-only' });
    assert.deepEqual(f.actions, []);
  } finally { f.dispose(); }
});

test('same-account salon A-B-A and context reset withdraw presentation without purging partitions', async () => {
  const f = await fixture();
  try {
    f.install(); f.active('scope-a'); f.context(); f.clear();
    f.context('scope-b'); f.active('scope-b'); f.context('scope-a');
    f.active('scope-a'); f.event('reset', { reason: 'context' });
    assert.equal(f.actions.filter(x => x[0] === 'invalidate').length, 3);
    assert.ok(f.actions.every(x => x[0] === 'active' || (x[0] === 'invalidate' && x[1] === 'workspace')));
  } finally { f.dispose(); }
});

test('first context for another active scope also withdraws without inventing identity change', async () => {
  const f = await fixture();
  try {
    f.install(); f.active('scope-a'); f.clear(); f.context('scope-b');
    assert.deepEqual(f.actions, [['active', null], ['invalidate', 'workspace']]);
  } finally { f.dispose(); }
});

test('explicit denied/reset scope removes its catalog, including a leaf active before context event', async () => {
  for (const status of [403, 404, 409]) {
    const f = await fixture();
    try {
      f.install(); f.active('scope-a'); f.clear(); f.event('reset', { status });
      assert.deepEqual(f.actions, [['remove', 'scope-a'], ['active', null], ['invalidate', 'workspace']]);
    } finally { f.dispose(); }
  }
});

test('old scope conflict removes only old partition and does not withdraw a newer active salon', async () => {
  const f = await fixture();
  try {
    f.install(); f.context('scope-b'); f.active('scope-b'); f.clear();
    f.event('scope-conflict', { scope: 'scope-a', status: 409 });
    assert.deepEqual(f.actions, [['remove', 'scope-a']]);
    // A new leaf can install its scope before a context notification arrives.
    f.context('scope-a'); f.active('scope-b'); f.clear();
    f.event('scope-conflict', { scope: 'scope-a', status: 409 });
    assert.deepEqual(f.actions, [['remove', 'scope-a']]);
  } finally { f.dispose(); }
});

test('logout, unauthenticated and viewer replacement clear private data even after Services unmount', async () => {
  for (const action of [f => f.event('reset', { reason: 'logout' }), f => f.event('reset', { status: 401 }), f => f.context('scope-b', 'viewer-b'), f => f.context('scope-a', null, { context: { scope: 'scope-a', viewerId: null, authenticated: false } })]) {
    const f = await fixture();
    try {
      f.install(); f.context(); f.active(null); f.clear(); action(f);
      assert.ok(f.actions.some(x => x[0] === 'invalidate' && x[1] === 'identity'));
    } finally { f.dispose(); }
  }
});

test('unknown access uncertainty only withdraws; explicit access denial removes the active scope', async () => {
  const f = await fixture();
  try {
    f.install(); f.context(); f.active('scope-a'); f.clear(); f.event('access-changed');
    assert.deepEqual(f.actions, [['active', null], ['invalidate', 'workspace']]);
    f.active('scope-a'); f.clear(); f.event('access-changed', { status: 403 });
    assert.deepEqual(f.actions, [['remove', 'scope-a'], ['active', null], ['invalidate', 'workspace']]);
  } finally { f.dispose(); }
});

test('generation rotation purges before new binding; obsolete native metadata events cannot affect it', async () => {
  const f = await fixture();
  try {
    f.install(); f.context(); f.active('scope-a'); f.clear();
    f.window.__reylumiAppLocalContext = { version: 1, nonce: 'rotated', scopeEpoch: 5, generation: 'g2' };
    f.context('scope-b', 'viewer-a', { host: { generation: 'g1', scopeEpoch: 1 } }); assert.deepEqual(f.actions, []);
    f.context('scope-b', 'viewer-a', { host: { generation: 'g2', scopeEpoch: 5 } });
    assert.ok(f.actions.findIndex(x => x[0] === 'invalidate' && x[1] === 'identity') < f.actions.findIndex(x => x[0] === 'bind' && x[1] === 'g2'));
    f.active('scope-b'); f.clear(); f.event('reset', { generation: 'g2', scopeEpoch: 4, reason: 'logout' });
    assert.deepEqual(f.actions, []);
  } finally { f.dispose(); }
});

test('an attempted workspace command cannot strand an unchanged mounted scope; disposal removes hooks', async () => {
  const f = await fixture();
  try {
    const dispose = f.install(); f.active('scope-a'); f.clear(); f.event('workspace-start');
    assert.deepEqual(f.actions, []);
    dispose(); f.clear(); f.event('reset', { reason: 'logout' }); assert.deepEqual(f.actions, []);
  } finally { f.dispose(); }
});
