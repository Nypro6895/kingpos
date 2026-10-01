-- Existing salon preferences are retained. New Portable features default on.
alter table public.pos_settings add column if not exists touch_keyboard_enabled boolean not null default true;
alter table public.booking_settings add column if not exists auto_assign_enabled boolean not null default true;
alter table public.bookings add column if not exists auto_assigned boolean not null default false;

do $patch$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_pos_portable_access_context(uuid,text)'::regprocedure);
  if position('touch_keyboard_enabled' in definition)=0 then
    definition := replace(definition, '''salon_timezone'', context_row.salon_timezone',
      '''touch_keyboard_enabled'', coalesce((select touch_keyboard_enabled from public.pos_settings where salon_id=target_salon_id),true), ''salon_timezone'', context_row.salon_timezone');
    execute definition;
  end if;
end; $patch$;

create or replace function public.booking_staff_available(
 p_salon uuid,p_staff uuid,p_service uuid,p_start timestamptz,p_end timestamptz,p_ignore_line uuid default null,p_allow_overlap boolean default false
) returns boolean language plpgsql volatile security definer set search_path=public as $$
declare tz text; local_start timestamp; local_end timestamp;
begin
  tz := coalesce((select timezone_iana from booking_settings where salon_id=p_salon),get_salon_business_timezone(p_salon));
  local_start := p_start at time zone tz; local_end := p_end at time zone tz;
  if p_staff is null or p_start is null or p_end <= p_start or local_start::date<>local_end::date then return false; end if;
  if not exists(select 1 from staff where id=p_staff and salon_id=p_salon and is_active) then return false; end if;
  if not exists(select 1 from services where id=p_service and salon_id=p_salon and is_active) then return false; end if;
  if not exists(select 1 from staff_service_assignments where salon_id=p_salon and staff_id=p_staff and service_id=p_service and is_active
    and (effective_start_date is null or effective_start_date<=local_start::date)
    and (effective_end_date is null or effective_end_date>=local_start::date)) then return false; end if;
  -- A staff-specific working schedule replaces shared hours on that date.
  if not exists(select 1 from staff_availability_rules r where r.salon_id=p_salon and r.is_active and r.rule_type='working'
    and r.day_of_week=extract(dow from local_start) and r.starts_at_local<=local_start::time and r.ends_at_local>=local_end::time
    and (r.effective_start_date is null or r.effective_start_date<=local_start::date)
    and (r.effective_end_date is null or r.effective_end_date>=local_start::date)
    and (r.staff_id=p_staff or (r.staff_id is null and not exists(select 1 from staff_availability_rules x
      where x.salon_id=p_salon and x.staff_id=p_staff and x.is_active and x.rule_type='working'
      and x.day_of_week=extract(dow from local_start)
      and (x.effective_start_date is null or x.effective_start_date<=local_start::date)
      and (x.effective_end_date is null or x.effective_end_date>=local_start::date))))) then return false; end if;
  if exists(select 1 from staff_availability_rules r where r.salon_id=p_salon and r.is_active and r.rule_type='break'
    and (r.staff_id is null or r.staff_id=p_staff) and r.day_of_week=extract(dow from local_start)
    and (r.effective_start_date is null or r.effective_start_date<=local_start::date)
    and (r.effective_end_date is null or r.effective_end_date>=local_start::date)
    and r.starts_at_local<local_end::time and r.ends_at_local>local_start::time) then return false; end if;
  if exists(select 1 from staff_time_blocks where salon_id=p_salon and is_active and (staff_id is null or staff_id=p_staff)
    and starts_at<p_end and ends_at>p_start) then return false; end if;
  if not p_allow_overlap and exists(select 1 from booking_lines l join bookings b on b.id=l.booking_id where l.salon_id=p_salon
    and l.assigned_staff_id=p_staff and l.id is distinct from p_ignore_line
    and b.status not in ('cancelled','no_show') and l.line_status not in ('cancelled','no_show')
    and l.scheduled_start_at<p_end and l.scheduled_end_at>p_start) then return false; end if;
  return true;
end; $$;
revoke all on function public.booking_staff_available(uuid,uuid,uuid,timestamptz,timestamptz,uuid,boolean) from public,anon,authenticated;

-- Exclusion constraint provides the final concurrent-write guard; historical rows
-- remain intact and are checked by booking_staff_available before every new reservation.
create extension if not exists btree_gist with schema extensions;
create table if not exists public.booking_staff_reservations (
 line_id uuid primary key references public.booking_lines(id) on delete cascade,
 salon_id uuid not null references public.locations(id) on delete cascade,
 staff_id uuid not null references public.staff(id) on delete cascade,
 occupied tstzrange not null,
 exclude using gist (staff_id with =, occupied with &&)
);
alter table public.booking_staff_reservations enable row level security;
revoke all on public.booking_staff_reservations from anon,authenticated;

create or replace function public.enforce_booking_line_schedule()
returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare parent public.bookings%rowtype; approved_override boolean; required_minutes integer;
begin
  select * into parent from bookings where id=new.booking_id;
  if parent.salon_id is distinct from new.salon_id then raise exception 'Appointment salon does not match.'; end if;
  if parent.status in ('cancelled','no_show') or new.line_status in ('cancelled','no_show') or new.assigned_staff_id is null then
    delete from booking_staff_reservations where line_id=new.id;
    return new;
  end if;
  if TG_OP='UPDATE' and (new.assigned_staff_id,new.service_id,new.scheduled_start_at,new.scheduled_end_at,new.line_status)
     is not distinct from (old.assigned_staff_id,old.service_id,old.scheduled_start_at,old.scheduled_end_at,old.line_status) then return new; end if;
  -- Changing progress on historical appointments must remain possible.
  if TG_OP='UPDATE' and (new.assigned_staff_id,new.service_id,new.scheduled_start_at,new.scheduled_end_at)
     is not distinct from (old.assigned_staff_id,old.service_id,old.scheduled_start_at,old.scheduled_end_at)
     and old.line_status not in ('cancelled','no_show') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||new.salon_id::text,0));
  select coalesce(a.custom_duration_minutes,s.duration_minutes)+coalesce(bs.default_cleanup_buffer_minutes,0)
    into required_minutes from services s
    left join staff_service_assignments a on a.salon_id=s.salon_id and a.service_id=s.id and a.staff_id=new.assigned_staff_id and a.is_active
    left join booking_settings bs on bs.salon_id=s.salon_id
    where s.id=new.service_id and s.salon_id=new.salon_id;
  if new.scheduled_end_at<new.scheduled_start_at+make_interval(mins=>required_minutes) then
    raise exception 'The appointment must include this professional''s service duration and the salon cleanup buffer.';
  end if;
  approved_override := nullif(trim(new.overbooking_override_reason),'') is not null and new.overbooking_override_by_user_id is not null
    and public.user_has_salon_permission(new.salon_id,array['booking.manage']);
  if not booking_staff_available(new.salon_id,new.assigned_staff_id,new.service_id,new.scheduled_start_at,new.scheduled_end_at,new.id,approved_override) then
    raise exception 'Professional is unavailable: check service eligibility, working hours, breaks, time off, and overlapping appointments.';
  end if;
  if approved_override then
    delete from booking_staff_reservations where line_id=new.id;
    return new;
  end if;
  insert into booking_staff_reservations(line_id,salon_id,staff_id,occupied)
    values(new.id,new.salon_id,new.assigned_staff_id,tstzrange(new.scheduled_start_at,new.scheduled_end_at,'[)'))
    on conflict(line_id) do update set staff_id=excluded.staff_id,occupied=excluded.occupied;
  return new;
