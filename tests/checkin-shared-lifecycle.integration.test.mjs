import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fixture as baseFixture,id} from './helpers/service-relay-fixture.mjs';

const actor=(db,n)=>db.query("select set_config('test.actor',$1,false)",[n?id(n):'']);
const query=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0]?.data;
const payload=db=>query(db,'select service_relay_payload($1) data',[id(30)]);
const operations=(db,date=null)=>query(db,'select phone_checkin_operations($1,$2) data',[id(1),date]);
const state=(db,visit=30,key=null,signature=null)=>query(db,'select phone_checkin_visit_state($1,$2,$3,$4) data',[id(1),id(visit),key,signature]);
async function fixture(){
 const db=await baseFixture();
 await db.exec(`alter table pos_tickets add column status text default 'closed';alter table customer_visits add column source text default 'customer_screen';alter table customer_visits add column completed_at timestamptz;
  create function get_salon_business_timezone(uuid) returns text language sql as $$select 'America/Chicago'::text$$;
  create table checkin_receipt_subscriptions(salon_id uuid primary key,paid_until timestamptz);
  create table checkin_receipts(visit_id uuid primary key,salon_id uuid,queue_number integer,business_date date);
  insert into checkin_receipt_subscriptions values('${id(1)}',now()+interval '1 month');
  insert into checkin_receipts values('${id(30)}','${id(1)}',28,current_date);
  create function personal_qr_ensure_receipt_for_visit(uuid,uuid) returns jsonb language plpgsql as $$begin
   if exists(select 1 from checkin_receipt_subscriptions where salon_id=$1 and paid_until>now()) then
    insert into checkin_receipts values($2,$1,coalesce((select max(queue_number) from checkin_receipts where salon_id=$1),0)+1,current_date) on conflict(visit_id) do nothing;
   end if;return null;end$$;`);
 for(const name of ['20261025170000_staff_scan_workspace.sql','20261111060000_phone_checkin_editable_drafts.sql','20261111070000_phone_checkin_unified_pos.sql','20261111190000_phone_checkin_operational_safety.sql','20261111200000_checkin_shared_lifecycle.sql']){
  await db.exec(fs.readFileSync(`supabase/migrations/${name}`, 'utf8').replace(/\r\n/g,'\n'));
 }
 await actor(db,90);return db;
}
const connect=db=>query(db,'select staff_scan_connect($1,$2) data',[id(1),id(30)]);
const save=(db,ticket,staff,amount,done=false,lineId=40)=>query(db,'select staff_scan_save($1,$2,$3,$4,$5) data',[
 id(1),ticket.offers.find(o=>o.staffId===id(staff)).id,JSON.stringify([{id:id(lineId),serviceId:id(20),amount}]),done,ticket.revision]);

test('every actual arrival inserts one unpriced scan ticket atomically, without a Staff/POS read or auto-dispatch',async()=>{
 const db=await fixture();try{
  for(const source of ['customer_screen','walk_in','appointment']){
   const n=source==='customer_screen'?31:source==='walk_in'?32:33;
   await db.query('insert into customer_visits(id,salon_id,customer_id,source) values($1,$2,$3,$4)',[id(n),id(1),id(3),source]);
   assert.equal((await db.query('select scan_mode,status,revision from service_relay_tickets where visit_id=$1',[id(n)])).rows[0].scan_mode,true);
   assert.equal((await db.query('select * from checkin_receipts where visit_id=$1',[id(n)])).rows.length,1);
   await db.query('update customer_visits set status=status where id=$1',[id(n)]);
   assert.equal(Number((await db.query('select count(*) n from service_relay_tickets where visit_id=$1',[id(n)])).rows[0].n),1);
  }
  await db.query('select pos_dispatch_service_relay($1)',[id(1)]);
  assert.equal(Number((await db.query('select count(*) n from service_relay_offers')).rows[0].n),0);
  assert.equal(Number((await db.query('select count(*) n from core_calls')).rows[0].n),0);
  await db.exec(`begin;insert into customer_visits(id,salon_id,customer_id) values('${id(34)}','${id(1)}','${id(3)}');rollback;`);
  assert.equal(Number((await db.query('select count(*) n from service_relay_tickets where visit_id=$1',[id(34)])).rows[0].n),0);
 }finally{await db.close();}
});

