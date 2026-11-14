import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

test('booking handoff checks time/permission and atomically completes only the booking with one open ticket', {skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000},async t=>{
 const f=await startIsolatedSupabase('booking-handoff',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true});t.after(()=>f.close());
 const owner=f.person('handoff-owner'), outsider=f.person('handoff-outsider');
 const account=f.rpc(owner,'ensure_personal_account_for_current_user',{p_account_name:'Handoff QA'})[0].account_id;
 const salon=f.rpc(owner,'create_account_salon_with_owner_staff',{p_account_id:account,p_create_request_key:crypto.randomUUID(),p_name:'Handoff QA',p_owner_is_staff:false,p_phone:null,p_address_line1:null,p_address_line2:null,p_city:null,p_state:null,p_postal_code:null,p_country:'US'}).salon_id;
 const customer=crypto.randomUUID();f.sql(`insert into customers(id,location_id,name) values('${customer}','${salon}','QA Customer')`);
 function booking(start,status='confirmed',confirmation='confirmed'){
  const id=crypto.randomUUID();f.sql(`alter table bookings disable trigger enforce_booking_time_policy;
  insert into bookings(id,salon_id,customer_id,start_at,end_at,status,confirmation_status) values('${id}','${salon}','${customer}',now()+interval '${start}',now()+interval '${start}'+interval '45 minutes','${status}','${confirmation}');
  insert into booking_lines(salon_id,booking_id,service_name_snapshot,service_description_snapshot,quantity,unit_price,line_total,line_status) values('${salon}','${id}','Full Set','Booked description',1,40,40,'scheduled');
  alter table bookings enable trigger enforce_booking_time_policy;`);return id;
 }
 const future=booking('2 hours'),pending=booking('-1 hour','pending','requested'),cancelled=booking('-1 hour','cancelled','cancelled'),due=booking('-1 hour');
 assert.throws(()=>f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:future}),/when the appointment starts/);
 for(const id of [pending,cancelled])assert.throws(()=>f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:id}),/Confirm this appointment/);
 assert.throws(()=>f.rpc(outsider,'convert_booking_to_pos_ticket',{p_booking_id:due}));
 assert.equal(f.sql(`select count(*) from pos_tickets where salon_id='${salon}'`),'0');
 const ticket=f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:due});
 assert.equal(f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:due}),ticket);
 const b=f.json(`select row_to_json(b) from bookings b where id='${due}'`);
 assert.equal(b.status,'completed');assert.equal(b.pos_ticket_id,ticket);
 assert.equal(f.sql(`select status from pos_tickets where id='${ticket}'`),'open');
 assert.equal(f.sql(`select count(*) from pos_payments where ticket_id='${ticket}'`),'0');
 assert.equal(f.sql(`select count(*) from booking_status_events where booking_id='${due}' and metadata->>'reason'='ticket_handoff'`),'1');
 assert.equal(f.sql(`select service_description_snapshot from pos_ticket_items where pos_ticket_id='${ticket}'`),'Booked description');
 const fail=booking('-2 hours');
 f.sql(`create function public.qa_reject_handoff_event() returns trigger language plpgsql as $$ begin if new.metadata->>'reason'='ticket_handoff' then raise exception 'QA event failure';end if;return new;end;$$;
 create trigger qa_reject_handoff_event before insert on booking_status_events for each row execute function qa_reject_handoff_event();`);
 assert.throws(()=>f.rpc(owner,'convert_booking_to_pos_ticket',{p_booking_id:fail}),/QA event failure/);
 assert.equal(f.sql(`select status||':'||(pos_ticket_id is null)::text from bookings where id='${fail}'`),'confirmed:true');
 assert.equal(f.sql(`select count(*) from pos_tickets where source_booking_id='${fail}'`),'0');
 f.save('handoff-result.json',{futureDenied:true,pendingDenied:true,cancelledDenied:true,outsiderDenied:true,idempotent:true,bookingCompleted:true,ticketStillOpen:true,noPayments:true,snapshotsPreserved:true,eventFailureRollsBackEntireHandoff:true});
});
