import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('issued check references are owner/period scoped; conflicts are rejected in both write orders without changing payroll money',async()=>{
 const db=new PGlite();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 try{
  await db.exec(`create role anon;create role authenticated;create table locations(id uuid primary key,status text,owner_id uuid);
   create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
   create function lifecycle_user_is_salon_owner(s uuid,u uuid,x boolean) returns boolean language sql as $$select exists(select 1 from locations where id=s and owner_id=u)$$;
   create table check_writer_checks(id uuid primary key,salon_id uuid,payroll_staff_id uuid,number bigint,period_start date,period_end date,status text,snapshot jsonb);
   create table payroll_period_staff_inputs(id uuid primary key,salon_id uuid,staff_id uuid,period_start date,period_end date,check_number text,bonus_amount numeric);
   insert into locations values('${id(1)}','active','${id(2)}'),('${id(3)}','active','${id(4)}');`);
  await db.exec(readFileSync('supabase/migrations/20261113051000_payroll_check_references.sql','utf8'));
  const actor=async n=>db.query("select set_config('app.actor',$1,false)",[id(n)]);
  const references=()=>db.query('select * from payroll_issued_check_references($1,$2,$3)',[id(1),'2026-11-01','2026-11-15']);
  await actor(2);await db.exec(`insert into payroll_period_staff_inputs values('${id(10)}','${id(1)}','${id(5)}','2026-11-01','2026-11-15','000123',20);
   insert into check_writer_checks values('${id(20)}','${id(1)}','${id(5)}',123,'2026-11-01','2026-11-15','issued','{"bank":"never returned"}');`);
  assert.deepEqual((await references()).rows.map(x=>x.number),['123']);assert(!JSON.stringify((await references()).rows).includes('bank'));
  await assert.rejects(db.exec(`update payroll_period_staff_inputs set check_number='124' where id='${id(10)}'`),/conflicts/);
  await db.exec(`update payroll_period_staff_inputs set bonus_amount=30 where id='${id(10)}'`);
  assert.equal((await db.query('select bonus_amount from payroll_period_staff_inputs where id=$1',[id(10)])).rows[0].bonus_amount,'30');
  await assert.rejects(db.exec(`insert into check_writer_checks values('${id(21)}','${id(1)}','${id(5)}',124,'2026-11-01','2026-11-15','issued','{}')`),/conflicts/);
  await actor(4);await assert.rejects(references(),/Owner access/);
  await actor(5);await assert.rejects(references(),/Owner access/);
  await actor(2);assert.equal((await db.query('select * from payroll_issued_check_references($1,$2,$3)',[id(1),'2026-11-16','2026-11-30'])).rows.length,0);
  await db.exec(`update check_writer_checks set status='void' where id='${id(20)}'`);assert.equal((await references()).rows.length,0);
  await db.exec(`update payroll_period_staff_inputs set check_number='000124' where id='${id(10)}';insert into check_writer_checks values('${id(22)}','${id(1)}','${id(5)}',124,'2026-11-01','2026-11-15','issued','{}')`);
  await assert.rejects(db.exec(`insert into payroll_period_staff_inputs values('${id(11)}','${id(1)}','${id(5)}','2026-11-10','2026-11-20','999',0)`),/conflicts/);
  await db.exec(`set role authenticated`);await actor(2);assert.equal((await references()).rows.length,1);
  await assert.rejects(db.query('select snapshot from check_writer_checks'),/permission denied/);
  await db.exec('reset role');await db.exec(`update locations set status='inactive' where id='${id(1)}'`);await assert.rejects(references(),/Owner access/);
 }finally{await db.close();}
});
