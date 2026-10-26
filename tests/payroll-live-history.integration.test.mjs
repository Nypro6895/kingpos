import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const ids={owner:'10000000-0000-4000-8000-000000000001',manager:'10000000-0000-4000-8000-000000000002',anna:'10000000-0000-4000-8000-000000000003',lily:'10000000-0000-4000-8000-000000000004',salon:'20000000-0000-4000-8000-000000000001',other:'20000000-0000-4000-8000-000000000002',staff:'30000000-0000-4000-8000-000000000001',staff2:'30000000-0000-4000-8000-000000000002'};
const baseline=fs.readFileSync('supabase/migrations/202607240001_account_salon_baseline.sql','utf8');
function table(name){const start=baseline.indexOf(`create table public.${name} (`),end=baseline.indexOf('\n);',start);if(start<0||end<0)throw Error(name);return baseline.slice(start,end+3);}
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;grant usage on schema public to authenticated;
create table public.users(id uuid primary key);
create table public.accounts(id uuid primary key);
create table public.roles(id uuid primary key,code text);
create table public.account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
create table public.locations(id uuid primary key,account_id uuid references public.accounts(id));
create table public.staff(id uuid primary key,salon_id uuid references public.locations(id),account_user_id uuid,is_active boolean default true);
create table public.pos_tickets(id uuid primary key);
${table('pos_financial_correction_requests')}
${table('pos_daily_closings')}
alter table public.pos_daily_closings add column save_revision integer not null default 0;
${table('payroll_period_staff_inputs')}
${table('staff_payroll_settings')}
${table('salon_payroll_settings')}
${table('pos_ticket_staff_earnings')}
${table('pos_financial_adjustments')}
create table public.app_notifications(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text);
create function public.current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function public.user_has_salon_permission(s uuid,p text[]) returns boolean language sql stable security definer as $$select exists(select 1 from public.locations l join public.account_memberships m on m.account_id=l.account_id join public.roles r on r.id=m.role_id where l.id=s and m.user_id=public.current_public_user_id() and m.status='active' and r.code in ('OWNER','MANAGER'))$$;
create function public.current_user_staff_id_for_salon(s uuid) returns uuid language sql stable security definer as $$select id from public.staff where salon_id=s and account_user_id=public.current_public_user_id() and is_active limit 1$$;
create function public.test_revision() returns trigger language plpgsql as $$begin new.save_revision:=case when tg_op='INSERT' then 1 else old.save_revision+1 end;new.updated_at:=clock_timestamp();return new;end;$$;
create trigger revision before insert or update on public.pos_daily_closings for each row execute function public.test_revision();
create function public.test_updated() returns trigger language plpgsql as $$begin new.updated_at:=clock_timestamp();return new;end;$$;
create trigger updated before update on public.staff_payroll_settings for each row execute function public.test_updated();
insert into public.users values('${ids.owner}'),('${ids.manager}'),('${ids.anna}'),('${ids.lily}');
insert into public.accounts values('40000000-0000-4000-8000-000000000001'),('40000000-0000-4000-8000-000000000002');
insert into public.roles values('50000000-0000-4000-8000-000000000001','OWNER'),('50000000-0000-4000-8000-000000000002','MANAGER');
insert into public.account_memberships values('40000000-0000-4000-8000-000000000001','${ids.owner}','50000000-0000-4000-8000-000000000001','active'),('40000000-0000-4000-8000-000000000001','${ids.manager}','50000000-0000-4000-8000-000000000002','active');
insert into public.locations values('${ids.salon}','40000000-0000-4000-8000-000000000001'),('${ids.other}','40000000-0000-4000-8000-000000000002');
insert into public.staff values('${ids.staff}','${ids.salon}','${ids.anna}',true),('${ids.staff2}','${ids.salon}','${ids.lily}',true);
insert into public.pos_daily_closings(salon_id,report_date,cash_amount,credit_card_amount,other_amount,cash_amount_snapshot,credit_card_amount_snapshot,other_amount_snapshot,snapshot_created_at,locked_at,status) values('${ids.salon}','2026-09-01',100,200,0,100,200,0,now(),now(),'locked');
insert into public.pos_financial_adjustments(salon_id,target_type,business_date,cash_delta) values('${ids.salon}','daily_closing','2026-09-01',25);
grant select,insert,update,delete on public.pos_daily_closings,public.payroll_period_staff_inputs,public.staff_payroll_settings,public.pos_ticket_staff_earnings to authenticated;
`);
await db.exec("alter table public.staff add column display_name text default 'Fixture staff'");
await db.exec(fs.readFileSync('supabase/migrations/202610060004_classify_staff_service_deletion.sql','utf8'));
const liveMigration=fs.readFileSync('supabase/migrations/20261025143000_payroll_live_history.sql','utf8');
const originalGuard=(await db.query("select pg_get_functiondef('public.guard_used_salon_record_delete()'::regprocedure) body")).rows[0].body;
await db.exec('begin');await db.exec(originalGuard.replace('These rows are setup','These  rows are setup'));
await assert.rejects(db.exec(liveMigration),/Review Staff deletion guard/);await db.exec('rollback');
assert.equal((await db.query("select pg_get_functiondef('public.guard_used_salon_record_delete()'::regprocedure) body")).rows[0].body,originalGuard);
assert.equal((await db.query("select to_regclass('public.payroll_live_change_history') object")).rows[0].object,null);
await db.exec(liveMigration);
const actor=async user=>db.exec(`reset role;select set_config('test.actor','${user}',false);set role authenticated;`);
const scalar=async sql=>(await db.query(sql)).rows[0];
const daily=async(date,request,revision,values)=>db.query('select public.save_owner_live_daily_report($1,$2,$3,$4,$5::jsonb) result',[ids.salon,date,request,revision,JSON.stringify(values)]);
const input=async(values,expected)=>db.query('select public.save_owner_live_payroll_input($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) result',[ids.salon,ids.staff,'2026-10-01','2026-10-15','semi_monthly',JSON.stringify(values),JSON.stringify(expected)]);
const blank={bonus_amount:0,check_number:null,note:null};

test('Staff deletion guard drift aborts and rolls back the entire proposed migration',()=>{assert.ok(originalGuard.includes('These rows are setup'));});

test('legacy applied cash correction materializes once without removing old history',async()=>{
  await db.exec('reset role');const result=await scalar(`select cash_amount from public.pos_daily_closings where report_date='2026-09-01'`);assert.equal(Number(result.cash_amount),125);
  assert.equal((await scalar('select count(*)::int n from public.pos_financial_adjustments')).n,1);
});
test('Owner edits old locked report; retry is idempotent and stale write is rejected',async()=>{
  await actor(ids.owner);
  const state=await db.query('select public.read_owner_live_daily_report($1,$2) result',[ids.salon,'2026-09-01']);
  const revision=state.rows[0].result.current.revision;assert.equal(state.rows[0].result.current.locked,false);
  const request='60000000-0000-4000-8000-000000000001',values={cashAmount:130,creditCardAmount:200,otherAmount:0,note:'Counted again'};
  await daily('2026-09-01',request,revision,values);const first=(await scalar('select count(*)::int n from public.payroll_live_change_history')).n;
  const retry=await daily('2026-09-01',request,revision,values);assert.equal(retry.rows[0].result.replayed,true);
  assert.equal((await scalar('select count(*)::int n from public.payroll_live_change_history')).n,first);
  await assert.rejects(daily('2026-09-01','60000000-0000-4000-8000-000000000002',revision,{...values,cashAmount:999}),/another screen/);
  await assert.rejects(daily('2026-09-01',request,revision,{...values,cashAmount:999}),/different values/);
});
test('explicit zero report is entered; no-op retry creates no second history entry',async()=>{
  await actor(ids.owner);const values={cashAmount:0,creditCardAmount:0,otherAmount:0,note:null};
  const first=await daily('2026-10-25','60000000-0000-4000-8000-000000000003',0,values);
  assert.ok((await scalar(`select live_report_entered_at from public.pos_daily_closings where report_date='2026-10-25'`)).live_report_entered_at);
  const count=(await scalar('select count(*)::int n from public.payroll_live_change_history')).n;
  await daily('2026-10-25','60000000-0000-4000-8000-000000000004',first.rows[0].result.current.revision,values);
  assert.equal((await scalar('select count(*)::int n from public.payroll_live_change_history')).n,count);
});
test('payroll edit and revert keep history and notify only the affected staff',async()=>{
  await actor(ids.owner);const changed={bonus_amount:100,check_number:'123',note:'Bonus'};
  await input(changed,blank);await input(changed,blank); // unknown response retry
  await input(blank,changed); // revert is another recorded change
  assert.equal((await scalar(`select count(*)::int n from public.payroll_live_change_history where staff_id='${ids.staff}'`)).n,2);
  await db.exec('reset role');
  assert.equal((await scalar(`select count(*)::int n from public.app_notifications where recipient_user_id='${ids.anna}'`)).n,2);
  assert.equal((await scalar(`select count(*)::int n from public.app_notifications where recipient_user_id='${ids.lily}'`)).n,0);
});
test('manager may view history but cannot edit through RPC or direct table access',async()=>{
  await actor(ids.manager);assert.ok((await scalar('select count(*)::int n from public.payroll_live_change_history')).n>0);
  await assert.rejects(input({bonus_amount:999,check_number:null,note:null},blank),/Only the Owner/);
  await assert.rejects(db.exec(`update public.payroll_period_staff_inputs set bonus_amount=999 where staff_id='${ids.staff}'`),/Only the Owner/);
});
test('staff history is self-only and append-only; other salons stay inaccessible',async()=>{
  await actor(ids.anna);const rows=(await db.query('select * from public.payroll_live_change_history')).rows;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.staff_id===ids.staff));
  await assert.rejects(db.exec('delete from public.payroll_live_change_history'),/permission denied/);
  await assert.rejects(db.exec("update public.payroll_live_change_history set after_values='{}'"),/permission denied/);
  await actor(ids.lily);assert.equal((await scalar('select count(*)::int n from public.payroll_live_change_history')).n,0);
  await actor(ids.owner);await assert.rejects(db.query('select public.save_owner_live_daily_report($1,$2,$3,$4,$5::jsonb)',[ids.other,'2026-10-01','60000000-0000-4000-8000-000000000009',0,JSON.stringify({cashAmount:1,creditCardAmount:0,otherAmount:0,note:null})]),/Only the Owner/);
});
test('stale payroll input cannot overwrite a newer amount',async()=>{
  await actor(ids.owner);await input({bonus_amount:50,check_number:null,note:null},blank);
  await assert.rejects(input({bonus_amount:75,check_number:null,note:null},blank),/another screen/);
  await db.exec('reset role');assert.equal(Number((await scalar(`select bonus_amount from public.payroll_period_staff_inputs where staff_id='${ids.staff}'`)).bonus_amount),50);
});
test('malformed amounts never become zero silently',async()=>{
  await actor(ids.owner);await assert.rejects(input({bonus_amount:1.001,check_number:null,note:null},blank),/Invalid payroll/);
  await assert.rejects(daily('2026-10-01','60000000-0000-4000-8000-000000000010',0,{cashAmount:-1,creditCardAmount:0,otherAmount:0,note:null}),/nonnegative/);
});
const settingValues={pay_type:'commission',commission_rate:60,fixed_pay_amount:0,check_rate:50,tax_rate:10,apply_tax_to_fixed_pay:false,tax_tips:true,tax_bonus:true,cash_to_tax_company:false,tax_company_enabled:true,tip_payout_method:'cash',bonus_payout_method:'check',legal_name:'Anna'};
async function setting(date,values,previous){return db.query('select public.save_owner_live_payroll_setting($1,$2,$3,$4::jsonb,$5,$6) result',[ids.salon,ids.staff,date,JSON.stringify(values),previous?.id??null,previous?.updated_at??null]);}
test('setting timeline, history and notifications commit atomically or all roll back',async()=>{
  await actor(ids.owner);const first=(await setting('2026-01-01',settingValues,null)).rows[0].result;
  await db.exec("reset role; create function public.fail_test_setting() returns trigger language plpgsql as $$begin if new.legal_name='BLOCK' then raise exception 'Synthetic failure';end if;return new;end;$$;create trigger fail_test_setting before insert on public.staff_payroll_settings for each row execute function public.fail_test_setting();");
  const count=(await scalar('select count(*)::int n from public.payroll_live_change_history')).n;
  await actor(ids.owner);await assert.rejects(setting('2026-10-01',{...settingValues,legal_name:'BLOCK'},first),/Synthetic failure/);
  await db.exec('reset role');assert.equal((await scalar(`select effective_to from public.staff_payroll_settings where id='${first.id}'`)).effective_to,null);
  assert.equal((await scalar('select count(*)::int n from public.payroll_live_change_history')).n,count);
  await actor(ids.owner);const updated=(await setting('2026-10-01',{...settingValues,commission_rate:65},first)).rows[0].result;
  await assert.rejects(setting('2026-10-01',{...settingValues,commission_rate:70},first),/another screen/);
  assert.equal(Number(updated.commission_rate),65);
});
test('reassignment notifies both affected staff and each sees only their own before/after',async()=>{
  await db.exec(`reset role;insert into public.pos_tickets values('70000000-0000-4000-8000-000000000001');`);
  await actor(ids.owner);await db.exec(`insert into public.pos_ticket_staff_earnings(salon_id,ticket_id,staff_id,work_date,service_total,tip_amount) values('${ids.salon}','70000000-0000-4000-8000-000000000001','${ids.staff}','2026-10-15',100,10);`);
  await db.exec(`update public.pos_ticket_staff_earnings set staff_id='${ids.staff2}',service_total=120;`);
  await actor(ids.lily);const own=(await db.query("select * from public.payroll_live_change_history where source_table='pos_ticket_staff_earnings'")).rows;
  assert.equal(own.length,1);assert.deepEqual(own[0].before_values,{});assert.equal(own[0].after_values.service_total,120);
  await actor(ids.anna);const removed=(await db.query("select * from public.payroll_live_change_history where source_table='pos_ticket_staff_earnings' order by created_at desc")).rows[0];assert.deepEqual(removed.after_values,{});assert.equal(removed.before_values.service_total,100);
});
test('metadata-only moves cannot evade the Owner financial guard',async()=>{
  await actor(ids.manager);await assert.rejects(db.exec("update public.pos_daily_closings set report_date='2026-10-24' where report_date='2026-10-25'"),/scope cannot/);
});
test('temporary shadow tables cannot redirect Owner checks or financial writes',async()=>{
  await db.exec('reset role;create temporary table locations(id uuid,account_id uuid);create temporary table payroll_live_change_history(id uuid);');
  await actor(ids.owner);const result=await daily('2026-10-23','60000000-0000-4000-8000-000000000011',0,{cashAmount:12.34,creditCardAmount:0,otherAmount:0,note:null});assert.equal(Number(result.rows[0].result.current.closingInputs.cashAmount),12.34);
  await db.exec('reset role');assert.equal((await scalar('select count(*)::int n from pg_temp.payroll_live_change_history')).n,0);
});
test('deleting Staff preserves prior financial notes, values, actor/source/dates and captured identity',async()=>{
  const removed='30000000-0000-4000-8000-000000000009';
  await db.exec(`reset role;insert into public.staff(id,salon_id,is_active,display_name) values('${removed}','${ids.salon}',true,'Original Fixture Name')`);
  await actor(ids.owner);
  const values={bonus_amount:10,check_number:'fixture',note:'Original note'};
  const args=[ids.salon,removed,'2026-08-01','2026-08-15','semi_monthly'];
  await db.query('select public.save_owner_live_payroll_input($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[...args,JSON.stringify(values),JSON.stringify(blank)]);
  await db.query('select public.save_owner_live_payroll_input($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[...args,JSON.stringify({...values,bonus_amount:25,note:'Revised note'}),JSON.stringify(values)]);
  await db.exec('reset role');
  const before=(await db.query(`select * from public.payroll_live_change_history where staff_id='${removed}' order by id`)).rows;
  assert.equal(before.length,2);assert.ok(before.every(row=>row.staff_snapshot.id===removed&&row.staff_snapshot.displayName==='Original Fixture Name'));
  await db.exec(`update public.staff set display_name='Renamed later' where id='${removed}'`);
  await db.exec(`delete from public.staff where id='${removed}'`);
  await actor(ids.owner);
  for(const row of before){const after=await scalar(`select * from public.payroll_live_change_history where id='${row.id}'`);assert.deepEqual(after,{...row,staff_id:null});}
  const deleted=(await db.query(`select * from public.payroll_live_change_history where staff_snapshot->>'id'='${removed}' and after_values='{}'::jsonb`)).rows;
  assert.equal(deleted.length,1);assert.equal(deleted[0].before_values.note,'Revised note');assert.equal(deleted[0].before_values.bonus_amount,25);
  await actor(ids.anna);assert.equal((await db.query(`select * from public.payroll_live_change_history where staff_snapshot->>'id'='${removed}'`)).rows.length,0,'retention does not expand Staff RLS');
});

test.after(async()=>{await db.close();});
