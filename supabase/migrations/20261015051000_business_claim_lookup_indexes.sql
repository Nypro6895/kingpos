begin;

-- Match the claim normalizers, which deliberately differ from Explore search.
-- Index only active locations; visibility is still checked on every candidate.
create index if not exists locations_claim_phone_idx
  on public.locations (public.business_claim_phone(phone)) where status='active';
create index if not exists locations_claim_address_idx
  on public.locations (public.business_claim_text(address_line1)) where status='active';
create index if not exists locations_claim_city_idx
  on public.locations (public.business_claim_text(city)) where status='active';

create or replace function public.find_business_claim_matches(
  p_name text default '', p_phone text default '', p_address text default '',
  p_unit text default '', p_city text default '', p_state text default ''
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_phone text := public.business_claim_phone(left(p_phone,40));
  v_name text := public.business_claim_text(left(p_name,160));
  v_address text := public.business_claim_text(left(p_address,250));
  v_unit text := public.business_claim_text(left(p_unit,100));
  v_city text := public.business_claim_text(left(p_city,100));
  v_state text := public.business_claim_text(left(p_state,100));
  v_address_search boolean;
  v_name_search boolean;
  result jsonb;
begin
  v_address_search := length(v_address)>=5 and (v_city<>'' or v_state<>'');
  v_name_search := length(v_name)>=3 and v_city<>'';
  -- A name alone never qualified in the original matcher. Avoid scanning the
  -- directory while the user is still filling the optional location fields.
  if v_phone is null and not v_address_search and not v_name_search then
    return '[]'::jsonb;
  end if;

  with candidate_ids as materialized (
    select l.id from public.locations l
    where l.status='active' and v_phone is not null
      and public.business_claim_phone(l.phone)=v_phone
    union
    select l.id from public.locations l
    where l.status='active' and v_address_search
      and public.business_claim_text(l.address_line1)=v_address
      and (v_city='' or public.business_claim_text(l.city)=v_city)
      and (v_state='' or public.business_claim_text(l.state)=v_state)
      and public.business_claim_text(l.address_line2)=v_unit
    union
    select l.id from public.locations l
    where l.status='active' and v_name_search
      and public.business_claim_text(l.city)=v_city
      and length(public.business_claim_text(l.name))>=3
      and (public.business_claim_text(l.name) like '%'||v_name||'%'
        or v_name like '%'||public.business_claim_text(l.name)||'%')
  ), candidates as materialized (
    select l.id salon_id,l.name,l.phone,
      concat_ws(', ',l.address_line1,l.address_line2,l.city,l.state,l.postal_code) address,
      coalesce(d.claim_state='unclaimed',false) unclaimed,
      (v_phone is not null and v_phone=public.business_claim_phone(l.phone)) phone_match,
      (v_address_search and v_address=public.business_claim_text(l.address_line1)
        and (v_city='' or v_city=public.business_claim_text(l.city))
        and (v_state='' or v_state=public.business_claim_text(l.state))
        and v_unit=public.business_claim_text(l.address_line2)) address_match,
      (length(v_name)>=3 and length(public.business_claim_text(l.name))>=3
        and (public.business_claim_text(l.name) like '%'||v_name||'%'
          or v_name like '%'||public.business_claim_text(l.name)||'%')) name_match,
      (v_city<>'' and v_city=public.business_claim_text(l.city)) city_match
    from candidate_ids c join public.locations l on l.id=c.id
    left join public.salon_directory_listings d on d.salon_id=l.id
    where public.salon_profile_public_salon_exists(l.id)
  ), ranked as (
    select *,case when phone_match and address_match then 100
      when phone_match then 85 when address_match and name_match then 75
      when address_match then 50 else 25 end score
    from candidates
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by score desc,name),'[]'::jsonb)
    into result from (select * from ranked order by score desc,name limit 5) r;
  return result;
end $$;

revoke all on function public.find_business_claim_matches(text,text,text,text,text,text) from public,anon;
grant execute on function public.find_business_claim_matches(text,text,text,text,text,text) to authenticated;
commit;
