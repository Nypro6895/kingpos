import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture() {
  const state = globalThis.localPlatformFixture = {
    context: { scope: 'account-a', user: { id: 'viewer-a', created_at: '2026-01-01T00:00:00Z', display_name: 'My account' }, currentSalon: { id: 'salon-a' }, currentMembership: { owner: true } },
    calls: [], hold: null, error: null, index: { managed: [], staff: [], accounts: [], hasBusinessWorkspace: false },
    bookings: [{ id: '11111111-1111-4111-8111-111111111111', salon_id: 'salon-a', start_at: '2026-10-16T14:00:00Z', salon_timezone_snapshot: 'America/Chicago' }],
    history: [{ type: 'purchase', id: 'mine', bookingId: '11111111-1111-4111-8111-111111111111' }, { type: 'visit', id: 'another-salon', salon: { id: 'salon-b' }, occurredAt: '2026-10-16T14:00:00Z' }],
    identity: { context: { scope: 'resolved-staff', user: { id: 'viewer-a' }, currentSalon: { id: 'staff-salon' } }, staff: { id: 'staff-a' } }, receipt: { ticketId: '22222222-2222-4222-8222-222222222222', totals: { total: 127.45 }, payments: [{ amount: 127.45 }] },
  };
  const stubs = {
    'server-only': '',
    'request-business-context': 'export async function getRequestBusinessContext(){const s=globalThis.localPlatformFixture;s.calls.push("context");return s.context}',
    'experience-context': 'export const getExperienceContext=context=>({scope:context.scope});',
    'current-context': 'export const isOwnerMembership=member=>member?.owner===true;export const isSalonManageContext=()=>true;',
    'market-experience-data': 'export async function loadMarketExperienceData(){const s=globalThis.localPlatformFixture;s.calls.push("market");return{experienceScope:s.context.scope,paymentsAvailable:false,installationCounts:{a:2}}}',
    '@/app/settings/settings-hub-actions': 'export async function loadSettingsHub(){const s=globalThis.localPlatformFixture;s.calls.push("settings");if(s.hold)await s.hold;if(s.error)throw s.error;return s.index}',
    'customer-activity': 'export async function getCustomerActivity(){const s=globalThis.localPlatformFixture;s.calls.push("activity");return{ok:true,data:{history:s.history}}}export async function getCustomerActivityReceipt(id){const s=globalThis.localPlatformFixture;s.calls.push({receipt:id});return s.receipt?{ok:true,data:s.receipt}:{ok:false,code:"not_found",message:"Not your receipt"}}',
    'customer-bookings': 'export async function getCustomerBookingDetail(id){const s=globalThis.localPlatformFixture;s.calls.push({selectedBooking:id});return s.selectedBooking?{ok:true,data:s.selectedBooking}:{ok:false,code:"not_found",message:"Booking unavailable"}}',
    'staff-portal-identity': 'export async function getStaffPortalIdentity(){const s=globalThis.localPlatformFixture;s.calls.push("portal-identity");return s.identity}',
    'staff-workdays': 'export async function getTodaysStaffWorkday(){const s=globalThis.localPlatformFixture;s.calls.push("legacy-workday");return s.identity}',
    'market-plugins': 'export async function marketPluginContext(){return{salonId:"salon-a"}}',
    'booking-deposit-market': 'export async function bookingDepositPurchaseState(){return{installed:true,paid:true}}',
    'owner-transfer': 'export const listMyOwnerTransferInvites=async()=>[];',
    '@/app/my-place/actions': 'export const getPlaceRequests=async()=>({ok:true,data:[]});',
    'customer-identity-claims': 'export const inspectProfilePhoneClaim=async()=>({ok:true,data:{verifiedByCurrentUser:false}});',
    'permissions': 'export const hasPermission=async()=>true;',
    'services': 'export const SERVICE_PERMISSIONS={view:"services.view"};export const getCurrentSalonServicesWorkspace=async()=>({services:[]});',
    'support-cases': 'export async function supportRpc(name,args){const s=globalThis.localPlatformFixture;s.calls.push({support:name,args});if(name==="get_support_conversation")return s.conversation??null;return s.cases??[]}',
    '@/app/role-navigation': 'export const roleNavigationKindForContext=()=>"customer";',
    '@/app/campaigns/credit-actions': 'export const campaignWalletAction=async()=>({installed:false});',
    'bounded-get': 'export const runReadWithDeadline=promise=>promise;',
    'app-local-role-resources-server': `export class AppLocalRoleReadError extends Error{constructor(status,message){super(message);this.status=status}}export async function readAppLocalRoleResource(name,args,options){const s=globalThis.localPlatformFixture;s.calls.push({name,args,options});return{status:200,data:name==='owner.today'?{total:55}:{tab:args.tab||'upcoming',details:args.details||null,bookings:s.bookings}}}`,
  };
  const result = await build({ entryPoints: ['lib/app-local-platform-resources-server.ts'], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': process.cwd() }, plugins: [{ name: 'platform-authority-fixture', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => { const key = Object.keys(stubs).find(key => key === args.path || args.path.endsWith('/' + key)); return key ? { namespace: 'fixture', path: key } : undefined; });
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'js', contents: stubs[args.path] }));
  } }] });
  const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  return { state, read: api.readAppLocalPlatformResource };
}

