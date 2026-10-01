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
      or (
        connection_requests.account_user_id is null
        and current_user_row.email is not null
        and connection_requests.target_email_normalized = lower(btrim(current_user_row.email))
      )
      or (
        connection_requests.account_user_id is null
        and current_user_row.phone is not null
        and connection_requests.target_phone_e164 = regexp_replace(current_user_row.phone, '\s+', '', 'g')
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
      and current_user_row.email is not null
      and requests.target_email_normalized = lower(btrim(current_user_row.email))
    )
    or (
      requests.direction = 'salon_invite'
      and requests.account_user_id is null
      and current_user_row.phone is not null
      and requests.target_phone_e164 = regexp_replace(current_user_row.phone, '\s+', '', 'g')
    )
  order by requests.created_at desc;
end;
$$;
