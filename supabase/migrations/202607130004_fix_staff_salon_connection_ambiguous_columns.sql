-- Qualify Staff-Salon Connection RPC column references.
-- Several PL/pgSQL RPCs return columns named id/status/etc. Unqualified table
-- columns inside those functions can collide with output parameters.

create or replace function public.search_staff_connection_account_exact(
  target_organization_id uuid,
  target_salon_id uuid,
  p_email text default null,
  p_phone text default null
)
returns table (
  result_status text,
  account_user_id uuid,
  display_name text,
  avatar_url text,
  masked_email text,
  masked_phone text,
  match_type text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_email text;
  normalized_phone text;
begin
  normalized_email := public.normalize_staff_connection_email(p_email);
  normalized_phone := public.normalize_staff_connection_phone(p_phone);

  if normalized_email is null and normalized_phone is null then
    raise exception 'Email or phone is required for exact account search.';
  end if;

  if not exists (
    select 1
    from public.locations as l
    where l.id = target_salon_id
      and l.organization_id = target_organization_id
  ) then
    raise exception 'Salon must belong to the organization.';
  end if;

  if not public.user_has_organization_permission(
    target_organization_id,
    array['staff.manage']::text[]
  ) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  return query
  with account_matches as (
    select
      u.id,
      u.display_name,
      u.avatar_url,
      u.email,
      u.phone,
      (
        normalized_email is not null
        and public.normalize_staff_connection_email(u.email) = normalized_email
      ) as email_match,
      (
        normalized_phone is not null
        and public.normalize_staff_connection_phone(u.phone) = normalized_phone
      ) as phone_match
    from public.users as u
    where u.status = 'active'
      and (
        (
          normalized_email is not null
          and public.normalize_staff_connection_email(u.email) = normalized_email
        )
        or (
          normalized_phone is not null
          and public.normalize_staff_connection_phone(u.phone) = normalized_phone
        )
      )
  ),
  account_match_count as (
    select count(*)::integer as value
    from account_matches
  )
  select
    'not_found'::text,
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text
  from account_match_count
  where account_match_count.value = 0

  union all

  select
    'ambiguous'::text,
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text
  from account_match_count
  where account_match_count.value > 1

  union all

  select
    'found'::text,
    account_matches.id,
    account_matches.display_name,
    account_matches.avatar_url,
    public.mask_staff_connection_email(account_matches.email),
    public.mask_staff_connection_phone(account_matches.phone),
    case
      when account_matches.email_match and account_matches.phone_match then 'email_phone'
      when account_matches.email_match then 'email'
      else 'phone'
    end
  from account_matches
  cross join account_match_count
  where account_match_count.value = 1;
end;
$$;

create or replace function public.get_staff_connection_invite_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_hash text;
  response jsonb;
  request_row public.staff_salon_connection_requests%rowtype;
begin
  normalized_hash := public.hash_staff_connection_token(p_token);

  select scr.*
  into request_row
  from public.staff_salon_connection_requests as scr
  where scr.direction = 'salon_invite'
    and scr.token_hash = normalized_hash
  limit 1;

  if request_row.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if request_row.status = 'pending'
    and request_row.expires_at <= now()
  then
    update public.staff_salon_connection_requests as scr
    set status = 'expired'
    where scr.id = request_row.id;

    request_row.status := 'expired';
  end if;

  select jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'expires_at', request_row.expires_at,
    'is_expired', request_row.expires_at <= now(),
    'salon', jsonb_build_object(
      'id', l.id,
      'name', coalesce(ss.business_name, l.name),
      'address_line1', coalesce(ss.address_line1, l.address_line1),
      'address_line2', coalesce(ss.address_line2, l.address_line2),
      'city', coalesce(ss.city, l.city),
      'state', coalesce(ss.state, l.state),
      'postal_code', coalesce(ss.postal_code, l.postal_code),
      'country', coalesce(ss.country, l.country),
      'status', l.status
    ),
    'staff', jsonb_build_object(
      'id', st.id,
      'display_name', st.display_name,
      'job_title', st.job_title,
      'is_active', st.is_active
    ),
    'target', jsonb_build_object(
      'masked_email', public.mask_staff_connection_email(request_row.target_email_normalized),
      'masked_phone', public.mask_staff_connection_phone(request_row.target_phone_e164),
      'has_account_target', request_row.account_user_id is not null
    )
  )
  into response
  from public.locations as l
  join public.staff as st
    on st.id = request_row.staff_id
  left join public.salon_settings as ss
    on ss.salon_id = l.id
  where l.id = request_row.salon_id
    and l.organization_id = request_row.organization_id;

  return coalesce(response, jsonb_build_object('status', 'invalid'));
