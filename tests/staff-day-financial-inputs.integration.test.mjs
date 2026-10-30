import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner='10000000-0000-4000-8000-000000000001',staffUser='10000000-0000-4000-8000-000000000002',manager='10000000-0000-4000-8000-000000000003';
const salon='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002';
const staff='30000000-0000-4000-8000-000000000001',staff2='30000000-0000-4000-8000-000000000002';
const day='2026-10-01';
let request=0;
const requestId=()=>`40000000-0000-4000-8000-${String(++request).padStart(12,'0')}`;
await db.exec(`
create role authenticated;create role anon;
grant usage on schema public to authenticated;
create table locations(id uuid primary key,account_id uuid);
create table roles(id uuid primary key,code text);
create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
create table salon_memberships(salon_id uuid,user_id uuid,role_id uuid,status text);
create table staff(id uuid primary key,salon_id uuid,account_user_id uuid);
create table pos_ticket_staff_earnings(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,work_date date,service_total numeric,tip_amount numeric,tip_is_manual boolean default false);
create table staff_payroll_settings(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,effective_from date,effective_to date,commission_rate numeric,tax_rate numeric,check_rate numeric,created_at timestamptz default now(),updated_at timestamptz default clock_timestamp());
create table test_events(id uuid default gen_random_uuid(),kind text,before_values jsonb,after_values jsonb,staff_changes jsonb,notify_staff boolean,note text);
create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function payroll_live_is_owner(s uuid) returns boolean language sql stable as $$select s='${salon}'::uuid and current_public_user_id()='${owner}'::uuid$$;
create function current_user_staff_id_for_salon(s uuid) returns uuid language sql stable security definer as $$select id from public.staff where salon_id=s and account_user_id=current_public_user_id()$$;
create function user_has_salon_permission(s uuid,p text[]) returns boolean language sql stable as $$select s='${salon}'::uuid and current_public_user_id() in ('${owner}'::uuid,'${manager}'::uuid,'${staffUser}'::uuid)$$;
create function get_salon_business_date(s uuid) returns date language sql stable as $$select '2026-10-29'::date$$;
create function record_financial_input_event(p_salon uuid,p_kind text,p_business_date date,p_source_id uuid,p_before jsonb,p_after jsonb,p_note text,p_staff_changes jsonb default '[]',p_request uuid default null,p_notify_staff bool default true) returns uuid language plpgsql security definer as $$declare result uuid;begin
if p_note='Synthetic failure' then raise exception 'Synthetic event failure';end if;
insert into public.test_events(kind,before_values,after_values,staff_changes,notify_staff,note) values(p_kind,p_before,p_after,p_staff_changes,p_notify_staff,p_note) returning id into result;return result;end;$$;
create function save_owner_live_payroll_setting(p_salon uuid,p_staff uuid,p_effective date,p_values jsonb,p_expected_id uuid,p_expected_updated_at timestamptz) returns jsonb language plpgsql as $$declare saved public.staff_payroll_settings%rowtype;begin
if not payroll_live_is_owner(p_salon) then raise exception 'Only Owner';end if;
if p_expected_id is not null and not exists(select 1 from public.staff_payroll_settings where id=p_expected_id and updated_at=p_expected_updated_at) then raise exception 'Settings changed';end if;
select * into saved from public.staff_payroll_settings where salon_id=p_salon and staff_id=p_staff and effective_from=p_effective;
if saved.id is null then
update public.staff_payroll_settings set effective_to=p_effective-1 where salon_id=p_salon and staff_id=p_staff and effective_from<p_effective and (effective_to is null or effective_to>=p_effective);
insert into public.staff_payroll_settings(salon_id,staff_id,effective_from,commission_rate,tax_rate,check_rate) values(p_salon,p_staff,p_effective,(p_values->>'commission_rate')::numeric,(p_values->>'tax_rate')::numeric,(p_values->>'check_rate')::numeric) returning * into saved;
else update public.staff_payroll_settings set commission_rate=(p_values->>'commission_rate')::numeric,tax_rate=(p_values->>'tax_rate')::numeric,check_rate=(p_values->>'check_rate')::numeric,updated_at=clock_timestamp() where id=saved.id returning * into saved;end if;
return to_jsonb(saved);end;$$;
insert into locations(id) values('${salon}'),('${other}');
insert into roles values('90000000-0000-4000-8000-000000000001','MANAGER');
insert into roles values('90000000-0000-4000-8000-000000000002','STAFF');
insert into salon_memberships values('${salon}','${manager}','90000000-0000-4000-8000-000000000001','active');
insert into salon_memberships values('${salon}','${staffUser}','90000000-0000-4000-8000-000000000002','active');
insert into staff values('${staff}','${salon}','${staffUser}'),('${staff2}','${salon}',null);
insert into pos_ticket_staff_earnings(salon_id,staff_id,work_date,service_total,tip_amount) values('${salon}','${staff}','${day}',1000,100),('${salon}','${staff2}','${day}',200,20);
`);
await db.exec(fs.readFileSync('supabase/migrations/20261029101000_staff_day_financial_inputs.sql','utf8'));
const actor=async(id)=>db.exec(`reset role;select set_config('test.actor','${id}',false);set role authenticated;`);
const scalar=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const read=async()=> (await scalar('select read_staff_day_financial_input($1,$2,$3) result',[salon,staff,day])).result;
async function save(state,service,tip,note='Corrected day inputs',id=requestId()) { return (await scalar('select save_staff_day_financial_input($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result',[salon,staff,day,id,state.revision,state.service_total,state.tip_amount,service,tip,note])).result; }

