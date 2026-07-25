create or replace function public.mask_staff_connection_email(p_email text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  domain_part text;
  local_part text;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if normalized_email = '' then
    return null;
  end if;

  if position('@' in normalized_email) = 0 then
    return left(normalized_email, 1) ||
      repeat('*', greatest(length(normalized_email) - 1, 3));
  end if;

  local_part := split_part(normalized_email, '@', 1);
  domain_part := split_part(normalized_email, '@', 2);

  if local_part = '' then
    return '***@' || domain_part;
  end if;

  return left(local_part, 1) ||
    repeat('*', greatest(length(local_part) - 1, 3)) ||
    '@' ||
    domain_part;
end;
$$;

create or replace function public.get_staff_connection_invite_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  request_row public.staff_salon_connection_requests%rowtype;
  response jsonb;
begin
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
    and request_row.expires_at is not null
    and request_row.expires_at <= now()
  then
    update public.staff_salon_connection_requests
    set status = 'expired',
        updated_at = now()
    where id = request_row.id
    returning * into request_row;
  end if;

  select jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'expires_at', request_row.expires_at,
    'is_expired', coalesce(request_row.expires_at <= now(), false),
    'salon', jsonb_build_object(
      'id', salons.id,
      'name', coalesce(settings.business_name, salons.name),
      'address_line1', coalesce(settings.address_line1, salons.address_line1),
      'address_line2', coalesce(settings.address_line2, salons.address_line2),
      'city', coalesce(settings.city, salons.city),
      'state', coalesce(settings.state, salons.state),
      'postal_code', coalesce(settings.postal_code, salons.postal_code),
      'country', coalesce(settings.country, salons.country),
      'status', salons.status
    ),
    'staff', jsonb_build_object(
      'id', staff.id,
      'display_name', staff.display_name,
      'job_title', staff.job_title,
      'is_active', staff.is_active
    ),
    'target', jsonb_build_object(
      'masked_email', public.mask_staff_connection_email(request_row.target_email_normalized),
      'masked_phone', case when request_row.target_phone_e164 is null then null else '***' || right(request_row.target_phone_e164, 4) end,
      'has_account_target', request_row.account_user_id is not null
    )
  )
  into response
  from public.locations salons
  join public.staff on staff.id = request_row.staff_id
  left join public.salon_settings settings on settings.salon_id = salons.id
  where salons.id = request_row.salon_id;

  return coalesce(response, jsonb_build_object('status', 'invalid'));
end;
$$;

create or replace function public.verify_staff_connection_invite_email(
  p_token text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  normalized_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  request_row public.staff_salon_connection_requests%rowtype;
begin
  if normalized_email = '' then
    return jsonb_build_object(
      'status', 'invalid',
      'email_matches', false,
      'reason', 'Email is required.'
    );
  end if;

  select *
  into request_row
  from public.staff_salon_connection_requests
  where direction = 'salon_invite'
    and token_hash = normalized_hash
  limit 1
  for update;

  if request_row.id is null then
    return jsonb_build_object(
      'status', 'invalid',
      'email_matches', false,
      'reason', 'Invitation link is invalid.'
    );
  end if;

  if request_row.status = 'pending'
    and request_row.expires_at is not null
    and request_row.expires_at <= now()
  then
    update public.staff_salon_connection_requests
    set status = 'expired',
        updated_at = now()
    where id = request_row.id
    returning * into request_row;
  end if;

  if request_row.status <> 'pending' then
    return jsonb_build_object(
      'request_id', request_row.id,
      'status', request_row.status,
      'email_matches', false,
      'reason', 'This invitation is no longer pending.'
    );
  end if;

  if request_row.account_user_id is not null then
    return jsonb_build_object(
      'request_id', request_row.id,
      'status', request_row.status,
      'email_matches', false,
      'requires_existing_account', true,
      'reason', 'This invitation is for an existing Reylumi account.'
    );
  end if;

  if request_row.target_email_normalized is null then
    return jsonb_build_object(
      'request_id', request_row.id,
      'status', request_row.status,
      'email_matches', false,
      'reason', 'This invitation does not include an email target.'
    );
  end if;

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', request_row.status,
    'email_matches', normalized_email = request_row.target_email_normalized,
    'reason', case
      when normalized_email = request_row.target_email_normalized then null
      else 'Email does not match the invited email.'
    end
  );
end;
$$;

grant execute on function public.get_staff_connection_invite_by_token(text) to anon, authenticated;
grant execute on function public.verify_staff_connection_invite_email(text, text) to anon, authenticated;
