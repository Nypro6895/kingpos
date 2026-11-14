import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const scope = '00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000003';
const foreignScope = '00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000004';
const draftKey = `kingpos:portable-draft:v1:${scope}:native-device`;
const built = await build({ stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
  export * from './lib/portable-device-storage';
  export * from './lib/portable-operations';
  export * from './lib/portable-native-client';
  export * from './lib/pos-draft-outbox';
` }, bundle: true, write: false, platform: 'browser', format: 'cjs' });

function memoryStorage() {
  const map = new Map();
  const calls = [];
  return { map, calls, getItem(key) { calls.push(['get', key]); return map.get(key) ?? null; }, setItem(key, value) { calls.push(['set', key, value]); map.set(key, value); }, removeItem(key) { calls.push(['remove', key]); map.delete(key); } };
}

function fixture(path = '/pos/portable') {
  const browser = memoryStorage(), native = memoryStorage(), calls = [], window = new EventTarget();
  const location = { pathname: path };
  let fail = false;
  const request = async input => { calls.push(input); if (fail) throw Error('Synthetic native disk failure'); return input.action === 'operations.list' ? [] : input.action === 'operations.checkpoint' ? 0 : { ok: true }; };
  window.__reylumiPortableDevice = { version: 1, platform: 'ios', request, storage: {
    get(key) { if (fail) throw Error('Synthetic native disk failure'); return native.getItem(key); },
    set(key, value) { if (fail) throw Error('Synthetic native disk failure'); native.setItem(key, value); },
    remove(key) { if (fail) throw Error('Synthetic native disk failure'); native.removeItem(key); },
  } };
  const module = { exports: {} }, timers = new Map();
  let timerID = 0, posts = 0, idbCalls = 0;
  const context = { module, exports: module.exports, window, location, navigator: { onLine: false }, localStorage: browser,
    structuredClone, Event, crypto: webcrypto, Date, console,
    indexedDB: { open() { idbCalls++; throw Error('The native path must not fall back to IndexedDB'); } },
    fetch: async () => { posts++; throw Error('No business request is authorized by this fixture'); },
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; }, clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(built.outputFiles[0].text, context);
  return { api: module.exports, browser, native, window, calls, location, timers, setFail(value) { fail = value; }, posts: () => posts, idbCalls: () => idbCalls };
}

test('iOS Portable uses synchronous native persistence and keeps Owner POS on its original storage', () => {
  const f = fixture();
  f.api.portableDeviceStorage.setItem(draftKey, '{"amount":127.5}');
  assert.equal(f.native.map.get(draftKey), '{"amount":127.5}');
  assert.equal(f.browser.calls.length, 0);
  assert.equal(f.api.portableDeviceStorage.getItem(draftKey), '{"amount":127.5}');
  for (const path of ['/pos', '/pos/ticket', '/explore', '/pos/portable-other']) {
    f.location.pathname = path;
    assert.equal(f.api.portableDevice(), undefined, path);
    f.api.portableDeviceStorage.setItem('owner-draft', path);
    assert.equal(f.browser.map.get('owner-draft'), path);
  }
  f.location.pathname = '/pos/portable/ticket';
  assert.ok(f.api.portableDevice());
  assert.equal(f.api.desktopDevice(), undefined, 'iOS never impersonates the Windows window/display/update API');
});

test('native failures propagate without an evictable fallback or deleting a recoverable legacy draft', () => {
  const f = fixture();
  f.browser.map.set(draftKey, '{"legacy":true}');
  assert.equal(f.api.portableDeviceStorage.getItem(draftKey), '{"legacy":true}');
  assert.equal(f.native.map.get(draftKey), '{"legacy":true}');
  assert.equal(f.browser.map.get(draftKey), '{"legacy":true}', 'migration retains the original browser copy');
  f.setFail(true);
  assert.throws(() => f.api.portableDeviceStorage.setItem(draftKey, '{"lost":true}'), /native disk failure/);
  assert.throws(() => f.api.portableDeviceStorage.getItem(draftKey), /native disk failure/);
  assert.throws(() => f.api.portableDeviceStorage.removeItem(draftKey), /native disk failure/);
  assert.equal(f.browser.map.get(draftKey), '{"legacy":true}');
  assert.equal(f.native.map.get(draftKey), '{"legacy":true}');
  f.setFail(false); f.api.portableDeviceStorage.removeItem(draftKey);
  assert.equal(f.browser.map.has(draftKey), false, 'confirmed removal cannot remigrate an obsolete browser copy');
});

test('native queue save failure cannot dispatch success, clear a cart, replay a mutation, or fall back to IndexedDB', async () => {
  const f = fixture();
  let changed = 0; f.window.addEventListener(f.api.PORTABLE_OPERATIONS_CHANGED, () => changed++);
  f.setFail(true);
  await assert.rejects(f.api.savePortableOperation(scope, 'receipt', { localDraftKey: draftKey, total: 127.5 }), /native disk failure/);
  assert.equal(changed, 0);
  assert.equal(f.idbCalls(), 0); assert.equal(f.posts(), 0);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, 'operations.save');
  f.setFail(false);
  const saved = await f.api.savePortableOperation(scope, 'receipt', { localDraftKey: draftKey, total: 127.5 });
  assert.equal(saved.id, f.calls[1].operation.id);
  assert.equal(saved.state, 'pending'); assert.equal(changed, 1); assert.equal(f.posts(), 0);
});

test('draft outbox never sends before a durable operation identity and retries the same identity after storage recovers', async () => {
  const f = fixture();
  let fail = true, saves = 0; const sends = [], durable = [];
  const outbox = new f.api.DraftOutbox({ version: 0, id: () => 'stable-draft-request-id', online: () => true,
    persist(state) { saves++; if (fail) throw Error('Synthetic disk full'); durable.push(structuredClone(state)); },
    async send(operation) { sends.push(structuredClone(operation)); return { kind: 'ok', version: 1 }; },
  });
  outbox.enqueue({ total: 127.5 });
  await outbox.pump();
  assert.equal(sends.length, 0, 'an uncertain local commit may never dispatch a financial draft request');
  assert.equal(outbox.storageError, true);
  assert.equal(outbox.state.head.id, 'stable-draft-request-id');
  assert.equal(await outbox.flush(20), false, 'storage failure must not report a successful flush');
  fail = false;
  assert.equal(await outbox.flush(20), true);
  assert.equal(sends.length, 1); assert.equal(sends[0].id, 'stable-draft-request-id');
  assert.ok(durable.some(state => state.head?.id === sends[0].id), 'the exact UUID must reach durable storage before send');
  assert.equal(outbox.pending, false); assert.equal(outbox.storageError, false); assert.ok(saves >= 3);
  outbox.stop();
});

test('failed durable acknowledgement keeps flush failed until a later confirmed local write', async () => {
  const f = fixture();
  let afterSend = false, diskFull = true;
  const outbox = new f.api.DraftOutbox({ version: 0, id: () => 'ack-draft-request-id', online: () => true,
    persist() { if (afterSend && diskFull) throw Error('Synthetic acknowledgement disk failure'); },
    async send() { afterSend = true; return { kind: 'ok', version: 1 }; },
  });
  outbox.enqueue({ total: 127.5 }); await outbox.pump();
  assert.equal(outbox.pending, false); assert.equal(outbox.storageError, true);
  assert.equal(await outbox.flush(20), false);
  diskFull = false;
  assert.equal(await outbox.flush(20), true, 'local acknowledgement can be retried without replaying a completed server command');
  outbox.stop();
  assert.equal(await outbox.flush(20), false, 'a locked/unmounted outbox cannot certify a save');
});

test('persistence listeners cannot dispatch the same head twice and stopping resolves flush without updating a detached editor', async () => {
  const f = fixture();
  let sends = 0, release;
  const outbox = new f.api.DraftOutbox({ version: 0, id: () => 'reentrant-head', online: () => true,
    persist() {}, send() { sends++; return new Promise(resolve => { release = resolve; }); },
  });
  outbox.enqueue({ total: 127.5 });
  let notices = 0;
  outbox.subscribe(() => { notices++; void outbox.pump(); });
  const pendingFlush = outbox.flush(20);
  assert.equal(sends, 1, 'the persistence notification cannot recursively dispatch this head');
  const beforeStop = notices;
  outbox.stop();
  assert.equal(await pendingFlush, false);
  assert.equal(notices, beforeStop, 'stop resolves only flush waiters, without notifying detached React editors');
  release({ kind: 'ok', version: 1 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(outbox.state.head.id, 'reentrant-head', 'a late reply cannot clear an outbox whose view was locked');
  assert.equal(sends, 1);
});

const browserBuild = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React,{useEffect} from 'react';import{createRoot}from'react-dom/client';
  import{PortableNativeStorageBoundary}from'./app/pos/portable/portable-native-storage-boundary';
  import*as operations from'./lib/portable-operations';import*as storage from'./lib/portable-device-storage';
  function Editor(){useEffect(()=>{window.editorMounts=(window.editorMounts||0)+1;return()=>{window.editorUnmounts=(window.editorUnmounts||0)+1}},[]);return <><button>POS editor</button><label>Draft note<input defaultValue=""/></label></>}
  const root=createRoot(document.getElementById('root'));
  window.qa={operations,storage,mount(scope){root.render(<PortableNativeStorageBoundary scope={scope}><Editor/></PortableNativeStorageBoundary>)}};
` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins: [{ name: 'portable-ui-fixture', setup(builder) {
  builder.onResolve({ filter: /workspace-language$|app-local-host$/ }, ({ path }) => ({ path, namespace: 'portable-ui-fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'portable-ui-fixture' }, ({ path }) => ({ contents: path.endsWith('workspace-language') ? 'export const WorkspaceText=({text})=>text;' : 'export const getAppLocalHost=()=>({isNative:false});' }));
} }] });

async function inBrowser(work) {
  const js = browserBuild.outputFiles[0].text;
  const server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? js : '<div id="root"></div><script src="/bundle.js"></script>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    await context.addInitScript(() => {
      const values = new Map();
      window.nativeFixture = { values, rows: [], calls: [], prepare: [], failImport: false, admitted: false, leaseMS: 3600000,
        allow() { const pending = this.prepare.shift(); this.admitted = true; pending.resolve({ ok: true, scope: pending.input.scope, storage: 'native', offlineReady: false, pending: this.rows.length, expiresAt: new Date(Date.now() + this.leaseMS).toISOString() }); },
      };
      const state = window.nativeFixture;
      window.__reylumiPortableDevice = { version: 1, platform: 'ios', storage: {
        get(key) { if (!state.admitted) throw Error('Vault locked'); return values.get(key) ?? null; },
        set(key, value) { if (!state.admitted) throw Error('Vault locked'); values.set(key, value); },
        remove(key) { if (!state.admitted) throw Error('Vault locked'); values.delete(key); },
      }, async request(input) {
        state.calls.push(structuredClone(input));
        if (input.action === 'storage.prepare') return new Promise((resolve, reject) => state.prepare.push({ resolve, reject, input }));
        if (input.action === 'operations.list') return structuredClone(state.rows);
        if (input.action === 'operations.import') { if (state.failImport) return { ok: false }; state.rows.push(structuredClone(input.operation)); return { ok: true }; }
        if (input.action === 'operations.checkpoint') return 0;
        throw Error('The fixture forbids all other native actions');
      } };
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/pos/portable`);
    await page.waitForFunction(() => !!window.qa);
    await work(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

async function seed(page, operations, checkpoints = []) {
  await page.evaluate(async ({ operations, checkpoints }) => {
    const request = indexedDB.open('kingpos-portable-operations', 1);
    const database = await new Promise((resolve, reject) => { request.onupgradeneeded = () => { request.result.createObjectStore('operations', { keyPath: 'sequence', autoIncrement: true }); request.result.createObjectStore('meta'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = database.transaction(['operations', 'meta'], 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
    for (const operation of operations) tx.objectStore('operations').put(operation);
    for (const [key, value] of checkpoints) tx.objectStore('meta').put(value, key);
    await done; database.close();
  }, { operations, checkpoints });
}

test('real IndexedDB migration preserves original IDs, payload, upload states and historical receipt checkpoint before editor mount', { timeout: 30000 }, async () => {
  await inBrowser(async page => {
    const oldKey = 'kingpos:portable-draft:v1:00000000-0000-4000-8000-000000000002:oldDisplayCapability:native';
    const operation = (sequence, state, operationScope = scope) => ({ sequence, id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, scope: operationScope, kind: 'receipt', occurredAt: '2026-11-13T12:00:00.000Z', payload: { localDraftKey: oldKey, lines: [{ total: 127.5, customerId: null }] }, state });
    const pending = operation(2, 'pending'), attention = { ...operation(8, 'attention'), error: 'Uncertain upload. Review this item.' }, terminal = operation(10, 'synced'), foreign = operation(12, 'pending', foreignScope);
    const checkpointAt = Date.now() - 90000;
    await seed(page, [terminal, foreign, attention, pending], [[`receipt:${scope}:${oldKey}`, checkpointAt]]);
    await page.evaluate(({ scope, terminal }) => { window.nativeFixture.rows = [terminal]; window.qa.mount(scope); }, { scope, terminal });
    await page.waitForFunction(() => window.nativeFixture.prepare.length === 1);
    assert.equal(await page.getByRole('button', { name: 'POS editor' }).count(), 0);
    assert.equal(await page.evaluate(() => window.editorMounts || 0), 0);
    await page.evaluate(() => window.nativeFixture.allow());
    await page.getByRole('button', { name: 'POS editor' }).waitFor();
    const imported = await page.evaluate(() => window.nativeFixture.calls.filter(call => call.action === 'operations.import'));
    assert.deepEqual(imported.map(call => call.operation), [pending, attention]);
    assert.ok(imported.every(call => call.checkpointAt === checkpointAt));
    assert.ok(imported.every(call => call.checkpointAt < Date.now() - 60000), 'current migration time cannot hide a newer unfinished cart');
    const source = await page.evaluate(async () => { const request = indexedDB.open('kingpos-portable-operations'); const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); }); const read = db.transaction('operations').objectStore('operations').getAll(); const rows = await new Promise(resolve => { read.onsuccess = () => resolve(read.result); }); db.close(); return rows; });
    assert.deepEqual(source, [pending, attention, terminal, foreign], 'migration never deletes or mutates the original WebKit outbox');
    assert.equal(await page.evaluate(() => window.editorMounts), 1);
  });
});

test('failed migration keeps editor unmounted; retry imports safely and lock before late admission cannot mount it', { timeout: 30000 }, async () => {
  await inBrowser(async page => {
    const operation = { sequence: 1, id: '00000000-0000-4000-8000-000000000020', scope, kind: 'visit', occurredAt: '2026-11-13T12:00:00.000Z', payload: { customerName: 'Synthetic fixture' }, state: 'pending' };
    await seed(page, [operation]);
    await page.evaluate(scope => { window.nativeFixture.failImport = true; window.qa.mount(scope); }, scope);
    await page.waitForFunction(() => window.nativeFixture.prepare.length === 1);
    await page.evaluate(() => window.nativeFixture.allow());
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.editorMounts || 0), 0);
    await page.evaluate(() => { window.nativeFixture.failImport = false; });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => window.nativeFixture.prepare.length === 1);
    await page.evaluate(() => window.dispatchEvent(new Event('kingpos:portable-lock')));
    await page.evaluate(() => window.nativeFixture.allow());
    await page.getByText('POS is locked. Your saved tickets remain on this iPad.').waitFor();
    assert.equal(await page.evaluate(() => window.editorMounts || 0), 0);
  });
});

test('native admission failure never mounts an editor; reset and lease expiry retain an already-open draft hidden and inert', { timeout: 30000 }, async () => {
  await inBrowser(async page => {
    await page.evaluate(scope => window.qa.mount(scope), scope);
    await page.waitForFunction(() => window.nativeFixture.prepare.length === 1);
    await page.evaluate(() => window.nativeFixture.prepare.shift().reject(Error('Synthetic offline denial')));
    await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(() => window.editorMounts || 0), 0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => window.nativeFixture.prepare.length === 1);
    await page.evaluate(() => window.nativeFixture.allow());
    await page.getByRole('button', { name: 'POS editor' }).waitFor();
    await page.getByLabel('Draft note').fill('Unsubmitted synthetic draft');
    await page.evaluate(() => window.dispatchEvent(new Event('reylumi:app-local-reset')));
    await page.waitForFunction(() => window.nativeFixture.prepare.length === 1);
    assert.equal(await page.getByRole('button', { name: 'POS editor' }).count(), 0, 'a retained editor cannot remain accessible while native admission resets');
    const retained = page.locator('input');
    assert.equal(await retained.inputValue(), 'Unsubmitted synthetic draft');
    assert.equal(await retained.evaluate(input => input.closest('[inert]')?.hidden), true);
    assert.equal(await page.evaluate(() => window.editorMounts), 1);
    assert.equal(await page.evaluate(() => window.editorUnmounts || 0), 0);
    await page.evaluate(() => { window.nativeFixture.leaseMS = 1000; window.nativeFixture.allow(); });
    await page.getByRole('button', { name: 'POS editor' }).waitFor();
    assert.equal(await page.getByLabel('Draft note').inputValue(), 'Unsubmitted synthetic draft');
    await page.getByText('Reconnect to renew this POS session. Your saved tickets remain on this iPad.').waitFor();
    assert.equal(await retained.inputValue(), 'Unsubmitted synthetic draft');
    assert.equal(await retained.evaluate(input => input.closest('[inert]')?.hidden), true);
    assert.equal(await page.evaluate(() => window.editorUnmounts || 0), 0);
  });
});
