-- Explicit targets keep My Place mutations independent of the selected workspace.
create or replace function public.my_place_staff_requests()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,
    'kind',case when r.direction = 'staff_application' then 'review' else 'sent_invitation' end,
    'label',l.name,'detail',concat_ws(' · ',coalesce(u.display_name,r.target_email_normalized,r.target_phone_e164,'Staff member'),r.requested_job_title),
    'message',r.message,'status',r.status,'createdAt',r.created_at,'expiresAt',r.expires_at) order by r.created_at desc),'[]'::jsonb)
  from public.staff_salon_connection_requests r join public.locations l on l.id = r.salon_id
  left join public.users u on u.id = r.account_user_id
  where r.status = 'pending' and public.user_has_salon_permission(r.salon_id,array['staff.manage'])
    and exists(select 1 from public.users where id = public.current_public_user_id() and status = 'active')
$$;

create or replace function public.my_place_account_details(p_account_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid := public.current_public_user_id(); result jsonb;
begin
  if actor is null or not exists(select 1 from public.users where id = actor and status = 'active')
    or not public.user_belongs_to_account(p_account_id) then
    raise exception 'You do not have access to this business account.';
  end if;
  select jsonb_build_object(
    'canManage', exists(select 1 from public.account_memberships m join public.roles r on r.id = m.role_id
      join public.accounts a on a.id = m.account_id where m.account_id = p_account_id and m.user_id = actor
      and m.status = 'active' and r.code = 'OWNER' and a.status = 'active'),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', coalesce(u.display_name,u.email,'Member'),
      'email', u.email, 'roleId', m.role_id, 'roleCode', r.code, 'status', m.status, 'isSelf', m.user_id = actor)
      order by r.code = 'OWNER' desc, u.display_name) from public.account_memberships m
      join public.users u on u.id = m.user_id left join public.roles r on r.id = m.role_id
      where m.account_id = p_account_id and m.status <> 'removed'), '[]'::jsonb),
    'roles', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'code', r.code,
      'permissions', coalesce((select jsonb_agg(p.code order by p.code) from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id where rp.role_id = r.id), '[]'::jsonb)) order by r.name)
      from public.roles r where r.account_id = p_account_id), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.my_place_save_member(
  p_account_id uuid, p_role_id uuid, p_email text default null, p_membership_id uuid default null,
  p_operation text default 'invite'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid := public.current_public_user_id(); target_user uuid; member public.account_memberships%rowtype;
begin
  -- Serialize invitation, role changes and responses per account.
  perform 1 from public.accounts where id = p_account_id and status = 'active' for update;
  if not found or actor is null or not exists(select 1 from public.users where id = actor and status = 'active')
    or not exists(select 1 from public.account_memberships m join public.roles r on r.id = m.role_id
      where m.account_id = p_account_id and m.user_id = actor and m.status = 'active' and r.code = 'OWNER') then
    raise exception 'Only an active business account owner can manage members.';
  end if;
  if p_operation not in ('invite','role','revoke') or p_operation is null then
    raise exception 'Invalid member action.';
  end if;
  if p_operation <> 'revoke' and not exists(select 1 from public.roles where id = p_role_id
    and account_id = p_account_id and code <> 'OWNER') then
    raise exception 'Choose a non-owner role belonging to this business account.';
  end if;
  if p_operation = 'invite' then
    if nullif(btrim(p_email), '') is null then raise exception 'Email is required.'; end if;
    if (select count(*) from public.users where lower(btrim(email)) = lower(btrim(p_email)) and status = 'active') <> 1 then
      raise exception 'Ask this person to create a Reylumi account with this email first.';
    end if;
    select id into target_user from public.users where lower(btrim(email)) = lower(btrim(p_email)) and status = 'active';
    if target_user = actor then raise exception 'You are already an owner of this account.'; end if;
    select * into member from public.account_memberships where account_id = p_account_id and user_id = target_user for update;
    if member.id is not null and member.status <> 'removed' then raise exception 'This person is already a member or has a pending invitation.'; end if;
    insert into public.account_memberships(account_id, user_id, role_id, status)
      values(p_account_id, target_user, p_role_id, 'invited')
      on conflict(account_id,user_id) do update set role_id = excluded.role_id, status = 'invited', joined_at = null;
  else
    select * into member from public.account_memberships where id = p_membership_id and account_id = p_account_id for update;
    if member.id is null or member.user_id = actor or exists(select 1 from public.roles where id = member.role_id and code = 'OWNER') then
      raise exception 'Owner memberships cannot be changed here.';
    end if;
    if p_operation = 'revoke' then
      if member.status <> 'invited' then raise exception 'This invitation is no longer pending.'; end if;
      update public.account_memberships set status = 'removed' where id = member.id;
    else
      if member.status not in ('active','invited') then raise exception 'This membership cannot be edited.'; end if;
      update public.account_memberships set role_id = p_role_id where id = member.id;
    end if;
  end if;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.my_place_account_invitations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind','account_invitation','label',a.name,
    'detail',r.name || ' · Business account invitation','message',null,'status','pending',
    'createdAt',m.created_at,'expiresAt',null) order by m.created_at desc),'[]'::jsonb)
  from public.account_memberships m join public.accounts a on a.id = m.account_id
  join public.roles r on r.id = m.role_id join public.users u on u.id = m.user_id
  where m.user_id = public.current_public_user_id() and u.status = 'active' and m.status = 'invited' and a.status = 'active'
