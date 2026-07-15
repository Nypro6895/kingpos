-- Complete Staff-Salon Connection lifecycle.
-- Keeps the shared staff_salon_connection_requests table as the sole source of
-- invite/application state and keeps staff.account_user_id as the official link.

alter table public.salon_settings
add column if not exists allow_staff_applications boolean not null default false;

comment on column public.salon_settings.allow_staff_applications is
  'When true, logged-in staff accounts can find this active salon in public application search and submit a staff application.';

alter table public.staff_salon_connection_requests
add column if not exists message text,
add column if not exists requested_job_title text;

comment on column public.staff_salon_connection_requests.message is
  'Optional applicant message for staff_application requests.';

comment on column public.staff_salon_connection_requests.requested_job_title is
  'Optional applicant requested role/title for staff_application requests.';

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'staff_active_account_per_salon_unique_idx'
  ) then
    create unique index staff_active_account_per_salon_unique_idx
    on public.staff(salon_id, account_user_id)
    where account_user_id is not null
      and is_active = true;
  end if;
end;
$$;

alter table public.staff_salon_connection_requests
drop constraint if exists staff_salon_connection_requests_salon_invite_required_check;

alter table public.staff_salon_connection_requests
add constraint staff_salon_connection_requests_salon_invite_required_check check (
  direction <> 'salon_invite'
  or (
    staff_id is not null
    and expires_at is not null
    and (
      account_user_id is not null
      or target_email_normalized is not null
      or target_phone_e164 is not null
    )
    and (
      status <> 'pending'
      or token_hash is not null
    )
  )
);

