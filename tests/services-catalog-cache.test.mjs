import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const built = buildSync({ entryPoints: ['lib/services-catalog-cache.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'CatalogModule' });
const script = Buffer.from(built.outputFiles[0].contents).toString();
const nodeBuilt = buildSync({ entryPoints: ['lib/services-catalog-cache.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { isServicesCatalog, isCatalogPartition, createServicesCatalogStore } = await import(`data:text/javascript;base64,${Buffer.from(nodeBuilt.outputFiles[0].contents).toString('base64')}`);
const executablePath = process.env.TEST_BROWSER_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(existsSync);
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', request.url === '/cache.js' ? 'application/javascript' : 'text/html');
  response.end(request.url === '/cache.js' ? script : '<!doctype html><meta charset="utf-8"><script src="/cache.js"></script>');
});
let browser, origin;
const launch = { headless: true, ...(executablePath ? { executablePath } : {}) };
before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(launch);
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

async function setup(page) {
  await page.goto(origin);
  await page.evaluate(() => {
    window.time = 1_000_000;
    window.partition = (overrides = {}) => ({ viewerId: 'viewer-a', accountId: 'account-a', salonId: 'salon-a', scope: 'scope-a', permissionRevision: 'owner:services.view:v1', ...overrides });
    window.catalog = (name = 'Manicure') => ({ services: [{ id: 'service-a', name, category: 'Nails', description: null, basePrice: 25, durationMinutes: 30 }] });
    window.make = () => CatalogModule.createServicesCatalogStore({ now: () => window.time });
    window.raw = async operation => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open(CatalogModule.SERVICES_CATALOG_DATABASE, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { return await new Promise((resolve, reject) => {
        const tx = db.transaction(CatalogModule.SERVICES_CATALOG_STORE, 'readwrite'), store = tx.objectStore(CatalogModule.SERVICES_CATALOG_STORE), request = store.getAll();
        let answer; request.onsuccess = () => { answer = operation(request.result, store); };
        tx.oncomplete = () => resolve(answer); tx.onabort = tx.onerror = () => reject(tx.error);
      }); } finally { db.close(); }
    };
    window.cache = make();
  });
}
async function fixture(run) {
  const context = await browser.newContext();
  try { const page = await context.newPage(); await setup(page); await run(page); }
  finally { await context.close(); }
}

test('strict schema accepts only the catalog projection and rejects private extras and malformed values', () => {
  const service = { id: 'a', name: 'Manicure', category: null, description: null, basePrice: 20, durationMinutes: 30 };
  assert.equal(isServicesCatalog({ services: [service] }), true);
  for (const change of [{ access_token: 'forbidden' }, { staff: [] }, { canManage: true }, { basePrice: NaN }, { durationMinutes: -1 }, { id: '' }, { description: 'x'.repeat(4097) }]) assert.equal(isServicesCatalog({ services: [{ ...service, ...change }] }), false);
  assert.equal(isServicesCatalog({ services: [service], grants: [] }), false);
  assert.equal(isServicesCatalog({ services: [service, service] }), false);
  assert.equal(isServicesCatalog({ services: Array.from({ length: 501 }, (_, i) => ({ ...service, id: String(i) })) }), false);
  assert.equal(isCatalogPartition({ viewerId: 'a', accountId: 'a', salonId: 'a', scope: 'a', permissionRevision: '' }), false);
});

test('real IndexedDB cold miss, warm hit and salon A-B-A retain distinct partitions', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(), b = partition({ salonId: 'salon-b', scope: 'scope-b' });
    const unobserved = await cache.read(a);
    await cache.observeAccount(a.viewerId, a.accountId);
    const cold = await cache.read(a), writeA = await cache.write(a, catalog('A'));
    await cache.read(b); const writeB = await cache.write(b, catalog('B'));
    return { unobserved, cold, writeA, writeB, a: await cache.read(a), b: await cache.read(b) };
  });
  assert.equal(result.unobserved, null); assert.equal(result.cold, null);
  assert.equal(result.writeA, true); assert.equal(result.writeB, true);
  assert.equal(result.a.data.services[0].name, 'A'); assert.equal(result.b.data.services[0].name, 'B');
}));

