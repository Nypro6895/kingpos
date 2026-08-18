grant execute on function public.search_public_staff_application_salons(text, text, text, integer) to anon;
grant execute on function public.search_public_staff_application_salons(text, text, text, integer) to authenticated;

update public.staff_salon_connection_requests
set target_phone_e164 = public.normalize_customer_claim_phone(target_phone_e164),
    updated_at = now()
where target_phone_e164 is not null
  and public.normalize_customer_claim_phone(target_phone_e164) is not null
  and target_phone_e164 is distinct from public.normalize_customer_claim_phone(target_phone_e164);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_connection_target_phone_e164_canonical_check'
      and conrelid = 'public.staff_salon_connection_requests'::regclass
  ) then
    alter table public.staff_salon_connection_requests
    add constraint staff_connection_target_phone_e164_canonical_check
    check (
      target_phone_e164 is null
      or (
        public.normalize_customer_claim_phone(target_phone_e164) is not null
        and target_phone_e164 = public.normalize_customer_claim_phone(target_phone_e164)
      )
    ) not valid;
  end if;
end;
$$;

create or replace function public.staff_connection_invite_phone_status(
  p_user_id uuid,
  p_target_phone text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  account_phone text;
  target_phone text := public.normalize_customer_claim_phone(p_target_phone);
begin
  if nullif(btrim(coalesce(p_target_phone, '')), '') is null then
    return 'not_required';
  end if;

  if p_user_id is null then
    return 'missing_account_phone';
  end if;

  if target_phone is null then
    return 'invalid_invite_phone';
  end if;

  select public.normalize_customer_claim_phone(users.phone)
  into account_phone
  from public.users
  where users.id = p_user_id
    and users.status = 'active';

  if account_phone is null then
    return 'missing_account_phone';
  end if;

  if account_phone is distinct from target_phone then
    return 'phone_mismatch';
  end if;

  if not exists (
    select 1
    from public.customer_verified_phones verified
    join public.users owner_user on owner_user.id = verified.user_id
    where verified.user_id = p_user_id
      and verified.normalized_phone = target_phone
      and owner_user.status = 'active'
  ) then
    return 'phone_unverified';
  end if;

  return 'phone_verified';
end;
$$;

create or replace function public.staff_connection_invite_identity_status(
  p_account_user_id uuid,
  p_target_email text,
  p_target_phone text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  account_matches boolean := false;
  current_user_id uuid := public.current_public_user_id();
  current_user_row public.users%rowtype;
  email_matches boolean := false;
  phone_status text;
begin
  if current_user_id is null then
    return 'signed_out';
  end if;

  select *
  into current_user_row
  from public.users
  where users.id = current_user_id
    and users.status = 'active';

  if current_user_row.id is null then
    return 'inactive_account';
  end if;

  account_matches := p_account_user_id is not null
    and p_account_user_id = current_user_id;

  if p_account_user_id is not null and not account_matches then
    return 'different_account';
  end if;

  email_matches := nullif(btrim(coalesce(p_target_email, '')), '') is not null
    and lower(btrim(coalesce(current_user_row.email, ''))) = lower(btrim(p_target_email));

  phone_status := public.staff_connection_invite_phone_status(
    current_user_id,
    p_target_phone
  );

  if phone_status = 'phone_verified' then
    return 'matched';
  end if;

  if phone_status in (
    'invalid_invite_phone',
    'missing_account_phone',
    'phone_mismatch',
    'phone_unverified'
  ) then
    if account_matches or email_matches or phone_status = 'phone_unverified' then
      return phone_status;
    end if;

    return 'identity_mismatch';
  end if;

  if account_matches then
    return 'matched';
  end if;

  if nullif(btrim(coalesce(p_target_email, '')), '') is not null then
    if email_matches then
      return 'matched';
    end if;

    return 'email_mismatch';
  end if;

  return 'identity_mismatch';
end;
$$;

revoke all on function public.staff_connection_invite_phone_status(uuid, text) from public;
revoke all on function public.staff_connection_invite_identity_status(uuid, text, text) from public;

create or replace function public.search_staff_connection_account_exact(
  p_email text,
  p_phone text,
  target_account_id uuid,
  target_salon_id uuid
)
returns table (
  account_user_id uuid,
  avatar_url text,
  display_name text,
  masked_email text,
  masked_phone text,
  match_type text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_input as (
    select
      lower(btrim(coalesce(p_email, ''))) as email,
      public.normalize_customer_claim_phone(p_phone) as phone
  )
  select
    users.id,
    users.avatar_url,
    users.display_name,
    case when users.email is null then null else left(users.email, 2) || '***' end,
    case
      when public.normalize_customer_claim_phone(users.phone) is null then null
      else '***' || right(public.normalize_customer_claim_phone(users.phone), 4)
    end,
    case
      when normalized_input.email <> ''
        and lower(users.email) = normalized_input.email
        and normalized_input.phone is not null
        and public.normalize_customer_claim_phone(users.phone) = normalized_input.phone
      then 'email_phone'
      when normalized_input.email <> ''
        and lower(users.email) = normalized_input.email
      then 'email'
      else 'phone'
    end
  from public.users
  cross join normalized_input
  where exists (
    select 1
    from public.locations salons
    where salons.id = target_salon_id
      and salons.account_id = target_account_id
  )
  and (
    (normalized_input.email <> '' and lower(users.email) = normalized_input.email)
    or (
      normalized_input.phone is not null
      and public.normalize_customer_claim_phone(users.phone) = normalized_input.phone
    )
  )
  limit 2
$$;

grant execute on function public.search_staff_connection_account_exact(text, text, uuid, uuid) to authenticated;

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
  current_user_id uuid := public.current_public_user_id();
  current_user_row public.users%rowtype;
  identity_status text;
  request_row public.staff_salon_connection_requests%rowtype;
  staff_row public.staff%rowtype;
begin
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

  select *
  into request_row
  from public.staff_salon_connection_requests
  where direction = 'salon_invite'
    and (
      (p_request_id is not null and id = p_request_id)
      or (p_request_id is null and token_hash = p_token_hash)
    )
  for update;

  if request_row.id is null then
    raise exception 'Invitation was not found.';
  end if;

  if p_token_hash is not null and request_row.token_hash is distinct from p_token_hash then
    raise exception 'Invitation link is no longer valid.';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'This invitation is no longer pending.';
  end if;

  if request_row.expires_at is not null and request_row.expires_at <= now() then
    update public.staff_salon_connection_requests
    set status = 'expired',
        updated_at = now()
    where id = request_row.id;
    raise exception 'This invitation has expired.';
  end if;

  identity_status := public.staff_connection_invite_identity_status(
    request_row.account_user_id,
    request_row.target_email_normalized,
    request_row.target_phone_e164
  );

  if identity_status <> 'matched' then
    case identity_status
      when 'different_account' then
        raise exception 'This invitation belongs to a different account.';
      when 'email_mismatch' then
        raise exception 'This invitation requires an account with the invited email.';
      when 'missing_account_phone' then
        raise exception 'Add and verify the invited phone in Account Settings before accepting this invitation.';
      when 'phone_mismatch' then
        raise exception 'This invitation was sent to a different phone number.';
      when 'phone_unverified' then
        raise exception 'Verify the invited phone in Account Settings before accepting this invitation.';
      when 'invalid_invite_phone' then
        raise exception 'This invitation has an invalid phone target. Ask the salon to resend it.';
      else
        raise exception 'This invitation belongs to a different account.';
    end case;
  end if;

  if p_decision = 'declined' then
    update public.staff_salon_connection_requests
    set account_user_id = coalesce(account_user_id, current_user_id),
        declined_at = now(),
        status = 'declined',
        token_hash = null,
        updated_at = now()
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
    and salon_id = request_row.salon_id
  for update;

  if staff_row.id is null or staff_row.is_active is not true then
    raise exception 'Staff profile was not found.';
  end if;

  if staff_row.account_user_id is not null and staff_row.account_user_id <> current_user_id then
    raise exception 'This staff profile is already connected to another account.';
  end if;

  if exists (
    select 1
    from public.staff existing_staff
    where existing_staff.salon_id = request_row.salon_id
      and existing_staff.account_user_id = current_user_id
      and existing_staff.is_active = true
      and existing_staff.id <> staff_row.id
  ) then
    raise exception 'Your account is already connected to an active staff profile in this salon.';
  end if;

  update public.staff
  set account_user_id = current_user_id,
      updated_at = now()
  where id = staff_row.id
  returning * into staff_row;

  update public.staff_salon_connection_requests
  set accepted_at = now(),
      account_user_id = current_user_id,
      status = 'accepted',
      token_hash = null,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  update public.staff_salon_connection_requests
  set cancelled_at = now(),
      status = 'cancelled',
      token_hash = null,
      updated_at = now()
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
        and public.normalize_customer_claim_phone(target_phone_e164) =
          public.normalize_customer_claim_phone(request_row.target_phone_e164)
      )
    );

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'salon_id', request_row.salon_id,
    'staff_id', staff_row.id
  );
