import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('UI reuses this render grants while protected actions still read current grants', async () => {
  let reads = 0;
  const client = { from(table) { reads++; const query = { select() { return query; }, eq() { return query; }, in() { return query; }, returns: async () => ({ data: table === 'role_permissions' ? [{ permission_id: 'fresh' }] : [{ code: 'staff.view' }], error: null }) }; return query; } };
  const dependencies = { 'server-only': {}, '@/lib/current-context': { isOwnerMembership: membership => membership?.owner === true }, '@/lib/salon-lifecycle-rules': { getSalonOperationForPermissionCode: () => 'write', canPerformSalonOperation: ({ status }) => status === 'active', getSalonLifecycleDenialMessage: () => 'Inactive' }, '@/lib/supabase/server': { createAuthenticatedSupabaseServerClient: () => client } };
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync('lib/permissions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => dependencies[name], exports);
  const context = { user: { id: 'user' }, accountId: 'account', currentMembership: { role_id: 'manager' }, currentSalon: { status: 'active' }, permissionCodes: ['booking.manage'] };
  assert.equal(exports.hasPermissionForRender('booking.manage', context), true);
  assert.equal(reads, 0);
  assert.equal(await exports.hasPermission('booking.manage', context), false);
  assert.equal(reads, 2, 'mutations do not authorize from the render grant snapshot');
  assert.equal(exports.hasPermissionForRender('staff.view', { ...context, permissionCodes: [] }), false);
  assert.equal(exports.hasPermissionForRender('booking.manage', { ...context, user: null }), false);
  assert.equal(exports.hasPermissionForRender('booking.manage', { ...context, currentMembership: { owner: true }, currentSalon: { status: 'archived' } }), false);
});
