import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('same-phone consolidation, stable history and real kiosk/QR boundaries with complete schema',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 const f=await startIsolatedSupabase('phone-checkin-consolidation',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));t.after(()=>f.close());
 const owner=f.person('salon-owner'),nene=f.person('nene'),other=f.person('other'),next=f.person('new-number-owner');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Phone fixture'})[0].account_id;
 const makeSalon=name=>f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:name,p_owner_is_staff:false,
  p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const salon=makeSalon('First salon'),salon2=makeSalon('Second salon');
 const token=crypto.randomUUID();f.sql(`insert into pos_live_drafts(salon_id,token) values('${salon}','${token}')`);
 const add=(name,phone,user=null,s=salon)=>f.rest(owner,'/customers','POST',{location_id:s,name,phone,customer_user_id:user})[0].id;
 const lookup=phone=>f.rpc(null,'find_pos_live_draft_customer_by_phone',{p_phone:phone,p_token:token});
 const get=id=>f.rest(owner,`/customers?id=eq.${id}`)[0];
 let kept,visit,ticket,booking;
 await t.test('unclaimed different-name duplicates merge automatically without OTP or account, preserving amounts and IDs',()=>{
  const a=add('Nene','5035550100'),b=add('Another name','+15035550100');
  visit=crypto.randomUUID();ticket=crypto.randomUUID();booking=crypto.randomUUID();
  f.sql(`insert into customer_visits(id,salon_id,customer_id,status,source) values('${visit}','${salon}','${b}','completed','walk_in');
   insert into pos_tickets(id,salon_id,customer_id,status) values('${ticket}','${salon}','${b}','closed');
   insert into pos_ticket_items(salon_id,pos_ticket_id,service_name_snapshot,unit_price,line_total) values('${salon}','${ticket}','Fixture service',85,85);
   alter table bookings disable trigger enforce_booking_time_policy;
   insert into bookings(id,salon_id,customer_id,start_at,end_at) values('${booking}','${salon}','${b}',now()+interval '2 days',now()+interval '2 days 1 hour');`);
  const amount=f.sql(`select sum(line_total) from pos_ticket_items where pos_ticket_id='${ticket}'`);
  kept=lookup('(503) 555-0100');assert.equal(kept.id,a);assert.equal(kept.name,'Nene');
  assert.equal(get(b),undefined);assert.equal(get(a).customer_user_id,null);
  assert.equal(f.sql(`select customer_id from customer_visits where id='${visit}'`),a);
  assert.equal(f.sql(`select customer_id from pos_tickets where id='${ticket}'`),a);
  assert.equal(f.sql(`select sum(line_total) from pos_ticket_items where pos_ticket_id='${ticket}'`),amount);
  assert.equal(f.rest(owner,`/customer_merged_ids?source_id=eq.${b}`)[0].target_id,a);
  assert.equal(lookup('15035550100').id,a);
 });
 await t.test('same phone in another salon remains a separate salon profile',()=>{
  const remote=add('Second salon history','5035550100',null,salon2);
  assert.equal(lookup('5035550100').id,kept.id);assert.equal(get(remote).location_id,salon2);
 });
 await t.test('an active account phone is recognized and takes unclaimed salon history without a name prompt',()=>{
  f.rest(nene,`/users?id=eq.${nene.profileId}`,'PATCH',{display_name:'NENE',phone:'+15035550100'});
  assert.equal(lookup('5035550100').id,kept.id);assert.equal(lookup('5035550100').name,'NENE');
  assert.equal(get(kept.id).customer_user_id,nene.profileId);
  const history=f.rpc(nene,'get_customer_activity',{p_limit:100});assert.equal(history.ok,true);
  assert.ok(history.purchases.some(item=>item.ticketId===ticket));assert.ok(history.visits.some(item=>item.id===visit));
  assert.ok(history.bookings.some(item=>item.bookingId===booking));
 });
 await t.test('changing a phone preserves the same customer IDs and all past history at every salon',()=>{
  const remote=add('Nene other salon','5035550100',nene.profileId,salon2);
  f.rest(nene,`/users?id=eq.${nene.profileId}`,'PATCH',{phone:'+15035550199'});
  assert.equal(lookup('5035550199').id,kept.id);
  assert.equal(get(kept.id).customer_user_id,nene.profileId);assert.equal(get(remote).phone,'+15035550199');
  const history=f.rpc(nene,'get_customer_activity',{p_limit:100});
  assert.ok(history.purchases.some(item=>item.ticketId===ticket));assert.ok(history.visits.some(item=>item.id===visit));
  assert.ok(history.bookings.some(item=>item.bookingId===booking));
 });
 await t.test('the old number may be reused without moving previously linked history to its new owner',()=>{
  f.rest(next,`/users?id=eq.${next.profileId}`,'PATCH',{display_name:'New owner',phone:'+15035550100'});
  const incoming=lookup('5035550100');assert.notEqual(incoming.id,kept.id);assert.equal(get(incoming.id).customer_user_id,next.profileId);
  const history=f.rpc(next,'get_customer_activity',{p_limit:100});assert.ok(!history.purchases.some(item=>item.ticketId===ticket));
  assert.ok(!history.bookings.some(item=>item.bookingId===booking));
  assert.equal(get(kept.id).customer_user_id,nene.profileId);
 });
 await t.test('two established accounts keep separate histories and kiosk asks only which account',()=>{
  const a=add('Account A','5035550200',nene.profileId),b=add('Account B','5035550200',other.profileId);
  const result=f.http(3000,'/rpc/resolve_customer_display_check_in_identity','POST',{p_token:token,p_phone:'5035550200',p_request_id:crypto.randomUUID()});
  assert.equal(result.status,200);assert.equal(result.data.code,'identity_choice_required');assert.equal(result.data.candidates.length,2);
  assert.equal(get(a).customer_user_id,nene.profileId);assert.equal(get(b).customer_user_id,other.profileId);
  const chosen=f.rpc(null,'resolve_customer_display_check_in_identity',{p_token:token,p_phone:'5035550200',p_identity_choice:a,p_request_id:crypto.randomUUID()});
  assert.equal(chosen.ok,true);assert.equal(get(kept.id).phone,'+15035550199');
 });
 await t.test('owner creation and booking reuse the phone even when the entered name differs',()=>{
  const phone='5035550300',a=add('Original',phone);
  assert.equal(f.rpc(owner,'create_salon_customer_identity',{p_salon:salon,p_input:{name:'Different',phone,create_separate:'1'}}),a);
  const booked=f.rpc(owner,'create_booking_customer_identity',{p_salon:salon,p_name:'Third name',p_phone:phone,p_email:null,p_user:null,p_actor:owner.profileId,p_source:'owner_booking'});
  assert.equal(booked.customer.id,a);assert.equal(booked.created,false);
 });
 await t.test('separate active visits remain intact and consolidate automatically when one finishes',()=>{
  const a=add('First','5035550400'),b=add('Second','5035550400'),v1=crypto.randomUUID(),v2=crypto.randomUUID();
  f.sql(`insert into customer_visits(id,salon_id,customer_id,status,source) values('${v1}','${salon}','${a}','waiting','walk_in'),('${v2}','${salon}','${b}','waiting','walk_in')`);
  assert.ok(lookup('5035550400').id);assert.ok(get(a));assert.ok(get(b));
  assert.equal(Number(f.sql(`select count(*) from customer_visits where id in ('${v1}','${v2}') and status='waiting'`)),2);
  f.sql(`update customer_visits set status='completed' where id='${v1}'`);
  assert.equal(Number(f.sql(`select count(*) from customers where id in ('${a}','${b}')`)),1);
  assert.equal(f.sql(`select customer_id from customer_visits where id='${v1}'`),f.sql(`select customer_id from customer_visits where id='${v2}'`));
  assert.equal(f.sql(`select status from customer_visits where id='${v2}'`),'waiting');
 });
 await t.test('migration backfill consolidates existing duplicate groups and private helpers stay private',()=>{
  const a=add('Legacy one','5035550500'),b=add('Legacy two','5035550500');
  const sql=fs.readFileSync('supabase/migrations/20261026230000_phone_customer_consolidation.sql','utf8');
  f.sql(sql.slice(sql.lastIndexOf('do $$declare group_row record;')));
  assert.equal(Number(f.sql(`select count(*) from customers where id in ('${a}','${b}')`)),1);
  for(const role of ['anon','authenticated'])assert.equal(f.sql(`select has_function_privilege('${role}','public.canonical_customer_for_phone(uuid,text,uuid)','execute')`),'f');
  const denied=f.http(3000,'/rpc/create_booking_customer_identity','POST',{p_salon:salon,p_name:'No access',p_phone:'5035550600',p_email:null,p_user:null,p_actor:other.profileId,p_source:'owner_booking'},other.token);
  assert.ok(denied.status>=400);
 });
 f.save('phone-checkin-results.json',{passed:true,migrations:f.evidence.migrationHashes.length});
});
