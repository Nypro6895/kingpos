import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';


export async function historyNotificationFixture(){
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
await db.exec(func(correction,'get_pos_portable_ticket_data'));
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

await db.exec("alter table public.users add column status text not null default 'active',add column email text;alter table public.staff add column user_id uuid;alter table public.app_notifications add column read_at timestamptz;");
await db.exec(`alter table public.app_notifications add column booking_id uuid,add column created_at timestamptz default now();
 alter table public.bookings add column salon_id uuid,add column staff_id uuid,add column status text,add column confirmation_status text,add column start_at timestamptz,add column salon_timezone_snapshot text default 'America/Chicago',add column updated_at timestamptz default now(),add column customer_id uuid;
 alter table public.booking_lines add column booking_id uuid,add column assigned_staff_id uuid,add column display_order integer,add column service_name_snapshot text;`);
await db.exec(read('supabase/migrations/202610060001_unified_notification_feed.sql'));
return {db,row,actor,date,past,uid,sale,save};
}