test('actual browser process restart preserves disk data, but still requires explicit account observation', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'reylumi-catalog-storage-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, launch);
    let page = context.pages()[0] || await context.newPage(); await setup(page);
    await page.evaluate(async () => { const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog('Disk restart')); });
    await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, launch);
    page = context.pages()[0] || await context.newPage(); await setup(page);
    const result = await page.evaluate(async () => {
      const before = await cache.read(partition()); await cache.observeAccount('viewer-a', 'account-a');
      return { before, after: await cache.read(partition()) };
    });
    assert.equal(result.before, null); assert.equal(result.after.data.services[0].name, 'Disk restart');
  } finally {
    await context?.close();
    assert.ok(path.resolve(profile).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(profile).startsWith('reylumi-catalog-storage-test-'));
    rmSync(profile, { recursive: true, force: true });
  }
});

test('logout purge and a different viewer or account clear every prior salon and reject former writers', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog());
    const queued = cache.write(a, catalog('Late')); const purging = cache.purge();
    const late = await queued; await purging;
    await cache.observeAccount(a.viewerId, a.accountId); const afterLogout = await cache.read(a);
    await cache.write(a, catalog());
    const other = make(); await other.observeAccount('viewer-b', 'account-b');
    const oldWriter = await cache.write(a, catalog('Old account'));
    await other.read(partition({ viewerId: 'viewer-b', accountId: 'account-b' }));
    await other.observeAccount(a.viewerId, a.accountId); const returned = await other.read(a);
    const priorSessionWriter = await cache.write(a, catalog('Same account, former session'));
    await other.write(a, catalog()); await other.observeAccount('viewer-a', 'account-other');
    await other.observeAccount(a.viewerId, a.accountId); const changedAccount = await other.read(a);
    return { late, afterLogout, oldWriter, priorSessionWriter, returned, changedAccount };
  });
  assert.deepEqual(result, { late: false, afterLogout: null, oldWriter: false, priorSessionWriter: false, returned: null, changedAccount: null });
}));

test('permission/scope changes withdraw prior rows and cannot be reversed by an old writer', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const old = partition(), next = partition({ permissionRevision: 'staff:services.view:v2', scope: 'scope-new' });
    await cache.observeAccount(old.viewerId, old.accountId); await cache.read(old); await cache.write(old, catalog('Old'));
    const newScope = await cache.read(next), staleWrite = await cache.write(old, catalog('Late old'));
    await cache.write(next, catalog('New')); const newData = await cache.read(next);
    const pending = cache.write(next, catalog('Withdrawn')); const removing = cache.remove(next);
    const writeAfterRemove = await pending; await removing;
    const removed = await cache.read(next), persisted = await raw(rows => rows.filter(row => row.id.startsWith('catalog:')).length);
    return { newScope, staleWrite, newData, writeAfterRemove, removed, persisted };
  });
  assert.equal(result.newScope, null); assert.equal(result.staleWrite, false); assert.equal(result.newData.data.services[0].name, 'New');
  assert.equal(result.writeAfterRemove, false); assert.equal(result.removed, null); assert.equal(result.persisted, 0);
}));

test('scope-only withdrawal rejects pending writers while retaining other salon data and admissions', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(), b = partition({ salonId: 'salon-b', scope: 'scope-b' });
    await cache.observeAccount(a.viewerId, a.accountId);
    await cache.read(a); await cache.write(a, catalog('A'));
    await cache.read(b); await cache.write(b, catalog('B'));
    const pending = cache.write(a, catalog('Late A')), removing = cache.removeScope(a.scope);
    const late = await pending; await removing;
    const afterRemoval = await raw(rows => rows.filter(row => row.partition).map(row => ({ id: row.id, scope: row.partition.scope })));
    const unauthorizedRewrite = await cache.write(a, catalog('A without new admission'));
    const preservedWrite = await cache.write(b, catalog('B fresh'));
    return { late, afterRemoval, unauthorizedRewrite, preservedWrite, b: await cache.read(b), a: await cache.read(a) };
  });
  assert.equal(result.late, false); assert.equal(result.unauthorizedRewrite, false); assert.equal(result.preservedWrite, true);
  assert.equal(result.afterRemoval.length, 2); assert.ok(result.afterRemoval.every(row => row.scope === 'scope-b'));
  assert.equal(result.b.data.services[0].name, 'B fresh'); assert.equal(result.a, null);
}));

