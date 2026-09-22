create table if not exists public.account_security_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  recovery_email text,
  recovery_phone text,
  login_alerts_enabled boolean not null default true,
  sms_login_alerts_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_security_preferences
  add column if not exists sms_login_alerts_enabled boolean not null default true;

drop trigger if exists set_account_security_preferences_updated_at
on public.account_security_preferences;

create trigger set_account_security_preferences_updated_at
before update on public.account_security_preferences
for each row execute function public.set_updated_at();

alter table public.account_security_preferences enable row level security;

create table if not exists public.account_login_sessions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  auth_user_id uuid,
  device_label text not null default 'Unknown device',
  browser_name text,
  os_name text,
  device_type text not null default 'unknown',
  ip_address inet,
  city text,
  region text,
  country text,
  location_label text not null default 'Unknown location',
  user_agent text,
  trusted_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.users(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_login_sessions_device_type_check
    check (device_type in ('desktop', 'mobile', 'tablet', 'unknown'))
);

create index if not exists account_login_sessions_user_active_idx
on public.account_login_sessions(user_id, last_seen_at desc)
where revoked_at is null;

create index if not exists account_login_sessions_auth_user_idx
on public.account_login_sessions(auth_user_id)
where auth_user_id is not null;

drop trigger if exists set_account_login_sessions_updated_at
on public.account_login_sessions;

create trigger set_account_login_sessions_updated_at
before update on public.account_login_sessions
for each row execute function public.set_updated_at();

alter table public.account_login_sessions enable row level security;

create table if not exists public.account_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  login_session_id uuid references public.account_login_sessions(id) on delete set null,
  device_label text not null default 'Unknown device',
  browser_name text,
  os_name text,
  device_type text not null default 'unknown',
  location_label text not null default 'Unknown location',
  trusted_at timestamptz not null default now(),
  last_seen_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_trusted_devices_device_type_check
    check (device_type in ('desktop', 'mobile', 'tablet', 'unknown'))
);

create index if not exists account_trusted_devices_user_active_idx
on public.account_trusted_devices(user_id, trusted_at desc)
where removed_at is null;

create index if not exists account_trusted_devices_session_idx
on public.account_trusted_devices(login_session_id)
where login_session_id is not null;

drop trigger if exists set_account_trusted_devices_updated_at
on public.account_trusted_devices;

create trigger set_account_trusted_devices_updated_at
before update on public.account_trusted_devices
for each row execute function public.set_updated_at();

alter table public.account_trusted_devices enable row level security;

create table if not exists public.account_login_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  login_session_id uuid references public.account_login_sessions(id) on delete set null,
  activity_type text not null,
  device_label text,
  browser_name text,
  os_name text,
  device_type text not null default 'unknown',
  ip_address inet,
  city text,
  region text,
  country text,
  location_label text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_login_activity_device_type_check
    check (device_type in ('desktop', 'mobile', 'tablet', 'unknown'))
);

create index if not exists account_login_activity_user_created_idx
on public.account_login_activity(user_id, created_at desc);

alter table public.account_login_activity enable row level security;

create table if not exists public.account_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  code_digest text not null,
  code_hint text,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, code_digest)
);

create index if not exists account_recovery_codes_user_active_idx
on public.account_recovery_codes(user_id, created_at desc)
where revoked_at is null;

alter table public.account_recovery_codes enable row level security;

create table if not exists public.account_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  request_type text not null,
  status text not null default 'open',
  priority text not null default 'normal',
  risk_level text not null default 'unknown',
  assigned_to_user_id uuid references public.users(id) on delete set null,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_summary text,
  contact_email text,
  contact_phone text,
  details text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_recovery_requests_type_check
    check (request_type in ('lost_access', 'lost_device', 'account_compromised', 'secure_account')),
  constraint account_recovery_requests_status_check
    check (status in ('open', 'reviewing', 'needs_info', 'approved', 'denied', 'resolved', 'cancelled')),
  constraint account_recovery_requests_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint account_recovery_requests_risk_level_check
    check (risk_level in ('unknown', 'low', 'medium', 'high', 'critical'))
);

