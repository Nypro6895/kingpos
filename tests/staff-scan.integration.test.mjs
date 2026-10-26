import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixture as relayFixture, id } from './helpers/service-relay-fixture.mjs';

async function fixture() {
  const db = await relayFixture();
  await db.exec(`create table checkin_receipt_subscriptions(salon_id uuid primary key,paid_until timestamptz);
    create table checkin_receipts(visit_id uuid primary key,salon_id uuid,queue_number integer,business_date date);
    insert into checkin_receipt_subscriptions values('${id(1)}',now()+interval '1 month');
    insert into checkin_receipts values('${id(30)}','${id(1)}',28,current_date);`);
  await db.exec(fs.readFileSync('supabase/migrations/20261025170000_staff_scan_workspace.sql','utf8'));
  await actor(db,10);
  return db;
}
const actor=(db,n)=>db.query("select set_config('test.actor',$1,false)",[id(n)]);
const read=async db=>(await db.query('select staff_scan_workspace($1) data',[id(1)])).rows[0].data;
const connect=async db=>(await db.query('select staff_scan_connect($1,$2) data',[id(1),id(30)])).rows[0].data;
const lines=(amount='60',service=20,n=40)=>[{id:id(n),serviceId:id(service),amount}];
const save=async(db,ticket,done=false,values=lines())=>(await db.query('select staff_scan_save($1,$2,$3,$4,$5) data',[id(1),ticket.offers.find(o=>o.status==='working')?.id ?? ticket.offers[0].id,JSON.stringify(values),done,ticket.revision])).rows[0].data;
const projection=async db=>(await db.query('select pos_workspace_staff_snapshot($1,null,null) data',[id(1)])).rows[0].data.staff.find(s=>s.id===id(10));

test('Scan uses receipt entitlement, lists unpaid visits and reserves Holding without counting a completed turn',async()=>{
 const db=await fixture();try{
  await db.exec("delete from salon_market_plugins where plugin_id='service-relay'");
  const data=await read(db);assert.equal(data.enabled,true);assert.equal(data.waiting[0].queueNumber,28);assert.equal(data.services.length,2);
  assert.deepEqual(data.waiting[0].requestedServices.map(s=>s.name),['Full Set','Pedi']);
  let ticket=await connect(db);assert.equal(ticket.queueNumber,28);assert.equal(ticket.scanMode,true);assert.equal(ticket.offers[0].status,'working');
  assert.equal((await connect(db)).offers.length,1,'repeated connection is idempotent');
  let staff=await projection(db);assert.equal(staff.service_status,'working');assert.equal(staff.turns.holdingTurns,1);assert.equal(staff.turns.pendingTurns,0);assert.equal(staff.turns.largeTurns,0);
  ticket=await save(db,ticket);staff=await projection(db);assert.equal(staff.turns.pendingTurns,0);assert.equal(staff.turns.holdingTurns,1);
  ticket=await save(db,ticket,true);staff=await projection(db);assert.equal(staff.turns.pendingTurns,1);assert.equal(staff.turns.holdingTurns,0);assert.equal(staff.turns.largeTurns,1);
  const again=await db.query('select staff_scan_save($1,$2,$3,true,$4) data',[id(1),ticket.offers[0].id,JSON.stringify(lines()),ticket.revision-1]);
  assert.equal(again.rows[0].data.revision,ticket.revision);assert.equal((await projection(db)).turns.pendingTurns,1);
  assert.equal((await connect(db)).offers.length,1,'scanning finished work again never creates another turn');
  assert.equal((await projection(db)).turns.holdingTurns,0);
 }finally{await db.close();}
});

test('POS collects saved amounts before Staff Done; reconnect removes work and stale phone writes cannot resurrect it',async()=>{
 const db=await fixture();try{
  let ticket=await connect(db);ticket=await save(db,ticket,false,[...lines(),...lines('35',21,41)]);
  const offer=ticket.offers[0].id;assert.equal(ticket.status,'in_service');
  await actor(db,90);
  const desk=(await db.query('select service_relay_workspace($1,true) data',[id(1)])).rows[0].data;
  assert.equal(desk.staff.length,2);assert.equal(desk.tickets[0].lines.length,2);
  const result=(await db.query('select service_relay_submit($1,$2,$3,5,0) data',[id(1),id(30),ticket.revision])).rows[0].data;
  const retry=(await db.query('select service_relay_submit($1,$2,$3,5,0) data',[id(1),id(30),ticket.revision])).rows[0].data;
  assert.equal(result.ticketId,retry.ticketId);assert.equal((await db.query('select * from core_calls')).rows.length,1);
  const receipt=(await db.query('select receipt from core_calls')).rows[0].receipt;
  assert.deepEqual(receipt.lines.map(l=>l.total),[60,35]);assert.equal(receipt.customerVisitId,id(30));
  await actor(db,10);const data=await read(db);assert.equal(data.current.length,0);assert.equal(data.waiting.length,0);
  await assert.rejects(db.query('select staff_scan_save($1,$2,$3,false,$4)',[id(1),offer,JSON.stringify(lines('999')),ticket.revision]),/POS has saved/);
  await assert.rejects(connect(db),/no longer available/);
  assert.equal((await projection(db)).turns.holdingTurns,0);assert.equal((await projection(db)).turns.pendingTurns,0);
 }finally{await db.close();}
});

