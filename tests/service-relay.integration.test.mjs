import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function fixture() {
 const db = new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function current_public_user_id() returns uuid language sql as $$select auth.uid()$$;
 create function user_has_salon_permission(uuid,text[]) returns boolean language sql as $$select auth.uid()='${id(90)}'::uuid$$;
 create function pos_portable_access_salon_id(uuid,text) returns uuid language sql as $$select case when $1='${id(80)}'::uuid and $2='valid' then '${id(1)}'::uuid end$$;
 create function pos_portable_access_has_capability(uuid,text,text) returns boolean language sql as $$select $1='${id(80)}'::uuid and $2='valid'$$;
 create function get_salon_business_date(uuid) returns date language sql as $$select current_date$$;
 create table locations(id uuid primary key,name text);
 create table customers(id uuid primary key,location_id uuid,name text);
 create table staff(id uuid primary key,salon_id uuid,account_user_id uuid,user_id uuid,is_active boolean default true,pos_enabled boolean default true,display_name text);
 create table services(id uuid primary key,salon_id uuid,name text,is_active boolean default true,base_price numeric);
 create table pos_tickets(id uuid primary key,salon_id uuid,customer_id uuid);
 create table customer_visits(id uuid primary key,salon_id uuid,customer_id uuid,status text default 'waiting',ticket_id uuid,checked_in_at timestamptz default now(),origin_metadata jsonb);
 create table customer_visit_services(id uuid default gen_random_uuid(),visit_id uuid,service_id uuid,sort_order integer);
 create table pos_settings(salon_id uuid,staff_check_in_enabled boolean,large_turn_threshold numeric);
 create table staff_workdays(staff_id uuid,salon_id uuid,work_date date default current_date,status text default 'working',queue_turn_count integer,check_in_sequence integer);
 create table staff_service_assignments(staff_id uuid,salon_id uuid,service_id uuid,is_active boolean default true,effective_start_date date,effective_end_date date);
 create table pos_ticket_item_turn_parts(staff_id uuid,salon_id uuid,work_date date,turn_type text);
 create table pos_live_drafts(token text,salon_id uuid,status text);
 create table salon_market_plugins(salon_id uuid,plugin_id text constraint salon_market_plugins_plugin_id_check check(plugin_id='payroll-data-download'),primary key(salon_id,plugin_id));
 create function customer_visit_requested_services_json(uuid) returns jsonb language sql as $$select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)),'[]'::jsonb) from customer_visit_services v join services s on s.id=v.service_id where v.visit_id=$1$$;
 create table core_calls(receipt jsonb,kind text);
 create function submit_owner_workspace_receipt_core(uuid,text,jsonb,date) returns jsonb language plpgsql as $$declare ticket uuid:=gen_random_uuid();begin insert into core_calls values($3,'owner');insert into pos_tickets values(ticket,$1,($3->>'customerId')::uuid);return jsonb_build_object('ticketId',ticket);end$$;
 create function submit_pos_portable_receipt(uuid,text,jsonb,date) returns jsonb language plpgsql as $$declare result jsonb;begin result:=submit_owner_workspace_receipt_core(pos_portable_access_salon_id($1,$2),$2,$3,$4);update core_calls set kind='portable';return result;end$$;
 create function complete_customer_visit_for_ticket_core(uuid,uuid,uuid,uuid) returns jsonb language plpgsql as $$begin update customer_visits set status='completed',ticket_id=$3 where id=$4;return jsonb_build_object('ok',true);end$$;
 insert into locations values('${id(1)}','Salon A'),('${id(2)}','Salon B');
 insert into customers values('${id(3)}','${id(1)}','Linh');
 insert into staff(id,salon_id,account_user_id,display_name) values('${id(10)}','${id(1)}','${id(10)}','Anna'),('${id(11)}','${id(1)}','${id(11)}','Bella'),('${id(12)}','${id(2)}','${id(12)}','Other salon');
 insert into services(id,salon_id,name,base_price) values('${id(20)}','${id(1)}','Full Set',40),('${id(21)}','${id(1)}','Pedi',35),('${id(22)}','${id(2)}','Other',99);
 insert into pos_settings values('${id(1)}',true,25);
 insert into staff_workdays(staff_id,salon_id,queue_turn_count,check_in_sequence) values('${id(10)}','${id(1)}',0,1),('${id(11)}','${id(1)}',1,2);
 insert into staff_service_assignments(staff_id,salon_id,service_id) values('${id(10)}','${id(1)}','${id(20)}'),('${id(10)}','${id(1)}','${id(21)}'),('${id(11)}','${id(1)}','${id(20)}'),('${id(11)}','${id(1)}','${id(21)}');
 insert into customer_visits(id,salon_id,customer_id,origin_metadata) values('${id(30)}','${id(1)}','${id(3)}','{"token":"display-a"}');
 insert into customer_visit_services(visit_id,service_id,sort_order) values('${id(30)}','${id(20)}',1),('${id(30)}','${id(21)}',2);
 insert into pos_live_drafts values('display-a','${id(1)}','draft');
 `);
 await db.exec(fs.readFileSync("supabase/migrations/20261009150031_service_relay.sql", "utf8"));
 await db.exec(`
 create function pos_workspace_staff_snapshot(uuid,uuid,uuid[]) returns jsonb language sql as $$select jsonb_build_object('staff',jsonb_agg(jsonb_build_object('id',s.id,'turns',jsonb_build_object('queueTurns',w.queue_turn_count,'largeTurns',w.queue_turn_count,'totalTurns',w.queue_turn_count)))) from staff s join staff_workdays w on w.staff_id=s.id where s.salon_id=$1$$;
 create function get_pos_portable_desk_data(uuid,text,date) returns jsonb language sql as $$select pos_workspace_staff_snapshot(pos_portable_access_salon_id($1,$2),$1,null)$$;
 create function get_customer_display_service_catalog(text) returns table(id uuid,name text,category text,base_price numeric,duration_minutes integer) language sql as $$select s.id,s.name,null::text,s.base_price,30 from services s join pos_live_drafts d on d.salon_id=s.salon_id where d.token=$1$$;
 create function resolve_customer_display_check_in(text,text,text,text) returns jsonb language sql as $$select jsonb_build_object('ok',true,'visit',jsonb_build_object('id','${id(30)}'))$$;
 create function update_customer_visit_requested_services(text,uuid,uuid[]) returns jsonb language sql as $$select jsonb_build_object('ok',true)$$;
 `);
 await db.exec(fs.readFileSync("supabase/migrations/20261009150032_service_relay_phone_checkin.sql", "utf8"));
 await db.exec(fs.readFileSync("supabase/migrations/20261009150033_service_relay_pos_projection.sql", "utf8"));
 await db.exec(`create table users(id uuid primary key,auth_user_id uuid);insert into users values('${id(10)}','${id(10)}'),('${id(11)}','${id(11)}');create table app_notifications(salon_id uuid,recipient_user_id uuid,recipient_kind text,notification_type text,title text,body text,href text,event_key text,read_at timestamptz);`);
 await db.exec(fs.readFileSync("supabase/migrations/20261009150034_service_relay_notifications.sql", "utf8"));
 await db.exec(fs.readFileSync("supabase/migrations/20261009150035_service_relay_pos_guard.sql", "utf8"));
 await db.exec(fs.readFileSync("supabase/migrations/20261009150036_service_relay_receipt_visit.sql", "utf8"));
 await db.exec(`insert into salon_market_plugins values('${id(1)}','service-relay');`);
 return db;
}
async function actor(db, n) { await db.query("select set_config('test.actor',$1,false)", [id(n)]); }
async function workspace(db, desk = false) { return (await db.query("select service_relay_workspace($1,$2) data", [id(1), desk])).rows[0].data; }
const lines = (service = 20, amount = "40", n = 40) => [{ id: id(n), serviceId: id(service), amount }];
test("POS offers by queue; decline reassigns without changing official turns", async () => {
 const db = await fixture(); try {
  await actor(db,90); let data = await workspace(db,true); assert.equal(data.tickets[0].offers[0].staffId,id(10));
  const offer=data.tickets[0].offers[0].id;
  const notices=(await db.query("select recipient_user_id,notification_type from app_notifications")).rows;
  assert.deepEqual(notices,[{recipient_user_id:id(10),notification_type:'service_relay_offer'}]);
  await actor(db,11); await assert.rejects(db.query("select service_relay_respond($1,$2,true)",[id(1),offer]),/Not authorized/);
  await actor(db,10); await db.query("select service_relay_respond($1,$2,false)",[id(1),offer]);
  await actor(db,90); data=await workspace(db,true); assert.equal(data.tickets[0].offers[0].staffId,id(11));
  assert.deepEqual((await db.query("select queue_turn_count from staff_workdays order by staff_id")).rows.map(r=>r.queue_turn_count),[0,1]);
  assert.ok((await db.query("select read_at from app_notifications where recipient_user_id=$1",[id(10)])).rows[0].read_at);
 } finally {await db.close();}
});
test("multiple staff share one ticket; official POS core receives each service and price once", async () => {
 const db = await fixture(); try {
  await db.exec(`update staff_workdays set queue_turn_count=0 where staff_id='${id(11)}'`);
  await actor(db,10); let data=await workspace(db); let ticket=data.tickets[0],offer=ticket.offers[0];
  await db.query("select service_relay_respond($1,$2,true)",[id(1),offer.id]);
  ticket=(await workspace(db)).tickets[0];
  await assert.rejects(db.query("insert into pos_tickets values($1,$2,$3)",[id(99),id(1),id(3)]),/active Service Relay ticket/);
  await db.query("select service_relay_save($1,$2,$3,true,$4)",[id(1),offer.id,JSON.stringify(lines()),ticket.revision]);
  await actor(db,90); ticket=(await workspace(db,true)).tickets[0]; assert.equal(ticket.status,'in_service');
  offer=ticket.offers.find(o=>o.status==='offered'); assert.equal(offer.staffId,id(11));
  await assert.rejects(db.query("select service_relay_submit($1,$2,$3)",[id(1),id(30),ticket.revision]),/still in progress/);
  await actor(db,11); await db.query("select service_relay_respond($1,$2,true)",[id(1),offer.id]);
  ticket=(await workspace(db)).tickets[0];
  await assert.rejects(db.query("select service_relay_save($1,$2,$3,true,$4)",[id(1),offer.id,JSON.stringify(lines(22,"35",41)),ticket.revision]),/not available/);
  await db.query("select service_relay_save($1,$2,$3,true,$4)",[id(1),offer.id,JSON.stringify(lines(21,"35",41)),ticket.revision]);
  await actor(db,90); ticket=(await workspace(db,true)).tickets[0]; assert.equal(ticket.status,'checkout');assert.equal(ticket.lines.length,2);
  const result=(await db.query("select service_relay_submit($1,$2,$3,5,0) data",[id(1),id(30),ticket.revision])).rows[0].data;
  const retry=(await db.query("select service_relay_submit($1,$2,$3,5,0) data",[id(1),id(30),ticket.revision])).rows[0].data;
  assert.equal(retry.ticketId,result.ticketId);
  const calls=(await db.query("select * from core_calls")).rows;assert.equal(calls.length,1);assert.equal(calls[0].receipt.lines.length,2);assert.deepEqual(calls[0].receipt.lines.map(l=>l.total),[40,35]);
  assert.equal(calls[0].receipt.customerVisitId,id(30));
  assert.equal((await db.query("select count(*) count from pos_ticket_item_turn_parts")).rows[0].count,0); // fixture core owns accounting, never relay
 } finally {await db.close();}
});
test("price edits require revision, cannot overwrite another offer, and two services stay separate", async () => {
 const db=await fixture();try{
  await actor(db,10);let ticket=(await workspace(db)).tickets[0];const offer=ticket.offers[0];
  await db.query("select service_relay_respond($1,$2,true)",[id(1),offer.id]);ticket=(await workspace(db)).tickets[0];
  for(const bad of [null,ticket.revision-1]) await assert.rejects(db.query("select service_relay_save($1,$2,$3,false,$4)",[id(1),offer.id,JSON.stringify(lines()),bad]),/Ticket changed/);
  await assert.rejects(db.query("select service_relay_save($1,$2,null,false,$3)",[id(1),offer.id,ticket.revision]),/Add a service/);
  await assert.rejects(db.query("select service_relay_save($1,$2,$3,false,$4)",[id(1),offer.id,JSON.stringify(lines(20,"0")),ticket.revision]),/positive price/);
  await db.query("select service_relay_save($1,$2,$3,false,$4)",[id(1),offer.id,JSON.stringify([...lines(),...lines(21,"35",41)]),ticket.revision]);
  assert.equal((await db.query("select pos_service_relay_pending_turns($1,$2) n",[id(1),id(10)])).rows[0].n,2);
  const projected=(await db.query("select pos_workspace_staff_snapshot($1,null,null) data",[id(1)])).rows[0].data.staff.find(s=>s.id===id(10));
  assert.equal(projected.turns.pendingTurns,2);assert.equal(projected.turns.queueTurns,2);assert.equal(projected.service_status,'working');
  ticket=(await workspace(db)).tickets[0];await db.query("select service_relay_save($1,$2,$3,true,$4)",[id(1),offer.id,JSON.stringify([...lines(),...lines(21,"35",41)]),ticket.revision]);
  await actor(db,90);ticket=(await workspace(db,true)).tickets[0];assert.equal(ticket.status,'checkout');assert.equal(ticket.offers.length,1);
 }finally{await db.close();}
});
test("offer expiry, public pass privacy, manual salon scope, portable settlement and removal",async()=>{
 const db=await fixture();try{
  await actor(db,90);let ticket=(await workspace(db,true)).tickets[0];const old=ticket.offers[0];
  await db.query("update service_relay_offers set expires_at=now()-interval '1 minute' where id=$1",[old.id]);
  await actor(db,10);await assert.rejects(db.query("select service_relay_respond($1,$2,true)",[id(1),old.id]),/offer has changed/);
  await workspace(db); await actor(db,90);ticket=(await workspace(db,true)).tickets[0];assert.equal(ticket.offers[0].staffId,id(11));
  const pass=(await db.query("select service_relay_issue_pass('display-a',$1) data",[id(30)])).rows[0].data;
  await assert.rejects(db.query("select service_relay_issue_pass('wrong',$1)",[id(30)]),/does not belong/);
  const payload=(await db.query("select service_relay_public_pass($1) data",[pass.passToken])).rows[0].data;assert.equal(payload.lines,undefined);assert.equal(payload.customerPhone,undefined);
  await actor(db,12);await assert.rejects(db.query("select service_relay_claim($1,$2)",[id(2),String(ticket.queueNumber)]),/Not authorized/);
  await db.exec("update service_relay_offers set status='declined' where status='offered'");
  await actor(db,10);await db.query("select service_relay_claim($1,$2)",[id(1),String(ticket.queueNumber)]);
  ticket=(await workspace(db)).tickets[0];const offer=ticket.offers.find(o=>o.status==='working');
  await db.query("select service_relay_save($1,$2,$3,true,$4)",[id(1),offer.id,JSON.stringify([...lines(),...lines(21,"35",41)]),ticket.revision]);
  await assert.rejects(db.exec("delete from salon_market_plugins where plugin_id='service-relay'"),/Finish open service tickets/);
  await actor(db,90);ticket=(await workspace(db,true)).tickets[0];assert.equal(ticket.status,'checkout');
  await assert.rejects(db.query("select service_relay_submit($1,$2,null)",[id(1),id(30)]),/Ticket changed/);
  await db.exec("select set_config('test.actor','',false)");
  await db.query("select service_relay_submit($1,$2,$3,0,0,$4,'valid')",[id(1),id(30),ticket.revision,id(80)]);
  assert.equal((await db.query("select kind from core_calls")).rows[0].kind,'portable');
  await db.exec("delete from salon_market_plugins where plugin_id='service-relay'");
 }finally{await db.close();}
});
test("phone QR check-in wraps existing check-in and hides the POS display token",async()=>{
 const db=await fixture();try{
  const entry=(await db.query("select service_relay_entry('display-a') id")).rows[0].id;
  const catalog=(await db.query("select service_relay_entry_catalog($1) data",[entry])).rows[0].data;
  assert.equal(catalog.salonName,'Salon A'); assert.equal(catalog.display_token,undefined);assert.equal(catalog.services.length,2);assert.equal(catalog.services[0].name,'Full Set');
  await assert.rejects(db.query("select service_relay_phone_checkin($1,'5551234567','Linh',$2,'request')",[entry,[id(22)]]),/no longer available/);
  const result=(await db.query("select service_relay_phone_checkin($1,'5551234567','Linh',$2,'request') data",[entry,[id(20),id(21)]])).rows[0].data;
  assert.equal(result.ok,true);assert.ok(result.pass.passToken);
  await db.exec("update service_relay_entries set expires_at=now()-interval '1 minute'");
  await assert.rejects(db.query("select service_relay_phone_checkin($1,'5551234567','Linh',$2,'request')",[entry,[id(20)]]),/expired/);
  await db.exec("select set_config('test.actor','',false)");
  await assert.rejects(db.query("select service_relay_workspace($1,null)",[id(1)]),/Not authorized/);
 }finally{await db.close();}
});