test('day input replacement keeps ticket attribution and subsequent source changes exactly once',async()=>{
  await actor(owner); const state=await read();assert.equal(state.service_total,1000);assert.equal(state.tip_amount,100);
  const saved=await save(state,1100,120);assert.equal(saved.changed,true);
  await db.exec('reset role');assert.equal(Number((await scalar('select sum(service_total) amount from pos_ticket_staff_earnings where staff_id=$1',[staff])).amount),1000);
  await db.exec(`update pos_ticket_staff_earnings set service_total=1050,tip_amount=110 where staff_id='${staff}';`);
  await actor(owner);const changed=await read();assert.equal(changed.service_total,1150);assert.equal(changed.tip_amount,130);
  await save(changed,1120,125);const final=await read();assert.equal(final.service_total,1120);assert.equal(final.tip_amount,125);
  await db.exec('reset role');const offsets=await scalar('select service_delta,tip_delta from staff_day_financial_inputs');assert.equal(Number(offsets.service_delta),70);assert.equal(Number(offsets.tip_delta),15);
  const events=(await db.query('select * from test_events order by ctid')).rows;
  assert.equal(events.length,2);assert.equal(events[1].before_values.service_total,1150);assert.equal(events[1].after_values.service_total,1120);assert.equal(events[1].staff_changes[0].staff_id,staff);assert.equal(events[1].notify_staff,true);
});
test('no-op, same-request retry and stale source/revision cannot duplicate or overwrite money',async()=>{
  await actor(owner);let state=await read();const countBefore=(await db.query('select * from effective_staff_day_inputs($1,$2)',[salon,day])).rows.length;assert.equal(countBefore,2);
  const id=requestId();const first=await save(state,1130,126,'Correction',id);await save(state,1130,126,'Correction',id);
  await assert.rejects(save(state,999,0,'Correction',id),/different values/);
  await assert.rejects(save(state,999,0),/Staff day changed/);
  const unchanged=await save(first.current,1130,126);assert.equal(unchanged.changed,false);
  state=await read();await db.exec(`reset role;update pos_ticket_staff_earnings set service_total=1060 where staff_id='${staff}';`);await actor(owner);
  await assert.rejects(save(state,2000,0),/Staff day changed/);
  await db.exec('reset role');assert.equal((await scalar('select count(*)::int n from test_events')).n,3);
});
test('staff reads only own effective inputs; Manager cannot edit; other salons and direct DML denied',async()=>{
  await actor(staffUser);let rows=(await db.query('select * from effective_staff_day_inputs_range($1,$2,$3)',[salon,day,day])).rows;assert.equal(rows.length,1);assert.equal(rows[0].staff_id,staff);
  await assert.rejects(read(),/Only the Owner/);
  await assert.rejects(db.exec('update staff_day_financial_inputs set service_delta=999'),/permission denied/);
  await assert.rejects(db.query('select * from effective_staff_day_inputs_core($1,$2)',[salon,day]),/permission denied/);
  await assert.rejects(db.query('select * from effective_staff_day_inputs($1,$2)',[other,day]),/Not authorized/);
  await actor(manager);await assert.rejects(save({revision:0,service_total:0,tip_amount:0},1,1),/Only the Owner/);
});
test('event failure rolls back source correction and rejects malformed inputs/future day',async()=>{
  await actor(owner);const state=await read();await assert.rejects(save(state,1200,200,'Synthetic failure'),/Synthetic event failure/);assert.deepEqual(await read(),state);
  await assert.rejects(save(state,-1,0),/valid gross/);await assert.rejects(save(state,1.001,0),/valid gross/);await assert.rejects(save(state,1,0,' '),/valid gross/);
  await assert.rejects(db.query('select save_staff_day_financial_input($1,$2,$3,$4,0,0,0,1,0,$5)',[salon,staff,'2026-10-30',requestId(),'Future']),/valid gross/);
});
test('settings create one effective event, stay silent by default, opt-in notifies and retry/no-op stay single',async()=>{
  await actor(owner);
  const call=async(date,values,previous,id=requestId(),notify=false)=>(await scalar('select save_owner_payroll_setting_with_notice($1,$2,$3,$4::jsonb,$5,$6,$7,$8) result',[salon,staff,date,JSON.stringify(values),previous?.id??null,previous?.updated_at??null,id,notify])).result;
  const initial=await call('2026-01-01',{commission_rate:60,tax_rate:0,check_rate:50});
  const id=requestId(),values={commission_rate:65,tax_rate:0,check_rate:50};const second=await call('2026-10-01',values,initial,id,true);await call('2026-10-01',values,initial,id,true);
  await call('2026-10-01',values,second,requestId(),true);
  await db.exec('reset role');const events=(await db.query("select * from test_events where kind='payroll_settings' order by ctid")).rows;
  assert.equal(events.length,2);assert.equal(events[0].notify_staff,false);assert.equal(events[1].notify_staff,true);assert.equal(events[1].before_values.commission_rate,60);assert.equal(events[1].after_values.commission_rate,65);assert.equal(events[1].after_values.effective_from,'2026-10-01');
  assert.equal((await scalar('select effective_to::text from staff_payroll_settings where id=$1',[initial.id])).effective_to,'2026-09-30');
});
test('old direct net adjustment RPC is retired even for authenticated Owner and cannot be called internally to mutate evidence',async()=>{
  await actor(owner);await assert.rejects(db.query('select create_payroll_owner_adjustment($1,$2,0,$3,$4,$5)',[salon,staff,requestId(),{final_cash_amount:9999},'Direct net attempt']),/permission denied/);
  await db.exec('reset role');await assert.rejects(db.query('select create_payroll_owner_adjustment($1,$2,0,$3,$4,$5)',[salon,staff,requestId(),{final_cash_amount:9999},'Internal direct net attempt']),/are calculated/);
});

test('settings cannot bypass the logical event wrapper via old RPC or direct Owner table writes',async()=>{
 await actor(owner);await assert.rejects(db.query('select save_owner_live_payroll_setting($1,$2,$3,$4,null,null)',[salon,staff,'2026-10-01',{commission_rate:99}]),/permission denied/);
 await db.exec('reset role;grant update on staff_payroll_settings to authenticated');await actor(owner);
 await assert.rejects(db.exec('update staff_payroll_settings set commission_rate=99'),/Owner settings form/);
 await db.exec('reset role;revoke update on staff_payroll_settings from authenticated');
});
test.after(()=>db.close());
