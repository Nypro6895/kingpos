import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Runs the real migration against a minimal PostgreSQL fixture with restrictive
// table RLS. Supply PGLITE_MODULE_PATH if @electric-sql/pglite is not installed.
test('staff snapshot crosses restricted joins without exposing coworkers', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH
    ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const db = new PGlite();
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as
        $$ select nullif(current_setting('test.user', true),'')::uuid $$;
      create function current_public_user_id() returns uuid language sql as $$ select auth.uid() $$;
      create function get_salon_business_timezone(uuid) returns text language sql as $$ select 'America/Chicago'::text $$;
      create function get_salon_business_date(uuid) returns date language sql as $$ select current_setting('test.day')::date $$;
      create table staff(id uuid, salon_id uuid, account_user_id uuid, user_id uuid, is_active boolean);
      create table customers(id uuid, location_id uuid, name text, phone text, email text);
      create table services(id uuid, name text);
      create table pos_tickets(id uuid, salon_id uuid, customer_id uuid, ticket_number text, status text, opened_at timestamptz, closed_at timestamptz);
      create table pos_ticket_items(id uuid, salon_id uuid, pos_ticket_id uuid, assigned_staff_id uuid,
        service_id uuid, service_name_snapshot text, unit_price numeric, line_total numeric, quantity numeric, created_at timestamptz, is_removed boolean);
      create table pos_ticket_staff_earnings(id uuid, salon_id uuid, staff_id uuid, ticket_id uuid,
        work_date date, service_total numeric, tip_amount numeric, total_earning numeric, big_turn_count integer, small_turn_count integer);
      alter table pos_tickets enable row level security;
      alter table pos_ticket_items enable row level security;
      grant usage on schema public, auth to authenticated;
      grant select on all tables in schema public to authenticated;
      select set_config('test.user','${id(1)}',false), set_config('test.day','2026-03-08',false);
      insert into staff values('${id(10)}','${id(20)}','${id(1)}',null,true),('${id(11)}','${id(20)}','${id(2)}',null,true);
      insert into pos_tickets values('${id(30)}','${id(20)}',null,'T1','closed','2026-03-08T06:00Z','2026-03-08T08:00Z');
      insert into pos_ticket_items values
        ('${id(40)}','${id(20)}','${id(30)}','${id(10)}',null,'Custom service',50,50,1,'2026-03-08T06:00Z',false),
        ('${id(41)}','${id(20)}','${id(30)}','${id(11)}',null,'Coworker',80,80,1,'2026-03-08T06:00Z',false),
        ('${id(42)}','${id(20)}','${id(30)}','${id(10)}',null,'Removed',50,50,1,'2026-03-08T06:00Z',true);
      insert into pos_ticket_staff_earnings values
        ('${id(50)}','${id(20)}','${id(10)}','${id(30)}','2026-03-08',50,10,60,1,0),
        ('${id(51)}','${id(20)}','${id(11)}','${id(30)}','2026-03-08',80,20,100,2,0);
    `);
    await db.exec(readFileSync('supabase/migrations/202609250001_staff_daily_snapshot.sql', 'utf8'));
    await db.exec(`alter table staff add column created_at timestamptz default '2000-01-01';
      create table staff_workdays(salon_id uuid,staff_id uuid,work_date date,check_in_at timestamptz);`);
    await db.exec(readFileSync('supabase/migrations/202609250002_staff_greeting_context.sql', 'utf8'));
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from pos_tickets')).rows.length, 0, 'original inner join is RLS filtered');
    const snapshot = async (salon = 20) => (await db.query(`select get_my_staff_daily_snapshot('${id(salon)}') as result`)).rows[0].result;
    let result = await snapshot();
    const history = async () => (await db.query(`select get_my_staff_greeting_context('${id(20)}') as result`)).rows[0].result;
    assert.equal((await history()).worked_yesterday, false);
    assert.equal(result.date, '2026-03-08');
    assert.equal(result.earnings.length, 1);
    assert.deepEqual([result.earnings[0].service_total, result.earnings[0].tip_amount, result.earnings[0].big_turn_count], [50, 10, 1]);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].service.name, 'Custom service');
    await db.exec(`select set_config('test.user','${id(2)}',false)`);
    const coworker = await snapshot();
    assert.equal(coworker.staff_id, id(11));
    assert.equal(coworker.items.length, 1);
    assert.equal(coworker.earnings[0].service_total, 80);
    await db.exec(`select set_config('test.user','${id(1)}',false)`);
    await assert.rejects(snapshot(21), /unique active staff/);
    await db.exec(`select set_config('test.user','',false)`);
    await assert.rejects(snapshot(), /Authentication required/);
    await db.exec(`reset role; select set_config('test.user','${id(1)}',false)`);
    // A DST day is 23 hours. Include local 23:59, exclude next midnight and
    // the instant before today's midnight, independent of session timezone.
    for (const [n, at] of [[60,'2026-03-08T05:59:59Z'],[61,'2026-03-09T04:59:59Z'],[62,'2026-03-09T05:00:00Z']]) {
      await db.exec(`insert into pos_tickets values('${id(n)}','${id(20)}',null,'pending','open','${at}',null);
        insert into pos_ticket_items values('${id(n+10)}','${id(20)}','${id(n)}','${id(10)}',null,'Pending',5,5,1,'${at}',false);`);
    }
    await db.exec('set role authenticated'); result = await snapshot();
    assert.deepEqual(result.items.map(x => x.pos_ticket_id).sort(), [id(30),id(61)]);
    await db.exec(`select set_config('test.day','2026-03-09',false)`);
    result = await snapshot();
    assert.equal(result.earnings.length, 0, 'previous day earnings are excluded');
    assert.deepEqual(result.items.map(x => x.pos_ticket_id), [id(62)]);
    assert.deepEqual(await history(), {date:'2026-03-09',history_available:true,worked_yesterday:true,yesterday_services:50});
    await db.exec(`reset role; update staff set is_active=false where id='${id(10)}'; set role authenticated`);
    await assert.rejects(snapshot(), /unique active staff/);
    await db.exec(`reset role; update staff set is_active=true where id='${id(10)}';
      insert into staff(id,salon_id,account_user_id,user_id,is_active) values('${id(12)}','${id(20)}','${id(1)}',null,true); set role authenticated`);
    await assert.rejects(snapshot(), /unique active staff/);
    assert.equal((await db.query(`select has_function_privilege('anon','get_my_staff_daily_snapshot(uuid)','execute') as allowed`)).rows[0].allowed, false);
  } finally { await db.close(); }
});
