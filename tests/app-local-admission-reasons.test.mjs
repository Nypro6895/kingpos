import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => { assert.ok(name in dependencies, 'Unexpected dependency ' + name); return dependencies[name]; }, exports);
  return exports;
}
// Actual complete lease and Staff binding validators, not an admission-shaped mock.
const binding = load('lib/staff-offline-binding.ts');
const policy = load('lib/experience-offline-policy.ts', { './staff-offline-binding': binding });
const admission = load('lib/app-local-page-admission.ts', { './experience-offline-policy': policy, './app-local-staff-online-access': load('lib/app-local-staff-online-access.ts') });
const recovery = load('lib/app-local-context-recovery.ts');
const now = Date.now(), generation = 'typed-admission-device-20261019', scope = 'v3:' + 'a'.repeat(64);
const viewerId = '11111111-1111-4111-8111-111111111111', salonId = '22222222-2222-4222-8222-222222222222';
function value(kind = 'owner') {
  const staffBinding = kind === 'staff' ? { version: 1, staffId: '33333333-3333-4333-8333-333333333333', viewerId, salonId, revision: '44444444-4444-4444-8444-444444444444', approvedAt: new Date(now - 10000).toISOString() } : undefined;
  return { schemaVersion: 1, context: { scope, viewerId, salonId, authenticated: true, workspaceId: 'salon-workspace', permissionRevision: 'revision' },
    grant: { version: 1, scope, scopes: [scope], viewerId, salonId, workspaceId: 'salon-workspace', grantRevision: 'revision', generation, issuedAt: now - 1000, expiresAt: now + 100000, path: kind === 'staff' ? '/staff/my-work' : '/staff/today', kind, ...(staffBinding ? { staffBinding } : {}) },
    onlineValidatedAt: now - 40000, offline: true, access: { ownerWorkspace: kind === 'owner', staffWorkspace: kind === 'staff' } };
}
const options = { generation, online: false, now };
test('real offline validators admit correct Owner and Staff bindings and retain shared Staff Salon Profile access', () => {
  const owner = value(), staff = value('staff');
  assert.equal(policy.isExperienceOfflineGrant(owner.grant, { generation, scope }, now), true);
  assert.equal(policy.isExperienceOfflineGrant(staff.grant, { generation, scope }, now), true);
  assert.equal(admission.canAdmitAppLocalPage(owner, '/staff/today', options), true);
  assert.equal(admission.canAdmitAppLocalPage(staff, '/staff/my-work', options), true);
  assert.equal(admission.canAdmitAppLocalPage(staff, '/salon-profile', options), true);
  assert.equal(admission.canAdmitAppLocalPage(staff, '/staff/today', options), false);
  assert.equal(admission.appLocalPageAdmissionReason(staff, '/staff/today', options), 'page-authority');
});
test('expired, wrong-generation, malformed and revoked bindings fail closed with distinct verification reasons', () => {
  for (const [change, reason] of [
    [v => { v.grant.expiresAt = now - 1; }, 'lease-expired'],
    [v => { v.grant.generation = 'another-device-20261019'; }, 'generation'],
    [v => { v.grant.scopes = ['other-scope']; }, 'lease-invalid'],
    [v => { v.offlineState = 'unconfirmed'; }, 'unconfirmed'],
  ]) {
    const v = value(); change(v);
    assert.equal(admission.canAdmitAppLocalPage(v, '/staff/today', options), false);
    assert.equal(admission.appLocalPageAdmissionReason(v, '/staff/today', options), reason);
    const error = recovery.appLocalAdmissionError(reason);
    assert.equal('status' in error, false, 'local validation cannot invent HTTP403');
    assert.equal(recovery.classifyAppLocalContextFailure(error), 'verification');
  }
  const revoked = value('staff'); revoked.grant.staffBinding.revoked = true;
  assert.equal(admission.canAdmitAppLocalPage(revoked, '/staff/my-work', options), false);
  assert.equal(admission.appLocalPageAdmissionReason(revoked, '/staff/my-work', options), 'lease-invalid');
});
test('fresh online capability tolerates lease503 only for the authorized page and never overrides explicit denial', () => {
  const v = { ...value(), grant: null, grantStatus: 503, offline: false, onlineValidatedAt: now };
  assert.equal(admission.canAdmitAppLocalPage(v, '/staff/today', { ...options, online: true }), true);
  assert.equal(admission.canAdmitAppLocalPage({ ...v, access: { ownerWorkspace: false, staffWorkspace: true } }, '/staff/today', { ...options, online: true }), false);
  for (const [status, reason, failure] of [[401, 'sign-in', 'sign-in'], [403, 'permission-denied', 'access'], [409, 'workspace-changed', 'workspace']]) {
    const denied = { ...v, grantStatus: status };
    assert.equal(admission.canAdmitAppLocalPage(denied, '/staff/today', { ...options, online: true }), false);
    assert.equal(admission.appLocalPageAdmissionReason(denied, '/staff/today', { ...options, online: true }), reason);
    assert.equal(recovery.classifyAppLocalContextFailure(recovery.appLocalAdmissionError(reason, status)), failure);
  }
});
test('generic reset and native read cancellation never claim a permission denial or qualify for transient retry', async () => {
  const cases = [[{ contextReason: 'reset' }, 'reset', 'reset'], [{ name: 'AbortError', status: -999, reason: 'cancelled' }, 'verification', 'late-reply']];
  for (const [error, category, reason] of cases) {
    assert.equal(recovery.classifyAppLocalContextFailure(error), category);
    assert.equal(recovery.appLocalContextFailureReason(error), reason);
    let reads = 0;
    await assert.rejects(recovery.runAppLocalContextRead(async () => { reads++; throw error; }, new AbortController().signal), value => value === error);
    assert.equal(reads, 1, 'only entry owns one current-path cancellation revalidation');
  }
});
