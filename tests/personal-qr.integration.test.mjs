import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,id,actor} from './helpers/personal-qr-fixture.mjs';
const one=async(db,sql,args=[])=>(await db.query(sql,args)).rows[0].data;
const workspace=db=>one(db,'select personal_qr_workspace() data');
const entry=db=>one(db,"select service_relay_entry('display-a') data");
const checkin=(db,e,request=200,services=[id(20)])=>one(db,'select personal_qr_checkin($1,$2,$3) data',[e,services,id(request)]);

test('Personal check-in uses the account, existing visit core and original history receipt through Staff and POS',async()=>{
 const db=await fixture();try{
  await actor(db,100);const e=await entry(db),v=await checkin(db,e);
  assert.equal(await checkin(db,e),v);assert.equal(await checkin(db,e,201),v,'repeat scan reuses active visit');
  let data=await workspace(db);let visit=data.visits.find(x=>x.visitId===v);assert.equal(visit.status,'waiting');assert.equal(visit.requestedServices[0].name,'Full Set');
  assert.equal((await db.query('select customer_user_id from customers where id=(select customer_id from customer_visits where id=$1)',[v])).rows[0].customer_user_id,id(100));
  const token=data.code.split(':')[2];
  await actor(db,90);await db.query('select personal_qr_notify_ready($1,$2,$3,$4,$5)',[id(1),v,id(10),'3',id(210)]);
  await actor(db,100);visit=(await workspace(db)).visits.find(x=>x.visitId===v);assert.equal(visit.ready.staffName,'Anna');assert.equal(visit.ready.chair,'3');assert.equal(visit.status,'waiting');
  await actor(db,10);let ticket=await one(db,'select personal_qr_connect_customer($1,$2) data',[id(1),token]);
  ticket=await one(db,'select staff_scan_save($1,$2,$3,false,$4) data',[id(1),ticket.offers[0].id,JSON.stringify([{id:id(220),serviceId:id(20),amount:'60'}]),ticket.revision]);
  await actor(db,100);visit=await one(db,'select personal_qr_visit($1) data',[v]);assert.equal(visit.lines[0].amount,60);assert.equal(visit.status,'in_service');assert.equal(visit.ready,null);
  await actor(db,90);const paid=await one(db,'select service_relay_submit($1,$2,$3,10,5) data',[id(1),v,ticket.revision]);
  await actor(db,100);visit=await one(db,'select personal_qr_visit($1) data',[v]);assert.equal(visit.status,'paid');assert.equal(visit.ticketId,paid.ticketId);assert.equal(visit.receipt.tipValue,10);assert.equal(visit.receipt.discountValue,5);assert.equal(visit.receipt.services[0].lineTotal,60);
  const history=await one(db,'select get_customer_activity_receipt($1) data',[paid.ticketId]);assert.deepEqual(visit.receipt,history.ticket,'QR displays the canonical history receipt, not a second ticket');
  await actor(db,101);await assert.rejects(one(db,'select personal_qr_visit($1) data',[v]),/does not belong/);assert.equal((await one(db,'select get_customer_activity_receipt($1) data',[paid.ticketId])).ok,false);
  await actor(db,100);assert.equal(await checkin(db,e),v,'lost response retry after payment recovers original visit');assert.notEqual(await checkin(db,e,202),v,'an intentional new check-in after payment starts a new visit');
 }finally{await db.close();}
});

