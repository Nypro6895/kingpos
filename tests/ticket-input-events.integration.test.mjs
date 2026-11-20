import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {build} from 'esbuild';
process.on('uncaughtException',error=>{console.error(error.message,error.where??'',error.internalQuery??'');process.exitCode=1;});

const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const baseline=read('supabase/migrations/202607240001_account_salon_baseline.sql');
const correction=read('supabase/migrations/202608190004_portable_ticket_edit.sql');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function table(name){const a=baseline.indexOf(`create table public.${name} (`),b=baseline.indexOf('\n);',a);assert.ok(a>=0&&b>a,name);return baseline.slice(a,b+3);}
function func(source,name){const a=source.indexOf(`create or replace function public.${name}(`);assert.ok(a>=0,name);const body=source.indexOf('as $$',a),b=source.indexOf('\n$$;',body);assert.ok(body>a&&b>body,name);return source.slice(a,b+4);}
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function public.current_public_user_id() returns uuid language sql stable as $$select auth.uid()$$;
create table public.users(id uuid primary key,auth_user_id uuid,display_name text);
create table public.accounts(id uuid primary key);
create table public.roles(id uuid primary key,code text);
create table public.account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
create table public.salon_memberships(salon_id uuid,user_id uuid,role_id uuid,status text);
create table public.locations(id uuid primary key,account_id uuid,name text);
create table public.customers(id uuid primary key,location_id uuid,name text,phone text,email text);
create table public.bookings(id uuid primary key);create table public.booking_lines(id uuid primary key);
create table public.staff(id uuid primary key,salon_id uuid,display_name text,job_title text,is_active boolean default true,pos_enabled boolean default true,account_user_id uuid);
create table public.services(id uuid primary key,salon_id uuid,name text,category text,base_price numeric,duration_minutes integer,is_active boolean default true);
${table('pos_tickets')}
${table('pos_ticket_items')}
alter table public.pos_tickets add column workspace_revision bigint not null default 0;
alter table public.pos_ticket_items add column if not exists service_name_snapshot text;
${table('pos_ticket_item_turn_parts')}
${table('pos_ticket_staff_earnings')}
${table('pos_ticket_adjustments')}
${table('pos_payments')}
${table('pos_ticket_audit_logs')}
create table public.pos_daily_closings(salon_id uuid,report_date date,status text,locked_at timestamptz);
create table public.pos_settings(salon_id uuid,large_turn_threshold numeric);
create table public.payroll_live_change_history(id uuid default gen_random_uuid(),salon_id uuid,staff_id uuid,staff_snapshot jsonb,source_table text,source_id uuid,period_start date,period_end date,before_values jsonb,after_values jsonb,actor_id uuid);
create table public.app_notifications(id uuid primary key default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text unique);
create table public.fixture_paid_payroll(id uuid primary key,staff_id uuid,paid numeric,original jsonb);
create table public.staff_day_financial_inputs(salon_id uuid,staff_id uuid,business_date date,service_delta numeric,tip_delta numeric);
create table public.fixture_reconciliations(salon_id uuid,business_date date,recorded_at timestamptz default clock_timestamp());
create function public.reconcile_daily_inputs(s uuid,d date) returns uuid language plpgsql as $$begin insert into public.fixture_reconciliations(salon_id,business_date) values(s,d);return null;end;$$;
create function public.payroll_live_is_owner(s uuid) returns boolean language sql stable as $$select auth.uid()='${uid(90)}'::uuid and s='${uid(1)}'::uuid$$;
create function public.user_has_salon_permission(s uuid,p text[]) returns boolean language sql stable as $$select s='${uid(1)}'::uuid and auth.uid() in ('${uid(90)}'::uuid,'${uid(91)}'::uuid)$$;
create function public.current_user_staff_id_for_salon(s uuid) returns uuid language sql stable as $$select id from public.staff where salon_id=s and account_user_id=auth.uid()$$;
create function public.salon_is_operational(uuid) returns boolean language sql stable as $$select true$$;
create function public.get_salon_business_timezone(uuid) returns text language sql stable as $$select 'America/Chicago'::text$$;
create function public.get_salon_business_date(uuid) returns date language sql stable as $$select (current_timestamp at time zone 'America/Chicago')::date$$;
create function public.pos_portable_access_salon_id(k uuid,s text) returns uuid language sql stable as $$select case when k='${uid(80)}'::uuid and s='valid' then '${uid(1)}'::uuid end$$;
create function public.pos_portable_access_has_capability(k uuid,s text,c text) returns boolean language sql stable as $$select k='${uid(80)}'::uuid and s='valid'$$;
create function public.advance_revision() returns trigger language plpgsql as $$begin new.workspace_revision:=old.workspace_revision+1;return new;end;$$;
create trigger revision before update on public.pos_tickets for each row execute function public.advance_revision();
insert into public.users values('${uid(90)}','${uid(90)}','Owner'),('${uid(91)}','${uid(91)}','Manager'),('${uid(10)}','${uid(10)}','Anna'),('${uid(11)}','${uid(11)}','Bella');
insert into public.accounts values('${uid(2)}');insert into public.roles values('${uid(3)}','OWNER');
insert into public.account_memberships values('${uid(2)}','${uid(90)}','${uid(3)}','active');
insert into public.locations values('${uid(1)}','${uid(2)}','Salon');
insert into public.staff(id,salon_id,display_name,account_user_id) values('${uid(10)}','${uid(1)}','Anna','${uid(10)}'),('${uid(11)}','${uid(1)}','Bella','${uid(11)}');
insert into public.services values('${uid(20)}','${uid(1)}','Manicure','Nails',50,30,true);
insert into public.pos_settings values('${uid(1)}',25);
`);
for(const name of ['pos_ticket_correction_parts_array','pos_ticket_correction_snapshot','rebuild_pos_ticket_item_turn_parts_for_correction','recalculate_pos_ticket_staff_earnings_for_date']) await db.exec(func(correction,name));
await db.exec(func(read('supabase/migrations/202608160001_portable_receipt_staff_earnings.sql'),'insert_missing_pos_ticket_staff_earnings_for_ticket'));
await db.exec(func(correction,'correct_pos_portable_closed_ticket'));
await db.exec(read('supabase/migrations/202608190006_portable_ticket_edit_optional_service.sql'));
let core=(await db.query("select pg_get_functiondef('public.correct_pos_portable_closed_ticket(uuid,text,uuid,jsonb,jsonb,jsonb,jsonb,numeric,text)'::regprocedure) definition")).rows[0].definition;
core=core.replace('correct_pos_portable_closed_ticket(','correct_pos_workspace_ticket_core(');
const authStart=core.indexOf('  target_salon_id :='),authEnd=core.indexOf('  if p_ticket_id is null then');
core=core.slice(0,authStart)+'  target_salon_id := p_key_id;\n\n'+core.slice(authEnd);
await db.exec(core);
// Receipt settlement has its own integration coverage. These boundary stubs
// produce genuine source rows so this suite exercises the actual event wrapper,
// correction engine, allocation SQL, rollback and request receipts together.
await db.exec(`
create function public.fixture_receipt(s uuid,p jsonb,d date) returns jsonb language plpgsql as $$
declare ticket uuid:=gen_random_uuid();line uuid:=gen_random_uuid();begin
 insert into public.pos_tickets(id,salon_id,ticket_number,ticket_sequence,opened_at,status,discount_type,discount_value,tip_type,tip_value)
 values(ticket,s,'Created',99,d::timestamp at time zone 'America/Chicago','closed','fixed_amount',coalesce((p->>'discountValue')::numeric,0),'fixed_amount',coalesce((p->>'tipAmount')::numeric,0));
 insert into public.pos_ticket_items(id,salon_id,pos_ticket_id,service_id,assigned_staff_id,quantity,unit_price,line_total)
 values(line,s,ticket,'${uid(20)}','${uid(10)}',1,50,50);
 perform public.rebuild_pos_ticket_item_turn_parts_for_correction(s,ticket,line,'${uid(10)}',d,array[50::numeric]);
 perform public.insert_missing_pos_ticket_staff_earnings_for_ticket(ticket);
 return jsonb_build_object('ticketId',ticket,'ticketNumber','Created');end;$$;
