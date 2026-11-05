-- Generated exact canonical slices; READ-ONLY QA subset. See manifest provenance.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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

create policy "account_security_preferences_self_read"
on public.account_security_preferences
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "account_login_sessions_self_read"
on public.account_login_sessions
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "account_trusted_devices_self_read"
on public.account_trusted_devices
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "account_login_activity_self_read"
on public.account_login_activity
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "account_recovery_codes_self_read"
on public.account_recovery_codes
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "account_recovery_requests_self_read"
on public.account_recovery_requests
for select to authenticated
using (user_id = public.current_public_user_id());

-- QA-only restriction: no mutation grants/policies, support/admin, redemption or recording RPC.
REVOKE ALL ON TABLE public.account_security_preferences FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
REVOKE ALL ON TABLE public.account_login_sessions FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
REVOKE ALL ON TABLE public.account_trusted_devices FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
REVOKE ALL ON TABLE public.account_login_activity FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
REVOKE ALL ON TABLE public.account_recovery_codes FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
REVOKE ALL ON TABLE public.account_recovery_requests FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
REVOKE ALL ON TABLE public.account_recovery_request_events FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
GRANT SELECT(user_id,recovery_email,recovery_phone,login_alerts_enabled,sms_login_alerts_enabled,updated_at) ON TABLE public.account_security_preferences TO authenticated;
GRANT SELECT(id,user_id,auth_user_id,device_label,browser_name,os_name,device_type,city,region,country,location_label,user_agent,trusted_at,revoked_at,last_seen_at,created_at) ON TABLE public.account_login_sessions TO authenticated;
GRANT SELECT(id,user_id,device_label,browser_name,os_name,device_type,location_label,trusted_at,last_seen_at,created_at,removed_at) ON TABLE public.account_trusted_devices TO authenticated;
GRANT SELECT(id,user_id,activity_type,device_label,browser_name,os_name,location_label,metadata,created_at) ON TABLE public.account_login_activity TO authenticated;
GRANT SELECT(id,user_id,used_at,created_at,revoked_at) ON TABLE public.account_recovery_codes TO authenticated;
GRANT SELECT(id,user_id,request_type,status,contact_email,contact_phone,details,created_at,updated_at) ON TABLE public.account_recovery_requests TO authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
CREATE TABLE qa_bootstrap.security_read_contract(id boolean PRIMARY KEY CHECK(id),scope text NOT NULL CHECK(scope='canonical-security-read-only'));
INSERT INTO qa_bootstrap.security_read_contract VALUES(true,'canonical-security-read-only');
REVOKE ALL ON TABLE qa_bootstrap.security_read_contract FROM PUBLIC,anon,authenticated,service_role,qr_menu_qa_runtime;
