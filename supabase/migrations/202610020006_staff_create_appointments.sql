begin;
alter table public.salon_settings add column if not exists staff_booking_creation_enabled boolean not null default true;

-- Keep the canonical insert implementation private. Its old direct grant must
-- not let staff bypass the owner switch or submit their own prices/statuses.
do $$
declare definition text; signature text; owner_name text;
begin
  select p.oid::regprocedure::text,pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner) into signature,definition,owner_name
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_canonical_booking';
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_canonical_booking_internal') then
    execute replace(definition,'FUNCTION public.create_canonical_booking(', 'FUNCTION public.create_canonical_booking_internal(');
  end if;
  execute 'revoke all on function '||replace(signature,'create_canonical_booking(','create_canonical_booking_internal(')||' from public,anon,authenticated';
  execute format('grant execute on function %s to %I',replace(signature,'create_canonical_booking(','create_canonical_booking_internal('),owner_name);
  if position('Staff must use the staff appointment flow' in definition)=0 then
    definition:=replace(definition,E'begin\n',E'begin\n  if current_public_user_id() is null or not user_has_salon_permission(p_salon_id,array[''booking.manage'']::text[]) then raise exception ''Staff must use the staff appointment flow'' using errcode=''42501''; end if;\n');
    execute definition;
  end if;
end;$$;

create or replace function public.guard_staff_creation_permission()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.staff_booking_creation_enabled is distinct from old.staff_booking_creation_enabled and not exists (
    select 1 from locations l join account_memberships m on m.account_id=l.account_id join roles r on r.id=m.role_id
    where l.id=new.salon_id and m.user_id=current_public_user_id() and m.status='active' and r.code='OWNER'
  ) then raise exception 'Only the salon owner can change this permission' using errcode='42501'; end if;
  return new;
end;$$;
revoke all on function public.guard_staff_creation_permission() from public,anon,authenticated;
drop trigger if exists guard_staff_creation_permission on public.salon_settings;
create trigger guard_staff_creation_permission before update of staff_booking_creation_enabled on public.salon_settings for each row execute function public.guard_staff_creation_permission();

