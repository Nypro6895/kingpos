begin;

-- Narrow lookup for appointment creation: only name/phone, at most eight matches.
-- Reuses the existing customer search expression indexes.
create or replace function public.staff_booking_customer_suggestions(p_salon uuid, p_query text)
returns jsonb language plpgsql stable security definer set search_path=public,extensions as $$
declare q text := normalize_search_text(left(btrim(p_query),150));
  digits text := regexp_replace(coalesce(p_query,''),'\D','','g');
  matches jsonb;
begin
  if current_public_user_id() is null or current_user_staff_id_for_salon(p_salon) is null then
    raise exception 'Active staff access required' using errcode='42501';
  end if;
  if not (salon_staff_booking_creation(p_salon)->>'enabled')::boolean then
    raise exception 'The salon owner has turned off staff appointment creation' using errcode='42501';
  end if;
  if q is null or length(q)<2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone)), '[]'::jsonb) into matches
  from (
    select c.id,c.name,c.phone from customers c
    where c.location_id=p_salon and c.status='active'
      and ((length(digits)>=3 and c.phone is not null and regexp_replace(coalesce(c.phone,''),'\D','','g') like '%'||digits||'%')
        or (digits='' and normalize_search_text(c.name) like '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%'))
    order by case when normalize_search_text(c.name)=q then 0 else 1 end,c.name,c.id
    limit 8
  ) found;
  return matches;
end;$$;
revoke all on function public.staff_booking_customer_suggestions(uuid,text) from public,anon;
grant execute on function public.staff_booking_customer_suggestions(uuid,text) to authenticated;

-- Bind the selected suggestion to its existing salon customer record.
-- Reject foreign/stale IDs rather than creating a duplicate or changing contact data.
do $$
declare definition text; original text := $old$select c.id into customer from customers c where c.location_id=p_salon and c.status='active' and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g') and lower(btrim(c.name))=lower(customer_name) order by c.created_at limit 1;$old$;
begin
  select pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure) into definition;
  if position('Selected customer is no longer available' in definition)=0 then
    if position(original in definition)=0 then raise exception 'Staff appointment customer resolver has changed'; end if;
    execute replace(definition,original,$new$
      if nullif(p_input->>'customerId','') is not null then
        select c.id into customer from customers c where c.id=(p_input->>'customerId')::uuid
          and c.location_id=p_salon and c.status='active'
          and lower(btrim(c.name))=lower(customer_name)
          and (c.phone is null or regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g'));
        if customer is null then raise exception 'Selected customer is no longer available. Search again'; end if;
      else
        select c.id into customer from customers c where c.location_id=p_salon and c.status='active' and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g') and lower(btrim(c.name))=lower(customer_name) order by c.created_at limit 1;
      end if;
    $new$);
  end if;
end;$$;
commit;
