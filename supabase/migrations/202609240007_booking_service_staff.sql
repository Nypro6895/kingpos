-- Services run sequentially; each has its own eligible professional and duration.
create or replace function public.walk_portable_service_plan(p_salon uuid,p_services uuid[],p_staffs uuid[],p_at timestamptz,p_ignore uuid,p_index integer,p_used uuid[],p_budget integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare candidate record; tail jsonb; ends timestamptz; spent integer:=0; settings booking_settings%rowtype; tz text;
begin
 if p_index>cardinality(p_services) then return jsonb_build_object('lines','[]'::jsonb,'attempts',0); end if;
 select * into settings from booking_settings where salon_id=p_salon;
 tz:=coalesce(settings.timezone_iana,get_salon_business_timezone(p_salon));
 for candidate in
   select s.id,s.display_name,v.id service_id,v.name,v.category,v.description,
     coalesce(a.custom_duration_minutes,v.duration_minutes) duration,
     coalesce(a.custom_price,v.base_price) price
   from staff s join staff_service_assignments a on a.staff_id=s.id and a.salon_id=p_salon and a.is_active
   join services v on v.id=a.service_id and v.salon_id=p_salon and v.is_active
   where s.salon_id=p_salon and s.is_active and v.id=p_services[p_index]
     and (p_staffs[p_index] is null or s.id=p_staffs[p_index])
     and (a.effective_start_date is null or a.effective_start_date<=(p_at at time zone tz)::date)
     and (a.effective_end_date is null or a.effective_end_date>=(p_at at time zone tz)::date)
   order by (s.id=any(p_used)),
     (select count(*) from booking_lines l join bookings b on b.id=l.booking_id where l.salon_id=p_salon and l.assigned_staff_id=s.id
       and l.line_status<>'cancelled' and b.status not in ('cancelled','no_show') and b.auto_assigned and b.id is distinct from p_ignore
       and (l.scheduled_start_at at time zone tz)::date=(p_at at time zone tz)::date),
     (select max(b.created_at) from booking_lines l join bookings b on b.id=l.booking_id where l.salon_id=p_salon and l.assigned_staff_id=s.id and b.auto_assigned and l.line_status<>'cancelled' and b.status not in ('cancelled','no_show') and b.id is distinct from p_ignore) nulls first,s.id
 loop
   spent:=spent+1;
   if spent>p_budget then raise exception 'Schedule is too complex to recommend automatically. Choose a professional for one or more services.'; end if;
   ends:=p_at+make_interval(mins=>candidate.duration+coalesce(settings.default_cleanup_buffer_minutes,0));
   if not booking_staff_available_for_change(p_salon,candidate.id,candidate.service_id,p_at,ends,null,false,p_ignore) then continue; end if;
   tail:=walk_portable_service_plan(p_salon,p_services,p_staffs,ends,p_ignore,p_index+1,array_append(p_used,candidate.id),p_budget-spent);
   spent:=spent+coalesce((tail->>'attempts')::integer,0);
   if jsonb_typeof(tail->'lines')='array' then
     return jsonb_build_object('attempts',spent,'lines',jsonb_build_array(jsonb_build_object('serviceId',candidate.service_id,'serviceName',candidate.name,
       'category',candidate.category,'description',candidate.description,'staffId',candidate.id,'staffName',candidate.display_name,'price',candidate.price,
       'durationMinutes',candidate.duration,'bufferMinutes',coalesce(settings.default_cleanup_buffer_minutes,0),'startAt',p_at,'endAt',ends))||(tail->'lines'));
   end if;
 end loop;
 return jsonb_build_object('lines',null,'attempts',spent);
end; $$;
revoke all on function public.walk_portable_service_plan(uuid,uuid[],uuid[],timestamptz,uuid,integer,uuid[],integer) from public,anon,authenticated;

create or replace function public.plan_portable_booking_services(p_salon uuid,p_services uuid[],p_staff uuid,p_start timestamptz,p_ignore_booking uuid default null,p_staff_ids jsonb default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare requested uuid[]; result jsonb; lines jsonb; shared uuid; names text;
begin
 if coalesce(cardinality(p_services),0)=0 or cardinality(p_services)>20 or array_position(p_services,null) is not null then raise exception 'Choose between 1 and 20 valid services.'; end if;
 if p_staff_ids is not null and jsonb_typeof(p_staff_ids)<>'null' then
   if jsonb_typeof(p_staff_ids)<>'array' or jsonb_array_length(p_staff_ids)<>cardinality(p_services) then raise exception 'Choose a professional for each service.'; end if;
   requested:=array(select nullif(value,'')::uuid from jsonb_array_elements_text(p_staff_ids));
 else requested:=array_fill(p_staff,array[cardinality(p_services)]); end if;
 if array_position(requested,null) is not null and not coalesce((select auto_assign_enabled from booking_settings where salon_id=p_salon),true) then raise exception 'Choose a professional for each service.'; end if;
 result:=walk_portable_service_plan(p_salon,p_services,requested,p_start,p_ignore_booking,1,array[]::uuid[],2000);
 lines:=result->'lines';
 if jsonb_typeof(lines)<>'array' then return null; end if;
 select case when count(distinct value->>'staffId')=1 then min(value->>'staffId')::uuid end,
   string_agg(distinct value->>'staffName',', ') into shared,names from jsonb_array_elements(lines);
 return jsonb_build_object('staffId',shared,'staffName',names,'startAt',p_start,'endAt',lines->-1->>'endAt','lines',lines,
   'autoAssigned',array_position(requested,null) is not null);
end; $$;
revoke all on function public.plan_portable_booking_services(uuid,uuid[],uuid,timestamptz,uuid,jsonb) from public,anon,authenticated;

-- Old callers also receive the corrected automatic recommendation behavior.
create or replace function public.plan_portable_booking(p_salon uuid,p_services uuid[],p_staff uuid,p_start timestamptz,p_ignore_booking uuid default null)
returns jsonb language sql security definer set search_path=public as $$
 select plan_portable_booking_services(p_salon,p_services,p_staff,p_start,p_ignore_booking);
$$;

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('public.apply_portable_booking_plan(uuid,uuid,jsonb)'::regprocedure);
 definition:=replace(definition,'(p_plan->>''staffId'')::uuid,(line->>''durationMinutes'')','coalesce(line->>''staffId'',p_plan->>''staffId'')::uuid,(line->>''durationMinutes'')');
 execute definition;
 definition:=pg_get_functiondef('public.create_pos_portable_appointment_v3(uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,'if requested_staff_id is null and not coalesce','if p_payload->''staffIds'' is null and requested_staff_id is null and not coalesce');
 definition:=replace(definition,'plan_portable_booking(salon,services,requested_staff_id,starts)','plan_portable_booking_services(salon,services,requested_staff_id,starts,null,p_payload->''staffIds'')');
 definition:=replace(definition,'services[1],(plan->>''staffId'')::uuid','services[1],(plan->''lines''->0->>''staffId'')::uuid');
 definition:=replace(definition,'auto_assigned=requested_staff_id is null','auto_assigned=(plan->>''autoAssigned'')::boolean');
 execute definition;
 definition:=pg_get_functiondef('public.manage_pos_portable_booking(uuid,text,uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,'if requested_staff_id is null and not coalesce','if p_payload->''staffIds'' is null and requested_staff_id is null and not coalesce');
 definition:=replace(definition,'plan_portable_booking(salon,services,requested_staff_id,(p_payload->>''startAt'')::timestamptz,p_booking_id)','plan_portable_booking_services(salon,services,requested_staff_id,(p_payload->>''startAt'')::timestamptz,p_booking_id,p_payload->''staffIds'')');
 definition:=replace(definition,'auto_assigned=requested_staff_id is null','auto_assigned=(plan->>''autoAssigned'')::boolean');
 execute definition;
 definition:=pg_get_functiondef('public.portable_booking_json(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'''staffName'',s.display_name','''staffName'',coalesce(s.display_name,(select string_agg(distinct st.display_name,'', '') from booking_lines l join staff st on st.id=l.assigned_staff_id where l.booking_id=b.id and l.line_status<>''cancelled'')),''total'',(select sum(l.line_total) from booking_lines l where l.booking_id=b.id and l.line_status<>''cancelled'')');
 definition:=replace(definition,'''staffId'',l.assigned_staff_id,''price''','''staffId'',l.assigned_staff_id,''staffName'',(select display_name from staff where id=l.assigned_staff_id),''startAt'',l.scheduled_start_at,''endAt'',l.scheduled_end_at,''price''');
 execute definition;
 definition:=pg_get_functiondef('public.get_pos_portable_booking_slots_v2(uuid,text,uuid[],uuid,date,uuid)'::regprocedure);
 definition:=replace(definition,'public.get_pos_portable_booking_slots_v2(', 'public.get_pos_portable_booking_slots_v3(');
 definition:=replace(definition,'p_booking_id uuid DEFAULT NULL::uuid)', 'p_booking_id uuid DEFAULT NULL::uuid, p_staff_ids jsonb DEFAULT NULL::jsonb)');
 if position('p_staff_ids jsonb' in definition)=0 then raise exception 'Slots signature changed'; end if;
 definition:=replace(definition,'plan_portable_booking(salon,p_service_ids,p_staff_id,slot,p_booking_id)','plan_portable_booking_services(salon,p_service_ids,p_staff_id,slot,p_booking_id,p_staff_ids)');
 definition:=replace(definition,'''startAt'',slot,''endAt''','''lines'',plan->''lines'',''startAt'',slot,''endAt''');
 execute definition;
end; $patch$;
revoke all on function public.get_pos_portable_booking_slots_v3(uuid,text,uuid[],uuid,date,uuid,jsonb) from public;
grant execute on function public.get_pos_portable_booking_slots_v3(uuid,text,uuid[],uuid,date,uuid,jsonb) to anon,authenticated;

-- Retain the existing visibility/date scope, enriching only rows already authorized.
do $patch$ declare definition text; begin
 definition:=pg_get_functiondef('public.get_pos_portable_book_data(uuid,text,date)'::regprocedure);
 definition:=replace(definition,'public.get_pos_portable_book_data(', 'public.get_pos_portable_book_data_before_service_staff(');
 execute definition;
end; $patch$;
revoke all on function public.get_pos_portable_book_data_before_service_staff(uuid,text,date) from public,anon,authenticated;
create or replace function public.get_pos_portable_book_data(p_key_id uuid,p_session_signature text,p_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; salon uuid;
begin
 result:=get_pos_portable_book_data_before_service_staff(p_key_id,p_session_signature,p_date);
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.view') then raise exception 'Not authorized'; end if;
 result:=jsonb_set(result,'{appointments}',coalesce((select jsonb_agg(value||portable_booking_json(salon,(value->>'id')::uuid) order by ordinal)
   from jsonb_array_elements(result->'appointments') with ordinality as x(value,ordinal)),'[]'));
 return result||jsonb_build_object('staffServiceAssignments',coalesce((select jsonb_agg(jsonb_build_object('staffId',staff_id,'serviceId',service_id,'from',effective_start_date,'through',effective_end_date)) from staff_service_assignments where salon_id=salon and is_active),'[]'));
end; $$;
notify pgrst,'reload schema';