test('POS can replace services, price and staff from Stand by, while stale staff revisions and unauthorized callers are rejected',async()=>{
 const db=await fixture();try{
  const ticket=await connect(db);const offer=ticket.offers[0].id;
  const values=[{...lines('75',21)[0],staffId:id(11)}];
  await assert.rejects(db.query('select staff_scan_desk_save($1,$2,$3,$4)',[id(1),id(30),ticket.revision,JSON.stringify(values)]),/Not authorized/);
  await actor(db,90);
  await assert.rejects(db.query('select staff_scan_desk_save($1,$2,$3,$4)',[id(1),id(30),ticket.revision-1,JSON.stringify(values)]),/Ticket changed/);
  await db.query('select staff_scan_desk_save($1,$2,$3,$4)',[id(1),id(30),ticket.revision,JSON.stringify(values)]);
  const latest=(await db.query('select service_relay_workspace($1,true) data',[id(1)])).rows[0].data.tickets[0];
  assert.equal(latest.status,'checkout');assert.equal(latest.lines[0].staffId,id(11));assert.equal(latest.lines[0].serviceId,id(21));assert.equal(latest.lines[0].amount,75);
  await actor(db,10);
  await assert.rejects(db.query('select staff_scan_save($1,$2,$3,false,$4)',[id(1),offer,JSON.stringify(lines('999')),ticket.revision]),/POS changed/);
  await actor(db,90);await db.query('select service_relay_submit($1,$2,$3)',[id(1),id(30),latest.revision]);
  await actor(db,10);assert.equal((await read(db)).current.length,0);
 }finally{await db.close();}
});

test('Cancel frees an empty Holding; requested/additional services obey staff and salon scope; dispatcher leaves Scan alone',async()=>{
 const db=await fixture();try{
  let ticket=await connect(db);
  await assert.rejects(save(db,ticket,false,lines('10',22)),/not enabled/);
  for(const amount of ['0','-1','1.999','invalid']) await assert.rejects(save(db,ticket,false,lines(amount)),/positive amount/);
  await db.query('select staff_scan_cancel($1,$2,$3)',[id(1),ticket.offers[0].id,ticket.revision]);
  assert.equal((await projection(db)).turns.holdingTurns,0);
  await actor(db,90);await db.query('select service_relay_workspace($1,true)',[id(1)]);
  assert.equal((await db.query("select count(*) n from service_relay_offers where status='offered'")).rows[0].n,0);
  await actor(db,10);ticket=await connect(db);ticket=await save(db,ticket);
  await assert.rejects(db.query('select staff_scan_cancel($1,$2,$3)',[id(1),ticket.offers.find(o=>o.status==='working').id,ticket.revision]),/Saved work remains/);
  await actor(db,11);await assert.rejects(connect(db),/already connected/);
  await actor(db,12);await assert.rejects(connect(db),/unavailable/);
  await assert.rejects(read(db),/Staff workspace/);
 }finally{await db.close();}
});

test('Portable POS retains its capability check and can settle a disconnected Scan; QR tokens stay scoped',async()=>{
 const db=await fixture();try{
  let ticket=await connect(db);ticket=await save(db,ticket);
  const token=(await db.query('select pass_token from service_relay_tickets')).rows[0].pass_token;
  assert.equal((await db.query('select staff_scan_connect_pass($1,$2) data',[id(1),token])).rows[0].data.visitId,id(30));
  await actor(db,12);await assert.rejects(db.query('select staff_scan_connect_pass($1,$2)',[id(2),token]),/unavailable/);
  await db.exec("select set_config('test.actor','',false)");
  await assert.rejects(db.query('select staff_scan_desk_save($1,$2,$3,$4,$5,$6)',[id(1),id(30),ticket.revision,JSON.stringify([{...lines()[0],staffId:id(10)}]),id(80),'bad']),/Not authorized/);
  await db.query('select service_relay_submit($1,$2,$3,0,0,$4,$5)',[id(1),id(30),ticket.revision,id(80),'valid']);
  assert.equal((await db.query('select kind from core_calls')).rows[0].kind,'portable');
 }finally{await db.close();}
});

test('A ticket attached by another authorized POS path is removed on reconciliation without phone Done',async()=>{
 const db=await fixture();try{
  const ticket=await save(db,await connect(db));
  // A separately saved POS ticket is linked to this visit by its owning path.
  await db.query('insert into pos_tickets values($1,$2,null)',[id(99),id(1)]);
  await db.query('update customer_visits set ticket_id=$1 where id=$2',[id(99),id(30)]);
  await actor(db,90);
  const result=(await db.query('select service_relay_submit($1,$2,$3) data',[id(1),id(30),ticket.revision])).rows[0].data;
  assert.equal(result.ticketId,id(99));assert.equal((await db.query('select count(*) n from core_calls')).rows[0].n,0,'never settle a second receipt for a visit already attached to POS');
  await actor(db,10);
  assert.equal((await read(db)).current.length,0);
  assert.equal((await db.query('select status from service_relay_offers where id=$1',[ticket.offers[0].id])).rows[0].status,'expired');
 }finally{await db.close();}
});

test('Done projects small turns once and settlement removes that provisional count',async()=>{
 const db=await fixture();try{
  let ticket=await connect(db);ticket=await save(db,ticket,true,lines('15'));
  let staff=await projection(db);assert.equal(staff.turns.pendingTurns,0);assert.equal(staff.turns.pendingSmallTurns,1);assert.equal(staff.turns.smallTurns,1);assert.equal(staff.turns.totalTurns,1);assert.equal(staff.turns.holdingTurns,0);
  await actor(db,90);await db.query('select service_relay_submit($1,$2,$3)',[id(1),id(30),ticket.revision]);
  staff=await projection(db);assert.equal(staff.turns.pendingSmallTurns,0);
 }finally{await db.close();}
});
