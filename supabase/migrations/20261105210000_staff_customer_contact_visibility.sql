begin;

-- Only contact projections change. No customer, booking, service or pay data is rewritten.
alter table public.salon_settings add column if not exists staff_customer_contacts_visible boolean not null default true;

create or replace function public.staff_customer_contacts_enabled(p_salon uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select staff_customer_contacts_visible from salon_settings where salon_id=p_salon),true)
$$;
revoke all on function public.staff_customer_contacts_enabled(uuid) from public,anon,authenticated;

create or replace function public.guard_staff_customer_contacts()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (case when tg_op='INSERT' then not new.staff_customer_contacts_visible
     else new.staff_customer_contacts_visible is distinct from old.staff_customer_contacts_visible end)
    and not coalesce(lifecycle_user_is_salon_owner(new.salon_id,current_public_user_id(),true),false) then
   raise exception 'Only the salon owner can change this setting' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.guard_staff_customer_contacts() from public,anon,authenticated;
create trigger guard_staff_customer_contacts before insert or update on public.salon_settings
 for each row execute function public.guard_staff_customer_contacts();

create or replace function public.salon_staff_customer_contacts(p_salon uuid,p_visible boolean default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); owner_access boolean;
begin
 if actor is null then raise exception 'Sign in required' using errcode='42501'; end if;
 owner_access:=coalesce(lifecycle_user_is_salon_owner(p_salon,actor,true),false);
 if not owner_access and current_user_staff_id_for_salon(p_salon) is null
    and not coalesce(user_can_manage_salon(p_salon),false) then
   raise exception 'Salon access denied' using errcode='42501';
 end if;
 if p_visible is not null then
   if not owner_access then raise exception 'Only the salon owner can change this setting' using errcode='42501'; end if;
   perform pg_advisory_xact_lock(hashtextextended('staff-contact-setting:'||p_salon::text,0));
   insert into salon_settings(salon_id,business_name,staff_customer_contacts_visible)
   select id,name,p_visible from locations where id=p_salon
   on conflict(salon_id) do update set staff_customer_contacts_visible=excluded.staff_customer_contacts_visible;
 end if;
 return jsonb_build_object('visible',staff_customer_contacts_enabled(p_salon));
end $$;
revoke all on function public.salon_staff_customer_contacts(uuid,boolean) from public,anon;
grant execute on function public.salon_staff_customer_contacts(uuid,boolean) to authenticated;

-- Compare complete numbers only; accept formatting and the US country code, never substrings.
create or replace function public.staff_customer_phone_key(p_phone text)
returns text language sql immutable set search_path=public as $$
 select case when p_phone ~ '^[+0-9() .-]+$' and length(d) between 10 and 15
   then case when length(d)=11 and left(d,1)='1' then substring(d from 2) else d end end
 from (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d) n
$$;
revoke all on function public.staff_customer_phone_key(text) from public,anon,authenticated;

-- Patches are anchored to existing projections so unrelated scheduling/earnings logic stays intact.
-- Fail the transaction if integration has changed those definitions.
do $$
declare definition text; anchor text;
begin
 select pg_get_functiondef('public.get_assigned_booking_contacts(uuid[])'::regprocedure) into definition;
 anchor:='''customerName'', c.name, ''customerPhone'', c.phone,';
 if position(anchor in definition)=0 then raise exception 'Assigned booking contacts changed; review integration'; end if;
 execute replace(definition,anchor,'''customerName'', c.name, ''customerPhone'', case when staff_customer_contacts_enabled(b.salon_id) then c.phone end, ''customerContactVisible'', staff_customer_contacts_enabled(b.salon_id),');

 select pg_get_functiondef('public.get_my_staff_daily_snapshot(uuid)'::regprocedure) into definition;
 anchor:='''phone'', c.phone, ''email'', c.email';
 if position(anchor in definition)=0 then raise exception 'Staff daily contact projection changed; review integration'; end if;
 execute replace(definition,anchor,'''phone'', case when staff_customer_contacts_enabled(p_salon_id) then c.phone end, ''email'', case when staff_customer_contacts_enabled(p_salon_id) then c.email end');

 select pg_get_functiondef('public.staff_booking_creation_catalog(uuid)'::regprocedure) into definition;
 anchor:='context:=salon_staff_booking_creation(p_salon);';
 if position(anchor in definition)=0 then raise exception 'Staff booking catalog changed; review integration'; end if;
 execute replace(definition,anchor,anchor||E'\n  context:=context||jsonb_build_object(''customerContactVisible'',staff_customer_contacts_enabled(p_salon));');

 select pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure) into definition;
 anchor:='regexp_replace(c.phone,''[^0-9]'','''',''g'')=regexp_replace(customer_phone,''[^0-9]'','''',''g'')';
 if position(anchor in definition)=0 then raise exception 'Staff customer resolver changed; review integration'; end if;
 execute replace(definition,anchor,'(case when staff_customer_contacts_enabled(p_salon) then '||anchor||' else staff_customer_phone_key(c.phone)=staff_customer_phone_key(customer_phone) end)');
end $$;

create or replace function public.staff_booking_customer_suggestions(p_salon uuid, p_query text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare q text := normalize_search_text(left(btrim(p_query),150));
 digits text := regexp_replace(coalesce(p_query,''),'\D','','g'); matches jsonb;
begin
 if current_public_user_id() is null or current_user_staff_id_for_salon(p_salon) is null then
   raise exception 'Active staff access required' using errcode='42501';
 end if;
 if not (salon_staff_booking_creation(p_salon)->>'enabled')::boolean then
   raise exception 'The salon owner has turned off staff appointment creation' using errcode='42501';
 end if;
 if not staff_customer_contacts_enabled(p_salon) then
   if staff_customer_phone_key(p_query) is null then return '[]'::jsonb; end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',null)),'[]'::jsonb) into matches
   from (select c.id,c.name from customers c where c.location_id=p_salon and c.status='active'
     and staff_customer_phone_key(c.phone)=staff_customer_phone_key(p_query)
     order by c.name,c.id limit 8) found;
   return matches;
 end if;
 if q is null or length(q)<2 then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone)), '[]'::jsonb) into matches
 from (
   select c.id,c.name,c.phone from customers c
   where c.location_id=p_salon and c.status='active'
     and ((length(digits)>=3 and c.phone is not null and regexp_replace(coalesce(c.phone,''),'\D','','g') like '%'||digits||'%')
       or (digits='' and normalize_search_text(c.name) like '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%'))
   order by case when normalize_search_text(c.name)=q then 0 else 1 end,c.name,c.id limit 8
 ) found;
 return matches;
end $$;
revoke all on function public.staff_booking_customer_suggestions(uuid,text) from public,anon;
grant execute on function public.staff_booking_customer_suggestions(uuid,text) to authenticated;
commit;