test('disabled salon receives no new shared ledger; authorized state is still readable after entitlement expires',async()=>{
 const db=await fixture();try{
  await db.exec("delete from salon_market_plugins;delete from checkin_receipt_subscriptions;");
  await db.query('insert into customer_visits(id,salon_id,customer_id) values($1,$2,$3)',[id(31),id(1),id(3)]);
  assert.equal(Number((await db.query('select count(*) n from service_relay_tickets where visit_id=$1',[id(31)])).rows[0].n),0);
  assert.equal((await state(db)).completed,false);
  await db.exec('delete from service_relay_tickets');
  const result=await state(db,31);assert.equal(result.status,'waiting');assert.equal(result.revision,null);
  assert.equal((await operations(db)).enabled,false);
  await actor(db,null);
  await assert.rejects(state(db),/Not authorized/);
  assert.equal((await state(db,31,id(80),'valid')).visitId,id(31));
  await assert.rejects(state(db,31,id(80),'invalid'),/Not authorized/);
  await actor(db,90);await assert.rejects(state(db,999),/unavailable/);
  await actor(db,12);await assert.rejects(operations(db),/Not authorized/);
 }finally{await db.close();}
});

test('one visit moves waiting → staff Stand by → Done handoff → same-service B → final receipt without double counting',async()=>{
 const db=await fixture();try{
  let op=await operations(db);assert.deepEqual(op.counts,{checkedIn:1,waiting:1,inService:0,readyToPay:0,submitted:0,cancelled:0});
  assert.deepEqual(op.staff,{busy:0,available:2,offDuty:0});
  await actor(db,10);let ticket=await connect(db);ticket=await save(db,ticket,10,'45');
  assert.equal((await operations(db)).counts.inService,1);assert.equal((await operations(db)).staff.busy,1);
  await actor(db,11);await assert.rejects(connect(db),/already connected/);
  await actor(db,90);
  const input=ticket.lines.map(l=>({id:l.id,staffId:l.staffId,serviceId:l.serviceId,amount:String(l.amount)}));
  ticket=(await query(db,'select phone_checkin_update_pos_ticket($1,$2,$3,$4,0,0,false,$5) data',[id(1),id(30),ticket.revision,JSON.stringify(input),'Hold note'])).ticket;
  assert.equal(ticket.offers.find(o=>o.staffId===id(10)).status,'working','cashier save does not finish A');
  await actor(db,10);ticket=await save(db,ticket,10,'45',true);
  op=await operations(db);assert.equal(op.counts.readyToPay,1);assert.equal(op.staff.busy,0);
  await actor(db,11);ticket=await connect(db);ticket=await save(db,ticket,11,'15',false,41);
  op=await operations(db);assert.equal(op.counts.checkedIn,1);assert.equal(op.counts.inService,1);assert.equal(ticket.lines.length,2);
  ticket=await save(db,ticket,11,'15',true,41);await actor(db,90);
  const finalLines=ticket.lines.map(l=>({id:l.id,staffId:l.staffId,serviceId:l.serviceId,amount:String(l.amount)}));
  const final=await query(db,'select phone_checkin_update_pos_ticket($1,$2,$3,$4,0,0,true,$5) data',[id(1),id(30),ticket.revision,JSON.stringify(finalLines),'Final note']);
  op=await operations(db);assert.equal(op.counts.submitted,1);assert.equal(op.counts.checkedIn,1);assert.equal(op.staff.busy,0);
  const now=await state(db);assert.equal(now.ticketId,final.ticketId);assert.equal(now.completed,true);
  assert.equal(Number((await db.query('select count(*) n from core_calls')).rows[0].n),1);
 }finally{await db.close();}
});

test('cashier can save an empty arrival with notes but cannot submit it, and deleting all priced work returns waiting',async()=>{
 const db=await fixture();try{
  let ticket=await payload(db);
  ticket=(await query(db,'select phone_checkin_update_pos_ticket($1,$2,$3,$4,0,0,false,$5) data',[id(1),id(30),ticket.revision,'[]','Ask for square'])).ticket;
  assert.equal(ticket.status,'waiting');assert.equal(ticket.draftNote,'Ask for square');
  await assert.rejects(query(db,'select phone_checkin_update_pos_ticket($1,$2,$3,$4,0,0,true,$5) data',[id(1),id(30),ticket.revision,'[]','Ask for square']),/Add a service/);
  await db.query('select staff_scan_desk_save($1,$2,$3,$4)',[id(1),id(30),ticket.revision,JSON.stringify([{id:id(40),staffId:id(10),serviceId:id(20),amount:'45'}])]);
  ticket=await payload(db);assert.equal(ticket.status,'checkout');
  await db.query('select staff_scan_desk_save($1,$2,$3,$4)',[id(1),id(30),ticket.revision,'[]']);
  assert.equal((await payload(db)).status,'waiting');assert.equal((await operations(db)).counts.waiting,1);
 }finally{await db.close();}
});

