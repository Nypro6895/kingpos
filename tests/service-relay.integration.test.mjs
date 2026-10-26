import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, id } from "./helpers/service-relay-fixture.mjs";
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
