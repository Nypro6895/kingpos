import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { startIsolatedSupabase } from './helpers/isolated-supabase-fixture.mjs';

const migration = '202611170001_staff_selected_customer_identity.sql';
const read = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('Staff selected-customer identity uses the validated snapshot and canonical remap without weakening guards', {
  skip: process.env.RUN_ISOLATED_SUPABASE !== '1', timeout: 900_000,
}, async t => {
  const source = process.cwd();
  const output = process.env.BOOKING_TEST_OUTPUT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'staff-selected-identity-'));
  fs.mkdirSync(output, { recursive: true });
  // Replay the entire real predecessor chain, rather than replacing the phone
  // resolver or scheduling command with a test double. Keep this SQL-only copy
  // as test evidence; it is not another checkout or the running QA database.
  const predecessor = fs.mkdtempSync(path.join(output, 'predecessor-'));
  const directory = path.join(predecessor, 'supabase/migrations');
  fs.mkdirSync(directory, { recursive: true });
  const files = fs.readdirSync(path.join(source, 'supabase/migrations')).filter(n => n.endsWith('.sql')).sort();
  for (const file of files.filter(n => n < migration)) fs.copyFileSync(path.join(source, 'supabase/migrations', file), path.join(directory, file));
  let f;
  try {
    process.chdir(predecessor);
    f = await startIsolatedSupabase('staff-selected-identity', JSON.parse(process.env.TEST_SUPABASE_IMAGES || '{}'), { allowConcurrentFixtureCleanup: true });
  } finally { process.chdir(source); }
  t.after(() => f.close());

  const owner = f.person('staff-identity-owner'), staffUser = f.person('staff-identity-staff');
  const accountUser = f.person('staff-identity-customer'), secondUser = f.person('staff-identity-other-customer');
  const outsider = f.person('staff-identity-outsider');
  const account = f.rpc(owner, 'ensure_personal_account_for_current_user', { p_account_name: 'Synthetic Staff identity tests' })[0].account_id;
  const salon = f.rpc(owner, 'create_account_salon_with_owner_staff', { p_account_id: account, p_create_request_key: crypto.randomUUID(),
    p_name: 'Synthetic Staff identity salon', p_owner_is_staff: false, p_phone: null, p_address_line1: null, p_address_line2: null,
    p_city: null, p_state: null, p_postal_code: null, p_country: 'US' }).salon_id;
  const otherAccount = f.rpc(outsider, 'ensure_personal_account_for_current_user', { p_account_name: 'Synthetic other salon' })[0].account_id;
  const otherSalon = f.rpc(outsider, 'create_account_salon_with_owner_staff', { p_account_id: otherAccount, p_create_request_key: crypto.randomUUID(),
    p_name: 'Synthetic other Staff salon', p_owner_is_staff: true, p_phone: null, p_address_line1: null, p_address_line2: null,
    p_city: null, p_state: null, p_postal_code: null, p_country: 'US' }).salon_id;
  const staffId = crypto.randomUUID(), service = crypto.randomUUID();
  f.sql(`insert into salon_memberships(account_id,salon_id,user_id,role_id,status)
    select '${account}','${salon}','${staffUser.profileId}',id,'active' from roles where account_id='${account}' and code='STAFF';
    insert into staff(id,salon_id,user_id,account_user_id,display_name,is_active,pos_enabled,online_booking_enabled)
    values('${staffId}','${salon}','${staffUser.profileId}','${staffUser.profileId}','Synthetic professional',true,true,true);
    insert into services(id,salon_id,name,category,base_price,duration_minutes,online_booking_enabled)
    values('${service}','${salon}','Synthetic manicure','Nails',50,30,true);
    insert into staff_service_assignments(salon_id,staff_id,service_id,is_active,online_bookable)
    values('${salon}','${staffId}','${service}',true,true);
    update booking_settings set booking_enabled=true,online_booking_visible=true,payment_required_enabled=false,
      deposit_required_enabled=false,timezone_iana='America/Chicago' where salon_id='${salon}';
    insert into salon_operating_hours(salon_id,day_of_week,opens_at_local,closes_at_local,is_active)
    select '${salon}',d,'08:00','20:00',true from generate_series(0,6)d;
    insert into staff_availability_rules(salon_id,staff_id,rule_type,day_of_week,starts_at_local,ends_at_local,timezone_iana,is_active)
    select '${salon}','${staffId}','working',d,'08:00','20:00','America/Chicago',true from generate_series(0,6)d;`);
  assert.equal(f.rpc(staffUser, 'staff_booking_creation_catalog', { p_salon: salon }).staffId, staffId);
  const date = offset => { const value = new Date(); value.setUTCDate(value.getUTCDate() + 7 + offset); return value.toISOString().slice(0, 10); };
  const payload = (name, phone, selected, day = 0) => ({ key: crypto.randomUUID(), name, phone,
    customerId: selected, staffId, serviceIds: [service], startLocal: `${date(day)}T14:00`, note: 'Synthetic identity regression' });
  const create = (input, actor = staffUser, targetSalon = salon) => f.rpc(actor, 'create_staff_appointment', { p_salon: targetSalon, p_input: input });
  const addCustomer = (name, phone, linked = null, targetSalon = salon, extra = '') => {
    const id = crypto.randomUUID();
    f.sql(`insert into customers(id,location_id,name,phone,customer_user_id,status) values('${id}','${targetSalon}',${quote(name)},${quote(phone)},${linked ? quote(linked) : 'null'},'active');${extra}`);
    return id;
  };
  const digest = () => hash(f.sql(`select json_build_object(
    'customers',(select json_agg(c order by id) from customers c),
    'claims',(select json_agg(c order by id) from customer_account_claims c),
    'bookings',(select json_agg(b order by id) from bookings b))`));
  const outcomes = [];

  const selected = addCustomer('Selected salon label', '2025550120', accountUser.profileId);
  f.sql(`update users set display_name='Edited account display name' where id='${accountUser.profileId}'`);
  const input = payload('Selected salon label', '2025550120', selected);
  const beforeFailure = digest();
  assert.throws(() => create(input), /Selected customer is no longer available/);
  assert.equal(digest(), beforeFailure, 'the original failure rolls back its in-transaction name refresh');
  assert.equal(f.sql(`select count(*) from bookings where salon_id='${salon}'`), '0');
  outcomes.push({ name: 'predecessor cumulative chain reproduces selected-name rollback', passed: true });

  const beforeUpgrade = digest();
  f.sql(read(path.join(source, 'supabase/migrations', migration)));
  assert.equal(digest(), beforeUpgrade, 'the migration only changes the command, never repairs customer data');
  // Any other new migration is applied after this one in normal lexical order.
  for (const file of files.filter(n => n > migration)) f.sql(read(path.join(source, 'supabase/migrations', file)));
  const installed = f.sql("select pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure)");
  assert.ok(installed.includes('-- staff-selected-customer-identity-v1'));

  await t.test('edited linked profile name succeeds with exact selected intent and replay cannot duplicate or retarget', () => {
    const result = create(input); assert.equal(result.ok, true); assert.equal(result.assignedToSelf, true);
    const booking = f.json(`select row_to_json(b) from bookings b where id='${result.bookingId}'`);
    assert.equal(booking.customer_id, selected); assert.equal(booking.customer_user_id, accountUser.profileId);
    assert.equal(booking.staff_id, staffId); assert.equal(booking.status, 'pending'); assert.equal(booking.pos_ticket_id, null);
    assert.equal(f.sql(`select name from customers where id='${selected}'`), 'Edited account display name');
    assert.deepEqual(create(input), result);
    assert.equal(create({ ...input, name: 'Replay must not retarget' }).bookingId, result.bookingId);
    assert.equal(f.sql(`select count(*) from bookings where salon_id='${salon}'`), '1');
    const line = f.json(`select row_to_json(l) from booking_lines l where booking_id='${result.bookingId}'`);
    assert.equal(line.service_id, service); assert.equal(Number(line.unit_price), 50); assert.equal(line.assigned_staff_id, staffId);
    assert.equal(f.sql(`select count(*) from pos_tickets where source_booking_id='${result.bookingId}'`), '0');
    outcomes.push({ name: 'linked display-name refresh, canonical booking ownership and scoped replay', passed: true });
  });

  await t.test('a merged selected alias follows the canonical returned ID, including retry after alias removal', () => {
    const canonical = addCustomer('Canonical salon label', '2025550121', accountUser.profileId);
    const alias = addCustomer('Selected duplicate label', '2025550121');
    const request = payload('Selected duplicate label', '2025550121', alias, 1);
    const result = create(request);
    assert.equal(f.sql(`select count(*) from customers where id='${alias}'`), '0');
    assert.equal(f.sql(`select customer_id from bookings where id='${result.bookingId}'`), canonical);
    assert.equal(f.sql(`select customer_user_id from bookings where id='${result.bookingId}'`), accountUser.profileId);
    assert.deepEqual(create(request), result, 'replay precedes stale/merged selected-ID validation');
    outcomes.push({ name: 'canonical merge/remap plus original-ID retry', passed: true });
  });

  await t.test('stale selection, foreign salon, inactive customer and mismatched contact/name fail atomically', () => {
    const inactive = addCustomer('Inactive person', '2025550122');
    f.sql(`update customers set status='inactive' where id='${inactive}'`);
    const foreign = addCustomer('Other salon person', '2025550123', null, otherSalon);
    const cases = [payload('Edited account display name', '2025550999', selected, 2),
      payload('Wrong submitted name', '2025550120', selected, 2), payload('Inactive person', '2025550122', inactive, 2),
      payload('Other salon person', '2025550123', foreign, 2), payload('Deleted person', '2025550124', crypto.randomUUID(), 2)];
    for (const request of cases) { const before = digest(); assert.throws(() => create(request), /Selected customer is no longer available/); assert.equal(digest(), before); }
    outcomes.push({ name: 'selected scope/status/name/contact checks and atomic rollback', passed: true });
  });

  await t.test('contact-hidden lookup stays exact/full-number and accepts the same authorized complete phone', () => {
    f.rpc(owner, 'salon_staff_customer_contacts', { p_salon: salon, p_visible: false });
    assert.deepEqual(f.rpc(staffUser, 'staff_booking_customer_suggestions', { p_salon: salon, p_query: 'Edited' }), []);
    const matches = f.rpc(staffUser, 'staff_booking_customer_suggestions', { p_salon: salon, p_query: '+1 202 555 0120' });
    const match = matches.find(c => c.id === selected); assert.ok(match); assert.equal(match.phone, null);
    const result = create(payload(match.name, '+1 202 555 0120', selected, 3)); assert.equal(result.ok, true);
    const before = digest(); assert.throws(() => create(payload(match.name, '5550120', selected, 4)), /Selected customer is no longer available/); assert.equal(digest(), before);
    f.rpc(owner, 'salon_staff_customer_contacts', { p_salon: salon, p_visible: true });
    outcomes.push({ name: 'privacy-hidden lookup and complete-phone binding', passed: true });
  });

  await t.test('multiple established accounts are not merged and no-selection duplicate protection stays active', () => {
    const left = addCustomer('Account one label', '2025550125', accountUser.profileId);
    const right = addCustomer('Account two label', '2025550125', secondUser.profileId);
    const before = digest(); assert.throws(() => create(payload('Unselected shared number', '2025550125', null, 5)), /Multiple customer profiles match|Possible existing customer/); assert.equal(digest(), before);
    const result = create(payload('Account two label', '2025550125', right, 5)); assert.equal(result.ok, true);
    assert.equal(f.sql(`select customer_id from bookings where id='${result.bookingId}'`), right);
    assert.equal(f.sql(`select customer_user_id from bookings where id='${result.bookingId}'`), secondUser.profileId);
    assert.equal(f.sql(`select count(*) from customers where id in ('${left}','${right}')`), '2');
    assert.equal(f.sql(`select customer_user_id from customers where id='${left}'`), accountUser.profileId);
    outcomes.push({ name: 'multiple established owners remain separate; explicit choice is retained', passed: true });
  });

  await t.test('retained phone-less explicit selection is not silently replaced by another phone owner', () => {
    const unrelated = addCustomer('Phone owner', '2025550126', secondUser.profileId);
    const selectedNoPhone = addCustomer('Selected no-phone contact', null);
    const result = create(payload('Selected no-phone contact', '2025550126', selectedNoPhone, 6));
    assert.equal(f.sql(`select customer_id from bookings where id='${result.bookingId}'`), selectedNoPhone);
    assert.equal(f.sql(`select customer_user_id is null from customers where id='${selectedNoPhone}'`), 't');
    assert.equal(f.sql(`select customer_user_id from customers where id='${unrelated}'`), secondUser.profileId);
    outcomes.push({ name: 'retained explicit selection does not acquire a different identity', passed: true });
  });

  await t.test('the no-selection path still creates one manual customer and one canonical unpaid booking', () => {
    const request = payload('New synthetic Staff customer', '2025550127', null, 7);
    const result = create(request);
    const customer = f.json(`select row_to_json(c) from customers c join bookings b on b.customer_id=c.id where b.id='${result.bookingId}'`);
    assert.equal(customer.name, request.name); assert.equal(customer.phone, request.phone);
    assert.equal(customer.customer_user_id, null); assert.equal(customer.location_id, salon);
    assert.equal(f.sql(`select count(*) from customers where location_id='${salon}' and phone='${request.phone}'`), '1');
    assert.equal(f.sql(`select payment_status from bookings where id='${result.bookingId}'`), 'not_required');
    assert.deepEqual(create(request), result);
    assert.equal(f.sql(`select count(*) from bookings where id='${result.bookingId}'`), '1');
    outcomes.push({ name: 'unchanged new-customer creation and unpaid idempotent booking path', passed: true });
  });

  await t.test('active Staff/permission and private-helper grants remain required, including an old request replay', () => {
    const before = digest();
    assert.throws(() => create(input, outsider), /Active staff access required/);
    assert.throws(() => create(input, owner), /Active staff access required/);
    assert.notEqual(f.http(3000, '/rpc/create_staff_appointment', 'POST', { p_salon: salon, p_input: input }).status, 200);
    f.rpc(owner, 'salon_staff_booking_creation', { p_salon: salon, p_enabled: false });
    assert.throws(() => create(input), /turned off staff appointment creation/);
    f.rpc(owner, 'salon_staff_booking_creation', { p_salon: salon, p_enabled: true });
    assert.notEqual(f.http(3000, '/rpc/canonical_customer_for_phone', 'POST', { p_salon: salon, p_phone: '2025550120', p_owner: null }, staffUser.token).status, 200);
    assert.equal(digest(), before, 'denied requests and replay do not change customer identities or bookings');
    outcomes.push({ name: 'Staff authorization, owner permission and private helper ACL', passed: true });
  });

  await t.test('reapplying migration changes neither command nor customer records', () => {
    const before = digest(); const command = f.sql("select pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure)");
    f.sql(read(path.join(source, 'supabase/migrations', migration)));
    assert.equal(f.sql("select pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure)"), command);
    assert.equal(digest(), before); outcomes.push({ name: 'DDL-only, drift-guarded migration reapplication', passed: true });
  });

  f.save('staff-selected-customer-identity-result.json', { syntheticOnly: true, predecessorMigrations: f.evidence.migrationHashes.length,
    appliedMigration: migration, migrationSha256: hash(read(path.join(source, 'supabase/migrations', migration))),
    appliedMigrations: files.filter(n => n >= migration).map(file => ({ file, executedSha256: hash(read(path.join(source, 'supabase/migrations', file))) })),
    finalCommandSha256: hash(installed), cases: outcomes, runningQaDatabaseTouched: false, realProvidersCalled: false });
});

function quote(value) { return value === null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'"; }