test('TTL expiry, schema corruption, extra fields and invalid timestamps fail closed and are removed', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog());
    time += CatalogModule.SERVICES_CATALOG_TTL_MS; const expired = await cache.read(a);
    const outcomes = [];
    for (const mutation of [row => { row.schemaVersion = 2; }, row => { row.schemaVersion = 0; }, row => { row.data.services[0].access_token = 'never-render'; }, row => { row.updatedAt = NaN; }, row => { row.expiresAt += 1; }, row => { row.partition.scope = 'other'; }]) {
      await cache.read(a); await cache.write(a, catalog());
      await raw((rows, store) => { const row = rows.find(row => row.id.startsWith('catalog:')); mutation(row); store.put(row); });
      outcomes.push(await cache.read(a));
    }
    return { expired, outcomes, rows: await raw(rows => rows.filter(row => row.id.startsWith('catalog:')).length) };
  });
  assert.equal(result.expired, null); assert.deepEqual(result.outcomes, Array(6).fill(null)); assert.equal(result.rows, 0);
}));

test('count, record size and total byte limits remain bounded', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    await cache.observeAccount('viewer-a', 'account-a');
    for (let i = 0; i < 12; i++) { time++; const p = partition({ salonId: 'salon-' + i, scope: 'scope-' + i }); await cache.read(p); await cache.write(p, catalog('Salon ' + i)); }
    const count = await raw(rows => ({ catalogs: rows.filter(row => row.id.startsWith('catalog:')).length, markers: rows.filter(row => row.id.startsWith('admission:')).length }));
    const large = { services: Array.from({ length: 100 }, (_, i) => ({ ...catalog().services[0], id: 'service-' + i, description: 'x'.repeat(1500) })) };
    for (let i = 0; i < 8; i++) { time++; const p = partition({ salonId: 'large-' + i, scope: 'large-' + i }); await cache.read(p); await cache.write(p, large); }
    const bytes = await raw(rows => rows.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).length, 0));
    const p = partition(); await cache.read(p);
    const oversized = await cache.write(p, { services: large.services.map(row => ({ ...row, description: 'x'.repeat(4096) })) });
    return { count, bytes, oversized, max: CatalogModule.SERVICES_CATALOG_MAX_BYTES };
  });
  assert.deepEqual(result.count, { catalogs: 8, markers: 8 }); assert.ok(result.bytes <= result.max); assert.equal(result.oversized, false);
}));

test('older responses cannot replace fresher records and a queued payload cannot gain private fields', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a);
    time++; await cache.write(a, catalog('Latest'));
    const older = await cache.write(a, catalog('Older'), time - 1);
    const data = catalog('Copied'); const writing = cache.write(a, data); data.services[0].access_token = 'mutated';
    const copied = await writing, saved = await cache.read(a);
    return { older, copied, saved };
  });
  assert.equal(result.older, false); assert.equal(result.copied, true); assert.equal(result.saved.data.services[0].name, 'Copied'); assert.equal('access_token' in result.saved.data.services[0], false);
}));

test('unavailable IndexedDB and quota exceptions are cache misses without blocking live data', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const unavailable = CatalogModule.createServicesCatalogStore({ indexedDB: { open() { throw new DOMException('blocked', 'SecurityError'); } }, now: () => time });
    const a = partition(); await unavailable.observeAccount(a.viewerId, a.accountId);
    const read = await unavailable.read(a), write = await unavailable.write(a, catalog()); await unavailable.purge();
    const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    let deniedGetter;
    try {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('origin denied', 'SecurityError'); } });
      const denied = make(); await denied.observeNativeGeneration('g1'); await denied.observeAccount(a.viewerId, a.accountId);
      deniedGetter = { read: await denied.read(a), write: await denied.write(a, catalog()) }; await denied.purge(); denied.close();
    } finally { if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor); else delete window.indexedDB; }
    await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a);
    const original = IDBObjectStore.prototype.put;
    let quota;
    try { IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); }; quota = await cache.write(a, catalog()); }
    finally { IDBObjectStore.prototype.put = original; }
    return { read, write, deniedGetter, quota, recovered: await cache.write(a, catalog()) };
  });
  assert.deepEqual(result, { read: null, write: false, deniedGetter: { read: null, write: false }, quota: false, recovered: true });
}));

