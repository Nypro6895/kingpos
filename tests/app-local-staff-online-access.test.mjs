import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, 'Unexpected ' + name); return dependencies[name]; }, exports);
  return exports;
}
const strict = load('lib/app-local-staff-online-access.ts');
const policy = load('lib/experience-offline-policy.ts', { './staff-offline-binding': load('lib/staff-offline-binding.ts') });
const admission = load('lib/app-local-page-admission.ts', { './experience-offline-policy': policy, './app-local-staff-online-access': strict });
const now = Date.now(), scope = 'v3:' + 'a'.repeat(64);
const viewerId = '11111111-1111-4111-8111-111111111111';
const salonId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const options = { path: '/staff/my-work', online: true, now };
function proof() {
  return { schemaVersion: 1, context: { scope, viewerId, salonId, authenticated: true, permissionRevision: 'staff-revision' },
    grant: null, grantStatus: 503, offline: false, offlineState: 'online-only', onlineValidatedAt: now,
    access: { ownerWorkspace: false, staffWorkspace: true }, staffOnlineAccess: { version: 1, staffId, viewerId, salonId, scope } };
}

test('fresh exact Staff proof admits only registered online Staff routes', () => {
  for (const path of ['/staff/my-work', '/staff/workday', '/staff/appointments', '/staff/my-work/', '/staff/appointments?day=fixture']) {
    assert.equal(strict.isAppLocalStaffOnlineAccess(proof(), { ...options, path }), true, path);
    assert.equal(admission.canAdmitAppLocalPage(proof(), path, options), true, path);
  }
  for (const path of ['/staff/today', '/staff', '/salon-profile', '/staff/my-work/child', '/explore']) {
    assert.equal(strict.isAppLocalStaffOnlineAccess(proof(), { ...options, path }), false, path);
    assert.equal(admission.canAdmitAppLocalPage(proof(), path, options), false, path);
  }
});

test('explicit marker requires the whole proof, exact identity, scope and current authentication', () => {
  const changes = [
    v => { v.schemaVersion = 2; }, v => { v.offline = true; }, v => { v.grant = {}; },
    v => { delete v.grant; }, v => { v.grantStatus = 200; }, v => { v.access.staffWorkspace = false; },
    v => { v.access.staffWorkspace = 1; }, v => { v.context.authenticated = false; },
    v => { v.context.viewerId = null; }, v => { v.context.salonId = 'wrong'; },
    v => { v.context.scope = 'legacy-scope'; }, v => { v.context.permissionRevision = ''; },
    v => { v.staffOnlineAccess = null; }, v => { v.staffOnlineAccess.version = 2; },
    v => { v.staffOnlineAccess.staffId = 'staff'; }, v => { v.staffOnlineAccess.viewerId = staffId; },
    v => { v.staffOnlineAccess.salonId = staffId; }, v => { v.staffOnlineAccess.scope = 'v3:' + 'b'.repeat(64); },
    v => { v.onlineValidatedAt = undefined; }, v => { v.onlineValidatedAt = String(now); },
    v => { v.onlineValidatedAt = NaN; }, v => { v.onlineValidatedAt = 0; },
    v => { v.onlineValidatedAt = now - 30000; }, v => { v.onlineValidatedAt = now + 60001; },
  ];
  for (const [index, change] of changes.entries()) {
    const value = proof(); change(value);
    assert.equal(strict.isAppLocalStaffOnlineAccess(value, options), false, 'invalid field case ' + index);
    assert.equal(admission.canAdmitAppLocalPage(value, options.path, options), false, 'admission case ' + index);
  }
  assert.equal(strict.isAppLocalStaffOnlineAccess(proof(), { ...options, online: false }), false);
  assert.equal(admission.canAdmitAppLocalPage(proof(), options.path, { ...options, online: false }), false);
  assert.equal(strict.isAppLocalStaffOnlineAccess(null, options), false);
});