create or replace function public.hash_staff_connection_token(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(
    extensions.digest(convert_to(coalesce(input, ''), 'UTF8'), 'sha256'::text),
    'hex'
  )
$$;

create or replace function public.validate_staff_salon_connection_request_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.direction is distinct from old.direction
    or new.initiated_by_user_id is distinct from old.initiated_by_user_id
  ) then
    raise exception 'Staff-Salon connection request ownership fields cannot be changed.';
  end if;

  if tg_op = 'UPDATE'
    and new.staff_id is distinct from old.staff_id
    and not (
      old.direction = 'staff_application'
      and old.staff_id is null
      and new.staff_id is not null
      and old.status = 'pending'
      and new.status = 'accepted'
    )
  then
    raise exception 'Staff-Salon connection request staff target cannot be changed.';
  end if;

  if tg_op = 'UPDATE'
    and new.account_user_id is distinct from old.account_user_id
    and not (
      old.direction = 'salon_invite'
      and old.account_user_id is null
      and new.account_user_id is not null
      and old.status = 'pending'
      and new.status in ('accepted', 'declined')
    )
  then
    raise exception 'Staff-Salon connection request account target cannot be changed.';
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if old.status = 'pending'
      and new.status in ('accepted', 'declined', 'cancelled', 'revoked', 'expired')
    then
      null;
    elsif old.status = 'expired'
      and new.status = 'pending'
      and old.direction = 'salon_invite'
    then
      null;
    else
      raise exception 'Invalid Staff-Salon connection request status transition.';
    end if;
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Staff-Salon connection request salon must belong to the organization.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Staff-Salon connection request staff member must belong to the organization and salon.';
  end if;

  if new.direction = 'salon_invite' then
    if new.staff_id is null then
      raise exception 'Salon invites require a staff record.';
    end if;

    if new.account_user_id is null
      and new.target_email_normalized is null
      and new.target_phone_e164 is null
    then
      raise exception 'Salon invites require an account, email, or phone target.';
    end if;

    if new.expires_at is null then
      raise exception 'Salon invites require an expiration.';
    end if;

    if new.status = 'pending' and new.token_hash is null then
      raise exception 'Pending salon invites require a token hash.';
    end if;
  end if;

  if new.direction = 'staff_application' and new.account_user_id is null then
    raise exception 'Staff applications require an account user.';
  end if;

  if new.status = 'pending' and (
    new.accepted_at is not null
    or new.declined_at is not null
    or new.cancelled_at is not null
    or new.revoked_at is not null
  ) then
    raise exception 'Pending Staff-Salon connection requests cannot have terminal timestamps.';
  end if;

  if new.status = 'accepted' and new.accepted_at is null then
    raise exception 'Accepted Staff-Salon connection requests require accepted_at.';
  end if;

  if new.status = 'declined' and new.declined_at is null then
    raise exception 'Declined Staff-Salon connection requests require declined_at.';
  end if;

  if new.status = 'cancelled' and new.cancelled_at is null then
    raise exception 'Cancelled Staff-Salon connection requests require cancelled_at.';
  end if;

  if new.status = 'revoked' and new.revoked_at is null then
    raise exception 'Revoked Staff-Salon connection requests require revoked_at.';
  end if;

  return new;
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

  select *
  into request_row
  from public.staff_salon_connection_requests
  where direction = 'salon_invite'
    and token_hash = normalized_hash
  limit 1;

  if request_row.id is null then
    return jsonb_build_object('status', 'invalid');
  end if;

  if request_row.status = 'pending'
    and request_row.expires_at <= now()
  then
    update public.staff_salon_connection_requests
    set status = 'expired'
    where id = request_row.id;

    request_row.status := 'expired';
  end if;

  select jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'expires_at', request_row.expires_at,
    'is_expired', request_row.expires_at <= now(),
    'salon', jsonb_build_object(
      'id', locations.id,
      'name', coalesce(salon_settings.business_name, locations.name),
      'address_line1', coalesce(salon_settings.address_line1, locations.address_line1),
      'address_line2', coalesce(salon_settings.address_line2, locations.address_line2),
      'city', coalesce(salon_settings.city, locations.city),
      'state', coalesce(salon_settings.state, locations.state),
      'postal_code', coalesce(salon_settings.postal_code, locations.postal_code),
      'country', coalesce(salon_settings.country, locations.country),
      'status', locations.status
    ),
    'staff', jsonb_build_object(
      'id', staff.id,
      'display_name', staff.display_name,
      'job_title', staff.job_title,
      'is_active', staff.is_active
    ),
    'target', jsonb_build_object(
      'masked_email', public.mask_staff_connection_email(request_row.target_email_normalized),
      'masked_phone', public.mask_staff_connection_phone(request_row.target_phone_e164),
      'has_account_target', request_row.account_user_id is not null
    )
  )
  into response
  from public.locations
  join public.staff
    on staff.id = request_row.staff_id
  left join public.salon_settings
    on salon_settings.salon_id = locations.id
  where locations.id = request_row.salon_id
    and locations.organization_id = request_row.organization_id;

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

  select *
  into current_user_row
  from public.users
  where id = current_user_id
    and status = 'active';

  if current_user_row.id is null then
    raise exception 'Your account is not active.';
  end if;

  if p_request_id is not null then
    select *
    into request_row
    from public.staff_salon_connection_requests
    where id = p_request_id
      and direction = 'salon_invite'
    for update;
  else
    select *
    into request_row
    from public.staff_salon_connection_requests
    where token_hash = p_token_hash
      and direction = 'salon_invite'
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
    update public.staff_salon_connection_requests
    set status = 'expired'
    where id = request_row.id;

    raise exception 'This invitation has expired.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = request_row.salon_id
      and locations.organization_id = request_row.organization_id
      and locations.status = 'active'
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
    update public.staff_salon_connection_requests
    set
      account_user_id = coalesce(account_user_id, current_user_id),
      declined_at = now(),
      status = 'declined',
      token_hash = null
    where id = request_row.id
    returning * into request_row;

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

  select *
  into staff_row
  from public.staff
  where id = request_row.staff_id
    and organization_id = request_row.organization_id
    and salon_id = request_row.salon_id
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
    from public.staff
    where salon_id = request_row.salon_id
      and account_user_id = current_user_id
      and is_active = true
      and id <> request_row.staff_id
  ) then
    raise exception 'Your account is already connected to an active staff profile in this salon.';
  end if;

  update public.staff
  set account_user_id = current_user_id
  where id = request_row.staff_id
    and (account_user_id is null or account_user_id = current_user_id)
    and is_active = true
  returning * into staff_row;

  if staff_row.id is null then
    raise exception 'Unable to connect this staff profile.';
  end if;

  update public.staff_salon_connection_requests
  set
    accepted_at = now(),
    account_user_id = current_user_id,
    status = 'accepted',
    token_hash = null
  where id = request_row.id
  returning * into request_row;

  update public.staff_salon_connection_requests
  set
    cancelled_at = now(),
    status = 'cancelled',
    token_hash = null
  where id <> request_row.id
    and salon_id = request_row.salon_id
    and status = 'pending'
    and (
      staff_id = request_row.staff_id
      or account_user_id = current_user_id
      or (
        request_row.target_email_normalized is not null
        and target_email_normalized = request_row.target_email_normalized
      )
      or (
        request_row.target_phone_e164 is not null
        and target_phone_e164 = request_row.target_phone_e164
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

create or replace function public.accept_staff_connection_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.apply_staff_connection_invite_decision(
    null,
    public.hash_staff_connection_token(p_token),
    'accepted'
  );
end;
$$;

create or replace function public.decline_staff_connection_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.apply_staff_connection_invite_decision(
    null,
    public.hash_staff_connection_token(p_token),
    'declined'
  );
end;
$$;

create or replace function public.accept_staff_connection_invite_by_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.apply_staff_connection_invite_decision(
    p_request_id,
    null,
    'accepted'
  );
end;
$$;

create or replace function public.decline_staff_connection_invite_by_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.apply_staff_connection_invite_decision(
    p_request_id,
    null,
    'declined'
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

  select *
  into request_row
  from public.staff_salon_connection_requests
  where id = p_request_id
    and direction = 'salon_invite'
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
    from public.locations
    where id = request_row.salon_id
      and organization_id = request_row.organization_id
      and status = 'active'
  ) then
    raise exception 'This salon is no longer active.';
  end if;

  if not exists (
    select 1
    from public.staff
    where id = request_row.staff_id
      and organization_id = request_row.organization_id
      and salon_id = request_row.salon_id
      and is_active = true
      and account_user_id is null
  ) then
    raise exception 'The invited staff profile is not available.';
  end if;

  update public.staff_salon_connection_requests
  set
    accepted_at = null,
    cancelled_at = null,
    declined_at = null,
    expires_at = p_expires_at,
    revoked_at = null,
    status = 'pending',
    token_hash = p_token_hash
  where id = request_row.id
  returning * into request_row;

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

  select *
  into request_row
  from public.staff_salon_connection_requests
  where id = p_request_id
    and direction = 'salon_invite'
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
    update public.staff_salon_connection_requests
    set status = 'expired'
    where id = request_row.id;

    raise exception 'This invitation has already expired.';
  end if;

  update public.staff_salon_connection_requests
  set
    reviewed_by_user_id = current_user_id,
    revoked_at = now(),
    status = 'revoked',
    token_hash = null
  where id = request_row.id
  returning * into request_row;

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
    locations.id,
    coalesce(salon_settings.business_name, locations.name),
    coalesce(salon_settings.address_line1, locations.address_line1),
    coalesce(salon_settings.address_line2, locations.address_line2),
    coalesce(salon_settings.city, locations.city),
    coalesce(salon_settings.state, locations.state),
    coalesce(salon_settings.postal_code, locations.postal_code),
    coalesce(salon_settings.country, locations.country)
  from public.locations
  join public.salon_settings
    on salon_settings.salon_id = locations.id
  where locations.status = 'active'
    and salon_settings.allow_staff_applications = true
    and (
      normalized_query = ''
      or lower(coalesce(salon_settings.business_name, locations.name)) like '%' || normalized_query || '%'
      or lower(locations.name) like '%' || normalized_query || '%'
    )
    and (
      normalized_city = ''
      or lower(coalesce(salon_settings.city, locations.city, '')) = normalized_city
    )
    and (
      normalized_state = ''
      or lower(coalesce(salon_settings.state, locations.state, '')) = normalized_state
    )
  order by coalesce(salon_settings.business_name, locations.name)
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

  select *
  into current_user_row
  from public.users
  where id = current_user_id
    and status = 'active';

  if current_user_row.id is null then
    raise exception 'Your account is not active.';
  end if;

  select locations.*
  into location_row
  from public.locations
  join public.salon_settings
    on salon_settings.salon_id = locations.id
  where locations.id = p_salon_id
    and locations.status = 'active'
    and salon_settings.allow_staff_applications = true;

  if location_row.id is null then
    raise exception 'This salon is not accepting staff applications.';
  end if;

  if exists (
    select 1
    from public.staff
    where salon_id = p_salon_id
      and is_active = true
      and (
        account_user_id = current_user_id
        or user_id = auth.uid()
      )
  ) then
    raise exception 'Your account is already connected to this salon.';
  end if;

  if exists (
    select 1
    from public.staff_salon_connection_requests
    where salon_id = p_salon_id
      and status = 'pending'
      and (
        account_user_id = current_user_id
        or (
          current_user_row.email is not null
          and target_email_normalized = public.normalize_staff_connection_email(current_user_row.email)
        )
        or (
          current_user_row.phone is not null
          and target_phone_e164 = public.normalize_staff_connection_phone(current_user_row.phone)
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

  select *
  into request_row
  from public.staff_salon_connection_requests
  where id = p_request_id
    and direction = 'staff_application'
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

  update public.staff_salon_connection_requests
  set
    cancelled_at = now(),
    status = 'cancelled'
  where id = request_row.id
  returning * into request_row;

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

  select *
  into request_row
  from public.staff_salon_connection_requests
  where id = p_request_id
    and direction = 'staff_application'
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
    update public.staff_salon_connection_requests
    set
      declined_at = now(),
      reviewed_by_user_id = current_user_id,
      status = 'declined'
    where id = request_row.id
    returning * into request_row;

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
    from public.locations
    where id = request_row.salon_id
      and organization_id = request_row.organization_id
      and status = 'active'
  ) then
    raise exception 'This salon is no longer active.';
  end if;

  select *
  into account_row
  from public.users
  where id = request_row.account_user_id
    and status = 'active';

  if account_row.id is null then
    raise exception 'Applicant account is not active.';
  end if;

  if exists (
    select 1
    from public.staff
    where salon_id = request_row.salon_id
      and account_user_id = request_row.account_user_id
      and is_active = true
  ) then
    raise exception 'Applicant is already connected to an active staff profile in this salon.';
  end if;

  if p_staff_id is not null then
    select *
    into staff_row
    from public.staff
    where id = p_staff_id
      and organization_id = request_row.organization_id
      and salon_id = request_row.salon_id
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

    update public.staff
    set
      account_user_id = request_row.account_user_id,
      job_title = coalesce(nullif(btrim(coalesce(p_job_title, '')), ''), job_title)
    where id = staff_row.id
    returning * into staff_row;
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

  update public.staff_salon_connection_requests
  set
    accepted_at = now(),
    reviewed_by_user_id = current_user_id,
    staff_id = accepted_staff_id,
    status = 'accepted'
  where id = request_row.id
  returning * into request_row;

  update public.staff_salon_connection_requests
  set
    cancelled_at = now(),
    status = 'cancelled',
    token_hash = null
  where id <> request_row.id
    and salon_id = request_row.salon_id
    and status = 'pending'
    and account_user_id = request_row.account_user_id;

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

  select *
  into current_user_row
  from public.users
  where id = current_user_id
    and status = 'active';

  update public.staff_salon_connection_requests as requests
  set status = 'expired'
  where requests.direction = 'salon_invite'
    and requests.status = 'pending'
    and requests.expires_at <= now()
    and (
      requests.account_user_id = current_user_id
      or (
        requests.account_user_id is null
        and current_user_row.email is not null
        and requests.target_email_normalized = public.normalize_staff_connection_email(current_user_row.email)
      )
      or (
        requests.account_user_id is null
        and current_user_row.phone is not null
        and requests.target_phone_e164 = public.normalize_staff_connection_phone(current_user_row.phone)
      )
    );

  return query
  select
    requests.id,
    requests.salon_id,
    requests.staff_id,
    requests.direction,
    requests.status,
    requests.expires_at,
    requests.accepted_at,
    requests.declined_at,
    requests.cancelled_at,
    requests.revoked_at,
    requests.created_at,
    requests.updated_at,
    requests.message,
    requests.requested_job_title,
    coalesce(salon_settings.business_name, locations.name),
    coalesce(salon_settings.address_line1, locations.address_line1),
    coalesce(salon_settings.address_line2, locations.address_line2),
    coalesce(salon_settings.city, locations.city),
    coalesce(salon_settings.state, locations.state),
    coalesce(salon_settings.postal_code, locations.postal_code),
    coalesce(salon_settings.country, locations.country),
    staff.display_name,
    staff.job_title,
    public.mask_staff_connection_email(requests.target_email_normalized),
    public.mask_staff_connection_phone(requests.target_phone_e164)
  from public.staff_salon_connection_requests as requests
  join public.locations
    on locations.id = requests.salon_id
  left join public.salon_settings
    on salon_settings.salon_id = requests.salon_id
  left join public.staff
    on staff.id = requests.staff_id
  where requests.account_user_id = current_user_id
    or (
      requests.direction = 'salon_invite'
      and requests.account_user_id is null
      and current_user_row.email is not null
      and requests.target_email_normalized = public.normalize_staff_connection_email(current_user_row.email)
    )
    or (
      requests.direction = 'salon_invite'
      and requests.account_user_id is null
      and current_user_row.phone is not null
      and requests.target_phone_e164 = public.normalize_staff_connection_phone(current_user_row.phone)
    )
  order by requests.created_at desc;
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
    staff.id,
    organizations.id,
    organizations.name,
    organizations.legal_name,
    organizations.owner_user_id,
    organizations.status,
    organizations.created_at,
    organizations.updated_at,
    locations.id,
    locations.name,
    locations.phone,
    locations.address_line1,
    locations.address_line2,
    locations.city,
    locations.state,
    locations.postal_code,
    locations.country,
    locations.status,
    locations.created_at,
    locations.updated_at
  from public.staff
  join public.organizations
    on organizations.id = staff.organization_id
  join public.locations
    on locations.id = staff.salon_id
    and locations.organization_id = staff.organization_id
  where staff.is_active = true
    and locations.status = 'active'
    and organizations.status = 'active'
    and (
      staff.account_user_id = current_user_id
      or staff.user_id = auth.uid()
    )
  order by organizations.created_at, locations.created_at;
end;
$$;

drop policy if exists "Linked staff can view own staff profile"
on public.staff;
create policy "Linked staff can view own staff profile"
on public.staff
for select
to authenticated
using (
  public.current_auth_user_matches_staff(
    id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Linked staff can view own salon workdays by account"
on public.staff_workdays;
create policy "Linked staff can view own salon workdays by account"
on public.staff_workdays
for select
to authenticated
using (
  public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Linked staff can create own salon workdays by account"
on public.staff_workdays;
create policy "Linked staff can create own salon workdays by account"
on public.staff_workdays
for insert
to authenticated
with check (
  public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Linked staff can update own salon workdays by account"
on public.staff_workdays;
create policy "Linked staff can update own salon workdays by account"
on public.staff_workdays
for update
to authenticated
using (
  public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
)
with check (
  public.current_auth_user_matches_staff(
    staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Linked staff can view own assigned POS ticket items"
on public.pos_ticket_items;
create policy "Linked staff can view own assigned POS ticket items"
on public.pos_ticket_items
for select
to authenticated
using (
  assigned_staff_id is not null
  and public.current_auth_user_matches_staff(
    assigned_staff_id,
    organization_id,
    salon_id
  )
);

drop policy if exists "Linked staff can view POS tickets with own assigned items"
on public.pos_tickets;
create policy "Linked staff can view POS tickets with own assigned items"
on public.pos_tickets
for select
to authenticated
using (
  exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_items.pos_ticket_id = pos_tickets.id
      and pos_ticket_items.organization_id = pos_tickets.organization_id
      and pos_ticket_items.salon_id = pos_tickets.salon_id
      and pos_ticket_items.assigned_staff_id is not null
      and public.current_auth_user_matches_staff(
        pos_ticket_items.assigned_staff_id,
        pos_ticket_items.organization_id,
        pos_ticket_items.salon_id
      )
  )
);

drop policy if exists "Linked staff can view customers from own assigned tickets"
on public.customers;
create policy "Linked staff can view customers from own assigned tickets"
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.pos_tickets
    join public.pos_ticket_items
      on pos_ticket_items.pos_ticket_id = pos_tickets.id
    where pos_tickets.customer_id = customers.id
      and pos_tickets.salon_id = customers.location_id
      and pos_ticket_items.assigned_staff_id is not null
      and public.current_auth_user_matches_staff(
        pos_ticket_items.assigned_staff_id,
        pos_ticket_items.organization_id,
        pos_ticket_items.salon_id
      )
  )
);

drop policy if exists "Linked staff can view services from own assigned items"
on public.services;
create policy "Linked staff can view services from own assigned items"
on public.services
for select
to authenticated
using (
  exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_items.service_id = services.id
      and pos_ticket_items.organization_id = services.organization_id
      and pos_ticket_items.salon_id = services.salon_id
      and pos_ticket_items.assigned_staff_id is not null
      and public.current_auth_user_matches_staff(
        pos_ticket_items.assigned_staff_id,
        pos_ticket_items.organization_id,
        pos_ticket_items.salon_id
      )
  )
);

drop policy if exists "Account users can create staff applications"
on public.staff_salon_connection_requests;

revoke all on function public.get_staff_connection_invite_by_token(text) from public;
grant execute on function public.get_staff_connection_invite_by_token(text) to anon, authenticated;

revoke all on function public.apply_staff_connection_invite_decision(uuid, text, text) from public;

revoke all on function public.accept_staff_connection_invite(text) from public;
grant execute on function public.accept_staff_connection_invite(text) to authenticated;

revoke all on function public.decline_staff_connection_invite(text) from public;
grant execute on function public.decline_staff_connection_invite(text) to authenticated;

revoke all on function public.accept_staff_connection_invite_by_request(uuid) from public;
grant execute on function public.accept_staff_connection_invite_by_request(uuid) to authenticated;

revoke all on function public.decline_staff_connection_invite_by_request(uuid) from public;
grant execute on function public.decline_staff_connection_invite_by_request(uuid) to authenticated;

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
