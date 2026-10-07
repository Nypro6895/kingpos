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
  'lines',jsonb_build_array(jsonb_build_object('staffId',staff2,'serviceId',service1,'serviceLabel','Fixture service A','total',40,'amountParts',jsonb_build_array(40)),
   jsonb_build_object('staffId',staff2,'serviceId',service2,'serviceLabel','Fixture service B','total',30,'amountParts',jsonb_build_array(30))));
 result:=submit_pos_portable_receipt(key,signature,payload,get_salon_business_date(salon));
 if not exists(select 1 from bookings where id=(first->>'id')::uuid and pos_ticket_id=(result->>'ticketId')::uuid) then raise exception 'Ticket is not linked to appointment'; end if;
 if (select status from bookings where id=(first->>'id')::uuid)<>'completed' then raise exception 'Closed booking ticket did not complete appointment'; end if;
 if (select count(*) from booking_lines where booking_id=(first->>'id')::uuid and line_status='completed')<>2 then raise exception 'Booking services were not completed'; end if;
 if (select count(*) from pos_ticket_items where pos_ticket_id=(result->>'ticketId')::uuid and source_booking_id=(first->>'id')::uuid)<>2 then raise exception 'Ticket services lost source'; end if;
 rejected:=false;
 begin perform submit_pos_portable_receipt(key,signature,payload,get_salon_business_date(salon));
 exception when others then if sqlerrm not like '%already has a ticket%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Duplicate ticket accepted'; end if;
 edited:=manage_pos_portable_booking(key,signature,(second->>'id')::uuid,'cancel',jsonb_build_object('reason','Fixture cancellation'));
 if edited->>'status'<>'cancelled' then raise exception 'Cancellation failed'; end if;
 if exists(select 1 from booking_staff_reservations r join booking_lines l on l.id=r.line_id where l.booking_id=(second->>'id')::uuid) then raise exception 'Cancellation did not release time'; end if;
 perform get_pos_portable_book_data(key,signature,(starts at time zone 'America/Chicago')::date);
end; $$;
