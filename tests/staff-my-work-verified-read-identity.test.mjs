import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { after } from 'node:test';
import { createClient, isAuthSessionMissingError } from '@supabase/supabase-js';
import ts from 'typescript';

// Reuse the actual composed route/adapter/getters/SDK fixture, never a duplicate
// implementation. Only its already synthetic backend gains mutable response hooks.
const require = createRequire(import.meta.url);
const realReact = require('next/dist/server/route-modules/app-page/vendored/rsc/react');
const original = readFileSync(new URL('./staff-my-work-critical-path.test.mjs', import.meta.url), 'utf8');
let fixtureSource = original.slice(original.indexOf('const tick ='), original.indexOf("test('independent timezone"));
function replaceOnce(before, next) {
  assert.equal(fixtureSource.split(before).length, 2, 'Fixture adaptation must match once');
  fixtureSource = fixtureSource.replace(before, next);
}
replaceOnce('populated = false, now } = {})', 'populated = false, now, hooks = {} } = {})');
replaceOnce('const react = { cache: read => read };', 'const react = realReact;');
replaceOnce('return Response.json(data);', 'return Response.json(hooks.data ? hooks.data(kind, data, events) : data);');
replaceOnce('return { run, events, payCalls, ids, scopeFor, contextFor, staffFor,', `return { run, events, payCalls, ids, scopeFor, contextFor, staffFor,
    withoutReadScope: (operation, suffix = '1') => request.run({ suffix }, async () => operation(await identity.getStaffPortalIdentity(), { identity, resource })),
    withIdentity: (operation, suffix = '1') => reads.runWithReadContext(() => request.run({ suffix }, async () => {
      const verified = await identity.getStaffPortalIdentity();
      return operation(verified, { reads, identity, workdays, resource, server });
    })),`);