test('native generation survives store restart and preserves same-generation A-B-A only after admission', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(), b = partition({ salonId: 'salon-b', scope: 'scope-b' });
    // Calls may be queued together by registry installation and admission.
    const binding = cache.observeNativeGeneration('native-generation-a');
    const observing = cache.observeAccount(a.viewerId, a.accountId); await binding; await observing;
    await cache.read(a); const wrote = await cache.write(a, catalog('A'));
    await cache.read(b); await cache.write(b, catalog('B')); cache.close();
    const restarted = make(); await restarted.observeNativeGeneration('native-generation-a');
    const beforeAdmission = await restarted.read(a);
    await restarted.observeAccount(a.viewerId, a.accountId);
    return { wrote, beforeAdmission, a: await restarted.read(a), b: await restarted.read(b), marker: await raw(rows => rows.find(row => row.id === 'native-generation')) };
  });
  assert.equal(result.wrote, true); assert.equal(result.beforeAdmission, null);
  assert.equal(result.a.data.services[0].name, 'A'); assert.equal(result.b.data.services[0].name, 'B');
  assert.deepEqual(result.marker, { id: 'native-generation', schemaVersion: 1, generation: 'native-generation-a' });
}));

test('native binding survives actual browser process restart and rejects generation changed while JS was closed', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'reylumi-catalog-storage-test-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, launch);
    let page = context.pages()[0] || await context.newPage(); await setup(page);
    await page.evaluate(async () => {
      await cache.observeNativeGeneration('native-before-restart'); await cache.observeAccount('viewer-a', 'account-a');
      await cache.read(partition()); await cache.write(partition(), catalog('Persisted native session'));
    });
    await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, launch);
    page = context.pages()[0] || await context.newPage(); await setup(page);
    const same = await page.evaluate(async () => {
      await cache.observeNativeGeneration('native-before-restart'); await cache.observeAccount('viewer-a', 'account-a');
      return cache.read(partition());
    });
    assert.equal(same.data.services[0].name, 'Persisted native session');
    await context.close(); context = undefined;
    context = await chromium.launchPersistentContext(profile, launch);
    page = context.pages()[0] || await context.newPage(); await setup(page);
    const rotated = await page.evaluate(async () => {
      await cache.observeNativeGeneration('native-after-closed-js-logout'); await cache.observeAccount('viewer-a', 'account-a');
      return { cache: await cache.read(partition()), catalogs: await raw(rows => rows.filter(row => row.id.startsWith('catalog:')).length) };
    });
    assert.deepEqual(rotated, { cache: null, catalogs: 0 });
  } finally {
    await context?.close();
    assert.ok(path.resolve(profile).startsWith(path.resolve(tmpdir()) + path.sep));
    assert.ok(path.basename(profile).startsWith('reylumi-catalog-storage-test-'));
    rmSync(profile, { recursive: true, force: true });
  }
});

test('native generation rotation fences queued and other-instance writers, even with same account relogin', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeNativeGeneration('g1'); await cache.observeAccount(a.viewerId, a.accountId);
    await cache.read(a); await cache.write(a, catalog('Old session'));
    const old = make(); await old.observeNativeGeneration('g1'); await old.observeAccount(a.viewerId, a.accountId);
    const writing = cache.write(a, catalog('Pending old')), rotating = cache.observeNativeGeneration('g2');
    const late = await writing; await rotating;
    await cache.observeAccount(a.viewerId, a.accountId); const after = await cache.read(a);
    const staleRead = await old.read(a), staleWrite = await old.write(a, catalog('Old process'));
    await old.observeAccount(a.viewerId, a.accountId); const staleReadmit = await old.write(a, catalog('Still old process'));
    const freshWrite = await cache.write(a, catalog('New session'));
    await cache.purge(); const purged = await raw(rows => rows);
    await cache.observeAccount(a.viewerId, a.accountId); const afterPurge = await cache.read(a);
    return { late, after, staleRead, staleWrite, staleReadmit, freshWrite, purged, afterPurge };
  });
  assert.deepEqual(result, { late: false, after: null, staleRead: null, staleWrite: false, staleReadmit: false, freshWrite: true, purged: [{ id: 'native-generation', schemaVersion: 1, generation: 'g2' }], afterPurge: null });
}));