end;
$$;

revoke all on function public.apply_staff_connection_invite_decision(uuid, text, text) from public;

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
  current_user_id uuid := public.current_public_user_id();
  current_user_row public.users%rowtype;
begin
  if current_user_id is null then
    raise exception 'You must be logged in to view staff connections.';
  end if;

  select *
  into current_user_row
  from public.users
  where users.id = current_user_id;

  update public.staff_salon_connection_requests as connection_requests
  set status = 'expired',
      updated_at = now()
  where connection_requests.direction = 'salon_invite'
    and connection_requests.status = 'pending'
    and connection_requests.expires_at is not null
    and connection_requests.expires_at <= now()
    and (
      connection_requests.account_user_id = current_user_id
      or public.staff_connection_invite_identity_status(
        connection_requests.account_user_id,
        connection_requests.target_email_normalized,
        connection_requests.target_phone_e164
      ) in (
        'invalid_invite_phone',
        'matched',
        'missing_account_phone',
        'phone_mismatch',
        'phone_unverified'
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
    coalesce(settings.business_name, salons.name),
    coalesce(settings.address_line1, salons.address_line1),
    coalesce(settings.address_line2, salons.address_line2),
    coalesce(settings.city, salons.city),
    coalesce(settings.state, salons.state),
    coalesce(settings.postal_code, salons.postal_code),
    coalesce(settings.country, salons.country),
    staff.display_name,
    staff.job_title,
    case when requests.target_email_normalized is null then null else left(requests.target_email_normalized, 1) || '***' end,
    case when requests.target_phone_e164 is null then null else '***' || right(requests.target_phone_e164, 4) end
  from public.staff_salon_connection_requests requests
  join public.locations salons on salons.id = requests.salon_id
  left join public.salon_settings settings on settings.salon_id = requests.salon_id
  left join public.staff on staff.id = requests.staff_id
  where requests.account_user_id = current_user_id
    or (
      requests.direction = 'salon_invite'
      and requests.account_user_id is null
      and public.staff_connection_invite_identity_status(
        requests.account_user_id,
        requests.target_email_normalized,
        requests.target_phone_e164
      ) in (
        'invalid_invite_phone',
        'matched',
        'missing_account_phone',
        'phone_mismatch',
        'phone_unverified'
      )
    )
  order by requests.created_at desc;
end;
$$;

grant execute on function public.list_my_staff_salon_connection_requests() to authenticated;