const fixture = new Function('assert', 'AsyncLocalStorage', 'crypto', 'readFileSync', 'ts', 'createClient', 'isAuthSessionMissingError', 'origin', 'codeCache', 'realReact', fixtureSource + '\nreturn fixture;')(
  assert, AsyncLocalStorage, crypto, readFileSync, ts, createClient, isAuthSessionMissingError,
  'https://staff-critical-path.invalid', new Map(), realReact,
);
const savedFetch = globalThis.fetch;
const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const saved = keys.map(k => process.env[k]);
let externalAttempts = 0;
globalThis.fetch = () => { externalAttempts++; throw new Error('External network forbidden'); };
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://staff-critical-path.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'synthetic-public-key';
after(() => {
  globalThis.fetch = savedFetch;
  keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  assert.equal(externalAttempts, 0);
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function until(predicate) { for (let i = 0; i < 1000; i++) { if (predicate()) return; await tick(); } assert.fail('Synthetic request did not reach held stage'); }

test('strict Daily reuse removes duplicate helper gates but retains fresh final verification', async () => {
  const f = fixture({ populated: true });
  const response = await f.run(); assert.equal(response.status, 200);
  const body = (await response.json()).data;
  assert.equal(body.workStatus, 'checked_in'); assert.equal(body.workTickets.length, 1);
  assert.deepEqual(['auth', 'status', 'session', 'staff', 'timezone', 'snapshot', 'greeting', 'attendance'].map(kind => f.count(kind)), [3, 3, 3, 2, 2, 1, 1, 1]);
  assert.equal(f.events.length, 16);
});

test('late session revocation after snapshot starts prevents any completed private DTO', async () => {
  const snapshot = deferred(); let revoked = false;
  const f = fixture({ hold: { snapshot }, hooks: { data: (kind, data) => kind === 'session' && revoked ? { revoked_at: '2000-01-01T00:00:00Z' } : data } });
  const pending = f.run(); await until(() => f.count('snapshot') === 1);
  revoked = true; snapshot.resolve(); const response = await pending;
  assert.equal(response.status, 401); assert.equal((await response.json()).data, undefined);
  assert.ok(f.count('session') >= 2, 'Final verification must perform a new settled session read');
});

test('late suspension, missing Staff or duplicate Staff never exports a private DTO', async () => {
  for (const failure of ['suspended', 'missing', 'duplicate']) {
    const snapshot = deferred(); let late = false;
    const f = fixture({ hold: { snapshot }, hooks: { data: (kind, data) => {
      if (!late) return data;
      if (kind === 'status' && failure === 'suspended') return { status: 'suspended' };
      if (kind === 'staff' && failure === 'missing') return [];
      if (kind === 'staff' && failure === 'duplicate') return [...data, ...data];
      return data;
    } } });
    const pending = f.run(); await until(() => f.count('snapshot') === 1);
    late = true; snapshot.resolve(); const response = await pending;
    assert.equal(response.status, failure === 'suspended' ? 403 : 503, failure); assert.equal((await response.json()).data, undefined);
  }
});

test('late final-gate unavailability remains503 and never becomes guest success', async () => {
  const snapshot = deferred(), fail = {};
  const f = fixture({ hold: { snapshot }, fail });
  const pending = f.run(); await until(() => f.count('snapshot') === 1);
  fail.status = 503; snapshot.resolve(); const response = await pending;
  assert.equal(response.status, 503); assert.equal((await response.json()).data, undefined);
});

test('fresh final validation cannot join a pending same-authority validation', { timeout: 5000 }, async () => {
  const hold = {}, auth = deferred(); let revoked = false;
  const f = fixture({ hold, hooks: { data: (kind, data) => kind === 'session' && revoked ? { revoked_at: '2000-01-01T00:00:00Z' } : data } });
  await f.withIdentity(async (identity, { identity: api, server }) => {
    const count = f.count('auth'); hold.auth = auth;
    let backgroundSettled = false;
    const background = server.createAuthenticatedSupabaseServerClient({ throwOnUnavailable: true }).finally(() => { backgroundSettled = true; });
    try {
      await until(() => f.count('auth') === count + 1);
      await tick(); await tick(); assert.equal(backgroundSettled, false);
      delete hold.auth; revoked = true;
      const verification = api.revalidateStaffPortalReadIdentity(identity);
      const denied = assert.rejects(verification);
      await until(() => f.count('auth') === count + 2);
      await denied;
    } finally {
      auth.resolve(); await background;
    }
  });
});

test('identity capabilities cannot be fabricated, cloned or used in a new read request', async () => {
  const f = fixture(); let retained;
  await f.withIdentity(async (identity, { identity: api, workdays }) => {
    retained = identity;
    for (const forged of [{ ...identity }, { ...identity, staff: { ...identity.staff } }]) {
      assert.throws(() => api.requireStaffPortalReadIdentity(forged, identity.context));
      await assert.rejects(workdays.getCurrentStaffAssignedWork(identity.context, { readIdentity: forged }));
    }
    assert.equal(f.count('snapshot'), 0);
  });
  await f.withIdentity(async (_identity, { identity: api }) => {
    assert.throws(() => api.requireStaffPortalReadIdentity(retained, retained.context));
  });
});

test('a mutated context or Staff tuple cannot borrow a minted identity', async () => {
  for (const change of ['context-object', 'salon', 'staff', 'viewer', 'account']) {
    const f = fixture();
    await f.withIdentity(async (identity, { identity: api }) => {
      assert.equal(api.requireStaffPortalReadIdentity(identity, identity.context), identity);
      if (change === 'context-object') assert.throws(() => api.requireStaffPortalReadIdentity(identity, { ...identity.context }));
      if (change === 'salon') { identity.context.currentSalon.id = f.ids('2').salon; assert.throws(() => api.requireStaffPortalReadIdentity(identity, identity.context)); }
      if (change === 'staff') { identity.staff.id = f.ids('2').staff; assert.throws(() => api.requireStaffPortalReadIdentity(identity, identity.context)); }
      if (change === 'viewer') { identity.context.user.id = f.ids('2').viewer; assert.throws(() => api.requireStaffPortalReadIdentity(identity, identity.context)); }
      if (change === 'account') { identity.context.currentAccount.id = f.ids('2').account; assert.throws(() => api.requireStaffPortalReadIdentity(identity, identity.context)); }
    });
  }
});

test('request abort after the authoritative snapshot is held cannot complete a DTO', async () => {
  const snapshot = deferred(), controller = new AbortController();
  const f = fixture({ hold: { snapshot } }); const pending = f.run({ signal: controller.signal });
  await until(() => f.count('snapshot') === 1); controller.abort(new DOMException('Synthetic stop', 'AbortError')); snapshot.resolve();
  const response = await pending; assert.equal(response.status, 503); assert.equal((await response.json()).data, undefined);
});

test('two concurrent request principals never share Staff, date or capability', async () => {
  const f = fixture({ populated: true });
  const [a, b] = await Promise.all([f.run({ suffix: '1' }), f.run({ suffix: '2' })]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const da = (await a.json()).data, db = (await b.json()).data;
  assert.equal(da.staff.id, f.ids('1').staff); assert.equal(db.staff.id, f.ids('2').staff);
  assert.equal(da.salonId, f.ids('1').salon); assert.equal(db.salonId, f.ids('2').salon);
  assert.equal(f.count('staff'), 4); assert.equal(f.count('auth'), 6);
});

test('legacy helper calls without a capability retain their independent validations', async () => {
  const f = fixture();
  await f.withIdentity(async (identity, { workdays }) => {
    const before = f.count('auth');
    const work = await workdays.getCurrentStaffAssignedWork(identity.context);
    assert.ok(f.count('auth') - before >= 3);
    const attendanceBefore = f.count('auth');
    const attendance = await workdays.getTodaysStaffWorkday(identity.context, { allowEmailFallback: false, workDate: work.today });
    assert.ok(f.count('auth') - attendanceBefore >= 2);
    assert.equal(attendance.workday.status, 'checked_in');
  });
});

test('direct loader callers outside a read scope keep original helper behavior', async () => {
  const f = fixture();
  await f.withoutReadScope(async (identity, { identity: api, resource }) => {
    assert.equal(api.canReuseStaffPortalReadIdentity(identity, identity.context), false);
    const result = await resource.loadStaffMyWorkResource(identity, { tab: 'daily' });
    assert.equal(result.workStatus, 'checked_in');
  });
  assert.equal(f.events.length, 26);
});

test('snapshot date, valid empty Daily, optional greeting and selected pay policy remain unchanged', async () => {
  const empty = fixture({ snapshotDate: '2000-02-29' });
  const result = await empty.run(); assert.equal(result.status, 200);
  const data = (await result.json()).data;
  assert.equal(data.today, '2000-02-29'); assert.deepEqual(data.workTickets, []);
  const greeting = fixture({ fail: { greeting: 503 } });
  const optional = await greeting.run(); assert.equal(optional.status, 200); assert.equal((await optional.json()).data.greetingHistory, null);
  const pay = fixture({ fail: { pay: 503 } });
  assert.equal((await pay.run({ tab: 'analysis' })).status, 503);
});