test('absent/corrupt native binding and failed persistence never admit old cache rows', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog('Unbound web cache'));
    await cache.observeNativeGeneration('g1'); await cache.observeAccount(a.viewerId, a.accountId);
    const unbound = await cache.read(a); await cache.write(a, catalog('Native cache'));
    await raw((rows, store) => store.put({ id: 'native-generation', schemaVersion: 99, generation: 'g1' }));
    const corrupt = await cache.read(a); await cache.observeAccount(a.viewerId, a.accountId); const corruptWrite = await cache.write(a, catalog('Must not save'));
    const original = IDBObjectStore.prototype.put;
    try { IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); }; await cache.observeNativeGeneration('g2'); }
    finally { IDBObjectStore.prototype.put = original; }
    await cache.observeAccount(a.viewerId, a.accountId); const failed = await cache.read(a), failedWrite = await cache.write(a, catalog('No binding'));
    await cache.observeNativeGeneration('g2'); await cache.observeAccount(a.viewerId, a.accountId); const recovered = await cache.read(a), recoveredWrite = await cache.write(a, catalog('Recovered'));
    await cache.observeNativeGeneration(''); await cache.observeAccount(a.viewerId, a.accountId); const invalid = await cache.read(a);
    return { unbound, corrupt, corruptWrite, failed, failedWrite, recovered, recoveredWrite, invalid };
  });
  assert.deepEqual(result, { unbound: null, corrupt: null, corruptWrite: false, failed: null, failedWrite: false, recovered: null, recoveredWrite: true, invalid: null });
}));

test('native metadata survives account switch and remains inside the total byte budget', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    await cache.observeNativeGeneration('g1'); await cache.observeAccount('viewer-a', 'account-a');
    const large = { services: Array.from({ length: 100 }, (_, i) => ({ ...catalog().services[0], id: 'service-' + i, description: 'x'.repeat(1500) })) };
    for (let i = 0; i < 8; i++) { time++; const p = partition({ salonId: 'large-' + i, scope: 'large-' + i }); await cache.read(p); await cache.write(p, large); }
    const bytes = await raw(rows => rows.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).length, 0));
    await cache.observeAccount('viewer-b', 'account-b');
    const rows = await raw(rows => rows);
    return { bytes, max: CatalogModule.SERVICES_CATALOG_MAX_BYTES, marker: rows.find(row => row.id === 'native-generation'), privateRows: rows.filter(row => row.partition).length };
  });
  assert.ok(result.bytes <= result.max); assert.equal(result.privateRows, 0);
  assert.deepEqual(result.marker, { id: 'native-generation', schemaVersion: 1, generation: 'g1' });
}));

test('a scoped removal fences another already-admitted instance delayed read and write atomically', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(), b = partition({ salonId: 'salon-b', scope: 'scope-b' });
    await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog('A'));
    await cache.read(b); await cache.write(b, catalog('B'));
    const former = make(); await former.observeAccount(a.viewerId, a.accountId);
    await cache.removeScope(a.scope);
    const oldRead = await former.read(a), oldWrite = await former.write(a, catalog('Revoked late result'));
    const retained = await cache.read(b);
    const rows = await raw(rows => rows.filter(row => row.partition?.scope === a.scope).length);
    // A genuinely fresh admission can observe the account fence again.
    await former.observeAccount(a.viewerId, a.accountId); const freshRead = await former.read(a), freshWrite = await former.write(a, catalog('Newly admitted'));
    return { oldRead, oldWrite, retained: retained.data.services[0].name, rows, freshRead, freshWrite };
  });
  assert.deepEqual(result, { oldRead: null, oldWrite: false, retained: 'B', rows: 0, freshRead: null, freshWrite: true });
}));

test('read result cannot escape after TTL expires between its IndexedDB callback and commit', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog());
    time += CatalogModule.SERVICES_CATALOG_TTL_MS - 1;
    const original = IDBObjectStore.prototype.put;
    try {
      IDBObjectStore.prototype.put = function (value, ...args) {
        const request = original.call(this, value, ...args);
        if (value.id?.startsWith('catalog:')) time++;
        return request;
      };
      return await cache.read(a);
    } finally { IDBObjectStore.prototype.put = original; }
  });
  assert.equal(result, null);
}));

