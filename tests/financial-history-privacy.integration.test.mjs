import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite(),salon='10000000-0000-4000-8000-000000000001',account='20000000-0000-4000-8000-000000000001';
const people={owner:'30000000-0000-4000-8000-000000000001',manager:'30000000-0000-4000-8000-000000000002',staff:'30000000-0000-4000-8000-000000000003',outsider:'30000000-0000-4000-8000-000000000004',tax:'30000000-0000-4000-8000-000000000005',viewer:'30000000-0000-4000-8000-000000000006'};
const staffA='40000000-0000-4000-8000-000000000001',staffB='40000000-0000-4000-8000-000000000002',first='50000000-0000-4000-8000-000000000001',second='50000000-0000-4000-8000-000000000002';
const scoped=['pos_ticket_staff_earnings','pos_daily_closing_staff_snapshots','pos_financial_adjustments','staff_payroll_settings','payroll_period_staff_inputs','payroll_period_staff_input_history','payroll_staff_daily_totals','payroll_live_change_history','payroll_staff_lines','payroll_paystubs'];
const shared=['pos_daily_closings','pos_ticket_adjustments','pos_financial_correction_requests','pos_tickets','pos_payments','pos_ticket_audit_logs','pos_desk_sessions','pos_desk_session_lines','pos_display_channels','pos_live_drafts','payroll_runs'];
const tables=[...scoped,...shared,'pos_ticket_items','pos_ticket_item_turn_parts'];
await db.exec(`
create role authenticated;create role anon;grant usage on schema public to authenticated;create schema auth;grant usage on schema auth to authenticated;
create schema storage;grant usage on schema storage to authenticated;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to authenticated;create policy public_sample_read on storage.objects for select to authenticated using(bucket_id='public-sample');
create table locations(id uuid primary key,account_id uuid);create table roles(id uuid primary key,code text);create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);create table salon_memberships(salon_id uuid,user_id uuid,role_id uuid,status text);
create table permissions(id uuid primary key default gen_random_uuid(),code text);create table role_permissions(role_id uuid,permission_id uuid);
create table staff(id uuid primary key,salon_id uuid,account_user_id uuid,user_id uuid,is_active boolean default true,created_at timestamptz default now());
create table services(id uuid primary key,name text);create table customers(id uuid primary key,location_id uuid,name text,phone text,email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function current_public_user_id() returns uuid language sql stable as $$select auth.uid()$$;
create function current_user_staff_id_for_salon(target_salon_id uuid) returns uuid language sql stable security definer set search_path=public as $$select id from public.staff where salon_id=target_salon_id and account_user_id=current_public_user_id() and is_active order by created_at limit 1$$;
create function user_has_salon_permission(s uuid,codes text[]) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from (select m.user_id,m.role_id from public.account_memberships m join public.locations l on l.account_id=m.account_id where l.id=s and m.status='active' union all select m.user_id,m.role_id from public.salon_memberships m where m.salon_id=s and m.status='active') m join public.role_permissions rp on rp.role_id=m.role_id join public.permissions p on p.id=rp.permission_id where m.user_id=current_public_user_id() and p.code=any(codes))$$;
create function user_can_manage_salon(s uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from public.locations l join public.account_memberships m on l.account_id=m.account_id join public.roles r on r.id=m.role_id where l.id=s and m.user_id=current_public_user_id() and m.status='active' and r.code in ('OWNER','MANAGER'))$$;
create function tax_company_has_access(s uuid) returns boolean language sql stable set search_path=public as $$select s='${salon}'::uuid and current_public_user_id()='${people.tax}'::uuid$$;
create function get_salon_business_timezone(s uuid) returns text language sql stable as $$select 'UTC'::text$$;
create function get_salon_business_date(s uuid) returns date language sql stable as $$select '2026-10-29'::date$$;
insert into locations values('${salon}','${account}');
insert into roles values('${people.owner}','OWNER'),('${people.manager}','MANAGER'),('${people.staff}','STAFF'),('${people.viewer}','RECEPTIONIST');
insert into account_memberships values('${account}','${people.owner}','${people.owner}','active'),('${account}','${people.manager}','${people.manager}','active'),('${account}','${people.viewer}','${people.viewer}','active');
insert into salon_memberships values('${salon}','${people.staff}','${people.staff}','active');
insert into permissions(code) values('tickets.view'),('tickets.manage'),('reports.view'),('financial_corrections.apply'),('financial_corrections.request'),('payroll.view'),('payroll.manage'),('payroll.tax_company');
insert into role_permissions select '${people.owner}',id from permissions;insert into role_permissions select '${people.manager}',id from permissions where code in ('tickets.view','reports.view','payroll.view');insert into role_permissions select '${people.staff}',id from permissions where code='tickets.view';
insert into staff(id,salon_id,account_user_id) values('${staffA}','${salon}','${people.staff}'),('${staffB}','${salon}',null);
`);
for(const table of tables){
 let extra='';
 if(table==='pos_ticket_staff_earnings')extra=',ticket_id uuid,work_date date,service_total numeric,tip_amount numeric,total_earning numeric,big_turn_count numeric,small_turn_count numeric';
 if(table==='pos_tickets')extra=',ticket_number text,opened_at timestamptz,closed_at timestamptz,customer_id uuid';
 if(table==='pos_ticket_items')extra=',pos_ticket_id uuid,service_id uuid,service_name_snapshot text,unit_price numeric,line_total numeric,quantity numeric,created_at timestamptz,is_removed boolean default false';
 if(table==='pos_ticket_item_turn_parts')extra=',ticket_item_id uuid,amount numeric';
 if(table==='payroll_paystubs')extra=',file_url_or_path text';
 await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),salon_id uuid,staff_id uuid,assigned_staff_id uuid,requested_by uuid,uploaded_by uuid,payroll_run_id uuid,status text default 'printed'${extra});alter table ${table} enable row level security;grant select,insert,update,delete on ${table} to authenticated;insert into ${table}(id,salon_id,staff_id,assigned_staff_id,requested_by,uploaded_by,payroll_run_id) values('${first}','${salon}','${staffA}','${staffA}','${people.owner}','${people.owner}','${first}'),('${second}','${salon}','${staffB}','${staffB}','${people.owner}','${people.owner}','${second}');`);
}
await db.exec(`create function can_cleanup_paystub_object(n text) returns boolean language sql stable security definer set search_path=public as $$select public.user_has_salon_permission(split_part(n,'/',2)::uuid,array['payroll.tax_company']) and not exists(select 1 from public.payroll_paystubs p where p.file_url_or_path=n)$$;
create function tax_company_storage_access(n text) returns boolean language sql stable set search_path=public as $$select public.tax_company_has_access(split_part(n,'/',2)::uuid)$$;`);
// Exercise the installed policy definitions, including permissive FOR ALL
// policies, rather than simplified policies that would hide the original leak.
for(const file of ['202607240001_account_salon_baseline.sql','20261009210001_tax_company_plugin.sql','20261025143000_payroll_live_history.sql','202609250005_staff_paystub_history.sql']){
 const source=fs.readFileSync('supabase/migrations/'+file,'utf8');
 for(const statement of source.match(/create policy\s[\s\S]*?;/gi)??[]){const match=statement.match(/\bon public\.([a-z_]+)\s/i);if(match&&tables.includes(match[1]))await db.exec(statement);else if(/on storage\.objects/i.test(statement)&&/for select/i.test(statement)&&/^create policy\s+"?(payroll_|tax_connected_storage_read)/i.test(statement))await db.exec(statement);}
}
await db.exec(fs.readFileSync('supabase/migrations/20261029101200_financial_history_privacy.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/202609250001_staff_daily_snapshot.sql','utf8'));
await db.exec(`update pos_tickets set status='closed',ticket_number='Shared sample',opened_at='2026-10-29T12:00:00Z',closed_at='2026-10-29T13:00:00Z';update pos_ticket_items set pos_ticket_id='${first}',created_at='2026-10-29T12:00:00Z',unit_price=100,line_total=100,quantity=1,service_name_snapshot='Own service';update pos_ticket_staff_earnings set ticket_id='${first}',work_date='2026-10-29',service_total=100,tip_amount=10,total_earning=110,big_turn_count=1,small_turn_count=0;`);
await db.exec(`update payroll_paystubs set file_url_or_path='account/${salon}/'||staff_id::text||'.pdf';insert into storage.objects(bucket_id,name) select 'payroll-paystubs',file_url_or_path from payroll_paystubs;insert into storage.objects(bucket_id,name) values('payroll-paystubs','account/${salon}/unused.pdf'),('public-sample','public.png');`);
const actor=async who=>db.exec(`reset role;select set_config('test.actor','${people[who]}',false);set role authenticated;`);
const count=async table=>(await db.query(`select count(*)::int n from ${table}`)).rows[0].n;

test('real default STAFF membership can read own inputs only and cannot query raw salon totals, shared receipts or coworker snapshots',async()=>{
 await actor('staff');for(const table of scoped)assert.equal(await count(table),1,table);
 for(const table of shared)assert.equal(await count(table),0,table);
 assert.equal(await count('pos_ticket_items'),1);assert.equal(await count('pos_ticket_item_turn_parts'),1);
});
test('adding powerful grants to STAFF cannot widen financial SELECT through legacy FOR ALL policies',async()=>{
 await db.exec(`reset role;insert into role_permissions select '${people.staff}',id from permissions where code<>'tickets.view';`);await actor('staff');
 for(const table of scoped)assert.equal(await count(table),1,table);for(const table of shared)assert.equal(await count(table),0,table);
 assert.equal(await count('pos_ticket_items'),1);assert.equal(await count('pos_ticket_item_turn_parts'),1);
});
test('safe Staff Daily RPC still returns own service/tip and sanitized ticket metadata after raw header denial',async()=>{
 await actor('staff');const result=(await db.query('select get_my_staff_daily_snapshot($1) result',[salon])).rows[0].result;
 assert.equal(result.staff_id,staffA);assert.equal(result.earnings.length,1);assert.equal(result.items.length,1);assert.equal(result.earnings[0].service_total,100);assert.equal(result.earnings[0].tip_amount,10);
 assert.equal(result.earnings[0].ticket.ticket_number,'Shared sample');assert.equal(result.earnings[0].ticket.tip_value,undefined);assert.equal(result.earnings[0].ticket.discount_value,undefined);assert.ok(result.items.every(row=>row.assigned_staff_id===staffA));
});
test('Owner and granted non-Staff Manager keep their existing read permissions; membership alone grants nothing',async()=>{
 for(const who of ['owner','manager']){await actor(who);for(const table of tables)assert.equal(await count(table),2,who+' '+table);}
 await actor('viewer');for(const table of tables)assert.equal(await count(table),0,'ungranted '+table);
 await actor('outsider');for(const table of tables)assert.equal(await count(table),0,'outsider '+table);
});
test('separate Tax Company authorization still reads permitted published runs/lines/paystubs without raw salon closings',async()=>{
 await actor('tax');for(const table of ['payroll_runs','payroll_staff_lines','payroll_paystubs'])assert.equal(await count(table),2,table);
 for(const table of ['pos_daily_closings','pos_ticket_adjustments','pos_ticket_staff_earnings','staff_payroll_settings'])assert.equal(await count(table),0,table);
 await db.exec(`reset role;update payroll_runs set status='draft' where id='${second}';`);await actor('tax');assert.equal(await count('payroll_runs'),1);assert.equal(await count('payroll_staff_lines'),1);
});
test('paystub object listing/signing scope remains own-only even through legacy unused-file policies and custom Staff tax grants',async()=>{
 await actor('staff');const own=(await db.query("select name from storage.objects where bucket_id='payroll-paystubs'")).rows;assert.deepEqual(own.map(row=>row.name),[`account/${salon}/${staffA}.pdf`]);assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='public-sample'")).rows[0].n,1);
 for(const who of ['owner','tax']){await actor(who);assert.equal((await db.query("select count(*)::int n from storage.objects where bucket_id='payroll-paystubs'")).rows[0].n,3);}
});
test('a unique active legacy Staff link retains own-only inputs and safe Daily access without an email fallback',async()=>{
 await db.exec(`reset role;update staff set account_user_id=null,user_id='${people.staff}' where id='${staffA}';`);await actor('staff');
 assert.equal((await db.query('select current_user_staff_id_for_salon($1) id',[salon])).rows[0].id,staffA);
 for(const table of scoped)assert.equal(await count(table),1,'legacy '+table);for(const table of shared)assert.equal(await count(table),0,'legacy '+table);
 assert.equal((await db.query('select get_my_staff_daily_snapshot($1) result',[salon])).rows[0].result.staff_id,staffA);
});
test('ambiguous primary or legacy Staff links fail closed rather than choosing the first row',async()=>{
 const extra='40000000-0000-4000-8000-000000000003';await db.exec(`reset role;update staff set account_user_id='${people.staff}',user_id=null where id='${staffA}';insert into staff(id,salon_id,account_user_id) values('${extra}','${salon}','${people.staff}');`);await actor('staff');
 assert.equal((await db.query('select current_user_staff_id_for_salon($1) id',[salon])).rows[0].id,null);for(const table of scoped)assert.equal(await count(table),0,'ambiguous primary '+table);await assert.rejects(db.query('select get_my_staff_daily_snapshot($1)',[salon]),/unique active staff/);
 await db.exec(`reset role;update staff set account_user_id=null,user_id='${people.staff}' where id in ('${staffA}','${extra}');`);await actor('staff');
 assert.equal((await db.query('select current_user_staff_id_for_salon($1) id',[salon])).rows[0].id,null);assert.equal(await count('staff_payroll_settings'),0);await assert.rejects(db.query('select get_my_staff_daily_snapshot($1)',[salon]),/unique active staff/);
});
test.after(()=>db.close());