create or replace function public.salon_staff_booking_creation(p_salon uuid,p_enabled boolean default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare own_staff uuid:=current_user_staff_id_for_salon(p_salon); owner_access boolean; enabled boolean;
begin
  if current_public_user_id() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select exists(select 1 from locations l join account_memberships m on m.account_id=l.account_id join roles r on r.id=m.role_id
    where l.id=p_salon and m.user_id=current_public_user_id() and m.status='active' and r.code='OWNER') into owner_access;
  if not owner_access and own_staff is null then raise exception 'Salon access denied' using errcode='42501'; end if;
  if p_enabled is not null then
    if not owner_access then raise exception 'Only the salon owner can change this permission' using errcode='42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended('staff-create-permission:'||p_salon::text,0));
    insert into salon_settings(salon_id,business_name,staff_booking_creation_enabled)
    select id,name,p_enabled from locations where id=p_salon
    on conflict(salon_id) do update set staff_booking_creation_enabled=excluded.staff_booking_creation_enabled;
  end if;
  select coalesce((select staff_booking_creation_enabled from salon_settings where salon_id=p_salon),true) into enabled;
  return jsonb_build_object('enabled',enabled,'staffId',own_staff,'timezone',get_salon_business_timezone(p_salon));
end;$$;
revoke all on function public.salon_staff_booking_creation(uuid,boolean) from public,anon;
grant execute on function public.salon_staff_booking_creation(uuid,boolean) to authenticated;

create or replace function public.staff_booking_creation_catalog(p_salon uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare context jsonb;
begin
  context:=salon_staff_booking_creation(p_salon);
  if current_user_staff_id_for_salon(p_salon) is null then raise exception 'Active staff access required' using errcode='42501'; end if;
  if not (context->>'enabled')::boolean then return context; end if;
  return context||jsonb_build_object(
    'timezone',coalesce((select timezone_iana from booking_settings where salon_id=p_salon),get_salon_business_timezone(p_salon)),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price',base_price,'minutes',duration_minutes) order by name) from services where salon_id=p_salon and is_active),'[]'::jsonb),
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',display_name) order by display_name) from staff where salon_id=p_salon and is_active),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('staffId',staff_id,'serviceId',service_id)) from staff_service_assignments where salon_id=p_salon and is_active),'[]'::jsonb));
end;$$;
revoke all on function public.staff_booking_creation_catalog(uuid) from public,anon;
grant execute on function public.staff_booking_creation_catalog(uuid) to authenticated;

create or replace function public.create_staff_appointment(p_salon uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); own_staff uuid:=current_user_staff_id_for_salon(p_salon);
  settings booking_settings%rowtype; svc services%rowtype; assignment staff_service_assignments%rowtype;
  target uuid; customer uuid; booking uuid; tz text; starts timestamptz; ends timestamptz; cursor_at timestamptz;
  lines jsonb:='[]'; selected_service uuid; duration integer; buffer integer; price numeric; idx integer:=0;
  customer_name text:=nullif(btrim(p_input->>'name'),''); customer_phone text:=nullif(btrim(p_input->>'phone'),'');
  note text:=nullif(btrim(p_input->>'note'),''); key text:=p_input->>'key'; mode text; state text;
begin
  if actor is null or own_staff is null then raise exception 'Active staff access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-create-permission:'||p_salon::text,0));
  -- Serialize permission changes with creation; re-check every save, not just the UI.
  perform 1 from salon_settings where salon_id=p_salon for share;
  if not (salon_staff_booking_creation(p_salon)->>'enabled')::boolean then raise exception 'The salon owner has turned off staff appointment creation' using errcode='42501'; end if;
  if not salon_is_operational(p_salon) then raise exception 'This salon is not active'; end if;
  if key is null or length(key)>100 or length(key)<10 or customer_name is null or length(customer_name)>150 or customer_phone is null or length(customer_phone)>40 or length(note)>2000
    or jsonb_typeof(p_input->'serviceIds') is distinct from 'array' then raise exception 'Enter customer name, phone and services'; end if;
  if length(regexp_replace(customer_phone,'[^0-9]','','g'))<7 then raise exception 'Enter a valid phone number'; end if;
  if jsonb_array_length(p_input->'serviceIds') not between 1 and 10 then raise exception 'Choose between 1 and 10 services'; end if;
  perform pg_advisory_xact_lock(hashtextextended('staff-booking:'||p_salon::text||':'||actor::text||':'||key,0));
  select id,staff_id into booking,target from bookings where salon_id=p_salon and created_by_user_id=actor and idempotency_key='staff:'||actor::text||':'||key;
  if booking is not null then return jsonb_build_object('ok',true,'bookingId',booking,'assignedToSelf',target=own_staff); end if;
  target:=coalesce(nullif(p_input->>'staffId','')::uuid,own_staff);
  if not exists(select 1 from staff where id=target and salon_id=p_salon and is_active) then raise exception 'Choose an active professional in this salon'; end if;
  select * into settings from booking_settings where salon_id=p_salon;
  tz:=coalesce(settings.timezone_iana,get_salon_business_timezone(p_salon));
  starts:=(p_input->>'startLocal')::timestamp at time zone tz;
  if starts is null then raise exception 'Choose a date and time'; end if;
  if to_char(starts at time zone tz,'YYYY-MM-DD"T"HH24:MI')<>p_input->>'startLocal' then raise exception 'This local time does not exist. Choose another time'; end if;
  buffer:=coalesce(settings.default_cleanup_buffer_minutes,0); cursor_at:=starts;
  if coalesce(settings.payment_required_enabled,false) or coalesce(settings.deposit_required_enabled,false) then raise exception 'Use the payment-enabled booking flow for this salon'; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||p_salon::text,0));
  for selected_service in select value::uuid from jsonb_array_elements_text(p_input->'serviceIds') loop
    select * into svc from services where id=selected_service and salon_id=p_salon and is_active;
    select * into assignment from staff_service_assignments a where a.salon_id=p_salon and a.staff_id=target and a.service_id=selected_service and a.is_active
      and (a.effective_start_date is null or a.effective_start_date<=(cursor_at at time zone tz)::date)
      and (a.effective_end_date is null or a.effective_end_date>=(cursor_at at time zone tz)::date) limit 1;
    if svc.id is null or assignment.id is null then raise exception 'This professional is not assigned to the selected service'; end if;
    duration:=coalesce(assignment.custom_duration_minutes,svc.duration_minutes); price:=coalesce(assignment.custom_price,svc.base_price);
    ends:=cursor_at+make_interval(mins=>duration+buffer);
    if not booking_staff_available(p_salon,target,selected_service,cursor_at,ends) then raise exception 'This time is unavailable. Choose another time or professional'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('service_id',selected_service,'service_name_snapshot',svc.name,'service_category_snapshot',svc.category,'service_description_snapshot',svc.description,
      'unit_price',price,'quantity',1,'duration_minutes',duration,'cleanup_buffer_minutes',buffer,'display_order',idx,'assigned_staff_id',target,'scheduled_start_at',cursor_at,'scheduled_end_at',ends));
    cursor_at:=ends; idx:=idx+1;
  end loop;
  perform assert_booking_time_policy(starts,ends,tz,coalesce(settings.same_day_booking_enabled,false),coalesce(settings.minimum_lead_time_minutes,120),coalesce(settings.maximum_advance_window_days,60),statement_timestamp());
  if mod(extract(minute from starts at time zone tz)::integer,coalesce(settings.slot_interval_minutes,15))<>0 then raise exception 'Choose a time on the salon booking interval'; end if;
  -- Resolve only the exact supplied contact in this salon; never expose a customer directory.
  select c.id into customer from customers c where c.location_id=p_salon and c.status='active' and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g') and lower(btrim(c.name))=lower(customer_name) order by c.created_at limit 1;
  if customer is null then insert into customers(location_id,name,phone,source,created_by_user_id) values(p_salon,customer_name,customer_phone,'manual',actor) returning id into customer; end if;
  mode:=coalesce(settings.confirmation_mode,'request_confirmation'); state:=case when mode='instant_booking' then 'confirmed' else 'pending' end;
  booking:=create_canonical_booking_internal('staff',mode,case when state='confirmed' then 'confirmed' else 'requested' end,customer,null,ends,'staff:'||actor::text||':'||key,null,lines,null,note,p_salon,'staff_manual',starts,state);
  update bookings set staff_id=target,created_by_user_id=actor,updated_by_user_id=actor,salon_timezone_snapshot=tz where id=booking;
  insert into booking_status_events(salon_id,booking_id,event_type,new_status,actor_user_id,actor_staff_id,actor_source)
    values(p_salon,booking,'staff_appointment_created',state,actor,own_staff,'staff');
  return jsonb_build_object('ok',true,'bookingId',booking,'assignedToSelf',target=own_staff);
end;$$;
revoke all on function public.create_staff_appointment(uuid,jsonb) from public,anon;
grant execute on function public.create_staff_appointment(uuid,jsonb) to authenticated;
commit;

