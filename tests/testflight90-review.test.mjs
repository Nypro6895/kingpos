import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';
const load=(file)=>{const code=buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;const s={module:{exports:{}},exports:{},Date,Intl};s.exports=s.module.exports;vm.runInNewContext(code,s);return s.module.exports;};
const {appointmentState,appointmentSummary}=load('lib/appointment-state.ts');
test('appointment buckets partition the total; midnight and explicit terminal states are preserved',()=>{
 const now=Date.parse('2026-11-05T06:50:00Z');
 const records=['confirmed','pending','checked_in','in_service','completed','cancelled','no_show'].map(status=>({status,start_at:'2026-11-05T06:00:00Z'}));
 records.push({status:'scheduled',start_at:'2026-11-05T15:00:00Z'});
 const c=appointmentSummary(records,now);assert.equal(Object.values(c).reduce((a,b)=>a+b,0),records.length);assert.equal(c.overdue,2);assert.equal(c.upcoming,1);assert.equal(c.cancelled,2);
 assert.equal(appointmentState('confirmed',records[0].start_at,now),'overdue');assert.equal(appointmentState('completed',records[0].start_at,now),'completed');assert.equal(records[0].status,'confirmed');
});
test('overdue resolution SQL retains management, concurrency, future-date and terminal-state guards',async()=>{
 const db=new PGlite();try{
 const id='00000000-0000-4000-8000-000000000001';
 await db.exec(`create table bookings(id uuid primary key,salon_id uuid,status text,start_at timestamptz,updated_at timestamptz,staff_id uuid,updated_by_user_id uuid,confirmation_status text,cancellation_reason text,cancelled_at timestamptz,cancelled_by_user_id uuid,no_show_at timestamptz,no_show_by_user_id uuid,no_show_reason text);
 create table booking_status_events(salon_id uuid,booking_id uuid,event_type text,old_status text,new_status text,actor_user_id uuid,actor_source text,metadata jsonb);
 create function current_public_user_id() returns uuid language sql as $$select '${id}'::uuid$$;
 create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select coalesce(current_setting('test.allowed',true),'true')<>'false'$$;
 create function salon_is_operational(uuid) returns boolean language sql as $$select true$$;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261105022000_overdue_booking_resolution.sql','utf8'));
 const run=()=>db.query(`select save_pos_workspace_booking_before_no_show('${id}','2026-11-04Z','{"command":"complete"}')`);
 await db.exec(`insert into bookings(id,salon_id,status,start_at,updated_at) values('${id}','${id}','confirmed',now()-interval '1 hour','2026-11-04Z')`);
 await run();assert.equal((await db.query('select status from bookings')).rows[0].status,'completed');assert.equal((await db.query('select count(*)::int n from booking_status_events')).rows[0].n,1);
 await db.exec(`update bookings set status='confirmed',start_at=now()+interval '1 hour'`);await assert.rejects(run,/cannot be changed/);
 await db.exec(`update bookings set status='cancelled',start_at=now()-interval '1 hour'`);await assert.rejects(run,/cannot be changed/);
 await db.exec(`update bookings set status='pending'`);await db.exec(`select set_config('test.allowed','false',false)`);await assert.rejects(run,/Not authorized/);
 await db.exec(`select set_config('test.allowed','true',false);update bookings set updated_at=now()`);await assert.rejects(run,/another screen/);
 }finally{await db.close();}
});

test('late customer identity earns three qualifying receipts once, with no owner exclusion or cross-account leakage',async()=>{
 const db=new PGlite();try{
 const user='00000000-0000-4000-8000-000000000001',salon='00000000-0000-4000-8000-000000000002',customer='00000000-0000-4000-8000-000000000003';
 await db.exec(`create role anon;create role authenticated;
 create table customers(id uuid primary key,location_id uuid,customer_user_id uuid);
 create table locations(id uuid primary key,name text);
 create table bookings(id uuid,salon_id uuid,customer_id uuid,customer_user_id uuid);
 create function reward_booking_pending(uuid,uuid) returns table(points integer) language sql as $$select 0 where false$$;
 create table customer_visits(id uuid primary key,customer_id uuid,salon_id uuid,ticket_id uuid,status text,appointment_id uuid);
 create table pos_tickets(id uuid primary key,customer_id uuid,salon_id uuid,status text,created_at timestamptz,discount_type text default 'fixed_amount',discount_value numeric default 0,tax_rate numeric default 0,tip_type text default 'fixed_amount',tip_value numeric default 0,source_booking_id uuid);
 create table pos_ticket_items(pos_ticket_id uuid,line_total numeric,is_removed boolean default false,source_kind text);
 create table pos_payments(ticket_id uuid,amount numeric);
 create table gift_card_ledger(ticket_id uuid,salon_id uuid,delta bigint,kind text);
 create table reward_programs(salon_id uuid primary key,enabled boolean,rules jsonb,updated_at timestamptz);
 create table reward_ticket_rules(ticket_id uuid primary key,rules jsonb);
 create table reward_members(salon_id uuid,user_id uuid,joined_at timestamptz default now(),primary key(salon_id,user_id));
 create table reward_ledger(id uuid default gen_random_uuid(),salon_id uuid,user_id uuid,delta int,reason text,event_key text unique,ticket_id uuid,created_at timestamptz default now());
 create table reward_conversions(booking_id uuid,salon_id uuid,author_id uuid,points int,status text,ticket_id uuid);
 create table reward_requests(id uuid,visit_id uuid,salon_id uuid,user_id uuid,status text,ticket_id uuid,offer jsonb);
 create function current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.viewer',true),'')::uuid$$;
 create function reward_lock(uuid,uuid) returns void language sql as $$select$$;
 create function reward_view(p_salon uuid,p_user uuid) returns jsonb language sql as $$select jsonb_build_object('salonId',p_salon,'available',coalesce((select sum(delta) from reward_ledger where salon_id=p_salon and user_id=p_user),0))$$;
 create function reward_request_command(uuid,text,jsonb,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;`);
 const original=fs.readFileSync('supabase/migrations/20261030060000_rewardlumi.sql','utf8');const start=original.indexOf('create function public.reward_join(');await db.exec(original.slice(start,original.indexOf('end $$;',start)+7));
 const settle=fs.readFileSync('supabase/migrations/20261030067000_reward_gift_redemption.sql','utf8');const at=settle.indexOf('create or replace function public.reward_reconcile_ticket');await db.exec(settle.slice(at,settle.indexOf('end $$;',at)+7));
 await db.exec(`insert into locations values('${salon}','Fixture salon');insert into customers values('${customer}','${salon}',null);insert into reward_programs values('${salon}',true,'{"spendCents":2000,"spendPoints":20,"welcomePoints":10,"firstBookingPoints":0,"visitPoints":5}','2026-01-01Z');`);
 for(let i=1;i<=3;i++){const id=`10000000-0000-4000-8000-00000000000${i}`;await db.exec(`insert into pos_tickets(id,customer_id,salon_id,status,created_at) values('${id}','${customer}','${salon}','closed','2026-11-04Z');insert into pos_ticket_items(pos_ticket_id,line_total) values('${id}',40);insert into pos_payments values('${id}',40);insert into customer_visits values('${id}','${customer}','${salon}','${id}','completed',null);insert into reward_ticket_rules select '${id}',rules from reward_programs;`);}
 await db.exec(fs.readFileSync('supabase/migrations/20261105021000_reward_late_identity_reconciliation.sql','utf8'));
 await db.exec(`update customers set customer_user_id='${user}' where id='${customer}';select set_config('test.viewer','${user}',false);`);
 const balance=async()=>Number((await db.query(`select sum(delta)::int n from reward_ledger where user_id='${user}'`)).rows[0].n);
 assert.equal(await balance(),145,'10 welcome plus three (40 service-spend + 5 visit) awards');
 await db.exec(`update customers set customer_user_id=customer_user_id`);for(let i=0;i<2;i++)await db.exec(`select reward_reconcile_ticket(id) from pos_tickets`);assert.equal(await balance(),145,'retries do not duplicate points');
 const first='10000000-0000-4000-8000-000000000001';await db.exec(`update pos_payments set amount=20 where ticket_id='${first}';select reward_reconcile_ticket('${first}')`);assert.equal(await balance(),100,'partial payment reverses only that receipt award');
 const wallet=()=>db.query(`select reward_personal('wallet') data`);assert.equal((await wallet()).rows[0].data.cards.length,1);
 await db.exec(`select set_config('test.viewer','20000000-0000-4000-8000-000000000001',false)`);const foreign=(await wallet()).rows[0].data;assert.equal(foreign.cards.length,0);assert.equal(foreign.uncreditedVisits.length,0);
 await db.exec(`update customers set customer_user_id='20000000-0000-4000-8000-000000000001' where id='${customer}'`);assert.equal((await db.query("select count(*)::int n from reward_ledger where user_id='20000000-0000-4000-8000-000000000001'")).rows[0].n,0,'changing an already linked identity does not duplicate an award');
 await db.exec(`select set_config('test.viewer','',false)`);await assert.rejects(wallet,/Sign in required/);
 }finally{await db.close();}
});

test('closing stays neutral on the salon current business date; ended dates count missing collected as short',()=>{
 const {closingDisplayDifference:diff}=load('lib/closing-display.ts');
 assert.equal(diff(false,220,null),null);assert.equal(diff(false,220,0),null);assert.equal(diff(false,220,220),null);
 assert.equal(diff(true,220,null),-220);assert.equal(diff(true,220,0),-220);assert.equal(diff(true,220,220),0);assert.equal(diff(true,220,240),20);assert.equal(diff(true,.3,.1+.2),0);
});

test('POS Submit disables empty, zero, missing-staff and missing-service carts and guards forced callbacks',async()=>{
 const {createPosDraftSubmitHarness}=await import('./helpers/owner-pos-draft-submit-harness.mjs');
 for(const cartOverrides of [{amount:''},{amount:'0'},{staffId:null},{serviceId:null},{amount:'invalid'}]){
  const h=createPosDraftSubmitHarness({cartOverrides});assert.equal(h.submit(),false);h.submit({force:true});await h.flush();assert.equal(h.attempts.length,0);assert(h.snapshot().error);
 }
});

test('bottom navigation preserves Library, Beauty rewards and all Staff Today sub-tabs',()=>{
 const source=fs.readFileSync('app/navigation-shell.tsx','utf8');
 const activeSource=source.slice(source.indexOf('function isLinkActive('),source.indexOf('function initialsFor('));
 const moreSource=source.slice(source.indexOf('function isRoleMoreActive('),source.indexOf('function customerWorkspaceLabel('));
 const transpile=code=>buildSync({stdin:{contents:code,loader:'ts'},write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
 const context={URLSearchParams,ROLE_NAVIGATION:load('app/role-navigation.ts').ROLE_NAVIGATION,isCustomerMoreRoute:path=>path.startsWith('/more')};
 vm.runInNewContext(transpile(activeSource+moreSource+';globalThis.checkLink=isLinkActive;globalThis.checkMore=isRoleMoreActive;'),context);
 const personal=context.ROLE_NAVIGATION.personal;
 const post='/explore/beauty/p/posts/x',library=new URLSearchParams('from=library');
 assert.equal(personal.links.filter(link=>context.checkLink(link,post,library)).map(link=>link.id).join(','),'beauty-library');
 const rewards=new URLSearchParams('from=beauty');assert.equal(context.checkLink(personal.links.find(link=>link.id==='beauty'),'/rewards',rewards),true);assert.equal(context.checkMore('personal','/rewards',rewards),false);
 for(const tab of ['payroll','analysis','tickets']){const query=new URLSearchParams({tab});assert.equal(context.checkLink(context.ROLE_NAVIGATION.staff.links[0],'/staff/my-work',query),true);assert.equal(context.checkMore('staff','/staff/my-work',query),false);}
});
