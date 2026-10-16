import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const ids = { staff: '11111111-1111-4111-8111-111111111111', viewer: '22222222-2222-4222-8222-222222222222', salon: '33333333-3333-4333-8333-333333333333', revision: '44444444-4444-4444-8444-444444444444' };
const fixture = `
const state=()=>globalThis.bindingProbe;
export async function connection(){}export async function headers(){return new Headers()}
export const getExperienceContext=c=>({scope:c.scope});
export async function getCurrentBusinessContext(){return state().context}export const isSalonManageContext=c=>c.manage;
export const hasPermission=async()=>state().canManage;export const revalidatePath=()=>{};
export const getStaffPortalIdentity=async()=>({context:state().context,staff:state().staff});
export const runReadWithDeadline=p=>p;
export async function loadStaffMyWorkResource(){state().payrollLoads++;return{staff:state().staff,payrollData:{own:true},analysisData:{own:true},generatedAt:'2026-10-16T00:00:00Z'}}
export async function createAuthenticatedSupabaseServerClient(){return{rpc:async(name,args)=>{state().calls.push({name,args});return{data:state().rpcData,error:state().rpcError}},from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:{id:state().staff.id},error:null})};return q}}}
`;
async function load(file) {
  const result = await build({ entryPoints: [path.resolve(file)], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'fresh-binding-services', setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: 'empty', namespace: 'fixture' }));
    builder.onResolve({ filter: /^(?:@\/|next\/)/ }, args => /staff-offline-binding-server|experience-live-resource-server/.test(args.path) ? { path: path.resolve(args.path.replace('@/', '') + '.ts') } : { path: args.path, namespace: 'fixture' });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: args.path === 'empty' ? '' : fixture }));
  } }] });
  const module = { exports: {} }; new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url)); return module.exports;
}
function probe(overrides = {}) { return globalThis.bindingProbe = { context: { scope: 'fresh-scope', user: { id: ids.viewer }, currentSalon: { id: ids.salon }, currentAccount: { id: 'account' }, manage: true }, staff: { id: ids.staff, salon_id: ids.salon }, canManage: true, calls: [], payrollLoads: 0, rpcData: null, rpcError: null, ...overrides }; }
const approved = () => ({ version: 1, staffId: ids.staff, viewerId: ids.viewer, salonId: ids.salon, revision: ids.revision, approvedAt: new Date().toISOString(), revoked: false });

test('background payroll read needs current server attestation before loading income; normal foreground is unchanged', async () => {
  const { GET } = await load('app/api/experience/my-work/route.ts');
  const url = `https://fixture.invalid/api/experience/my-work?scope=fresh-scope&staffId=${ids.staff}&tab=payroll`;
  try {
    let state = probe(); assert.equal((await GET(new Request(url))).status, 200); assert.equal(state.calls.length, 0); assert.equal(state.payrollLoads, 1);
    state = probe(); assert.equal((await GET(new Request(url, { headers: { 'X-Reylumi-Background-Read': '1' } }))).status, 403); assert.equal(state.payrollLoads, 0);
    state = probe({ rpcData: approved() }); assert.equal((await GET(new Request(url, { headers: { 'X-Reylumi-Background-Read': '1' } }))).status, 200); assert.equal(state.payrollLoads, 1); assert.equal(state.calls[0].args.p_staff_id, ids.staff);
    state = probe({ rpcData: { ...approved(), revoked: true } }); assert.equal((await GET(new Request(url, { headers: { 'X-Reylumi-Background-Read': '1' } }))).status, 403); assert.equal(state.payrollLoads, 0);
    state = probe({ rpcError: { code: 'NETWORK' } });
    const old = console.error; console.error = () => {};
    try { assert.equal((await GET(new Request(url, { headers: { 'X-Reylumi-Background-Read': '1' } }))).status, 503); } finally { console.error = old; }
    assert.equal(state.payrollLoads, 0);
  } finally { delete globalThis.bindingProbe; }
});

test('owner confirmation verifies fresh permission/scope and checkbox before issuing the exact expected-account RPC', async () => {
  const { confirmStaffAccountAccess } = await load('app/staff/offline-binding-actions.ts');
  const initial = { status: 'idle', message: '', approved: false, revision: null };
  const data = () => { const result = new FormData(); for (const [key, value] of Object.entries({ staff_id: ids.staff, viewer_id: ids.viewer, scope: 'fresh-scope', decision: 'approve', confirmed: 'yes' })) result.set(key, value); return result; };
  try {
    let state = probe({ canManage: false }); assert.equal((await confirmStaffAccountAccess(initial, data())).status, 'error'); assert.equal(state.calls.length, 0);
    state = probe(); const stale = data(); stale.set('scope', 'old-scope'); assert.equal((await confirmStaffAccountAccess(initial, stale)).status, 'error'); assert.equal(state.calls.length, 0);
    const unchecked = data(); unchecked.delete('confirmed'); assert.equal((await confirmStaffAccountAccess(initial, unchecked)).status, 'error'); assert.equal(state.calls.length, 0);
    state = probe({ rpcData: ids.revision }); const result = await confirmStaffAccountAccess(initial, data()); assert.equal(result.approved, true); assert.equal(result.revision, ids.revision); assert.deepEqual(state.calls, [{ name: 'attest_staff_offline_binding', args: { p_staff_id: ids.staff, p_expected_viewer_id: ids.viewer } }]);
    state = probe(); const revoke = data(); revoke.set('decision', 'revoke'); revoke.set('revision', ids.revision); const removed = await confirmStaffAccountAccess(result, revoke); assert.equal(removed.approved, false); assert.equal(state.calls[0].name, 'revoke_staff_offline_binding'); assert.equal(state.calls[0].args.p_expected_revision, ids.revision);
  } finally { delete globalThis.bindingProbe; }
});

test('server attestation cannot authorize another staff, viewer or salon and distinguishes revoked from unavailable', async () => {
  const { getStaffOfflineBindingAuthorization } = await load('lib/staff-offline-binding-server.ts');
  try {
    const state = probe(); const identity = { context: state.context, staff: state.staff };
    assert.equal((await getStaffOfflineBindingAuthorization(identity)).state, 'unconfirmed');
    for (const key of ['staffId', 'viewerId', 'salonId']) { state.rpcData = { ...approved(), [key]: '55555555-5555-4555-8555-555555555555' }; assert.equal((await getStaffOfflineBindingAuthorization(identity)).state, 'unconfirmed'); }
    state.rpcData = { ...approved(), revoked: true }; assert.equal((await getStaffOfflineBindingAuthorization(identity)).state, 'revoked');
    state.rpcData = approved(); assert.equal((await getStaffOfflineBindingAuthorization(identity)).state, 'approved');
    state.rpcError = { code: 'MISSING_RPC' }; await assert.rejects(getStaffOfflineBindingAuthorization(identity), /temporarily unavailable/);
  } finally { delete globalThis.bindingProbe; }
});
