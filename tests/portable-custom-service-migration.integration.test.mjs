import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// Run the actual migration against disposable SQL fixtures; no customer data.
const migration = readFileSync('supabase/migrations/202609230009_portable_custom_service_snapshot.sql', 'utf8');
const salon = '00000000-0000-4000-8000-000000000001';
const service = '00000000-0000-4000-8000-000000000002';
const signature = 'public.submit_pos_portable_receipt(uuid,text,jsonb,date)';
const helper = 'public.submit_pos_portable_receipt_without_booking(uuid,text,jsonb,date)';

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.services(id uuid primary key, salon_id uuid, name text);
    create table public.fixture_receipt_items(service_id uuid, service_name_snapshot text, unit_price numeric);
    insert into public.services values ('${service}', '${salon}', 'Catalog haircut');
    create function public.submit_pos_portable_receipt(p_key_id uuid, p_signature text, p_receipt jsonb, p_work_date date)
    returns jsonb language plpgsql security definer set search_path = public as $body$
    declare
      target_salon_id uuid := p_key_id;
      service_uuid uuid := nullif(p_receipt ->> 'serviceId', '')::uuid;
      line_total numeric := (p_receipt ->> 'amount')::numeric;
      line_item jsonb := p_receipt;
    begin
      if p_signature <> 'fixture-allowed' then raise exception 'fixture authorization denied'; end if;
      insert into public.fixture_receipt_items (
      service_id,
      unit_price
      ) values (
      service_uuid,
      line_total
      );
      return jsonb_build_object('ok', true, 'policySentinel', 'retained');
    end;
    $body$;
    revoke all on function ${signature} from public;
    grant execute on function ${signature} to authenticated;
  `);
  return db;
}

async function metadata(db, name = signature) {
  return (await db.query(`select pg_get_functiondef(oid) as definition,
    proowner::regrole::text as owner, proacl::text as acl, prosecdef, proconfig
    from pg_proc where oid = to_regprocedure($1)`, [name])).rows[0];
}

const submit = (db, receipt, proof = 'fixture-allowed') => db.query(
  'select public.submit_pos_portable_receipt($1,$2,$3,$4) as result',
  [salon, proof, JSON.stringify(receipt), '2030-01-01'],
);

test('fresh schema without the optional helper preserves policy and stores custom/catalog service names', async () => {
  const db = await fixture();
  try {
    assert.equal((await db.query('select to_regprocedure($1) as helper', [helper])).rows[0].helper, null);
    const before = await metadata(db);
    await db.exec(migration);
    const after = await metadata(db);
    assert.match(after.definition, /portable_custom_service_snapshot_v1/);
    assert.deepEqual({ ...after, definition: undefined }, { ...before, definition: undefined });
    await db.exec('set role authenticated');
    assert.equal((await submit(db, { serviceLabel: '  Custom trim  ', amount: 17 })).rows[0].result.policySentinel, 'retained');
    await submit(db, { serviceLabel: '   ', amount: 18 });
    await submit(db, { amount: 19 });
    await submit(db, { serviceLabel: 'x'.repeat(120), amount: 20 });
    await submit(db, { serviceId: service, serviceLabel: 'Ignore this client label', amount: 21 });
    await assert.rejects(submit(db, { amount: 22 }, 'invalid'), /fixture authorization denied/);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select service_name_snapshot as name from fixture_receipt_items order by unit_price')).rows.map(r => r.name), [
      'Custom trim', 'Service', 'Service', 'x'.repeat(100), 'Catalog haircut',
    ]);
    await db.exec('set role anon');
    await assert.rejects(submit(db, { amount: 23 }), /permission denied/);
    await db.exec('reset role');
    await db.exec(migration);
    assert.deepEqual(await metadata(db), after, 'reapplication leaves definition, owner, ACL and configuration unchanged');
  } finally { await db.close(); }
});

async function delegateToHelper(db) {
  await db.exec(`alter function ${signature} rename to submit_pos_portable_receipt_without_booking;
    revoke all on function ${helper} from public, anon, authenticated;
    create function public.submit_pos_portable_receipt(p_key_id uuid, p_signature text, p_receipt jsonb, p_work_date date)
    returns jsonb language plpgsql security definer set search_path = public as $body$
    begin
      return public.submit_pos_portable_receipt_without_booking(p_key_id, p_signature, p_receipt, p_work_date)
        || jsonb_build_object('bookingPolicySentinel', 'retained');
    end;
    $body$;
    revoke all on function ${signature} from public;
    grant execute on function ${signature} to authenticated;`);
}

test('upgrade with a patched private core is a no-op and retains wrapper, core, ACL and policy', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await delegateToHelper(db);
    const before = [await metadata(db), await metadata(db, helper)];
    await db.exec(migration);
    assert.deepEqual([await metadata(db), await metadata(db, helper)], before);
    await db.exec('set role authenticated');
    const result = (await submit(db, { serviceLabel: 'Upgrade trim', amount: 25 })).rows[0].result;
    assert.deepEqual(result, { ok: true, policySentinel: 'retained', bookingPolicySentinel: 'retained' });
    await assert.rejects(db.query(`select public.submit_pos_portable_receipt_without_booking($1,$2,$3,$4)`,
      [salon, 'fixture-allowed', '{"amount":25}', '2030-01-01']), /permission denied/);
    await assert.rejects(submit(db, { amount: 26 }, 'invalid'), /fixture authorization denied/);
    await db.exec('reset role');
    assert.equal((await db.query('select service_name_snapshot from fixture_receipt_items')).rows[0].service_name_snapshot, 'Upgrade trim');
  } finally { await db.close(); }
});

test('an unexpected unpatched delegation fails closed without changing either function', async () => {
  const db = await fixture();
  try {
    await delegateToHelper(db);
    const before = [await metadata(db), await metadata(db, helper)];
    await assert.rejects(db.exec(migration), /Portable receipt item insert changed; review custom service snapshot patch/);
    assert.deepEqual([await metadata(db), await metadata(db, helper)], before);
  } finally { await db.close(); }
});