$$;

create or replace function public.my_place_respond_account_invitation(p_membership_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare member public.account_memberships%rowtype; actor uuid := public.current_public_user_id(); target_account uuid;
begin
  if actor is null or not exists(select 1 from public.users where id = actor and status = 'active') then
    raise exception 'Sign in with an active account.';
  end if;
  select account_id into target_account from public.account_memberships where id = p_membership_id and user_id = actor;
  perform 1 from public.accounts where id = target_account and status = 'active' for update;
  if not found then raise exception 'This business account is not available.'; end if;
  select * into member from public.account_memberships where id = p_membership_id and user_id = actor for update;
  if member.id is null or member.status <> 'invited' then raise exception 'This invitation is no longer pending.'; end if;
  update public.account_memberships set status = case when p_accept then 'active' else 'removed' end,
    joined_at = case when p_accept then now() else null end where id = member.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.my_place_update_salon(p_salon_id uuid, p_values jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor uuid := public.current_public_user_id(); salon public.locations%rowtype; new_name text := nullif(btrim(p_values->>'name'),'');
begin
  if actor is null or not exists(select 1 from public.users where id = actor and status = 'active')
    or not public.user_has_salon_permission(p_salon_id,array['salon_settings.manage']) then
    raise exception 'You do not have permission to edit this salon.';
  end if;
  select * into salon from public.locations where id = p_salon_id for update;
  if salon.id is null or salon.status <> 'active' or not exists(select 1 from public.accounts where id = salon.account_id and status = 'active') then
    raise exception 'Only salons in an active business account can be edited.';
  end if;
  if new_name is null or length(new_name) > 160 then raise exception 'Enter a salon name of up to 160 characters.'; end if;
  if length(p_values::text) > 6000 then raise exception 'Salon details are too long.'; end if;
  if exists(select 1 from public.salon_settings where salon_id = p_salon_id and public_discovery_enabled)
    and (nullif(btrim(p_values->>'phone'),'') is null or nullif(btrim(p_values->>'address_line1'),'') is null
    or nullif(btrim(p_values->>'city'),'') is null or nullif(btrim(p_values->>'state'),'') is null
    or nullif(btrim(p_values->>'postal_code'),'') is null) then
    raise exception 'Published salons need a phone number and complete address.';
  end if;
  insert into public.salon_settings(salon_id,business_name,phone,address_line1,address_line2,city,state,postal_code,country)
    values(p_salon_id,new_name,nullif(btrim(p_values->>'phone'),''),nullif(btrim(p_values->>'address_line1'),''),
      nullif(btrim(p_values->>'address_line2'),''),nullif(btrim(p_values->>'city'),''),nullif(btrim(p_values->>'state'),''),
      nullif(btrim(p_values->>'postal_code'),''),coalesce(nullif(btrim(p_values->>'country'),''),'US'))
    on conflict(salon_id) do update set business_name = excluded.business_name, phone = excluded.phone,
      address_line1 = excluded.address_line1,address_line2 = excluded.address_line2,city = excluded.city,
      state = excluded.state,postal_code = excluded.postal_code,country = excluded.country;
  update public.locations l set name = s.business_name,phone = s.phone,address_line1 = s.address_line1,
    address_line2 = s.address_line2,city = s.city,state = s.state,postal_code = s.postal_code,country = s.country,
    geocoding_status = case when (l.address_line1,l.address_line2,l.city,l.state,l.postal_code,l.country)
      is distinct from (s.address_line1,s.address_line2,s.city,s.state,s.postal_code,s.country) then 'stale' else l.geocoding_status end
    from public.salon_settings s where l.id = p_salon_id and s.salon_id = l.id;
  return jsonb_build_object('salon_id',p_salon_id);
end $$;

revoke all on function public.my_place_account_details(uuid) from public, anon;
revoke all on function public.my_place_staff_requests() from public, anon;
revoke all on function public.my_place_save_member(uuid,uuid,text,uuid,text) from public, anon;
revoke all on function public.my_place_account_invitations() from public, anon;
revoke all on function public.my_place_respond_account_invitation(uuid,boolean) from public, anon;
revoke all on function public.my_place_update_salon(uuid,jsonb) from public, anon;
grant execute on function public.my_place_account_details(uuid) to authenticated;
grant execute on function public.my_place_staff_requests() to authenticated;
grant execute on function public.my_place_save_member(uuid,uuid,text,uuid,text) to authenticated;
grant execute on function public.my_place_account_invitations() to authenticated;
grant execute on function public.my_place_respond_account_invitation(uuid,boolean) to authenticated;
grant execute on function public.my_place_update_salon(uuid,jsonb) to authenticated;
