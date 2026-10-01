-- Use the same availability rules, but omit the appointment being edited.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.booking_staff_available(uuid,uuid,uuid,timestamptz,timestamptz,uuid,boolean)'::regprocedure);
 definition:=replace(definition,'public.booking_staff_available(', 'public.booking_staff_available_for_change(');
 definition:=replace(definition,'p_allow_overlap boolean DEFAULT false)', 'p_allow_overlap boolean DEFAULT false, p_ignore_booking uuid DEFAULT NULL::uuid)');
 if position('p_ignore_booking uuid' in definition)=0 then raise exception 'Availability signature changed'; end if;
 definition:=replace(definition,'and l.assigned_staff_id=p_staff', 'and l.booking_id is distinct from p_ignore_booking and l.assigned_staff_id=p_staff');
 execute definition;
end; $patch$;
revoke all on function public.booking_staff_available_for_change(uuid,uuid,uuid,timestamptz,timestamptz,uuid,boolean,uuid) from public,anon,authenticated;

create or replace function public.plan_portable_booking(p_salon uuid,p_services uuid[],p_staff uuid,p_start timestamptz,p_ignore_booking uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare member record; service record; chosen_service_id uuid; cursor_at timestamptz; ends timestamptz; lines jsonb; fits boolean;
 settings booking_settings%rowtype; tz text; duration integer;
begin
 if coalesce(cardinality(p_services),0)=0 or cardinality(p_services)>20 then raise exception 'Choose between 1 and 20 services.'; end if;
 if exists(select 1 from unnest(p_services) id where id is null) then raise exception 'Choose valid services.'; end if;
 select * into settings from booking_settings where salon_id=p_salon;
 tz:=coalesce(settings.timezone_iana,get_salon_business_timezone(p_salon));
 for member in select s.id,s.display_name from staff s where s.salon_id=p_salon and s.is_active and (p_staff is null or s.id=p_staff)
 order by (select count(*) from bookings b where b.salon_id=p_salon and b.staff_id=s.id and b.auto_assigned and b.id is distinct from p_ignore_booking
   and b.status not in ('cancelled','no_show') and (b.start_at at time zone tz)::date=(p_start at time zone tz)::date),
   (select max(b.created_at) from bookings b where b.salon_id=p_salon and b.staff_id=s.id and b.auto_assigned) nulls first,s.id
 loop
   cursor_at:=p_start; lines:='[]'; fits:=true;
   foreach chosen_service_id in array p_services loop
     select s.*,a.custom_duration_minutes,a.custom_price into service from services s
       join staff_service_assignments a on a.service_id=s.id and a.salon_id=s.salon_id and a.staff_id=member.id and a.is_active
       where s.id=chosen_service_id and s.salon_id=p_salon and s.is_active;
     if not found then fits:=false; exit; end if;
     duration:=coalesce(service.custom_duration_minutes,service.duration_minutes);
     ends:=cursor_at+make_interval(mins=>duration+coalesce(settings.default_cleanup_buffer_minutes,0));
     if not booking_staff_available_for_change(p_salon,member.id,chosen_service_id,cursor_at,ends,null,false,p_ignore_booking) then fits:=false; exit; end if;
     lines:=lines||jsonb_build_array(jsonb_build_object('serviceId',chosen_service_id,'serviceName',service.name,'category',service.category,
       'description',service.description,'price',coalesce(service.custom_price,service.base_price),'durationMinutes',duration,
       'bufferMinutes',coalesce(settings.default_cleanup_buffer_minutes,0),'startAt',cursor_at,'endAt',ends));
     cursor_at:=ends;
   end loop;
   if fits then return jsonb_build_object('staffId',member.id,'staffName',member.display_name,'startAt',p_start,'endAt',cursor_at,'lines',lines); end if;
 end loop;
 return null;
end; $$;
revoke all on function public.plan_portable_booking(uuid,uuid[],uuid,timestamptz,uuid) from public,anon,authenticated;

create or replace function public.portable_booking_json(p_salon uuid,p_booking uuid)
returns jsonb language sql security definer set search_path=public as $$
 select jsonb_build_object('id',b.id,'customerId',b.customer_id,'customerName',c.name,'customerPhone',c.phone,'customerEmail',c.email,
   'staffId',b.staff_id,'staffName',s.display_name,'startAt',b.start_at,'endAt',b.end_at,'status',b.status,'updatedAt',b.updated_at,'ticketId',b.pos_ticket_id,
   'serviceNames',coalesce((select jsonb_agg(l.service_name_snapshot order by l.display_order) from booking_lines l where l.booking_id=b.id and l.line_status<>'cancelled'),'[]'),
   'serviceIds',coalesce((select jsonb_agg(l.service_id order by l.display_order) from booking_lines l where l.booking_id=b.id and l.line_status<>'cancelled'),'[]'),
   'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'serviceId',l.service_id,'serviceName',l.service_name_snapshot,'staffId',l.assigned_staff_id,'price',l.line_total) order by l.display_order) from booking_lines l where l.booking_id=b.id and l.line_status<>'cancelled'),'[]'))
 from bookings b join customers c on c.id=b.customer_id left join staff s on s.id=b.staff_id where b.salon_id=p_salon and b.id=p_booking;
$$;
revoke all on function public.portable_booking_json(uuid,uuid) from public,anon,authenticated;

create or replace function public.apply_portable_booking_plan(p_salon uuid,p_booking uuid,p_plan jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare line jsonb; ordinal integer:=0;
begin
 -- Retain cancelled lines for history; release old reservations in this transaction.
 update booking_lines set line_status='cancelled' where salon_id=p_salon and booking_id=p_booking and line_status<>'cancelled';
 update bookings set staff_id=(p_plan->>'staffId')::uuid,start_at=(p_plan->>'startAt')::timestamptz,end_at=(p_plan->>'endAt')::timestamptz where salon_id=p_salon and id=p_booking;
 for line in select value from jsonb_array_elements(p_plan->'lines') loop
   insert into booking_lines(salon_id,booking_id,service_id,service_name_snapshot,service_category_snapshot,service_description_snapshot,
     assigned_staff_id,duration_minutes,cleanup_buffer_minutes,scheduled_start_at,scheduled_end_at,unit_price,line_total,display_order)
   values(p_salon,p_booking,(line->>'serviceId')::uuid,line->>'serviceName',line->>'category',line->>'description',
     (p_plan->>'staffId')::uuid,(line->>'durationMinutes')::integer,(line->>'bufferMinutes')::integer,(line->>'startAt')::timestamptz,(line->>'endAt')::timestamptz,
     (line->>'price')::numeric,(line->>'price')::numeric,ordinal);
   ordinal:=ordinal+1;
 end loop;
end; $$;
revoke all on function public.apply_portable_booking_plan(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function public.create_pos_portable_appointment_v3(p_key_id uuid,p_session_signature text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; services uuid[]; plan jsonb; result jsonb; requested_staff_id uuid; starts timestamptz;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Not authorized'; end if;
 services:=case when jsonb_typeof(p_payload->'serviceIds')='array' then array(select jsonb_array_elements_text(p_payload->'serviceIds')::uuid) else array[(p_payload->>'serviceId')::uuid] end;
 requested_staff_id:=nullif(p_payload->>'staffId','')::uuid; starts:=(p_payload->>'startAt')::timestamptz;
 if requested_staff_id is null and not coalesce((select auto_assign_enabled from booking_settings where salon_id=salon),true) then raise exception 'Choose a professional.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||salon::text,0));
 plan:=plan_portable_booking(salon,services,requested_staff_id,starts);
 if plan is null then raise exception 'These services do not fit at this time. Choose an available time or another professional.'; end if;
 result:=create_pos_portable_appointment_v2(p_key_id,p_session_signature,p_payload->>'customerName',p_payload->>'customerPhone',p_payload->>'customerEmail',
   services[1],(plan->>'staffId')::uuid,starts,nullif(p_payload->>'customerId','')::uuid);
 perform apply_portable_booking_plan(salon,(result->>'id')::uuid,plan);
 update bookings set auto_assigned=requested_staff_id is null where id=(result->>'id')::uuid;
 return portable_booking_json(salon,(result->>'id')::uuid);
end; $$;
revoke all on function public.create_pos_portable_appointment_v3(uuid,text,jsonb) from public,anon,authenticated;

do $patch$
declare definition text; old_call text;
begin
 definition:=pg_get_functiondef('public.replay_pos_portable_operation(uuid,text,uuid,text,timestamptz,jsonb)'::regprocedure);
 old_call:=substring(definition from 'public\.create_pos_portable_appointment_v2\(p_key_id[\s\S]*?;');
 if old_call is null then raise exception 'Booking replay implementation changed'; end if;
 definition:=replace(definition,old_call,'public.create_pos_portable_appointment_v3(p_key_id,p_session_signature,p_payload);');
 execute definition;
end; $patch$;

create or replace function public.manage_pos_portable_booking(p_key_id uuid,p_session_signature text,p_booking_id uuid,p_action text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; booking bookings%rowtype; plan jsonb; services uuid[]; old_status text; target_status text; requested_staff_id uuid; settings booking_settings%rowtype; local_start timestamp;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.view') then raise exception 'Not authorized'; end if;
 if p_action not in ('read','edit','confirm','cancel','ticket') then raise exception 'Invalid appointment action'; end if;
 if p_action='cancel' and not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.cancel') then raise exception 'Device cannot cancel appointments'; end if;
 if p_action in ('edit','confirm') and not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Device cannot edit appointments'; end if;
 if p_action='ticket' and not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.pos.use') then raise exception 'Device cannot create tickets'; end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-schedule:'||salon::text,0));
 select * into booking from bookings where salon_id=salon and id=p_booking_id for update;
 if booking.id is null then raise exception 'Appointment not found in this salon'; end if;
 if p_action='read' then return portable_booking_json(salon,p_booking_id); end if;
 if nullif(p_payload->>'updatedAt','') is not null and (p_payload->>'updatedAt')::timestamptz<>booking.updated_at then raise exception 'This appointment changed on another device. Reopen it and try again.'; end if;
 if p_action='ticket' then
   if booking.pos_ticket_id is not null then raise exception 'This appointment already has a ticket. Open it in Ticket to avoid a duplicate.'; end if;
   if booking.status not in ('scheduled','confirmed','checked_in','in_service') then raise exception 'Confirm this appointment before creating a ticket.'; end if;
   return portable_booking_json(salon,p_booking_id);
 end if;
 if booking.pos_ticket_id is not null then raise exception 'This appointment already has a ticket. Manage it from Ticket.'; end if;
 if booking.status not in ('pending','scheduled','confirmed') and not (p_action='cancel' and booking.status='checked_in') then raise exception 'This appointment can no longer be edited or cancelled here.'; end if;
 old_status:=booking.status;
 if p_action='edit' then
   if booking.start_at<=statement_timestamp() then raise exception 'This appointment has already started. Create its ticket or manage its status instead.'; end if;
   services:=array(select jsonb_array_elements_text(p_payload->'serviceIds')::uuid);
   select * into settings from booking_settings where salon_id=salon;
   local_start:=(p_payload->>'startAt')::timestamptz at time zone coalesce(settings.timezone_iana,get_salon_business_timezone(salon));
   if (p_payload->>'startAt')::timestamptz is distinct from booking.start_at and
     (mod(extract(minute from local_start)::integer,coalesce(settings.slot_interval_minutes,15))<>0 or extract(second from local_start)<>0) then
     raise exception 'Choose a time on the salon booking interval.';
   end if;
   requested_staff_id:=nullif(p_payload->>'staffId','')::uuid;
   if requested_staff_id is null and not coalesce((select auto_assign_enabled from booking_settings where salon_id=salon),true) then raise exception 'Choose a professional.'; end if;
   plan:=plan_portable_booking(salon,services,requested_staff_id,(p_payload->>'startAt')::timestamptz,p_booking_id);
   if plan is null then raise exception 'These services do not fit at this time. Choose an available time or another professional.'; end if;
   perform apply_portable_booking_plan(salon,p_booking_id,plan);
   update bookings set auto_assigned=requested_staff_id is null where id=p_booking_id;
 else
   target_status:=case when p_action='confirm' then 'confirmed' else 'cancelled' end;
   update bookings set status=target_status,confirmation_status=case when p_action='confirm' then 'confirmed' else confirmation_status end,
     cancelled_at=case when p_action='cancel' then now() else cancelled_at end,
     cancellation_reason=case when p_action='cancel' then coalesce(nullif(trim(p_payload->>'reason'),''),'Cancelled in Portable') else cancellation_reason end where id=p_booking_id;
   if p_action='cancel' then update booking_lines set line_status='cancelled' where booking_id=p_booking_id; end if;
 end if;
 insert into booking_status_events(salon_id,booking_id,event_type,old_status,new_status,actor_source,metadata)
 values(salon,p_booking_id,'portable_'||p_action,old_status,coalesce(target_status,old_status),'pos',jsonb_build_object('keyId',p_key_id));
 return portable_booking_json(salon,p_booking_id);
end; $$;
revoke all on function public.manage_pos_portable_booking(uuid,text,uuid,text,jsonb) from public;
grant execute on function public.manage_pos_portable_booking(uuid,text,uuid,text,jsonb) to anon,authenticated;

create or replace function public.get_pos_portable_booking_slots_v2(p_key_id uuid,p_session_signature text,p_service_ids uuid[],p_staff_id uuid,p_date date,p_booking_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; settings booking_settings%rowtype; tz text; slot timestamptz; plan jsonb; slots jsonb:='[]'; existing_start timestamptz;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Not authorized'; end if;
 if p_booking_id is not null then
   select start_at into existing_start from bookings where id=p_booking_id and salon_id=salon;
   if not found then raise exception 'Appointment not found'; end if;
 end if;
 select * into settings from booking_settings where salon_id=salon;
 tz:=coalesce(settings.timezone_iana,get_salon_business_timezone(salon));
 if p_date<(statement_timestamp() at time zone tz)::date or p_date>(statement_timestamp() at time zone tz)::date+coalesce(settings.maximum_advance_window_days,60) then return slots; end if;
 for slot in select * from generate_series(p_date::timestamp at time zone tz,(p_date+1)::timestamp at time zone tz-interval '1 minute',make_interval(mins=>coalesce(settings.slot_interval_minutes,15))) loop
   if slot<=statement_timestamp() then continue; end if;
   if slot is distinct from existing_start then
     begin perform assert_booking_time_policy(slot,slot+interval '1 minute',tz,coalesce(settings.same_day_booking_enabled,false),coalesce(settings.minimum_lead_time_minutes,120),coalesce(settings.maximum_advance_window_days,60),statement_timestamp());
     exception when raise_exception then continue; end;
   end if;
   plan:=plan_portable_booking(salon,p_service_ids,p_staff_id,slot,p_booking_id);
   if plan is not null then slots:=slots||jsonb_build_array(jsonb_build_object('startAt',slot,'endAt',plan->>'endAt','staffName',plan->>'staffName','label',to_char(slot at time zone tz,'HH24:MI'))); end if;
 end loop;
 return slots;
end; $$;
revoke all on function public.get_pos_portable_booking_slots_v2(uuid,text,uuid[],uuid,date,uuid) from public;
grant execute on function public.get_pos_portable_booking_slots_v2(uuid,text,uuid[],uuid,date,uuid) to anon,authenticated;

-- Include identities and versions in the existing salon-scoped calendar response.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.get_pos_portable_book_data(uuid,text,date)'::regprocedure);
 definition:=replace(definition,'''id'', booking_rows.id,','''id'', booking_rows.id, ''updatedAt'',booking_rows.updated_at,''ticketId'',booking_rows.pos_ticket_id,''customerId'',booking_rows.customer_id, ''serviceIds'',booking_rows.service_ids,');
 definition:=replace(definition,'bookings.id,','bookings.id, bookings.updated_at,bookings.pos_ticket_id,bookings.customer_id,(select jsonb_agg(l.service_id order by l.display_order) from booking_lines l where l.booking_id=bookings.id and l.line_status<>''cancelled'') as service_ids,');
 execute definition;
end; $patch$;
notify pgrst,'reload schema';