test('corrupt non-string record keys cannot bypass the cache byte bound', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog());
    await raw((rows, store) => {
      store.put({ id: 42, schemaVersion: 0, payload: 'x'.repeat(CatalogModule.SERVICES_CATALOG_MAX_BYTES + 1) });
      store.put({ id: new Date(1), schemaVersion: 0 });
      store.put({ id: ['malformed-array-key', 2], schemaVersion: 2 });
    });
    const restored = await cache.read(a);
    return { name: restored.data.services[0].name, records: await raw(rows => rows.map(row => row.id)), bytes: await raw(rows => rows.reduce((sum, row) => sum + new TextEncoder().encode(JSON.stringify(row)).length, 0)), max: CatalogModule.SERVICES_CATALOG_MAX_BYTES };
  });
  assert.equal(result.name, 'Manicure'); assert.equal(result.records.length, 3); assert.ok(result.bytes <= result.max);
}));

test('put already enqueued before purge, account change, scope removal or native rotation cannot survive it', () => fixture(async page => {
  const results = await page.evaluate(async () => {
    const outcomes = [];
    for (const kind of ['purge', 'account', 'scope', 'native']) {
      cache.close(); cache = make(); await cache.observeNativeGeneration('g1');
      const a = partition(), b = partition({ salonId: 'salon-b', scope: 'scope-b' });
      await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog('A'));
      await cache.read(b); await cache.write(b, catalog('B'));
      const original = IDBObjectStore.prototype.put;
      let invalidating, triggered = false, written;
      try {
        IDBObjectStore.prototype.put = function (value, ...args) {
          const request = original.call(this, value, ...args);
          if (!triggered && value.id?.startsWith('catalog:')) {
            triggered = true;
            invalidating = kind === 'purge' ? cache.purge() : kind === 'account' ? cache.observeAccount('viewer-b', 'account-b') : kind === 'scope' ? cache.removeScope(a.scope) : cache.observeNativeGeneration('g2');
          }
          return request;
        };
        written = await cache.write(a, catalog('Late pending put')); await invalidating;
      } finally { IDBObjectStore.prototype.put = original; }
      outcomes.push({ kind, written, scopes: await raw(rows => rows.filter(row => row.partition).map(row => row.partition.scope)) });
    }
    return outcomes;
  });
  for (const result of results) {
    assert.equal(result.written, false, result.kind);
    assert.deepEqual(result.scopes, result.kind === 'scope' ? ['scope-b', 'scope-b'] : [], result.kind);
  }
}));

test('TTL boundary, backward clock and prior expiry never resurrect removed rows', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog());
    const savedAt = time;
    time = savedAt + CatalogModule.SERVICES_CATALOG_TTL_MS - 1; const before = await cache.read(a);
    time++; const boundary = await cache.read(a);
    time = savedAt + 1; const rollbackAfterExpiry = await cache.read(a);
    await cache.write(a, catalog('New')); time--; const rollbackBeforeWrite = await cache.read(a);
    time = savedAt + 2; const returned = await cache.read(a);
    return { before: before.data.services[0].name, boundary, rollbackAfterExpiry, rollbackBeforeWrite, returned };
  });
  assert.deepEqual(result, { before: 'Manicure', boundary: null, rollbackAfterExpiry: null, rollbackBeforeWrite: null, returned: null });
}));

test('future IndexedDB schema refuses downgrade safely, and real eviction recovers as a fresh empty store', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition(); await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog('Prior schema'));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(CatalogModule.SERVICES_CATALOG_DATABASE, 2);
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    const oldSchemaRead = await cache.read(a), oldSchemaWrite = await cache.write(a, catalog('No downgrade'));
    cache.close();
    await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(CatalogModule.SERVICES_CATALOG_DATABASE); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    cache = make(); await cache.observeAccount(a.viewerId, a.accountId); const evicted = await cache.read(a), recovered = await cache.write(a, catalog('Recovered'));
    return { oldSchemaRead, oldSchemaWrite, evicted, recovered };
  });
  assert.deepEqual(result, { oldSchemaRead: null, oldSchemaWrite: false, evicted: null, recovered: true });
}));