test('read-only terminal detection and Today trust closed receipts, not bare completion or stale staff offers',async()=>{
 const db=await fixture();try{
  await db.exec('delete from salon_market_plugins;');
  await actor(db,10);await connect(db);await actor(db,90);
  await db.query('update customer_visits set status=$1,completed_at=now() where id=$2',['completed',id(30)]);
  assert.equal((await db.query('select status from customer_visits where id=$1',[id(30)])).rows[0].status,'in_service','bare completion stays in unpaid lifecycle');
  assert.equal((await db.query('select completed_at from customer_visits where id=$1',[id(30)])).rows[0].completed_at,null);
  await db.query('select staff_scan_reconcile($1)',[id(1)]);
  await db.query('select pos_dispatch_service_relay($1)',[id(1)]);
  assert.equal((await payload(db)).offers[0].status,'working');
  assert.equal((await query(db,'select service_relay_workspace($1,true) data',[id(1)])).tickets.length,1);
  assert.equal((await state(db)).completed,false);assert.equal((await operations(db)).counts.submitted,0);
  await db.query("select set_config('reylumi.service_relay_visit',$1,false)",[id(30)]);
  await db.query('insert into pos_tickets(id,salon_id,customer_id,status) values($1,$2,$3,$4)',[id(99),id(1),id(3),'closed']);
  await db.query('update customer_visits set ticket_id=$1 where id=$2',[id(99),id(30)]);
  const before=JSON.stringify((await db.query('select * from service_relay_tickets')).rows);
  await db.exec('delete from checkin_receipt_subscriptions;');
  assert.equal((await state(db)).completed,true);assert.equal((await operations(db)).staff.busy,0);
  assert.equal((await operations(db)).counts.submitted,1);
  assert.equal(JSON.stringify((await db.query('select * from service_relay_tickets')).rows),before,'read APIs do not reconcile by mutating');
  await db.query('insert into customer_visits(id,salon_id,customer_id,status) values($1,$2,$3,$4)',[id(31),id(1),id(3),'cancelled']);
  assert.equal((await state(db,31)).cancelled,true);assert.equal((await operations(db)).counts.cancelled,1);
  const past=await operations(db,'2000-01-01');assert.equal(past.currentDay,false);assert.equal(past.staff,null);assert.deepEqual(past.staffStates,[]);
 }finally{await db.close();}
});

test('Today counts all visits beyond the preview limit and applies the salon timezone to each arrival',async()=>{
 const db=await fixture();try{
  for(let n=100;n<130;n++) await db.query('insert into customer_visits(id,salon_id,customer_id) values($1,$2,$3)',[id(n),id(1),id(3)]);
  assert.equal((await operations(db)).counts.checkedIn,31);assert.equal((await operations(db)).counts.waiting,31);
  await db.query('insert into customer_visits(id,salon_id,customer_id,checked_in_at) values($1,$2,$3,$4),($5,$2,$3,$6)',[
   id(131),id(1),id(3),'2001-01-02T05:30:00Z',id(132),'2001-01-02T06:30:00Z']);
  assert.equal((await operations(db,'2001-01-01')).counts.checkedIn,1);
  assert.equal((await operations(db,'2001-01-02')).counts.checkedIn,1);
 }finally{await db.close();}
});

test('Today respects explicit clock-out and break, supports checked_in legacy attendance, and preserves forgotten reservations',async()=>{
 const db=await fixture();try{
  await actor(db,10);await connect(db);await actor(db,90);
  await db.query("update staff_workdays set status='checked_out' where staff_id=$1",[id(10)]);
  let op=await operations(db);const worker=op.staffStates.find(s=>s.staffId===id(10));
  assert.equal(worker.state,'offDuty');assert.deepEqual(worker.visitIds,[id(30)]);assert.equal(op.staff.busy,0);
  await actor(db,11);await assert.rejects(connect(db),/already connected/,'attendance display does not silently release another staff reservation');await actor(db,90);
  await db.query("update staff_workdays set status='checked_in' where staff_id=$1",[id(11)]);
  assert.equal((await operations(db)).staffStates.find(s=>s.staffId===id(11)).state,'available');
  await db.query("update staff_workdays set status='break' where staff_id=$1",[id(11)]);
  assert.equal((await operations(db)).staffStates.find(s=>s.staffId===id(11)).state,'offDuty');
  await db.exec('delete from staff_workdays;');assert.equal((await operations(db)).staff.offDuty,2);
  await db.exec('update pos_settings set staff_check_in_enabled=false;');op=await operations(db);
  assert.deepEqual(op.staff,{busy:1,available:1,offDuty:0});
 }finally{await db.close();}
});