exception when exclusion_violation then raise exception 'This professional was just booked at that time. Choose another available time.';
end; $$;
revoke all on function public.enforce_booking_line_schedule() from public,anon,authenticated;
create trigger enforce_booking_line_schedule after insert or update on public.booking_lines
for each row execute function public.enforce_booking_line_schedule();

create or replace function public.release_booking_schedule()
returns trigger language plpgsql security definer set search_path=public as $$
declare line public.booking_lines%rowtype;
begin
  if new.status in ('cancelled','no_show') then
    delete from booking_staff_reservations where line_id in(select id from booking_lines where booking_id=new.id);
  elsif old.status in ('cancelled','no_show') then
    -- Preserve cancelled service lines when reinstating an appointment.
    perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||new.salon_id::text,0));
    for line in select * from booking_lines where booking_id=new.id and line_status not in ('cancelled','no_show') and assigned_staff_id is not null loop
      if not booking_staff_available(line.salon_id,line.assigned_staff_id,line.service_id,line.scheduled_start_at,line.scheduled_end_at,line.id) then
        raise exception 'The previous appointment time is no longer available.';
      end if;
      insert into booking_staff_reservations(line_id,salon_id,staff_id,occupied)
      values(line.id,line.salon_id,line.assigned_staff_id,tstzrange(line.scheduled_start_at,line.scheduled_end_at,'[)'))
      on conflict(line_id) do update set occupied=excluded.occupied,staff_id=excluded.staff_id;
    end loop;
  end if;
  return new;
end; $$;
revoke all on function public.release_booking_schedule() from public,anon,authenticated;
create trigger release_booking_schedule after update of status on public.bookings
for each row when(old.status is distinct from new.status) execute function public.release_booking_schedule();