test('hung IndexedDB open is bounded and a late successful connection is closed', async () => {
  let request, closed = 0;
  const cache = createServicesCatalogStore({ indexedDB: { open() { request = {}; return request; } } });
  const began = performance.now();
  const result = await cache.read({ viewerId: 'a', accountId: 'a', salonId: 'a', scope: 'a', permissionRevision: 'v1' });
  assert.equal(result, null); assert.ok(performance.now() - began < 5000);
  request.result = { close() { closed++; } }; request.onsuccess();
  assert.equal(closed, 1); cache.close();
});

test('hung IndexedDB read is bounded, aborts the transaction and returns a safe miss', async () => {
  let aborted = 0;
  const database = {
    close() {},
    transaction() {
      const tx = { objectStore: () => ({ getAll: () => ({}), getAllKeys: () => ({}) }), abort() { aborted++; queueMicrotask(() => tx.onabort()); } };
      return tx;
    },
  };
  const cache = createServicesCatalogStore({ indexedDB: { open() { const request = { result: database }; queueMicrotask(() => request.onsuccess()); return request; } } });
  const began = performance.now();
  const result = await cache.read({ viewerId: 'a', accountId: 'a', salonId: 'a', scope: 'a', permissionRevision: 'v1' });
  assert.equal(result, null); assert.equal(aborted, 1); assert.ok(performance.now() - began < 5000); cache.close();
});

test('online manager removal clears the exact salon across old roles without prior pilot observation', () => fixture(async page => {
  const result = await page.evaluate(async () => {
    const a = partition({ scope: 'salon-a-old-role', permissionRevision: 'former-role:services.view' }), b = partition({ salonId: 'salon-b', scope: 'scope-b' });
    await cache.observeAccount(a.viewerId, a.accountId); await cache.read(a); await cache.write(a, catalog('Old role A'));
    await cache.read(b); await cache.write(b, catalog('Other salon B'));
    const manager = make(); // Direct online manager entry never restored pilot.
    await manager.removeSalon(a.salonId);
    const removedRows = await raw(rows => rows.filter(row => row.partition?.salonId === a.salonId).length);
    const delayedRead = await cache.read(a), delayedWrite = await cache.write(a, catalog('Late before edit'));
    await cache.observeAccount(a.viewerId, a.accountId);
    const after = await cache.read(a), retained = await cache.read(b);
    return { removedRows, delayedRead, delayedWrite, after, retained: retained.data.services[0].name };
  });
  assert.deepEqual(result, { removedRows: 0, delayedRead: null, delayedWrite: false, after: null, retained: 'Other salon B' });
}));

test('obsolete queued account/read/write/native-binding bursts do not reopen unavailable IndexedDB', async () => {
  let firstRequest, opened, opens = 0;
  const firstOpened = new Promise(resolve => { opened = resolve; });
  const cache = createServicesCatalogStore({ indexedDB: { open() {
    const request = {}; opens++;
    if (opens === 1) { firstRequest = request; opened(); }
    else queueMicrotask(() => request.onerror());
    return request;
  } } });
  const p = { viewerId: 'viewer', accountId: 'account', salonId: 'salon', scope: 'scope', permissionRevision: 'v1' };
  const data = { services: [{ id: 's', name: 'Service', category: null, description: null, basePrice: 20, durationMinutes: 30 }] };
  const first = cache.observeAccount(p.viewerId, p.accountId); await firstOpened;
  const queued = [];
  for (let i = 0; i < 5; i++) queued.push(cache.observeAccount(p.viewerId, p.accountId), cache.read(p), cache.write(p, data));
  queued.push(cache.observeNativeGeneration('old-1'), cache.observeNativeGeneration('old-2'), cache.observeNativeGeneration('current'));
  queued.push(cache.observeAccount(p.viewerId, p.accountId));
  firstRequest.onerror(); await first; await Promise.all(queued);
  // One already-started attempt, the latest binding, and the latest account.
  // The current binding must survive a later account epoch, unlike stale work.
  assert.equal(opens, 3); cache.close();
});