create function public.submit_owner_workspace_receipt_core(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default current_date) returns jsonb language sql as $$select public.fixture_receipt(p_key_id,p_receipt,p_work_date)$$;
create function public.submit_pos_portable_receipt(p_key_id uuid,p_session_signature text,p_receipt jsonb,p_work_date date default current_date) returns jsonb language sql as $$select public.fixture_receipt(public.pos_portable_access_salon_id(p_key_id,p_session_signature),p_receipt,p_work_date)$$;
`);
await db.exec(read('supabase/migrations/20261029100000_financial_input_history.sql'));
await db.exec(`create trigger legacy_earning_audit after insert or update or delete on public.pos_ticket_staff_earnings for each row execute function public.audit_payroll_live_change();`);
await db.exec(read('supabase/migrations/20261029103000_ticket_input_events.sql'));
const row=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const actor=async id=>db.exec(`select set_config('test.actor','${id??''}',false);`);
const date=(await row("select public.get_salon_business_date($1)::text d",[uid(1)])).d;
const past=(await row("select (public.get_salon_business_date($1)-10)::text d",[uid(1)])).d;
async function sale(ticket,item,day,locked=false){await db.query(`insert into public.pos_tickets(id,salon_id,ticket_number,ticket_sequence,opened_at,status,discount_type,discount_value,tip_type,tip_value) values($1,$2,$3,$4,$5::date::timestamp at time zone 'America/Chicago','closed','fixed_amount',0,'fixed_amount',10)`,[uid(ticket),uid(1),`T${ticket}`,ticket,day]);await db.query(`insert into public.pos_ticket_items(id,salon_id,pos_ticket_id,service_id,assigned_staff_id,quantity,unit_price,line_total) values($1,$2,$3,$4,$5,1,50,50)`,[uid(item),uid(1),uid(ticket),uid(20),uid(10)]);await db.query('select public.rebuild_pos_ticket_item_turn_parts_for_correction($1,$2,$3,$4,$5,array[50::numeric])',[uid(1),uid(ticket),uid(item),uid(10),day]);await db.query('select public.recalculate_pos_ticket_input_earnings_for_date($1,$2,$3)',[uid(1),day,uid(ticket)]);if(locked)await db.query('update public.pos_ticket_staff_earnings set locked_at=now(),payroll_batch_id=$1 where ticket_id=$2',[uid(600),uid(ticket)]);}
await sale(30,40,past,true);await sale(31,41,date);await db.exec(`insert into public.fixture_paid_payroll values('${uid(600)}','${uid(10)}',60,'{"service":50,"tip":10}');`);
let request=1000;
async function save({ticket=30,item=40,staff=10,parts=[60],tip=10,discount=0,note='Correct source inputs',portable=false,id=uid(++request),revision,updates=true,overrides=[]}={}){
 const current=await row('select workspace_revision from public.pos_tickets where id=$1',[uid(ticket)]);
 const result=await row('select public.save_pos_ticket_inputs($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14) r',[
  portable?uid(80):null,portable?'valid':null,portable?null:uid(1),uid(ticket),revision??Number(current.workspace_revision),
  JSON.stringify(updates?[{item_id:uid(item),service_id:uid(20),staff_id:uid(staff),parts:parts.map(amount=>({amount})),remove:false}]:[]),
  JSON.stringify([{item_id:uid(item),parts:parts.map(amount=>({amount}))}]),'[]',JSON.stringify(overrides),tip,note,'fixed_amount',discount,id]);
 return result.r;
}
test('Owner edits old paid ticket inputs; gross and payments remain independent of discount',async()=>{
 await actor(uid(90));const result=await save({discount:20});assert.ok(result.eventId);
 const earning=await row('select * from public.pos_ticket_staff_earnings where ticket_id=$1 and staff_id=$2',[uid(30),uid(10)]);
 assert.equal(Number(earning.service_total),60);assert.equal(Number(earning.tip_amount),10);assert.equal(earning.payroll_batch_id,uid(600));assert.ok(earning.locked_at);
 assert.equal(Number((await row('select paid from public.fixture_paid_payroll')).paid),60);
 const event=await row('select * from public.financial_input_events where id=$1',[result.eventId]);assert.equal(event.before_values.service_total,50);assert.equal(event.after_values.service_total,60);assert.equal(event.after_values.discount_amount,20);assert.equal(event.note,'Correct source inputs');
 const notices=(await db.query("select recipient_kind,href from public.app_notifications where event_key like '%'||$1||'%'",[result.eventId])).rows;
 assert.equal(notices.length,2);assert.ok(notices.find(n=>n.recipient_kind==='staff').href.includes('eventDate='+past));assert.ok(notices.find(n=>n.recipient_kind==='owner_manager'));
 assert.equal(Number((await row('select count(*) n from public.payroll_live_change_history')).n),0);
 assert.equal(Number((await row('select count(*) n from public.fixture_reconciliations where business_date=$1',[past])).n),1);
});
test('lost-response replay returns same event; changed request and stale revision cannot overwrite',async()=>{
 await actor(uid(90));const id=uid(++request),revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(30)])).workspace_revision);
 const a=await save({parts:[65],discount:20,id,revision}),b=await save({parts:[65],discount:20,id,revision});assert.equal(a.eventId,b.eventId);assert.equal(b.replayed,true);
 await assert.rejects(save({parts:[66],discount:20,id,revision}),/different ticket edit/);
 await assert.rejects(save({parts:[66],discount:20,revision}),/another screen/);
});
test('Portable edits only current salon day, and Manager cannot use Owner boundary',async()=>{
 await actor(null);await assert.rejects(save({portable:true,parts:[70]}),/current salon business date/);
 const result=await save({ticket:31,item:41,portable:true,parts:[55]});assert.ok(result.eventId);
 await actor(uid(91));await assert.rejects(save({parts:[70]}),/Only the Owner/);
});
test('staff reassignment creates one event with union old and new safe Staff projections',async()=>{
 await actor(uid(90));const result=await save({ticket:31,item:41,staff:11,parts:[55],tip:10});
 const staff=(await db.query('select * from public.financial_input_event_staff where event_id=$1 order by staff_id',[result.eventId])).rows;
 assert.equal(staff.length,2);assert.deepEqual(staff[0].before_values,{service_total:55,tip_amount:10,status:'closed'});assert.deepEqual(staff[0].after_values,{service_total:0,tip_amount:0,status:'closed'});assert.deepEqual(staff[1].before_values,{service_total:0,tip_amount:0,status:'closed'});assert.deepEqual(staff[1].after_values,{service_total:55,tip_amount:10,status:'closed'});
 assert.equal((await db.query("select * from public.app_notifications where event_key like '%'||$1||'%'",[result.eventId])).rows.length,3);
});
test('100% discount preserves explicit tip and gross; equal values create no event',async()=>{
 await actor(uid(90));const result=await save({parts:[65],discount:65,tip:12,updates:false});assert.ok(result.eventId);
 const earning=await row('select service_total,tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1 and staff_id=$2',[uid(30),uid(10)]);assert.equal(Number(earning.service_total),65);assert.equal(Number(earning.tip_amount),12);
 const before=Number((await row('select count(*) n from public.financial_input_events')).n);
 const noop=await save({parts:[65],discount:65,tip:12});assert.equal(noop.unchanged,true);assert.equal(Number((await row('select count(*) n from public.financial_input_events')).n),before);
});
test('invalid note/allocation rolls back inputs, corrections, history and notification together',async()=>{
 await actor(uid(90));const before=await row('select public.pos_ticket_input_snapshot($1,$2) s',[uid(1),uid(30)]),count=Number((await row('select count(*) n from public.financial_input_events')).n);
 await assert.rejects(save({parts:[80],tip:10,overrides:[{staff_id:uid(10),is_manual:true,tip_amount:99}]}),/cannot exceed/);
 await assert.rejects(save({parts:[80],note:''}),/edit note/);
 assert.deepEqual((await row('select public.pos_ticket_input_snapshot($1,$2) s',[uid(1),uid(30)])).s,before.s);assert.equal(Number((await row('select count(*) n from public.financial_input_events')).n),count);
});
test('create wrappers emit after source rows and deduplicate creation of same ticket',async()=>{
 // Use another date: the historical settlement stub intentionally retains the
 // legacy locked-date guard, while real source creation uses insert-missing.
 const day=(await row("select (public.get_salon_business_date($1)+1)::text d",[uid(1)])).d;
 await actor(uid(90));let result=(await row('select public.submit_owner_workspace_receipt_core($1,null,$2::jsonb,$3) r',[uid(1),JSON.stringify({tipAmount:8,discountValue:50}),day])).r;
 const event=await row('select * from public.financial_input_events where source_id=$1',[result.ticketId]);assert.equal(event.after_values.tip_amount,8);assert.equal(event.after_values.discount_amount,50);
 assert.equal(Number((await row('select tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1',[result.ticketId])).tip_amount),8);
 await db.query('select public.record_pos_ticket_creation($1,$2,$3)',[uid(1),result.ticketId,day]);assert.equal(Number((await row('select count(*) n from public.financial_input_events where source_id=$1',[result.ticketId])).n),1);
 await actor(null);result=(await row('select public.submit_pos_portable_receipt($1,$2,$3::jsonb,$4) r',[uid(80),'valid',JSON.stringify({requestId:uid(++request),tipAmount:9}),day])).r;assert.ok((await row('select id from public.financial_input_events where source_id=$1',[result.ticketId])).id);
});
test('source reductions cannot silently make an existing Staff day adjustment negative',async()=>{
 await actor(uid(90));await db.query('insert into public.staff_day_financial_inputs values($1,$2,$3,-60,0)',[uid(1),uid(10),past]);
 const before=(await row('select public.pos_ticket_input_snapshot($1,$2) s',[uid(1),uid(30)])).s;
 await assert.rejects(save({parts:[50],discount:10,tip:12}),/adjusted Staff day negative/);
 assert.deepEqual((await row('select public.pos_ticket_input_snapshot($1,$2) s',[uid(1),uid(30)])).s,before);
});
test('open item, staff, discount, tip, payment and checkout commands share one atomic boundary',async()=>{
 await actor(uid(90));const created=(await row('select public.create_owner_open_ticket($1,null,null,null,$2) r',[uid(1),uid(++request)])).r;
 const ticket=created.ticketId;
 const command=async(op,values={},id=uid(++request))=>{
  const revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[ticket])).workspace_revision);
  return (await row('select public.mutate_owner_ticket_inputs($1,$2,$3,$4,$5,$6::jsonb,$7) r',[uid(1),ticket,revision,id,op,JSON.stringify(values),'Review open ticket inputs'])).r;
 };
 await command('item_add',{service_id:uid(20)});
 const item=(await row('select id from public.pos_ticket_items where pos_ticket_id=$1',[ticket])).id;
 await command('item_staff',{item_id:item,assigned_staff_id:uid(10)});
 await command('item_update',{item_id:item,unit_price:30,quantity:2});
 await command('item_staff',{item_id:item,assigned_staff_id:uid(11)});await command('item_staff',{item_id:item,assigned_staff_id:uid(10)});
 assert.equal(Number((await row('select count(*) n from public.pos_ticket_item_turn_parts where ticket_item_id=$1',[item])).n),2);
 const noChange=await command('item_update',{item_id:item,unit_price:30,quantity:2});assert.equal(noChange.unchanged,true);
 assert.equal(Number((await row('select count(*) n from public.pos_ticket_staff_earnings where ticket_id=$1',[ticket])).n),0);
 await command('discount',{discount_type:'fixed_amount',discount_value:10});await command('tip',{tip_type:'fixed_amount',tip_value:8});
 const id=uid(++request),first=await command('payment_add',{amount:58,payment_method:'cash'},id),replay=await command('payment_add',{amount:58,payment_method:'cash'},id);
 assert.equal(first.eventId,replay.eventId);assert.equal(replay.replayed,true);assert.equal(Number((await row('select count(*) n from public.pos_payments where ticket_id=$1',[ticket])).n),1);
 const payment=(await row('select id from public.pos_payments where ticket_id=$1',[ticket])).id;
 await command('payment_remove',{payment_id:payment});await assert.rejects(command('checkout'),/fully paid/);
 await command('payment_add',{amount:58,payment_method:'cash'});await command('checkout');
 const earning=await row('select service_total,tip_amount,big_turn_count from public.pos_ticket_staff_earnings where ticket_id=$1',[ticket]);
 assert.equal(Number(earning.service_total),60);assert.equal(Number(earning.tip_amount),8);assert.equal(earning.big_turn_count,2);
 const reopened=await command('reopen');const projected=await row('select before_values,after_values from public.financial_input_event_staff where event_id=$1',[reopened.eventId]);assert.equal(projected.before_values.status,'closed');assert.equal(projected.after_values.status,'open');
 const reopenedSource=await row('select service_total,tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1',[ticket]);assert.equal(Number(reopenedSource.service_total),0);assert.equal(Number(reopenedSource.tip_amount),0);
 await command('item_remove',{item_id:item});assert.equal((await row('select is_removed from public.pos_ticket_items where id=$1',[item])).is_removed,true);
});
test('legacy percentage tip retains its original basis, then discount-only edit preserves resolved tip',async()=>{
 await actor(uid(90));await sale(32,42,date);await db.query("update public.pos_tickets set discount_type='fixed_amount',discount_value=10,tax_rate=10,tip_type='percentage',tip_value=20 where id=$1",[uid(32)]);
 await db.query('select public.recalculate_pos_ticket_input_earnings_for_date($1,$2,$3)',[uid(1),date,uid(32)]);
 assert.equal(Number((await row('select tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(32)])).tip_amount),8.8);
 const result=await save({ticket:32,item:42,parts:[50],updates:false,tip:null,discount:30});assert.ok(result.eventId);
 const record=await row('select tip_type,tip_value from public.pos_tickets where id=$1',[uid(32)]);assert.equal(record.tip_type,'fixed_amount');assert.equal(Number(record.tip_value),8.8);
 assert.equal(Number((await row('select tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(32)])).tip_amount),8.8);
});
test('direct Owner and Manager source writes cannot bypass audited commands',async()=>{
 await db.exec('grant usage on schema auth to authenticated;grant select,insert,update,delete on public.pos_tickets,public.pos_ticket_items,public.pos_payments,public.pos_ticket_staff_earnings,public.pos_ticket_adjustments,public.pos_ticket_audit_logs to authenticated;');
 for(const who of [uid(90),uid(91)]){
  await actor(who);await db.exec('set role authenticated');
  await assert.rejects(db.query('update public.pos_tickets set discount_value=1 where id=$1',[uid(30)]),/authorized ticket input command/);
  await assert.rejects(db.query('update public.pos_ticket_staff_earnings set service_total=1 where ticket_id=$1',[uid(30)]),/authorized ticket input command/);
  await assert.rejects(db.query("update public.pos_ticket_adjustments set reason='Forged history' where ticket_id=$1",[uid(30)]),/authorized ticket input command/);
  await assert.rejects(db.query("insert into public.pos_ticket_audit_logs(salon_id,ticket_id,action,note) values($1,$2,'ticket_checked_out','Forged checkout')",[uid(1),uid(30)]),/authorized ticket input command/);
  await db.exec('reset role');
 }
});
test('Portable receipt request replays one creation and rejects an altered payload',async()=>{
 await actor(null);const payload={requestId:uid(++request),tipAmount:9};
 const submit=async body=>(await row('select public.submit_pos_portable_receipt($1,$2,$3::jsonb,$4) r',[uid(80),'valid',JSON.stringify(body),date])).r;
 const first=await submit(payload),again=await submit(payload);assert.equal(first.ticketId,again.ticketId);
 assert.equal(Number((await row('select count(*) n from public.financial_input_events where source_id=$1',[first.ticketId])).n),1);
 await assert.rejects(submit({...payload,tipAmount:10}),/different receipt/);
 await assert.rejects(submit({tipAmount:9}),/Reload this receipt/);
});
test('editing one ticket preserves another legacy full-discount tip and existing source money on that day',async()=>{
 await actor(uid(90));await sale(34,44,date);await sale(35,45,date);await sale(36,46,date);
 await db.query('delete from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(36)]);
 await db.query("update public.pos_tickets set discount_value=50 where id=$1",[uid(34)]);
 await db.query('update public.pos_ticket_staff_earnings set tip_amount=0,total_earning=service_total where ticket_id=$1',[uid(34)]);
 const before=await row('select service_total,tip_amount,total_earning from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(34)]);
 await save({ticket:35,item:45,parts:[60],tip:10});
 const after=await row('select service_total,tip_amount,total_earning from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(34)]);assert.deepEqual(after,before);
 assert.equal(Number((await row('select count(*) n from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(36)])).n),0,'untouched missing source row must not silently introduce money');
 assert.equal(Number((await row('select count(*) n from public.financial_input_events where source_id=$1',[uid(34)])).n),0);
 await db.query('select public.refresh_owner_ticket_source_earnings($1,$2)',[uid(1),date]);assert.deepEqual(await row('select service_total,tip_amount,total_earning from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(34)]),before);
 assert.equal(Number((await row('select count(*) n from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(36)])).n),0);
 const explicit=await save({ticket:34,item:44,updates:false,parts:[50],tip:10,discount:50});assert.ok(explicit.eventId);
 assert.equal(Number((await row('select tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(34)])).tip_amount),10);
});
test('closed add/remove, multi-part Staff services, manual tip allocation and no-op stay atomic',async()=>{
 await actor(uid(90));await sale(33,43,date);
 const correct=async(updates,added,overrides,tip=12)=>{
  const revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(33)])).workspace_revision);
  return (await row('select public.save_pos_ticket_inputs(null,null,$1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12) r',
   [uid(1),uid(33),revision,JSON.stringify(updates),'[]',JSON.stringify(added),JSON.stringify(overrides),tip,'Review service split','fixed_amount',0,uid(++request)])).r;
 };
 const parts=amounts=>amounts.map(amount=>({amount}));
 const added={service_id:uid(20),staff_id:uid(11),parts:parts([20,30])};
 let result=await correct([{item_id:uid(43),service_id:uid(20),staff_id:uid(10),parts:parts([20,30]),remove:false}],[added],[{staff_id:uid(10),tip_amount:9,is_manual:true}]);assert.ok(result.eventId);
 let earnings=(await db.query('select staff_id,service_total,tip_amount,tip_is_manual from public.pos_ticket_staff_earnings where ticket_id=$1 order by staff_id',[uid(33)])).rows;
 assert.deepEqual(earnings.map(e=>[e.staff_id,Number(e.service_total),Number(e.tip_amount),e.tip_is_manual]),[[uid(10),50,9,true],[uid(11),50,3,false]]);
 assert.equal(Number((await row('select count(*) n from public.pos_ticket_item_turn_parts where ticket_id=$1',[uid(33)])).n),4);
 const sameStaff=await correct([],[{...added,staff_id:uid(10)}],[]);assert.ok(sameStaff.eventId);
 assert.equal(Number((await row('select service_total from public.pos_ticket_staff_earnings where ticket_id=$1 and staff_id=$2',[uid(33),uid(10)])).service_total),100);
 const second=(await row('select id from public.pos_ticket_items where pos_ticket_id=$1 and assigned_staff_id=$2 and not is_removed',[uid(33),uid(11)])).id;
 result=await correct([{item_id:second,remove:true}],[],[{staff_id:uid(10),is_manual:false,tip_amount:0}]);assert.ok(result.eventId);
 earnings=(await db.query('select staff_id,service_total,tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1 order by staff_id',[uid(33)])).rows;
 assert.deepEqual(earnings.map(e=>[e.staff_id,Number(e.service_total),Number(e.tip_amount)]),[[uid(10),100,12],[uid(11),0,0]]);
 assert.equal((await row('select is_removed from public.pos_ticket_items where id=$1',[second])).is_removed,true);
 const noop=await correct([{item_id:uid(43),service_id:uid(20),staff_id:uid(10),parts:parts([20,30]),remove:false}],[],[]);assert.equal(noop.unchanged,true);
});
test('existing named custom receipt supports service amount and tip edits with human before/after history',async()=>{
 await actor(uid(90));await sale(37,47,date);
 await db.query('update public.pos_ticket_items set service_id=null,service_name_snapshot=$1 where id=$2',['Custom chrome accent',uid(47)]);
 const revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(37)])).workspace_revision);
 const result=(await row('select public.save_pos_ticket_inputs(null,null,$1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12) r',
  [uid(1),uid(37),revision,JSON.stringify([{item_id:uid(47),service_id:null,staff_id:uid(10),parts:[{amount:35},{amount:25}],remove:false}]),'[]','[]','[]',12,'Correct custom service input','fixed_amount',0,uid(++request)])).r;assert.ok(result.eventId);
 const event=await row('select before_values,after_values from public.financial_input_events where id=$1',[result.eventId]);
 assert.equal(event.before_values.lines[0].service_name,'Custom chrome accent');assert.equal(event.after_values.lines[0].service_name,'Custom chrome accent');assert.equal(event.before_values.service_total,50);assert.equal(event.after_values.service_total,60);assert.equal(event.after_values.tip_amount,12);
 assert.equal((await row('select service_name_snapshot from public.pos_ticket_items where id=$1',[uid(47)])).service_name_snapshot,'Custom chrome accent');
 const legacy=await row('select after_snapshot from public.pos_ticket_adjustments where ticket_id=$1 order by created_at desc limit 1',[uid(37)]);assert.equal(legacy.after_snapshot.ticket.ticket_items[0].service_name_snapshot,'Custom chrome accent');
 const fresh=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(37)])).workspace_revision);
 const added=(await row('select public.save_pos_ticket_inputs(null,null,$1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12) r',
  [uid(1),uid(37),fresh,'[]','[]',JSON.stringify([{service_id:null,staff_id:uid(11),parts:[{amount:10}]}]),'[]',12,'Add amount-only custom input','fixed_amount',0,uid(++request)])).r;assert.ok(added.eventId);
 assert.equal((await row('select after_values from public.financial_input_events where id=$1',[added.eventId])).after_values.lines.find(line=>line.staff_id===uid(11)).service_name,'Custom service');
});
test('TypeScript totals retain legacy percent basis and independent fixed tip on full discount',async()=>{
 const {outputFiles}=await build({entryPoints:['lib/pos-ticket-calculations.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {calculateTicketTotals}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].contents).toString('base64'));
 const base={items:[{line_total:50}],discountType:'fixed_amount',discountValue:10,taxRate:10};
 assert.equal(calculateTicketTotals({...base,tipType:'percentage',tipValue:20}).tip_amount,8.8);
 const fixed=calculateTicketTotals({...base,discountValue:50,tipType:'fixed_amount',tipValue:8});assert.equal(fixed.tip_amount,8);assert.equal(fixed.total,8);
});
test('legacy custom with unknown label stays editable without inventing its original name',async()=>{
 await actor(uid(90));await sale(38,48,date);await db.query('update public.pos_ticket_items set service_id=null,service_name_snapshot=null where id=$1',[uid(48)]);
 const invoke=async(updates,added)=>{
  const revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(38)])).workspace_revision);
  return (await row('select public.save_pos_ticket_inputs(null,null,$1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12) r',
   [uid(1),uid(38),revision,JSON.stringify(updates),'[]',JSON.stringify(added),'[]',12,'Correct optional-service inputs','fixed_amount',0,uid(++request)])).r;
 };
 const result=await invoke([{item_id:uid(48),service_id:null,staff_id:uid(10),parts:[{amount:55}],remove:false}],[]);assert.ok(result.eventId);
 const event=await row('select before_values,after_values from public.financial_input_events where id=$1',[result.eventId]);assert.equal(event.before_values.lines[0].service_name,'Custom service');assert.equal(event.after_values.lines[0].service_name,'Custom service');
 assert.equal((await row('select service_name_snapshot from public.pos_ticket_items where id=$1',[uid(48)])).service_name_snapshot,null,'unknown historical name stays unknown in raw source');
 const added=await invoke([],[{service_id:null,service_label:'Hand painted accent',staff_id:uid(10),parts:[{amount:45}]}]);assert.ok(added.eventId);
 const rows=(await row('select after_values from public.financial_input_events where id=$1',[added.eventId])).after_values.lines;assert.equal(rows.find(line=>line.service_name==='Hand painted accent').service_total,45);
 assert.equal(Number((await row('select service_total from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(38)])).service_total),100);
});
test('zero-tip void projects ticket status to Staff and zeroes posted earnings while preserving receipt inputs',async()=>{
 await actor(uid(90));await sale(39,49,date);await db.query('update public.pos_tickets set tip_value=0 where id=$1',[uid(39)]);await db.query('update public.pos_ticket_staff_earnings set tip_amount=0,total_earning=service_total where ticket_id=$1',[uid(39)]);
 const revision=Number((await row('select workspace_revision from public.pos_tickets where id=$1',[uid(39)])).workspace_revision);
 const result=(await row('select public.mutate_owner_ticket_inputs($1,$2,$3,$4,$5,$6::jsonb,$7) r',[uid(1),uid(39),revision,uid(++request),'void','{}','Void duplicate recorded receipt'])).r;
 const projection=await row('select before_values,after_values from public.financial_input_event_staff where event_id=$1',[result.eventId]);assert.equal(projection.before_values.status,'closed');assert.equal(projection.after_values.status,'voided');assert.equal(projection.before_values.service_total,50);assert.equal(projection.after_values.service_total,50);assert.equal(projection.after_values.tip_amount,0);
 const earning=await row('select service_total,tip_amount from public.pos_ticket_staff_earnings where ticket_id=$1',[uid(39)]);assert.equal(Number(earning.service_total),0);assert.equal(Number(earning.tip_amount),0);assert.equal(Number((await row('select line_total from public.pos_ticket_items where id=$1',[uid(49)])).line_total),50);
});
test.after(async()=>await db.close());
