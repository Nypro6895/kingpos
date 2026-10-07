-- Run in a transaction: customer, booking, notification and permission tests roll back.
begin;
do $$
declare fixture record; owner_auth uuid; slot timestamptz; payload jsonb; first_result jsonb; result jsonb; count_before bigint; own_context jsonb; existing_customer uuid; suggestions jsonb; customer_count bigint; search_started timestamptz;
begin
  select s.id staff_id,s.salon_id,u.auth_user_id,a.service_id,coalesce(bs.timezone_iana,get_salon_business_timezone(s.salon_id)) tz,
    coalesce(a.custom_duration_minutes,svc.duration_minutes)+coalesce(bs.default_cleanup_buffer_minutes,0) duration
  into fixture from staff s join users u on u.id=s.account_user_id join staff_service_assignments a on a.staff_id=s.id and a.is_active
    join services svc on svc.id=a.service_id and svc.is_active join booking_settings bs on bs.salon_id=s.salon_id
  where s.is_active and u.auth_user_id is not null and salon_is_operational(s.salon_id) and not bs.payment_required_enabled and not bs.deposit_required_enabled
  limit 1;
  if fixture.staff_id is null then raise exception 'No staff booking fixture'; end if;
  select u.auth_user_id into owner_auth from locations l join account_memberships m on m.account_id=l.account_id join roles r on r.id=m.role_id join users u on u.id=m.user_id
    where l.id=fixture.salon_id and m.status='active' and r.code='OWNER' limit 1;
  if owner_auth is null then raise exception 'No owner fixture'; end if;
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  perform salon_staff_booking_creation(fixture.salon_id,true);
  perform set_config('request.jwt.claim.sub',fixture.auth_user_id::text,true);
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_canonical_booking_internal' and has_function_privilege('authenticated',p.oid,'execute')) then raise exception 'Private writer exposed'; end if;
  begin perform create_canonical_booking('staff','instant_booking','confirmed',null,null,now(),null,null,'[]',null,null,fixture.salon_id,'owner_manual',now(),'confirmed'); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  own_context:=staff_booking_creation_catalog(fixture.salon_id);
  if own_context->>'staffId'<>fixture.staff_id::text or own_context->>'enabled'<>'true' then raise exception 'Bad staff context'; end if;
  begin perform salon_staff_booking_creation(fixture.salon_id,false); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  begin perform staff_booking_creation_catalog(gen_random_uuid()); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  select t into slot from generate_series(date_trunc('day',now())+interval '2 days',date_trunc('day',now())+interval '25 days',interval '15 minutes') t
    where booking_staff_available(fixture.salon_id,fixture.staff_id,fixture.service_id,t,t+make_interval(mins=>fixture.duration)) limit 1;
  if slot is null then raise exception 'No available fixture slot'; end if;
  insert into customers(location_id,name,phone,source,created_by_user_id) values(fixture.salon_id,'Lookup Rollback Customer','5550000919','manual',current_public_user_id()) returning id into existing_customer;
  search_started:=clock_timestamp();
  suggestions:=staff_booking_customer_suggestions(fixture.salon_id,'Lookup Rollback');
  raise notice 'Customer suggestion database time: % ms',round(extract(epoch from clock_timestamp()-search_started)*1000,2);
  if not suggestions @> jsonb_build_array(jsonb_build_object('id',existing_customer)) then raise exception 'Name lookup missed customer'; end if;
  if not staff_booking_customer_suggestions(fixture.salon_id,'555-000-0919') @> jsonb_build_array(jsonb_build_object('id',existing_customer)) then raise exception 'Phone lookup missed customer'; end if;
  if staff_booking_customer_suggestions(fixture.salon_id,'L')<>'[]'::jsonb then raise exception 'Short search exposed customers'; end if;
  if exists(select 1 from jsonb_array_elements(suggestions) row, jsonb_object_keys(row) k where k not in ('id','name','phone')) then raise exception 'Unnecessary customer data exposed'; end if;
  begin perform staff_booking_customer_suggestions(gen_random_uuid(),'Lookup'); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  payload:=jsonb_build_object('key',gen_random_uuid()::text,'customerId',existing_customer,'name','Lookup Rollback Customer','phone','5550000919','staffId',fixture.staff_id,'serviceIds',jsonb_build_array(fixture.service_id),'startLocal',to_char(slot at time zone fixture.tz,'YYYY-MM-DD"T"HH24:MI'));
  select count(*) into count_before from bookings where salon_id=fixture.salon_id;
  select count(*) into customer_count from customers where location_id=fixture.salon_id;
  begin perform create_staff_appointment(fixture.salon_id,payload||jsonb_build_object('customerId',gen_random_uuid(),'key',gen_random_uuid()::text)); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
  first_result:=create_staff_appointment(fixture.salon_id,payload);
  if (select customer_id from bookings where id=(first_result->>'bookingId')::uuid)<>existing_customer then raise exception 'Wrong linked customer'; end if;
  if (select count(*) from customers where location_id=fixture.salon_id)<>customer_count then raise exception 'Duplicate customer created'; end if;
  result:=create_staff_appointment(fixture.salon_id,payload);
  if first_result->>'bookingId' is distinct from result->>'bookingId' or (select count(*) from bookings where salon_id=fixture.salon_id)<>count_before+1 then raise exception 'Duplicate submit created duplicate booking'; end if;
  if not exists(select 1 from booking_lines where booking_id=(result->>'bookingId')::uuid and assigned_staff_id=fixture.staff_id and service_id=fixture.service_id) then raise exception 'Wrong assignment'; end if;
  if not exists(select 1 from booking_status_events where booking_id=(result->>'bookingId')::uuid and actor_staff_id=fixture.staff_id and event_type='staff_appointment_created') then raise exception 'Missing actor'; end if;
  begin perform create_staff_appointment(fixture.salon_id,payload||jsonb_build_object('key',gen_random_uuid()::text)); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
  begin perform create_staff_appointment(fixture.salon_id,payload||jsonb_build_object('key',gen_random_uuid()::text,'staffId',gen_random_uuid())); raise exception using errcode='PZ002'; exception when raise_exception then null; end;
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  perform salon_staff_booking_creation(fixture.salon_id,false);
  perform set_config('request.jwt.claim.sub',fixture.auth_user_id::text,true);
  begin perform staff_booking_customer_suggestions(fixture.salon_id,'Lookup'); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  if staff_booking_creation_catalog(fixture.salon_id)->>'enabled'<>'false' then raise exception 'Off not visible'; end if;
  begin perform create_staff_appointment(fixture.salon_id,payload); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform staff_booking_customer_suggestions(fixture.salon_id,'Lookup'); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
  begin perform create_staff_appointment(fixture.salon_id,payload); raise exception using errcode='PZ002'; exception when insufficient_privilege then null; end;
end;$$;
select 'PASS: customer name/phone lookup, minimal fields, scoped access, selected customer binding, no duplicate customer, staff catalog, owner-only switch, cross-salon denial, create, assigned staff, actor audit, duplicate retry, overlap guard, disabled permission, anonymous denial' as result;
rollback;
