import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { build } from 'esbuild';
const root = process.cwd(), scope = 'v3:' + 'a'.repeat(64), staffId = '00000000-0000-4000-8000-000000000001', viewerId = '00000000-0000-4000-8000-000000000002', revision = '00000000-0000-4000-8000-000000000003';
const actionName = 'action.' + crypto.createHash('sha256').update('app/staff/offline-binding-actions.ts#confirmStaffAccountAccess').digest('hex').slice(0, 24);
const plugin = { name: 'fixture-original-binding-authority', setup(builder) {
  const modules = {
    'server-only': '',
    'next/server': 'export async function connection(){}',
    'next/headers': 'export async function headers(){return new Headers()}',
    'next/cache': 'export function revalidatePath(path){F.invalidations.push(path)}',
    '@/lib/current-context': 'export async function getCurrentBusinessContext(){return F.context}export async function getCurrentStaffBusinessContext(){return F.context}export function isSalonManageContext(c){return c.manage}',
    '@/lib/request-business-context': 'export async function getRequestBusinessContext(){return F.context}',
    '@/lib/experience-context': 'export function getExperienceContext(c){return {scope:c.scope}}',
    '@/lib/permissions': 'export async function hasPermission(name){return name==="staff.manage"&&F.canManage}',
    '@/lib/supabase/server': 'export async function createAuthenticatedSupabaseServerClient(){return F.client}',
    '@/lib/staff-portal-identity': 'export async function getStaffPortalIdentity(){return {context:F.context,staff:null}}',
    '@/lib/app-local-http-server': 'export async function runAppLocalHttpCommand(){return {handled:false}}',
    '@/lib/app-local-role-http-server': 'export async function runAppLocalRoleHttpCommand(){return {handled:false}}',
    '@/lib/app-local-personal-resources-server': 'export async function runAppLocalPersonalCommand(){return {handled:false}}',
    '@/lib/app-local-explore-server': 'export async function runAppLocalExploreHttpCommand(){return {handled:false}}',
    '@/lib/app-local-public-server': 'export async function runAppLocalPublicHttpCommand(){return {handled:false}}',
    '@/lib/app-local-upload-server': 'export class AppLocalUploadError extends Error{};export async function runAppLocalUploadCommand(){return {handled:false}}',
    '@/lib/app-local-shell-server': 'export async function runAppLocalShellCommand(){return {handled:false}}',
    '@/lib/app-local-portable-http-server': 'export async function runAppLocalPortableHttpCommand(){return {handled:false}}',
    '@/lib/app-local-portable-context-server': 'export async function requireAppLocalPortableScope(){throw Error("Account binding fixture must never borrow portable authority")}',
    '@/lib/app-local-display-server': 'export async function authorizeAppLocalDisplayCommand(){return false}',
    '@/lib/app-local-commands-server.generated': `import{confirmStaffAccountAccess}from${JSON.stringify(path.join(root,'app/staff/offline-binding-actions.ts').replaceAll('\\','/'))};export async function runAppLocalCommand(name,values){if(name!==${JSON.stringify(actionName)})throw Error('Not pinned');return confirmStaffAccountAccess(...values)}`,
  };
  builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(modules, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: 'const F=globalThis.__staffBindingCommandFixture;\n' + modules[args.path], resolveDir: root }));
} };
const built = await build({ stdin: { resolveDir: root, contents: `export {POST} from './app/api/app-local/command/route';export {encodeAppLocalValue}from'./lib/app-local-command-codec';`, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', plugins: [plugin] });
async function fixture() {
  const F = { context: { scope, manage: true, user: { id: viewerId }, currentSalon: { id: staffId } }, canManage: true, memberExists: true, rpcError: null, rpcCalls: [], filters: [], invalidations: [] };
  F.client = { from(table) { assert.equal(table, 'staff'); return { select() { return this; }, eq(key, value) { F.filters.push([key, value]); return this; }, async maybeSingle() { return { data: F.memberExists ? { id: staffId } : null, error: null }; } }; }, async rpc(name, args) { F.rpcCalls.push([name, args]); return { data: revision, error: F.rpcError }; } };
  globalThis.__staffBindingCommandFixture = F;
  const module = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text + '\n//' + Math.random()).toString('base64'));
  async function command({ decision = 'approve', confirmed = true, expectedScope = scope, expectedRevision = revision, origin = 'https://reylumi.com' } = {}) {
    const form = new FormData(); for (const [key, value] of Object.entries({ staff_id: staffId, viewer_id: viewerId, decision, scope: expectedScope, revision: expectedRevision, ...(confirmed ? { confirmed: 'yes' } : {}) })) form.set(key, value);
    const values = await module.encodeAppLocalValue([{ status: 'idle', message: '', approved: decision === 'revoke', revision: decision === 'revoke' ? revision : null }, form]);
    const response = await module.POST(new Request('https://reylumi.com/api/app-local/command', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: actionName, scope, requestId: crypto.randomUUID(), args: { values } }) }));
    return { response, value: await response.json() };
  }
  return { F, command };
}
test('real original approval handler round-trips encoded FormData through broker once with exact salon/viewer confirmation', async () => {
  const { F, command } = await fixture(), { response, value } = await command();
  assert.equal(response.status, 200); assert.equal(value.ok, true); assert.equal(value.data.value.approved, true); assert.equal(value.data.value.revision, revision);
  assert.deepEqual(F.rpcCalls, [['attest_staff_offline_binding', { p_staff_id: staffId, p_expected_viewer_id: viewerId }]]); assert.deepEqual(F.filters, [['id', staffId], ['salon_id', staffId]]); assert.deepEqual(F.invalidations, ['/staff']);
});
test('missing checkbox, stale displayed scope, missing salon member and fresh permission denial never attest', async () => {
  for (const kind of ['unchecked', 'scope', 'member', 'permission']) {
    const { F, command } = await fixture(); if (kind === 'member') F.memberExists = false; if (kind === 'permission') F.canManage = false;
    const { value } = await command({ confirmed: kind !== 'unchecked', expectedScope: kind === 'scope' ? 'v3:' + 'b'.repeat(64) : scope });
    assert.equal(value.data.value.status, 'error', kind); assert.equal(value.data.value.approved, false); assert.deepEqual(F.rpcCalls, [], kind);
  }
});
test('real original revoke uses exact expected revision and preserves denied original result', async () => {
  const { F, command } = await fixture();
  const { value } = await command({ decision: 'revoke' }); assert.equal(value.data.value.approved, false); assert.deepEqual(F.rpcCalls, [['revoke_staff_offline_binding', { p_staff_id: staffId, p_expected_revision: revision }]]);
  F.rpcCalls = []; F.rpcError = { code: 'P0001', message: 'The account link changed.' };
  const denied = await command(); assert.equal(denied.value.data.value.status, 'error'); assert.equal(denied.value.data.value.message, 'The account link changed.'); assert.equal(F.rpcCalls.length, 1);
});
test('outer broker fresh authentication and Origin checks run before the original authority handler', async () => {
  const { F, command } = await fixture(); const crossOrigin = await command({ origin: 'https://evil.invalid' }); assert.equal(crossOrigin.response.status, 403); assert.deepEqual(F.rpcCalls, []);
  F.context.user = null; const signedOut = await command(); assert.equal(signedOut.response.status, 401); assert.equal(signedOut.value.ok, false); assert.deepEqual(F.rpcCalls, []);
});
