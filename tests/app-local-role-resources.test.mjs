import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture() {
  const state = globalThis.appLocalRoleFixture = {
    context: { scope: 'scope-a', user: { id: 'viewer-a' }, currentSalon: { id: 'salon-a' }, currentAccount: {}, currentBusiness: {}, manage: true },
    identity: null, reads: [], hold: null, today: { noAccess: false, loadErrors: [], total: 25, generatedAt: 'first' },
  };
  state.identity = { context: state.context, staff: { id: '11111111-1111-4111-8111-111111111111' } };
  const stubs = {
    'server-only': '',
    'request-business-context': 'export async function getRequestBusinessContext(){return globalThis.appLocalRoleFixture.context}',
    'experience-context': 'export const getExperienceContext=context=>({scope:context.scope});',
    'current-context': 'export const isSalonManageContext=context=>context.manage;',
    'supabase/server': `export async function createAuthenticatedSupabaseServerClient(){const s=globalThis.appLocalRoleFixture;s.reads.push('client');return{rpc:async(name,args)=>{s.reads.push({name,args});return{data:[],error:null}}}}`,
    'customer-bookings': `export async function listCustomerBookings(input){const s=globalThis.appLocalRoleFixture;s.reads.push({name:'bookings',input});if(s.hold)await s.hold;return{ok:true,data:[{id:'22222222-2222-4222-8222-222222222222',owner:s.context.user.id}]}}export async function getCustomerBookingDetail(id){const s=globalThis.appLocalRoleFixture;s.reads.push({name:'detail',id});return{ok:true,data:{id,owner:s.context.user.id}}}`,
    'account-social': `export async function getAccountSavedPosts(input){const s=globalThis.appLocalRoleFixture;s.reads.push({name:'saved',input});return Array.from({length:11},(_,id)=>({id}))}export async function getAccountFollowing(input){globalThis.appLocalRoleFixture.reads.push({name:'following',input});return{items:[],...input}}`,
    'customer-activity': `export async function getCustomerActivity(){globalThis.appLocalRoleFixture.reads.push('activity');return{ok:true,data:{items:['owned-activity']}}}`,
    '@/app/activity/history-details-actions': `export async function loadHistoryDetailsAction(input){globalThis.appLocalRoleFixture.reads.push({name:'owned-history',input});return{receipt:{id:input.ticketId},booking:null}}`,
    'staff-portal-identity': 'export async function getStaffPortalIdentity(){return globalThis.appLocalRoleFixture.identity}',
    'staff-appointments': `export async function getCurrentStaffAppointments(input){const s=globalThis.appLocalRoleFixture;s.reads.push({name:'staff-schedule',input});return{context:s.identity.context,staff:s.identity.staff,appointments:[]}}`,
    'staff-workdays': `export async function getTodaysStaffWorkday(){const s=globalThis.appLocalRoleFixture;return{context:s.identity.context,staff:s.identity.staff,today:'2026-10-16',workday:null}}export async function getCurrentSalonStaffActivitySummaries(){return new Map()}`,
    'staff-my-work-resource-server': 'export async function loadStaffMyWorkResource(identity,input){globalThis.appLocalRoleFixture.reads.push({name:"my-work",input});return{staffId:identity.staff.id,payrollData:{amount:25},analysisData:{},generatedAt:"first"}}',
    'today-dashboard': 'export async function getTodayDashboard(){const s=globalThis.appLocalRoleFixture;s.reads.push("today");return s.today}',
    'explore-reference-favorites': 'export const referenceFavoriteCursor=value=>value?null:null;export const encodeReferenceFavoriteCursor=value=>JSON.stringify(value);export async function resolveReferenceFavorites(){return{items:[],error:null}}',
    'bounded-get': 'export const runReadWithDeadline=promise=>promise;',
  };
  const output = await build({ entryPoints: ['lib/app-local-role-resources-server.ts'], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': process.cwd() }, plugins: [{ name: 'role-read-authority', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const key = Object.keys(stubs).find(key => args.path === key || args.path.endsWith('/' + key));
      return key ? { path: key, namespace: 'fixture' } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }] });
  const api = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
  return { state, read: api.readAppLocalRoleResource };
}

