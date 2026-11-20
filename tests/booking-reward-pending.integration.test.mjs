import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('booking pending rewards use saved appointments without issuing spendable points', {timeout:900000,skip:process.env.RUN_REWARD_SQL!=='1'}, async t=>{
 const f=await startIsolatedSupabase('booking-reward-pending',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});t.after(()=>f.close());
 const id=()=>crypto.randomUUID(),owner=f.person('pending-owner'),customer=f.person('pending-customer'),other=f.person('pending-other');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Pending fixture'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:id(),p_name:'Pending salon',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const program={enabled:true,nearby:false,spendCents:2000,spendPoints:20,welcomePoints:10,firstBookingPoints:20,visitPoints:5,conversionPoints:30,offers:[{id:'five',title:'$5 off',points:100,valueCents:500,minimumCents:4000}]};
 f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program,expectedVersion:0}});
 const cust=id(),service=id(),booking=id(),second=id();
 f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${cust}','${salon}','Pending customer','${customer.profileId}');insert into services(id,salon_id,name,base_price) values('${service}','${salon}','Manicure',60);`);
 const add=(b,days,user=customer.profileId)=>f.sql(`insert into bookings(id,salon_id,customer_id,customer_user_id,start_at,end_at,status,confirmation_status) values('${b}','${salon}','${cust}',${user?`'${user}'`:'null'},now()+interval '${days} days',now()+interval '${days} days 1 hour','confirmed','confirmed');insert into booking_lines(id,salon_id,booking_id,service_id,service_name_snapshot,quantity,unit_price,line_total,duration_minutes) values('${id()}','${salon}','${b}','${service}','Manicure',1,60,60,60);`);
 const wallet=(who=customer)=>f.rpc(who,'reward_personal',{p_op:'wallet'}).cards;
 const card=()=>wallet().find(c=>c.salonId===salon);
 await t.test('booking immediately creates a persistent visible estimate, with no membership or available credits',()=>{
  add(booking,1);assert.equal(card().pending,85);assert.equal(card().available,0);assert.equal(card().pendingBookings[0].bookingId,booking);
  assert.equal(card().pendingBookings[0].firstBookingPoints,20);assert.equal(card().pendingBookings[0].spendPoints,60);
  assert.equal(f.sql(`select count(*) from reward_members where salon_id='${salon}'`),'0');assert.equal(f.sql(`select count(*) from reward_ledger where salon_id='${salon}'`),'0');assert.equal(card().pending,85);
 });
 await t.test('multiple bookings receive one first-booking bonus; cancel and no-show remove their estimates',()=>{
  add(second,2);assert.equal(card().pending,150);assert.equal(card().pendingBookings[1].firstBookingPoints,0);
  f.sql(`update bookings set status='cancelled' where id='${booking}'`);assert.equal(card().pending,85);assert.equal(card().pendingBookings[0].bookingId,second);
  f.sql(`begin;set local session_replication_role=replica;update bookings set start_at=now()-interval '3 hours',end_at=now()-interval '2 hours' where id='${second}';commit;update bookings set status='no_show' where id='${second}'`);assert.equal(wallet().length,0);
 });
 await t.test('identity and salon boundaries: other customers and anonymous callers cannot see private estimates',()=>{
  assert.equal(wallet(other).length,0);
  assert.ok(f.http(3000,'/rpc/reward_personal','POST',{p_op:'wallet'}).status>=400);
  for(const name of ['reward_booking_pending','reward_view','reward_view_without_booking_pending'])assert.ok(f.http(3000,'/rpc/'+name,'POST',{p_salon:salon,p_user:customer.profileId},other.token).status>=400);
 });
 await t.test('linked customer identity is supported; repricing updates estimate and cancelled lines do not earn',()=>{
  const third=id();add(third,3,null);assert.equal(card().pending,85);
  f.sql(`update booking_lines set unit_price=40,line_total=40 where booking_id='${third}'`);assert.equal(card().pending,65);
  f.sql(`update booking_lines set line_status='cancelled' where booking_id='${third}'`);assert.equal(wallet().length,0);
 });
 await t.test('already consumed first-booking key is never offered again, even after reversal',()=>{
  const fourth=id();add(fourth,4);
  f.sql(`select reward_join('${salon}','${customer.profileId}');insert into reward_ledger(salon_id,user_id,delta,reason,event_key) values('${salon}','${customer.profileId}',0,'First paid booking','first-booking:${salon}:${customer.profileId}');`);
  assert.equal(card().pending,65);assert.equal(card().available,10);assert.equal(card().pendingBookings[0].firstBookingPoints,0);
  f.sql(`update bookings set status='cancelled' where id='${fourth}'`);assert.equal(card().pending,0);assert.equal(card().available,10);
 });
 await t.test('paid completion replaces pending with canonical credits; retry and void never duplicate or restore estimates',()=>{
  const b=id(),c=id(),v=id(),staff=id();
  f.sql(`insert into customers(id,location_id,name,customer_user_id) values('${c}','${salon}','Other customer','${other.profileId}');
   insert into bookings(id,salon_id,customer_id,customer_user_id,start_at,end_at,status,confirmation_status) values('${b}','${salon}','${c}','${other.profileId}',now()+interval '1 day',now()+interval '1 day 1 hour','confirmed','confirmed');
   insert into booking_lines(id,salon_id,booking_id,service_id,service_name_snapshot,quantity,unit_price,line_total,duration_minutes) values('${id()}','${salon}','${b}','${service}','Manicure',1,60,60,60);
   insert into customer_visits(id,salon_id,customer_id,appointment_id,origin_metadata) values('${v}','${salon}','${c}','${b}','{"token":"pending-payment"}');
   insert into staff(id,salon_id,display_name) values('${staff}','${salon}','Fixture staff');
   insert into pos_live_drafts(salon_id,token,customer) values('${salon}','pending-payment','{"id":"${c}","name":"Other customer"}');`);
  assert.equal(wallet(other)[0].pending,85);
  const args={p_salon:salon,p_operation_id:id(),p_occurred_at:new Date().toISOString(),p_payload:{customerId:c,customerVisitId:v,discountType:'fixed_amount',discountValue:0,tipAmount:0,liveDraftToken:'pending-payment',lines:[{id:id(),staffId:staff,serviceId:service,serviceLabel:'Manicure',total:60,amountInput:'60',amountParts:[60]}]}};
  const paid=f.rpc(owner,'replay_pos_owner_operation',args);assert.ok(paid.ticketId);
  f.sql(`update pos_tickets set source_booking_id='${b}' where id='${paid.ticketId}';`);
  assert.equal(wallet(other)[0].pending,0);assert.equal(wallet(other)[0].available,95);
  assert.equal(f.rpc(owner,'replay_pos_owner_operation',args).ticketId,paid.ticketId);assert.equal(wallet(other)[0].available,95);
  f.sql(`update pos_tickets set status='voided' where id='${paid.ticketId}'`);
  assert.equal(wallet(other)[0].available,10);assert.equal(wallet(other)[0].pending,0);
 });
 await t.test('past unvisited appointments and paused programs do not promise points',()=>{
  const expired=id();add(expired,5);f.sql(`begin;set local session_replication_role=replica;update bookings set start_at=now()-interval '2 days',end_at=now()-interval '2 days'+interval '1 hour' where id='${expired}';commit;`);assert.equal(card().pending,0);add(id(),5);assert.equal(card().pending,65);
  f.rpc(owner,'reward_owner',{p_salon:salon,p_op:'save',p_args:{program:{...program,enabled:false},expectedVersion:1}});assert.equal(card().pending,0);
 });
});