create or replace function public.create_pos_portable_appointment_v2(
 p_key_id uuid,p_session_signature text,p_customer_name text,p_customer_phone text,p_customer_email text,
 p_service_id uuid,p_staff_id uuid,p_start_at timestamptz,p_customer_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; customer uuid; booking uuid; chosen uuid; settings booking_settings%rowtype;
 service services%rowtype; assignment staff_service_assignments%rowtype; duration integer; buffer integer; ends timestamptz;
 tz text; booking_status text; staff_name text;
begin
 salon := pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Not authorized'; end if;
 if nullif(trim(p_customer_name),'') is null then raise exception 'Customer name is required'; end if;
 select * into settings from booking_settings where salon_id=salon;
 select * into service from services where id=p_service_id and salon_id=salon and is_active;
 if service.id is null then raise exception 'Service is unavailable'; end if;
 tz := coalesce(settings.timezone_iana,get_salon_business_timezone(salon));
 buffer := coalesce(settings.default_cleanup_buffer_minutes,0);
 perform assert_booking_time_policy(p_start_at,p_start_at+interval '1 minute',tz,coalesce(settings.same_day_booking_enabled,false),
   coalesce(settings.minimum_lead_time_minutes,120),coalesce(settings.maximum_advance_window_days,60),statement_timestamp());
 if mod(extract(minute from p_start_at at time zone tz)::integer,coalesce(settings.slot_interval_minutes,15))<>0
   or extract(second from p_start_at)<>0 then raise exception 'Choose a time on the salon booking interval.'; end if;
 if p_staff_id is null and not coalesce(settings.auto_assign_enabled,true) then raise exception 'Choose a professional. Automatic assignment is disabled.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||salon::text,0));
 select a.* into assignment from staff_service_assignments a
 where a.salon_id=salon and a.service_id=p_service_id and a.is_active and (p_staff_id is null or a.staff_id=p_staff_id)
 and booking_staff_available(salon,a.staff_id,p_service_id,p_start_at,
   p_start_at+make_interval(mins=>coalesce(a.custom_duration_minutes,service.duration_minutes)+buffer))
 order by (select count(*) from bookings b where b.salon_id=salon and b.staff_id=a.staff_id and b.auto_assigned
   and b.status not in ('cancelled','no_show') and (b.start_at at time zone tz)::date=(p_start_at at time zone tz)::date),
   (select max(b.created_at) from bookings b where b.salon_id=salon and b.staff_id=a.staff_id and b.auto_assigned) nulls first,a.staff_id
 limit 1;
 if assignment.id is null then raise exception 'No available professional. Check service assignments, working hours, breaks, time off, or choose another time.'; end if;
 chosen := assignment.staff_id; duration := coalesce(assignment.custom_duration_minutes,service.duration_minutes);
 ends := p_start_at+make_interval(mins=>duration+buffer);
 if p_customer_id is not null then
   select id into customer from customers where id=p_customer_id and location_id=salon and status='active';
   if customer is null then raise exception 'Selected customer is unavailable in this salon.'; end if;
 else
   select id into customer from customers where location_id=salon and status='active' and (
     (nullif(trim(p_customer_phone),'') is not null and phone=trim(p_customer_phone)) or
     (nullif(trim(p_customer_email),'') is not null and lower(email)=lower(trim(p_customer_email)))) order by updated_at desc limit 1;
 end if;
 if customer is null then
   insert into customers(location_id,name,phone,email,source) values(salon,trim(p_customer_name),nullif(trim(p_customer_phone),''),nullif(lower(trim(p_customer_email)),''),'portable_pos') returning id into customer;
 end if;
 booking_status := case when coalesce(settings.confirmation_mode,'request_confirmation')='instant_booking' then 'confirmed' else 'pending' end;
 if coalesce(settings.payment_required_enabled,false) or coalesce(settings.deposit_required_enabled,false) then
   raise exception 'This salon requires payment or a deposit. Complete booking through the payment-enabled booking flow.';
 end if;
 insert into bookings(salon_id,customer_id,staff_id,start_at,end_at,status,source,confirmation_mode,confirmation_status,
   salon_timezone_snapshot,auto_assigned,cancellation_policy_snapshot)
 values(salon,customer,chosen,p_start_at,ends,booking_status,'pos',coalesce(settings.confirmation_mode,'request_confirmation'),
   case when booking_status='confirmed' then 'confirmed' else 'requested' end,tz,p_staff_id is null,
   jsonb_build_object('cancellationWindowMinutes',coalesce(settings.cancellation_window_minutes,1440),'lateCancellationPolicy',settings.late_cancellation_policy)) returning id into booking;
 insert into booking_lines(salon_id,booking_id,service_id,service_name_snapshot,service_category_snapshot,service_description_snapshot,
   unit_price,line_total,duration_minutes,cleanup_buffer_minutes,assigned_staff_id,scheduled_start_at,scheduled_end_at)
 values(salon,booking,p_service_id,service.name,service.category,service.description,coalesce(assignment.custom_price,service.base_price),
   coalesce(assignment.custom_price,service.base_price),duration,buffer,chosen,p_start_at,ends);
 select display_name into staff_name from staff where id=chosen;
 return jsonb_build_object('id',booking,'customerId',customer,'customerName',trim(p_customer_name),'customerPhone',p_customer_phone,
   'startAt',p_start_at,'endAt',ends,'serviceNames',jsonb_build_array(service.name),'staffId',chosen,'staffName',staff_name,'status',booking_status);
end; $$;
revoke all on function public.create_pos_portable_appointment_v2(uuid,text,text,text,text,uuid,uuid,timestamptz,uuid) from public;
grant execute on function public.create_pos_portable_appointment_v2(uuid,text,text,text,text,uuid,uuid,timestamptz,uuid) to anon,authenticated;

create or replace function public.create_pos_portable_appointment(p_key_id uuid,p_session_signature text,p_customer_name text,p_customer_phone text,p_customer_email text,p_service_id uuid,p_staff_id uuid,p_start_at timestamptz)
returns jsonb language sql security definer set search_path=public as $$
 select create_pos_portable_appointment_v2($1,$2,$3,$4,$5,$6,$7,$8,null);
$$;
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb)'::regprocedure);
 definition:=replace(definition,'public.create_pos_portable_appointment(p_key_id','public.create_pos_portable_appointment_v2(p_key_id');
 definition:=replace(definition,'(p_payload->>''startAt'')::timestamptz);','(p_payload->>''startAt'')::timestamptz,nullif(p_payload->>''customerId'','''')::uuid);');
 execute definition;
end; $patch$;
notify pgrst,'reload schema';

create or replace function public.get_pos_portable_booking_slots(p_key_id uuid,p_session_signature text,p_service_id uuid,p_staff_id uuid,p_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; settings booking_settings%rowtype; tz text; slots jsonb;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Not authorized'; end if;
 select * into settings from booking_settings where salon_id=salon;
 tz:=coalesce(settings.timezone_iana,get_salon_business_timezone(salon));
 if p_date<(statement_timestamp() at time zone tz)::date or p_date>(statement_timestamp() at time zone tz)::date+coalesce(settings.maximum_advance_window_days,60) then return '[]'; end if;
 if not coalesce(settings.same_day_booking_enabled,false) and p_date=(statement_timestamp() at time zone tz)::date then return '[]'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('startAt',slot,'label',to_char(slot at time zone tz,'HH24:MI')) order by slot),'[]') into slots
 from generate_series(p_date::timestamp at time zone tz,(p_date+1)::timestamp at time zone tz-interval '1 minute',make_interval(mins=>coalesce(settings.slot_interval_minutes,15))) slot
 where slot>statement_timestamp() and slot>=statement_timestamp()+make_interval(mins=>coalesce(settings.minimum_lead_time_minutes,120))
 and slot<=statement_timestamp()+make_interval(days=>coalesce(settings.maximum_advance_window_days,60))
 and exists(select 1 from staff_service_assignments a join services s on s.id=a.service_id and s.salon_id=salon and s.is_active
  where a.salon_id=salon and a.service_id=p_service_id and a.is_active and (p_staff_id is null or a.staff_id=p_staff_id)
  and booking_staff_available(salon,a.staff_id,p_service_id,slot,slot+make_interval(mins=>coalesce(a.custom_duration_minutes,s.duration_minutes)+coalesce(settings.default_cleanup_buffer_minutes,0))));
 return slots;
end; $$;
revoke all on function public.get_pos_portable_booking_slots(uuid,text,uuid,uuid,date) from public;
grant execute on function public.get_pos_portable_booking_slots(uuid,text,uuid,uuid,date) to anon,authenticated;

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.get_pos_portable_book_data(uuid,text,date)'::regprocedure);
 definition:=replace(definition,'''staffName'', booking_rows.staff_name,','''staffName'', booking_rows.staff_name, ''staffId'', booking_rows.staff_id,');
 definition:=replace(definition,'bookings.id,','bookings.id, bookings.staff_id,');
 execute definition;
 definition:=pg_get_functiondef('public.get_pos_portable_booking_policy(uuid,text)'::regprocedure);
 definition:=replace(definition,'''sameDayBookingEnabled'',','''autoAssignEnabled'',coalesce(settings.auto_assign_enabled,true), ''sameDayBookingEnabled'',');
 execute definition;
end; $patch$;
