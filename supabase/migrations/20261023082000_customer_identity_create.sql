begin;
create function public.create_salon_customer_identity(p_salon uuid,p_input jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare selected uuid; candidate uuid; result uuid; amount integer;
begin
 if not user_has_salon_permission(p_salon,array['customers.manage']) then raise exception 'Customer management access required' using errcode='42501'; end if;
 if nullif(btrim(p_input->>'name'),'') is null then raise exception 'Customer name is required'; end if;
 if nullif(btrim(p_input->>'phone'),'') is not null and normalize_customer_claim_phone(p_input->>'phone') is null then
  raise exception 'Enter a full phone number or leave phone blank'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 selected:=nullif(p_input->>'existing_customer_id','')::uuid;
 if selected is not null then
  if not exists(select 1 from customers where id=selected and location_id=p_salon and status='active') then raise exception 'Customer selection changed'; end if;
 else
  select count(*),(array_agg(customer_id))[1] into amount,candidate
  from customer_identity_candidates(p_salon,p_input->>'name',p_input->>'phone',p_input->>'email') where automatic;
  if amount=1 and coalesce(p_input->>'create_separate','')<>'1' then selected:=candidate;
  elsif coalesce(p_input->>'create_separate','')<>'1' and exists(
   select 1 from customer_identity_candidates(p_salon,p_input->>'name',p_input->>'phone',p_input->>'email')) then
   raise exception 'Review matching customers or choose Create a separate customer';
  end if;
 end if;
 if selected is not null then
  update customers set
   notes=concat_ws(E'\n\n',notes,nullif(p_input->>'notes','')),
   staff_notes=concat_ws(E'\n\n',staff_notes,nullif(p_input->>'staff_notes','')),
   internal_notes=concat_ws(E'\n\n',internal_notes,nullif(p_input->>'internal_notes','')),
   updated_by_user_id=current_public_user_id() where id=selected;
  return selected;
 end if;
 insert into customers(location_id,name,phone,email,notes,staff_notes,internal_notes,source,status,created_by_user_id,updated_by_user_id)
 values(p_salon,btrim(p_input->>'name'),coalesce(normalize_customer_claim_phone(p_input->>'phone'),nullif(btrim(p_input->>'phone'),'')),
 nullif(lower(btrim(p_input->>'email')),''),nullif(p_input->>'notes',''),nullif(p_input->>'staff_notes',''),nullif(p_input->>'internal_notes',''),
 'manual','active',current_public_user_id(),current_public_user_id()) returning id into result;
 return result;
end $$;
revoke all on function public.create_salon_customer_identity(uuid,jsonb) from public,anon;
grant execute on function public.create_salon_customer_identity(uuid,jsonb) to authenticated;

-- Explicit owner operation: automatically consolidate only unambiguous matching-name/phone groups.
-- No writes occur during GET/list rendering, and one batch remains atomic.
create function public.consolidate_customer_identities(p_salon uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare c record; sources uuid[]; merged integer:=0;
begin
 if not user_has_salon_permission(p_salon,array['customers.manage']) then raise exception 'Customer management access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('customer-identity:'||p_salon::text,0));
 for c in select t.* from customers t where t.location_id=p_salon and t.status='active'
 and normalize_customer_claim_phone(t.phone) is not null and not customer_is_walking(t)
 and exists(select 1 from customers s where s.location_id=p_salon and s.id<>t.id and s.status='active'
  and normalize_customer_claim_phone(s.phone)=normalize_customer_claim_phone(t.phone))
 order by t.created_at,t.id loop
  if not exists(select 1 from customers where id=c.id) then continue; end if;
  select array_agg(m.id) into sources from (select s.id from customers s
   where s.location_id=p_salon and s.id<>c.id and s.status='active'
   and normalize_customer_claim_phone(s.phone)=normalize_customer_claim_phone(c.phone)
   and length(customer_name_key(s.name))>=3 and length(customer_name_key(c.name))>=3
   and 1-customer_edit_distance(customer_name_key(s.name),customer_name_key(c.name))::numeric/
    greatest(length(customer_name_key(s.name)),length(customer_name_key(c.name)),1)>=0.75
   -- Existing unverified rows are safe to group without transferring personal ownership.
   and s.customer_user_id is not distinct from c.customer_user_id
   order by s.created_at,s.id limit greatest(0,100-merged)) m;
  if cardinality(sources)>0 and (select count(*) from customer_visits where salon_id=p_salon
    and customer_id=any(sources||c.id) and status in ('waiting','in_service','checkout'))<=1 then
   perform merge_customer_records(p_salon,c.id,sources,'automatic');
   merged:=merged+cardinality(sources);
  end if;
  if merged>=100 then exit; end if;
 end loop;
 return merged;
end $$;
revoke all on function public.consolidate_customer_identities(uuid) from public,anon;
grant execute on function public.consolidate_customer_identities(uuid) to authenticated;
commit;
