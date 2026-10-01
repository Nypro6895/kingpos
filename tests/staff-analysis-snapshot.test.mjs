import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

test('analysis RPC enforces identity, salon, dates, closed tickets and own service items under restrictive RLS', async () => {
  const { PGlite } = await import(process.env.PGLITE_MODULE_PATH ? pathToFileURL(process.env.PGLITE_MODULE_PATH).href : '@electric-sql/pglite');
  const db=new PGlite();
  const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.user',true),'')::uuid $$;
      create function current_public_user_id() returns uuid language sql as $$ select auth.uid() $$;
      create table staff(id uuid, salon_id uuid, account_user_id uuid, user_id uuid, is_active boolean);
      create table pos_tickets(id uuid, salon_id uuid, status text);
      create table services(id uuid, name text);
      create table pos_ticket_items(id uuid,salon_id uuid,pos_ticket_id uuid,assigned_staff_id uuid,service_id uuid,service_name_snapshot text,quantity numeric,line_total numeric,is_removed boolean);
      create table pos_ticket_staff_earnings(id uuid,salon_id uuid,staff_id uuid,ticket_id uuid,work_date date,service_total numeric,tip_amount numeric,big_turn_count numeric,small_turn_count numeric);
      alter table pos_tickets enable row level security; alter table pos_ticket_items enable row level security;
      grant usage on schema public,auth to authenticated; grant select on all tables in schema public to authenticated;
      insert into staff values ('${id(10)}','${id(20)}','${id(1)}',null,true),('${id(11)}','${id(20)}','${id(2)}',null,true);
      insert into pos_tickets values ('${id(30)}','${id(20)}','closed'),('${id(31)}','${id(20)}','open'),('${id(32)}','${id(20)}','void');
      insert into pos_ticket_staff_earnings values
      ('${id(40)}','${id(20)}','${id(10)}','${id(30)}','2026-09-16',60,5,1,0),
      ('${id(41)}','${id(20)}','${id(11)}','${id(30)}','2026-09-16',100,20,2,0),
      ('${id(42)}','${id(20)}','${id(10)}','${id(31)}','2026-09-16',200,20,2,0),
      ('${id(43)}','${id(20)}','${id(10)}','${id(32)}','2026-09-16',300,20,2,0),
      ('${id(44)}','${id(20)}','${id(10)}','${id(30)}','2026-09-15',400,20,2,0);
      insert into pos_ticket_items values
      ('${id(50)}','${id(20)}','${id(30)}','${id(10)}',null,'Custom service',1,60,false),
      ('${id(51)}','${id(20)}','${id(30)}','${id(11)}',null,'Coworker',1,100,false),
      ('${id(52)}','${id(20)}','${id(30)}','${id(10)}',null,'Removed',1,99,true);
      select set_config('test.user','${id(1)}',false);`);
    await db.exec(readFileSync('supabase/migrations/202609250003_staff_analysis_snapshot.sql','utf8'));
    await db.exec('set role authenticated');
    const snapshot=async(salon=20,start='2026-09-16',end='2026-09-30')=>(await db.query(`select get_my_staff_analysis_snapshot('${id(salon)}','${start}','${end}') as data`)).rows[0].data;
    const result=await snapshot();
    assert.equal(result.staffId,id(10)); assert.equal(result.serviceTotal,60); assert.equal(result.tipAmount,5);
    assert.equal(result.ticketCount,1); assert.equal(result.totalTurns,1); assert.equal(result.averageTicket,60);
    assert.equal(result.dailyActivity[0].businessDate,'2026-09-16'); assert.equal(result.topServices.length,1); assert.equal(result.topServices[0].serviceName,'Custom service');
    assert.equal((await db.query('select * from pos_tickets')).rows.length,0);
    await assert.rejects(snapshot(21),/unique active staff/);
    await assert.rejects(snapshot(20,'2026-09-30','2026-09-01'),/Invalid analysis period/);
    await assert.rejects(snapshot(20,'2020-01-01','2026-09-01'),/Invalid analysis period/);
    await db.exec(`select set_config('test.user','${id(2)}',false)`);
    assert.equal((await snapshot()).serviceTotal,100);
    await db.exec(`select set_config('test.user','',false)`);
    await assert.rejects(snapshot(),/Authentication required/);
    assert.equal((await db.query("select has_function_privilege('anon','get_my_staff_analysis_snapshot(uuid,date,date)','execute') allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});
