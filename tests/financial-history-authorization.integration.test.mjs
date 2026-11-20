import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const salon=id(100),account=id(101),owner=id(1),staffUser=id(2),reportsManager=id(3),salonManager=id(4),staffA=id(10),staffB=id(11),managerRole=id(20),staffRole=id(21);
await db.exec(`
create role authenticated;create role anon;grant usage on schema public to authenticated;
create table users(id uuid primary key,display_name text);
create table locations(id uuid primary key,account_id uuid);
create table roles(id uuid primary key,code text);
create table account_memberships(account_id uuid,user_id uuid,role_id uuid,status text);
create table salon_memberships(salon_id uuid,user_id uuid,role_id uuid,status text);
create table staff(id uuid primary key,salon_id uuid,display_name text,account_user_id uuid);
create table user_permissions(user_id uuid,permission text);
create table app_notifications(id uuid default gen_random_uuid(),account_id uuid,salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text unique);
create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function payroll_live_is_owner(s uuid) returns boolean language sql stable as $$select s='${salon}'::uuid and current_public_user_id()='${owner}'::uuid$$;
create function current_user_staff_id_for_salon(s uuid) returns uuid language sql stable security definer as $$select id from public.staff where salon_id=s and account_user_id=current_public_user_id()$$;
create function user_has_salon_permission(s uuid,permissions text[]) returns boolean language sql stable security definer as $$select s='${salon}'::uuid and exists(select 1 from public.user_permissions p where p.user_id=current_public_user_id() and p.permission=any(permissions))$$;
insert into users values('${owner}','Owner'),('${staffUser}','Anna'),('${reportsManager}','Reports Manager'),('${salonManager}','Salon Manager');
insert into locations values('${salon}','${account}');
insert into roles values('${managerRole}','MANAGER'),('${staffRole}','STAFF');
insert into account_memberships values('${account}','${reportsManager}','${managerRole}','active'),('${account}','${staffUser}','${staffRole}','active'),('${account}','${salonManager}','${staffRole}','active');
insert into salon_memberships values('${salon}','${salonManager}','${managerRole}','active');
insert into staff values('${staffA}','${salon}','Anna','${staffUser}'),('${staffB}','${salon}','Lily',null);
insert into user_permissions values('${reportsManager}','reports.view'),('${salonManager}','reports.view'),('${staffUser}','tickets.view'),('${staffUser}','reports.view'),('${staffUser}','payroll.view');
`);
await db.exec(fs.readFileSync('supabase/migrations/20261029100000_financial_input_history.sql','utf8'));
await db.exec(`select set_config('test.actor','${owner}',false);`);
for(const kind of ['ticket','staff_day','daily_report','payroll_settings'])await db.query('select record_financial_input_event($1,$2,$3,$4,$5,$6,$7,$8)',[salon,kind,'2026-10-01',id(200),{service_total:0},{service_total:100},'Fixture note',[{staff_id:staffA,before_values:{service_total:0},after_values:{service_total:40}},{staff_id:staffB,before_values:{service_total:0},after_values:{service_total:60}}]]);
const actor=async user=>db.exec(`reset role;select set_config('test.actor','${user}',false);set role authenticated;`);

test('account Manager with reports only reads operational events and all affected operational staff, excluding pay settings',async()=>{
 await actor(reportsManager);const events=(await db.query('select kind from financial_input_events')).rows;assert.deepEqual(new Set(events.map(row=>row.kind)),new Set(['ticket','staff_day','daily_report']));
 const projections=(await db.query('select kind,staff_id from financial_input_event_staff')).rows;assert.equal(projections.length,6);assert.equal(projections.some(row=>row.kind==='payroll_settings'),false);assert.equal(new Set(projections.map(row=>row.staff_id)).size,2);
});
test('salon-level Manager with account STAFF role gets equivalent admitted operational access',async()=>{
 await actor(salonManager);assert.equal((await db.query('select * from financial_input_events')).rows.length,3);assert.equal((await db.query('select * from financial_input_event_staff')).rows.length,6);
});
test('STAFF role cannot broaden history even with tickets/report/payroll permission bits',async()=>{
 await actor(staffUser);assert.equal((await db.query('select * from financial_input_events')).rows.length,0);const own=(await db.query('select * from financial_input_event_staff')).rows;assert.equal(own.length,4);assert.ok(own.every(row=>row.staff_id===staffA));
 await assert.rejects(db.exec('update financial_input_event_staff set staff_name=\'Forged\''),/permission denied/);
 await assert.rejects(db.query('select record_financial_input_event($1,$2,$3,$4,$5,$6,$7)',[salon,'staff_day','2026-10-01',id(200),{}, {service_total:999},'Forged']),/permission denied/);
});
test.after(()=>db.close());
