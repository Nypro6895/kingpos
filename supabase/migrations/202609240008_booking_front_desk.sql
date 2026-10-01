create or replace function public.get_pos_portable_booking_hours(p_key_id uuid,p_session_signature text,p_date date)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; tz text; ranges nummultirange; blocked nummultirange; shared boolean; configured boolean;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.view') then raise exception 'Not authorized'; end if;
 tz:=coalesce((select timezone_iana from booking_settings where salon_id=salon),get_salon_business_timezone(salon));
 select exists(select 1 from staff_availability_rules where salon_id=salon and is_active and rule_type='working') into configured;
 select exists(select 1 from staff_availability_rules where salon_id=salon and is_active and rule_type='working' and staff_id is null
   and day_of_week=extract(dow from p_date) and (effective_start_date is null or effective_start_date<=p_date) and (effective_end_date is null or effective_end_date>=p_date)) into shared;
 select range_agg(numrange(extract(epoch from starts_at_local)/60,extract(epoch from ends_at_local)/60,'[)')) into ranges
 from staff_availability_rules where salon_id=salon and is_active and rule_type='working' and (not shared or staff_id is null)
   and day_of_week=extract(dow from p_date) and ends_at_local>starts_at_local
   and (effective_start_date is null or effective_start_date<=p_date) and (effective_end_date is null or effective_end_date>=p_date);
 -- Global closures/breaks remove only their actual interval. Existing bookings remain visible in the UI.
 select range_agg(numrange(greatest(0,extract(epoch from ((starts_at at time zone tz)-p_date::timestamp))/60),
   least(1440,extract(epoch from ((ends_at at time zone tz)-p_date::timestamp))/60),'[)')) into blocked
 from staff_time_blocks where salon_id=salon and is_active and staff_id is null
   and starts_at<((p_date+1)::timestamp at time zone tz) and ends_at>(p_date::timestamp at time zone tz);
  ranges:=coalesce(ranges,'{}'::nummultirange)-coalesce(blocked,'{}'::nummultirange);
 select range_agg(numrange(extract(epoch from starts_at_local)/60,extract(epoch from ends_at_local)/60,'[)')) into blocked
 from staff_availability_rules where salon_id=salon and staff_id is null and is_active and rule_type='break'
   and day_of_week=extract(dow from p_date) and ends_at_local>starts_at_local
   and (effective_start_date is null or effective_start_date<=p_date) and (effective_end_date is null or effective_end_date>=p_date);
 ranges:=ranges-coalesce(blocked,'{}'::nummultirange);
 return jsonb_build_object('date',p_date,'source',case when not configured then 'unavailable' when shared then 'salon' else 'staff' end,
   'intervals',coalesce((select jsonb_agg(jsonb_build_object('start',lower(r),'end',upper(r)) order by lower(r)) from unnest(ranges) r),'[]'));
end; $$;
revoke all on function public.get_pos_portable_booking_hours(uuid,text,date) from public;
grant execute on function public.get_pos_portable_booking_hours(uuid,text,date) to anon,authenticated;

