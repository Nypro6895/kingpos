import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';
import {runQrCapabilityAndRetentionChecks} from './helpers/qr-capability-retention-cases.mjs';

// Runs real PostgreSQL/Auth/PostgREST, all migrations and the actual receipt core.
// The fixture has no network, host ports, production credentials or message worker.
test('Personal QR → check-in → Staff → POS → History on the complete integrated schema',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 const f=await startIsolatedSupabase('qr-full-flow',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));t.after(()=>f.close());
 const owner=f.person('qr-owner'),staffUser=f.person('qr-staff'),customer=f.person('qr-customer'),outsider=f.person('qr-outsider');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'QR integration'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'QR integration salon',p_owner_is_staff:false,
  p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const uuid=()=>crypto.randomUUID(),call=(who,name,args)=>f.http(3000,`/rpc/${name}`,'POST',args,who?.token);
 const rpc=(who,name,args={})=>f.rpc(who,name,args);
 const concurrentRpc=(who,name,args)=>new Promise((resolve,reject)=>{
  const child=spawn(process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
   ['--context',process.env.TEST_DOCKER_CONTEXT||'desktop-linux','exec','-i',f.evidence.containers.db,'curl','--config','-'],{windowsHide:true});
  let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);
  child.on('close',code=>{try{assert.equal(code,0,f.redact(error));resolve(JSON.parse(output));}catch(e){reject(e);}});
  child.stdin.end(['url = '+JSON.stringify('http://127.0.0.1:3000/rpc/'+name),'request = "POST"','silent','show-error','fail-with-body','max-time = 20',
   'header = "Content-Type: application/json"','header = '+JSON.stringify('Authorization: Bearer '+who.token),'data = '+JSON.stringify(JSON.stringify(args))].join('\n'));
 });
 const assertDenied=(who,name,args)=>{const r=call(who,name,args);assert.ok(r.status>=400,`${name} unexpectedly allowed: ${JSON.stringify(r.data)}`);};
 const token=rpc(staffUser,'personal_qr_workspace').code.split(':')[2];let staff;
 await t.test('Owner scan is read-only; Send is idempotent and existing invitation acceptance grants the correct Staff identity',()=>{
  assertDenied(outsider,'personal_qr_staff_preview',{p_salon:salon,p_token:token});
  const before=Number(f.sql(`select count(*) from staff where salon_id='${salon}'`));
  const preview=rpc(owner,'personal_qr_staff_preview',{p_salon:salon,p_token:token});assert.equal(preview.userId,staffUser.profileId);
  assert.equal(Number(f.sql(`select count(*) from staff where salon_id='${salon}'`)),before);
  const sent=rpc(owner,'personal_qr_staff_send',{p_salon:salon,p_token:token});
  assert.equal(rpc(owner,'personal_qr_staff_send',{p_salon:salon,p_token:token}).requestId,sent.requestId);
  assertDenied(staffUser,'staff_scan_workspace',{p_salon:salon});
  assert.ok(rpc(staffUser,'list_my_staff_salon_connection_requests').some(r=>r.id===sent.requestId));
  assertDenied(outsider,'accept_staff_connection_invite_by_request',{p_request_id:sent.requestId});
  const accepted=rpc(staffUser,'accept_staff_connection_invite_by_request',{p_request_id:sent.requestId});staff=accepted.staff_id;
  assert.equal(accepted.status,'accepted');assert.ok(staff);
  f.sql(`update pos_settings set staff_check_in_enabled=false where salon_id='${salon}'`);
  assert.equal(rpc(staffUser,'staff_scan_workspace',{p_salon:salon}).staffId,staff);
 });
 assert.ok(staff,'Staff invitation is required for remaining flow');
 const services=[uuid(),uuid()],display=uuid();
 f.sql(`insert into services(id,salon_id,name,base_price) values('${services[0]}','${salon}','Pedicure',45),('${services[1]}','${salon}','Gel add-on',15);
  insert into staff_service_assignments(salon_id,staff_id,service_id) values('${salon}','${staff}','${services[0]}'),('${salon}','${staff}','${services[1]}');
  insert into checkin_receipt_subscriptions(salon_id,paid_until) values('${salon}',now()+interval '1 month');
  insert into pos_live_drafts(salon_id,token) values('${salon}','${display}');
  insert into checkin_receipt_counters(salon_id,business_date,last_number) values('${salon}',get_salon_business_date('${salon}'),28);`);
 const entry=rpc(null,'service_relay_entry',{p_token:display});assert.ok(entry);
 const checkin=request=>rpc(customer,'personal_qr_checkin',{p_entry:entry,p_services:services,p_request:request});
 const personal=()=>rpc(customer,'personal_qr_workspace');let visit,request=uuid(),saved,offer,lines;
 await t.test('Phone kiosk check-in auto-links the account; mobile salon scan confirmation reuses its visit, queue and requested services',()=>{
  rpc(customer,'personal_qr_workspace');
  f.rest(customer,`/users?id=eq.${customer.profileId}`,'PATCH',{phone:'+15035550167',display_name:'NENE'});
  const phoneResult=rpc(null,'resolve_customer_display_check_in_identity',{p_token:display,p_phone:'(503) 555-0167',p_request_id:uuid()});
  assert.equal(phoneResult.ok,true);visit=phoneResult.visit.id;assert.ok(visit);
  const cust=f.sql(`select customer_id from customer_visits where id='${visit}'`);
  assert.equal(f.sql(`select customer_user_id from customers where id='${cust}'`),customer.profileId);
  const selected=rpc(null,'update_customer_visit_requested_services',{p_token:display,p_visit_id:visit,p_service_ids:services});
  assert.equal(selected.ok,true);
  const receipt=rpc(null,'issue_checkin_receipt',{p_token:display,p_visit:visit});
  assert.equal(receipt.queueNumber,29);
  const beforeScan=personal().visits.find(v=>v.visitId===visit);
  assert.ok(beforeScan,'phone check-in is visible in My QR before the customer scans anything');
  assert.equal(beforeScan.queueNumber,29);assert.equal(beforeScan.requestedServices.length,2);
  const catalog=rpc(customer,'service_relay_entry_catalog',{p_entry:entry});assert.equal(catalog.personalOnly,true);assert.equal(catalog.services.length,2);
  assert.equal(checkin(request),visit);assert.equal(checkin(request),visit);assert.equal(checkin(uuid()),visit);
  assert.equal(rpc(null,'resolve_customer_display_check_in_identity',{p_token:display,p_phone:'5035550167',p_request_id:uuid()}).visit.id,visit);
  assert.equal(Number(f.sql(`select count(*) from customer_visits where salon_id='${salon}' and customer_id='${cust}'`)),1);
  assert.equal(Number(f.sql(`select count(*) from checkin_receipts where visit_id='${visit}'`)),1);
  const view=personal().visits.find(v=>v.visitId===visit);assert.equal(view.status,'waiting');assert.equal(view.requestedServices.length,2);
  assert.equal(rpc(customer,'get_customer_activity',{p_limit:100}).visits.filter(v=>v.id===visit).length,1);
  assertDenied(null,'personal_qr_checkin',{p_entry:entry,p_services:services,p_request:uuid()});
  assertDenied(outsider,'personal_qr_visit',{p_visit:visit});
  for(const table of ['personal_qr_codes','personal_qr_ready','personal_qr_checkins'])assert.ok(f.http(3000,`/${table}`,'GET',undefined,customer.token).status>=400);
 });
 assert.ok(visit);
 await t.test('Personal check-in issues the canonical daily Check-in Receipt number once, shared across customer, Staff and POS',()=>{
  assert.equal(Number(f.sql(`select count(*) from checkin_receipts where visit_id='${visit}'`)),1);
  assert.equal(personal().visits.find(v=>v.visitId===visit).queueNumber,29);
  assert.equal(rpc(null,'issue_checkin_receipt',{p_token:display,p_visit:visit}).queueNumber,29,'legacy paired display shares the same issuance core');
  assert.equal(rpc(staffUser,'staff_scan_workspace',{p_salon:salon}).waiting.find(v=>v.visitId===visit).queueNumber,29);
  assert.equal(rpc(owner,'service_relay_workspace',{p_salon:salon,p_desk:true}).tickets.find(v=>v.visitId===visit).queueNumber,29);
 });
 await t.test('POS Ready is private, deduplicated, linked to the correct visit and leaves turns unchanged',()=>{
  const args={p_salon:salon,p_visit:visit,p_staff:staff,p_chair:'3',p_request:uuid()};
  assertDenied(customer,'personal_qr_notify_ready',args);rpc(owner,'personal_qr_notify_ready',args);rpc(owner,'personal_qr_notify_ready',args);
  assert.equal(personal().visits.find(v=>v.visitId===visit).ready.chair,'3');
  assert.equal(Number(f.sql(`select count(*) from app_notifications where recipient_user_id='${customer.profileId}' and notification_type='service_ready'`)),1);
  assert.equal(Number(f.sql(`select count(*) from pos_tickets where salon_id='${salon}'`)),0);
 });
 await t.test('Staff scans Personal ID; Working/Holding and requested services flow to POS; amounts save without Done',()=>{
  saved=rpc(staffUser,'personal_qr_connect_customer',{p_salon:salon,p_token:personal().code.split(':')[2]});
  assert.equal(saved.visitId,visit);
  offer=saved.offers.find(o=>o.staffId===staff).id;
  const fromVisitQr=rpc(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:visit});
  assert.equal(fromVisitQr.visitId,visit);assert.equal(fromVisitQr.offers.find(o=>o.staffId===staff).id,offer);
  const work=rpc(staffUser,'staff_scan_workspace',{p_salon:salon});assert.ok(work.current.some(v=>v.visitId===visit));assert.equal(work.services.length,2);
  assertDenied(owner,'pos_service_relay_project_staff',{p_salon:salon,p_payload:{}});
  const holding=f.json(`select pos_service_relay_project_staff('${salon}','${JSON.stringify({staff:[{id:staff,turns:{queueTurns:0,largeTurns:0,totalTurns:0}}]})}'::jsonb)`).staff[0];
  assert.equal(holding.service_status,'working');assert.equal(holding.turns.holdingTurns,1);assert.equal(holding.turns.totalTurns,0);
  lines=services.map((serviceId,i)=>({id:uuid(),serviceId,amount:i?'15':'45'}));
  saved=rpc(staffUser,'staff_scan_save',{p_salon:salon,p_offer:offer,p_lines:lines,p_done:false,p_expected:saved.revision});
  const view=personal().visits.find(v=>v.visitId===visit);assert.equal(view.lines.reduce((n,l)=>n+l.amount,0),60);assert.equal(view.ready,null);
  const desk=rpc(owner,'service_relay_workspace',{p_salon:salon,p_desk:true});assert.ok(desk.tickets.some(v=>v.visitId===visit&&v.lines.length===2));
 });
 await t.test('Scanning again while staff works or checkout is pending preserves one visit, Holding, amounts and queue',()=>{
  for(const status of ['in_service','checkout']){
   if(status==='checkout')f.sql(`update customer_visits set status='checkout' where id='${visit}'`);
   assert.equal(checkin(uuid()),visit);
   const view=personal().visits.find(v=>v.visitId===visit);
   assert.equal(view.queueNumber,29);assert.equal(view.lines.reduce((sum,line)=>sum+line.amount,0),60);
   assert.equal(Number(f.sql(`select count(*) from customer_visits where salon_id='${salon}' and status in ('waiting','in_service','checkout')`)),1);
   assert.equal(Number(f.sql(`select count(*) from service_relay_offers where visit_id='${visit}' and status='working'`)),1);
   assert.equal(Number(f.sql(`select count(*) from checkin_receipts where visit_id='${visit}'`)),1);
  }
 });
 assert.ok(saved);
 await t.test('Actual POS receipt core settles offline Staff work exactly once and History exposes the same final receipt and earnings',()=>{
  const input={p_salon:salon,p_visit:visit,p_expected:saved.revision,p_tip:10,p_discount:5};
  const paid=rpc(owner,'service_relay_submit',input);assert.ok(paid.ticketId);assert.equal(rpc(owner,'service_relay_submit',input).ticketId,paid.ticketId);
  const view=personal().visits.find(v=>v.visitId===visit);assert.equal(view.status,'paid');assert.equal(view.ticketId,paid.ticketId);
  const receipt=rpc(customer,'get_customer_activity_receipt',{p_ticket_id:paid.ticketId});assert.equal(receipt.ok,true);assert.deepEqual(view.receipt,receipt.ticket);
  assert.equal(view.receipt.services.reduce((n,l)=>n+l.lineTotal,0),60);assert.equal(view.receipt.tipValue,10);assert.equal(view.receipt.discountValue,5);
  const history=rpc(customer,'get_customer_activity',{p_limit:100});assert.equal(history.purchases.filter(p=>p.ticketId===paid.ticketId).length,1);
  assert.equal(Number(f.sql(`select count(*) from pos_tickets where id='${paid.ticketId}' and status='closed'`)),1);
  assert.equal(Number(f.sql(`select sum(service_total) from pos_ticket_staff_earnings where ticket_id='${paid.ticketId}'`)),60);
  assert.equal(f.rest(staffUser,`/pos_ticket_staff_earnings?ticket_id=eq.${paid.ticketId}&staff_id=eq.${staff}`)[0].service_total,60,'settled work remains visible through Staff ticket listing RLS');
  assert.equal(rpc(outsider,'get_customer_activity_receipt',{p_ticket_id:paid.ticketId}).ok,false);
  assert.equal(rpc(staffUser,'staff_scan_workspace',{p_salon:salon}).current.some(v=>v.visitId===visit),false);
  assertDenied(staffUser,'staff_scan_save',{p_salon:salon,p_offer:offer,p_lines:lines,p_done:false,p_expected:saved.revision});
  assert.equal(checkin(request),visit,'lost response retry after payment recovers original visit');
 });
 await t.test('Concurrent duplicate check-ins, Staff scans and POS collections create one visit, one Holding and one financial ticket',async()=>{
  const input={p_entry:entry,p_services:services,p_request:uuid()};
  const arrivals=await Promise.all([concurrentRpc(customer,'personal_qr_checkin',input),concurrentRpc(customer,'personal_qr_checkin',input),
   concurrentRpc(customer,'resolve_customer_display_check_in_identity',{p_token:display,p_phone:'5035550167',p_request_id:uuid()})]);
  assert.equal(arrivals[0],arrivals[1]);const next=arrivals[0];
  assert.equal(arrivals[2].ok,true);assert.equal(arrivals[2].visit.id,next,'phone and mobile confirmation at the same time must converge');
  const connections=await Promise.all([concurrentRpc(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:next}),concurrentRpc(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:next})]);
  assert.equal(connections[0].offers[0].id,connections[1].offers[0].id);
  assert.equal(Number(f.sql(`select count(*) from service_relay_offers where visit_id='${next}' and status='working'`)),1);
  const ticket=rpc(staffUser,'staff_scan_save',{p_salon:salon,p_offer:connections[0].offers[0].id,p_lines:[{id:uuid(),serviceId:services[0],amount:'45'}],p_done:false,p_expected:connections[0].revision});
  const checkout={p_salon:salon,p_visit:next,p_expected:ticket.revision,p_tip:0,p_discount:0};
  const paid=await Promise.all([concurrentRpc(owner,'service_relay_submit',checkout),concurrentRpc(owner,'service_relay_submit',checkout)]);
  assert.equal(paid[0].ticketId,paid[1].ticketId);assert.ok(paid[0].ticketId);
  assert.equal(Number(f.sql(`select count(*) from pos_ticket_staff_earnings where ticket_id='${paid[0].ticketId}'`)),1);
  assert.equal(Number(f.sql(`select count(*) from checkin_receipts where visit_id='${next}'`)),1);
 });
 await t.test('Stand by/Cancel release an empty Holding; Done counts once; Portable POS can take over, settle, and reject stale staff writes',()=>{
  const next=checkin(uuid());const ready={p_salon:salon,p_visit:next,p_staff:staff,p_chair:'3',p_request:uuid()};
  rpc(owner,'personal_qr_notify_ready',ready);let ticket=rpc(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:next});
  let pendingOffer=ticket.offers.find(o=>o.status==='working').id;
  rpc(staffUser,'staff_scan_cancel',{p_salon:salon,p_offer:pendingOffer,p_expected:ticket.revision});
  assert.equal(personal().visits.find(v=>v.visitId===next).status,'waiting');
  assert.equal(personal().visits.find(v=>v.visitId===next).ready,null,'old Ready cannot reappear after cancelling empty work');
  rpc(owner,'personal_qr_notify_ready',ready);assert.equal(personal().visits.find(v=>v.visitId===next).ready,null,'old Ready retry is still idempotent');
  rpc(owner,'personal_qr_notify_ready',{...ready,p_request:uuid()});assert.equal(personal().visits.find(v=>v.visitId===next).ready.chair,'3','POS may intentionally call again');
  ticket=rpc(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:next});pendingOffer=ticket.offers.find(o=>o.status==='working').id;
  const values=[{id:uuid(),serviceId:services[0],amount:'50'},{id:uuid(),serviceId:services[1],amount:'10'}];
  ticket=rpc(staffUser,'staff_scan_save',{p_salon:salon,p_offer:pendingOffer,p_lines:values,p_done:true,p_expected:ticket.revision});
  assert.equal(rpc(staffUser,'staff_scan_save',{p_salon:salon,p_offer:pendingOffer,p_lines:values,p_done:true,p_expected:ticket.revision}).revision,ticket.revision);
  const key=uuid();f.sql(`insert into pos_portable_access_keys(id,salon_id,access_id,passcode_salt,passcode_digest) values('${key}','${salon}','${uuid()}','fixture-salt','fixture-digest')`);
  const signature=f.sql(`select pos_portable_access_signature('${key}','fixture-digest')`);
  const scope={p_salon:salon,p_visit:next,p_key:key,p_signature:signature};
  assertDenied(null,'staff_scan_desk_save',{...scope,p_signature:'invalid',p_expected:ticket.revision,p_lines:values.map(l=>({...l,staffId:staff}))});
  rpc(null,'staff_scan_desk_save',{...scope,p_expected:ticket.revision,p_lines:[{...values[0],staffId:staff,amount:'55'},{...values[1],staffId:staff,amount:'12'}]});
  const desk=rpc(null,'service_relay_workspace',{p_salon:salon,p_desk:true,p_key:key,p_signature:signature}).tickets.find(v=>v.visitId===next);
  assertDenied(staffUser,'staff_scan_save',{p_salon:salon,p_offer:pendingOffer,p_lines:values,p_done:false,p_expected:ticket.revision});
  const paid=rpc(null,'service_relay_submit',{...scope,p_expected:desk.revision,p_tip:8,p_discount:0});assert.ok(paid.ticketId);
  assert.equal(personal().visits.find(v=>v.visitId===next).receipt.services.reduce((n,l)=>n+l.lineTotal,0),67);
  assert.equal(rpc(staffUser,'staff_scan_workspace',{p_salon:salon}).current.length,0);
  f.sql(`update pos_portable_access_keys set is_active=false where id='${key}'`);
  assertDenied(null,'service_relay_workspace',{p_salon:salon,p_desk:true,p_key:key,p_signature:signature});
 });
 await t.test('Today appointment survives account check-in, actual receipt settlement and the original booking/history evidence chain',()=>{
  const cust=f.sql(`select customer_id from customer_visits where id='${visit}'`),booking=uuid();
  f.sql(`insert into booking_settings(salon_id,same_day_booking_enabled,minimum_lead_time_minutes) values('${salon}',true,0)
   on conflict(salon_id) do update set same_day_booking_enabled=true,minimum_lead_time_minutes=0;
   insert into bookings(id,salon_id,customer_id,customer_user_id,start_at,end_at,status,confirmation_status)
   values('${booking}','${salon}','${cust}','${customer.profileId}',
   now()+interval '10 minutes',now()+interval '40 minutes','confirmed','confirmed');
   insert into booking_lines(salon_id,booking_id,service_id,service_name_snapshot,unit_price,line_total)
   values('${salon}','${booking}','${services[0]}','Pedicure',45,45);`);
  const next=checkin(uuid());assert.equal(f.sql(`select appointment_id from customer_visits where id='${next}'`),booking);
  assert.equal(f.sql(`select status from bookings where id='${booking}'`),'checked_in');
  let ticket=rpc(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:next});const o=ticket.offers.find(x=>x.status==='working').id;
  ticket=rpc(staffUser,'staff_scan_save',{p_salon:salon,p_offer:o,p_lines:[{id:uuid(),serviceId:services[0],amount:'45'}],p_done:false,p_expected:ticket.revision});
  const paid=rpc(owner,'service_relay_submit',{p_salon:salon,p_visit:next,p_expected:ticket.revision,p_tip:0,p_discount:0});
  assert.equal(f.sql(`select pos_ticket_id from bookings where id='${booking}'`),paid.ticketId);
  const history=rpc(customer,'get_customer_activity',{p_limit:100});assert.ok(history.evidence.some(e=>e.bookingId===booking&&e.ticket?.ticketId===paid.ticketId));
  assert.equal(history.purchases.filter(p=>p.ticketId===paid.ticketId).length,1);
 });
 await t.test('An account can reuse its desk-created waiting visit without rewriting display origin or weakening public receipt pairing',()=>{
  const cust=f.sql(`select customer_id from customer_visits where id='${visit}'`),old=uuid(),retry=uuid();
  f.sql(`insert into customer_visits(id,salon_id,customer_id,source,status) values('${old}','${salon}','${cust}','walk_in','waiting')`);
  assert.equal(checkin(retry),old);assert.equal(checkin(retry),old);
  assert.equal(f.sql(`select origin_metadata::text from customer_visits where id='${old}'`),'{}');
  assert.equal(Number(f.sql(`select count(*) from checkin_receipts where visit_id='${old}'`)),1);
  assertDenied(null,'issue_checkin_receipt',{p_token:display,p_visit:old});
  assertDenied(customer,'personal_qr_ensure_receipt_for_visit',{p_salon:salon,p_visit:old});
  const extra=Array.from({length:9},()=>uuid());
  f.sql(`insert into services(id,salon_id,name) values ${extra.map((id,i)=>`('${id}','${salon}','Extra ${i+1}')`).join(',')}`);
  const invalid=call(customer,'personal_qr_checkin',{p_entry:entry,p_services:extra,p_request:uuid()});assert.ok(invalid.status>=400);assert.match(invalid.data.message,/up to 8/);
  assert.equal(rpc(customer,'personal_qr_checkin',{p_entry:entry,p_services:extra.slice(0,8),p_request:uuid()}),old);
  assert.equal(personal().visits.find(v=>v.visitId===old).requestedServices.length,8);
  f.sql(`update customer_visits set status='cancelled' where id='${old}'`);
  assertDenied(staffUser,'staff_scan_connect',{p_salon:salon,p_visit:old});
  assertDenied(owner,'personal_qr_notify_ready',{p_salon:salon,p_visit:old,p_staff:staff,p_chair:null,p_request:uuid()});
 });
 await t.test('A verified matching Staff profile retains its original history and cannot be connected by another account',()=>{
  const target=f.person('qr-existing-staff'),prior=uuid();
  f.sql(`insert into staff(id,salon_id,display_name,email) values('${prior}','${salon}','Existing Staff','${target.email}');
   insert into staff_workdays(salon_id,staff_id,work_date,status) values('${salon}','${prior}',get_salon_business_date('${salon}')-1,'checked_out')`);
  const code=rpc(target,'personal_qr_workspace').code.split(':')[2];
  const sent=rpc(owner,'personal_qr_staff_send',{p_salon:salon,p_token:code});
  assert.equal(rpc(target,'accept_staff_connection_invite_by_request',{p_request_id:sent.requestId}).staff_id,prior);
  assert.equal(Number(f.sql(`select count(*) from staff_workdays where staff_id='${prior}'`)),1);
  assert.equal(rpc(owner,'personal_qr_staff_send',{p_salon:salon,p_token:code}).status,'connected');
  assertDenied(outsider,'accept_staff_connection_invite_by_request',{p_request_id:sent.requestId});
 });
 await runQrCapabilityAndRetentionChecks(t,f,{owner,staffUser,customer,account,salon,staff,services,visit});
 f.save('qr-full-flow-results.json',{completed:true,migrations:f.evidence.migrationHashes.length,realAuth:true,realPostgrest:true,realRls:true,realFinancialCore:true});
});