test('Owner scans then Send reuses the existing invitation and unique staff history; acceptance stays in existing logic',async()=>{
 const db=await fixture();try{
  await actor(db,100);const token=(await workspace(db)).code.split(':')[2];
  await db.query('insert into staff(id,salon_id,display_name,email,phone) values($1,$2,$3,$4,$5)',[id(130),id(1),'Anna prior history','anna@example.invalid','+15551234567']);
  await actor(db,10);await assert.rejects(one(db,'select personal_qr_staff_preview($1,$2) data',[id(1),token]),/Not authorized/);
  await actor(db,90);const preview=await one(db,'select personal_qr_staff_preview($1,$2) data',[id(1),token]);assert.equal(preview.name,'Anna Nguyen');assert.equal(preview.status,'available');assert.ok(!JSON.stringify(preview).includes('+15551234567'));
  const sent=await one(db,'select personal_qr_staff_send($1,$2) data',[id(1),token]);const again=await one(db,'select personal_qr_staff_send($1,$2) data',[id(1),token]);assert.equal(sent.requestId,again.requestId);
  assert.equal((await db.query('select staff_id from staff_salon_connection_requests where id=$1',[sent.requestId])).rows[0].staff_id,id(130));
  assert.equal((await db.query('select count(*) n from staff')).rows[0].n,4,'no duplicate staff profile');
  await actor(db,101);await assert.rejects(one(db,"select apply_staff_connection_invite_decision($1,null,'accepted') data",[sent.requestId]),/different account/);
  await actor(db,100);const accepted=await one(db,"select apply_staff_connection_invite_decision($1,null,'accepted') data",[sent.requestId]);assert.equal(accepted.staff_id,id(130));assert.equal(accepted.status,'accepted');
  await actor(db,90);assert.equal((await one(db,'select personal_qr_staff_send($1,$2) data',[id(1),token])).status,'connected');
  assert.equal((await db.query('select count(*) n from staff_salon_connection_requests')).rows[0].n,1);
 }finally{await db.close();}
});

test('New account Send creates one pending profile, never grants Staff/POS access before acceptance; expired QR is rejected',async()=>{
 const db=await fixture();try{
  await actor(db,101);const before=await workspace(db),token=before.code.split(':')[2];assert.equal((await workspace(db)).code,before.code);
  await actor(db,90);const result=await one(db,'select personal_qr_staff_send($1,$2) data',[id(1),token]);assert.equal(result.status,'pending');
  const staff=(await db.query('select s.* from staff s join staff_salon_connection_requests r on r.staff_id=s.id where r.id=$1',[result.requestId])).rows[0];assert.equal(staff.account_user_id,null);assert.equal(staff.user_id,null);
  await actor(db,101);assert.equal(await one(db,'select service_relay_staff($1) data',[id(1)]),null);
  await db.query("update personal_qr_codes set expires_at=now()-interval '1 second' where user_id=$1",[id(101)]);
  await actor(db,90);await assert.rejects(one(db,'select personal_qr_staff_preview($1,$2) data',[id(1),token]),/expired/);
  await actor(db,101);assert.notEqual((await workspace(db)).code,before.code);
 }finally{await db.close();}
});

test('Ready is scoped and deduplicated, changes neither turns nor payment; cancelled/working visits cannot be called',async()=>{
 const db=await fixture();try{
  await actor(db,100);const v=await checkin(db,await entry(db));
  const args=[id(1),v,id(10),'3',id(210)];await assert.rejects(db.query('select personal_qr_notify_ready($1,$2,$3,$4,$5)',args),/Not authorized/);
  await actor(db,90);await db.query('select personal_qr_notify_ready($1,$2,$3,$4,$5)',args);await db.query('select personal_qr_notify_ready($1,$2,$3,$4,$5)',args);
  assert.equal((await db.query("select count(*) n from app_notifications where notification_type='service_ready'")).rows[0].n,1);
  assert.equal((await db.query('select status from customer_visits where id=$1',[v])).rows[0].status,'waiting');assert.equal((await db.query('select count(*) n from pos_tickets')).rows[0].n,0);
  await db.query("update customer_visits set status='cancelled' where id=$1",[v]);await assert.rejects(db.query('select personal_qr_notify_ready($1,$2,$3,$4,$5)',args),/no longer waiting/);
  await actor(db,null);await assert.rejects(workspace(db),/Sign in/);
 }finally{await db.close();}
});

