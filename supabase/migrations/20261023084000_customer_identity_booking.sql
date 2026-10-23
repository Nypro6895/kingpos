begin;
-- SECURITY INVOKER preserves the caller's existing customer-table RLS, including
-- guest/public booking boundaries. This is not a new public directory endpoint.
create function public.booking_customer_identity_matches(p_salon uuid,p_name text,p_phone text,p_email text)
returns setof public.customers language sql stable security invoker set search_path=public as $$
 select c.* from customers c where c.location_id=p_salon and c.status='active'
 and ((normalize_customer_claim_phone(p_phone) is not null and normalize_customer_claim_phone(c.phone)=normalize_customer_claim_phone(p_phone))
  or (nullif(lower(btrim(p_email)),'') is not null and lower(btrim(c.email))=lower(btrim(p_email)))
  or (length(customer_name_key(p_name))>=2 and normalize_customer_claim_phone(p_phone) is not null
    and normalize_customer_claim_phone(c.phone) is not null
    and customer_edit_distance(normalize_customer_claim_phone(p_phone),normalize_customer_claim_phone(c.phone))<=1
    and 1-customer_edit_distance(customer_name_key(p_name),customer_name_key(c.name))::numeric/
      greatest(length(customer_name_key(p_name)),length(customer_name_key(c.name)),1)>=0.5))
 order by c.created_at,c.id limit 20
$$;
revoke all on function public.booking_customer_identity_matches(uuid,text,text,text) from public,anon;
grant execute on function public.booking_customer_identity_matches(uuid,text,text,text) to authenticated,service_role;

create function public.create_booking_customer_identity(p_salon uuid,p_name text,p_phone text,p_email text,p_user uuid,p_actor uuid,p_source text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare selected customers%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 if (select count(distinct customer_user_id) from booking_customer_identity_matches(p_salon,p_name,p_phone,p_email))>1 then
  raise exception 'Multiple personal accounts match. Select the correct profile.'; end if;
 -- Repeat resolution while holding the same salon lock as check-in and manual creation.
 -- A concurrent insert must not turn two submissions into two customer records.
 select * into selected from booking_customer_identity_matches(p_salon,p_name,p_phone,p_email) c
 where (normalize_customer_claim_phone(p_phone) is not null and normalize_customer_claim_phone(c.phone)=normalize_customer_claim_phone(p_phone)
  and length(customer_name_key(p_name))>=3 and 1-customer_edit_distance(customer_name_key(p_name),customer_name_key(c.name))::numeric/
   greatest(length(customer_name_key(p_name)),length(customer_name_key(c.name)),1)>=0.75)
 order by c.created_at,c.id limit 1;
 if selected.id is not null then
  if p_user is not null and selected.customer_user_id is not null and p_user<>selected.customer_user_id then raise exception 'Customer belongs to another account'; end if;
  if p_user is not null and selected.customer_user_id is null then
   update customers set customer_user_id=p_user,updated_by_user_id=p_actor where id=selected.id returning * into selected;
  end if;
  return jsonb_build_object('customer',to_jsonb(selected),'created',false);
 end if;
 if exists(select 1 from booking_customer_identity_matches(p_salon,p_name,p_phone,p_email)) then
  raise exception 'Customer identity changed. Check the profile and retry.';
 end if;
 insert into customers(location_id,name,phone,email,customer_user_id,source,status,created_by_user_id,updated_by_user_id)
 values(p_salon,p_name,normalize_customer_claim_phone(p_phone),nullif(lower(btrim(p_email)),''),p_user,p_source,'active',p_actor,p_actor) returning * into selected;
 return jsonb_build_object('customer',to_jsonb(selected),'created',true);
end $$;
revoke all on function public.create_booking_customer_identity(uuid,text,text,text,uuid,uuid,text) from public,anon;
grant execute on function public.create_booking_customer_identity(uuid,text,text,text,uuid,uuid,text) to authenticated,service_role;

-- Preserve staff policy checks and the explicit selected-customer binding.
do $$declare definition text; original text := $old$select c.id into customer from customers c where c.location_id=p_salon and c.status='active' and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(customer_phone,'[^0-9]','','g') and lower(btrim(c.name))=lower(customer_name) order by c.created_at limit 1;$old$;
begin
 definition:=pg_get_functiondef('public.create_staff_appointment(uuid,jsonb)'::regprocedure);
definition:=replace(definition,chr(13),'');
 if position(original in definition)=0 then raise exception 'Review staff customer resolver before migration'; end if;
 execute replace(definition,original,$new$
   perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
   if (select count(distinct s.customer_user_id) from public.customer_identity_candidates(p_salon,customer_name,customer_phone) m
    join public.customers s on s.id=m.customer_id where m.automatic)>1
    or (select count(*) from public.customer_identity_candidates(p_salon,customer_name,customer_phone))>=8 then
    raise exception 'Multiple customer profiles match. Search and select the correct profile.';
   end if;
   select customer_id into customer from public.customer_identity_candidates(p_salon,customer_name,customer_phone)
   where automatic limit 1;
   if customer is null and exists(select 1 from public.customer_identity_candidates(p_salon,customer_name,customer_phone)) then
    raise exception 'Possible existing customer. Search and select the correct profile before saving.';
   end if;
 $new$);
end $$;

-- Extend the existing narrow staff search without broadening access or returned fields.
do $$declare definition text; original text := $old$or (digits='' and normalize_search_text(c.name) like '%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%')$old$;
begin
 definition:=pg_get_functiondef('public.staff_booking_customer_suggestions(uuid,text)'::regprocedure);
definition:=replace(definition,chr(13),'');
 if position(original in definition)=0 then raise exception 'Review staff customer search before migration'; end if;
 execute replace(definition,original,original||$new$
   or (length(digits)>=10 and normalize_customer_claim_phone(c.phone) is not null
     and customer_edit_distance(normalize_customer_claim_phone(p_query),normalize_customer_claim_phone(c.phone))<=1)
   or (digits='' and length(customer_name_key(p_query))>=3
     and customer_edit_distance(customer_name_key(p_query),customer_name_key(c.name))<=1)
 $new$);
end $$;
commit;