end;
$$;

create or replace function public.apply_staff_connection_invite_decision(
  p_request_id uuid default null,
  p_token_hash text default null,
  p_decision text default 'accepted'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_row public.users%rowtype;
  request_row public.staff_salon_connection_requests%rowtype;
  staff_row public.staff%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to respond to this invitation.';
  end if;

  select u.*
  into current_user_row
  from public.users as u
  where u.id = current_user_id
    and u.status = 'active';

  if current_user_row.id is null then
    raise exception 'Your account is not active.';
  end if;

  if p_request_id is not null then
    select scr.*
    into request_row
    from public.staff_salon_connection_requests as scr
    where scr.id = p_request_id
      and scr.direction = 'salon_invite'
    for update;
  else
    select scr.*
    into request_row
    from public.staff_salon_connection_requests as scr
    where scr.token_hash = p_token_hash
      and scr.direction = 'salon_invite'
    for update;
  end if;

  if request_row.id is null then
    raise exception 'Invitation was not found.';
  end if;

  if p_token_hash is not null and request_row.token_hash is distinct from p_token_hash then
    raise exception 'Invitation link is no longer valid.';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'This invitation is no longer pending.';
  end if;

  if request_row.expires_at <= now() then
    update public.staff_salon_connection_requests as scr
    set status = 'expired'
    where scr.id = request_row.id;

    raise exception 'This invitation has expired.';
  end if;

  if not exists (
    select 1
    from public.locations as l
    where l.id = request_row.salon_id
      and l.organization_id = request_row.organization_id
      and l.status = 'active'
  ) then
    raise exception 'This salon is no longer active.';
  end if;

  if request_row.account_user_id is not null then
    if request_row.account_user_id <> current_user_id then
      raise exception 'This invitation belongs to a different account.';
    end if;
  else
    if request_row.target_email_normalized is not null then
      if public.normalize_staff_connection_email(current_user_row.email)
        is distinct from request_row.target_email_normalized
      then
        raise exception 'This invitation requires an account with the invited email.';
      end if;
    elsif request_row.target_phone_e164 is not null then
      if current_user_row.phone is null
        or public.normalize_staff_connection_phone(current_user_row.phone)
          is distinct from request_row.target_phone_e164
      then
        raise exception 'Phone-only invitations require a matching account phone before they can be accepted.';
      end if;
    else
      raise exception 'This invitation has no verifiable target.';
    end if;
  end if;

  if p_decision = 'declined' then
    update public.staff_salon_connection_requests as scr
    set
      account_user_id = coalesce(scr.account_user_id, current_user_id),
      declined_at = now(),
      status = 'declined',
      token_hash = null
    where scr.id = request_row.id
    returning scr.* into request_row;

    return jsonb_build_object(
      'request_id', request_row.id,
      'status', request_row.status,
      'salon_id', request_row.salon_id,
      'staff_id', request_row.staff_id
    );
  end if;

  if p_decision <> 'accepted' then
    raise exception 'Invitation decision must be accepted or declined.';
  end if;

  select st.*
  into staff_row
  from public.staff as st
  where st.id = request_row.staff_id
    and st.organization_id = request_row.organization_id
    and st.salon_id = request_row.salon_id
  for update;

  if staff_row.id is null then
    raise exception 'Staff profile was not found.';
  end if;

  if staff_row.is_active is not true then
    raise exception 'This staff profile is not active.';
  end if;

  if staff_row.account_user_id is not null
    and staff_row.account_user_id <> current_user_id
  then
    raise exception 'This staff profile is already connected to another account.';
  end if;

  if exists (
    select 1
    from public.staff as st_existing
    where st_existing.salon_id = request_row.salon_id
      and st_existing.account_user_id = current_user_id
      and st_existing.is_active = true
      and st_existing.id <> request_row.staff_id
  ) then
    raise exception 'Your account is already connected to an active staff profile in this salon.';
  end if;

  update public.staff as st
  set account_user_id = current_user_id
  where st.id = request_row.staff_id
    and (st.account_user_id is null or st.account_user_id = current_user_id)
    and st.is_active = true
  returning st.* into staff_row;

  if staff_row.id is null then
    raise exception 'Unable to connect this staff profile.';
  end if;

  update public.staff_salon_connection_requests as scr
  set
    accepted_at = now(),
    account_user_id = current_user_id,
    status = 'accepted',
    token_hash = null
  where scr.id = request_row.id
  returning scr.* into request_row;

  update public.staff_salon_connection_requests as scr
  set
    cancelled_at = now(),
    status = 'cancelled',
    token_hash = null
  where scr.id <> request_row.id
    and scr.salon_id = request_row.salon_id
    and scr.status = 'pending'
    and (
      scr.staff_id = request_row.staff_id
      or scr.account_user_id = current_user_id
      or (
        request_row.target_email_normalized is not null
        and scr.target_email_normalized = request_row.target_email_normalized
      )
      or (
        request_row.target_phone_e164 is not null
        and scr.target_phone_e164 = request_row.target_phone_e164
      )
    );

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'salon_id', request_row.salon_id,
    'staff_id', request_row.staff_id
  );
