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

 -- Disjoint eligibility must work without any professional covering every service.
 delete from staff_service_assignments where salon_id=salon and ((staff_id=staff1 and service_id=service2) or (staff_id=staff2 and service_id=service1));
 first:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1,service2],'startAt',starts));
 if first->>'staffId' is not null or first->'lines'->0->>'staffId'<>staff1::text or first->'lines'->1->>'staffId'<>staff2::text then raise exception 'Auto did not assign service-specific eligible staff'; end if;
 if (first->'lines'->1->>'startAt')::timestamptz<>starts+interval '40 minutes' or (first->>'endAt')::timestamptz<>starts+interval '70 minutes' then raise exception 'Split service times incorrect'; end if;
 if (select count(*) from booking_staff_reservations r join booking_lines l on l.id=r.line_id where l.booking_id=(first->>'id')::uuid)<>2 then raise exception 'Missing split reservations'; end if;
 result:=get_pos_portable_book_data(key,signature,(starts at time zone 'America/Chicago')::date);
 if jsonb_array_length(result->'staffServiceAssignments')<>2 or result->'appointments'->0->'lines'->0->>'startAt' is null then raise exception 'Calendar or assignment metadata missing'; end if;
 -- Explicitly choosing an ineligible staff member must fail without changing the booking.
 rejected:=false;
 begin perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('serviceIds',array[service1,service2],'staffIds',array[staff2,staff1],'startAt',starts));
 exception when others then if sqlerrm not like '%do not fit%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Ineligible staff accepted'; end if;
 -- An all-manual split is valid even with Auto disabled.
 update booking_settings set auto_assign_enabled=false where salon_id=salon;
 edited:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('serviceIds',array[service1,service2],'staffIds',array[staff1,staff2],'startAt',starts));
 rejected:=false;
 begin perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('serviceIds',array[service1,service2],'staffIds',jsonb_build_array(staff1,null),'startAt',starts));
 exception when others then if sqlerrm not like '%Choose a professional%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Auto setting ignored'; end if;
 update booking_settings set auto_assign_enabled=true where salon_id=salon;
 perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'cancel');
 insert into staff_service_assignments(salon_id,staff_id,service_id) values(salon,staff1,service2),(salon,staff2,service1);
 -- Distinct staff preferred, but same staff and a three-service fallback are supported.
 result:=plan_portable_booking_services(salon,array[service1,service2],null,starts);
 if result->'lines'->0->>'staffId'=result->'lines'->1->>'staffId' then raise exception 'Distinct professionals not preferred'; end if;
 result:=plan_portable_booking_services(salon,array[service1,service2,service1],staff1,starts);
 if result->>'staffId'<>staff1::text or jsonb_array_length(result->'lines')<>3 then raise exception 'Shared professional rejected'; end if;
 update staff set is_active=false where id=staff2;
 result:=plan_portable_booking_services(salon,array[service1,service2],null,starts);
 if result->>'staffId'<>staff1::text then raise exception 'Single eligible professional fallback failed'; end if;
 update staff set is_active=true where id=staff2;
 -- A short first-service choice blocks the next service. Try the longer alternative.
 update staff_service_assignments set custom_duration_minutes=10 where staff_id=staff1 and service_id=service1;
 delete from staff_service_assignments where staff_id=staff2 and service_id=service2;
 second:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1],'staffId',staff1,'startAt',starts+interval '30 minutes'));
 -- First professional ends at 09:20, second service would overlap the 09:30 booking.
 -- The alternative ends at 09:40 and would still overlap, so adjust its custom duration to 40 (ending 09:50).
 update staff_service_assignments set custom_duration_minutes=40 where staff_id=staff2 and service_id=service1;
 first:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1,service2],'startAt',starts));
 if first->'lines'->0->>'staffId'<>staff2::text or first->'lines'->1->>'staffId'<>staff1::text or (first->>'endAt')::timestamptz<>starts+interval '80 minutes' then raise exception 'Did not find feasible alternate sequence'; end if;
 slots:=get_pos_portable_booking_slots_v3(key,signature,array[service1,service2],null,(starts at time zone 'America/Chicago')::date,(first->>'id')::uuid,jsonb_build_array(staff2,staff1));
 if not exists(select 1 from jsonb_array_elements(slots) x where x->>'label'='09:00' and jsonb_array_length(x->'lines')=2) then raise exception 'Split preview missing or conflicts with itself'; end if;
 -- Ticket handoff must preserve each professional.
 perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'confirm');
 draft:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'ticket');
 payload:=jsonb_build_object('sourceBookingId',first->>'id','sourceBookingUpdatedAt',draft->>'updatedAt','customerId',customer,
  'lines',jsonb_build_array(jsonb_build_object('staffId',staff2,'serviceId',service1,'serviceLabel','A','total',40,'amountParts',jsonb_build_array(40)),
  jsonb_build_object('staffId',staff1,'serviceId',service2,'serviceLabel','B','total',30,'amountParts',jsonb_build_array(30))));
 result:=submit_pos_portable_receipt(key,signature,payload,get_salon_business_date(salon));
 if (select count(distinct assigned_staff_id) from pos_ticket_items where pos_ticket_id=(result->>'ticketId')::uuid)<>2 then raise exception 'Ticket lost split staff'; end if;
end; $$;
