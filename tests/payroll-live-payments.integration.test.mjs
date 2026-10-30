import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const salon=id(100),account=id(101),owner=id(1),anna=id(2),manager=id(3),outside=id(4),tax=id(5),staffA=id(10),staffB=id(11),baseId=id(200);
await db.exec(`
create role authenticated;create role anon;create role service_role;grant usage on schema public to authenticated;
create table locations(id uuid primary key,account_id uuid);
create table roles(id uuid primary key,code text);
create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
create table salon_memberships(salon_id uuid,user_id uuid,role_id uuid,status text);
create table staff(id uuid primary key,salon_id uuid,account_user_id uuid);
create table salon_payroll_settings(salon_id uuid,cycle_type text,biweekly_anchor_date date);
create table payroll_period_bases(id uuid primary key,salon_id uuid,period_start date,period_end date,cycle_type text);
create table payroll_recorded_payments(id uuid primary key default gen_random_uuid(),base_id uuid,salon_id uuid,staff_id uuid,request_id uuid,actor_id uuid,revision integer,cash_amount numeric,check_amount numeric,paid_at timestamptz,note text);
create table payroll_owner_adjustments(id uuid primary key default gen_random_uuid(),base_id uuid,staff_id uuid,revision integer);
create table payroll_staff_lines(payroll_run_id uuid,staff_id uuid);
create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function payroll_live_is_owner(s uuid) returns boolean language sql stable as $$select s='${salon}'::uuid and current_public_user_id()='${owner}'::uuid$$;
create function current_user_staff_id_for_salon(s uuid) returns uuid language sql stable security definer as $$select case when count(*)=1 then min(id::text)::uuid else null end from public.staff where salon_id=s and account_user_id=current_public_user_id()$$;
create function user_has_salon_permission(s uuid,p text[]) returns boolean language sql stable as $$select s='${salon}'::uuid and current_public_user_id() in ('${owner}'::uuid,'${anna}'::uuid,'${manager}'::uuid)$$;
create function tax_company_has_access(s uuid) returns boolean language sql stable as $$select s='${salon}'::uuid and current_public_user_id()='${tax}'::uuid$$;
create function payroll_calendar_period(day date,cycle text,anchor date) returns table(start_date date,end_date date) language sql stable as $$select case when extract(day from day)<=15 then date_trunc('month',day)::date else date_trunc('month',day)::date+15 end,case when extract(day from day)<=15 then date_trunc('month',day)::date+14 else (date_trunc('month',day)+interval '1 month - 1 day')::date end$$;
create function read_payroll_period_ledger(s uuid,d1 date,d2 date) returns jsonb language plpgsql security definer as $$declare b payroll_period_bases%rowtype;begin
select * into b from public.payroll_period_bases where salon_id=s and period_start=d1 and period_end=d2;
return jsonb_build_object('base',case when b.id is null then null else jsonb_build_object('id',b.id,'periodStart',b.period_start,'periodEnd',b.period_end) end,'revision',coalesce((select max(revision) from public.payroll_recorded_payments where base_id=b.id),0),'lines',jsonb_build_array(jsonb_build_object('staff_id','${staffA}'),jsonb_build_object('staff_id','${staffB}')),'adjustments','[]'::jsonb,'payments',coalesce((select jsonb_agg(to_jsonb(p)) from public.payroll_recorded_payments p where base_id=b.id),'[]'),'legacyPaidHistory','[]'::jsonb,'shopDailyRows',jsonb_build_array('private shop report'));end;$$;
insert into locations values('${salon}','${account}');insert into roles values('${id(20)}','STAFF'),('${id(21)}','MANAGER');
insert into account_memberships values('${account}','${anna}','${id(20)}','active'),('${account}','${manager}','${id(21)}','active');
insert into staff values('${staffA}','${salon}','${anna}'),('${staffB}','${salon}',null);
insert into salon_payroll_settings values('${salon}','semi_monthly',null);
`);
await db.exec(fs.readFileSync('supabase/migrations/20261029101100_live_payroll_payments.sql','utf8'));
const actor=user=>db.exec(`reset role;select set_config('test.actor','${user}',false);set role authenticated;`);
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.result;
const read=(start='2020-10-01',end='2020-10-15')=>scalar('select read_live_payroll_recorded_facts($1,$2,$3) result',[salon,start,end]);
const save=(revision,cash,check,request=randomUUID(),staff=staffA,paidAt='2020-10-16T12:00:00Z',start='2020-10-01',end='2020-10-15')=>scalar('select record_live_payroll_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[salon,staff,start,end,request,revision,cash,check,paidAt,'Actual payment fixture']);

test('exact period with no frozen base reads zero actual payments, and Owner can record a payment without creating one',async()=>{
 await actor(owner);const empty=await read();assert.equal(empty.selection.exact,true);assert.equal(empty.periods.length,1);assert.equal(empty.periods[0].base,null);assert.deepEqual(empty.periods[0].payments,[]);
 const request=randomUUID(),first=await save(0,200,400,request);assert.equal(first.period_start,'2020-10-01');assert.equal(first.period_end,'2020-10-15');
 assert.equal((await save(0,200,400,request)).id,first.id);await assert.rejects(save(0,201,400,request),/different payment/);await assert.rejects(save(0,1,0),/payments changed/);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from payroll_period_bases')).rows[0].n,0);
});

test('later supplemental payment stays attached to the original period; other staff share a stale revision guard',async()=>{
 await actor(owner);await save(1,0,100,randomUUID(),staffA,'2020-11-01T12:00:00Z');await save(2,50,0,randomUUID(),staffB);
 const original=await read();assert.equal(original.periods[0].revision,3);assert.equal(original.periods[0].payments.length,3);assert.ok(original.periods[0].payments.some(p=>Date.parse(p.paid_at)===Date.parse('2020-11-01T12:00:00Z')));
 const later=await read('2020-11-01','2020-11-15');assert.deepEqual(later.periods[0].payments,[]);
 const partial=await read('2020-10-03','2020-10-15');assert.equal(partial.selection.exact,false);assert.equal(partial.periods[0].sourcePeriod.start,'2020-10-01');assert.equal(partial.periods[0].payments.length,3);
 await assert.rejects(save(3,10,0,randomUUID(),staffA,'2020-10-16T12:00:00Z','2020-10-03'),/complete original pay period/);
});

test('Staff with payroll permission reads only own payments/ledger lines; Manager read is broad and no nonOwner can write',async()=>{
 await actor(anna);const own=await read();assert.equal(own.periods[0].payments.length,2);assert.ok(own.periods[0].payments.every(p=>p.staff_id===staffA));assert.equal(own.periods[0].lines.length,1);assert.deepEqual(own.periods[0].shopDailyRows,[]);
 const raw=(await db.query('select staff_id from payroll_live_recorded_payments')).rows;assert.equal(raw.length,2);assert.ok(raw.every(p=>p.staff_id===staffA));
 await assert.rejects(save(3,1,0),/Only the current salon Owner/);await assert.rejects(db.exec('update payroll_live_recorded_payments set cash_amount=999'),/permission denied/);
 await assert.rejects(db.query('select read_payroll_period_ledger_before_live_payments($1,$2,$3)',[salon,'2020-10-01','2020-10-15']),/permission denied/);
 await actor(manager);assert.equal((await read()).periods[0].payments.length,3);await assert.rejects(save(3,1,0),/Only the current salon Owner/);
 await actor(outside);await assert.rejects(read(),/payment access/);
});

test('legacy payment command and new command preserve old facts and converge on one request identity',async()=>{
 await db.exec(`reset role;insert into payroll_period_bases values('${baseId}','${salon}','2020-09-01','2020-09-15','semi_monthly');insert into payroll_recorded_payments(base_id,salon_id,staff_id,request_id,actor_id,revision,cash_amount,check_amount,paid_at,note) values('${baseId}','${salon}','${staffA}','${randomUUID()}','${owner}',1,100,200,'2020-09-16T12:00:00Z','Original legacy receipt');`);
 await actor(owner);const request=randomUUID();const legacyCall=await scalar('select record_payroll_payment($1,$2,1,$3,0,50,$4,$5) result',[baseId,staffA,request,'2020-10-20T12:00:00Z','Actual payment fixture']);
 const retry=await save(1,0,50,request,staffA,'2020-10-20T12:00:00Z','2020-09-01','2020-09-15');assert.equal(retry.id,legacyCall.id);
 const facts=await read('2020-09-01','2020-09-15');assert.equal(facts.periods[0].payments.length,2);assert.equal(facts.periods[0].revision,2);assert.equal(Number(facts.periods[0].payments[0].cash_amount),100);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from payroll_recorded_payments')).rows[0].n,1);await assert.rejects(db.exec('delete from payroll_live_recorded_payments'),/immutable/);
});

test('a schedule change never reallocates or duplicates whole original-period payments into a new overlapping period',async()=>{
 const original=id(201);await db.exec(`reset role;insert into payroll_period_bases values('${original}','${salon}','2020-12-01','2020-12-31','monthly');insert into payroll_recorded_payments(base_id,salon_id,staff_id,request_id,actor_id,revision,cash_amount,check_amount,paid_at,note) values('${original}','${salon}','${staffA}','${randomUUID()}','${owner}',1,100,200,'2021-01-01T12:00:00Z','Whole monthly payment');`);
 await actor(owner);const facts=await read('2020-12-01','2020-12-15');assert.equal(facts.selection.exact,true);assert.equal(facts.periods.length,2);assert.equal(facts.periods.find(p=>p.sourcePeriod.end==='2020-12-31').payments.length,1);
 await assert.rejects(save(0,10,0,randomUUID(),staffA,'2021-01-02T12:00:00Z','2020-12-01','2020-12-15'),/original period already used/);
 await save(1,0,50,randomUUID(),staffA,'2021-01-02T12:00:00Z','2020-12-01','2020-12-31');assert.equal((await read('2020-12-01','2020-12-31')).periods[0].payments.length,2);
 await assert.rejects(save(0,0,0,randomUUID(),staffB),/actual cash\/check/);await assert.rejects(save(0,1.001,0,randomUUID(),staffB),/actual cash\/check/);await assert.rejects(save(0,1,0,randomUUID(),staffB,'2100-01-01T00:00:00Z'),/actual cash\/check/);
});

test('external Tax Company keeps legacy evidence access without gaining private live payment receipts or RPC access',async()=>{
 await actor(tax);assert.deepEqual((await db.query('select * from payroll_live_recorded_payments')).rows,[]);await assert.rejects(read(),/Live payroll payment access/);
 const legacy=await scalar('select read_payroll_period_ledger($1,$2,$3) result',[salon,'2020-09-01','2020-09-15']);assert.equal(legacy.payments.length,1);assert.equal(legacy.payments[0].note,'Original legacy receipt');assert.equal(legacy.canAdjust,false);
 const liveOnly=await scalar('select read_payroll_period_ledger($1,$2,$3) result',[salon,'2020-10-01','2020-10-15']);assert.deepEqual(liveOnly.payments,[]);
 await assert.rejects(save(3,1,0),/Only the current salon Owner/);
});

test.after(()=>db.close());
