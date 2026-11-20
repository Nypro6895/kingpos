import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
test('customer search and exact POS lookup respect caller RLS and treat filter syntax as data', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema extensions;
      create function public.normalize_search_text(v text) returns text language sql immutable as $$select nullif(lower(btrim(v)),'')$$;
      create function public.normalize_customer_claim_phone(v text) returns text language sql immutable as $$select nullif(regexp_replace(v,'[^0-9]','','g'),'')$$;
      create function public.search_text_has_all_tokens(v text,t text[]) returns boolean language sql immutable as
        $$select not exists(select 1 from unnest(t) word where position(word in v)=0)$$;
      -- Ranking is not the subject of this fixture; the production search body
      -- and table RLS run unchanged, with inert trigram ranking dependencies.
      create function extensions.word_similarity(a text,b text) returns real language sql immutable as $$select 0::real$$;
      create function extensions.similarity(a text,b text) returns real language sql immutable as $$select 0::real$$;
      create table public.customers(id uuid primary key,location_id uuid,customer_user_id uuid,name text,phone text,email text,
        notes text,staff_notes text,internal_notes text,source text,status text,created_by_user_id uuid,
        updated_by_user_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
      create function public.user_can_manage_salon(salon uuid) returns boolean language sql stable as
        $$select salon=nullif(current_setting('test.salon',true),'')::uuid$$;
      alter table public.customers enable row level security;
      create policy salon_member_read_customers on public.customers for select to authenticated
        using (public.user_can_manage_salon(location_id));
      grant usage on schema public,extensions to authenticated,anon;
      grant select on public.customers to authenticated;
    `);
    const original = readFileSync('supabase/migrations/202608280002_smart_search_foundation.sql', 'utf8');
    const start = original.indexOf('create or replace function public.search_salon_customers(');
    const end = original.indexOf('create or replace function public.search_public_explore_salons(', start);
    assert.ok(start >= 0 && end > start);
    await db.exec(original.slice(start, end));
    const malicious = 'x,phone.neq.null)';
    const values = [
      [id(1), id(10), 'O\'Neil, (VIP) "A"', '5551112222', 'one@example.invalid', 'active'],
      [id(2), id(20), 'Other salon', '5559990000', 'other@example.invalid', 'active'],
      [id(3), id(10), malicious, null, null, 'active'],
      [id(4), id(10), 'Rate 100%_off*', null, null, 'active'],
      [id(5), id(10), 'Inactive', '5553334444', null, 'inactive'],
    ];
    for (const row of values) await db.query('insert into customers(id,location_id,name,phone,email,status) values($1,$2,$3,$4,$5,$6)', row);
    await db.exec(`set role authenticated; select set_config('test.salon','${id(10)}',false)`);
    const search = async salon => (await db.query('select * from public.search_salon_customers($1,null,10,0,\'active\')', [salon])).rows;
    assert.equal((await search(id(20))).length, 1, 'fixture reproduces the old SECURITY DEFINER bypass');
    await db.exec('reset role');
    const migration = readFileSync('supabase/migrations/20261119194501_pos_customer_lookup_security.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Safe to apply again; no data rewrite.
    await db.exec(`set role authenticated; select set_config('test.salon','${id(10)}',false)`);
    assert.deepEqual(await search(id(20)), [], 'direct RPC cannot cross the salon boundary');
    assert.equal((await search(id(10))).length, 3);
    const lookup = async (value, salon = id(10)) => (await db.query('select * from public.find_pos_desk_customer_exact($1,$2)', [salon, value])).rows;
    for (const [value, expected] of [[values[0][2], id(1)], ['one@example.invalid', id(1)], ['5551112222', id(1)],
      ['o\'neil, (vip) "a"', id(1)], [malicious, id(3)], ['Rate 100%_off*', id(4)]]) {
      assert.equal((await lookup(value))[0]?.id, expected, `literal lookup ${value}`);
    }
    for (const value of ['Other salon', 'Inactive', 'Rate 100', '%', '_', '*', "' or true --", '', null]) {
      assert.deepEqual(await lookup(value), [], `no widened match for ${value}`);
    }
    assert.deepEqual(await lookup('Other salon', id(20)), []);
    await db.exec("select set_config('test.salon','',false)");
    assert.deepEqual(await lookup(values[0][2]), [], 'customer or unassigned staff has no private row access');
    await db.exec(`select set_config('test.salon','${id(20)}',false)`);
    assert.equal((await lookup('Other salon', id(20)))[0]?.id, id(2), 'the other owner retains their own customer');
    await db.exec('reset role; set role anon');
    await assert.rejects(lookup(values[0][2]), /permission denied/);
    await assert.rejects(search(id(10)), /permission denied/);
  } finally { await db.close(); }
});
