import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture() {
  const state = globalThis.businessFixture = { context: { scope: 'owner-a', user: { id: 'viewer-a' }, currentSalon: { id: 'salon-a', name: 'My salon' }, currentBusiness: { id: 'salon-a' }, currentAccount: { id: 'account-a' }, currentWorkspace: { id: 'workspace-a', label: 'Salon workspace' }, currentMembership: { owner: true }, permissionCodes: [], manage: true,
    availableManageSalons: [{ id: 'older', created_at: '2025-01-01' }, { id: 'newer', created_at: '2026-01-01' }] },
    calls: [], permissions: new Set(['tickets.manage', 'salon_settings.view', 'salon_settings.manage', 'staff.view']), hold: null, raw: { large_turn_threshold: 25, staff_check_in_enabled: true, workspace_preferences: { showStaff: true }, tip_suggestions: [10, 15, 20], manager_pin_hash: 'must-never-enter-local-props', future_secret: 'must-never-enter-local-props' },
    setting: { salon_id: 'salon-a', business_name: 'My salon' }, profile: null, rowError: null,
  };
  const stubs = {
    'server-only': '',
    'request-business-context': 'export const getRequestBusinessContext=async()=>{globalThis.businessFixture.calls.push("context");return globalThis.businessFixture.context};',
    'current-context': 'export const getCreateSalonAccount=()=>({id:"account-a"});export const isOwnerMembership=member=>member?.owner===true;export const isSalonManageContext=context=>context.manage===true;',
    'experience-context': 'export const getExperienceContext=context=>({scope:context.scope});',
    'route-context-guards': 'export const requireSalonManagePageContext=async()=>globalThis.businessFixture.context;export const requireSalonWorkspacePageContext=async()=>globalThis.businessFixture.context;',
    'permissions': 'export const hasPermission=async name=>globalThis.businessFixture.permissions.has(name);',
    'salon-settings': 'export async function getCurrentSalonSetting(){const s=globalThis.businessFixture;s.calls.push("setting");return{setting:s.setting}}export async function getCurrentSalonDiscoveryReadiness(){globalThis.businessFixture.calls.push("discovery");return{canEnable:true,missingLabels:[]}}',
    'salon-lifecycle': 'export async function getSalonLifecycle(){globalThis.businessFixture.calls.push("lifecycle");return{lifecycleStatus:"active",name:"My salon",status:"active"}}export async function getSalonClosureReview(){globalThis.businessFixture.calls.push("closure");return{canClose:false}}',
    'salon-operating-status': 'export async function getCurrentSalonOperatingHoursSettings(){globalThis.businessFixture.calls.push("hours");return{weeklyHours:[],specialHours:[],status:{kind:"open"}}}export async function getCurrentSalonOperatingStatus(){return{kind:"open"}}',
    'location/salon-map-location': 'export async function getCurrentSalonMapLocationState(){globalThis.businessFixture.calls.push("map");return{status:"unavailable"}}',
    'staff': 'export async function getCurrentSalonStaffDirectory(){globalThis.businessFixture.calls.push("staff-directory");return{staff:[]}}',
    'owner-transfer': 'export async function getSalonOwnerRoster(){globalThis.businessFixture.calls.push("owner-roster");return{owners:[],canLeave:false}}',
    'pos-settings': 'export async function getCurrentSalonPosSettings(){const s=globalThis.businessFixture;s.calls.push("pos-settings");if(s.hold)await s.hold;return{largeTurnThreshold:25}}',
    'pos-portable-access': 'export async function getCurrentSalonPortablePosAccessState(){globalThis.businessFixture.calls.push("portable-access");return{keys:[],schemaReady:true,setupMessage:null}}',
    'windows-pos-release': 'export async function getWindowsPosRelease(){return{href:"https://reylumi.com/verified-installer.exe",version:"1.2.3",edition:"release"}}',
    'supabase/server': 'export async function createAuthenticatedSupabaseServerClient(){return{from:table=>({select:columns=>({eq:()=>({maybeSingle:async()=>{const s=globalThis.businessFixture;s.calls.push({table,columns});return{data:s.raw,error:s.rowError}}})})})}}',
    'salon-profile': 'export const getSalonProfileHref=id=>"/explore/salons/"+id;export const getSalonProfileMediaUrl=value=>value??null;export const buildSalonProfileFeed=()=>[];export const getPublicSalonProfileData=async()=>{globalThis.businessFixture.calls.push("public-profile");return globalThis.businessFixture.publicProfile??null};export async function getCurrentSalonProfileManageData(){const s=globalThis.businessFixture;s.calls.push("managed-profile");return s.profile??{context:s.context,canViewProfile:true,canCreateContent:false,canManageIdentity:false,canManageContent:false,setting:s.setting,looks:[],updates:[],staff:[],services:[],readiness:{}}}',
    'salon-operating-status-core': 'export const defaultSalonOperatingStatus=()=>({kind:"open"});',
    'salon-profile-team': 'export const isPublicSalonProfileTeamEligible=()=>true;',
    'salon-post-attribution': 'export const loadSalonPostAttribution=async()=>new Map();',
    'pos-tickets': 'export const POS_TICKET_PERMISSIONS={manage:"tickets.manage"};',
    'bounded-get': 'export const runReadWithDeadline=promise=>promise;',
  };
  const result = await build({ entryPoints: ['lib/app-local-business-server.ts'], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': process.cwd() }, plugins: [{ name: 'business-original-guards', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(stubs).find(key => args.path === key || args.path.endsWith('/' + key)); return key ? { namespace: 'fixture', path: key } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }] });
  const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  return { state, read: api.readAppLocalBusinessResource };
}

test('business reads reject absent identity, changed workspace and undeclared targets before private page loaders', async () => {
  const { state, read } = await fixture();
  assert.equal(await read('not.a.page', {}, { scope: 'owner-a' }), null);
  await assert.rejects(read('owner.pos-settings', { salonId: 'someone-else' }, { scope: 'owner-a' }), { status: 400 });
  assert.deepEqual(state.calls, []);
  await assert.rejects(read('owner.pos-settings', {}, { scope: 'owner-b' }), { status: 409 });
  assert.deepEqual(state.calls, ['context']);
  state.context.user = null;
  await assert.rejects(read('owner.pos-settings', {}, { scope: 'owner-a' }), { status: 401 });
  assert.ok(!state.calls.includes('pos-settings'));
});

test('the salon list keeps the original allowed list/order and conditional revision ignores a newly allocated draft UUID', async () => {
  const { state, read } = await fixture();
  const first = await read('customer.salons', {}, { scope: 'owner-a' });
  assert.deepEqual(first.data.salons.map(salon => salon.id), ['newer', 'older']);
  assert.equal(first.data.currentSalonId, 'salon-a'); assert.equal(first.data.hasCreatePermission, true);
  assert.match(first.data.createRequestKey, /^[0-9a-f-]{36}$/);
  const unchanged = await read('customer.salons', {}, { scope: 'owner-a', etag: first.etag });
  assert.equal(unchanged.status, 304); assert.equal(Object.hasOwn(unchanged, 'data'), false);
  assert.equal(state.calls.filter(call => call === 'context').length, 2);
});

test('POS Settings preserves every existing group conflict field while excluding unknown secret columns from retained props', async () => {
  const { state, read } = await fixture();
  state.permissions.delete('tickets.manage');
  await assert.rejects(read('owner.pos-settings', {}, { scope: 'owner-a' }), { status: 403 });
  assert.ok(!state.calls.includes('pos-settings'));
  state.permissions.add('tickets.manage');
  const result = await read('owner.pos-settings', {}, { scope: 'owner-a' });
  assert.equal(result.data.snapshot.large_turn_threshold, 25); assert.deepEqual(result.data.snapshot.workspace_preferences, { showStaff: true });
  assert.equal(Object.hasOwn(result.data.snapshot, 'manager_pin_hash'), false); assert.equal(Object.hasOwn(result.data.snapshot, 'future_secret'), false);
  assert.ok(!state.calls.find(call => call.table === 'pos_settings').columns.includes('*'));
  assert.equal(result.data.desktopRelease.href, 'https://reylumi.com/verified-installer.exe');
  state.rowError = { message: 'Database unavailable' };
  await assert.rejects(read('owner.pos-settings', {}, { scope: 'owner-a' }), { status: 503 });
});

test('Salon Settings keeps the original conditional owner/staff reads and never substitutes manager authority', async () => {
  const { state, read } = await fixture();
  state.context.currentMembership.owner = false; state.permissions.delete('staff.view');
  const manager = await read('owner.salon-settings', {}, { scope: 'owner-a' });
  assert.equal(manager.data.canManageSettings, true); assert.equal(manager.data.canManageOwnership, false); assert.equal(manager.data.canManageLifecycle, false);
  assert.equal(manager.data.ownerRoster, null); assert.deepEqual(manager.data.staffDirectory.staff, []);
  assert.ok(!state.calls.includes('owner-roster')); assert.ok(!state.calls.includes('closure')); assert.ok(!state.calls.includes('staff-directory'));
  state.context.currentMembership.owner = true;
  const owner = await read('owner.salon-settings', {}, { scope: 'owner-a' });
  assert.equal(owner.data.canManageOwnership, true); assert.ok(state.calls.includes('owner-roster')); assert.ok(state.calls.includes('closure'));
});

test('the full profile projection carries only original server-confirmed edit/publication capabilities', async () => {
  const { state, read } = await fixture();
  const result = await read('owner.salon-profile', {}, { scope: 'owner-a' });
  assert.equal(result.data.data.profile.name, 'My salon'); assert.equal(result.data.manageData.publicHref, null);
  assert.equal(result.data.capabilities.canBook, false);
  assert.equal(result.data.capabilities.canPublish, false); assert.equal(result.data.capabilities.canManageContent, false);
  state.profile = { canViewProfile: false };
  const count = state.calls.filter(call => call === 'public-profile').length;
  await assert.rejects(read('owner.salon-profile', {}, { scope: 'owner-a' }), { status: 403 });
  assert.equal(state.calls.filter(call => call === 'public-profile').length, count);
});

test('cancelling a pending settings activation discards its late snapshot without replaying an operation', async () => {
  const { state, read } = await fixture(); let release;
  state.hold = new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), pending = read('owner.pos-settings', {}, { scope: 'owner-a', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(state.calls.filter(call => call === 'pos-settings').length, 1);
});

 test('public links appear only after the existing public profile loader returns a profile', async () => {
 const {state,read}=await fixture();
 const preview=await read('owner.salon-profile',{}, {scope:'owner-a'});
 state.publicProfile=preview.data.data;
 const live=await read('owner.salon-profile',{}, {scope:'owner-a'});
 assert.equal(live.data.manageData.publicHref,'/explore/salons/salon-a');
 assert.equal(live.data.capabilities.canBook,true);
 state.publicProfile=null;
 const privateAgain=await read('owner.salon-profile',{}, {scope:'owner-a'});
 assert.equal(privateAgain.data.manageData.publicHref,null);
 assert.equal(privateAgain.data.capabilities.canBook,false);
 });