test('private page props require the current account scope before any page loader or conditional response', async () => {
  const { state, read } = await fixture();
  assert.equal(await read('unknown.proxy', {}, { scope: 'account-a' }), null);
  await assert.rejects(read('page.settings', {}, { scope: 'other' }), { status: 409 });
  assert.deepEqual(state.calls, ['context']);
  state.calls.length = 0;
  await assert.rejects(read('page.settings', { pin: '1234' }, { scope: 'account-a' }), { status: 400 });
  assert.deepEqual(state.calls, []);
  state.context.user = null;
  await assert.rejects(read('page.settings', {}, { scope: 'account-a' }), { status: 401 });
  assert.ok(!state.calls.includes('settings'));
  const market = await read('page.market', {}, { scope: 'account-a' });
  assert.equal(market.data.paymentsAvailable, false);
});

test('Settings uses exact original profile/index props and freshly validates unchanged reads without caching security DTOs', async () => {
  const { state, read } = await fixture();
  const first = await read('page.settings', {}, { scope: 'account-a' });
  assert.equal(first.data.user, state.context.user); assert.equal(first.data.index, state.index);
  assert.deepEqual(Object.keys(first.data).sort(), ['createdAtLabel', 'index', 'user']);
  const unchanged = await read('page.settings', {}, { scope: 'account-a', etag: first.etag });
  assert.equal(unchanged.status, 304); assert.equal(Object.hasOwn(unchanged, 'data'), false);
  assert.equal(state.calls.filter(call => call === 'context').length, 2); assert.equal(state.calls.filter(call => call === 'settings').length, 2);
  state.error = new Error('Database unavailable');
  await assert.rejects(read('page.settings', {}, { scope: 'account-a', etag: first.etag }), /Database unavailable/);
});

test('past bookings keep the shipped linked-history filtering and receipts preserve server totals', async () => {
  const { state, read } = await fixture();
  const result = await read('page.customer-bookings', { tab: 'past' }, { scope: 'account-a', etag: 'untrusted-role-etag' });
  assert.deepEqual(result.data.historyRows.map(item => item.id), ['mine']);
  assert.equal(state.calls.find(call => call.name === 'customer.bookings').options.etag, undefined);
  const receipt = await read('page.customer-receipt', { ticketId: state.receipt.ticketId }, { scope: 'account-a' });
  assert.equal(receipt.data.receipt, state.receipt); assert.equal(receipt.data.receipt.totals.total, 127.45);
  state.receipt = null;
  await assert.rejects(read('page.customer-receipt', { ticketId: '22222222-2222-4222-8222-222222222222' }, { scope: 'account-a' }), { status: 404 });
});

test('staff identity preserves the workday resolver and never confuses a different viewer with the current account', async () => {
  const { state, read } = await fixture();
  const result = await read('page.staff-identity', { view: 'workday' }, { scope: 'account-a' });
  assert.deepEqual(result.data, { resourceScope: 'resolved-staff', staffId: 'staff-a', salonId: 'staff-salon' });
  assert.ok(state.calls.includes('legacy-workday')); assert.ok(!state.calls.includes('portal-identity'));
  state.identity.context.user.id = 'viewer-b';
  await assert.rejects(read('page.staff-identity', { view: 'my-work' }, { scope: 'account-a' }), { status: 409 });
  assert.ok(!Object.hasOwn(result.data, 'grant'));
});

test('resolved staff scopes and direct booking URLs keep the shipped fallback and selected booking tab semantics', async () => {
  const { state, read } = await fixture();
  const staff = await read('page.staff-identity', { view: 'my-work' }, { scope: 'resolved-staff' });
  assert.equal(staff.scope, 'resolved-staff'); assert.equal(staff.data.staffId, 'staff-a');
  state.identity.context.user.id = 'another-viewer';
  await assert.rejects(read('page.staff-identity', { view: 'my-work' }, { scope: 'resolved-staff' }), { status: 409 });
  state.selectedBooking = { ...state.bookings[0], status: 'cancelled' };
  const booking = await read('page.customer-bookings', { bookingId: state.selectedBooking.id }, { scope: 'account-a' });
  assert.equal(booking.data.tab, 'cancelled');
  const call = state.calls.find(call => call.name === 'customer.bookings');
  assert.deepEqual(call.args, { tab: 'cancelled', details: state.selectedBooking.id });
});

test('a late page read cannot emit private props after its activation is cancelled', async () => {
  const { state, read } = await fixture();
  let release; state.hold = new Promise(resolve => { release = resolve; });
  const controller = new AbortController(), pending = read('page.settings', {}, { scope: 'account-a', signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort(); release();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(state.calls, ['context', 'settings']);
});

test('Support uses only the authenticated existing inbox/conversation RPC and cannot leak an inaccessible case', async () => {
  const { state, read } = await fixture();
  state.cases = [{ id: '33333333-3333-4333-8333-333333333333', summary: 'My own request', reference: 'R1', status: 'open' }];
  const inbox = await read('page.support', {}, { scope: 'account-a' });
  assert.equal(inbox.data.cases, state.cases);
  await assert.rejects(read('page.support-case', { caseId: state.cases[0].id }, { scope: 'account-a' }), { status: 404 });
  state.conversation = { id: state.cases[0].id, messages: [{ body: 'Server-authorized reply' }], can_reply: false };
  const thread = await read('page.support-case', { caseId: state.cases[0].id }, { scope: 'account-a' });
  assert.equal(thread.data.conversation, state.conversation);
  assert.equal(state.calls.filter(call => call.support === 'get_support_conversation').length, 2);
  const calls = state.calls.length;
  await assert.rejects(read('page.support-case', { caseId: state.cases[0].id }, { scope: 'other' }), { status: 409 });
  assert.equal(state.calls.length, calls + 1);
});