test('named customer reads fail before private loaders on account/scope or argument mismatch', async () => {
  const { state, read } = await fixture();
  assert.equal(await read('unsupported.execute', {}, { scope: 'scope-a' }), null);
  await assert.rejects(read('customer.bookings', {}, { scope: 'other-scope' }), { status: 409 });
  assert.deepEqual(state.reads, []);
  state.context.user = null;
  await assert.rejects(read('customer.saved-posts', {}, { scope: 'scope-a' }), { status: 401 });
  assert.deepEqual(state.reads, []);
  state.context.user = { id: 'viewer-a' };
  for (const args of [{ token: 'credential' }, { page: 10001 }, { filter: 'unsafe' }, { details: 'another-record' }]) {
    const name = Object.hasOwn(args, 'details') ? 'customer.bookings' : 'customer.saved-posts';
    await assert.rejects(read(name, args, { scope: 'scope-a' }), { status: 400 });
  }
  assert.deepEqual(state.reads, []);
});

test('actual owned history/list loaders preserve pagination and use scope-bound conditional revisions', async () => {
  const { state, read } = await fixture();
  const first = await read('customer.bookings', { tab: 'past' }, { scope: 'scope-a' });
  assert.equal(first.status, 200); assert.equal(first.schemaVersion, 1); assert.equal(typeof first.updatedAt, 'number');
  const unchanged = await read('customer.bookings', { tab: 'past' }, { scope: 'scope-a', etag: first.etag });
  assert.equal(unchanged.status, 304); assert.equal(Object.hasOwn(unchanged, 'data'), false);
  state.context.scope = 'scope-b';
  const switched = await read('customer.bookings', { tab: 'past' }, { scope: 'scope-b', etag: first.etag });
  assert.equal(switched.status, 200); assert.notEqual(switched.etag, first.etag);
  const ticketId = '33333333-3333-4333-8333-333333333333';
  const history = await read('customer.history', { ticketId }, { scope: 'scope-b' });
  assert.equal(history.data.result.receipt.id, ticketId);
  assert.ok(state.reads.some(row => row.name === 'owned-history'));
  const saved = await read('customer.saved-posts', { page: 3, q: ' nails ' }, { scope: 'scope-b' });
  assert.equal(saved.data.posts.length, 10); assert.equal(saved.data.hasNext, true);
  assert.deepEqual(state.reads.find(row => row.name === 'saved').input, { filter: 'all', limit: 11, offset: 20, query: 'nails' });
});

test('staff and owner reads use their real selected identity and reject cross-staff or denied business access', async () => {
  const { state, read } = await fixture();
  const staffId = state.identity.staff.id;
  await assert.rejects(read('staff.my-work', { staffId: '44444444-4444-4444-8444-444444444444' }, { scope: 'scope-a' }), { status: 409 });
  assert.deepEqual(state.reads, []);
  const schedule = await read('staff.schedule', { staffId, date: '2026-10-16' }, { scope: 'scope-a' });
  assert.equal(schedule.status, 200); assert.equal(schedule.data.staffId, staffId);
  const workday = await read('staff.workday', { staffId }, { scope: 'scope-a' });
  assert.equal(workday.data.staffId, staffId);
  state.context.manage = false;
  await assert.rejects(read('owner.today', {}, { scope: 'scope-a' }), { status: 403 });
  assert.ok(!state.reads.includes('today'));
  state.context.manage = true;
  const today = await read('owner.today', { date: '2026-10-16' }, { scope: 'scope-a' });
  state.today.generatedAt = 'new server timestamp';
  assert.equal((await read('owner.today', { date: '2026-10-16' }, { scope: 'scope-a', etag: today.etag })).status, 304);
  state.today.noAccess = true;
  await assert.rejects(read('owner.today', {}, { scope: 'scope-a' }), { status: 403 });
});

test('cancelled reads cannot return a late private envelope and never call a mutation', async () => {
  const { state, read } = await fixture();
  const early = new AbortController(); early.abort();
  await assert.rejects(read('customer.bookings', {}, { scope: 'scope-a', signal: early.signal }), { name: 'AbortError' });
  assert.deepEqual(state.reads, []);
  let release; state.hold = new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), pending = read('customer.bookings', {}, { scope: 'scope-a', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(state.reads.map(row => row.name), ['bookings']);
});
