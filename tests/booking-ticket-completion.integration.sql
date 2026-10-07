-- Run after the new migrations inside BEGIN / ROLLBACK. No real customer data.
do $$
declare account uuid; salon uuid; customer uuid; service1 uuid; service2 uuid; staff1 uuid; staff2 uuid; key uuid; signature text;
 starts timestamptz; first jsonb; second jsonb; edited jsonb; draft jsonb; result jsonb; slots jsonb; rejected boolean; payload jsonb;
begin
 insert into accounts(name) values('Booking edit fixture') returning id into account;
 insert into locations(account_id,name) values(account,'Booking edit fixture') returning id into salon;
 insert into pos_settings(salon_id) values(salon);
 insert into booking_settings(salon_id,default_cleanup_buffer_minutes,confirmation_mode) values(salon,10,'request_confirmation');
 insert into customers(location_id,name) values(salon,'Fixture client') returning id into customer;
 insert into services(salon_id,name,duration_minutes,base_price) values(salon,'Fixture service A',30,40) returning id into service1;
 insert into services(salon_id,name,duration_minutes,base_price) values(salon,'Fixture service B',20,30) returning id into service2;
 insert into staff(salon_id,display_name) values(salon,'Fixture staff A') returning id into staff1;
 insert into staff(salon_id,display_name) values(salon,'Fixture staff B') returning id into staff2;
 insert into staff_service_assignments(salon_id,staff_id,service_id) values(salon,staff1,service1),(salon,staff1,service2),(salon,staff2,service1),(salon,staff2,service2);
 starts:=(((statement_timestamp() at time zone 'America/Chicago')::date+3)+time '09:00') at time zone 'America/Chicago';
 insert into staff_availability_rules(salon_id,day_of_week,starts_at_local,ends_at_local) values(salon,extract(dow from starts at time zone 'America/Chicago'),'08:00','18:00');
 insert into pos_portable_access_keys(salon_id,access_id,passcode_salt,passcode_digest,capabilities)
 values(salon,gen_random_uuid()::text,'fixture','fixture',array['portable.book.view','portable.book.create','portable.book.cancel','portable.pos.use']) returning id into key;
 signature:=pos_portable_access_signature(key,'fixture');
 first:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1],'staffId',staff1,'startAt',starts));
 second:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1],'staffId',staff1,'startAt',starts+interval '1 hour'));
 slots:=get_pos_portable_booking_slots_v2(key,signature,array[service1],staff1,(starts at time zone 'America/Chicago')::date,(first->>'id')::uuid);
 if not exists(select 1 from jsonb_array_elements(slots) x where x->>'label'='09:00') then raise exception 'Appointment conflicts with itself'; end if;
 slots:=get_pos_portable_booking_slots_v2(key,signature,array[service1,service2],staff1,(starts at time zone 'America/Chicago')::date,(first->>'id')::uuid);
 if exists(select 1 from jsonb_array_elements(slots) x where x->>'label'='09:00') then raise exception 'Multiple services advertised over another booking'; end if;
 rejected:=false;
 begin perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('serviceIds',array[service1,service2],'staffId',staff1,'startAt',starts));
 exception when others then if sqlerrm not like '%do not fit%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Conflicting edit accepted'; end if;
 if (select count(*) from booking_lines where booking_id=(first->>'id')::uuid and line_status<>'cancelled')<>1 then raise exception 'Failed edit changed original services'; end if;
 edited:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('serviceIds',array[service1,service2],'staffId',staff2,'startAt',starts));
 if (edited->>'endAt')::timestamptz<>starts+interval '70 minutes' then raise exception 'Combined service duration incorrect'; end if;
 if edited->>'staffId'<>staff2::text or jsonb_array_length(edited->'serviceIds')<>2 then raise exception 'Staff or services not updated'; end if;
 rejected:=false;
 begin perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'confirm',jsonb_build_object('updatedAt',now()-interval '1 minute'));
 exception when others then if sqlerrm not like '%another device%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Stale edit accepted'; end if;
 edited:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'confirm');
 if edited->>'status'<>'confirmed' then raise exception 'Confirmation failed'; end if;
 draft:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'ticket');
 if (draft->>'customerId')::uuid<>customer or jsonb_array_length(draft->'lines')<>2 then raise exception 'Ticket handoff data missing'; end if;
 if draft->>'ticketId' is not null then raise exception 'Opening POS prematurely created a ticket'; end if;
 payload:=jsonb_build_object('sourceBookingId',first->>'id','sourceBookingUpdatedAt',draft->>'updatedAt','customerId',customer,
  'lines',jsonb_build_array(jsonb_build_object('staffId',staff2,'serviceId',service1,'serviceLabel','Fixture A','total',40,'amountParts',jsonb_build_array(40))));
 result:=submit_pos_portable_receipt(key,signature,payload,get_salon_business_date(salon));
 if (select status from bookings where id=(first->>'id')::uuid)<>'in_service' then raise exception 'Partial ticket incorrectly completed whole booking'; end if;
 if (select count(*) from booking_lines where booking_id=(first->>'id')::uuid and line_status='completed')<>1 then raise exception 'Partial ticket did not complete exactly its own service'; end if;
 -- Re-closing is idempotent and cannot complete an absent service.
 update pos_tickets set status='open',closed_at=null where id=(result->>'ticketId')::uuid;
 update pos_tickets set status='closed',closed_at=now() where id=(result->>'ticketId')::uuid;
 if (select count(*) from booking_status_events where booking_id=(first->>'id')::uuid and event_type='ticket_services_completed')<>1 then raise exception 'Repeated close duplicated completion'; end if;
 if (select status from bookings where id=(first->>'id')::uuid)<>'in_service' then raise exception 'Repeated close completed missing service'; end if;
 -- An open linked ticket must wait until close; removed services are not evidence.
 update booking_lines set line_status='scheduled',completed_at=null,assigned_staff_id=null where booking_id=(first->>'id')::uuid and service_id=service1;
 update pos_tickets set status='open',closed_at=null where id=(result->>'ticketId')::uuid;
 perform sync_booking_completion_from_ticket((result->>'ticketId')::uuid);
 if exists(select 1 from booking_lines where booking_id=(first->>'id')::uuid and line_status='completed') then raise exception 'Open ticket completed services'; end if;
 update pos_ticket_items set is_removed=true where pos_ticket_id=(result->>'ticketId')::uuid;
 update pos_tickets set status='closed',closed_at=now() where id=(result->>'ticketId')::uuid;
 if exists(select 1 from booking_lines where booking_id=(first->>'id')::uuid and line_status='completed') then raise exception 'Removed ticket item completed services'; end if;
 -- Closing an ordinary linked ticket takes the same path as receipt submission.
 update pos_tickets set status='open',closed_at=null where id=(result->>'ticketId')::uuid;
 update pos_ticket_items set is_removed=false where pos_ticket_id=(result->>'ticketId')::uuid;
 update pos_tickets set status='closed',closed_at=now() where id=(result->>'ticketId')::uuid;
 if (select count(*) from booking_lines where booking_id=(first->>'id')::uuid and line_status='completed')<>1 then raise exception 'Ticket close did not complete its service'; end if;
end; $$;
