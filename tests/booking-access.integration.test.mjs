import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { startIsolatedSupabase } from './helpers/isolated-supabase-fixture.mjs';

test('booking authorization through isolated Auth, PostgREST and actual repository RLS', {
  skip: process.env.RUN_ISOLATED_SUPABASE !== '1' ? 'Set RUN_ISOLATED_SUPABASE=1; requires cached Supabase Docker images' : false,
  timeout: 900000,
}, async t => {
  const f = await startIsolatedSupabase('booking-access');
  t.after(() => f.close());
  const report = { startedAt: new Date().toISOString(), transport: 'Auth-issued user JWTs through PostgREST; no service-role client', testSourceSha256: crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'), cases: [] };
  async function check(name, run) {
    await t.test(name, async () => {
      try { await run(); report.cases.push({ name, result: 'passed' }); }
      catch (error) { report.cases.push({ name, result: 'failed', message: f.redact(error.message) }); throw error; }
      finally { f.save('booking-access-results.json', report); }
    });
  }
  const ownerA = f.person('owner-a'), ownerB = f.person('owner-b');
  const customerA = f.person('customer-a'), customerB = f.person('customer-b');
  const staffA = f.person('staff-a'), staffB = f.person('staff-b'), otherStaffA = f.person('unassigned-a');
  function salon(owner, staffUser, suffix) {
    const account = f.rpc(owner, 'ensure_personal_account_for_current_user', { p_account_name: `Drayko ${suffix} fixture` })[0].account_id;
    const id = f.rpc(owner, 'create_account_salon_with_owner_staff', { p_account_id: account, p_create_request_key: crypto.randomUUID(),
      p_name: `Drayko ${suffix}`, p_owner_is_staff: false, p_phone: null, p_address_line1: null, p_address_line2: null, p_city: null, p_state: null, p_postal_code: null, p_country: 'US' }).salon_id;
    const staff = f.rest(owner, '/staff', 'POST', { salon_id: id, account_user_id: staffUser.profileId, display_name: `Staff ${suffix}`, first_name: 'Fixture', last_name: suffix, is_active: true })[0].id;
    const service = f.rest(owner, '/services', 'POST', { salon_id: id, name: `Service ${suffix}`, duration_minutes: 45, base_price: 20, is_active: true })[0].id;
    f.rest(owner, '/staff_service_assignments', 'POST', { salon_id: id, staff_id: staff, service_id: service, is_active: true });
    f.rest(owner, '/staff_availability_rules', 'POST', Array.from({ length: 7 }, (_, day) => ({ salon_id: id, staff_id: staff,
      rule_type: 'working', day_of_week: day, starts_at_local: '08:00', ends_at_local: '18:00', is_active: true })));
    f.rest(owner, `/booking_settings?salon_id=eq.${id}`, 'PATCH', { booking_enabled: true, online_booking_visible: true,
      confirmation_mode: 'request_confirmation', timezone_iana: 'America/Chicago', default_cleanup_buffer_minutes: 15,
      minimum_lead_time_minutes: 120, maximum_advance_window_days: 60, slot_interval_minutes: 15, guest_booking_enabled: true,
      confirmation_email_enabled: false, confirmation_sms_enabled: false, reminder_enabled: false });
    return { id, account, staff, service, owner };
  }
  const a = salon(ownerA, staffA, 'A'), b = salon(ownerB, staffB, 'B');
  const unassigned = f.rest(ownerA, '/staff', 'POST', { salon_id: a.id, account_user_id: otherStaffA.profileId, display_name: 'Other A', is_active: true })[0].id;
  assert.ok(unassigned);
  const base = f.sql("select ((((now() at time zone 'America/Chicago')::date+5)+time '09:00') at time zone 'America/Chicago')::text");
  const at = minutes => new Date(+new Date(base) + minutes * 60000).toISOString();
  const args = (s, who, minute, key = crypto.randomUUID()) => ({ p_salon_id: s.id, p_customer_first_name: 'Fixture', p_customer_last_name: who?.kind || 'Guest',
    p_customer_phone: null, p_customer_email: who?.email || 'guest@example.invalid', p_start_at: at(minute), p_end_at: at(minute + 60),
    p_lines: [{ service_id: s.service, assigned_staff_id: s.staff, scheduled_start_at: at(minute), scheduled_end_at: at(minute + 60), cleanup_buffer_minutes: 15, display_order: 0 }],
    p_idempotency_key: key });
  const aKey = crypto.randomUUID(), aArgs = args(a, customerA, 0, aKey);
  const ba = f.rpc(customerA, 'create_public_booking', aArgs), bb = f.rpc(customerB, 'create_public_booking', args(b, customerB, 0));
  const ga = f.rpc(null, 'create_public_booking', args(a, null, 180)), gb = f.rpc(null, 'create_public_booking', args(b, null, 180));
  for (const result of [ba, bb, ga, gb]) { assert.equal(result.ok, true); assert.ok(result.booking_id); assert.ok(result.manage_token); }
  const id = ba.booking_id, otherId = bb.booking_id;
  const header = () => f.rest(ownerA, `/bookings?id=eq.${id}&select=id,salon_id,customer_user_id,status,start_at,public_notes`)[0];
  const denied = r => r.status >= 400 || r.data?.ok === false || Array.isArray(r.data) && r.data.length === 0;
  const call = (user, name, body) => f.http(3000, `/rpc/${name}`, 'POST', body, user?.token);
  f.sql(`alter table bookings add column fixture_future_private_note text default 'FUTURE_PRIVATE_SENTINEL';
    update bookings set internal_notes='OWNER_ONLY_SENTINEL',deposit_policy_snapshot='{"test":true,"amount_cents":1234,"internal_notes":"PRIVATE_DEPOSIT_SENTINEL"}' where id='${id}';
    update booking_lines set internal_staff_note='STAFF_ONLY_SENTINEL' where booking_id='${id}';
    update customers set internal_notes='CUSTOMER_INTERNAL_SENTINEL',staff_notes='CUSTOMER_STAFF_SENTINEL' where id=(select customer_id from bookings where id='${id}');`);
  f.save('booking-access-schema.json', {
    policies: f.json("select coalesce(json_agg(p),'[]') from (select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename in ('bookings','booking_lines','customers','booking_status_events','booking_customer_account_claims','booking_inspirations','customer_history_links'))p"),
    functions: f.json("select coalesce(json_agg(p),'[]') from (select proname,proacl::text,prosecdef,proconfig,pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and proname in ('create_public_booking','create_public_booking_without_deposit','claim_guest_booking_by_manage_token','current_user_can_read_booking','cancel_customer_booking','reschedule_customer_booking','get_public_booking_by_manage_token','get_public_booking_context','confirm_assigned_booking','get_customer_booking_rows','get_customer_verified_booking_counts','current_user_owns_booking'))p"),
  });
  for (const [name, user, allowed] of [['customer A', customerA, false], ['customer B', customerB, false], ['owner A', ownerA, true], ['owner B', ownerB, false],
    ['assigned staff A', staffA, true], ['unassigned staff A', otherStaffA, false], ['staff B', staffB, false], ['anonymous', null, false]]) {
    await check(`${name}: booking and line reads follow participant/salon boundary`, () => {
      for (const table of ['bookings', 'booking_lines']) {
        const r = f.http(3000, `/${table}?${table === 'bookings' ? 'id' : 'booking_id'}=eq.${id}&select=id`, 'GET', undefined, user?.token);
        if (allowed) { assert.equal(r.status, 200); assert.equal(r.data.length, 1); }
        else assert.ok(r.status >= 400 || r.data.length === 0, `${table} exposes another participant's row`);
      }
    });
  }
  for (const [name, user] of [['customer A', customerA], ['customer B', customerB], ['owner B', ownerB], ['assigned staff A', staffA], ['unassigned staff A', otherStaffA], ['staff B', staffB], ['anonymous', null]]) {
    await check(`${name}: direct booking ownership/status changes are denied`, () => {
      const before = header();
      const r = f.http(3000, `/bookings?id=eq.${id}`, 'PATCH', { customer_user_id: customerB.profileId, status: 'cancelled' }, user?.token, ['Prefer: return=representation']);
      assert.ok(denied(r)); assert.deepEqual(header(), before);
    });
  }
  await check('owner A can edit its booking; owner B cannot move it between salons', () => {
    assert.equal(f.rest(ownerA, `/bookings?id=eq.${id}`, 'PATCH', { public_notes: 'Owner edit fixture' }).length, 1);
    const r = f.http(3000, `/bookings?id=eq.${id}`, 'PATCH', { salon_id: b.id }, ownerB.token, ['Prefer: return=representation']);
    assert.ok(denied(r)); assert.equal(header().salon_id, a.id);
  });
  for (const [name, user] of [['customer B', customerB], ['owner B', ownerB], ['staff B', staffB], ['anonymous', null]]) {
    await check(`${name}: customer reschedule/cancel RPC cannot mutate customer A`, () => {
      const before = header();
      assert.ok(denied(call(user, 'reschedule_customer_booking', { p_booking_id: id, p_start_at: at(60) })));
      assert.ok(denied(call(user, 'cancel_customer_booking', { p_booking_id: id, p_reason: 'Unauthorized fixture attempt' })));
      assert.deepEqual(header(), before);
    });
  }
  await check('assigned staff can confirm its appointment; other staff and other owner cannot', () => {
    for (const user of [staffB, otherStaffA, ownerB, customerB, null]) assert.ok(denied(call(user, 'confirm_assigned_booking', { p_booking_id: id })));
    assert.equal(f.rpc(staffA, 'confirm_assigned_booking', { p_booking_id: id }).ok, true);
    assert.equal(header().status, 'confirmed');
  });
  await check('public availability contains no customer contact or internal notes', () => {
    const data = f.rpc(null, 'get_public_booking_context', { target_salon_id: a.id, p_range_start: at(0), p_range_end: at(600) });
    const encoded = JSON.stringify(data);
    for (const sentinel of [customerA.email, 'OWNER_ONLY_SENTINEL', 'STAFF_ONLY_SENTINEL', ba.manage_token]) assert.equal(encoded.includes(sentinel), false);
  });
  await check('invalid/empty/random management tokens expose no booking and cannot mutate', () => {
    for (const token of ['', 'invalid', 'f'.repeat(64), null]) {
      const read = f.rpc(null, 'get_public_booking_by_manage_token', { raw_token: token });
      assert.ok(read === null || read.ok === false);
      assert.ok(denied(call(null, 'cancel_public_booking_by_manage_token', { raw_token: token })));
      assert.ok(denied(call(null, 'reschedule_public_booking_by_manage_token', { raw_token: token, p_start_at: at(300) })));
    }
  });
  await check('valid guest capability exposes only its booking and excludes staff-only fields', () => {
    const data = f.rpc(null, 'get_public_booking_by_manage_token', { raw_token: ga.manage_token });
    assert.equal(data.booking.id, ga.booking_id); assert.equal(data.booking.salon_id, a.id);
    assert.equal(JSON.stringify(data).includes(otherId), false); assert.equal(JSON.stringify(data).includes(customerB.email), false);
    assert.equal('internal_notes' in data.booking, false); assert.ok(data.lines.every(line => !('internal_staff_note' in line)));
  });
  await check('guest capability changes only its own booking across reschedule and cancel', () => {
    const bBefore = f.rest(ownerB, `/bookings?id=eq.${gb.booking_id}&select=id,start_at,status`)[0];
    assert.equal(f.rpc(null, 'reschedule_public_booking_by_manage_token', { raw_token: ga.manage_token, p_start_at: at(240) }).ok, true);
    assert.equal(f.rpc(null, 'cancel_public_booking_by_manage_token', { raw_token: ga.manage_token }).ok, true);
    assert.deepEqual(f.rest(ownerB, `/bookings?id=eq.${gb.booking_id}&select=id,start_at,status`)[0], bBefore);
  });
  await check('customer B cannot claim an already-linked booking using its capability', () => {
    assert.ok(denied(call(customerB, 'claim_guest_booking_by_manage_token', { raw_token: ba.manage_token })));
    assert.equal(header().customer_user_id, customerA.profileId);
  });
  await check('cross-salon service or staff injection is rejected atomically', () => {
    for (const field of ['service_id', 'assigned_staff_id']) {
      const input = args(a, customerB, 420); input.p_lines[0][field] = field === 'service_id' ? b.service : b.staff;
      assert.ok(denied(call(customerB, 'create_public_booking', input)), `Cross-salon ${field} accepted`);
      assert.equal(f.rest(ownerA, `/bookings?salon_id=eq.${a.id}&idempotency_key=eq.${input.p_idempotency_key}&select=id`).length, 0);
    }
  });
  await check('private creation helper cannot bypass wrapper/deposit guards', () => {
    for (const user of [customerB, null]) assert.ok(denied(call(user, 'create_public_booking_without_deposit', args(a, customerB, 420))));
  });
  await check('history RPC rejects another customer and another salon owner', () => {
    for (const user of [customerB, ownerB, null]) assert.ok(denied(call(user, 'get_booking_history_evidence', { p_bookings: [id] })));
    const own = f.rpc(customerA, 'get_booking_history_evidence', { p_bookings: [id] }); assert.equal(own[0].bookingId, id);
  });
  await check('same customer retry remains idempotent', () => {
    const retry = f.rpc(customerA, 'create_public_booking', aArgs); assert.equal(retry.booking_id, id); assert.equal(retry.duplicate, true);
  });
  await check('another customer cannot recover management capability by replaying an idempotency key', () => {
    const r = call(customerB, 'create_public_booking', { ...aArgs, p_customer_email: customerB.email });
    assert.ok(denied(r), 'Cross-customer idempotency replay returned a successful booking');
    assert.equal(Boolean(r.data?.manage_token), false, 'Cross-customer replay exposed management capability');
  });
  await check('anonymous replay cannot recover a signed-in customer management capability', () => {
    const r = call(null, 'create_public_booking', aArgs);
    assert.ok(denied(r), 'Anonymous replay returned a signed-in customer booking');
    assert.equal(Boolean(r.data?.manage_token), false);
  });
  await check('customer cannot read owner-only booking notes through direct REST', () => {
    const r = f.http(3000, `/bookings?id=eq.${id}&select=internal_notes`, 'GET', undefined, customerA.token);
    assert.equal(JSON.stringify(r.data).includes('OWNER_ONLY_SENTINEL'), false, 'Customer can read internal booking notes');
  });
  await check('customer cannot read internal staff line notes through direct REST', () => {
    const r = f.http(3000, `/booking_lines?booking_id=eq.${id}&select=internal_staff_note`, 'GET', undefined, customerA.token);
    assert.equal(JSON.stringify(r.data).includes('STAFF_ONLY_SENTINEL'), false, 'Customer can read internal staff notes');
  });
  await check('customer cannot read internal customer-record notes through direct REST', () => {
    const r = f.http(3000, '/customers?customer_user_id=eq.' + customerA.profileId + '&select=internal_notes,staff_notes', 'GET', undefined, customerA.token);
    assert.equal(JSON.stringify(r.data).includes('CUSTOMER_INTERNAL_SENTINEL'), false, 'Customer can read internal customer notes');
    assert.equal(JSON.stringify(r.data).includes('CUSTOMER_STAFF_SENTINEL'), false, 'Customer can read staff customer notes');
  });
  for (const [name, user, own] of [['customer A', customerA, true], ['customer B', customerB, false], ['owner A', ownerA, false], ['owner B', ownerB, false],
    ['assigned staff A', staffA, false], ['unassigned staff A', otherStaffA, false], ['staff B', staffB, false], ['anonymous', null, false]]) {
    await check(name + ': customer projection only returns the signed-in customer booking', () => {
      const r = call(user, 'get_customer_booking_rows', { p_booking_id: id });
      if (own) { assert.equal(r.status, 200); assert.equal(r.data.length, 1); assert.equal(r.data[0].id, id); }
      else assert.ok(denied(r));
    });
  }
  await check('customer projection contains only approved fields and retains service/contact detail', () => {
    const row = f.rpc(customerA, 'get_customer_booking_rows', { p_booking_id: id })[0];
    assert.equal(row.customer.email, customerA.email); assert.equal(row.salon.id, a.id);
    assert.equal(row.lines[0].service_id, a.service); assert.equal(row.lines[0].assigned_staff_id, a.staff);
    assert.equal(row.public_notes, 'Owner edit fixture');
    assert.equal(row.deposit_policy_snapshot.test, true); assert.equal(row.deposit_policy_snapshot.amount_cents, 1234);
    assert.equal(row.deposit_paid_cents, 0); assert.equal('internal_notes' in row.deposit_policy_snapshot, false);
    for (const key of ['internal_notes','notes','customer_cancellation_token_hash','idempotency_key','customer_account_link_metadata','created_by_user_id']) assert.equal(key in row, false, key);
    for (const key of ['internal_staff_note','overbooking_override_reason','overbooking_override_by_user_id','line_status_updated_by_user_id']) assert.equal(key in row.lines[0], false, key);
    assert.deepEqual(Object.keys(row.customer).sort(), ['email','id','name','phone']);
    for (const secret of ['OWNER_ONLY_SENTINEL','STAFF_ONLY_SENTINEL','CUSTOMER_INTERNAL_SENTINEL','CUSTOMER_STAFF_SENTINEL','FUTURE_PRIVATE_SENTINEL','PRIVATE_DEPOSIT_SENTINEL',ba.manage_token,aKey]) assert.equal(JSON.stringify(row).includes(secret), false);
  });
  await check('wildcard and relationship REST queries cannot bypass customer privacy', () => {
    for (const url of ['/bookings?id=eq.' + id + '&select=*,booking_lines(*),customers(*)', '/booking_lines?booking_id=eq.' + id + '&select=*,bookings(*)', '/customers?customer_user_id=eq.' + customerA.profileId + '&select=*,bookings(*)']) {
      const r = f.http(3000, url, 'GET', undefined, customerA.token); assert.ok(denied(r));
    }
  });
  await check('owner and assigned staff retain their established internal-note reads', () => {
    for (const user of [ownerA, staffA]) {
      assert.equal(f.rest(user, '/bookings?id=eq.' + id + '&select=internal_notes')[0].internal_notes, 'OWNER_ONLY_SENTINEL');
      assert.equal(f.rest(user, '/booking_lines?booking_id=eq.' + id + '&select=internal_staff_note')[0].internal_staff_note, 'STAFF_ONLY_SENTINEL');
    }
    assert.equal(f.rest(ownerA, '/customers?customer_user_id=eq.' + customerA.profileId + '&select=internal_notes')[0].internal_notes, 'CUSTOMER_INTERNAL_SENTINEL');
  });
  await check('customer list scope, cursor, limit and missing IDs preserve behavior', () => {
    assert.deepEqual(f.rpc(customerA, 'get_customer_booking_rows', { p_scope: 'upcoming' }).map(x => x.id), [id]);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_scope: 'past' }).length, 0);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_scope: 'cancelled' }).length, 0);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_cursor_start_at: at(500) }).length, 0);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_booking_id: crypto.randomUUID() }).length, 0);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_limit: 0 }).length, 1);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_booking_id: id, p_scope: 'past' })[0].id, id);
    assert.ok(denied(call(customerA, 'get_customer_booking_rows', { p_scope: 'anything' })));
    assert.ok(denied(call(customerB, 'get_customer_booking_rows', { p_customer_user_id: customerA.profileId })));
  });
  await check('verified Beauty counts are private to the authenticated customer', () => {
    assert.deepEqual(f.rpc(customerA, 'get_customer_verified_booking_counts', { p_salon_ids: [a.id,b.id] }), [{ salon_id: a.id, booking_count: 1 }]);
    assert.equal(f.rpc(customerB, 'get_customer_verified_booking_counts', { p_salon_ids: [a.id] }).length, 0);
    assert.ok(denied(call(null, 'get_customer_verified_booking_counts', { p_salon_ids: [a.id] })));
  });
  await check('booking inspiration ownership survives base-table privacy restrictions', () => {
    const inspiration = f.rest(ownerA, '/booking_inspirations', 'POST', { salon_id: a.id, booking_id: id, source_salon_id: a.id, source_title_snapshot: 'Fixture inspiration' })[0];
    assert.equal(f.rest(customerA, '/booking_inspirations?id=eq.' + inspiration.id + '&select=id')[0].id, inspiration.id);
    for (const user of [customerB,ownerB]) assert.equal(f.rest(user, '/booking_inspirations?id=eq.' + inspiration.id + '&select=id').length, 0);
    assert.equal(f.rpc(customerA, 'current_user_owns_booking', { p_booking_id: id, p_salon_id: b.id }), false);
  });
  await check('privacy migration is repeatable without changing grants or unrelated RPC bodies', () => {
    const query = "select json_agg(p order by proname) from (select proname,pg_get_functiondef(oid) as definition,proacl::text,proowner::regrole::text,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('get_customer_booking_rows','get_customer_verified_booking_counts','current_user_owns_booking','create_public_booking','cancel_customer_booking','reschedule_customer_booking'))p";
    const before = f.json(query), migration = fs.readFileSync('supabase/migrations/20261015163000_customer_booking_privacy.sql','utf8');
    f.sql(migration); f.sql(migration); assert.deepEqual(f.json(query), before);
  });
  await check('guest retries and identical keys in different salons retain existing scope', () => {
    const input = args(a, null, 360);
    const first = f.rpc(null, 'create_public_booking', input), repeat = f.rpc(null, 'create_public_booking', input);
    assert.equal(first.booking_id, repeat.booking_id); assert.equal(repeat.duplicate, true);
    const separate = f.rpc(customerB, 'create_public_booking', args(b, customerB, 360, aKey));
    assert.equal(separate.ok, true); assert.notEqual(separate.booking_id, id);
  });
  await check('access guard reapplication preserves function body, owner, grants and configuration', () => {
    const query = "select row_to_json(p) from (select pg_get_functiondef(oid) as definition,proowner::regrole::text as owner,proacl::text as acl,prosecdef,proconfig from pg_proc where oid=to_regprocedure('public.create_public_booking_without_deposit(uuid,text,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text)'))p";
    const before = f.json(query);
    assert.match(before.definition, /booking-idempotency-account-ownership/);
    const migration = fs.readFileSync('supabase/migrations/20261015050000_booking_access_guards.sql', 'utf8');
    f.sql(migration); f.sql(migration);
    assert.deepEqual(f.json(query), before);
  });
  await check('customer A can reschedule/cancel own booking without mutating salon B', () => {
    const before = f.rest(ownerB, `/bookings?id=eq.${otherId}&select=id,start_at,status`)[0];
    assert.equal(f.rpc(customerA, 'reschedule_customer_booking', { p_booking_id: id, p_start_at: at(60) }).ok, true);
    assert.equal(+new Date(f.rpc(customerA, 'get_customer_booking_rows', { p_booking_id: id })[0].start_at), +new Date(at(60)));
    assert.equal(f.rpc(customerA, 'cancel_customer_booking', { p_booking_id: id }).ok, true);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_scope: 'cancelled' })[0].id, id);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_scope: 'upcoming' }).length, 0);
    assert.deepEqual(f.rest(ownerB, `/bookings?id=eq.${otherId}&select=id,start_at,status`)[0], before);
  });
  await check('history association remains visible to its customer and salon owner only', () => {
    const customerId = f.sql("select customer_id from bookings where id='" + id + "'");
    const visitId = f.sql("with inserted as (insert into customer_visits(salon_id,customer_id,source,status) values ('" + a.id + "','" + customerId + "','walk_in','completed') returning id) select id from inserted");
    const linkId = f.sql("with inserted as (insert into customer_history_links(salon_id,booking_id,visit_id) values ('" + a.id + "','" + id + "','" + visitId + "') returning id) select id from inserted");
    for (const user of [customerA,ownerA]) assert.equal(f.rest(user, '/customer_history_links?id=eq.' + linkId + '&select=id')[0].id, linkId);
    for (const user of [customerB,ownerB]) assert.equal(f.rest(user, '/customer_history_links?id=eq.' + linkId + '&select=id').length, 0);
  });
  await check('a salon owner booking as a customer retains employee access and safe customer projection', () => {
    const result = f.rpc(ownerA, 'create_public_booking', args(a, ownerA, 480)); assert.equal(result.ok, true);
    f.sql("update bookings set internal_notes='DUAL_ROLE_SENTINEL' where id='" + result.booking_id + "'");
    assert.equal(f.rest(ownerA, '/bookings?id=eq.' + result.booking_id + '&select=internal_notes')[0].internal_notes, 'DUAL_ROLE_SENTINEL');
    const rows = f.rpc(ownerA, 'get_customer_booking_rows', { p_booking_id: result.booking_id });
    assert.equal(rows[0].id, result.booking_id); assert.equal(JSON.stringify(rows).includes('DUAL_ROLE_SENTINEL'), false);
  });
  await check('claiming a guest booking preserves safe account reads and customer management across salons', () => {
    assert.equal(f.rpc(customerA, 'claim_guest_booking_by_manage_token', { raw_token: gb.manage_token }).ok, true);
    assert.equal(f.rpc(customerA, 'claim_guest_booking_by_manage_token', { raw_token: gb.manage_token }).idempotent, true);
    const claimed = f.rpc(customerA, 'get_customer_booking_rows', { p_booking_id: gb.booking_id });
    assert.equal(claimed[0].id, gb.booking_id); assert.equal(claimed[0].salon_id, b.id);
    assert.equal('internal_notes' in claimed[0], false); assert.equal('customer_cancellation_token_hash' in claimed[0], false);
    assert.equal(f.rest(customerA, '/bookings?id=eq.' + gb.booking_id + '&select=*').length, 0);
    assert.equal(f.rpc(customerB, 'get_customer_booking_rows', { p_booking_id: gb.booking_id }).length, 0);
    assert.ok(denied(call(customerB, 'claim_guest_booking_by_manage_token', { raw_token: gb.manage_token })));
    assert.equal(f.rpc(customerA, 'reschedule_customer_booking', { p_booking_id: gb.booking_id, p_start_at: at(240) }).ok, true);
    assert.equal(f.rpc(customerA, 'cancel_customer_booking', { p_booking_id: gb.booking_id }).ok, true);
    assert.equal(f.rpc(customerA, 'get_customer_booking_rows', { p_booking_id: gb.booking_id })[0].status, 'cancelled');
  });
  await check('deactivating staff revokes booking read access', () => {
    f.rest(ownerB, `/staff?id=eq.${b.staff}`, 'PATCH', { is_active: false });
    assert.equal(f.rest(staffB, `/bookings?id=eq.${otherId}&select=id`).length, 0);
  });
  report.finishedAt = new Date().toISOString(); report.passed = report.cases.every(c => c.result === 'passed');
  f.save('booking-access-results.json', report);
});