test('freshness bounds accept under thirty seconds and at most sixty seconds future clock skew', () => {
  for (const onlineValidatedAt of [now - 29999, now, now + 60000]) {
    assert.equal(strict.isAppLocalStaffOnlineAccess({ ...proof(), onlineValidatedAt }, options), true);
  }
});

test('real authentication, permission and workspace denials take priority over proof', () => {
  for (const [grantStatus, reason] of [[401, 'sign-in'], [403, 'permission-denied'], [409, 'workspace-changed']]) {
    assert.equal(admission.appLocalPageAdmissionReason({ ...proof(), grantStatus }, options.path, options), reason);
  }
  assert.equal(admission.appLocalPageAdmissionReason({ ...proof(), offlineState: 'unconfirmed' }, options.path, options), 'unconfirmed');
});

test('legacy generic lease503 behavior stays separate for Owner, Staff and shared Post', () => {
  const staff = proof(); delete staff.offlineState; delete staff.staffOnlineAccess;
  const owner = { ...staff, access: { ownerWorkspace: true, staffWorkspace: false } };
  assert.equal(admission.canAdmitAppLocalPage(staff, '/staff/my-work', options), true);
  assert.equal(admission.canAdmitAppLocalPage(staff, '/salon-profile', options), true);
  assert.equal(admission.canAdmitAppLocalPage(owner, '/staff/today', options), true);
  assert.equal(admission.canAdmitAppLocalPage(owner, '/salon-profile', options), true);
  assert.equal(admission.canAdmitAppLocalPage(staff, '/staff/today', options), false);
  assert.equal(admission.canAdmitAppLocalPage(owner, '/staff/my-work', options), false);
  assert.equal(admission.canAdmitAppLocalPage(staff, '/staff/my-work', { ...options, online: false }), false);
});

test('actual web host requests supported protocol on context reads and never persists an online-only grant', async () => {
  let reply = proof(), cleared = 0;
  const calls = [], accepted = [];
  const host = load('lib/app-local-host.ts', {
    './bounded-get': { fetchBoundedGet: async (...args) => { calls.push(args); return Response.json(reply); }, fetchWithDeadline: async () => { throw Error('Unexpected write'); } },
    './experience-persistent-cache': { getExperienceDeviceGeneration: () => 'fixture-generation-20261020', clearExperienceSnapshots: async () => { cleared++; }, acceptExperienceOfflineGrant: async value => { accepted.push(value); } },
  }).getAppLocalHost();
  const controller = new AbortController();
  await host.context('/staff/my-work', { signal: controller.signal });
  assert.equal(calls[0][1].headers['X-Reylumi-Staff-Online-Access'], '1');
  assert.equal(calls[0][1].signal, controller.signal);
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.equal(calls[0][2].maxAttempts, 1);
  assert.equal(cleared, 1);
  assert.deepEqual(accepted, []);
  reply = { ...proof(), grant: { kind: 'staff', fixture: 'malformed-marker-old-lease' } };
  await host.context('/staff/my-work');
  assert.equal(cleared, 2);
  assert.deepEqual(accepted, [], 'malformed online-only must not restore an old offline lease');
});

test('actual web host retains normal approved offline lease persistence', async () => {
  const grant = { kind: 'staff', fixture: 'approved-offline-lease' }, accepted = [];
  let cleared = 0;
  const reply = { ...proof(), grant, grantStatus: 200 };
  delete reply.offlineState; delete reply.staffOnlineAccess;
  const host = load('lib/app-local-host.ts', {
    './bounded-get': { fetchBoundedGet: async () => Response.json(reply), fetchWithDeadline: async () => { throw Error('Unexpected write'); } },
    './experience-persistent-cache': { getExperienceDeviceGeneration: () => 'fixture-generation-20261020', clearExperienceSnapshots: async () => { cleared++; }, acceptExperienceOfflineGrant: async value => { accepted.push(value); } },
  }).getAppLocalHost();
  await host.context('/staff/my-work');
  assert.equal(cleared, 0);
  assert.deepEqual(accepted, [grant]);
});
