import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('Shared Phone Checkin draft on complete schema: POS hold → staff edits after Done → cashier final receipt',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async t=>{
 const f=await startIsolatedSupabase('phone-checkin-drafts',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'));t.after(()=>f.close());
 const uuid=()=>crypto.randomUUID(),owner=f.person('draft-owner'),worker=f.person('draft-staff'),customer=f.person('draft-customer'),outsider=f.person('draft-outsider');
 const rpc=(who,name,args={})=>f.rpc(who,name,args);
 const account=rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Draft integration'})[0].account_id;
 const salon=rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:uuid(),p_name:'Draft integration salon',p_owner_is_staff:false,
  p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const sent=rpc(owner,'personal_qr_staff_send',{p_salon:salon,p_token:rpc(worker,'personal_qr_workspace').code.split(':')[2]});
 const staff=rpc(worker,'accept_staff_connection_invite_by_request',{p_request_id:sent.requestId}).staff_id;
 const services=[uuid(),uuid()],display=uuid();
 f.sql(`update pos_settings set staff_check_in_enabled=false where salon_id='${salon}';
  insert into services(id,salon_id,name,base_price) values('${services[0]}','${salon}','Full Set',40),('${services[1]}','${salon}','Gel Polish',10);
  insert into staff_service_assignments(salon_id,staff_id,service_id) values('${salon}','${staff}','${services[0]}'),('${salon}','${staff}','${services[1]}');
  insert into checkin_receipt_subscriptions(salon_id,paid_until) values('${salon}',now()+interval '1 month');
  insert into pos_live_drafts(salon_id,token) values('${salon}','${display}');`);
 const entry=rpc(null,'service_relay_entry',{p_token:display});
 const visit=rpc(customer,'personal_qr_checkin',{p_entry:entry,p_services:services,p_request:uuid()});
 // Inspect the write directly before any Staff/POS workspace read. The
 // arrival itself, not the first reader, must create the shared identity.
 assert.equal(Number(f.sql(`select count(*) from service_relay_tickets where visit_id='${visit}' and scan_mode and status='waiting'`)),1);
 assert.equal(Number(f.sql(`select count(*) from service_relay_lines l join service_relay_offers o on o.id=l.offer_id where o.visit_id='${visit}'`)),0);
 assert.deepEqual(rpc(owner,'phone_checkin_operations',{p_salon:salon}).counts,{checkedIn:1,waiting:1,inService:0,readyToPay:0,submitted:0,cancelled:0});
 f.sql(`update customer_visits set status='completed',completed_at=now() where id='${visit}'`);
 assert.equal(f.sql(`select status from customer_visits where id='${visit}'`),'waiting','an appointment completion cannot pretend to be paid');
 assert.equal(f.sql(`select completed_at is null from customer_visits where id='${visit}'`),'t');
 assert.equal(rpc(owner,'phone_checkin_visit_state',{p_salon:salon,p_visit:visit}).completed,false);
 const customerId=f.sql(`select customer_id from customer_visits where id='${visit}'`);
 const firstId=uuid(),request=uuid();
 const input={p_salon:salon,p_request:request,p_customer:customerId,p_visit:visit,p_lines:[{id:firstId,staffId:staff,serviceId:services[0],amount:'45'}],p_tip:5,p_discount:2,p_key:null,p_signature:null,p_note:"Shape square"};
 const denied=(who,name,args)=>assert.ok(f.http(3000,`/rpc/${name}`,'POST',args,who?.token).status>=400);
 denied(worker,'phone_checkin_hold_pos_draft',input);
 let ticket=rpc(owner,'phone_checkin_hold_pos_draft',input);
 assert.equal(ticket.draftNote,"Shape square");assert.equal(ticket.visitId,visit);assert.equal(ticket.draftTip,5);assert.equal(ticket.draftDiscount,2);
 assert.equal(rpc(owner,'phone_checkin_hold_pos_draft',input).revision,ticket.revision);
 assert.equal(rpc(worker,'staff_scan_workspace',{p_salon:salon}).current[0].visitId,visit);
 const offer=ticket.offers.find(o=>o.staffId===staff).id;
 const lines=[{id:firstId,serviceId:services[0],amount:'50'},{id:uuid(),serviceId:services[1],amount:'10'}];
 const save=(who,revision,values=lines,done=false)=>rpc(who,'staff_scan_save',{p_salon:salon,p_offer:offer,p_lines:values,p_done:done,p_expected:revision});
 denied(outsider,'staff_scan_save',{p_salon:salon,p_offer:offer,p_lines:lines,p_done:false,p_expected:ticket.revision});
 const oldRevision=ticket.revision;ticket=save(worker,ticket.revision);
 assert.equal(ticket.offers.length,1);assert.equal(ticket.offers[0].status,'done');
 // Simulate a pre-upgrade bare completion. Reconcile repairs the lifecycle
 // instead of hiding unpaid work or expiring staff offers as if it were paid.
 f.sql(`alter table customer_visits disable trigger phone_checkin_unpaid_completion;
  update customer_visits set status='completed' where id='${visit}';
  alter table customer_visits enable trigger phone_checkin_unpaid_completion;`);
 assert.equal(rpc(owner,'service_relay_workspace',{p_salon:salon,p_desk:true}).tickets[0].visitId,visit);
 assert.equal(f.sql(`select status from customer_visits where id='${visit}'`),'checkout');
 assert.equal(rpc(owner,'phone_checkin_operations',{p_salon:salon}).counts.submitted,0);
 assert.equal(rpc(worker,'staff_scan_workspace',{p_salon:salon}).current[0].offers[0].status,'done');
 denied(worker,'staff_scan_save',{p_salon:salon,p_offer:offer,p_lines:lines,p_done:false,p_expected:oldRevision});
 assert.equal(rpc(owner,'phone_checkin_hold_pos_draft',input).lines.reduce((n,l)=>n+l.amount,0),60);
 const deskLines=lines.map((l,i)=>({...l,staffId:staff,amount:i?'15':'55'}));
 rpc(owner,'phone_checkin_update_pos_ticket',{p_salon:salon,p_visit:visit,p_expected:ticket.revision,p_lines:deskLines,p_tip:5,p_discount:2,p_finalize:false,p_note:"Draft note"});
 ticket=rpc(worker,'staff_scan_workspace',{p_salon:salon}).current[0];
 lines[0].amount='60';lines[1].amount='15';ticket=save(worker,ticket.revision,lines,true);
 assert.equal(rpc(worker,'staff_scan_connect',{p_salon:salon,p_visit:visit}).offers.length,1);
 const final={p_salon:salon,p_visit:visit,p_expected:ticket.revision,p_lines:lines.map(l=>({...l,staffId:staff})),p_tip:5,p_discount:2,p_finalize:true,p_note:"Final note"};
 denied(worker,'phone_checkin_update_pos_ticket',final);
 const paid=rpc(owner,'phone_checkin_update_pos_ticket',final);assert.ok(paid.ticketId);
 assert.equal(f.sql(`select notes from pos_tickets where id='${paid.ticketId}'`),"Final note");
 const retried=rpc(owner,'phone_checkin_update_pos_ticket',final);assert.equal(retried.ticketId,paid.ticketId);assert.equal(retried.alreadyClosed,true);
 assert.equal(rpc(worker,'staff_scan_workspace',{p_salon:salon}).current.length,0);
 denied(worker,'staff_scan_save',{p_salon:salon,p_offer:offer,p_lines:lines,p_done:false,p_expected:ticket.revision});
 assert.equal(Number(f.sql(`select count(*) from pos_tickets where salon_id='${salon}'`)),1);
 assert.equal(Number(f.sql(`select sum(service_total) from pos_ticket_staff_earnings where ticket_id='${paid.ticketId}'`)),75);
 const receipt=rpc(customer,'get_customer_activity_receipt',{p_ticket_id:paid.ticketId});
 assert.equal(receipt.ok,true);assert.equal(receipt.ticket.services.reduce((n,l)=>n+l.lineTotal,0),75);
 assert.equal(receipt.ticket.tipValue,5);assert.equal(receipt.ticket.discountValue,2);
 assert.equal(rpc(owner,'phone_checkin_visit_state',{p_salon:salon,p_visit:visit}).completed,true);
 assert.equal(rpc(owner,'phone_checkin_operations',{p_salon:salon}).counts.submitted,1);
 denied(outsider,'phone_checkin_visit_state',{p_salon:salon,p_visit:visit});
 denied(outsider,'phone_checkin_operations',{p_salon:salon});
 // The last open ticket has disappeared and Check-in Receipt expires. State
 // detection remains authorized and read-only without the relay plugin.
 f.sql(`update checkin_receipt_subscriptions set paid_until=now()-interval '1 minute' where salon_id='${salon}'`);
 assert.equal(rpc(owner,'phone_checkin_visit_state',{p_salon:salon,p_visit:visit}).ticketId,paid.ticketId);
 f.sql(`update checkin_receipt_subscriptions set paid_until=now()+interval '1 month' where salon_id='${salon}'`);
 const screenArgs={p_token:display,p_phone:'+12025550121',p_customer_name:'Screen Arrival',p_request_id:uuid()};
 const screen=rpc(null,'resolve_customer_display_check_in',screenArgs);
 assert.equal(screen.ok,true);const screenVisit=screen.visit.id;
 assert.equal(rpc(null,'resolve_customer_display_check_in',screenArgs).visit.id,screenVisit);
 assert.equal(Number(f.sql(`select count(*) from service_relay_tickets where visit_id='${screenVisit}' and scan_mode`)),1);
 // Phone-link arrivals use the same write trigger; installing Phone Checkin
 // must not accidentally dispatch scan tickets or create duplicate ledgers.
 f.sql(`insert into salon_market_plugins(salon_id,plugin_id) values('${salon}','service-relay')`);
 const phoneArgs={p_entry:entry,p_phone:'+12025550122',p_name:'Phone Arrival',p_services:[services[0]],p_request:uuid()};
 const phone=rpc(null,'service_relay_phone_checkin',phoneArgs);assert.equal(phone.ok,true);
 const phoneVisit=f.sql(`select v.id from customer_visits v join customers c on c.id=v.customer_id where v.salon_id='${salon}' and c.name='Phone Arrival'`);
 assert.equal(rpc(null,'service_relay_phone_checkin',phoneArgs).pass.passToken,phone.pass.passToken);
 assert.equal(Number(f.sql(`select count(*) from service_relay_tickets where visit_id='${phoneVisit}' and scan_mode`)),1);
 assert.equal(Number(f.sql(`select count(*) from service_relay_offers where visit_id in('${screenVisit}','${phoneVisit}')`)),0);
 const deskCustomer=uuid();f.sql(`insert into customers(id,location_id,name,source,status) values('${deskCustomer}','${salon}','Desk Arrival','manual','active')`);
 const deskInput={...input,p_customer:deskCustomer,p_visit:null,p_request:uuid(),p_lines:[{id:uuid(),staffId:staff,serviceId:services[0],amount:'40'}]};
 const desk=rpc(owner,'phone_checkin_hold_pos_draft',deskInput);
 assert.equal(Number(f.sql(`select count(*) from customer_visits where customer_id='${deskCustomer}' and salon_id='${salon}'`)),1);
 assert.equal(Number(f.sql(`select count(*) from service_relay_tickets where visit_id='${desk.visitId}'`)),1);
 assert.deepEqual(rpc(owner,'phone_checkin_operations',{p_salon:salon}).counts,{checkedIn:4,waiting:2,inService:0,readyToPay:1,submitted:1,cancelled:0});
 assert.ok(f.http(3000,'/phone_checkin_draft_requests','GET',undefined,worker.token).status>=400);
});
