-- Keep ownership intact; serialize self-enrollment per salon to prevent duplicates.
create or replace function public.become_salon_owner_staff(p_salon_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid := public.current_public_user_id(); profile public.users%rowtype; staff_id uuid;
begin
  if actor is null or not public.lifecycle_user_is_salon_owner(p_salon_id,actor,true) then
    raise exception 'Only a current Owner can become staff.';
  end if;
  perform 1 from public.locations where id=p_salon_id and status='active' for update;
  if not found then raise exception 'Salon is not active.'; end if;
  select * into profile from public.users where id=actor and status='active';
  if not found then raise exception 'Personal account is not active.'; end if;
  select id into staff_id from public.staff
    where salon_id=p_salon_id and (account_user_id=actor or user_id=profile.auth_user_id)
    order by created_at,id limit 1;
  if staff_id is not null then
    return staff_id;
  end if;
  insert into public.staff(salon_id,account_user_id,display_name,first_name,last_name,email,phone,is_active)
  values(p_salon_id,actor,coalesce(nullif(btrim(profile.display_name),''),
    nullif(btrim(concat_ws(' ',profile.first_name,profile.last_name)),''),profile.email,'Owner'),
    profile.first_name,profile.last_name,profile.email,profile.phone,true)
  returning id into staff_id;
  return staff_id;
end;$$;
revoke all on function public.become_salon_owner_staff(uuid) from public,anon;
grant execute on function public.become_salon_owner_staff(uuid) to authenticated;

-- Wrap the existing idempotent creator so salon + optional staff commit atomically.
create or replace function public.create_account_salon_with_owner_staff(
  p_account_id uuid,p_create_request_key text,p_name text,p_owner_is_staff boolean,
  p_phone text default null,p_address_line1 text default null,p_address_line2 text default null,
  p_city text default null,p_state text default null,p_postal_code text default null,p_country text default 'US'
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  result := public.create_account_salon(p_account_id,p_create_request_key,p_name,p_phone,
    p_address_line1,p_address_line2,p_city,p_state,p_postal_code,p_country);
  if p_owner_is_staff then
    result := result || jsonb_build_object('staff_id',public.become_salon_owner_staff((result->>'salon_id')::uuid));
  end if;
  return result;
end;$$;
revoke all on function public.create_account_salon_with_owner_staff(uuid,text,text,boolean,text,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_account_salon_with_owner_staff(uuid,text,text,boolean,text,text,text,text,text,text,text) to authenticated;
