create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create table public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text,
  phone text,
  display_name text,
  first_name text,
  last_name text,
  avatar_url text,
  language text not null default 'en',
  timezone text not null default 'America/Chicago',
  status text not null default 'active',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  latitude double precision,
  longitude double precision,
  geocoded_at timestamptz,
  geocoding_address_fingerprint text,
  geocoding_error_code text,
  geocoding_place_id text,
  geocoding_provider text,
  geocoding_status text,
  create_request_key text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, code)
);
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  category text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (role_id, permission_id)
);
create table public.account_memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid references public.roles(id) on delete set null,
  status text not null default 'active',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, user_id)
);
create table public.salon_memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid references public.roles(id) on delete set null,
  status text not null default 'active',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  account_user_id uuid references public.users(id) on delete set null,
  user_id uuid,
  display_name text not null,
  first_name text,
  last_name text,
  phone text,
  email text,
  job_title text,
  public_profile_photo_path text,
  public_bio text,
  public_profile_visible boolean not null default false,
  owner_public_enabled boolean not null default false,
  staff_public_consent_status text not null default 'not_requested',
  online_booking_enabled boolean not null default false,
  profile_display_order integer not null default 0,
  salon_profile_content_posting_enabled boolean not null default false,
  specialties text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.salon_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references public.locations(id) on delete cascade,
  business_name text not null,
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  business_description text,
  allow_staff_applications boolean not null default false,
  public_discovery_enabled boolean not null default false,
  public_discovery_published_at timestamptz,
  public_profile_tagline text,
  public_profile_story text,
  public_profile_logo_path text,
  public_profile_cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.users
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_scheduled_for timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists anonymized_at timestamptz;
alter table public.users
  add column if not exists deletion_finalization_started_at timestamptz,
  add column if not exists deletion_finalized_at timestamptz,
  add column if not exists deletion_finalization_attempts integer not null default 0,
  add column if not exists deletion_finalization_failed_at timestamptz,
  add column if not exists deletion_finalization_error text;
create table if not exists public.deleted_auth_identities (
  auth_user_id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();
create trigger set_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();
create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();
create trigger set_roles_updated_at
before update on public.roles
for each row execute function public.set_updated_at();
create trigger set_permissions_updated_at
before update on public.permissions
for each row execute function public.set_updated_at();
create trigger set_account_memberships_updated_at
before update on public.account_memberships
for each row execute function public.set_updated_at();
create trigger set_salon_memberships_updated_at
before update on public.salon_memberships
for each row execute function public.set_updated_at();
create trigger set_staff_updated_at
before update on public.staff
for each row execute function public.set_updated_at();
create trigger set_salon_settings_updated_at
before update on public.salon_settings
for each row execute function public.set_updated_at();
-- These three objects remain explicit synthetic Market review/finance/media fixtures.
CREATE SCHEMA qa_bootstrap;REVOKE ALL ON SCHEMA qa_bootstrap FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE qa_bootstrap.marker(id boolean PRIMARY KEY CHECK(id),scope text NOT NULL CHECK(scope='synthetic-canonical-context'));
INSERT INTO qa_bootstrap.marker VALUES(true,'synthetic-canonical-context');
CREATE SCHEMA market_private;REVOKE ALL ON SCHEMA market_private FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE market_private.reviewers(user_id uuid PRIMARY KEY REFERENCES public.users(id),active boolean NOT NULL DEFAULT true);
CREATE TABLE qa_bootstrap.financial_admins(user_id uuid PRIMARY KEY REFERENCES public.users(id));
CREATE TABLE public.salon_profile_media_assets(id uuid PRIMARY KEY,salon_id uuid NOT NULL REFERENCES public.locations(id),bucket text,object_path text,purpose text,mime_type text,processed_bytes bigint,status text,deleted_at timestamptz,quarantined_at timestamptz);
