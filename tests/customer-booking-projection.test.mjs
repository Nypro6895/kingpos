import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

test('customer booking loaders use the safe RPC and preserve list/detail/reschedule flows', {
  skip: !process.env.ESBUILD_MODULE_PATH ? 'Set ESBUILD_MODULE_PATH to the installed esbuild entry' : false,
}, async t => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const state = { calls: [], signedIn: true, rows: [], error: null, slots: [] };
  globalThis.customerProjectionFixture = state;
  const client = {
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (name === 'get_customer_booking_rows') return { data: state.rows, error: state.error };
      if (name === 'get_booking_history_evidence') return { data: [], error: null };
      if (['reschedule_customer_booking', 'cancel_customer_booking', 'claim_guest_booking_by_manage_token'].includes(name)) return { data: { ok: true, booking_id: state.rows[0]?.id }, error: null };
      throw Error('Unexpected RPC ' + name);
    },
    from(table) {
      assert.ok(['salon_settings','staff','services','booking_inspirations'].includes(table), 'Private base-table loader attempted: ' + table);
      const query = { select() { return this; }, in() { return this; }, async returns() { return { data: [], error: null }; } };
      return query;
    },
  };
  state.client = client;
  const stubs = {
    'server-only': '',
    '@/lib/supabase/server': 'export const createAuthenticatedSupabaseServerClient=async()=>globalThis.customerProjectionFixture.signedIn?globalThis.customerProjectionFixture.client:null;export const createSupabaseServerClient=()=>null;',
    '@/lib/users/current-user': 'export const getCurrentKingUser=async()=>globalThis.customerProjectionFixture.signedIn?{id:"customer-a"}:null;',
    '@/lib/bookings': 'export const formatDateInTimeZone=d=>d.toISOString().slice(0,10);',
    '@/lib/booking-inspirations': 'export const BOOKING_INSPIRATION_SELECT="id";export const mapBookingInspirationsByBookingId=()=>new Map();',
    '@/lib/booking-domain/customer-identity': 'export const normalizeBookingEmail=v=>v;export const normalizeBookingPhone=v=>v;',
    '@/lib/public-booking': 'export const loadPublicBookingRescheduleSlots=async(input)=>{globalThis.customerProjectionFixture.selection=input;return globalThis.customerProjectionFixture.slots;};',
    '@/lib/salon-profile': 'export const getSalonProfileMediaUrl=()=>null;',
    '@/lib/staff-profile': 'export const getStaffProfileAvatarUrl=()=>null;',
  };
  const compiled = await build({ entryPoints: ['lib/customer-bookings.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'isolated-data', setup(b) {
    b.onResolve({ filter: /^server-only$|^@\// }, args => {
      assert.ok(args.path in stubs, 'Unmocked dependency: ' + args.path);
      return { path: args.path, namespace: 'fixture' };
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path] }));
  } }] });
  const api = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const row = { id: uuid(1), salon_id: uuid(2), start_at: '2099-10-01T15:00:00.000Z', end_at: '2099-10-01T16:00:00.000Z', status: 'confirmed', salon_timezone_snapshot: 'America/Chicago', public_notes: 'Customer visible',
    customer: { id: uuid(3), name: 'Fixture', phone: null, email: 'fixture@example.invalid' }, salon: { id: uuid(2), name: 'Drayko' },
    lines: [{ id: uuid(4), line_type: 'service', service_id: uuid(5), assigned_staff_id: uuid(6), display_order: 0, created_at: '2099-10-01', service_name_snapshot: 'Cut' }] };
  state.rows = [row];
  try {
    await t.test('signed-out access fails before querying', async () => {
      state.signedIn = false;
      assert.equal((await api.listCustomerBookings()).code, 'sign_in_required');
      assert.equal((await api.getCustomerBookingDetail(row.id)).code, 'sign_in_required');
      assert.equal(state.calls.length, 0); state.signedIn = true;
    });
    await t.test('list forwards filters and hydrates safe data without private tables', async () => {
      const result = await api.listCustomerBookings({ scope: 'past', cursorStartAt: '2099-11-01T00:00:00Z', limit: 100 });
      assert.equal(result.ok, true); assert.equal(result.data[0].id, row.id); assert.equal(result.data[0].lines[0].service_name_snapshot, 'Cut');
      assert.deepEqual(state.calls[0], { name: 'get_customer_booking_rows', args: { p_scope: 'past', p_cursor_start_at: '2099-11-01T00:00:00Z', p_limit: 50 } });
      assert.equal('internal_notes' in result.data[0], false);
    });
    await t.test('detail uses only booking ID; missing or foreign rows remain not found', async () => {
      state.calls = [];
      assert.equal((await api.getCustomerBookingDetail(row.id)).data.id, row.id);
      assert.deepEqual(state.calls[0], { name: 'get_customer_booking_rows', args: { p_booking_id: row.id, p_limit: 1 } });
      state.rows = []; assert.equal((await api.getCustomerBookingDetail(uuid(9))).data, null); state.rows = [row];
    });
    await t.test('RPC errors remain errors without falling back to private table reads', async () => {
      state.error = { code: '42501' };
      assert.equal((await api.listCustomerBookings()).ok, false);
      assert.equal((await api.getCustomerBookingDetail(row.id)).code, '42501'); state.error = null;
    });
    await t.test('safe projected lines still support availability and rescheduling', async () => {
      state.slots = [{ startAt: '2099-10-02T15:00:00.000Z' }];
      const slots = await api.loadCustomerRescheduleSlots({ bookingId: row.id, date: '2099-10-02' });
      assert.equal(slots.ok, true); assert.deepEqual(state.selection.selection.serviceIds, [uuid(5)]);
      const changed = await api.requestRescheduleCustomerBooking({ bookingId: row.id, startAt: state.slots[0].startAt });
      assert.equal(changed.ok, true); assert.equal(state.calls.at(-1).name, 'reschedule_customer_booking');
      assert.equal((await api.requestCancelCustomerBooking({ bookingId: row.id })).ok, true);
    });
    await t.test('Beauty counts consume the private aggregate without reading base bookings', async () => {
      const source = readFileSync('lib/beauty.ts','utf8');
      const body = source.slice(source.indexOf('async function loadBeautyBookVerifiedCountsBySalon('), source.indexOf('async function attachBeautyBookingActions('));
      const built = await build({ stdin: { contents: 'const cleanUuid=v=>v;\n' + body + '\nexport {loadBeautyBookVerifiedCountsBySalon};', loader: 'ts' }, write: false, platform: 'node', format: 'esm' });
      const { loadBeautyBookVerifiedCountsBySalon } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
      const counts = await loadBeautyBookVerifiedCountsBySalon({ salonIds: [uuid(2),uuid(2)], userId: 'customer-a', supabase: { async rpc(name,args) {
        assert.equal(name,'get_customer_verified_booking_counts'); assert.deepEqual(args,{p_salon_ids:[uuid(2)]});
        return {data:[{salon_id:uuid(2),booking_count:2}],error:null};
      } } });
      assert.equal(counts.get(uuid(2)),2);
    });
  } finally { delete globalThis.customerProjectionFixture; }
});
