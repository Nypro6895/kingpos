import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function load(file, modules = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => modules[name] ?? {}, exports);
  return exports;
}
const { getExperienceContext, getAdminExperienceContext } = load('lib/experience-context.ts', { 'node:crypto': { createHash } });
const context = {
  user: { id: 'viewer', language: 'en', status: 'active' }, currentWorkspace: { id: 'workspace' }, workspaceType: 'salon', accountId: 'account', salonMode: 'manage', currentSalon: { id: 'salon', status: 'active' }, currentStaffSalon: { id: 'staff-salon' },
  currentMembership: { status: 'active', updated_at: '2026-10-11' }, currentAccount: { status: 'active' }, activeRole: { code: 'owner' }, permissionCodes: ['a', 'b'], permissions: ['b', 'c'],
};
test('scope stays compact and order independent, while every identity and grant change creates a distinct scope', () => {
  const original = getExperienceContext(context);
  assert.equal(original.scope.length, 67);
  assert.equal(getExperienceContext({ ...context, permissionCodes: ['b', 'a', 'a'], permissions: ['c', 'b'] }).scope, original.scope);
  for (const patch of [
    { user: { ...context.user, id: 'other' } }, { currentWorkspace: { id: 'other' } }, { accountId: 'other' },
    { currentSalon: { ...context.currentSalon, id: 'other' } }, { salonMode: 'staff' }, { user: { ...context.user, language: 'vi' } },
    { permissionCodes: ['a'] , permissions: ['b'] }, { currentMembership: { ...context.currentMembership, status: 'revoked' } },
    { currentMembership: { ...context.currentMembership, updated_at: 'new' } }, { currentAccount: { status: 'disabled' } }, { user: { ...context.user, status: 'disabled' } },
  ]) assert.notEqual(getExperienceContext({ ...context, ...patch }).scope, original.scope);
});
test('large owner and admin grant lists can persist small browsing state within its existing budget', () => {
  const storage = new Map();
  globalThis.window = { sessionStorage: { get length() { return storage.size; }, key: index => [...storage.keys()][index], getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  try {
    const state = load('lib/experience-state.ts');
    const owner = getExperienceContext({ ...context, permissions: Array.from({ length: 400 }, (_, i) => `workspace.permission.${i}`) });
    const admin = getAdminExperienceContext(owner, { userId: 'viewer', membershipId: 'admin-membership', roleId: 'admin-role', permissions: Array.from({ length: 400 }, (_, i) => `admin.permission.${i}`) });
    for (const scope of [owner.scope, admin.scope]) {
      assert.equal(scope.length, 67);
      const key = { namespace: 'navigation', scope, key: '/market' };
      const value = { scrollY: 120, value: {} };
      state.writeExperienceState(key, value);
      assert.deepEqual(state.readExperienceState(key, entry => entry?.scrollY === 120), value);
    }
    assert.notEqual(owner.scope, admin.scope);
    assert.notEqual(getAdminExperienceContext(owner, { userId: 'viewer', membershipId: 'admin-membership', roleId: 'other-role', permissions: [] }).scope, admin.scope);
  } finally { delete globalThis.window; }
});