test('Check-in protects existing linked history, service scope, changed retries and paid receipt subscription without Phone Checkin',async()=>{
 const db=await fixture();try{
  await db.exec("delete from salon_market_plugins where plugin_id='service-relay'");
  await db.query('update customers set name=$1,phone=$2 where id=$3',['Anna Nguyen','+15551234567',id(3)]);
  await actor(db,100);const e=await entry(db);assert.ok(e);const v=await checkin(db,e);
  assert.equal((await db.query('select customer_id from customer_visits where id=$1',[v])).rows[0].customer_id,id(3),'links verified existing customer instead of duplicating history');
  await assert.rejects(checkin(db,e,200,[id(21)]),/request changed/);
  await assert.rejects(checkin(db,e,202,[id(22)]),/no longer available/);
  await db.query("update service_relay_entries set expires_at=now()-interval '1 second' where id=$1",[e]);await assert.rejects(checkin(db,e,203),/expired/);
 }finally{await db.close();}
});

test('Personal check-in preserves today booking association, its status event and requested service history',async()=>{
 const db=await fixture();try{
  await db.exec(`delete from customer_visit_services where visit_id='${id(30)}';delete from customer_visits where id='${id(30)}';update customers set customer_user_id='${id(100)}' where id='${id(3)}';
   insert into bookings values('${id(400)}','${id(1)}','${id(3)}',current_date+interval '10 hours','confirmed','confirmed',now());
   insert into booking_lines(booking_id,salon_id,service_id,display_order,line_status) values('${id(400)}','${id(1)}','${id(20)}',1,'active');`);
  await actor(db,100);const v=await checkin(db,await entry(db));
  assert.equal((await db.query('select appointment_id from customer_visits where id=$1',[v])).rows[0].appointment_id,id(400));
  assert.equal((await db.query('select status from bookings where id=$1',[id(400)])).rows[0].status,'checked_in');
  assert.equal((await db.query("select count(*) n from booking_status_events where event_type='checked_in'")).rows[0].n,1);
  assert.equal((await workspace(db)).visits.find(x=>x.visitId===v).requestedServices[0].id,id(20));
 }finally{await db.close();}
});

test('Portable Ready enforces its existing capability and salon scope; blocked accounts and ambiguous staff history stay isolated',async()=>{
 const db=await fixture();try{
  await actor(db,100);const v=await checkin(db,await entry(db)),token=(await workspace(db)).code.split(':')[2];
  await actor(db,null);
  await assert.rejects(db.query('select personal_qr_notify_ready($1,$2,null,null,$3,$4,$5)',[id(1),v,id(500),id(80),'bad']),/Not authorized/);
  await assert.rejects(db.query('select personal_qr_notify_ready($1,$2,null,null,$3,$4,$5)',[id(2),v,id(500),id(80),'valid']),/Not authorized/);
  await db.query('select personal_qr_notify_ready($1,$2,null,null,$3,$4,$5)',[id(1),v,id(500),id(80),'valid']);
  assert.equal((await db.query("select count(*) n from app_notifications where notification_type='service_ready'")).rows[0].n,1);
  await db.query("update users set status='suspended' where id=$1",[id(100)]);
  await actor(db,10);await assert.rejects(one(db,'select personal_qr_connect_customer($1,$2) data',[id(1),token]),/No unique active/);
  await db.query("update users set status='active' where id=$1",[id(100)]);
  for(const n of [130,131])await db.query('insert into staff(id,salon_id,display_name,phone) values($1,$2,$3,$4)',[id(n),id(1),'Prior profile','+15551234567']);
  await actor(db,90);await assert.rejects(one(db,'select personal_qr_staff_send($1,$2) data',[id(1),token]),/Several matching staff/);
  assert.equal((await db.query('select count(*) n from staff_salon_connection_requests')).rows[0].n,0,'no history merge or invitation on ambiguous match');
 }finally{await db.close();}
});