end;
$$;

create or replace function public.resend_staff_connection_invite(
  p_request_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  request_row public.staff_salon_connection_requests%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to resend staff invitations.';
  end if;

  select scr.*
  into request_row
  from public.staff_salon_connection_requests as scr
  where scr.id = p_request_id
    and scr.direction = 'salon_invite'
  for update;

  if request_row.id is null then
    raise exception 'Invitation was not found.';
  end if;

  if not public.user_has_organization_permission(
    request_row.organization_id,
    array['staff.manage']::text[]
  ) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  if request_row.status not in ('pending', 'expired') then
    raise exception 'Only pending or expired invitations can be resent.';
  end if;

  if p_token_hash is null or length(btrim(p_token_hash)) = 0 then
    raise exception 'A new invite token hash is required.';
  end if;

  if p_expires_at <= now() then
    raise exception 'Invitation expiration must be in the future.';
  end if;

  if not exists (
    select 1
    from public.locations as l
    where l.id = request_row.salon_id
      and l.organization_id = request_row.organization_id
      and l.status = 'active'
  ) then
    raise exception 'This salon is no longer active.';
  end if;

  if not exists (
    select 1
    from public.staff as st
    where st.id = request_row.staff_id
      and st.organization_id = request_row.organization_id
      and st.salon_id = request_row.salon_id
      and st.is_active = true
      and st.account_user_id is null
  ) then
    raise exception 'The invited staff profile is not available.';
  end if;

  update public.staff_salon_connection_requests as scr
  set
    accepted_at = null,
    cancelled_at = null,
    declined_at = null,
    expires_at = p_expires_at,
    revoked_at = null,
    status = 'pending',
    token_hash = p_token_hash
  where scr.id = request_row.id
  returning scr.* into request_row;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'expires_at', request_row.expires_at
  );
end;
$$;