create or replace function public.get_pos_portable_booking_staff_options(p_key_id uuid,p_session_signature text,p_service_ids uuid[],p_staff_ids jsonb,p_start timestamptz,p_index integer,p_booking_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare salon uuid; member record; ids jsonb; plan jsonb; result jsonb:='[]'; available boolean; tz text;
begin
 salon:=pos_portable_access_salon_id(p_key_id,p_session_signature);
 if salon is null or not pos_portable_access_has_capability(p_key_id,p_session_signature,'portable.book.create') then raise exception 'Not authorized'; end if;
 if p_booking_id is not null and not exists(select 1 from bookings where salon_id=salon and id=p_booking_id) then raise exception 'Appointment not found'; end if;
 if coalesce(cardinality(p_service_ids),0) not between 1 and 20 or p_index not between -1 and cardinality(p_service_ids)-1
   or jsonb_typeof(p_staff_ids) is distinct from 'array' or jsonb_array_length(p_staff_ids)<>cardinality(p_service_ids) then raise exception 'Invalid service selection'; end if;
 tz:=coalesce((select timezone_iana from booking_settings where salon_id=salon),get_salon_business_timezone(salon));
 for member in select s.id from staff s where s.salon_id=salon and s.is_active and not exists(
   select 1 from unnest(case when p_index=-1 then p_service_ids else array[p_service_ids[p_index+1]] end) as chosen(selected_service)
   where not exists(select 1 from staff_service_assignments a where a.salon_id=salon and a.staff_id=s.id and a.service_id=chosen.selected_service and a.is_active
     and (a.effective_start_date is null or a.effective_start_date<=(p_start at time zone tz)::date)
     and (a.effective_end_date is null or a.effective_end_date>=(p_start at time zone tz)::date)))
 loop
   ids:=case when p_index=-1 then to_jsonb(array_fill(member.id,array[cardinality(p_service_ids)])) else jsonb_set(p_staff_ids,array[p_index::text],to_jsonb(member.id)) end;
   begin plan:=plan_portable_booking_services(salon,p_service_ids,null,p_start,p_booking_id,ids); available:=plan is not null and p_start>statement_timestamp();
   exception when raise_exception then plan:=null; available:=null; end;
   result:=result||jsonb_build_array(jsonb_build_object('staffId',member.id,'available',available,'endAt',plan->>'endAt'));
 end loop;
 return result;
end; $$;
revoke all on function public.get_pos_portable_booking_staff_options(uuid,text,uuid[],jsonb,timestamptz,integer,uuid) from public;
grant execute on function public.get_pos_portable_booking_staff_options(uuid,text,uuid[],jsonb,timestamptz,integer,uuid) to anon,authenticated;

do $patch$ declare definition text; begin
 definition:=pg_get_functiondef('public.portable_booking_json(uuid,uuid)'::regprocedure);
 definition:=replace(definition,'''id'',b.id,','''id'',b.id,''notes'',b.internal_notes,');
 execute definition;
 definition:=pg_get_functiondef('public.create_pos_portable_appointment_v3(uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,'return portable_booking_json(salon,(result->>''id'')::uuid);',
   'update bookings set internal_notes=nullif(left(p_payload->>''notes'',4000),'''') where salon_id=salon and id=(result->>''id'')::uuid; return portable_booking_json(salon,(result->>''id'')::uuid);');
 execute definition;
 definition:=pg_get_functiondef('public.manage_pos_portable_booking(uuid,text,uuid,text,jsonb)'::regprocedure);
 if position('perform apply_portable_booking_plan(salon,p_booking_id,plan);' in definition)=0 then raise exception 'Edit implementation changed'; end if;
 definition:=replace(definition,'perform apply_portable_booking_plan(salon,p_booking_id,plan);', $code$
   if nullif(p_payload->>'customerId','') is not null and not exists(select 1 from customers where id=(p_payload->>'customerId')::uuid and location_id=salon and status='active') then raise exception 'Customer not found in this salon'; end if;
   perform apply_portable_booking_plan(salon,p_booking_id,plan);
   update bookings set internal_notes=case when p_payload ? 'notes' then nullif(left(p_payload->>'notes',4000),'') else internal_notes end,
     customer_id=coalesce(nullif(p_payload->>'customerId','')::uuid,customer_id) where id=p_booking_id and salon_id=salon;
 $code$);
 execute definition;
end; $patch$;

-- Customer reassignment must never send a queued update to the previous customer.
-- Include customer identity in new keys while retaining compatible legacy queues.
do $patch$
declare definition text; alias text; expression text; target text;
begin
 definition:=pg_get_functiondef('public.enqueue_booking_message()'::regprocedure);
 definition:=replace(definition,'(new.status,new.start_at,new.confirmation_status)','(new.status,new.start_at,new.confirmation_status,new.customer_id)');
 definition:=replace(definition,'(old.status,old.start_at,old.confirmation_status)','(old.status,old.start_at,old.confirmation_status,old.customer_id)');
 definition:=replace(definition,'extract(epoch from new.start_at)::text;', 'extract(epoch from new.start_at)::text||'':customer:''||new.customer_id::text;');
 execute definition;
 definition:=pg_get_functiondef('public.claim_booking_messages(integer,boolean,boolean)'::regprocedure);
 foreach alias in array array['m','q'] loop
   foreach expression in array array['b.status||'':''||b.confirmation_status||'':''||extract(epoch from b.start_at)::text','''reminder:''||extract(epoch from b.start_at)::text'] loop
     target:=alias||'.event_key='||expression;
     definition:=replace(definition,target,'('||target||' or '||alias||'.event_key='||expression||'||'':customer:''||b.customer_id::text)');
   end loop;
 end loop;
 definition:=replace(definition,'''reminder:''||extract(epoch from b.start_at)::text,' ,'''reminder:''||extract(epoch from b.start_at)::text||'':customer:''||b.customer_id::text,');
 definition:=replace(definition,'and (m.created_at<=', $code$and (m.recipient is distinct from (select case when m.channel='email' then c.email else c.phone end from customers c where c.id=b.customer_id and c.location_id=b.salon_id) or m.created_at<=$code$);
 definition:=replace(definition,'where q.state in (''pending'',''unconfigured'')', $code$where q.state in ('pending','unconfigured') and q.recipient=(select case when q.channel='email' then c.email else c.phone end from customers c where c.id=b.customer_id and c.location_id=b.salon_id)$code$);
 execute definition;
end; $patch$;
drop trigger enqueue_booking_message on public.bookings;
create trigger enqueue_booking_message after insert or update of status,start_at,confirmation_status,customer_id on public.bookings
for each row execute function public.enqueue_booking_message();
notify pgrst,'reload schema';
