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

 result:=get_pos_portable_booking_hours(key,signature,(starts at time zone 'America/Chicago')::date);
 if result->>'source'<>'salon' or (result->'intervals'->0->>'start')::numeric<>480 or (result->'intervals'->0->>'end')::numeric<>1080 then raise exception 'Hours do not use configured working rules'; end if;
 result:=get_pos_portable_booking_hours(key,signature,(starts at time zone 'America/Chicago')::date+1);
 if jsonb_array_length(result->'intervals')<>0 then raise exception 'Closed weekday ignored'; end if;
 insert into staff_time_blocks(salon_id,block_type,starts_at,ends_at) values(salon,'closed',starts+interval '3 hours',starts+interval '4 hours');
 result:=get_pos_portable_booking_hours(key,signature,(starts at time zone 'America/Chicago')::date);
 if jsonb_array_length(result->'intervals')<>2 or (result->'intervals'->0->>'end')::numeric<>720 or (result->'intervals'->1->>'start')::numeric<>780 then raise exception 'Day closure not subtracted'; end if;
 first:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1,service2],'staffIds',array[staff1,staff2],'startAt',starts,'notes','Short nails'));
 if first->>'notes'<>'Short nails' then raise exception 'Note not saved'; end if;
 result:=get_pos_portable_booking_staff_options(key,signature,array[service1,service2],to_jsonb(array[staff1,staff2]),starts,0,(first->>'id')::uuid);
 if jsonb_array_length(result)<>2 or exists(select 1 from jsonb_array_elements(result) x where (x->>'available')::boolean is not true) then raise exception 'Staff availability conflicts with own booking'; end if;
 second:=create_pos_portable_appointment_v3(key,signature,jsonb_build_object('customerId',customer,'customerName','Fixture','serviceIds',array[service1],'staffId',staff2,'startAt',starts));
 result:=get_pos_portable_booking_staff_options(key,signature,array[service1,service2],to_jsonb(array[staff1,staff2]),starts,0,(first->>'id')::uuid);
 if not exists(select 1 from jsonb_array_elements(result) x where x->>'staffId'=staff2::text and (x->>'available')::boolean=false) then raise exception 'Busy staff offered as free'; end if;
 update customers set email='old-client@example.invalid' where id=customer;
 edited:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'confirm');
 insert into customers(location_id,name,email) values(salon,'New customer','new-client@example.invalid') returning id into customer;
 edited:=manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('customerId',customer,'notes','Updated note','serviceIds',array[service1,service2],'staffIds',array[staff1,staff2],'startAt',starts,'updatedAt',edited->>'updatedAt'));
 if edited->>'customerId'<>customer::text or edited->>'notes'<>'Updated note' then raise exception 'Customer/note update failed'; end if;
 perform claim_booking_messages(1,false,false);
 if exists(select 1 from booking_message_outbox where booking_id=(first->>'id')::uuid and recipient='old-client@example.invalid' and state in ('pending','unconfigured','sending')) then raise exception 'Old customer still receives queued update'; end if;
 if not exists(select 1 from booking_message_outbox where booking_id=(first->>'id')::uuid and recipient='new-client@example.invalid' and state='unconfigured') then raise exception 'New customer confirmation missing'; end if;
 -- Deactivated customers cannot be assigned, and failed edits are atomic.
 update customers set status='inactive' where id=customer;
 rejected:=false;
 begin perform manage_pos_portable_booking(key,signature,(first->>'id')::uuid,'edit',jsonb_build_object('customerId',customer,'notes','Should not save','serviceIds',array[service1,service2],'staffIds',array[staff1,staff2],'startAt',starts));
 exception when others then if sqlerrm not like '%Customer not found%' then raise; end if; rejected:=true; end;
 if not rejected then raise exception 'Inactive customer accepted'; end if;
 if (select internal_notes from bookings where id=(first->>'id')::uuid)<>'Updated note' then raise exception 'Failed edit persisted notes'; end if;
end; $$;