create or replace function public.revoke_staff_connection_invite(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  request_row public.staff_salon_connection_requests%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to revoke staff invitations.';
  end if;

  select scr.*
  into request_row
  from public.staff_salon_connection_requests as scr
  where scr.id = p_request_id
    and scr.direction = 'salon_invite'
  for update;

  if request_row.id is null then
    raise exception 'Invitation was not found.';
  end if;

  if not public.user_has_organization_permission(
    request_row.organization_id,
    array['staff.manage']::text[]
  ) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked.';
  end if;

  if request_row.expires_at <= now() then
    update public.staff_salon_connection_requests as scr
    set status = 'expired'
    where scr.id = request_row.id;

    raise exception 'This invitation has already expired.';
  end if;

  update public.staff_salon_connection_requests as scr
  set
    reviewed_by_user_id = current_user_id,
    revoked_at = now(),
    status = 'revoked',
    token_hash = null
  where scr.id = request_row.id
  returning scr.* into request_row;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status
  );
end;
$$;

create or replace function public.search_public_staff_application_salons(
  p_query text default null,
  p_city text default null,
  p_state text default null,
  p_limit integer default 12
)
returns table (
  salon_id uuid,
  salon_name text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_query text;
  normalized_city text;
  normalized_state text;
  safe_limit integer;
begin
  normalized_query := lower(btrim(coalesce(p_query, '')));
  normalized_city := lower(btrim(coalesce(p_city, '')));
  normalized_state := lower(btrim(coalesce(p_state, '')));
  safe_limit := least(greatest(coalesce(p_limit, 12), 1), 25);

  return query
  select
    l.id,
    coalesce(ss.business_name, l.name),
    coalesce(ss.address_line1, l.address_line1),
    coalesce(ss.address_line2, l.address_line2),
    coalesce(ss.city, l.city),
    coalesce(ss.state, l.state),
    coalesce(ss.postal_code, l.postal_code),
    coalesce(ss.country, l.country)
  from public.locations as l
  join public.salon_settings as ss
    on ss.salon_id = l.id
  where l.status = 'active'
    and ss.allow_staff_applications = true
    and (
      normalized_query = ''
      or lower(coalesce(ss.business_name, l.name)) like '%' || normalized_query || '%'
      or lower(l.name) like '%' || normalized_query || '%'
    )
    and (
      normalized_city = ''
      or lower(coalesce(ss.city, l.city, '')) = normalized_city
    )
    and (
      normalized_state = ''
      or lower(coalesce(ss.state, l.state, '')) = normalized_state
    )
  order by coalesce(ss.business_name, l.name)
  limit safe_limit;
end;
$$;

create or replace function public.submit_staff_salon_application(
  p_salon_id uuid,
  p_message text default null,
  p_requested_job_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_row public.users%rowtype;
  location_row public.locations%rowtype;
  request_row public.staff_salon_connection_requests%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to apply to a salon.';
  end if;

  select u.*
  into current_user_row
  from public.users as u
  where u.id = current_user_id
    and u.status = 'active';

  if current_user_row.id is null then
    raise exception 'Your account is not active.';
  end if;

  select l.*
  into location_row
  from public.locations as l
  join public.salon_settings as ss
    on ss.salon_id = l.id
  where l.id = p_salon_id
    and l.status = 'active'
    and ss.allow_staff_applications = true;

  if location_row.id is null then
    raise exception 'This salon is not accepting staff applications.';
  end if;

  if exists (
    select 1
    from public.staff as st
    where st.salon_id = p_salon_id
      and st.is_active = true
      and (
        st.account_user_id = current_user_id
        or st.user_id = auth.uid()
      )
  ) then
    raise exception 'Your account is already connected to this salon.';
  end if;

  if exists (
    select 1
    from public.staff_salon_connection_requests as scr
    where scr.salon_id = p_salon_id
      and scr.status = 'pending'
      and (
        scr.account_user_id = current_user_id
        or (
          current_user_row.email is not null
          and scr.target_email_normalized = public.normalize_staff_connection_email(current_user_row.email)
        )
        or (
          current_user_row.phone is not null
          and scr.target_phone_e164 = public.normalize_staff_connection_phone(current_user_row.phone)
        )
      )
  ) then
    raise exception 'A pending connection request already exists for this salon.';
  end if;

  insert into public.staff_salon_connection_requests (
    organization_id,
    salon_id,
    account_user_id,
    direction,
    initiated_by_user_id,
    message,
    requested_job_title,
    status
  )
  values (
    location_row.organization_id,
    location_row.id,
    current_user_id,
    'staff_application',
    current_user_id,
    nullif(btrim(coalesce(p_message, '')), ''),
    nullif(btrim(coalesce(p_requested_job_title, '')), ''),
    'pending'
  )
  returning * into request_row;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'salon_id', request_row.salon_id
  );
end;
$$;

create or replace function public.cancel_staff_salon_application(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  request_row public.staff_salon_connection_requests%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to cancel an application.';
  end if;

  select scr.*
  into request_row
  from public.staff_salon_connection_requests as scr
  where scr.id = p_request_id
    and scr.direction = 'staff_application'
  for update;

  if request_row.id is null then
    raise exception 'Application was not found.';
  end if;

  if request_row.account_user_id <> current_user_id then
    raise exception 'You can only cancel your own application.';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending applications can be cancelled.';
  end if;

  update public.staff_salon_connection_requests as scr
  set
    cancelled_at = now(),
    status = 'cancelled'
  where scr.id = request_row.id
  returning scr.* into request_row;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status
  );
end;
$$;

create or replace function public.review_staff_salon_application(
  p_request_id uuid,
  p_decision text,
  p_staff_id uuid default null,
  p_display_name text default null,
  p_phone text default null,
  p_email text default null,
  p_job_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_staff_id uuid;
  account_row public.users%rowtype;
  current_user_id uuid;
  display_name text;
  request_row public.staff_salon_connection_requests%rowtype;
  staff_row public.staff%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to review staff applications.';
  end if;

  select scr.*
  into request_row
  from public.staff_salon_connection_requests as scr
  where scr.id = p_request_id
    and scr.direction = 'staff_application'
  for update;

  if request_row.id is null then
    raise exception 'Application was not found.';
  end if;

  if not public.user_has_organization_permission(
    request_row.organization_id,
    array['staff.manage']::text[]
  ) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending applications can be reviewed.';
  end if;

  if p_decision = 'declined' then
    update public.staff_salon_connection_requests as scr
    set
      declined_at = now(),
      reviewed_by_user_id = current_user_id,
      status = 'declined'
    where scr.id = request_row.id
    returning scr.* into request_row;

    return jsonb_build_object(
      'request_id', request_row.id,
      'status', request_row.status
    );
  end if;

  if p_decision <> 'accepted' then
    raise exception 'Application decision must be accepted or declined.';
  end if;

  if not exists (
    select 1
    from public.locations as l
    where l.id = request_row.salon_id
      and l.organization_id = request_row.organization_id
      and l.status = 'active'
  ) then
    raise exception 'This salon is no longer active.';
  end if;

  select u.*
  into account_row
  from public.users as u
  where u.id = request_row.account_user_id
    and u.status = 'active';

  if account_row.id is null then
    raise exception 'Applicant account is not active.';
  end if;

  if exists (
    select 1
    from public.staff as st_existing
    where st_existing.salon_id = request_row.salon_id
      and st_existing.account_user_id = request_row.account_user_id
      and st_existing.is_active = true
  ) then
    raise exception 'Applicant is already connected to an active staff profile in this salon.';
  end if;

  if p_staff_id is not null then
    select st.*
    into staff_row
    from public.staff as st
    where st.id = p_staff_id
      and st.organization_id = request_row.organization_id
      and st.salon_id = request_row.salon_id
    for update;

    if staff_row.id is null then
      raise exception 'Selected staff profile was not found.';
    end if;

    if staff_row.is_active is not true then
      raise exception 'Selected staff profile is not active.';
    end if;

    if staff_row.account_user_id is not null then
      raise exception 'Selected staff profile is already connected.';
    end if;

    update public.staff as st
    set
      account_user_id = request_row.account_user_id,
      job_title = coalesce(nullif(btrim(coalesce(p_job_title, '')), ''), st.job_title)
    where st.id = staff_row.id
    returning st.* into staff_row;
  else
    display_name := coalesce(
      nullif(btrim(coalesce(p_display_name, '')), ''),
      account_row.display_name,
      account_row.email,
      'Staff'
    );

    insert into public.staff (
      organization_id,
      salon_id,
      account_user_id,
      display_name,
      phone,
      email,
      job_title,
      is_active
    )
    values (
      request_row.organization_id,
      request_row.salon_id,
      request_row.account_user_id,
      display_name,
      coalesce(nullif(btrim(coalesce(p_phone, '')), ''), account_row.phone),
      coalesce(nullif(btrim(coalesce(p_email, '')), ''), account_row.email),
      coalesce(nullif(btrim(coalesce(p_job_title, '')), ''), request_row.requested_job_title),
      true
    )
    returning * into staff_row;
  end if;

  accepted_staff_id := staff_row.id;

  update public.staff_salon_connection_requests as scr
  set
    accepted_at = now(),
    reviewed_by_user_id = current_user_id,
    staff_id = accepted_staff_id,
    status = 'accepted'
  where scr.id = request_row.id
  returning scr.* into request_row;

  update public.staff_salon_connection_requests as scr
  set
    cancelled_at = now(),
    status = 'cancelled',
    token_hash = null
  where scr.id <> request_row.id
    and scr.salon_id = request_row.salon_id
    and scr.status = 'pending'
    and scr.account_user_id = request_row.account_user_id;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'salon_id', request_row.salon_id,
    'staff_id', accepted_staff_id
  );
end;
$$;

create or replace function public.list_my_staff_salon_connection_requests()
returns table (
  id uuid,
  salon_id uuid,
  staff_id uuid,
  direction text,
  status text,
  expires_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  message text,
  requested_job_title text,
  salon_name text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  staff_display_name text,
  staff_job_title text,
  target_masked_email text,
  target_masked_phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_user_row public.users%rowtype;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to view staff connections.';
  end if;

  select u.*
  into current_user_row
  from public.users as u
  where u.id = current_user_id
    and u.status = 'active';

  update public.staff_salon_connection_requests as scr
  set status = 'expired'
  where scr.direction = 'salon_invite'
    and scr.status = 'pending'
    and scr.expires_at <= now()
    and (
      scr.account_user_id = current_user_id
      or (
        scr.account_user_id is null
        and current_user_row.email is not null
        and scr.target_email_normalized = public.normalize_staff_connection_email(current_user_row.email)
      )
      or (
        scr.account_user_id is null
        and current_user_row.phone is not null
        and scr.target_phone_e164 = public.normalize_staff_connection_phone(current_user_row.phone)
      )
    );

  return query
  select
    scr.id,
    scr.salon_id,
    scr.staff_id,
    scr.direction,
    scr.status,
    scr.expires_at,
    scr.accepted_at,
    scr.declined_at,
    scr.cancelled_at,
    scr.revoked_at,
    scr.created_at,
    scr.updated_at,
    scr.message,
    scr.requested_job_title,
    coalesce(ss.business_name, l.name),
    coalesce(ss.address_line1, l.address_line1),
    coalesce(ss.address_line2, l.address_line2),
    coalesce(ss.city, l.city),
    coalesce(ss.state, l.state),
    coalesce(ss.postal_code, l.postal_code),
    coalesce(ss.country, l.country),
    st.display_name,
    st.job_title,
    public.mask_staff_connection_email(scr.target_email_normalized),
    public.mask_staff_connection_phone(scr.target_phone_e164)
  from public.staff_salon_connection_requests as scr
  join public.locations as l
    on l.id = scr.salon_id
  left join public.salon_settings as ss
    on ss.salon_id = scr.salon_id
  left join public.staff as st
    on st.id = scr.staff_id
  where scr.account_user_id = current_user_id
    or (
      scr.direction = 'salon_invite'
      and scr.account_user_id is null
      and current_user_row.email is not null
      and scr.target_email_normalized = public.normalize_staff_connection_email(current_user_row.email)
    )
    or (
      scr.direction = 'salon_invite'
      and scr.account_user_id is null
      and current_user_row.phone is not null
      and scr.target_phone_e164 = public.normalize_staff_connection_phone(current_user_row.phone)
    )
  order by scr.created_at desc;
end;
$$;

create or replace function public.list_current_staff_context_salons()
returns table (
  staff_id uuid,
  organization_id uuid,
  organization_name text,
  organization_legal_name text,
  organization_owner_user_id uuid,
  organization_status text,
  organization_created_at timestamptz,
  organization_updated_at timestamptz,
  salon_id uuid,
  salon_name text,
  salon_phone text,
  salon_address_line1 text,
  salon_address_line2 text,
  salon_city text,
  salon_state text,
  salon_postal_code text,
  salon_country text,
  salon_status text,
  salon_created_at timestamptz,
  salon_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
begin
  current_user_id := public.current_public_user_id();

  if current_user_id is null then
    raise exception 'You must be logged in to load staff context.';
  end if;

  return query
  select
    st.id,
    o.id,
    o.name,
    o.legal_name,
    o.owner_user_id,
    o.status,
    o.created_at,
    o.updated_at,
    l.id,
    l.name,
    l.phone,
    l.address_line1,
    l.address_line2,
    l.city,
    l.state,
    l.postal_code,
    l.country,
    l.status,
    l.created_at,
    l.updated_at
  from public.staff as st
  join public.organizations as o
    on o.id = st.organization_id
  join public.locations as l
    on l.id = st.salon_id
    and l.organization_id = st.organization_id
  where st.is_active = true
    and l.status = 'active'
    and o.status = 'active'
    and (
      st.account_user_id = current_user_id
      or st.user_id = auth.uid()
    )
  order by o.created_at, l.created_at;
end;
$$;

revoke all on function public.search_staff_connection_account_exact(uuid, uuid, text, text)
from public;
grant execute on function public.search_staff_connection_account_exact(uuid, uuid, text, text)
to authenticated;

revoke all on function public.get_staff_connection_invite_by_token(text) from public;
grant execute on function public.get_staff_connection_invite_by_token(text) to anon, authenticated;

revoke all on function public.apply_staff_connection_invite_decision(uuid, text, text) from public;

revoke all on function public.resend_staff_connection_invite(uuid, text, timestamptz) from public;
grant execute on function public.resend_staff_connection_invite(uuid, text, timestamptz) to authenticated;

revoke all on function public.revoke_staff_connection_invite(uuid) from public;
grant execute on function public.revoke_staff_connection_invite(uuid) to authenticated;

revoke all on function public.search_public_staff_application_salons(text, text, text, integer) from public;
grant execute on function public.search_public_staff_application_salons(text, text, text, integer) to anon, authenticated;

revoke all on function public.submit_staff_salon_application(uuid, text, text) from public;
grant execute on function public.submit_staff_salon_application(uuid, text, text) to authenticated;

revoke all on function public.cancel_staff_salon_application(uuid) from public;
grant execute on function public.cancel_staff_salon_application(uuid) to authenticated;

revoke all on function public.review_staff_salon_application(uuid, text, uuid, text, text, text, text) from public;
grant execute on function public.review_staff_salon_application(uuid, text, uuid, text, text, text, text) to authenticated;

revoke all on function public.list_my_staff_salon_connection_requests() from public;
grant execute on function public.list_my_staff_salon_connection_requests() to authenticated;

revoke all on function public.list_current_staff_context_salons() from public;
grant execute on function public.list_current_staff_context_salons() to authenticated;