alter table public.account_recovery_requests
  add column if not exists priority text not null default 'normal',
  add column if not exists risk_level text not null default 'unknown',
  add column if not exists assigned_to_user_id uuid references public.users(id) on delete set null,
  add column if not exists reviewed_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists resolved_by_user_id uuid references public.users(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_summary text;

alter table public.account_recovery_requests
  drop constraint if exists account_recovery_requests_status_check,
  drop constraint if exists account_recovery_requests_priority_check,
  drop constraint if exists account_recovery_requests_risk_level_check;

alter table public.account_recovery_requests
  add constraint account_recovery_requests_status_check
    check (status in ('open', 'reviewing', 'needs_info', 'approved', 'denied', 'resolved', 'cancelled')),
  add constraint account_recovery_requests_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  add constraint account_recovery_requests_risk_level_check
    check (risk_level in ('unknown', 'low', 'medium', 'high', 'critical'));

create index if not exists account_recovery_requests_user_created_idx
on public.account_recovery_requests(user_id, created_at desc);

drop trigger if exists set_account_recovery_requests_updated_at
on public.account_recovery_requests;

create trigger set_account_recovery_requests_updated_at
before update on public.account_recovery_requests
for each row execute function public.set_updated_at();

alter table public.account_recovery_requests enable row level security;

create table if not exists public.account_recovery_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_recovery_requests(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint account_recovery_request_events_type_check
    check (
      event_type in (
        'created',
        'status_changed',
        'note_added',
        'account_secured',
        'account_suspended',
        'account_restored'
      )
    )
);

create index if not exists account_recovery_request_events_request_idx
on public.account_recovery_request_events(request_id, created_at desc);

alter table public.account_recovery_request_events enable row level security;

drop policy if exists "account_security_preferences_self_read"
on public.account_security_preferences;
create policy "account_security_preferences_self_read"
on public.account_security_preferences
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_security_preferences_self_insert"
on public.account_security_preferences;
create policy "account_security_preferences_self_insert"
on public.account_security_preferences
for insert to authenticated
with check (user_id = public.current_public_user_id());

drop policy if exists "account_security_preferences_self_update"
on public.account_security_preferences;
create policy "account_security_preferences_self_update"
on public.account_security_preferences
for update to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

drop policy if exists "account_security_preferences_support_read"
on public.account_security_preferences;
create policy "account_security_preferences_support_read"
on public.account_security_preferences
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_login_sessions_self_read"
on public.account_login_sessions;
create policy "account_login_sessions_self_read"
on public.account_login_sessions
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_login_sessions_support_read"
on public.account_login_sessions;
create policy "account_login_sessions_support_read"
on public.account_login_sessions
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_login_sessions_self_insert"
on public.account_login_sessions;
create policy "account_login_sessions_self_insert"
on public.account_login_sessions
for insert to authenticated
with check (user_id = public.current_public_user_id());

drop policy if exists "account_login_sessions_self_update"
on public.account_login_sessions;
create policy "account_login_sessions_self_update"
on public.account_login_sessions
for update to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

drop policy if exists "account_trusted_devices_self_read"
on public.account_trusted_devices;
create policy "account_trusted_devices_self_read"
on public.account_trusted_devices
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_trusted_devices_support_read"
on public.account_trusted_devices;
create policy "account_trusted_devices_support_read"
on public.account_trusted_devices
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_trusted_devices_self_insert"
on public.account_trusted_devices;
create policy "account_trusted_devices_self_insert"
on public.account_trusted_devices
for insert to authenticated
with check (user_id = public.current_public_user_id());

drop policy if exists "account_trusted_devices_self_update"
on public.account_trusted_devices;
create policy "account_trusted_devices_self_update"
on public.account_trusted_devices
for update to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

drop policy if exists "account_login_activity_self_read"
on public.account_login_activity;
create policy "account_login_activity_self_read"
on public.account_login_activity
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_login_activity_support_read"
on public.account_login_activity;
create policy "account_login_activity_support_read"
on public.account_login_activity
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_login_activity_self_insert"
on public.account_login_activity;
create policy "account_login_activity_self_insert"
on public.account_login_activity
for insert to authenticated
with check (user_id = public.current_public_user_id());

drop policy if exists "account_recovery_codes_self_read"
on public.account_recovery_codes;
create policy "account_recovery_codes_self_read"
on public.account_recovery_codes
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_recovery_codes_self_insert"
on public.account_recovery_codes;
create policy "account_recovery_codes_self_insert"
on public.account_recovery_codes
for insert to authenticated
with check (user_id = public.current_public_user_id());

drop policy if exists "account_recovery_codes_self_update"
on public.account_recovery_codes;
create policy "account_recovery_codes_self_update"
on public.account_recovery_codes
for update to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

drop policy if exists "account_recovery_requests_self_read"
on public.account_recovery_requests;
create policy "account_recovery_requests_self_read"
on public.account_recovery_requests
for select to authenticated
using (user_id = public.current_public_user_id());

drop policy if exists "account_recovery_requests_support_read"
on public.account_recovery_requests;
create policy "account_recovery_requests_support_read"
on public.account_recovery_requests
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_recovery_requests_self_insert"
on public.account_recovery_requests;
create policy "account_recovery_requests_self_insert"
on public.account_recovery_requests
for insert to authenticated
with check (user_id = public.current_public_user_id());

drop policy if exists "account_recovery_requests_self_update"
on public.account_recovery_requests;
drop policy if exists "account_recovery_requests_self_cancel"
on public.account_recovery_requests;
create policy "account_recovery_requests_self_cancel"
on public.account_recovery_requests
for update to authenticated
using (user_id = public.current_public_user_id())
with check (
  user_id = public.current_public_user_id()
  and status = 'cancelled'
);

drop policy if exists "account_recovery_requests_support_update"
on public.account_recovery_requests;
create policy "account_recovery_requests_support_update"
on public.account_recovery_requests
for update to authenticated
using (public.lifecycle_current_user_is_support_admin())
with check (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_recovery_request_events_support_read"
on public.account_recovery_request_events;
create policy "account_recovery_request_events_support_read"
on public.account_recovery_request_events
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

drop policy if exists "account_recovery_request_events_support_insert"
on public.account_recovery_request_events;
create policy "account_recovery_request_events_support_insert"
on public.account_recovery_request_events
for insert to authenticated
with check (public.lifecycle_current_user_is_support_admin());

drop policy if exists "users_support_read_recovery_cases"
on public.users;
create policy "users_support_read_recovery_cases"
on public.users
for select to authenticated
using (public.lifecycle_current_user_is_support_admin());

create or replace function public.redeem_account_recovery_code(
  p_account_identifier text,
  p_code_digest text,
  p_contact_email text,
  p_contact_phone text,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_identifier text := lower(left(btrim(coalesce(p_account_identifier, '')), 320));
  safe_code_digest text := lower(left(btrim(coalesce(p_code_digest, '')), 128));
  safe_contact_email text := nullif(lower(left(btrim(coalesce(p_contact_email, '')), 320)), '');
  safe_contact_phone text := nullif(left(btrim(coalesce(p_contact_phone, '')), 40), '');
  safe_details text := nullif(left(btrim(coalesce(p_details, '')), 2000), '');
  target_user_id uuid;
  recovery_code_id uuid;
  recovery_request_id uuid;
begin
  if safe_identifier = '' or safe_code_digest = '' then
    return jsonb_build_object('submitted', true, 'accepted', false);
  end if;

  select users.id
  into target_user_id
  from public.users users
  where lower(coalesce(users.email, '')) = safe_identifier
     or coalesce(users.phone, '') = safe_identifier
  order by users.created_at asc
  limit 1;

  if target_user_id is null then
    return jsonb_build_object('submitted', true, 'accepted', false);
  end if;

  select codes.id
  into recovery_code_id
  from public.account_recovery_codes codes
  where codes.user_id = target_user_id
    and codes.code_digest = safe_code_digest
    and codes.used_at is null
    and codes.revoked_at is null
  order by codes.created_at asc
  limit 1
  for update;

  if recovery_code_id is null then
    return jsonb_build_object('submitted', true, 'accepted', false);
  end if;

  update public.account_recovery_codes
  set used_at = now()
  where id = recovery_code_id;

  insert into public.account_recovery_requests (
    user_id,
    request_type,
    status,
    priority,
    risk_level,
    contact_email,
    contact_phone,
    details
  )
  values (
    target_user_id,
    'lost_access',
    'reviewing',
    'high',
    'medium',
    safe_contact_email,
    safe_contact_phone,
    safe_details
  )
  returning id into recovery_request_id;

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    recovery_request_id,
    null,
    'created',
    null,
    'reviewing',
    'Recovery code verified from the public account recovery form.',
    jsonb_build_object(
      'verified_recovery_code', true,
      'recovery_code_id', recovery_code_id
    )
  );

  insert into public.account_login_activity (
    user_id,
    activity_type,
    metadata
  )
  values (
    target_user_id,
    'recovery_code_redeemed',
    jsonb_build_object(
      'request_id', recovery_request_id,
      'recovery_code_id', recovery_code_id,
      'source', 'public_account_recovery_form'
    )
  );

  return jsonb_build_object(
    'submitted', true,
    'accepted', true,
    'request_id', recovery_request_id
  );
end;
$$;

create or replace function public.account_login_security_safe_inet(p_value text)
returns inet
language plpgsql
immutable
as $$
begin
  return nullif(left(btrim(coalesce(p_value, '')), 128), '')::inet;
exception
  when others then
    return null;
end;
$$;

create or replace function public.record_account_login_session(
  p_session_id uuid,
  p_device_label text,
  p_browser_name text,
  p_os_name text,
  p_device_type text,
  p_city text,
  p_region text,
  p_country text,
  p_location_label text,
  p_user_agent text,
  p_ip_address text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  actor_user_id uuid := public.current_public_user_id();
  alerts_enabled boolean := true;
  normalized_device_type text :=
    case
      when p_device_type in ('desktop', 'mobile', 'tablet', 'unknown') then p_device_type
      else 'unknown'
    end;
  safe_location_label text :=
    coalesce(nullif(left(btrim(coalesce(p_location_label, '')), 160), ''), 'Unknown location');
  safe_device_label text :=
    coalesce(nullif(left(btrim(coalesce(p_device_label, '')), 160), ''), 'Unknown device');
begin
  if actor_auth_user_id is null or actor_user_id is null then
    raise exception 'Authenticated user is required.';
  end if;

  insert into public.account_security_preferences (user_id)
  values (actor_user_id)
  on conflict (user_id) do nothing;

  insert into public.account_login_sessions (
    id,
    user_id,
    auth_user_id,
    device_label,
    browser_name,
    os_name,
    device_type,
    ip_address,
    city,
    region,
    country,
    location_label,
    user_agent,
    last_seen_at
  )
  values (
    p_session_id,
    actor_user_id,
    actor_auth_user_id,
    safe_device_label,
    nullif(left(btrim(coalesce(p_browser_name, '')), 80), ''),
    nullif(left(btrim(coalesce(p_os_name, '')), 80), ''),
    normalized_device_type,
    public.account_login_security_safe_inet(p_ip_address),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    nullif(left(btrim(coalesce(p_region, '')), 80), ''),
    nullif(left(btrim(coalesce(p_country, '')), 80), ''),
    safe_location_label,
    nullif(left(coalesce(p_user_agent, ''), 700), ''),
    now()
  )
  on conflict (id) do update
  set device_label = excluded.device_label,
      browser_name = excluded.browser_name,
      os_name = excluded.os_name,
      device_type = excluded.device_type,
      ip_address = excluded.ip_address,
      city = excluded.city,
      region = excluded.region,
      country = excluded.country,
      location_label = excluded.location_label,
      user_agent = excluded.user_agent,
      last_seen_at = now(),
      revoked_at = null,
      revoked_by_user_id = null,
      updated_at = now()
  where account_login_sessions.user_id = actor_user_id;

  insert into public.account_login_activity (
    user_id,
    login_session_id,
    activity_type,
    device_label,
    browser_name,
    os_name,
    device_type,
    ip_address,
    city,
    region,
    country,
    location_label,
    user_agent,
    metadata
  )
  values (
    actor_user_id,
    p_session_id,
    'login_success',
    safe_device_label,
    nullif(left(btrim(coalesce(p_browser_name, '')), 80), ''),
    nullif(left(btrim(coalesce(p_os_name, '')), 80), ''),
    normalized_device_type,
    public.account_login_security_safe_inet(p_ip_address),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    nullif(left(btrim(coalesce(p_region, '')), 80), ''),
    nullif(left(btrim(coalesce(p_country, '')), 80), ''),
    safe_location_label,
    nullif(left(coalesce(p_user_agent, ''), 700), ''),
    jsonb_build_object('source', 'credential_login')
  );

  update public.users
  set last_login_at = now(),
      updated_at = now()
  where id = actor_user_id;

  select coalesce(preferences.login_alerts_enabled, true)
  into alerts_enabled
  from public.account_security_preferences preferences
  where preferences.user_id = actor_user_id;

  if alerts_enabled then
    insert into public.app_notifications (
      recipient_user_id,
      recipient_kind,
      notification_type,
      title,
      body,
      href,
      event_key
    )
    values (
      actor_user_id,
      'customer',
      'login_alert',
      'New login',
      safe_device_label || ' near ' || safe_location_label || '.',
      '/settings/login-security#activity',
      'login-alert:' || p_session_id::text
    )
    on conflict (recipient_user_id, event_key) where event_key is not null do update
    set notification_type = excluded.notification_type,
        title = excluded.title,
        body = excluded.body,
        href = excluded.href,
        read_at = null,
        updated_at = now();
  end if;

  return jsonb_build_object(
    'session_id', p_session_id,
    'login_alert_created', alerts_enabled
  );
end;
$$;

create or replace function public.account_recovery_support_update_request(
  p_request_id uuid,
  p_status text,
  p_priority text,
  p_risk_level text,
  p_note text,
  p_resolution_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  request_row public.account_recovery_requests%rowtype;
  next_status text :=
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'reviewing');
  next_priority text :=
    coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  next_risk_level text :=
    coalesce(nullif(btrim(coalesce(p_risk_level, '')), ''), 'unknown');
  safe_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  safe_resolution text :=
    nullif(left(btrim(coalesce(p_resolution_summary, '')), 2000), '');
begin
  if actor_user_id is null or not public.lifecycle_current_user_is_support_admin() then
    raise exception 'Recovery support permission is required.';
  end if;

  if next_status not in ('open', 'reviewing', 'needs_info', 'approved', 'denied', 'resolved', 'cancelled') then
    raise exception 'Unsupported recovery request status.';
  end if;

  if next_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Unsupported recovery request priority.';
  end if;

  if next_risk_level not in ('unknown', 'low', 'medium', 'high', 'critical') then
    raise exception 'Unsupported recovery request risk level.';
  end if;

  select *
  into request_row
  from public.account_recovery_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Recovery request was not found.';
  end if;

  update public.account_recovery_requests
  set status = next_status,
      priority = next_priority,
      risk_level = next_risk_level,
      assigned_to_user_id = coalesce(assigned_to_user_id, actor_user_id),
      reviewed_by_user_id = actor_user_id,
      reviewed_at = coalesce(reviewed_at, now()),
      resolved_by_user_id =
        case
          when next_status in ('approved', 'denied', 'resolved', 'cancelled') then actor_user_id
          else resolved_by_user_id
        end,
      resolved_at =
        case
          when next_status in ('approved', 'denied', 'resolved', 'cancelled') then now()
          else resolved_at
        end,
      resolution_summary =
        case
          when safe_resolution is not null then safe_resolution
          else resolution_summary
        end,
      updated_at = now()
  where id = request_row.id;

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    request_row.id,
    actor_user_id,
    case
      when request_row.status is distinct from next_status then 'status_changed'
      else 'note_added'
    end,
    request_row.status,
    next_status,
    safe_note,
    jsonb_build_object(
      'priority', next_priority,
      'risk_level', next_risk_level,
      'resolution_summary_updated', safe_resolution is not null
    )
  );

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', next_status
  );
end;
$$;

create or replace function public.account_recovery_support_secure_account(
  p_request_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  request_row public.account_recovery_requests%rowtype;
  safe_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  revoked_session_count integer := 0;
  removed_device_count integer := 0;
begin
  if actor_user_id is null or not public.lifecycle_current_user_is_support_admin() then
    raise exception 'Recovery support permission is required.';
  end if;

  select *
  into request_row
  from public.account_recovery_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Recovery request was not found.';
  end if;

  update public.account_login_sessions
  set revoked_at = now(),
      revoked_by_user_id = actor_user_id,
      updated_at = now()
  where user_id = request_row.user_id
    and revoked_at is null;

  get diagnostics revoked_session_count = row_count;

  update public.account_trusted_devices
  set removed_at = now(),
      updated_at = now()
  where user_id = request_row.user_id
    and removed_at is null;

  get diagnostics removed_device_count = row_count;

  insert into public.account_login_activity (
    user_id,
    activity_type,
    metadata
  )
  values (
    request_row.user_id,
    'support_account_secured',
    jsonb_build_object(
      'request_id', request_row.id,
      'actor_user_id', actor_user_id,
      'revoked_session_count', revoked_session_count,
      'removed_device_count', removed_device_count
    )
  );

  update public.account_recovery_requests
  set status = 'reviewing',
      priority = case when priority = 'urgent' then priority else 'high' end,
      risk_level = case when risk_level = 'critical' then risk_level else 'high' end,
      assigned_to_user_id = coalesce(assigned_to_user_id, actor_user_id),
      reviewed_by_user_id = actor_user_id,
      reviewed_at = coalesce(reviewed_at, now()),
      updated_at = now()
  where id = request_row.id;

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    request_row.id,
    actor_user_id,
    'account_secured',
    request_row.status,
    'reviewing',
    safe_note,
    jsonb_build_object(
      'revoked_session_count', revoked_session_count,
      'removed_device_count', removed_device_count
    )
  );

  return jsonb_build_object(
    'removed_device_count', removed_device_count,
    'revoked_session_count', revoked_session_count,
    'status', 'reviewing'
  );
end;
$$;

create or replace function public.account_recovery_support_update_user_status(
  p_request_id uuid,
  p_status text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  request_row public.account_recovery_requests%rowtype;
  safe_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  next_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if actor_user_id is null or not public.lifecycle_current_user_is_support_admin() then
    raise exception 'Recovery support permission is required.';
  end if;

  if next_status not in ('active', 'suspended') then
    raise exception 'Only active or suspended account status can be set from recovery support.';
  end if;

  select *
  into request_row
  from public.account_recovery_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Recovery request was not found.';
  end if;

  update public.users
  set status = next_status,
      updated_at = now()
  where id = request_row.user_id
    and status in ('active', 'suspended');

  insert into public.account_login_activity (
    user_id,
    activity_type,
    metadata
  )
  values (
    request_row.user_id,
    'support_account_status_updated',
    jsonb_build_object(
      'actor_user_id', actor_user_id,
      'request_id', request_row.id,
      'status', next_status
    )
  );

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    request_row.id,
    actor_user_id,
    case when next_status = 'suspended' then 'account_suspended' else 'account_restored' end,
    request_row.status,
    request_row.status,
    safe_note,
    jsonb_build_object('user_status', next_status)
  );

  return jsonb_build_object(
    'request_id', request_row.id,
    'user_status', next_status
  );
end;
$$;

grant select, insert, update on table public.account_security_preferences
to authenticated;
grant select, insert, update on table public.account_login_sessions
to authenticated;
grant select, insert, update on table public.account_trusted_devices
to authenticated;
grant select, insert on table public.account_login_activity
to authenticated;
grant select, insert, update on table public.account_recovery_codes
to authenticated;
grant select, insert, update on table public.account_recovery_requests
to authenticated;
grant select, insert on table public.account_recovery_request_events
to authenticated;
grant select on table public.users
to authenticated;

grant execute on function public.record_account_login_session(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

grant execute on function public.redeem_account_recovery_code(
  text,
  text,
  text,
  text,
  text
) to anon, authenticated;

grant execute on function public.account_recovery_support_update_request(
  uuid,
  text,
  text,
  text,
  text,
  text
) to authenticated;
grant execute on function public.account_recovery_support_secure_account(
  uuid,
  text
) to authenticated;
grant execute on function public.account_recovery_support_update_user_status(
  uuid,
  text,
  text
) to authenticated;
