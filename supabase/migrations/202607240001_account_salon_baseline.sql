create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

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

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

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

create index locations_account_id_idx on public.locations(account_id);
create unique index locations_account_create_request_key_idx
on public.locations(account_id, create_request_key)
where create_request_key is not null;

create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

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

create trigger set_roles_updated_at
before update on public.roles
for each row execute function public.set_updated_at();

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

create trigger set_permissions_updated_at
before update on public.permissions
for each row execute function public.set_updated_at();

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

create trigger set_account_memberships_updated_at
before update on public.account_memberships
for each row execute function public.set_updated_at();

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

create index salon_memberships_account_id_idx on public.salon_memberships(account_id);
create index salon_memberships_user_id_idx on public.salon_memberships(user_id);

create trigger set_salon_memberships_updated_at
before update on public.salon_memberships
for each row execute function public.set_updated_at();

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  customer_user_id uuid references public.users(id) on delete set null,
  name text not null,
  phone text,
  email text,
  notes text,
  staff_notes text,
  internal_notes text,
  source text not null default 'manual',
  status text not null default 'active',
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_location_id_idx on public.customers(location_id);
create index customers_customer_user_id_idx
on public.customers(customer_user_id)
where customer_user_id is not null;

create trigger set_customers_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

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

create index staff_salon_id_idx on public.staff(salon_id);
create index staff_account_user_id_idx on public.staff(account_user_id);

create trigger set_staff_updated_at
before update on public.staff
for each row execute function public.set_updated_at();

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  category text,
  base_price numeric(12,2) not null default 0,
  duration_minutes integer not null default 30,
  description text,
  is_active boolean not null default true,
  online_booking_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_salon_id_idx on public.services(salon_id);

create trigger set_services_updated_at
before update on public.services
for each row execute function public.set_updated_at();

create table public.service_add_on_links (
  id uuid primary key default gen_random_uuid(),
  parent_service_id uuid not null references public.services(id) on delete cascade,
  add_on_service_id uuid not null references public.services(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_service_id, add_on_service_id)
);

create trigger set_service_add_on_links_updated_at
before update on public.service_add_on_links
for each row execute function public.set_updated_at();

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

create trigger set_salon_settings_updated_at
before update on public.salon_settings
for each row execute function public.set_updated_at();

create table public.booking_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references public.locations(id) on delete cascade,
  booking_enabled boolean not null default false,
  online_booking_visible boolean not null default false,
  confirmation_mode text not null default 'request_confirmation',
  minimum_lead_time_minutes integer not null default 120,
  maximum_advance_window_days integer not null default 60,
  slot_interval_minutes integer not null default 15,
  default_cleanup_buffer_minutes integer not null default 0,
  same_day_booking_enabled boolean not null default false,
  cancellation_window_minutes integer not null default 1440,
  late_cancellation_policy jsonb not null default '{}'::jsonb,
  no_show_policy jsonb not null default '{}'::jsonb,
  any_professional_enabled boolean not null default false,
  split_staff_appointment_enabled boolean not null default false,
  guest_booking_enabled boolean not null default true,
  timezone_iana text not null default 'America/Chicago',
  ticket_creation_mode text not null default 'manual',
  payment_required_enabled boolean not null default false,
  deposit_required_enabled boolean not null default false,
  deposit_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_booking_settings_updated_at
before update on public.booking_settings
for each row execute function public.set_updated_at();

create table public.staff_service_assignments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  is_active boolean not null default true,
  online_bookable boolean not null default true,
  custom_duration_minutes integer,
  custom_price numeric(12,2),
  effective_start_date date,
  effective_end_date date,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, service_id)
);

create trigger set_staff_service_assignments_updated_at
before update on public.staff_service_assignments
for each row execute function public.set_updated_at();

create table public.staff_availability_rules (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  rule_type text not null default 'working',
  day_of_week integer not null,
  starts_at_local time not null,
  ends_at_local time not null,
  timezone_iana text not null default 'America/Chicago',
  effective_start_date date,
  effective_end_date date,
  is_active boolean not null default true,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_staff_availability_rules_updated_at
before update on public.staff_availability_rules
for each row execute function public.set_updated_at();

create table public.staff_time_blocks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  block_type text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone_iana text not null default 'America/Chicago',
  reason text,
  created_by_user_id uuid references public.users(id) on delete set null,
  is_active boolean not null default true,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_staff_time_blocks_updated_at
before update on public.staff_time_blocks
for each row execute function public.set_updated_at();

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  customer_user_id uuid references public.users(id) on delete set null,
  customer_account_linked_at timestamptz,
  customer_account_linked_by_user_id uuid references public.users(id) on delete set null,
  customer_account_link_method text,
  customer_account_link_metadata jsonb not null default '{}'::jsonb,
  staff_id uuid references public.staff(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  notes text,
  public_notes text,
  internal_notes text,
  status text not null default 'pending',
  source text not null default 'owner_manual',
  confirmation_mode text not null default 'request_confirmation',
  confirmation_status text not null default 'requested',
  salon_timezone_snapshot text not null default 'America/Chicago',
  customer_cancellation_token_hash text,
  pos_ticket_id uuid,
  source_reference_type text,
  source_reference_id uuid,
  idempotency_key text,
  cancellation_reason text,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.users(id) on delete set null,
  no_show_at timestamptz,
  no_show_by_user_id uuid references public.users(id) on delete set null,
  no_show_reason text,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  payment_status text not null default 'not_required',
  deposit_policy_snapshot jsonb not null default '{}'::jsonb,
  cancellation_policy_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_customer_account_link_method_check check (
    customer_account_link_method is null
    or customer_account_link_method in (
      'authenticated_booking',
      'guest_manage_claim',
      'contact_verification_claim',
      'manual_account_link',
      'system_backfill'
    )
  )
);

create index bookings_salon_start_idx on public.bookings(salon_id, start_at);
create index bookings_customer_user_start_idx
on public.bookings(customer_user_id, start_at desc, id)
where customer_user_id is not null;
create index bookings_customer_account_linked_at_idx
on public.bookings(customer_account_linked_at desc)
where customer_account_linked_at is not null;

create trigger set_bookings_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

create table public.booking_lines (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  parent_booking_line_id uuid references public.booking_lines(id) on delete set null,
  line_type text not null default 'service',
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  service_category_snapshot text,
  service_description_snapshot text,
  unit_price numeric(12,2) not null default 0,
  quantity numeric(12,2) not null default 1,
  line_total numeric(12,2) not null default 0,
  duration_minutes integer not null default 30,
  cleanup_buffer_minutes integer not null default 0,
  display_order integer not null default 0,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  line_status text not null default 'scheduled',
  started_at timestamptz,
  completed_at timestamptz,
  performed_by_staff_id uuid references public.staff(id) on delete set null,
  service_note text,
  internal_staff_note text,
  line_status_updated_at timestamptz,
  line_status_updated_by_user_id uuid references public.users(id) on delete set null,
  overbooking_override_reason text,
  overbooking_override_by_user_id uuid references public.users(id) on delete set null,
  overbooking_override_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_booking_lines_updated_at
before update on public.booking_lines
for each row execute function public.set_updated_at();

create table public.booking_status_events (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_staff_id uuid references public.staff(id) on delete set null,
  actor_source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.booking_customer_account_claims (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete cascade,
  claim_method text not null,
  proof_type text not null,
  claim_status text not null default 'linked',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_customer_account_claims_method_check check (
    claim_method in ('guest_manage_claim', 'contact_verification_claim')
  ),
  constraint booking_customer_account_claims_proof_type_check check (
    proof_type in ('guest_manage_token', 'contact_magic_link', 'contact_otp')
  ),
  constraint booking_customer_account_claims_status_check check (
    claim_status in ('linked', 'idempotent')
  )
);

create unique index booking_customer_account_claims_user_method_uidx
on public.booking_customer_account_claims(booking_id, customer_user_id, claim_method);
create index booking_customer_account_claims_user_created_idx
on public.booking_customer_account_claims(customer_user_id, created_at desc);
create index booking_customer_account_claims_salon_created_idx
on public.booking_customer_account_claims(salon_id, created_at desc);

create table public.pos_tickets (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  source_booking_id uuid references public.bookings(id) on delete set null,
  ticket_number text not null default '',
  ticket_sequence integer not null default 0,
  customer_id uuid references public.customers(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'open',
  discount_type text not null default 'fixed_amount',
  discount_value numeric(12,2) not null default 0,
  tax_rate numeric(8,4) not null default 0,
  tip_type text not null default 'fixed_amount',
  tip_value numeric(12,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pos_tickets_salon_opened_idx on public.pos_tickets(salon_id, opened_at);

create trigger set_pos_tickets_updated_at
before update on public.pos_tickets
for each row execute function public.set_updated_at();

alter table public.bookings
add constraint bookings_pos_ticket_id_fkey
foreign key (pos_ticket_id) references public.pos_tickets(id) on delete set null;

create table public.pos_ticket_items (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  pos_ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  performed_by_staff_id uuid references public.staff(id) on delete set null,
  source_booking_id uuid references public.bookings(id) on delete set null,
  source_booking_line_id uuid references public.booking_lines(id) on delete set null,
  source_kind text not null default 'manual',
  service_name_snapshot text,
  service_category_snapshot text,
  booked_unit_price_snapshot numeric(12,2),
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  notes text,
  is_removed boolean not null default false,
  removed_at timestamptz,
  removed_by uuid references public.users(id) on delete set null,
  removal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_pos_ticket_items_updated_at
before update on public.pos_ticket_items
for each row execute function public.set_updated_at();

create table public.pos_ticket_item_turn_parts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  ticket_item_id uuid not null references public.pos_ticket_items(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  amount numeric(12,2) not null,
  turn_type text not null,
  turn_index integer not null,
  work_date date not null,
  created_at timestamptz not null default now()
);

create table public.pos_payments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  payment_method text not null,
  amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.pos_ticket_audit_logs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  action text not null,
  note text not null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.pos_desk_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  customer_display_token text unique not null,
  status text not null default 'active',
  customer_lookup_value text,
  customer_name_snapshot text,
  note text,
  tip_amount numeric(12,2) not null default 0,
  customer_confirmed_at timestamptz,
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  submitted_ticket_id uuid references public.pos_tickets(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_desk_sessions_status_check check (
    status in ('active', 'pending_confirmation', 'submitted', 'cancelled', 'expired')
  ),
  constraint pos_desk_sessions_tip_amount_not_negative check (tip_amount >= 0)
);

create index pos_desk_sessions_salon_status_idx on public.pos_desk_sessions(salon_id, status);
create index pos_desk_sessions_customer_display_token_idx on public.pos_desk_sessions(customer_display_token);
create index pos_desk_sessions_expires_at_idx on public.pos_desk_sessions(expires_at);

create trigger set_pos_desk_sessions_updated_at
before update on public.pos_desk_sessions
for each row execute function public.set_updated_at();

create table public.pos_desk_session_lines (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  session_id uuid not null references public.pos_desk_sessions(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  service_id uuid references public.services(id) on delete set null,
  service_label text not null,
  amount numeric(12,2) not null,
  amount_input text not null,
  amount_parts jsonb not null default '[]'::jsonb,
  turn_large_count integer not null default 0,
  turn_small_count integer not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_desk_session_lines_amount_positive check (amount > 0),
  constraint pos_desk_session_lines_service_label_not_blank check (length(btrim(service_label)) > 0),
  constraint pos_desk_session_lines_turn_counts_not_negative check (
    turn_large_count >= 0 and turn_small_count >= 0
  )
);

create index pos_desk_session_lines_session_id_idx on public.pos_desk_session_lines(session_id, sort_order, created_at);
create index pos_desk_session_lines_staff_id_idx on public.pos_desk_session_lines(staff_id);

create trigger set_pos_desk_session_lines_updated_at
before update on public.pos_desk_session_lines
for each row execute function public.set_updated_at();

create table public.pos_display_channels (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  token text unique not null,
  pos_message jsonb,
  pos_message_version integer not null default 0,
  customer_message jsonb,
  customer_message_version integer not null default 0,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_display_channels_status_check check (
    status in ('waiting', 'receipt_sent', 'customer_confirmed', 'finalized')
  ),
  constraint pos_display_channels_versions_not_negative check (
    pos_message_version >= 0 and customer_message_version >= 0
  )
);

create index pos_display_channels_salon_status_idx on public.pos_display_channels(salon_id, status);
create index pos_display_channels_token_idx on public.pos_display_channels(token);

create trigger set_pos_display_channels_updated_at
before update on public.pos_display_channels
for each row execute function public.set_updated_at();

create table public.pos_live_drafts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  token text unique not null,
  customer jsonb,
  receipt jsonb not null default '{}'::jsonb,
  staff_lines jsonb not null default '[]'::jsonb,
  selected_staff_id text,
  tip numeric not null default 0,
  subtotal numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'draft',
  version integer not null default 0,
  customer_version integer not null default 0,
  receipt_version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_live_drafts_status_check check (status in ('draft', 'closed'))
);

create index pos_live_drafts_salon_updated_at_idx on public.pos_live_drafts(salon_id, updated_at desc);
create index pos_live_drafts_token_idx on public.pos_live_drafts(token);

create trigger set_pos_live_drafts_updated_at
before update on public.pos_live_drafts
for each row execute function public.set_updated_at();

create table public.staff_workdays (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  status text not null default 'not_checked_in',
  check_in_at timestamptz,
  check_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, staff_id, work_date)
);

create trigger set_staff_workdays_updated_at
before update on public.staff_workdays
for each row execute function public.set_updated_at();

create table public.pos_ticket_staff_earnings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  service_total numeric(12,2) not null default 0,
  tip_amount numeric(12,2) not null default 0,
  tip_is_manual boolean not null default false,
  manual_tip_amount numeric(12,2),
  big_turn_count integer not null default 0,
  small_turn_count integer not null default 0,
  first_big_turn_sequence integer,
  last_big_turn_sequence integer,
  first_small_turn_sequence integer,
  last_small_turn_sequence integer,
  commission_amount numeric(12,2) not null default 0,
  bonus_amount numeric(12,2) not null default 0,
  deduction_amount numeric(12,2) not null default 0,
  total_earning numeric(12,2) not null default 0,
  calculation_version integer not null default 1,
  locked_at timestamptz,
  payroll_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, staff_id)
);

create trigger set_pos_ticket_staff_earnings_updated_at
before update on public.pos_ticket_staff_earnings
for each row execute function public.set_updated_at();

create table public.pos_ticket_adjustments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  ticket_id uuid not null references public.pos_tickets(id) on delete cascade,
  replacement_ticket_item_id uuid references public.pos_ticket_items(id) on delete set null,
  action text not null,
  reason text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.pos_daily_closings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  report_date date not null,
  status text not null default 'draft',
  cash_amount numeric(12,2) not null default 0,
  credit_card_amount numeric(12,2) not null default 0,
  other_amount numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.users(id) on delete set null,
  lock_type text,
  lock_reason text,
  actual_total_snapshot numeric(12,2),
  cash_amount_snapshot numeric(12,2),
  credit_card_amount_snapshot numeric(12,2),
  difference_snapshot numeric(12,2),
  discount_snapshot numeric(12,2),
  expected_total_snapshot numeric(12,2),
  finalized_ticket_count_snapshot integer,
  gift_card_snapshot numeric(12,2),
  note_snapshot text,
  other_amount_snapshot numeric(12,2),
  snapshot_created_at timestamptz,
  staff_earned_snapshot numeric(12,2),
  ticket_count_snapshot integer,
  tip_snapshot numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, report_date)
);

create trigger set_pos_daily_closings_updated_at
before update on public.pos_daily_closings
for each row execute function public.set_updated_at();

create table public.pos_daily_closing_staff_snapshots (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  closing_id uuid not null references public.pos_daily_closings(id) on delete cascade,
  report_date date not null,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name_snapshot text not null,
  total_earned_snapshot numeric(12,2) not null default 0,
  tip_snapshot numeric(12,2) not null default 0,
  big_turn_count_snapshot numeric(12,2) not null default 0,
  small_turn_count_snapshot numeric(12,2) not null default 0,
  total_turns_snapshot numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  constraint pos_daily_closing_staff_snapshots_name_not_blank check (
    length(btrim(staff_name_snapshot)) > 0
  ),
  unique (closing_id, staff_id)
);

create index pos_daily_closing_staff_snapshots_salon_date_idx
on public.pos_daily_closing_staff_snapshots(salon_id, report_date);

create index pos_daily_closing_staff_snapshots_closing_id_idx
on public.pos_daily_closing_staff_snapshots(closing_id);

create table public.pos_financial_correction_requests (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  target_type text not null,
  target_id uuid,
  ticket_id uuid references public.pos_tickets(id) on delete cascade,
  business_date date not null,
  correction_type text not null,
  reason text not null,
  requested_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  rejected_by uuid references public.users(id) on delete set null,
  status text not null default 'pending',
  money_delta numeric(12,2) not null default 0,
  old_value_json jsonb not null default '{}'::jsonb,
  requested_value_json jsonb not null default '{}'::jsonb,
  admin_note text,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_pos_financial_correction_requests_updated_at
before update on public.pos_financial_correction_requests
for each row execute function public.set_updated_at();

create table public.pos_financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  correction_request_id uuid references public.pos_financial_correction_requests(id) on delete set null,
  target_type text not null,
  target_id uuid,
  ticket_id uuid references public.pos_tickets(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  business_date date not null,
  service_delta numeric(12,2) not null default 0,
  tip_delta numeric(12,2) not null default 0,
  turn_delta integer not null default 0,
  expected_total_delta numeric(12,2) not null default 0,
  actual_total_delta numeric(12,2) not null default 0,
  cash_delta numeric(12,2) not null default 0,
  credit_card_delta numeric(12,2) not null default 0,
  other_delta numeric(12,2) not null default 0,
  discount_delta numeric(12,2) not null default 0,
  gift_card_delta numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.salon_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references public.locations(id) on delete cascade,
  cycle_type text not null default 'monthly',
  biweekly_anchor_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_salon_payroll_settings_updated_at
before update on public.salon_payroll_settings
for each row execute function public.set_updated_at();

create table public.staff_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  legal_name text,
  pay_type text not null default 'commission',
  commission_rate numeric(8,4) not null default 60,
  fixed_pay_amount numeric(12,2) not null default 0,
  check_rate numeric(8,4) not null default 60,
  tax_rate numeric(8,4) not null default 0,
  apply_tax_to_fixed_pay boolean not null default true,
  tax_tips boolean not null default true,
  tax_bonus boolean not null default true,
  tax_company_enabled boolean not null default false,
  cash_to_tax_company boolean not null default false,
  tip_payout_method text not null default 'cash',
  bonus_payout_method text not null default 'check',
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_staff_payroll_settings_updated_at
before update on public.staff_payroll_settings
for each row execute function public.set_updated_at();

create table public.payroll_period_staff_inputs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  cycle_type text not null,
  check_number text,
  bonus_amount numeric(12,2) not null default 0,
  note text,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, staff_id, period_start, period_end, cycle_type)
);

create trigger set_payroll_period_staff_inputs_updated_at
before update on public.payroll_period_staff_inputs
for each row execute function public.set_updated_at();

create table public.payroll_period_staff_input_history (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  period_staff_input_id uuid references public.payroll_period_staff_inputs(id) on delete set null,
  payroll_run_id uuid,
  period_start date not null,
  period_end date not null,
  cycle_type text not null,
  change_type text not null,
  field_changes jsonb not null default '{}'::jsonb,
  previous_value_json jsonb not null default '{}'::jsonb,
  new_value_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  cycle_type text not null,
  status text not null default 'draft',
  version integer not null default 1,
  settings_snapshot jsonb not null default '{}'::jsonb,
  correction_snapshot jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  printed_at timestamptz,
  printed_by uuid references public.users(id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_payroll_runs_updated_at
before update on public.payroll_runs
for each row execute function public.set_updated_at();

alter table public.payroll_period_staff_input_history
add constraint payroll_period_staff_input_history_run_id_fkey
foreign key (payroll_run_id) references public.payroll_runs(id) on delete set null;

create table public.payroll_staff_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  staff_display_name_snapshot text not null,
  staff_legal_name_snapshot text,
  gross_sales numeric(12,2) not null default 0,
  pay_type_used text not null default 'commission',
  commission_rate_used numeric(8,4) not null default 0,
  fixed_pay_amount_used numeric(12,2) not null default 0,
  staff_commission_gross numeric(12,2) not null default 0,
  shop_share numeric(12,2) not null default 0,
  check_rate_used numeric(8,4) not null default 0,
  base_check_amount numeric(12,2) not null default 0,
  base_cash_amount numeric(12,2) not null default 0,
  cash_amount numeric(12,2) not null default 0,
  check_gross numeric(12,2) not null default 0,
  tax_rate_used numeric(8,4) not null default 0,
  tax_withheld numeric(12,2) not null default 0,
  check_net numeric(12,2) not null default 0,
  check_number text,
  tip_amount numeric(12,2) not null default 0,
  tip_check_amount numeric(12,2) not null default 0,
  tip_cash_amount numeric(12,2) not null default 0,
  tip_payout_method_snapshot text not null default 'cash',
  tip_allocation_method text not null default 'staff_earning',
  bonus_amount numeric(12,2) not null default 0,
  bonus_check_amount numeric(12,2) not null default 0,
  bonus_cash_amount numeric(12,2) not null default 0,
  bonus_payout_method_snapshot text not null default 'check',
  earned_amount numeric(12,2) not null default 0,
  final_check_amount numeric(12,2) not null default 0,
  final_cash_amount numeric(12,2) not null default 0,
  final_staff_income numeric(12,2) not null default 0,
  tax_bonus_snapshot boolean not null default true,
  tax_tips_snapshot boolean not null default true,
  tax_company_reported_wage_gross numeric(12,2) not null default 0,
  tax_company_taxable_gross numeric(12,2) not null default 0,
  tax_company_enabled_snapshot boolean not null default false,
  cash_to_tax_company_snapshot boolean not null default false,
  tax_company_check_amount numeric(12,2) not null default 0,
  tax_company_cash_amount numeric(12,2) not null default 0,
  is_mixed_rate boolean not null default false,
  settings_used_snapshot jsonb not null default '{}'::jsonb,
  period_staff_input_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_payroll_staff_lines_updated_at
before update on public.payroll_staff_lines
for each row execute function public.set_updated_at();

create table public.payroll_staff_daily_totals (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid references public.payroll_runs(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  business_date date not null,
  gross_sales numeric(12,2) not null default 0,
  tip_amount numeric(12,2) not null default 0,
  correction_delta numeric(12,2) not null default 0,
  pay_type_used text,
  commission_rate_used numeric(8,4),
  fixed_pay_amount_used numeric(12,2),
  check_rate_used numeric(8,4),
  tax_rate_used numeric(8,4),
  settings_used_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_payroll_staff_daily_totals_updated_at
before update on public.payroll_staff_daily_totals
for each row execute function public.set_updated_at();

create table public.payroll_paystubs (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  file_url_or_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_payroll_paystubs_updated_at
before update on public.payroll_paystubs
for each row execute function public.set_updated_at();

create table public.staff_salon_connection_requests (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  account_user_id uuid references public.users(id) on delete set null,
  direction text not null,
  status text not null default 'pending',
  initiated_by_user_id uuid not null references public.users(id) on delete cascade,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  target_email_normalized text,
  target_phone_e164 text,
  token_hash text,
  requested_job_title text,
  message text,
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_staff_salon_connection_requests_updated_at
before update on public.staff_salon_connection_requests
for each row execute function public.set_updated_at();

create index staff_salon_connection_requests_token_hash_idx
on public.staff_salon_connection_requests(token_hash)
where token_hash is not null;

create table public.salon_profile_media_assets (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  uploaded_by_user_id uuid references public.users(id) on delete set null,
  bucket text not null default 'salon-profile-media',
  object_path text not null,
  purpose text not null,
  mime_type text,
  original_bytes bigint,
  processed_bytes bigint,
  width integer,
  height integer,
  checksum text,
  status text not null default 'pending',
  attached_entity_type text,
  attached_entity_id uuid,
  upload_intent text,
  expires_at timestamptz not null default (now() + interval '1 day'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  attached_at timestamptz,
  orphaned_at timestamptz,
  deleted_at timestamptz,
  quarantined_at timestamptz,
  unique (bucket, object_path),
  constraint salon_profile_media_assets_status_check check (
    status in ('pending', 'active', 'orphaned', 'deleted', 'quarantined')
  ),
  constraint salon_profile_media_assets_purpose_check check (
    purpose in ('cover', 'logo', 'look', 'update', 'review', 'staff_avatar')
  ),
  constraint salon_profile_media_assets_upload_intent_check check (
    upload_intent is null or upload_intent in ('content', 'identity', 'review', 'staff')
  ),
  constraint salon_profile_media_assets_bytes_nonnegative check (
    (original_bytes is null or original_bytes >= 0)
    and (processed_bytes is null or processed_bytes >= 0)
  ),
  constraint salon_profile_media_assets_dimensions_positive check (
    (width is null or width > 0)
    and (height is null or height > 0)
  )
);

create index salon_profile_media_assets_salon_status_idx
on public.salon_profile_media_assets(salon_id, status, created_at desc);
create index salon_profile_media_assets_attached_idx
on public.salon_profile_media_assets(attached_entity_type, attached_entity_id)
where attached_entity_id is not null;

create trigger set_salon_profile_media_assets_updated_at
before update on public.salon_profile_media_assets
for each row execute function public.set_updated_at();

create table public.salon_profile_plan_catalog (
  id text primary key,
  name text not null,
  description text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_plan_catalog_name_not_blank check (length(btrim(name)) > 0)
);

create unique index salon_profile_plan_catalog_one_default_idx
on public.salon_profile_plan_catalog(is_default)
where is_default = true;

create trigger set_salon_profile_plan_catalog_updated_at
before update on public.salon_profile_plan_catalog
for each row execute function public.set_updated_at();

create table public.salon_profile_entitlement_definitions (
  code text primary key,
  name text not null,
  description text,
  value_type text not null default 'integer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_entitlement_definitions_value_type_check check (
    value_type in ('boolean', 'integer', 'bytes')
  )
);

create trigger set_salon_profile_entitlement_definitions_updated_at
before update on public.salon_profile_entitlement_definitions
for each row execute function public.set_updated_at();

create table public.salon_profile_plan_entitlements (
  plan_id text not null references public.salon_profile_plan_catalog(id) on delete cascade,
  entitlement_code text not null references public.salon_profile_entitlement_definitions(code) on delete cascade,
  limit_value bigint not null,
  period text not null default 'none',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, entitlement_code),
  constraint salon_profile_plan_entitlements_limit_nonnegative check (limit_value >= 0),
  constraint salon_profile_plan_entitlements_period_check check (
    period in ('none', 'day', 'month')
  )
);

create trigger set_salon_profile_plan_entitlements_updated_at
before update on public.salon_profile_plan_entitlements
for each row execute function public.set_updated_at();

create table public.salon_profile_subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  plan_id text not null references public.salon_profile_plan_catalog(id),
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_subscriptions_status_check check (
    status in ('active', 'cancelled', 'expired', 'trialing')
  ),
  constraint salon_profile_subscriptions_time_check check (
    ends_at is null or ends_at > starts_at
  )
);

create unique index salon_profile_subscriptions_one_active_idx
on public.salon_profile_subscriptions(salon_id)
where status in ('active', 'trialing')
  and ends_at is null;
create index salon_profile_subscriptions_account_idx
on public.salon_profile_subscriptions(account_id, salon_id);

create trigger set_salon_profile_subscriptions_updated_at
before update on public.salon_profile_subscriptions
for each row execute function public.set_updated_at();

create table public.salon_profile_entitlement_overrides (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  entitlement_code text not null references public.salon_profile_entitlement_definitions(code) on delete cascade,
  limit_value bigint not null,
  period text not null default 'none',
  reason text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_entitlement_overrides_unique unique (salon_id, entitlement_code),
  constraint salon_profile_entitlement_overrides_limit_nonnegative check (limit_value >= 0),
  constraint salon_profile_entitlement_overrides_period_check check (
    period in ('none', 'day', 'month')
  )
);

create index salon_profile_entitlement_overrides_account_idx
on public.salon_profile_entitlement_overrides(account_id, salon_id);

create trigger set_salon_profile_entitlement_overrides_updated_at
before update on public.salon_profile_entitlement_overrides
for each row execute function public.set_updated_at();

create table public.salon_profile_usage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  quantity integer not null default 1,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint salon_profile_usage_events_quantity_positive check (quantity > 0)
);

create unique index salon_profile_usage_events_idempotency_idx
on public.salon_profile_usage_events(salon_id, idempotency_key)
where idempotency_key is not null;
create unique index salon_profile_usage_events_entity_idx
on public.salon_profile_usage_events(salon_id, event_type, entity_type, entity_id)
where entity_id is not null;
create index salon_profile_usage_events_period_idx
on public.salon_profile_usage_events(salon_id, event_type, occurred_at desc);

create table public.salon_profile_looks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  author_avatar_path text,
  author_display_name text,
  author_staff_id uuid references public.staff(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  recommended_staff_id uuid references public.staff(id) on delete set null,
  title text not null,
  caption text,
  emotional_description text,
  why_love_it text,
  mood text,
  duration_minutes integer,
  starting_price numeric(12,2),
  palette text[] not null default '{}',
  badge text,
  media_path text,
  booking_note text,
  is_pinned boolean not null default false,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_salon_profile_looks_updated_at
before update on public.salon_profile_looks
for each row execute function public.set_updated_at();

create table public.salon_profile_updates (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  author_avatar_path text,
  author_display_name text,
  author_staff_id uuid references public.staff(id) on delete set null,
  created_by_user_id uuid references public.users(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  update_type text not null default 'announcement',
  title text not null,
  caption text,
  summary text,
  media_path text,
  starts_at timestamptz,
  ends_at timestamptz,
  cta_label text,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_salon_profile_updates_updated_at
before update on public.salon_profile_updates
for each row execute function public.set_updated_at();

create table public.salon_profile_hashtags (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  created_at timestamptz not null default now()
);

create table public.salon_profile_look_hashtags (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  look_id uuid not null references public.salon_profile_looks(id) on delete cascade,
  hashtag_id uuid not null references public.salon_profile_hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (look_id, hashtag_id)
);

create table public.salon_profile_update_hashtags (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  update_id uuid not null references public.salon_profile_updates(id) on delete cascade,
  hashtag_id uuid not null references public.salon_profile_hashtags(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (update_id, hashtag_id)
);

create table public.salon_profile_comments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  look_id uuid references public.salon_profile_looks(id) on delete cascade,
  update_id uuid references public.salon_profile_updates(id) on delete cascade,
  parent_comment_id uuid references public.salon_profile_comments(id) on delete cascade,
  author_user_id uuid references public.users(id) on delete set null,
  author_display_name text,
  body text not null,
  is_salon_reply boolean not null default false,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_salon_profile_comments_updated_at
before update on public.salon_profile_comments
for each row execute function public.set_updated_at();

create table public.salon_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null,
  title text,
  body text not null,
  verification_status text not null default 'unverified',
  verified_booking_id uuid references public.bookings(id) on delete set null,
  moderation_status text not null default 'visible',
  moderation_reason text,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_reviews_rating_check check (rating between 1 and 5),
  constraint salon_profile_reviews_body_not_blank check (length(btrim(body)) > 0),
  constraint salon_profile_reviews_verification_status_check check (
    verification_status in ('verified', 'unverified')
  ),
  constraint salon_profile_reviews_moderation_status_check check (
    moderation_status in ('visible', 'hidden', 'reported', 'withdrawn')
  )
);

create unique index salon_profile_reviews_one_active_user_review_idx
on public.salon_profile_reviews(salon_id, author_user_id)
where moderation_status in ('visible', 'reported');
create index salon_profile_reviews_public_idx
on public.salon_profile_reviews(salon_id, moderation_status, created_at desc);

create trigger set_salon_profile_reviews_updated_at
before update on public.salon_profile_reviews
for each row execute function public.set_updated_at();

create table public.salon_profile_review_replies (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  review_id uuid not null references public.salon_profile_reviews(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  created_by_user_id uuid references public.users(id) on delete set null,
  moderation_status text not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_profile_review_replies_body_not_blank check (length(btrim(body)) > 0),
  constraint salon_profile_review_replies_status_check check (
    moderation_status in ('visible', 'hidden', 'withdrawn')
  )
);

create unique index salon_profile_review_replies_one_visible_idx
on public.salon_profile_review_replies(review_id)
where moderation_status = 'visible';

create trigger set_salon_profile_review_replies_updated_at
before update on public.salon_profile_review_replies
for each row execute function public.set_updated_at();

create table public.salon_profile_look_saves (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  look_id uuid not null references public.salon_profile_looks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (look_id, user_id)
);

create table public.salon_profile_follows (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (salon_id, user_id)
);

create table public.account_favorite_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, customer_id)
);

create table public.salon_profile_booking_requests (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  look_id uuid references public.salon_profile_looks(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  customer_user_id uuid references public.users(id) on delete set null,
  private_note text,
  requested_start_at timestamptz,
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_salon_profile_booking_requests_updated_at
before update on public.salon_profile_booking_requests
for each row execute function public.set_updated_at();

create table public.salon_profile_content_booking_configs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  source_type text not null,
  look_id uuid references public.salon_profile_looks(id) on delete cascade,
  update_id uuid references public.salon_profile_updates(id) on delete cascade,
  booking_cta_enabled boolean not null default false,
  cta_label text,
  booking_note text,
  primary_service_id uuid references public.services(id) on delete set null,
  credited_staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_salon_profile_content_booking_configs_updated_at
before update on public.salon_profile_content_booking_configs
for each row execute function public.set_updated_at();

create table public.salon_profile_content_booking_services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  config_id uuid not null references public.salon_profile_content_booking_configs(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  parent_service_id uuid references public.services(id) on delete set null,
  service_role text not null default 'additional_service',
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (config_id, service_id)
);

create trigger set_salon_profile_content_booking_services_updated_at
before update on public.salon_profile_content_booking_services
for each row execute function public.set_updated_at();

create table public.booking_inspirations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  booking_line_id uuid references public.booking_lines(id) on delete set null,
  source_type text not null default 'salon_profile_look',
  source_content_id uuid,
  source_salon_id uuid not null references public.locations(id) on delete cascade,
  source_media_asset_id uuid references public.salon_profile_media_assets(id) on delete set null,
  source_media_bucket text not null default 'salon-profile-media',
  source_media_path text,
  source_media_width integer,
  source_media_height integer,
  source_media_mime_type text,
  credited_staff_id uuid references public.staff(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  source_title_snapshot text,
  source_caption_snapshot text,
  source_booking_note_snapshot text,
  service_name_snapshot text,
  credited_staff_name_snapshot text,
  salon_name_snapshot text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_booking_inspirations_updated_at
before update on public.booking_inspirations
for each row execute function public.set_updated_at();

create table public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  salon_id uuid references public.locations(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  recipient_kind text not null,
  notification_type text not null,
  booking_id uuid references public.bookings(id) on delete cascade,
  title text not null,
  body text,
  href text not null,
  read_at timestamptz,
  event_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_app_notifications_updated_at
before update on public.app_notifications
for each row execute function public.set_updated_at();

create or replace function public.touch_pos_desk_session_from_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_session_id uuid;
begin
  target_session_id := case
    when tg_op = 'DELETE' then old.session_id
    else new.session_id
  end;

  update public.pos_desk_sessions
  set last_activity_at = now(),
      expires_at = now() + interval '5 minutes'
  where id = target_session_id
    and status = 'active';

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger touch_pos_desk_session_from_line
after insert or update or delete on public.pos_desk_session_lines
for each row execute function public.touch_pos_desk_session_from_line();

create or replace function public.validate_pos_desk_session_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.customer_id is not null and not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.location_id = new.salon_id
  ) then
    raise exception 'POS desk session customer must belong to salon.';
  end if;

  return new;
end;
$$;

create trigger validate_pos_desk_session_scope
before insert or update on public.pos_desk_sessions
for each row execute function public.validate_pos_desk_session_scope();

create or replace function public.validate_pos_desk_session_line_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.pos_desk_sessions
    where pos_desk_sessions.id = new.session_id
      and pos_desk_sessions.salon_id = new.salon_id
      and pos_desk_sessions.status = 'active'
  ) then
    raise exception 'POS desk session line must belong to an active session.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'POS desk session line staff must belong to salon.';
  end if;

  if new.service_id is not null and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.salon_id = new.salon_id
  ) then
    raise exception 'POS desk session line service must belong to salon.';
  end if;

  return new;
end;
$$;

create trigger validate_pos_desk_session_line_scope
before insert or update on public.pos_desk_session_lines
for each row execute function public.validate_pos_desk_session_line_scope();

create or replace function public.validate_pos_daily_closing_staff_snapshot_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.pos_daily_closings
    where pos_daily_closings.id = new.closing_id
      and pos_daily_closings.salon_id = new.salon_id
      and pos_daily_closings.report_date = new.report_date
  ) then
    raise exception 'Staff snapshot must belong to its daily closing.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Staff snapshot staff must belong to the snapshot salon.';
  end if;

  return new;
end;
$$;

create trigger validate_pos_daily_closing_staff_snapshot_scope
before insert or update on public.pos_daily_closing_staff_snapshots
for each row execute function public.validate_pos_daily_closing_staff_snapshot_scope();

create or replace function public.get_pos_desk_session_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.pos_desk_sessions%rowtype;
  lines_json jsonb;
begin
  select *
  into session_row
  from public.pos_desk_sessions
  where customer_display_token = p_token
  limit 1;

  if session_row.id is null then
    return null;
  end if;

  if session_row.status in ('active', 'pending_confirmation') and session_row.expires_at <= now() then
    update public.pos_desk_sessions
    set status = 'expired',
        last_activity_at = now()
    where id = session_row.id
    returning * into session_row;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', pos_desk_session_lines.id,
        'staff_id', pos_desk_session_lines.staff_id,
        'staff_name', staff.display_name,
        'service_id', pos_desk_session_lines.service_id,
        'service_label', pos_desk_session_lines.service_label,
        'amount', pos_desk_session_lines.amount,
        'amount_input', pos_desk_session_lines.amount_input,
        'amount_parts', pos_desk_session_lines.amount_parts,
        'turn_large_count', pos_desk_session_lines.turn_large_count,
        'turn_small_count', pos_desk_session_lines.turn_small_count,
        'sort_order', pos_desk_session_lines.sort_order
      )
      order by pos_desk_session_lines.sort_order, pos_desk_session_lines.created_at
    ),
    '[]'::jsonb
  )
  into lines_json
  from public.pos_desk_session_lines
  left join public.staff on staff.id = pos_desk_session_lines.staff_id
  where pos_desk_session_lines.session_id = session_row.id;

  return jsonb_build_object(
    'id', session_row.id,
    'salon_id', session_row.salon_id,
    'salon_name', (select locations.name from public.locations where locations.id = session_row.salon_id),
    'customer_id', session_row.customer_id,
    'customer_lookup_value', session_row.customer_lookup_value,
    'customer_name_snapshot', session_row.customer_name_snapshot,
    'note', session_row.note,
    'status', session_row.status,
    'tip_amount', session_row.tip_amount,
    'customer_confirmed_at', session_row.customer_confirmed_at,
    'submitted_ticket_id', session_row.submitted_ticket_id,
    'customer_display_token', session_row.customer_display_token,
    'expires_at', session_row.expires_at,
    'updated_at', session_row.updated_at,
    'lines', lines_json
  );
end;
$$;

create or replace function public.update_pos_desk_session_tip_by_token(
  p_token text,
  p_tip_amount numeric,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_id uuid;
begin
  if p_tip_amount < 0 then
    raise exception 'Tip must be zero or greater.';
  end if;

  update public.pos_desk_sessions
  set tip_amount = round(p_tip_amount, 2),
      customer_confirmed_at = case when p_confirm then now() else customer_confirmed_at end,
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and customer_confirmed_at is null
    and expires_at > now()
  returning id into updated_id;

  if updated_id is null then
    return null;
  end if;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

create or replace function public.update_pos_desk_session_customer_by_token(
  p_token text,
  p_customer_lookup text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lookup_value text := nullif(btrim(p_customer_lookup), '');
  matched_customer public.customers%rowtype;
  target_salon_id uuid;
  updated_id uuid;
begin
  select salon_id
  into target_salon_id
  from public.pos_desk_sessions
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and expires_at > now()
  limit 1;

  if target_salon_id is null then
    return null;
  end if;

  if lookup_value is not null then
    select *
    into matched_customer
    from public.customers
    where status = 'active'
      and location_id = target_salon_id
      and (
        phone = lookup_value
        or lower(email) = lower(lookup_value)
        or lower(btrim(name)) = lower(lookup_value)
      )
    order by created_at desc
    limit 1;
  end if;

  update public.pos_desk_sessions
  set customer_id = matched_customer.id,
      customer_lookup_value = lookup_value,
      customer_name_snapshot = case
        when matched_customer.id is not null then matched_customer.name
        else lookup_value
      end,
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and expires_at > now()
  returning id into updated_id;

  if updated_id is null then
    return null;
  end if;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

create or replace function public.create_pos_desk_customer_by_token(
  p_token text,
  p_customer_name text,
  p_customer_lookup text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lookup_value text := nullif(btrim(p_customer_lookup), '');
  new_customer public.customers%rowtype;
  session_row public.pos_desk_sessions%rowtype;
begin
  select *
  into session_row
  from public.pos_desk_sessions
  where customer_display_token = p_token
    and status in ('active', 'pending_confirmation')
    and expires_at > now()
  limit 1;

  if session_row.id is null then
    return null;
  end if;

  if nullif(btrim(p_customer_name), '') is null then
    raise exception 'Customer name is required.';
  end if;

  insert into public.customers (
    email,
    location_id,
    name,
    notes,
    phone,
    status
  )
  values (
    case when lookup_value like '%@%' then lookup_value else null end,
    session_row.salon_id,
    btrim(p_customer_name),
    'Created from POS customer display.',
    case when lookup_value is not null and lookup_value not like '%@%' then lookup_value else null end,
    'active'
  )
  returning * into new_customer;

  update public.pos_desk_sessions
  set customer_id = new_customer.id,
      customer_lookup_value = lookup_value,
      customer_name_snapshot = new_customer.name,
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where id = session_row.id;

  return public.get_pos_desk_session_by_token(p_token);
end;
$$;

create or replace function public.get_pos_display_channel_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_row public.pos_display_channels%rowtype;
begin
  select *
  into channel_row
  from public.pos_display_channels
  where token = p_token
  limit 1;

  if channel_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', channel_row.id,
    'salon_id', channel_row.salon_id,
    'token', channel_row.token,
    'pos_message', channel_row.pos_message,
    'pos_message_version', channel_row.pos_message_version,
    'customer_message', channel_row.customer_message,
    'customer_message_version', channel_row.customer_message_version,
    'status', channel_row.status,
    'updated_at', channel_row.updated_at
  );
end;
$$;

create or replace function public.confirm_pos_display_channel_tip(
  p_token text,
  p_customer_message jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  channel_row public.pos_display_channels%rowtype;
  tip_amount numeric := coalesce((p_customer_message ->> 'tipAmount')::numeric, 0);
begin
  if tip_amount < 0 then
    raise exception 'Tip must be zero or greater.';
  end if;

  update public.pos_display_channels
  set customer_message = p_customer_message,
      customer_message_version = customer_message_version + 1,
      status = 'customer_confirmed'
  where token = p_token
  returning * into channel_row;

  if channel_row.id is null then
    return null;
  end if;

  update public.pos_desk_sessions
  set tip_amount = round(tip_amount, 2),
      customer_confirmed_at = coalesce((p_customer_message ->> 'confirmedAt')::timestamptz, now()),
      last_activity_at = now(),
      expires_at = now() + interval '10 minutes'
  where customer_display_token = p_token
    and status = 'active'
    and expires_at > now();

  return public.get_pos_display_channel_by_token(p_token);
end;
$$;

create or replace function public.get_pos_live_draft_by_token(p_token text)
returns table (
  id uuid,
  salon_id uuid,
  token text,
  customer jsonb,
  staff_lines jsonb,
  selected_staff_id text,
  tip numeric,
  subtotal numeric,
  total numeric,
  status text,
  version integer,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    pos_live_drafts.id,
    pos_live_drafts.salon_id,
    pos_live_drafts.token,
    pos_live_drafts.customer,
    pos_live_drafts.staff_lines,
    pos_live_drafts.selected_staff_id,
    pos_live_drafts.tip,
    pos_live_drafts.subtotal,
    pos_live_drafts.total,
    pos_live_drafts.status,
    pos_live_drafts.version,
    pos_live_drafts.updated_at
  from public.pos_live_drafts
  where pos_live_drafts.token = p_token
  limit 1;
$$;

create or replace function public.upsert_pos_live_draft_customer_by_phone(
  p_token text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_phone text;
  matched_customer public.customers%rowtype;
  customer_payload jsonb;
begin
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g'), '');

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into matched_customer
  from public.customers
  where location_id = draft_row.salon_id
    and phone = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if matched_customer.id is null then
    insert into public.customers (location_id, name, phone, status)
    values (draft_row.salon_id, 'Guest ' || normalized_phone, normalized_phone, 'active')
    returning * into matched_customer;
  end if;

  customer_payload := jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
  );

  update public.pos_live_drafts
  set customer = customer_payload,
      version = version + 1,
      updated_at = now()
  where id = draft_row.id;

  return customer_payload;
end;
$$;

create or replace function public.find_pos_live_draft_customer_by_phone(
  p_phone text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_phone text;
  matched_customer public.customers%rowtype;
  customer_payload jsonb;
begin
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g'), '');

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into matched_customer
  from public.customers
  where location_id = draft_row.salon_id
    and phone = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if matched_customer.id is null then
    return null;
  end if;

  customer_payload := jsonb_build_object(
    'id', matched_customer.id,
    'name', matched_customer.name,
    'phone', matched_customer.phone
  );

  update public.pos_live_drafts
  set customer = customer_payload,
      version = version + 1,
      updated_at = now()
  where id = draft_row.id;

  return customer_payload;
end;
$$;

create or replace function public.create_pos_live_draft_customer_by_phone(
  p_token text,
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft_row public.pos_live_drafts%rowtype;
  normalized_name text;
  normalized_phone text;
  saved_customer public.customers%rowtype;
  customer_payload jsonb;
begin
  normalized_name := nullif(btrim(coalesce(p_name, '')), '');
  normalized_phone := nullif(regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g'), '');

  if normalized_name is null then
    raise exception 'Customer name is required.';
  end if;

  if normalized_phone is null then
    raise exception 'Phone is required.';
  end if;

  select *
  into draft_row
  from public.pos_live_drafts
  where token = p_token
  limit 1;

  if draft_row.id is null then
    raise exception 'Live draft was not found.';
  end if;

  select *
  into saved_customer
  from public.customers
  where location_id = draft_row.salon_id
    and phone = normalized_phone
    and status = 'active'
  order by created_at desc
  limit 1;

  if saved_customer.id is null then
    insert into public.customers (location_id, name, phone, status)
    values (draft_row.salon_id, normalized_name, normalized_phone, 'active')
    returning * into saved_customer;
  end if;

  customer_payload := jsonb_build_object(
    'id', saved_customer.id,
    'name', saved_customer.name,
    'phone', saved_customer.phone
  );

  update public.pos_live_drafts
  set customer = customer_payload,
      version = version + 1,
      updated_at = now()
  where id = draft_row.id;

  return customer_payload;
end;
$$;

create or replace function public.current_public_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users.id
  from public.users
  where users.auth_user_id = auth.uid()
  limit 1
$$;

create or replace function public.user_belongs_to_account(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_memberships memberships
    where memberships.account_id = target_account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
$$;

create or replace function public.user_can_manage_salon(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    left join public.roles roles
      on roles.id = memberships.role_id
    where salons.id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (roles.code = 'OWNER' or roles.code = 'MANAGER')
  )
$$;

create or replace function public.user_has_account_permission(
  target_account_id uuid,
  permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
    left join public.permissions permissions on permissions.id = role_permissions.permission_id
    where memberships.account_id = target_account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (
        roles.code = 'OWNER'
        or permissions.code = any(permission_codes)
      )
  )
$$;

create or replace function public.user_has_salon_permission(
  target_salon_id uuid,
  permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    where salons.id = target_salon_id
      and public.user_has_account_permission(salons.account_id, permission_codes)
  )
$$;

create or replace function public.user_is_salon_member(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.salon_memberships memberships
    where memberships.salon_id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
  or public.user_can_manage_salon(target_salon_id)
$$;

create or replace function public.current_user_staff_id_for_salon(target_salon_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff.id
  from public.staff
  where staff.salon_id = target_salon_id
    and staff.account_user_id = public.current_public_user_id()
    and staff.is_active = true
  order by staff.created_at
  limit 1
$$;

create or replace function public.user_can_read_staff_scoped_row(
  target_salon_id uuid,
  target_staff_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_can_manage_salon(target_salon_id)
    or target_staff_id = public.current_user_staff_id_for_salon(target_salon_id)
$$;

create or replace function public.prepare_booking_customer_account_link()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.customer_user_id is not null
    and new.customer_user_id is not null
    and new.customer_user_id is distinct from old.customer_user_id
  then
    raise exception 'Booking customer account link cannot be reassigned.';
  end if;

  if new.customer_user_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    or new.customer_user_id is distinct from old.customer_user_id
  then
    new.customer_account_linked_at := coalesce(new.customer_account_linked_at, now());
    new.customer_account_linked_by_user_id := coalesce(
      new.customer_account_linked_by_user_id,
      new.updated_by_user_id,
      new.created_by_user_id,
      new.customer_user_id
    );
    new.customer_account_link_method := coalesce(
      new.customer_account_link_method,
      case
        when new.source in ('public_profile', 'explore')
          and new.created_by_user_id is not distinct from new.customer_user_id
        then 'authenticated_booking'
        else 'manual_account_link'
      end
    );
    new.customer_account_link_metadata := coalesce(
      new.customer_account_link_metadata,
      '{}'::jsonb
    ) || jsonb_build_object('source', new.source);
  end if;

  return new;
end;
$$;

create trigger prepare_booking_customer_account_link
before insert or update of customer_user_id on public.bookings
for each row execute function public.prepare_booking_customer_account_link();

create or replace function public.get_salon_profile_entitlement_limit(
  target_salon_id uuid,
  entitlement_key text
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  active_plan_id text;
  resolved_limit bigint;
begin
  select overrides.limit_value
  into resolved_limit
  from public.salon_profile_entitlement_overrides overrides
  where overrides.salon_id = target_salon_id
    and overrides.entitlement_code = entitlement_key
    and (overrides.expires_at is null or overrides.expires_at > now())
  limit 1;

  if resolved_limit is not null then
    return resolved_limit;
  end if;

  select subscriptions.plan_id
  into active_plan_id
  from public.salon_profile_subscriptions subscriptions
  where subscriptions.salon_id = target_salon_id
    and subscriptions.status in ('active', 'trialing')
    and (subscriptions.ends_at is null or subscriptions.ends_at > now())
  order by subscriptions.starts_at desc
  limit 1;

  if active_plan_id is null then
    select plans.id
    into active_plan_id
    from public.salon_profile_plan_catalog plans
    where plans.is_default = true
      and plans.is_active = true
    limit 1;
  end if;

  select entitlements.limit_value
  into resolved_limit
  from public.salon_profile_plan_entitlements entitlements
  where entitlements.plan_id = active_plan_id
    and entitlements.entitlement_code = entitlement_key
  limit 1;

  return coalesce(resolved_limit, 9223372036854775807);
end;
$$;

create or replace function public.get_salon_profile_media_usage(target_salon_id uuid)
returns table (
  used_bytes bigint,
  asset_count bigint,
  orphan_bytes bigint,
  storage_quota_bytes bigint,
  remaining_bytes bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(coalesce(processed_bytes, original_bytes, 0)) filter (
      where status in ('active', 'pending')
    ), 0)::bigint as used_bytes,
    count(*) filter (where status in ('active', 'pending'))::bigint as asset_count,
    coalesce(sum(coalesce(processed_bytes, original_bytes, 0)) filter (
      where status = 'orphaned'
    ), 0)::bigint as orphan_bytes,
    public.get_salon_profile_entitlement_limit(target_salon_id, 'storage_bytes') as storage_quota_bytes,
    greatest(
      public.get_salon_profile_entitlement_limit(target_salon_id, 'storage_bytes')
      - coalesce(sum(coalesce(processed_bytes, original_bytes, 0)) filter (
        where status in ('active', 'pending')
      ), 0)::bigint,
      0
    )::bigint as remaining_bytes
  from public.salon_profile_media_assets
  where salon_id = target_salon_id
$$;

create or replace function public.user_can_manage_salon_profile_media(
  object_name text,
  permission_codes text[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  folder_parts text[];
  first_part text;
  second_part text;
  target_salon_id uuid;
  target_staff_id uuid;
begin
  if object_name is null or object_name = '' then
    return false;
  end if;

  if object_name like '/%' or object_name like '%..%' or object_name like '%\%' then
    return false;
  end if;

  folder_parts := storage.foldername(object_name);
  first_part := folder_parts[1];
  second_part := folder_parts[2];

  if first_part is null
    or first_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return false;
  end if;

  if second_part in ('profile', 'looks', 'updates', 'reviews') then
    target_salon_id := first_part::uuid;
  elsif second_part = 'staff'
    and folder_parts[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and folder_parts[4] = 'avatar'
  then
    target_salon_id := first_part::uuid;
    target_staff_id := folder_parts[3]::uuid;
  else
    return false;
  end if;

  if target_staff_id is not null
    and target_staff_id = public.current_user_staff_id_for_salon(target_salon_id)
  then
    return true;
  end if;

  return public.user_has_salon_permission(target_salon_id, permission_codes);
end;
$$;

create or replace function public.prepare_salon_profile_look_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select looks.salon_id
  into new.salon_id
  from public.salon_profile_looks looks
  where looks.id = new.look_id
    and looks.status = 'published'
    and public.salon_profile_public_salon_exists(looks.salon_id);

  if new.salon_id is null then
    raise exception 'Published look was not found.';
  end if;

  if new.user_id is distinct from public.current_public_user_id() then
    raise exception 'Look save user must be the current user.';
  end if;

  return new;
end;
$$;

create trigger prepare_salon_profile_look_save
before insert on public.salon_profile_look_saves
for each row execute function public.prepare_salon_profile_look_save();

create or replace function public.create_account_salon(
  p_account_id uuid,
  p_create_request_key text,
  p_name text,
  p_phone text default null,
  p_address_line1 text default null,
  p_address_line2 text default null,
  p_city text default null,
  p_state text default null,
  p_postal_code text default null,
  p_country text default 'US'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  owner_role_id uuid;
  existing_salon public.locations%rowtype;
  new_salon_id uuid;
  created_salon boolean := false;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  if nullif(btrim(coalesce(p_create_request_key, '')), '') is null then
    raise exception 'Create request key is required.';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Salon name is required.';
  end if;

  if not exists (
    select 1
    from public.accounts
    where accounts.id = p_account_id
      and accounts.status = 'active'
  ) then
    raise exception 'Account is not active.';
  end if;

  select roles.id
  into owner_role_id
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  where memberships.account_id = p_account_id
    and memberships.user_id = actor_user_id
    and memberships.status = 'active'
    and roles.code = 'OWNER'
  limit 1;

  if owner_role_id is null then
    raise exception 'Only Account owners can create salons.';
  end if;

  select *
  into existing_salon
  from public.locations
  where account_id = p_account_id
    and create_request_key = btrim(p_create_request_key)
  limit 1;

  if existing_salon.id is not null then
    insert into public.salon_memberships (
      account_id,
      salon_id,
      user_id,
      role_id,
      status,
      joined_at
    )
    values (
      p_account_id,
      existing_salon.id,
      actor_user_id,
      owner_role_id,
      'active',
      now()
    )
    on conflict (salon_id, user_id) do update
    set role_id = excluded.role_id,
        status = 'active',
        joined_at = coalesce(public.salon_memberships.joined_at, excluded.joined_at);

    insert into public.salon_settings (
      salon_id,
      business_name,
      phone,
      email,
      website,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country
    )
    values (
      existing_salon.id,
      existing_salon.name,
      existing_salon.phone,
      null,
      null,
      existing_salon.address_line1,
      existing_salon.address_line2,
      existing_salon.city,
      existing_salon.state,
      existing_salon.postal_code,
      existing_salon.country
    )
    on conflict (salon_id) do nothing;

    insert into public.booking_settings (salon_id)
    values (existing_salon.id)
    on conflict (salon_id) do nothing;

    insert into public.salon_payroll_settings (salon_id)
    values (existing_salon.id)
    on conflict (salon_id) do nothing;

    return jsonb_build_object(
      'ok', true,
      'created', false,
      'salon_id', existing_salon.id
    );
  end if;

  insert into public.locations (
    account_id,
    create_request_key,
    name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    status
  )
  values (
    p_account_id,
    btrim(p_create_request_key),
    btrim(p_name),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_address_line2, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    coalesce(nullif(btrim(coalesce(p_country, '')), ''), 'US'),
    'active'
  )
  on conflict (account_id, create_request_key)
  where create_request_key is not null
  do nothing
  returning id into new_salon_id;

  if new_salon_id is null then
    select *
    into existing_salon
    from public.locations
    where account_id = p_account_id
      and create_request_key = btrim(p_create_request_key)
    limit 1;

    if existing_salon.id is null then
      raise exception 'Salon creation could not be completed.';
    end if;

    new_salon_id := existing_salon.id;
  else
    created_salon := true;
  end if;

  insert into public.salon_memberships (
    account_id,
    salon_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  values (
    p_account_id,
    new_salon_id,
    actor_user_id,
    owner_role_id,
    'active',
    now()
  )
  on conflict (salon_id, user_id) do update
  set role_id = excluded.role_id,
      status = 'active',
      joined_at = coalesce(public.salon_memberships.joined_at, excluded.joined_at);

  insert into public.salon_settings (
    salon_id,
    business_name,
    phone,
    email,
    website,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country
  )
  values (
    new_salon_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_phone, '')), ''),
    null,
    null,
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_address_line2, '')), ''),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_state, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    coalesce(nullif(btrim(coalesce(p_country, '')), ''), 'US')
  )
  on conflict (salon_id) do nothing;

  insert into public.booking_settings (salon_id)
  values (new_salon_id)
  on conflict (salon_id) do nothing;

  insert into public.salon_payroll_settings (salon_id)
  values (new_salon_id)
  on conflict (salon_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'created', created_salon,
    'salon_id', new_salon_id
  );
end;
$$;

create or replace function public.list_account_saved_posts(p_limit integer default 100)
returns table (
  saved_id uuid,
  look_id uuid,
  salon_id uuid,
  salon_name text,
  title text,
  caption text,
  media_path text,
  published_at timestamptz,
  saved_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    saves.id,
    looks.id,
    looks.salon_id,
    salons.name,
    looks.title,
    looks.caption,
    looks.media_path,
    looks.published_at,
    saves.created_at
  from public.salon_profile_look_saves saves
  join public.salon_profile_looks looks on looks.id = saves.look_id
  join public.locations salons on salons.id = looks.salon_id
  where saves.user_id = public.current_public_user_id()
    and looks.status = 'published'
  order by saves.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

create or replace function public.list_account_favorite_shops(p_limit integer default 100)
returns table (
  follow_id uuid,
  salon_id uuid,
  salon_name text,
  city text,
  state text,
  followed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    follows.id,
    salons.id,
    salons.name,
    salons.city,
    salons.state,
    follows.created_at
  from public.salon_profile_follows follows
  join public.locations salons on salons.id = follows.salon_id
  where follows.user_id = public.current_public_user_id()
  order by follows.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

create or replace function public.list_account_favorite_customers(p_limit integer default 100)
returns table (
  favorite_id uuid,
  customer_id uuid,
  customer_name text,
  phone text,
  email text,
  salon_id uuid,
  salon_name text,
  favorited_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    favorites.id,
    customers.id,
    customers.name,
    customers.phone,
    customers.email,
    salons.id,
    salons.name,
    favorites.created_at
  from public.account_favorite_customers favorites
  join public.customers customers on customers.id = favorites.customer_id
  join public.locations salons on salons.id = customers.location_id
  where favorites.user_id = public.current_public_user_id()
  order by favorites.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 100)
$$;

create or replace function public.get_customer_crm_metrics(
  p_salon_id uuid,
  p_customer_ids uuid[]
)
returns table (
  customer_id uuid,
  appointment_count integer,
  completed_count integer,
  cancelled_count integer,
  no_show_count integer,
  active_pos_ticket_count integer,
  finalized_pos_ticket_count integer,
  finalized_spend numeric,
  last_visit_at timestamptz,
  upcoming_booking_id uuid,
  upcoming_start_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with target_customers as (
    select unnest(coalesce(p_customer_ids, array[]::uuid[])) as customer_id
  )
  select
    target_customers.customer_id,
    (
      select count(*)::integer
      from public.bookings bookings
      where bookings.salon_id = p_salon_id
        and bookings.customer_id = target_customers.customer_id
    ) as appointment_count,
    (
      select count(*)::integer
      from public.bookings bookings
      where bookings.salon_id = p_salon_id
        and bookings.customer_id = target_customers.customer_id
        and bookings.status = 'completed'
    ) as completed_count,
    (
      select count(*)::integer
      from public.bookings bookings
      where bookings.salon_id = p_salon_id
        and bookings.customer_id = target_customers.customer_id
        and bookings.status = 'cancelled'
    ) as cancelled_count,
    (
      select count(*)::integer
      from public.bookings bookings
      where bookings.salon_id = p_salon_id
        and bookings.customer_id = target_customers.customer_id
        and bookings.status = 'no_show'
    ) as no_show_count,
    (
      select count(*)::integer
      from public.pos_tickets tickets
      where tickets.salon_id = p_salon_id
        and tickets.customer_id = target_customers.customer_id
        and tickets.status = 'open'
    ) as active_pos_ticket_count,
    (
      select count(*)::integer
      from public.pos_tickets tickets
      where tickets.salon_id = p_salon_id
        and tickets.customer_id = target_customers.customer_id
        and tickets.status = 'closed'
    ) as finalized_pos_ticket_count,
    coalesce((
      select sum(coalesce(items.line_total, items.unit_price * items.quantity))
      from public.pos_tickets tickets
      join public.pos_ticket_items items on items.pos_ticket_id = tickets.id
      where tickets.salon_id = p_salon_id
        and tickets.customer_id = target_customers.customer_id
        and tickets.status = 'closed'
        and items.is_removed = false
    ), 0) as finalized_spend,
    (
      select max(visits.visited_at)
      from (
        select bookings.start_at as visited_at
        from public.bookings bookings
        where bookings.salon_id = p_salon_id
          and bookings.customer_id = target_customers.customer_id
          and bookings.status in ('completed', 'confirmed')
          and bookings.start_at <= now()
        union all
        select tickets.closed_at as visited_at
        from public.pos_tickets tickets
        where tickets.salon_id = p_salon_id
          and tickets.customer_id = target_customers.customer_id
          and tickets.status = 'closed'
          and tickets.closed_at is not null
      ) visits
    ) as last_visit_at,
    (
      select bookings.id
      from public.bookings bookings
      where bookings.salon_id = p_salon_id
        and bookings.customer_id = target_customers.customer_id
        and bookings.start_at >= now()
        and bookings.status not in ('cancelled', 'no_show')
      order by bookings.start_at
      limit 1
    ) as upcoming_booking_id,
    (
      select bookings.start_at
      from public.bookings bookings
      where bookings.salon_id = p_salon_id
        and bookings.customer_id = target_customers.customer_id
        and bookings.start_at >= now()
        and bookings.status not in ('cancelled', 'no_show')
      order by bookings.start_at
      limit 1
    ) as upcoming_start_at
  from target_customers
$$;

create or replace function public.save_service_config_batch(
  p_salon_id uuid,
  p_configs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  config jsonb;
  saved_service_id uuid;
  saved_service_ids uuid[] := array[]::uuid[];
  add_on_id uuid;
  staff_id_value uuid;
  display_order_value integer;
begin
  if jsonb_typeof(coalesce(p_configs, '[]'::jsonb)) <> 'array' then
    raise exception 'Service configs must be an array.';
  end if;

  for config in select value from jsonb_array_elements(p_configs)
  loop
    saved_service_id := nullif(config ->> 'service_id', '')::uuid;

    if saved_service_id is null then
      insert into public.services (
        salon_id,
        name,
        category,
        base_price,
        duration_minutes,
        description,
        is_active,
        online_booking_enabled
      )
      values (
        p_salon_id,
        nullif(btrim(config ->> 'name'), ''),
        nullif(btrim(coalesce(config ->> 'category', '')), ''),
        coalesce((config ->> 'base_price')::numeric, 0),
        greatest(coalesce((config ->> 'duration_minutes')::integer, 30), 1),
        nullif(btrim(coalesce(config ->> 'description', '')), ''),
        coalesce((config ->> 'is_active')::boolean, true),
        coalesce((config ->> 'online_booking_enabled')::boolean, false)
      )
      returning id into saved_service_id;
    else
      update public.services
      set name = nullif(btrim(config ->> 'name'), ''),
          category = nullif(btrim(coalesce(config ->> 'category', '')), ''),
          base_price = coalesce((config ->> 'base_price')::numeric, 0),
          duration_minutes = greatest(coalesce((config ->> 'duration_minutes')::integer, 30), 1),
          description = nullif(btrim(coalesce(config ->> 'description', '')), ''),
          is_active = coalesce((config ->> 'is_active')::boolean, true),
          online_booking_enabled = coalesce((config ->> 'online_booking_enabled')::boolean, false)
      where id = saved_service_id
        and salon_id = p_salon_id;

      if not found then
        raise exception 'Service does not belong to salon.';
      end if;
    end if;

    saved_service_ids := array_append(saved_service_ids, saved_service_id);

    delete from public.service_add_on_links
    where salon_id = p_salon_id
      and parent_service_id = saved_service_id;

    display_order_value := 0;
    for add_on_id in
      select value::text::uuid
      from jsonb_array_elements_text(coalesce(config -> 'add_on_service_ids', '[]'::jsonb))
    loop
      display_order_value := display_order_value + 1;
      insert into public.service_add_on_links (
        salon_id,
        parent_service_id,
        add_on_service_id,
        is_active,
        display_order
      )
      values (p_salon_id, saved_service_id, add_on_id, true, display_order_value)
      on conflict (parent_service_id, add_on_service_id) do update
      set is_active = true,
          display_order = excluded.display_order;
    end loop;

    delete from public.staff_service_assignments
    where salon_id = p_salon_id
      and service_id = saved_service_id;

    for staff_id_value in
      select value::text::uuid
      from jsonb_array_elements_text(coalesce(config -> 'booking_staff_ids', '[]'::jsonb))
    loop
      insert into public.staff_service_assignments (
        salon_id,
        staff_id,
        service_id,
        is_active,
        online_bookable
      )
      values (p_salon_id, staff_id_value, saved_service_id, true, true)
      on conflict (staff_id, service_id) do update
      set is_active = true,
          online_bookable = true;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'service_ids', saved_service_ids);
end;
$$;

create or replace function public.save_staff_weekly_availability(
  p_salon_id uuid,
  p_staff_id uuid,
  p_rules jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rule jsonb;
begin
  if not exists (
    select 1 from public.staff where id = p_staff_id and salon_id = p_salon_id
  ) then
    raise exception 'Staff must belong to salon.';
  end if;

  delete from public.staff_availability_rules
  where salon_id = p_salon_id
    and staff_id = p_staff_id;

  for rule in select value from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb))
  loop
    insert into public.staff_availability_rules (
      salon_id,
      staff_id,
      rule_type,
      day_of_week,
      starts_at_local,
      ends_at_local,
      timezone_iana,
      effective_start_date,
      effective_end_date,
      is_active
    )
    values (
      p_salon_id,
      p_staff_id,
      case when rule ->> 'rule_type' = 'break' then 'break' else 'working' end,
      (rule ->> 'day_of_week')::integer,
      (rule ->> 'starts_at_local')::time,
      (rule ->> 'ends_at_local')::time,
      coalesce(nullif(rule ->> 'timezone_iana', ''), 'America/Chicago'),
      nullif(rule ->> 'effective_start_date', '')::date,
      nullif(rule ->> 'effective_end_date', '')::date,
      true
    );
  end loop;
end;
$$;

create or replace function public.create_staff_time_block(
  p_salon_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_block_type text,
  p_timezone_iana text default 'America/Chicago',
  p_reason text default null,
  p_override_conflicts boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_block_id uuid;
  conflicts jsonb;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'Time block end must be after start.';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff where id = p_staff_id and salon_id = p_salon_id
  ) then
    raise exception 'Staff must belong to salon.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_id', booking_lines.booking_id,
    'booking_line_id', booking_lines.id,
    'customer_name', customers.name,
    'scheduled_start_at', booking_lines.scheduled_start_at,
    'scheduled_end_at', booking_lines.scheduled_end_at,
    'status', bookings.status
  )), '[]'::jsonb)
  into conflicts
  from public.booking_lines
  join public.bookings on bookings.id = booking_lines.booking_id
  join public.customers on customers.id = bookings.customer_id
  where booking_lines.salon_id = p_salon_id
    and booking_lines.assigned_staff_id = p_staff_id
    and booking_lines.line_status not in ('cancelled', 'completed')
    and booking_lines.scheduled_start_at < p_ends_at
    and booking_lines.scheduled_end_at > p_starts_at;

  if not p_override_conflicts and jsonb_array_length(conflicts) > 0 then
    return jsonb_build_object(
      'ok', false,
      'message', 'Time block conflicts with existing bookings.',
      'conflicts', conflicts
    );
  end if;

  insert into public.staff_time_blocks (
    salon_id,
    staff_id,
    block_type,
    starts_at,
    ends_at,
    timezone_iana,
    reason,
    is_active
  )
  values (
    p_salon_id,
    p_staff_id,
    coalesce(nullif(p_block_type, ''), 'blocked'),
    p_starts_at,
    p_ends_at,
    coalesce(nullif(p_timezone_iana, ''), 'America/Chicago'),
    nullif(btrim(coalesce(p_reason, '')), ''),
    true
  )
  returning id into new_block_id;

  return jsonb_build_object('ok', true, 'block_id', new_block_id);
end;
$$;

create or replace function public.cancel_staff_time_block(
  p_salon_id uuid,
  p_block_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_time_blocks
  set is_active = false,
      cancelled_at = now(),
      cancelled_by_user_id = public.current_public_user_id()
  where id = p_block_id
    and salon_id = p_salon_id;

  if not found then
    raise exception 'Time block was not found.';
  end if;
end;
$$;

create or replace function public.start_assigned_booking_line(
  p_booking_line_id uuid,
  p_service_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_line public.booking_lines%rowtype;
begin
  select *
  into target_line
  from public.booking_lines
  where id = p_booking_line_id
  limit 1;

  if target_line.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Booking line was not found.');
  end if;

  update public.booking_lines
  set line_status = 'in_progress',
      started_at = coalesce(started_at, now()),
      service_note = nullif(btrim(coalesce(p_service_note, '')), '')
  where id = target_line.id;

  return jsonb_build_object('ok', true, 'booking_line_id', target_line.id);
end;
$$;

create or replace function public.complete_assigned_booking_line(
  p_booking_line_id uuid,
  p_service_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_line public.booking_lines%rowtype;
begin
  select *
  into target_line
  from public.booking_lines
  where id = p_booking_line_id
  limit 1;

  if target_line.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Booking line was not found.');
  end if;

  update public.booking_lines
  set line_status = 'completed',
      started_at = coalesce(started_at, now()),
      completed_at = now(),
      performed_by_staff_id = coalesce(performed_by_staff_id, assigned_staff_id),
      service_note = nullif(btrim(coalesce(p_service_note, '')), '')
  where id = target_line.id;

  return jsonb_build_object('ok', true, 'booking_line_id', target_line.id);
end;
$$;

create or replace function public.convert_booking_to_pos_ticket(p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  new_ticket_id uuid;
  next_sequence integer;
  line_row public.booking_lines%rowtype;
begin
  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
  limit 1;

  if booking_row.id is null then
    raise exception 'Booking was not found.';
  end if;

  if booking_row.pos_ticket_id is not null then
    return booking_row.pos_ticket_id;
  end if;

  select coalesce(max(ticket_sequence), 0) + 1
  into next_sequence
  from public.pos_tickets
  where salon_id = booking_row.salon_id;

  insert into public.pos_tickets (
    salon_id,
    source_booking_id,
    ticket_number,
    ticket_sequence,
    customer_id,
    status
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'T' || lpad(next_sequence::text, 5, '0'),
    next_sequence,
    booking_row.customer_id,
    'open'
  )
  returning id into new_ticket_id;

  for line_row in
    select *
    from public.booking_lines
    where booking_id = booking_row.id
      and salon_id = booking_row.salon_id
      and line_status <> 'cancelled'
    order by display_order
  loop
    insert into public.pos_ticket_items (
      salon_id,
      pos_ticket_id,
      service_id,
      assigned_staff_id,
      source_booking_id,
      source_booking_line_id,
      source_kind,
      service_name_snapshot,
      service_category_snapshot,
      service_description_snapshot,
      booked_unit_price_snapshot,
      quantity,
      unit_price,
      line_total,
      notes
    )
    values (
      booking_row.salon_id,
      new_ticket_id,
      line_row.service_id,
      line_row.assigned_staff_id,
      booking_row.id,
      line_row.id,
      'booking',
      line_row.service_name_snapshot,
      line_row.service_category_snapshot,
      line_row.service_description_snapshot,
      line_row.unit_price,
      line_row.quantity,
      line_row.unit_price,
      line_row.line_total,
      line_row.service_note
    );
  end loop;

  update public.bookings
  set pos_ticket_id = new_ticket_id
  where id = booking_row.id;

  return new_ticket_id;
end;
$$;

create or replace function public.get_public_booking_context(
  target_salon_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'state',
      case
        when settings.salon_id is null then 'not_found'
        when settings.public_discovery_enabled is not true then 'not_public'
        when booking_settings.booking_enabled is not true
          or booking_settings.online_booking_visible is not true
          or booking_settings.guest_booking_enabled is not true
        then 'booking_disabled'
        else 'ready'
      end,
    'profile',
      jsonb_build_object(
        'salon_id', salons.id,
        'name', salons.name,
        'phone', salons.phone,
        'address_line1', salons.address_line1,
        'city', salons.city,
        'state', salons.state,
        'tagline', settings.public_profile_tagline,
        'website', settings.website,
        'email', settings.email,
        'logo_path', settings.public_profile_logo_path,
        'cover_path', settings.public_profile_cover_path
      ),
    'settings', to_jsonb(booking_settings),
    'services',
      coalesce((
        select jsonb_agg(to_jsonb(services) order by services.name)
        from public.services
        where services.salon_id = target_salon_id
          and services.is_active = true
          and services.online_booking_enabled = true
      ), '[]'::jsonb),
    'add_on_links',
      coalesce((
        select jsonb_agg(to_jsonb(service_add_on_links) order by service_add_on_links.display_order)
        from public.service_add_on_links
        where service_add_on_links.salon_id = target_salon_id
          and service_add_on_links.is_active = true
      ), '[]'::jsonb),
    'staff',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', staff.id,
          'display_name', staff.display_name,
          'job_title', staff.job_title,
          'avatar_path', staff.public_profile_photo_path,
          'bio', staff.public_bio,
          'specialties', staff.specialties
        ) order by staff.profile_display_order, staff.display_name)
        from public.staff
        where staff.salon_id = target_salon_id
          and staff.is_active = true
          and staff.online_booking_enabled = true
      ), '[]'::jsonb),
    'assignments',
      coalesce((
        select jsonb_agg(to_jsonb(staff_service_assignments))
        from public.staff_service_assignments
        where staff_service_assignments.salon_id = target_salon_id
          and staff_service_assignments.is_active = true
          and staff_service_assignments.online_bookable = true
      ), '[]'::jsonb),
    'availability_rules',
      coalesce((
        select jsonb_agg(to_jsonb(staff_availability_rules))
        from public.staff_availability_rules
        where staff_availability_rules.salon_id = target_salon_id
          and staff_availability_rules.is_active = true
      ), '[]'::jsonb),
    'time_blocks',
      coalesce((
        select jsonb_agg(to_jsonb(staff_time_blocks))
        from public.staff_time_blocks
        where staff_time_blocks.salon_id = target_salon_id
          and staff_time_blocks.is_active = true
          and staff_time_blocks.starts_at < p_range_end
          and staff_time_blocks.ends_at > p_range_start
      ), '[]'::jsonb),
    'busy_lines',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'booking_id', booking_lines.booking_id,
          'staff_id', booking_lines.assigned_staff_id,
          'scheduled_start_at', booking_lines.scheduled_start_at,
          'scheduled_end_at', booking_lines.scheduled_end_at
        ))
        from public.booking_lines
        join public.bookings on bookings.id = booking_lines.booking_id
        where booking_lines.salon_id = target_salon_id
          and booking_lines.assigned_staff_id is not null
          and booking_lines.scheduled_start_at < p_range_end
          and booking_lines.scheduled_end_at > p_range_start
          and bookings.status not in ('cancelled', 'no_show')
      ), '[]'::jsonb),
    'looks',
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', looks.id,
          'title', looks.title,
          'caption', looks.caption,
          'media_path', looks.media_path,
          'booking_note', looks.booking_note,
          'recommended_staff_id', looks.recommended_staff_id,
          'recommended_staff_name', recommended_staff.display_name,
          'service_id', looks.service_id,
          'service_name', services.name
        ) order by looks.is_pinned desc, looks.published_at desc)
        from public.salon_profile_looks looks
        left join public.staff recommended_staff on recommended_staff.id = looks.recommended_staff_id
        left join public.services services on services.id = looks.service_id
        where looks.salon_id = target_salon_id
          and looks.status = 'published'
      ), '[]'::jsonb)
  )
  from public.locations salons
  left join public.salon_settings settings on settings.salon_id = salons.id
  left join public.booking_settings booking_settings on booking_settings.salon_id = salons.id
  where salons.id = target_salon_id
$$;

create or replace function public.create_public_booking(
  p_salon_id uuid,
  p_customer_first_name text,
  p_customer_last_name text,
  p_customer_phone text,
  p_customer_email text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_lines jsonb,
  p_public_notes text default null,
  p_source text default 'public_profile',
  p_source_reference_type text default null,
  p_source_reference_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_booking public.bookings%rowtype;
  saved_customer public.customers%rowtype;
  new_booking_id uuid;
  line_item jsonb;
  line_service public.services%rowtype;
  manage_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  selected_confirmation_mode text;
  booking_status text;
begin
  if p_idempotency_key is not null then
    select *
    into existing_booking
    from public.bookings
    where salon_id = p_salon_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if existing_booking.id is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'booking_id', existing_booking.id,
        'manage_token', existing_booking.customer_cancellation_token_hash,
        'status', existing_booking.status,
        'confirmation_status', existing_booking.confirmation_status
      );
    end if;
  end if;

  select booking_settings.confirmation_mode
  into selected_confirmation_mode
  from public.booking_settings
  where salon_id = p_salon_id;

  selected_confirmation_mode := coalesce(selected_confirmation_mode, 'request_confirmation');
  booking_status := case when selected_confirmation_mode = 'instant_booking' then 'confirmed' else 'pending' end;

  insert into public.customers (
    location_id,
    name,
    phone,
    email,
    status
  )
  values (
    p_salon_id,
    nullif(btrim(concat_ws(' ', p_customer_first_name, p_customer_last_name)), ''),
    nullif(btrim(coalesce(p_customer_phone, '')), ''),
    nullif(btrim(coalesce(p_customer_email, '')), ''),
    'active'
  )
  returning * into saved_customer;

  insert into public.bookings (
    salon_id,
    customer_id,
    start_at,
    end_at,
    public_notes,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    customer_cancellation_token_hash,
    source_reference_type,
    source_reference_id,
    idempotency_key
  )
  values (
    p_salon_id,
    saved_customer.id,
    p_start_at,
    p_end_at,
    nullif(btrim(coalesce(p_public_notes, '')), ''),
    booking_status,
    coalesce(nullif(p_source, ''), 'public_profile'),
    selected_confirmation_mode,
    case when selected_confirmation_mode = 'instant_booking' then 'confirmed' else 'requested' end,
    coalesce((select timezone_iana from public.booking_settings where salon_id = p_salon_id), 'America/Chicago'),
    manage_token,
    p_source_reference_type,
    p_source_reference_id,
    p_idempotency_key
  )
  returning id into new_booking_id;

  for line_item in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    select *
    into line_service
    from public.services
    where id = (line_item ->> 'service_id')::uuid
      and salon_id = p_salon_id
    limit 1;

    if line_service.id is null then
      raise exception 'Booking service does not belong to salon.';
    end if;

    insert into public.booking_lines (
      salon_id,
      booking_id,
      line_type,
      service_id,
      service_name_snapshot,
      service_category_snapshot,
      service_description_snapshot,
      unit_price,
      quantity,
      line_total,
      duration_minutes,
      cleanup_buffer_minutes,
      display_order,
      assigned_staff_id,
      scheduled_start_at,
      scheduled_end_at,
      line_status
    )
    values (
      p_salon_id,
      new_booking_id,
      case when line_item ->> 'line_type' = 'add_on' then 'add_on' else 'service' end,
      line_service.id,
      line_service.name,
      line_service.category,
      line_service.description,
      line_service.base_price,
      1,
      line_service.base_price,
      line_service.duration_minutes,
      coalesce((line_item ->> 'cleanup_buffer_minutes')::integer, 0),
      coalesce((line_item ->> 'display_order')::integer, 0),
      nullif(line_item ->> 'assigned_staff_id', '')::uuid,
      (line_item ->> 'scheduled_start_at')::timestamptz,
      (line_item ->> 'scheduled_end_at')::timestamptz,
      'scheduled'
    );
  end loop;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    new_status,
    actor_source
  )
  values (
    p_salon_id,
    new_booking_id,
    'booking_created',
    booking_status,
    'public'
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'booking_id', new_booking_id,
    'manage_token', manage_token,
    'status', booking_status,
    'confirmation_status', case when selected_confirmation_mode = 'instant_booking' then 'confirmed' else 'requested' end
  );
end;
$$;

create or replace function public.get_public_booking_by_manage_token(raw_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'booking', jsonb_build_object(
      'id', bookings.id,
      'salon_id', bookings.salon_id,
      'start_at', bookings.start_at,
      'end_at', bookings.end_at,
      'status', bookings.status,
      'source', bookings.source,
      'confirmation_status', bookings.confirmation_status,
      'public_notes', bookings.public_notes,
      'cancelled_at', bookings.cancelled_at,
      'cancellation_reason', bookings.cancellation_reason,
      'timezone', bookings.salon_timezone_snapshot,
      'can_change', bookings.status not in ('cancelled', 'completed', 'no_show') and bookings.start_at > now()
    ),
    'salon', jsonb_build_object(
      'name', salons.name,
      'phone', salons.phone,
      'address_line1', salons.address_line1,
      'city', salons.city,
      'state', salons.state,
      'timezone', coalesce(settings.timezone_iana, bookings.salon_timezone_snapshot)
    ),
    'customer', jsonb_build_object(
      'name', customers.name,
      'phone', customers.phone,
      'email', customers.email
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'service_id', booking_lines.service_id,
        'staff_id', booking_lines.assigned_staff_id,
        'scheduled_start_at', booking_lines.scheduled_start_at,
        'scheduled_end_at', booking_lines.scheduled_end_at,
        'duration_minutes', booking_lines.duration_minutes,
        'line_type', booking_lines.line_type,
        'parent_service_id', null,
        'service_name', booking_lines.service_name_snapshot,
        'staff_name', staff.display_name,
        'unit_price', booking_lines.unit_price
      ) order by booking_lines.display_order)
      from public.booking_lines
      left join public.staff on staff.id = booking_lines.assigned_staff_id
      where booking_lines.booking_id = bookings.id
    ), '[]'::jsonb),
    'inspiration', null
  )
  from public.bookings
  join public.locations salons on salons.id = bookings.salon_id
  join public.customers customers on customers.id = bookings.customer_id
  left join public.booking_settings settings on settings.salon_id = bookings.salon_id
  where bookings.customer_cancellation_token_hash = raw_token
  limit 1
$$;

create or replace function public.reschedule_public_booking_by_manage_token(
  raw_token text,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  delta interval;
  duration interval;
begin
  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash = raw_token
  limit 1;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'not_changeable');
  end if;

  delta := p_start_at - booking_row.start_at;
  duration := booking_row.end_at - booking_row.start_at;

  update public.bookings
  set start_at = p_start_at,
      end_at = p_start_at + duration,
      status = case when status = 'pending' then status else 'confirmed' end,
      confirmation_status = case when confirmation_status = 'requested' then confirmation_status else 'confirmed' end
  where id = booking_row.id;

  update public.booking_lines
  set scheduled_start_at = scheduled_start_at + delta,
      scheduled_end_at = scheduled_end_at + delta
  where booking_id = booking_row.id;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    old_status,
    new_status,
    actor_source
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'booking_rescheduled',
    booking_row.status,
    booking_row.status,
    'public'
  );

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

create or replace function public.cancel_public_booking_by_manage_token(
  raw_token text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
begin
  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash = raw_token
  limit 1;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'not_changeable');
  end if;

  update public.bookings
  set status = 'cancelled',
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      cancelled_at = now()
  where id = booking_row.id;

  update public.booking_lines
  set line_status = 'cancelled'
  where booking_id = booking_row.id;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    old_status,
    new_status,
    actor_source
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'booking_cancelled',
    booking_row.status,
    'cancelled',
    'public'
  );

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

create or replace function public.seed_default_roles_for_account(target_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_role_id uuid;
  manager_role_id uuid;
  staff_role_id uuid;
begin
  insert into public.roles (account_id, name, code, description, is_system)
  values
    (target_account_id, 'Owner', 'OWNER', 'Full account and salon access.', true),
    (target_account_id, 'Manager', 'MANAGER', 'Manage salon operations.', true),
    (target_account_id, 'Staff', 'STAFF', 'Staff workspace access.', true)
  on conflict (account_id, code) do update
  set name = excluded.name,
      description = excluded.description,
      is_system = excluded.is_system
  ;

  select id into owner_role_id from public.roles where account_id = target_account_id and code = 'OWNER';
  select id into manager_role_id from public.roles where account_id = target_account_id and code = 'MANAGER';
  select id into staff_role_id from public.roles where account_id = target_account_id and code = 'STAFF';

  insert into public.permissions (code, name, description, category, is_system)
  values
    ('staff.view', 'View staff', 'View staff.', 'Staff', true),
    ('staff.manage', 'Manage staff', 'Manage staff.', 'Staff', true),
    ('booking.view', 'View booking', 'View booking.', 'Booking', true),
    ('booking.manage', 'Manage booking', 'Manage booking.', 'Booking', true),
    ('tickets.view', 'View tickets', 'View POS tickets.', 'Tickets', true),
    ('tickets.manage', 'Manage tickets', 'Manage POS tickets.', 'Tickets', true),
    ('tickets.void', 'Void tickets', 'Void and reopen tickets.', 'Tickets', true),
    ('payroll.view', 'View payroll', 'View payroll.', 'Payroll', true),
    ('payroll.manage', 'Manage payroll', 'Manage payroll.', 'Payroll', true),
    ('payroll.tax_company', 'Tax company payroll', 'View tax company payroll.', 'Payroll', true),
    ('reports.view', 'View reports', 'View reports.', 'Reports', true),
    ('customers.view', 'View customers', 'View customers.', 'Customers', true),
    ('customers.manage', 'Manage customers', 'Manage customers.', 'Customers', true),
    ('services.view', 'View services', 'View services.', 'Services', true),
    ('services.manage', 'Manage services', 'Manage services.', 'Services', true),
    ('salon_settings.view', 'View salon settings', 'View salon settings.', 'Settings', true),
    ('salon_settings.manage', 'Manage salon settings', 'Manage salon settings.', 'Settings', true),
    ('salon_profile.view', 'View salon profile', 'View salon profile.', 'Salon', true),
    ('salon_profile.manage', 'Manage salon profile', 'Manage salon profile.', 'Salon', true),
    ('salon_profile.content.manage', 'Manage salon content', 'Manage salon profile content.', 'Salon', true),
    ('financial_corrections.request', 'Request corrections', 'Request financial corrections.', 'Reports', true),
    ('financial_corrections.apply', 'Apply corrections', 'Apply financial corrections.', 'Reports', true)
  on conflict (code) do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select owner_role_id, permissions.id from public.permissions
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select manager_role_id, permissions.id
  from public.permissions
  where permissions.code <> 'payroll.tax_company'
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select staff_role_id, permissions.id
  from public.permissions
  where permissions.code in ('booking.view', 'tickets.view', 'salon_profile.view')
  on conflict do nothing;
end;
$$;

create or replace function public.ensure_personal_account_for_current_user(
  p_account_name text default null
)
returns table (
  account_id uuid,
  account_membership_id uuid,
  created_account boolean,
  created_membership boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  account_name text;
  existing_account_id uuid;
  existing_membership_id uuid;
  owner_role_id uuid;
  target_account_id uuid;
  target_membership_id uuid;
  user_row public.users%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = actor_user_id;

  if user_row.id is null or user_row.status <> 'active' then
    raise exception 'Active public user is required.';
  end if;

  select memberships.account_id, memberships.id
  into existing_account_id, existing_membership_id
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  join public.accounts accounts on accounts.id = memberships.account_id
  where memberships.user_id = actor_user_id
    and memberships.status = 'active'
    and accounts.status = 'active'
    and upper(roles.code) = 'OWNER'
  order by memberships.created_at, memberships.id
  limit 1;

  if existing_account_id is not null then
    account_id := existing_account_id;
    account_membership_id := existing_membership_id;
    created_account := false;
    created_membership := false;
    return next;
    return;
  end if;

  account_name := nullif(btrim(p_account_name), '');
  if account_name is null then
    account_name := coalesce(
      nullif(btrim(user_row.display_name), ''),
      nullif(split_part(coalesce(user_row.email, ''), '@', 1), ''),
      'Personal Account'
    );
  end if;

  insert into public.accounts (name, status)
  values (account_name, 'active')
  returning id into target_account_id;

  perform public.seed_default_roles_for_account(target_account_id);

  select id
  into owner_role_id
  from public.roles
  where roles.account_id = target_account_id
    and roles.code = 'OWNER';

  if owner_role_id is null then
    raise exception 'Owner role could not be provisioned for account.';
  end if;

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  values (
    target_account_id,
    actor_user_id,
    owner_role_id,
    'active',
    now()
  )
  returning id into target_membership_id;

  account_id := target_account_id;
  account_membership_id := target_membership_id;
  created_account := true;
  created_membership := true;
  return next;
end;
$$;

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
  select
    users.id,
    users.avatar_url,
    users.display_name,
    case when users.email is null then null else left(users.email, 2) || '***' end,
    case when users.phone is null then null else '***' || right(users.phone, 4) end,
    case
      when p_email is not null and lower(users.email) = lower(p_email)
        and p_phone is not null and users.phone = p_phone then 'email_phone'
      when p_email is not null and lower(users.email) = lower(p_email) then 'email'
      else 'phone'
    end
  from public.users
  where exists (
    select 1
    from public.locations salons
    where salons.id = target_salon_id
      and salons.account_id = target_account_id
  )
  and (
    (p_email is not null and lower(users.email) = lower(p_email))
    or (p_phone is not null and users.phone = p_phone)
  )
  limit 2
$$;

create or replace function public.update_staff_public_team_batch(
  target_account_id uuid,
  target_salon_id uuid,
  changes jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_count integer := 0;
  item jsonb;
begin
  if not exists (
    select 1 from public.locations
    where id = target_salon_id and account_id = target_account_id
  ) then
    raise exception 'Salon is not part of the selected account.';
  end if;

  for item in select * from jsonb_array_elements(coalesce(changes, '[]'::jsonb))
  loop
    update public.staff
    set online_booking_enabled = coalesce((item->>'online_booking_enabled')::boolean, online_booking_enabled),
        owner_public_enabled = coalesce((item->>'owner_public_enabled')::boolean, owner_public_enabled),
        profile_display_order = coalesce((item->>'profile_display_order')::integer, profile_display_order),
        salon_profile_content_posting_enabled = coalesce((item->>'salon_profile_content_posting_enabled')::boolean, salon_profile_content_posting_enabled)
    where id = (item->>'staff_id')::uuid
      and salon_id = target_salon_id;

    get diagnostics changed_count = row_count;
  end loop;

  return changed_count;
end;
$$;

create or replace function public.salon_profile_public_salon_exists(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.salon_settings settings
    join public.locations salons on salons.id = settings.salon_id
    where settings.salon_id = target_salon_id
      and settings.public_discovery_enabled = true
      and salons.status = 'active'
  )
$$;

create or replace function public.get_public_salon_profile(target_salon_id uuid)
returns table (
  account_id uuid,
  salon_id uuid,
  salon_name text,
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  description text,
  tagline text,
  story text,
  logo_path text,
  cover_path text,
  public_discovery_published_at timestamptz,
  active_service_count bigint,
  follower_count bigint,
  is_following boolean,
  service_categories text[],
  service_names text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    salons.account_id,
    settings.salon_id,
    settings.business_name,
    settings.phone,
    settings.email,
    settings.website,
    settings.address_line1,
    settings.address_line2,
    settings.city,
    settings.state,
    settings.postal_code,
    settings.country,
    settings.business_description,
    settings.public_profile_tagline,
    settings.public_profile_story,
    settings.public_profile_logo_path,
    settings.public_profile_cover_path,
    settings.public_discovery_published_at,
    (select count(*) from public.services where services.salon_id = settings.salon_id and services.is_active = true),
    (select count(*) from public.salon_profile_follows follows where follows.salon_id = settings.salon_id),
    false,
    coalesce(array(select distinct category from public.services where salon_id = settings.salon_id and category is not null), '{}'),
    coalesce(array(select name from public.services where salon_id = settings.salon_id and is_active = true order by name), '{}')
  from public.salon_settings settings
  join public.locations salons on salons.id = settings.salon_id
  where settings.salon_id = target_salon_id
    and public.salon_profile_public_salon_exists(target_salon_id)
$$;

create or replace function public.get_public_salon_profile_services(target_salon_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  base_price numeric,
  duration_minutes integer,
  description text
)
language sql
stable
as $$
  select id, name, category, base_price, duration_minutes, description
  from public.services
  where salon_id = target_salon_id
    and is_active = true
    and online_booking_enabled = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by name
$$;

create or replace function public.get_public_salon_profile_staff(target_salon_id uuid)
returns table (
  id uuid,
  display_name text,
  job_title text,
  avatar_path text,
  bio text,
  online_booking_enabled boolean,
  specialties text[],
  portfolio_count bigint
)
language sql
stable
as $$
  select
    staff.id,
    staff.display_name,
    staff.job_title,
    staff.public_profile_photo_path,
    staff.public_bio,
    staff.online_booking_enabled,
    staff.specialties,
    (select count(*) from public.salon_profile_looks looks where looks.author_staff_id = staff.id and looks.status = 'published')
  from public.staff
  where staff.salon_id = target_salon_id
    and staff.is_active = true
    and staff.public_profile_visible = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by staff.profile_display_order, staff.display_name
$$;

create or replace function public.get_public_salon_profile_looks(target_salon_id uuid)
returns table (
  id uuid,
  title text,
  caption text,
  emotional_description text,
  why_love_it text,
  mood text,
  duration_minutes integer,
  starting_price numeric,
  palette text[],
  badge text,
  media_path text,
  booking_note text,
  is_pinned boolean,
  published_at timestamptz,
  author_user_id uuid,
  author_display_name text,
  author_avatar_path text,
  author_staff_id uuid,
  recommended_staff_id uuid,
  recommended_staff_name text,
  service_id uuid,
  service_name text,
  save_count bigint,
  comment_count bigint,
  is_saved boolean,
  hashtags text[]
)
language sql
stable
as $$
  select
    looks.id,
    looks.title,
    looks.caption,
    looks.emotional_description,
    looks.why_love_it,
    looks.mood,
    looks.duration_minutes,
    looks.starting_price,
    looks.palette,
    looks.badge,
    looks.media_path,
    looks.booking_note,
    looks.is_pinned,
    looks.published_at,
    looks.author_user_id,
    looks.author_display_name,
    looks.author_avatar_path,
    looks.author_staff_id,
    looks.recommended_staff_id,
    recommended_staff.display_name,
    looks.service_id,
    services.name,
    (select count(*) from public.salon_profile_look_saves saves where saves.look_id = looks.id),
    (select count(*) from public.salon_profile_comments comments where comments.look_id = looks.id and comments.status in ('visible', 'published')),
    false,
    '{}'::text[]
  from public.salon_profile_looks looks
  left join public.staff recommended_staff on recommended_staff.id = looks.recommended_staff_id
  left join public.services services on services.id = looks.service_id
  where looks.salon_id = target_salon_id
    and looks.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by looks.is_pinned desc, looks.published_at desc nulls last
$$;

create or replace function public.get_public_salon_profile_updates(target_salon_id uuid)
returns table (
  id uuid,
  update_type text,
  title text,
  caption text,
  summary text,
  media_path text,
  starts_at timestamptz,
  ends_at timestamptz,
  cta_label text,
  published_at timestamptz,
  author_user_id uuid,
  author_display_name text,
  author_avatar_path text,
  author_staff_id uuid,
  service_id uuid,
  service_name text,
  staff_id uuid,
  staff_name text,
  comment_count bigint,
  hashtags text[]
)
language sql
stable
as $$
  select
    updates.id,
    updates.update_type,
    updates.title,
    updates.caption,
    updates.summary,
    updates.media_path,
    updates.starts_at,
    updates.ends_at,
    updates.cta_label,
    updates.published_at,
    updates.author_user_id,
    updates.author_display_name,
    updates.author_avatar_path,
    updates.author_staff_id,
    updates.service_id,
    services.name,
    updates.staff_id,
    staff.display_name,
    (select count(*) from public.salon_profile_comments comments where comments.update_id = updates.id and comments.status = 'published'),
    '{}'::text[]
  from public.salon_profile_updates updates
  left join public.services services on services.id = updates.service_id
  left join public.staff staff on staff.id = updates.staff_id
  where updates.salon_id = target_salon_id
    and updates.status = 'published'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by updates.published_at desc nulls last
$$;

create or replace function public.get_public_salon_profile_comments(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  look_id uuid,
  update_id uuid,
  parent_comment_id uuid,
  author_user_id uuid,
  author_display_name text,
  body text,
  is_salon_reply boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
as $$
  select id, salon_id, look_id, update_id, parent_comment_id, author_user_id, author_display_name, body, is_salon_reply, created_at, updated_at
  from public.salon_profile_comments
  where salon_id = target_salon_id
    and status in ('visible', 'published')
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by created_at asc
$$;

create or replace function public.get_public_salon_profile_review_summary(target_salon_id uuid)
returns table (
  average_rating numeric,
  rating_1_count bigint,
  rating_2_count bigint,
  rating_3_count bigint,
  rating_4_count bigint,
  rating_5_count bigint,
  review_count bigint,
  verified_count bigint
)
language sql
stable
as $$
  select
    avg(rating)::numeric,
    count(*) filter (where rating = 1),
    count(*) filter (where rating = 2),
    count(*) filter (where rating = 3),
    count(*) filter (where rating = 4),
    count(*) filter (where rating = 5),
    count(*),
    count(*) filter (where verification_status = 'verified')
  from public.salon_profile_reviews
  where salon_id = target_salon_id
    and moderation_status = 'visible'
    and public.salon_profile_public_salon_exists(target_salon_id)
$$;

create or replace function public.get_public_salon_profile_reviews(target_salon_id uuid)
returns table (
  id uuid,
  salon_id uuid,
  author_user_id uuid,
  author_display_name text,
  rating integer,
  title text,
  body text,
  verification_status text,
  verified_booking_id uuid,
  edited_at timestamptz,
  reply_id uuid,
  reply_body text,
  reply_created_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
as $$
  select
    reviews.id,
    reviews.salon_id,
    reviews.author_user_id,
    users.display_name,
    reviews.rating,
    reviews.title,
    reviews.body,
    reviews.verification_status,
    reviews.verified_booking_id,
    reviews.edited_at,
    replies.id,
    replies.body,
    replies.created_at,
    reviews.created_at,
    reviews.updated_at
  from public.salon_profile_reviews reviews
  left join public.users on users.id = reviews.author_user_id
  left join lateral (
    select id, body, created_at
    from public.salon_profile_review_replies
    where review_id = reviews.id
      and moderation_status = 'visible'
    order by created_at desc
    limit 1
  ) replies on true
  where reviews.salon_id = target_salon_id
    and reviews.moderation_status = 'visible'
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by reviews.created_at desc
$$;

create or replace function public.get_public_explore_decision_signals(target_salon_ids uuid[] default null)
returns table (
  salon_id uuid,
  average_rating numeric,
  review_count bigint,
  bookable_service_id uuid,
  bookable_service_name text,
  booking_enabled boolean,
  booking_href text,
  next_available_at timestamptz,
  next_availability_label text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    salons.id,
    review_summary.average_rating,
    coalesce(review_summary.review_count, 0),
    bookable_service.id,
    bookable_service.name,
    coalesce(booking_settings.booking_enabled, false)
      and coalesce(booking_settings.online_booking_visible, false)
      and coalesce(booking_settings.guest_booking_enabled, true)
      and bookable_service.id is not null,
    case
      when coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true)
        and bookable_service.id is not null
        then '/book/' || salons.id::text
      else null
    end,
    null::timestamptz,
    case
      when coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true)
        and bookable_service.id is not null
        then 'Request a time'
      else null
    end
  from public.locations salons
  join public.salon_settings settings on settings.salon_id = salons.id
  left join public.booking_settings on booking_settings.salon_id = salons.id
  left join lateral (
    select services.id, services.name
    from public.services
    where services.salon_id = salons.id
      and services.is_active = true
      and services.online_booking_enabled = true
    order by services.name
    limit 1
  ) bookable_service on true
  left join lateral (
    select
      avg(reviews.rating)::numeric as average_rating,
      count(*) as review_count
    from public.salon_profile_reviews reviews
    where reviews.salon_id = salons.id
      and reviews.moderation_status = 'visible'
  ) review_summary on true
  where salons.status = 'active'
    and settings.public_discovery_enabled = true
    and (target_salon_ids is null or salons.id = any(target_salon_ids))
$$;

create or replace function public.get_public_explore_home_salons(
  p_recommended_limit integer default 6,
  p_new_limit integer default 6
)
returns table (
  salon_id uuid,
  salon_name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  description text,
  public_discovery_published_at timestamptz,
  profile_completeness integer,
  active_service_count bigint,
  service_categories text[],
  service_names text[],
  section text,
  home_rank bigint,
  is_new boolean,
  created_at timestamptz,
  updated_at timestamptz,
  cover_image_path text,
  latest_media_created_at timestamptz,
  featured_service_category text,
  featured_service_name text,
  has_public_profile boolean,
  starting_price numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with public_salons as (
    select
      salons.id as salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.phone, salons.phone) as phone,
      coalesce(settings.address_line1, salons.address_line1) as address_line1,
      coalesce(settings.address_line2, salons.address_line2) as address_line2,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state,
      coalesce(settings.postal_code, salons.postal_code) as postal_code,
      coalesce(settings.country, salons.country) as country,
      salons.latitude,
      salons.longitude,
      settings.business_description as description,
      settings.public_discovery_published_at,
      (
        case when settings.public_discovery_enabled then 20 else 0 end
        + case when nullif(settings.business_description, '') is not null then 20 else 0 end
        + case when nullif(settings.public_profile_cover_path, '') is not null then 20 else 0 end
        + case when exists (select 1 from public.services where services.salon_id = salons.id and services.is_active = true) then 20 else 0 end
        + case when coalesce(booking_settings.booking_enabled, false) then 20 else 0 end
      )::integer as profile_completeness,
      (select count(*) from public.services where services.salon_id = salons.id and services.is_active = true) as active_service_count,
      coalesce(array(
        select distinct services.category
        from public.services
        where services.salon_id = salons.id
          and services.is_active = true
          and nullif(services.category, '') is not null
        order by services.category
      ), '{}'::text[]) as service_categories,
      coalesce(array(
        select services.name
        from public.services
        where services.salon_id = salons.id
          and services.is_active = true
        order by services.name
        limit 8
      ), '{}'::text[]) as service_names,
      (salons.created_at >= now() - interval '30 days') as is_new,
      salons.created_at,
      salons.updated_at,
      coalesce(
        nullif(settings.public_profile_cover_path, ''),
        (
          select media.object_path
          from public.salon_profile_media_assets media
          where media.salon_id = salons.id
            and media.status = 'active'
            and media.deleted_at is null
            and media.purpose in ('cover', 'look', 'update')
          order by case when media.purpose = 'cover' then 0 else 1 end, media.created_at desc
          limit 1
        )
      ) as cover_image_path,
      (
        select max(media.created_at)
        from public.salon_profile_media_assets media
        where media.salon_id = salons.id
          and media.status = 'active'
          and media.deleted_at is null
      ) as latest_media_created_at,
      featured_service.category as featured_service_category,
      featured_service.name as featured_service_name,
      true as has_public_profile,
      (select min(services.base_price) from public.services where services.salon_id = salons.id and services.is_active = true) as starting_price
    from public.locations salons
    join public.salon_settings settings on settings.salon_id = salons.id
    left join public.booking_settings on booking_settings.salon_id = salons.id
    left join lateral (
      select services.category, services.name
      from public.services
      where services.salon_id = salons.id
        and services.is_active = true
        and services.online_booking_enabled = true
      order by services.name
      limit 1
    ) featured_service on true
    where salons.status = 'active'
      and settings.public_discovery_enabled = true
  ),
  recommended as (
    select public_salons.*, 'recommended'::text as section, row_number() over (
      order by public_discovery_published_at desc nulls last, profile_completeness desc, updated_at desc
    ) as home_rank
    from public_salons
    order by public_discovery_published_at desc nulls last, profile_completeness desc, updated_at desc
    limit greatest(0, coalesce(p_recommended_limit, 6))
  ),
  new_salons as (
    select public_salons.*, 'new'::text as section, row_number() over (
      order by created_at desc, updated_at desc
    ) as home_rank
    from public_salons
    order by created_at desc, updated_at desc
    limit greatest(0, coalesce(p_new_limit, 6))
  )
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    public_discovery_published_at,
    profile_completeness,
    active_service_count,
    service_categories,
    service_names,
    section,
    home_rank,
    is_new,
    created_at,
    updated_at,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    has_public_profile,
    starting_price
  from recommended
  union all
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    public_discovery_published_at,
    profile_completeness,
    active_service_count,
    service_categories,
    service_names,
    section,
    home_rank,
    is_new,
    created_at,
    updated_at,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    has_public_profile,
    starting_price
  from new_salons
$$;

create or replace function public.get_public_explore_popular_services(p_limit integer default 8)
returns table (
  category text,
  salon_count bigint,
  active_service_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    services.category,
    count(distinct services.salon_id),
    count(*)
  from public.services
  join public.locations salons on salons.id = services.salon_id
  join public.salon_settings settings on settings.salon_id = salons.id
  where salons.status = 'active'
    and settings.public_discovery_enabled = true
    and services.is_active = true
    and services.online_booking_enabled = true
    and nullif(services.category, '') is not null
  group by services.category
  order by count(distinct services.salon_id) desc, count(*) desc, services.category
  limit greatest(0, coalesce(p_limit, 8))
$$;

create or replace function public.search_public_explore_salons(
  p_query text default null,
  p_category text default null,
  p_location text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_page integer default 1,
  p_page_size integer default 12
)
returns table (
  salon_id uuid,
  salon_name text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  description text,
  active_service_count bigint,
  service_categories text[],
  service_names text[],
  cover_image_path text,
  latest_media_created_at timestamptz,
  featured_service_category text,
  featured_service_name text,
  starting_price numeric,
  profile_completeness integer,
  has_public_profile boolean,
  is_new boolean,
  distance_miles double precision,
  match_type text,
  match_tier integer,
  relevance_score double precision,
  result_group text,
  total_count bigint,
  group_total_count bigint,
  best_match_count bigint,
  nearby_count bigint,
  recommended_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select
      nullif(btrim(p_query), '') as query_text,
      nullif(btrim(p_category), '') as category_text,
      nullif(btrim(p_location), '') as location_text,
      case when p_latitude between -90 and 90 then p_latitude else null end as latitude_value,
      case when p_longitude between -180 and 180 then p_longitude else null end as longitude_value,
      greatest(1, coalesce(p_page, 1)) as page_value,
      least(12, greatest(1, coalesce(p_page_size, 12))) as page_size_value
  ),
  public_salons as (
    select
      salons.id as salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.phone, salons.phone) as phone,
      coalesce(settings.address_line1, salons.address_line1) as address_line1,
      coalesce(settings.address_line2, salons.address_line2) as address_line2,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state,
      coalesce(settings.postal_code, salons.postal_code) as postal_code,
      coalesce(settings.country, salons.country) as country,
      salons.latitude,
      salons.longitude,
      settings.business_description as description,
      (
        case when settings.public_discovery_enabled then 20 else 0 end
        + case when nullif(settings.business_description, '') is not null then 20 else 0 end
        + case when nullif(settings.public_profile_cover_path, '') is not null then 20 else 0 end
        + case when exists (select 1 from public.services where services.salon_id = salons.id and services.is_active = true) then 20 else 0 end
        + case when coalesce(booking_settings.booking_enabled, false) then 20 else 0 end
      )::integer as profile_completeness,
      (select count(*) from public.services where services.salon_id = salons.id and services.is_active = true) as active_service_count,
      coalesce(array(
        select distinct services.category
        from public.services
        where services.salon_id = salons.id
          and services.is_active = true
          and nullif(services.category, '') is not null
        order by services.category
      ), '{}'::text[]) as service_categories,
      coalesce(array(
        select services.name
        from public.services
        where services.salon_id = salons.id
          and services.is_active = true
        order by services.name
        limit 8
      ), '{}'::text[]) as service_names,
      coalesce(
        nullif(settings.public_profile_cover_path, ''),
        (
          select media.object_path
          from public.salon_profile_media_assets media
          where media.salon_id = salons.id
            and media.status = 'active'
            and media.deleted_at is null
            and media.purpose in ('cover', 'look', 'update')
          order by case when media.purpose = 'cover' then 0 else 1 end, media.created_at desc
          limit 1
        )
      ) as cover_image_path,
      (
        select max(media.created_at)
        from public.salon_profile_media_assets media
        where media.salon_id = salons.id
          and media.status = 'active'
          and media.deleted_at is null
      ) as latest_media_created_at,
      featured_service.category as featured_service_category,
      featured_service.name as featured_service_name,
      (select min(services.base_price) from public.services where services.salon_id = salons.id and services.is_active = true) as starting_price,
      true as has_public_profile,
      (salons.created_at >= now() - interval '30 days') as is_new,
      salons.created_at,
      salons.updated_at
    from public.locations salons
    cross join normalized
    join public.salon_settings settings on settings.salon_id = salons.id
    left join public.booking_settings on booking_settings.salon_id = salons.id
    left join lateral (
      select services.category, services.name
      from public.services
      where services.salon_id = salons.id
        and services.is_active = true
        and services.online_booking_enabled = true
      order by services.name
      limit 1
    ) featured_service on true
    where salons.status = 'active'
      and settings.public_discovery_enabled = true
      and (
        normalized.category_text is null
        or exists (
          select 1
          from public.services
          where services.salon_id = salons.id
            and services.is_active = true
            and services.category ilike normalized.category_text
        )
      )
      and (
        normalized.location_text is null
        or coalesce(settings.city, salons.city, '') ilike '%' || normalized.location_text || '%'
        or coalesce(settings.state, salons.state, '') ilike '%' || normalized.location_text || '%'
        or coalesce(settings.postal_code, salons.postal_code, '') ilike '%' || normalized.location_text || '%'
      )
  ),
  scored as (
    select
      public_salons.*,
      case
        when normalized.latitude_value is not null
          and normalized.longitude_value is not null
          and public_salons.latitude is not null
          and public_salons.longitude is not null
          then 3958.8 * acos(least(1, greatest(-1,
            sin(radians(normalized.latitude_value)) * sin(radians(public_salons.latitude))
            + cos(radians(normalized.latitude_value)) * cos(radians(public_salons.latitude))
            * cos(radians(public_salons.longitude) - radians(normalized.longitude_value))
          )))
        else null
      end as distance_miles,
      (
        normalized.query_text is null
        or public_salons.salon_name ilike '%' || normalized.query_text || '%'
        or coalesce(public_salons.description, '') ilike '%' || normalized.query_text || '%'
        or exists (
          select 1
          from unnest(public_salons.service_names || public_salons.service_categories) as terms(term)
          where terms.term ilike '%' || normalized.query_text || '%'
        )
      ) as query_matches,
      normalized.query_text is not null or normalized.category_text is not null as has_best_match_filter,
      normalized.page_value,
      normalized.page_size_value
    from public_salons
    cross join normalized
  ),
  grouped as (
    select
      scored.*,
      case
        when scored.has_best_match_filter and scored.query_matches then 'best_match'
        when scored.distance_miles is not null then 'nearby'
        else 'recommended'
      end as result_group,
      case
        when scored.has_best_match_filter and scored.query_matches then 'search'
        when scored.distance_miles is not null then 'distance'
        else 'recommended'
      end as match_type,
      case
        when scored.has_best_match_filter and scored.query_matches then 1
        when scored.distance_miles is not null then 2
        else 3
      end as match_tier,
      (
        scored.profile_completeness::double precision
        + case when scored.query_matches then 50 else 0 end
        + case when scored.is_new then 10 else 0 end
        - coalesce(scored.distance_miles, 0) / 10
      ) as relevance_score
    from scored
    where scored.query_matches
  ),
  counted as (
    select
      grouped.*,
      count(*) over () as total_count,
      count(*) filter (where grouped.result_group = 'best_match') over () as best_match_count,
      count(*) filter (where grouped.result_group = 'nearby') over () as nearby_count,
      count(*) filter (where grouped.result_group = 'recommended') over () as recommended_count,
      count(*) over (partition by grouped.result_group) as group_total_count
    from grouped
  )
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    active_service_count,
    service_categories,
    service_names,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    starting_price,
    profile_completeness,
    has_public_profile,
    is_new,
    distance_miles,
    match_type,
    match_tier,
    relevance_score,
    result_group,
    total_count,
    group_total_count,
    best_match_count,
    nearby_count,
    recommended_count
  from counted
  order by match_tier, distance_miles nulls last, relevance_score desc, updated_at desc
  limit (select page_size_value from normalized)
  offset (select (page_value - 1) * page_size_value from normalized)
$$;

create or replace function public.get_public_explore_inspiration(
  p_cursor_media_id uuid default null,
  p_cursor_published_at timestamptz default null,
  p_page_size integer default 18
)
returns table (
  media_id uuid,
  content_id uuid,
  content_type text,
  salon_id uuid,
  salon_name text,
  salon_city text,
  salon_state text,
  salon_phone text,
  media_path text,
  image_width integer,
  image_height integer,
  aspect_ratio numeric,
  caption_excerpt text,
  published_at timestamptz,
  author_display_name text,
  author_is_anonymous boolean,
  service_name text,
  service_category text,
  bookable_service_id uuid,
  booking_enabled boolean,
  booking_href text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select least(24, greatest(1, coalesce(p_page_size, 18))) as page_size_value
  ),
  content_rows as (
    select
      coalesce(media.id, looks.id) as media_id,
      looks.id as content_id,
      'look'::text as content_type,
      looks.salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.city, salons.city) as salon_city,
      coalesce(settings.state, salons.state) as salon_state,
      coalesce(settings.phone, salons.phone) as salon_phone,
      looks.media_path,
      media.width as image_width,
      media.height as image_height,
      case when media.width is not null and media.height is not null and media.height > 0 then media.width::numeric / media.height::numeric else null end as aspect_ratio,
      left(coalesce(looks.caption, looks.title), 180) as caption_excerpt,
      looks.published_at,
      looks.author_display_name,
      false as author_is_anonymous,
      services.name as service_name,
      services.category as service_category,
      case when services.is_active and services.online_booking_enabled then services.id else null end as bookable_service_id,
      coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true)
        and services.is_active
        and services.online_booking_enabled as booking_enabled,
      case
        when coalesce(booking_settings.booking_enabled, false)
          and coalesce(booking_settings.online_booking_visible, false)
          and coalesce(booking_settings.guest_booking_enabled, true)
          and services.is_active
          and services.online_booking_enabled
          then '/book/' || looks.salon_id::text
        else null
      end as booking_href
    from public.salon_profile_looks looks
    join public.locations salons on salons.id = looks.salon_id
    join public.salon_settings settings on settings.salon_id = looks.salon_id
    left join public.services on services.id = looks.service_id
    left join public.booking_settings on booking_settings.salon_id = looks.salon_id
    left join public.salon_profile_media_assets media
      on media.salon_id = looks.salon_id
      and media.object_path = looks.media_path
      and media.status = 'active'
      and media.deleted_at is null
    where looks.status = 'published'
      and looks.published_at is not null
      and nullif(looks.media_path, '') is not null
      and salons.status = 'active'
      and settings.public_discovery_enabled = true
    union all
    select
      coalesce(media.id, updates.id) as media_id,
      updates.id as content_id,
      'update'::text as content_type,
      updates.salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.city, salons.city) as salon_city,
      coalesce(settings.state, salons.state) as salon_state,
      coalesce(settings.phone, salons.phone) as salon_phone,
      updates.media_path,
      media.width as image_width,
      media.height as image_height,
      case when media.width is not null and media.height is not null and media.height > 0 then media.width::numeric / media.height::numeric else null end as aspect_ratio,
      left(coalesce(updates.caption, updates.summary, updates.title), 180) as caption_excerpt,
      updates.published_at,
      updates.author_display_name,
      false as author_is_anonymous,
      services.name as service_name,
      services.category as service_category,
      case when services.is_active and services.online_booking_enabled then services.id else null end as bookable_service_id,
      coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true)
        and services.is_active
        and services.online_booking_enabled as booking_enabled,
      case
        when coalesce(booking_settings.booking_enabled, false)
          and coalesce(booking_settings.online_booking_visible, false)
          and coalesce(booking_settings.guest_booking_enabled, true)
          and services.is_active
          and services.online_booking_enabled
          then '/book/' || updates.salon_id::text
        else null
      end as booking_href
    from public.salon_profile_updates updates
    join public.locations salons on salons.id = updates.salon_id
    join public.salon_settings settings on settings.salon_id = updates.salon_id
    left join public.services on services.id = updates.service_id
    left join public.booking_settings on booking_settings.salon_id = updates.salon_id
    left join public.salon_profile_media_assets media
      on media.salon_id = updates.salon_id
      and media.object_path = updates.media_path
      and media.status = 'active'
      and media.deleted_at is null
    where updates.status = 'published'
      and updates.published_at is not null
      and nullif(updates.media_path, '') is not null
      and salons.status = 'active'
      and settings.public_discovery_enabled = true
  )
  select
    media_id,
    content_id,
    content_type,
    salon_id,
    salon_name,
    salon_city,
    salon_state,
    salon_phone,
    media_path,
    image_width,
    image_height,
    aspect_ratio,
    caption_excerpt,
    published_at,
    author_display_name,
    author_is_anonymous,
    service_name,
    service_category,
    bookable_service_id,
    booking_enabled,
    booking_href
  from content_rows
  where p_cursor_published_at is null
    or published_at < p_cursor_published_at
    or (
      published_at = p_cursor_published_at
      and (p_cursor_media_id is null or media_id < p_cursor_media_id)
    )
  order by published_at desc, media_id desc
  limit (select page_size_value + 1 from normalized)
$$;

create or replace function public.get_public_content_booking_options(target_salon_ids uuid[] default null)
returns table (
  content_id uuid,
  source_type text,
  content_type text,
  salon_id uuid,
  title text,
  caption text,
  media_path text,
  credited_staff_id uuid,
  credited_staff_name text,
  booking_cta_enabled boolean,
  booking_enabled boolean,
  booking_href text,
  booking_note text,
  cta_label text,
  readiness_state text,
  readiness_message text,
  primary_service_id uuid,
  primary_service_name text,
  primary_service_base_price numeric,
  primary_service_duration_minutes integer,
  add_ons jsonb,
  additional_services jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(configs.look_id, configs.update_id),
    configs.source_type,
    case when configs.source_type = 'salon_profile_update' then 'update' else 'look' end,
    configs.salon_id,
    coalesce(looks.title, updates.title),
    coalesce(looks.caption, updates.caption),
    coalesce(looks.media_path, updates.media_path),
    configs.credited_staff_id,
    staff.display_name,
    configs.booking_cta_enabled,
    booking_settings.booking_enabled,
    case when configs.booking_cta_enabled then '/booking/' || configs.salon_id::text else null end,
    configs.booking_note,
    configs.cta_label,
    case when configs.primary_service_id is null then 'inspiration_only' else 'service_ready' end,
    'Choose services and a professional.',
    services.id,
    services.name,
    services.base_price,
    services.duration_minutes,
    '[]'::jsonb,
    '[]'::jsonb
  from public.salon_profile_content_booking_configs configs
  left join public.salon_profile_looks looks on looks.id = configs.look_id
  left join public.salon_profile_updates updates on updates.id = configs.update_id
  left join public.staff staff on staff.id = configs.credited_staff_id
  left join public.services services on services.id = configs.primary_service_id
  left join public.booking_settings on booking_settings.salon_id = configs.salon_id
  where (target_salon_ids is null or configs.salon_id = any(target_salon_ids))
    and public.salon_profile_public_salon_exists(configs.salon_id)
    and (
      (configs.look_id is not null and looks.status = 'published')
      or (configs.update_id is not null and updates.status = 'published')
    )
$$;

create or replace function public.create_canonical_booking(
  p_actor_source text,
  p_confirmation_mode text,
  p_confirmation_status text,
  p_customer_id uuid,
  p_customer_user_id uuid,
  p_end_at timestamptz,
  p_idempotency_key text,
  p_internal_notes text,
  p_lines jsonb,
  p_overbooking_override_reason text,
  p_public_notes text,
  p_salon_id uuid,
  p_source text,
  p_start_at timestamptz,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_booking_id uuid;
  line_item jsonb;
begin
  insert into public.bookings (
    salon_id,
    customer_id,
    customer_user_id,
    start_at,
    end_at,
    public_notes,
    internal_notes,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    idempotency_key
  )
  values (
    p_salon_id,
    p_customer_id,
    p_customer_user_id,
    p_start_at,
    p_end_at,
    p_public_notes,
    p_internal_notes,
    p_status,
    p_source,
    p_confirmation_mode,
    p_confirmation_status,
    p_idempotency_key
  )
  returning id into new_booking_id;

  for line_item in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    insert into public.booking_lines (
      salon_id,
      booking_id,
      line_type,
      service_id,
      service_name_snapshot,
      service_category_snapshot,
      service_description_snapshot,
      unit_price,
      quantity,
      line_total,
      duration_minutes,
      cleanup_buffer_minutes,
      display_order,
      assigned_staff_id,
      scheduled_start_at,
      scheduled_end_at
    )
    values (
      p_salon_id,
      new_booking_id,
      coalesce(line_item->>'line_type', 'service'),
      nullif(line_item->>'service_id', '')::uuid,
      coalesce(line_item->>'service_name_snapshot', 'Service'),
      line_item->>'service_category_snapshot',
      line_item->>'service_description_snapshot',
      coalesce((line_item->>'unit_price')::numeric, 0),
      coalesce((line_item->>'quantity')::numeric, 1),
      coalesce((line_item->>'unit_price')::numeric, 0) * coalesce((line_item->>'quantity')::numeric, 1),
      coalesce((line_item->>'duration_minutes')::integer, 30),
      coalesce((line_item->>'cleanup_buffer_minutes')::integer, 0),
      coalesce((line_item->>'display_order')::integer, 0),
      nullif(line_item->>'assigned_staff_id', '')::uuid,
      nullif(line_item->>'scheduled_start_at', '')::timestamptz,
      nullif(line_item->>'scheduled_end_at', '')::timestamptz
    );
  end loop;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    new_status,
    actor_source
  )
  values (
    p_salon_id,
    new_booking_id,
    'booking_created',
    p_status,
    p_actor_source
  );

  return new_booking_id;
end;
$$;

create or replace function public.reschedule_canonical_booking(
  p_booking_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_overbooking_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  booking_row public.bookings%rowtype;
  delta interval;
begin
  if actor_user_id is null then
    raise exception 'Sign in required.';
  end if;

  if p_booking_id is null or p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'Booking requires a valid reschedule interval.';
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
  for update;

  if booking_row.id is null then
    raise exception 'Booking was not found.';
  end if;

  if not public.user_has_salon_permission(booking_row.salon_id, array['booking.manage']::text[]) then
    raise exception 'Missing required permission: booking.manage';
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    raise exception 'Terminal bookings cannot be rescheduled.';
  end if;

  delta := p_start_at - booking_row.start_at;

  update public.bookings
  set start_at = p_start_at,
      end_at = p_end_at,
      updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = booking_row.id;

  update public.booking_lines
  set scheduled_start_at = case when scheduled_start_at is null then null else scheduled_start_at + delta end,
      scheduled_end_at = case when scheduled_end_at is null then null else scheduled_end_at + delta end,
      overbooking_override_reason = coalesce(nullif(btrim(coalesce(p_overbooking_override_reason, '')), ''), overbooking_override_reason),
      overbooking_override_by_user_id = case
        when nullif(btrim(coalesce(p_overbooking_override_reason, '')), '') is null then overbooking_override_by_user_id
        else actor_user_id
      end,
      overbooking_override_at = case
        when nullif(btrim(coalesce(p_overbooking_override_reason, '')), '') is null then overbooking_override_at
        else coalesce(overbooking_override_at, now())
      end,
      updated_at = now()
  where booking_id = booking_row.id;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    old_status,
    new_status,
    actor_user_id,
    actor_source,
    metadata
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'rescheduled',
    booking_row.status,
    booking_row.status,
    actor_user_id,
    'manage',
    jsonb_build_object('overbooking_override_reason', nullif(btrim(coalesce(p_overbooking_override_reason, '')), ''))
  );

  return booking_row.id;
end;
$$;

create or replace function public.claim_guest_booking_by_manage_token(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  booking_row public.bookings%rowtype;
  normalized_token text := nullif(btrim(coalesce(raw_token, '')), '');
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_token is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash = normalized_token
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if booking_row.customer_user_id = actor_user_id then
    insert into public.booking_customer_account_claims (
      salon_id,
      booking_id,
      customer_user_id,
      claim_method,
      proof_type,
      claim_status,
      metadata
    )
    values (
      booking_row.salon_id,
      booking_row.id,
      actor_user_id,
      'guest_manage_claim',
      'guest_manage_token',
      'idempotent',
      jsonb_build_object('idempotent', true)
    )
    on conflict (booking_id, customer_user_id, claim_method) do nothing;

    return jsonb_build_object('ok', true, 'booking_id', booking_row.id, 'idempotent', true);
  end if;

  if booking_row.customer_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'booking_not_available');
  end if;

  update public.bookings
  set customer_user_id = actor_user_id,
      customer_account_linked_at = now(),
      customer_account_linked_by_user_id = actor_user_id,
      customer_account_link_method = 'guest_manage_claim',
      customer_account_link_metadata = coalesce(customer_account_link_metadata, '{}'::jsonb)
        || jsonb_build_object('proof_type', 'guest_manage_token'),
      updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = booking_row.id
    and customer_user_id is null
  returning * into booking_row;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'booking_not_available');
  end if;

  insert into public.booking_customer_account_claims (
    salon_id,
    booking_id,
    customer_user_id,
    claim_method,
    proof_type,
    claim_status,
    metadata
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    actor_user_id,
    'guest_manage_claim',
    'guest_manage_token',
    'linked',
    jsonb_build_object('linked_at', booking_row.customer_account_linked_at)
  )
  on conflict (booking_id, customer_user_id, claim_method) do nothing;

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id, 'idempotent', false);
end;
$$;

create or replace function public.cancel_customer_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  booking_row public.bookings%rowtype;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
    and customer_user_id = actor_user_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  if booking_row.start_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'past_booking');
  end if;

  update public.bookings
  set status = 'cancelled',
      confirmation_status = 'cancelled',
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      cancelled_at = now(),
      cancelled_by_user_id = actor_user_id,
      updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = booking_row.id;

  update public.booking_lines
  set line_status = 'cancelled',
      updated_at = now()
  where booking_id = booking_row.id;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    old_status,
    new_status,
    actor_user_id,
    actor_source
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'cancelled',
    booking_row.status,
    'cancelled',
    actor_user_id,
    'customer'
  );

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

create or replace function public.reschedule_customer_booking(
  p_booking_id uuid,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  booking_row public.bookings%rowtype;
  delta interval;
  duration interval;
  new_end_at timestamptz;
  settings_row public.booking_settings%rowtype;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
    and customer_user_id = actor_user_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  if p_start_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_time');
  end if;

  select *
  into settings_row
  from public.booking_settings
  where salon_id = booking_row.salon_id;

  if p_start_at < now() + make_interval(mins => coalesce(settings_row.minimum_lead_time_minutes, 120)) then
    return jsonb_build_object('ok', false, 'code', 'lead_time');
  end if;

  if p_start_at > now() + make_interval(days => coalesce(settings_row.maximum_advance_window_days, 60)) then
    return jsonb_build_object('ok', false, 'code', 'advance_window');
  end if;

  duration := booking_row.end_at - booking_row.start_at;
  delta := p_start_at - booking_row.start_at;
  new_end_at := p_start_at + duration;

  update public.bookings
  set start_at = p_start_at,
      end_at = new_end_at,
      status = case when status = 'pending' then status else 'confirmed' end,
      confirmation_status = case when confirmation_status = 'requested' then confirmation_status else 'confirmed' end,
      updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = booking_row.id;

  update public.booking_lines
  set scheduled_start_at = case when scheduled_start_at is null then null else scheduled_start_at + delta end,
      scheduled_end_at = case when scheduled_end_at is null then null else scheduled_end_at + delta end,
      updated_at = now()
  where booking_id = booking_row.id;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    old_status,
    new_status,
    actor_user_id,
    actor_source
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'rescheduled',
    booking_row.status,
    booking_row.status,
    actor_user_id,
    'customer'
  );

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

create or replace function public.update_closed_pos_ticket_tip_for_correction(
  p_ticket_id uuid,
  p_tip_type text,
  p_tip_value numeric
)
returns public.pos_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  target_ticket public.pos_tickets%rowtype;
  updated_ticket public.pos_tickets%rowtype;
begin
  if p_ticket_id is null then
    raise exception 'Ticket id is required.';
  end if;

  if p_tip_type not in ('fixed_amount', 'percentage') then
    raise exception 'Tip Type is required.';
  end if;

  if p_tip_value is null or p_tip_value < 0 then
    raise exception 'Tip cannot be negative.';
  end if;

  if p_tip_type = 'percentage' and p_tip_value > 100 then
    raise exception 'Percentage Tip must be between 0 and 100.';
  end if;

  select *
  into target_ticket
  from public.pos_tickets
  where id = p_ticket_id
  for update;

  if target_ticket.id is null then
    raise exception 'POS Ticket is required.';
  end if;

  if target_ticket.status <> 'closed' then
    raise exception 'Only closed tickets can be corrected with this action.';
  end if;

  if not public.user_has_salon_permission(target_ticket.salon_id, array['tickets.manage', 'tickets.void']::text[]) then
    raise exception 'You do not have permission to correct closed POS tickets.';
  end if;

  update public.pos_tickets
  set tip_type = p_tip_type,
      tip_value = round(p_tip_value, 2),
      updated_at = now()
  where id = p_ticket_id
  returning * into updated_ticket;

  return updated_ticket;
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
      'masked_email', case when request_row.target_email_normalized is null then null else left(request_row.target_email_normalized, 1) || '***' end,
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

  if request_row.account_user_id is not null and request_row.account_user_id <> current_user_id then
    raise exception 'This invitation belongs to a different account.';
  end if;

  if request_row.account_user_id is null then
    if request_row.target_email_normalized is not null
      and lower(btrim(coalesce(current_user_row.email, ''))) is distinct from request_row.target_email_normalized
    then
      raise exception 'This invitation requires an account with the invited email.';
    end if;

    if request_row.target_phone_e164 is not null
      and regexp_replace(coalesce(current_user_row.phone, ''), '\s+', '', 'g') is distinct from request_row.target_phone_e164
    then
      raise exception 'This invitation requires an account with the invited phone.';
    end if;
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
        and target_phone_e164 = request_row.target_phone_e164
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

create or replace function public.accept_staff_connection_invite(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_staff_connection_invite_decision(
    null,
    encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'),
    'accepted'
  )
$$;

create or replace function public.decline_staff_connection_invite(p_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_staff_connection_invite_decision(
    null,
    encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'),
    'declined'
  )
$$;

create or replace function public.accept_staff_connection_invite_by_request(p_request_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_staff_connection_invite_decision(p_request_id, null, 'accepted')
$$;

create or replace function public.decline_staff_connection_invite_by_request(p_request_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_staff_connection_invite_decision(p_request_id, null, 'declined')
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
  request_row public.staff_salon_connection_requests%rowtype;
begin
  select *
  into request_row
  from public.staff_salon_connection_requests
  where id = p_request_id
    and direction = 'salon_invite'
  for update;

  if request_row.id is null then
    raise exception 'Invitation was not found.';
  end if;

  if not public.user_has_salon_permission(request_row.salon_id, array['staff.manage']::text[]) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  if request_row.status not in ('pending', 'expired') then
    raise exception 'Only pending or expired invitations can be resent.';
  end if;

  if nullif(btrim(coalesce(p_token_hash, '')), '') is null then
    raise exception 'A new invite token hash is required.';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Invitation expiration must be in the future.';
  end if;

  update public.staff_salon_connection_requests
  set accepted_at = null,
      cancelled_at = null,
      declined_at = null,
      expires_at = p_expires_at,
      revoked_at = null,
      status = 'pending',
      token_hash = p_token_hash,
      updated_at = now()
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
  current_user_id uuid := public.current_public_user_id();
  request_row public.staff_salon_connection_requests%rowtype;
begin
  select *
  into request_row
  from public.staff_salon_connection_requests
  where id = p_request_id
    and direction = 'salon_invite'
  for update;

  if request_row.id is null then
    raise exception 'Invitation was not found.';
  end if;

  if not public.user_has_salon_permission(request_row.salon_id, array['staff.manage']::text[]) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked.';
  end if;

  update public.staff_salon_connection_requests
  set reviewed_by_user_id = current_user_id,
      revoked_at = now(),
      status = 'revoked',
      token_hash = null,
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object('request_id', request_row.id, 'status', request_row.status);
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
language sql
stable
security definer
set search_path = public
as $$
  select
    salons.id,
    coalesce(settings.business_name, salons.name),
    coalesce(settings.address_line1, salons.address_line1),
    coalesce(settings.address_line2, salons.address_line2),
    coalesce(settings.city, salons.city),
    coalesce(settings.state, salons.state),
    coalesce(settings.postal_code, salons.postal_code),
    coalesce(settings.country, salons.country)
  from public.locations salons
  join public.salon_settings settings on settings.salon_id = salons.id
  where salons.status = 'active'
    and settings.allow_staff_applications = true
    and (
      nullif(btrim(coalesce(p_query, '')), '') is null
      or lower(coalesce(settings.business_name, salons.name)) like '%' || lower(btrim(p_query)) || '%'
      or lower(salons.name) like '%' || lower(btrim(p_query)) || '%'
    )
    and (
      nullif(btrim(coalesce(p_city, '')), '') is null
      or lower(coalesce(settings.city, salons.city, '')) = lower(btrim(p_city))
    )
    and (
      nullif(btrim(coalesce(p_state, '')), '') is null
      or lower(coalesce(settings.state, salons.state, '')) = lower(btrim(p_state))
    )
  order by coalesce(settings.business_name, salons.name)
  limit least(greatest(coalesce(p_limit, 12), 1), 25)
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
  current_user_id uuid := public.current_public_user_id();
  current_user_row public.users%rowtype;
  request_row public.staff_salon_connection_requests%rowtype;
begin
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

  if not exists (
    select 1
    from public.locations salons
    join public.salon_settings settings on settings.salon_id = salons.id
    where salons.id = p_salon_id
      and salons.status = 'active'
      and settings.allow_staff_applications = true
  ) then
    raise exception 'This salon is not accepting staff applications.';
  end if;

  if exists (
    select 1
    from public.staff
    where salon_id = p_salon_id
      and account_user_id = current_user_id
      and is_active = true
  ) then
    raise exception 'Your account is already connected to this salon.';
  end if;

  if exists (
    select 1
    from public.staff_salon_connection_requests
    where salon_id = p_salon_id
      and status = 'pending'
      and account_user_id = current_user_id
  ) then
    raise exception 'A pending connection request already exists for this salon.';
  end if;

  insert into public.staff_salon_connection_requests (
    salon_id,
    account_user_id,
    direction,
    initiated_by_user_id,
    message,
    requested_job_title,
    status
  )
  values (
    p_salon_id,
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
  current_user_id uuid := public.current_public_user_id();
  request_row public.staff_salon_connection_requests%rowtype;
begin
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
  set cancelled_at = now(),
      status = 'cancelled',
      updated_at = now()
  where id = request_row.id
  returning * into request_row;

  return jsonb_build_object('request_id', request_row.id, 'status', request_row.status);
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
  current_user_id uuid := public.current_public_user_id();
  account_row public.users%rowtype;
  accepted_staff_id uuid;
  request_row public.staff_salon_connection_requests%rowtype;
  staff_row public.staff%rowtype;
begin
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

  if not public.user_has_salon_permission(request_row.salon_id, array['staff.manage']::text[]) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'Only pending applications can be reviewed.';
  end if;

  if p_decision = 'declined' then
    update public.staff_salon_connection_requests
    set declined_at = now(),
        reviewed_by_user_id = current_user_id,
        status = 'declined',
        updated_at = now()
    where id = request_row.id
    returning * into request_row;

    return jsonb_build_object('request_id', request_row.id, 'status', request_row.status);
  end if;

  if p_decision <> 'accepted' then
    raise exception 'Application decision must be accepted or declined.';
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
      and salon_id = request_row.salon_id
    for update;

    if staff_row.id is null or staff_row.is_active is not true then
      raise exception 'Selected staff profile was not found.';
    end if;

    if staff_row.account_user_id is not null then
      raise exception 'Selected staff profile is already connected.';
    end if;

    update public.staff
    set account_user_id = request_row.account_user_id,
        job_title = coalesce(nullif(btrim(coalesce(p_job_title, '')), ''), job_title),
        updated_at = now()
    where id = staff_row.id
    returning * into staff_row;
  else
    insert into public.staff (
      salon_id,
      account_user_id,
      display_name,
      phone,
      email,
      job_title,
      is_active
    )
    values (
      request_row.salon_id,
      request_row.account_user_id,
      coalesce(nullif(btrim(coalesce(p_display_name, '')), ''), account_row.display_name, account_row.email, 'Staff'),
      coalesce(nullif(btrim(coalesce(p_phone, '')), ''), account_row.phone),
      coalesce(nullif(btrim(coalesce(p_email, '')), ''), account_row.email),
      coalesce(nullif(btrim(coalesce(p_job_title, '')), ''), request_row.requested_job_title),
      true
    )
    returning * into staff_row;
  end if;

  accepted_staff_id := staff_row.id;

  update public.staff_salon_connection_requests
  set accepted_at = now(),
      reviewed_by_user_id = current_user_id,
      staff_id = accepted_staff_id,
      status = 'accepted',
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

  update public.staff_salon_connection_requests
  set status = 'expired',
      updated_at = now()
  where direction = 'salon_invite'
    and status = 'pending'
    and expires_at is not null
    and expires_at <= now()
    and (
      account_user_id = current_user_id
      or (
        account_user_id is null
        and current_user_row.email is not null
        and target_email_normalized = lower(btrim(current_user_row.email))
      )
      or (
        account_user_id is null
        and current_user_row.phone is not null
        and target_phone_e164 = regexp_replace(current_user_row.phone, '\s+', '', 'g')
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

create or replace function public.save_salon_profile_content_booking_config(
  p_source_type text,
  p_content_id uuid,
  p_booking_cta_enabled boolean default true,
  p_primary_service_id uuid default null,
  p_credited_staff_id uuid default null,
  p_additional_service_ids uuid[] default '{}'::uuid[],
  p_booking_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  content_look_id uuid;
  content_update_id uuid;
  saved_config_id uuid;
  service_id_value uuid;
  service_order integer := 0;
  salon_id_value uuid;
begin
  if p_source_type = 'salon_profile_look' then
    select looks.salon_id, looks.id, null::uuid
    into salon_id_value, content_look_id, content_update_id
    from public.salon_profile_looks looks
    where looks.id = p_content_id;
  elsif p_source_type = 'salon_profile_update' then
    select updates.salon_id, null::uuid, updates.id
    into salon_id_value, content_look_id, content_update_id
    from public.salon_profile_updates updates
    where updates.id = p_content_id;
  else
    raise exception 'Unsupported content booking source type.';
  end if;

  if salon_id_value is null then
    raise exception 'Content was not found.';
  end if;

  if not public.user_has_salon_permission(salon_id_value, array['salon_profile.manage', 'salon_profile.content.manage']::text[]) then
    raise exception 'You do not have permission to manage booking setup for this content.';
  end if;

  if p_primary_service_id is not null and not exists (
    select 1
    from public.services
    where id = p_primary_service_id
      and salon_id = salon_id_value
      and is_active = true
  ) then
    raise exception 'Choose an active service from this salon.';
  end if;

  if p_credited_staff_id is not null and not exists (
    select 1
    from public.staff
    where id = p_credited_staff_id
      and salon_id = salon_id_value
      and is_active = true
  ) then
    raise exception 'Choose an active professional from this salon.';
  end if;

  select id
  into saved_config_id
  from public.salon_profile_content_booking_configs
  where (
    p_source_type = 'salon_profile_look'
    and look_id = content_look_id
  )
  or (
    p_source_type = 'salon_profile_update'
    and update_id = content_update_id
  )
  limit 1;

  if saved_config_id is null then
    insert into public.salon_profile_content_booking_configs (
      salon_id,
      source_type,
      look_id,
      update_id,
      booking_cta_enabled,
      primary_service_id,
      credited_staff_id,
      booking_note
    )
    values (
      salon_id_value,
      p_source_type,
      content_look_id,
      content_update_id,
      coalesce(p_booking_cta_enabled, false),
      p_primary_service_id,
      p_credited_staff_id,
      nullif(btrim(coalesce(p_booking_note, '')), '')
    )
    returning id into saved_config_id;
  else
    update public.salon_profile_content_booking_configs
    set booking_cta_enabled = coalesce(p_booking_cta_enabled, false),
        primary_service_id = p_primary_service_id,
        credited_staff_id = p_credited_staff_id,
        booking_note = nullif(btrim(coalesce(p_booking_note, '')), ''),
        updated_at = now()
    where id = saved_config_id;
  end if;

  delete from public.salon_profile_content_booking_services
  where config_id = saved_config_id;

  foreach service_id_value in array coalesce(p_additional_service_ids, '{}'::uuid[])
  loop
    if service_id_value is not null and service_id_value is distinct from p_primary_service_id then
      if not exists (
        select 1
        from public.services
        where id = service_id_value
          and salon_id = salon_id_value
          and is_active = true
      ) then
        raise exception 'Additional services must belong to this salon.';
      end if;

      service_order := service_order + 1;

      insert into public.salon_profile_content_booking_services (
        salon_id,
        config_id,
        service_id,
        service_role,
        display_order
      )
      values (
        salon_id_value,
        saved_config_id,
        service_id_value,
        'additional_service',
        service_order
      )
      on conflict (config_id, service_id) do nothing;
    end if;
  end loop;

  return saved_config_id;
end;
$$;

do $$
declare
  routine_signature regprocedure;
begin
  for routine_signature in
    select pg_proc.oid::regprocedure
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
  loop
    execute format(
      'alter function %s set search_path = public, extensions',
      routine_signature
    );
  end loop;
end $$;

insert into public.salon_profile_plan_catalog (id, name, description, is_default, is_active)
values (
  'grandfathered',
  'Grandfathered',
  'Backward-compatible default limits for existing salons.',
  true,
  true
)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    is_default = excluded.is_default,
    is_active = excluded.is_active,
    updated_at = now();

insert into public.salon_profile_entitlement_definitions (code, name, description, value_type)
values
  ('posts_per_day', 'Posts per day', 'Published Salon Profile posts allowed per UTC day.', 'integer'),
  ('posts_per_month', 'Posts per month', 'Published Salon Profile posts allowed per UTC month.', 'integer'),
  ('storage_bytes', 'Storage bytes', 'Processed Salon Profile media storage allowed.', 'bytes'),
  ('max_media_per_post', 'Max media per post', 'Maximum media attachments per Salon Profile post.', 'integer'),
  ('review_media_enabled', 'Review media enabled', 'Whether customer review media is enabled.', 'boolean'),
  ('verified_business_enabled', 'Verified business enabled', 'Whether verified business profile features are enabled.', 'boolean'),
  ('staff_portfolio_enabled', 'Staff portfolio enabled', 'Whether staff public portfolio features are enabled.', 'boolean')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    value_type = excluded.value_type,
    updated_at = now();

insert into public.salon_profile_plan_entitlements (
  plan_id,
  entitlement_code,
  limit_value,
  period
)
values
  ('grandfathered', 'posts_per_day', 1000, 'day'),
  ('grandfathered', 'posts_per_month', 30000, 'month'),
  ('grandfathered', 'storage_bytes', 107374182400, 'none'),
  ('grandfathered', 'max_media_per_post', 1, 'none'),
  ('grandfathered', 'review_media_enabled', 0, 'none'),
  ('grandfathered', 'verified_business_enabled', 1, 'none'),
  ('grandfathered', 'staff_portfolio_enabled', 1, 'none')
on conflict (plan_id, entitlement_code) do update
set limit_value = excluded.limit_value,
    period = excluded.period,
    updated_at = now();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'salon-profile-media',
    'salon-profile-media',
    true,
    15728640,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'payroll-paystubs',
    'payroll-paystubs',
    false,
    10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.users enable row level security;
alter table public.accounts enable row level security;
alter table public.locations enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.account_memberships enable row level security;
alter table public.salon_memberships enable row level security;
alter table public.customers enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.service_add_on_links enable row level security;
alter table public.salon_settings enable row level security;
alter table public.booking_settings enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_lines enable row level security;
alter table public.booking_status_events enable row level security;
alter table public.booking_customer_account_claims enable row level security;
alter table public.pos_tickets enable row level security;
alter table public.pos_ticket_items enable row level security;
alter table public.pos_ticket_item_turn_parts enable row level security;
alter table public.pos_payments enable row level security;
alter table public.pos_ticket_audit_logs enable row level security;
alter table public.pos_desk_sessions enable row level security;
alter table public.pos_desk_session_lines enable row level security;
alter table public.pos_display_channels enable row level security;
alter table public.pos_live_drafts enable row level security;
alter table public.staff_workdays enable row level security;
alter table public.pos_ticket_staff_earnings enable row level security;
alter table public.pos_ticket_adjustments enable row level security;
alter table public.pos_daily_closings enable row level security;
alter table public.pos_daily_closing_staff_snapshots enable row level security;
alter table public.pos_financial_correction_requests enable row level security;
alter table public.pos_financial_adjustments enable row level security;
alter table public.salon_payroll_settings enable row level security;
alter table public.staff_payroll_settings enable row level security;
alter table public.payroll_period_staff_inputs enable row level security;
alter table public.payroll_period_staff_input_history enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_staff_lines enable row level security;
alter table public.payroll_staff_daily_totals enable row level security;
alter table public.payroll_paystubs enable row level security;
alter table public.staff_salon_connection_requests enable row level security;
alter table public.salon_profile_media_assets enable row level security;
alter table public.salon_profile_plan_catalog enable row level security;
alter table public.salon_profile_entitlement_definitions enable row level security;
alter table public.salon_profile_plan_entitlements enable row level security;
alter table public.salon_profile_subscriptions enable row level security;
alter table public.salon_profile_entitlement_overrides enable row level security;
alter table public.salon_profile_usage_events enable row level security;
alter table public.salon_profile_looks enable row level security;
alter table public.salon_profile_updates enable row level security;
alter table public.salon_profile_hashtags enable row level security;
alter table public.salon_profile_look_hashtags enable row level security;
alter table public.salon_profile_update_hashtags enable row level security;
alter table public.salon_profile_comments enable row level security;
alter table public.salon_profile_reviews enable row level security;
alter table public.salon_profile_review_replies enable row level security;
alter table public.salon_profile_look_saves enable row level security;
alter table public.salon_profile_follows enable row level security;
alter table public.account_favorite_customers enable row level security;
alter table public.salon_profile_booking_requests enable row level security;
alter table public.salon_profile_content_booking_configs enable row level security;
alter table public.salon_profile_content_booking_services enable row level security;
alter table public.booking_inspirations enable row level security;
alter table public.app_notifications enable row level security;
alter table public.staff_service_assignments enable row level security;
alter table public.staff_availability_rules enable row level security;
alter table public.staff_time_blocks enable row level security;

create policy "users_self_read" on public.users
for select to authenticated
using (auth_user_id = auth.uid() or id = public.current_public_user_id());

create policy "users_self_insert" on public.users
for insert to authenticated
with check (auth_user_id = auth.uid());

create policy "users_self_update" on public.users
for update to authenticated
using (id = public.current_public_user_id())
with check (id = public.current_public_user_id() and auth_user_id = auth.uid());

create policy "account_member_read_accounts" on public.accounts
for select to authenticated
using (public.user_belongs_to_account(id));

create policy "account_owner_write_accounts" on public.accounts
for update to authenticated
using (public.user_has_account_permission(id, array['account.manage']))
with check (public.user_has_account_permission(id, array['account.manage']));

create policy "account_member_read_locations" on public.locations
for select to authenticated
using (public.user_belongs_to_account(account_id));

create policy "account_owner_write_locations" on public.locations
for all to authenticated
using (public.user_has_account_permission(account_id, array['salon_settings.manage']))
with check (public.user_has_account_permission(account_id, array['salon_settings.manage']));

create policy "public_read_published_salons" on public.salon_settings
for select to anon, authenticated
using (public_discovery_enabled = true);

create policy "salon_member_read_settings" on public.salon_settings
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "salon_manager_write_settings" on public.salon_settings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_settings.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_settings.manage']));

create policy "account_member_read_roles" on public.roles
for select to authenticated
using (public.user_belongs_to_account(account_id));

create policy "public_read_permissions" on public.permissions
for select to authenticated
using (auth.role() = 'authenticated');

create policy "account_member_read_role_permissions" on public.role_permissions
for select to authenticated
using (exists (
  select 1 from public.roles
  where roles.id = role_permissions.role_id
    and public.user_belongs_to_account(roles.account_id)
));

create policy "member_read_account_memberships" on public.account_memberships
for select to authenticated
using (public.user_belongs_to_account(account_id));

create policy "member_read_salon_memberships" on public.salon_memberships
for select to authenticated
using (public.user_belongs_to_account(account_id) or user_id = public.current_public_user_id());

create policy "salon_member_read_customers" on public.customers
for select to authenticated
using (
  public.user_can_manage_salon(location_id)
  or customer_user_id = public.current_public_user_id()
);

create policy "salon_manager_write_customers" on public.customers
for all to authenticated
using (public.user_has_salon_permission(location_id, array['customers.manage']))
with check (public.user_has_salon_permission(location_id, array['customers.manage']));

create policy "salon_member_read_staff" on public.staff
for select to authenticated
using (public.user_can_manage_salon(salon_id) or account_user_id = public.current_public_user_id());

create policy "salon_manager_write_staff" on public.staff
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['staff.manage']))
with check (public.user_has_salon_permission(salon_id, array['staff.manage']));

create policy "salon_member_read_services" on public.services
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "public_read_active_services" on public.services
for select to anon
using (is_active = true and online_booking_enabled = true and public.salon_profile_public_salon_exists(salon_id));

create policy "salon_manager_write_services" on public.services
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['services.manage']))
with check (public.user_has_salon_permission(salon_id, array['services.manage']));

create policy "salon_member_read_operational_rows" on public.service_add_on_links
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "salon_manager_write_operational_rows" on public.service_add_on_links
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['services.manage']))
with check (public.user_has_salon_permission(salon_id, array['services.manage']));

create policy "salon_member_read_booking_setup" on public.booking_settings
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "salon_manager_write_booking_setup" on public.booking_settings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['booking.manage']))
with check (public.user_has_salon_permission(salon_id, array['booking.manage']));

create policy "salon_member_read_bookings" on public.bookings
for select to authenticated
using (public.user_can_manage_salon(salon_id) or customer_user_id = public.current_public_user_id());

create policy "salon_manager_write_bookings" on public.bookings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['booking.manage']))
with check (public.user_has_salon_permission(salon_id, array['booking.manage']));

create policy "salon_member_read_booking_lines" on public.booking_lines
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "salon_manager_write_booking_lines" on public.booking_lines
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['booking.manage']))
with check (public.user_has_salon_permission(salon_id, array['booking.manage']));

create policy "salon_member_read_booking_events" on public.booking_status_events
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "customer_read_own_booking_claims" on public.booking_customer_account_claims
for select to authenticated
using (
  customer_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['booking.view', 'booking.manage'])
);

create policy "salon_member_read_pos" on public.pos_tickets
for select to authenticated
using (public.user_can_manage_salon(salon_id));

create policy "salon_manager_write_pos" on public.pos_tickets
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_items" on public.pos_ticket_items
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_items" on public.pos_ticket_items
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_item_turn_parts" on public.pos_ticket_item_turn_parts
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_item_turn_parts" on public.pos_ticket_item_turn_parts
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_payments" on public.pos_payments
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_payments" on public.pos_payments
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_audit_logs" on public.pos_ticket_audit_logs
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_insert_audit_logs" on public.pos_ticket_audit_logs
for insert to authenticated
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_pos_desk_sessions" on public.pos_desk_sessions
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_pos_desk_sessions" on public.pos_desk_sessions
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_pos_desk_lines" on public.pos_desk_session_lines
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_pos_desk_lines" on public.pos_desk_session_lines
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_display_channels" on public.pos_display_channels
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_display_channels" on public.pos_display_channels
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "ticket_member_read_live_drafts" on public.pos_live_drafts
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage']));

create policy "ticket_manager_write_live_drafts" on public.pos_live_drafts
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "staff_read_own_workdays" on public.staff_workdays
for select to authenticated
using (public.user_can_read_staff_scoped_row(salon_id, staff_id));

create policy "staff_update_own_workdays" on public.staff_workdays
for update to authenticated
using (public.user_can_read_staff_scoped_row(salon_id, staff_id))
with check (public.user_can_read_staff_scoped_row(salon_id, staff_id));

create policy "ticket_manager_write_workdays" on public.staff_workdays
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage', 'staff.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage', 'staff.manage']));

create policy "ticket_member_read_staff_earnings" on public.pos_ticket_staff_earnings
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage', 'payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "ticket_manager_write_staff_earnings" on public.pos_ticket_staff_earnings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage']));

create policy "financial_member_read_ticket_adjustments" on public.pos_ticket_adjustments
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.view', 'tickets.manage', 'reports.view']));

create policy "financial_manager_write_ticket_adjustments" on public.pos_ticket_adjustments
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage', 'financial_corrections.apply']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage', 'financial_corrections.apply']));

create policy "financial_member_read_daily_closings" on public.pos_daily_closings
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['reports.view', 'tickets.view', 'payroll.view']));

create policy "financial_manager_write_daily_closings" on public.pos_daily_closings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['tickets.manage', 'financial_corrections.apply']))
with check (public.user_has_salon_permission(salon_id, array['tickets.manage', 'financial_corrections.apply']));

create policy "financial_member_read_daily_closing_staff_snapshots" on public.pos_daily_closing_staff_snapshots
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['reports.view', 'payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "financial_manager_write_daily_closing_staff_snapshots" on public.pos_daily_closing_staff_snapshots
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['financial_corrections.apply', 'payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['financial_corrections.apply', 'payroll.manage']));

create policy "financial_member_read_correction_requests" on public.pos_financial_correction_requests
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['reports.view', 'financial_corrections.request', 'financial_corrections.apply'])
  or requested_by = public.current_public_user_id()
);

create policy "financial_member_create_correction_requests" on public.pos_financial_correction_requests
for insert to authenticated
with check (
  requested_by = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['financial_corrections.request', 'financial_corrections.apply'])
);

create policy "financial_manager_update_correction_requests" on public.pos_financial_correction_requests
for update to authenticated
using (public.user_has_salon_permission(salon_id, array['financial_corrections.apply']))
with check (public.user_has_salon_permission(salon_id, array['financial_corrections.apply']));

create policy "financial_member_read_adjustments" on public.pos_financial_adjustments
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['reports.view', 'financial_corrections.apply', 'payroll.view'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "financial_manager_write_adjustments" on public.pos_financial_adjustments
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['financial_corrections.apply']))
with check (public.user_has_salon_permission(salon_id, array['financial_corrections.apply']));

create policy "payroll_manager_read_salon_settings" on public.salon_payroll_settings
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage']));

create policy "payroll_manager_write_salon_settings" on public.salon_payroll_settings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_or_staff_read_staff_settings" on public.staff_payroll_settings
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "payroll_manager_write_staff_settings" on public.staff_payroll_settings
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_or_staff_read_period_inputs" on public.payroll_period_staff_inputs
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "payroll_manager_write_period_inputs" on public.payroll_period_staff_inputs
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_or_staff_read_input_history" on public.payroll_period_staff_input_history
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "payroll_manager_insert_input_history" on public.payroll_period_staff_input_history
for insert to authenticated
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_read_runs" on public.payroll_runs
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage']));

create policy "payroll_manager_write_runs" on public.payroll_runs
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_or_staff_read_lines" on public.payroll_staff_lines
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "payroll_manager_write_lines" on public.payroll_staff_lines
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_or_staff_read_daily_totals" on public.payroll_staff_daily_totals
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "payroll_manager_write_daily_totals" on public.payroll_staff_daily_totals
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.manage']))
with check (public.user_has_salon_permission(salon_id, array['payroll.manage']));

create policy "payroll_manager_or_staff_read_paystubs" on public.payroll_paystubs
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['payroll.view', 'payroll.manage', 'payroll.tax_company'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "payroll_tax_company_write_paystubs" on public.payroll_paystubs
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['payroll.tax_company']))
with check (
  uploaded_by = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['payroll.tax_company'])
);

create policy "staff_connection_request_participant_read" on public.staff_salon_connection_requests
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or initiated_by_user_id = public.current_public_user_id()
  or account_user_id = public.current_public_user_id()
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "staff_connection_request_participant_write" on public.staff_salon_connection_requests
for all to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or initiated_by_user_id = public.current_public_user_id()
  or account_user_id = public.current_public_user_id()
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
)
with check (
  public.user_can_manage_salon(salon_id)
  or initiated_by_user_id = public.current_public_user_id()
  or account_user_id = public.current_public_user_id()
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "salon_manager_or_staff_read_service_assignments" on public.staff_service_assignments
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['booking.view', 'booking.manage', 'staff.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "salon_manager_write_service_assignments" on public.staff_service_assignments
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['booking.manage', 'staff.manage']))
with check (public.user_has_salon_permission(salon_id, array['booking.manage', 'staff.manage']));

create policy "salon_manager_or_staff_read_availability" on public.staff_availability_rules
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['booking.view', 'booking.manage', 'staff.manage'])
  or staff_id is null
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "salon_manager_or_staff_write_availability" on public.staff_availability_rules
for all to authenticated
using (
  public.user_has_salon_permission(salon_id, array['booking.manage', 'staff.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
)
with check (
  public.user_has_salon_permission(salon_id, array['booking.manage', 'staff.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "salon_manager_or_staff_read_time_blocks" on public.staff_time_blocks
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['booking.view', 'booking.manage', 'staff.manage'])
  or staff_id is null
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "salon_manager_or_staff_write_time_blocks" on public.staff_time_blocks
for all to authenticated
using (
  public.user_has_salon_permission(salon_id, array['booking.manage', 'staff.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
)
with check (
  public.user_has_salon_permission(salon_id, array['booking.manage', 'staff.manage'])
  or staff_id = public.current_user_staff_id_for_salon(salon_id)
);

create policy "salon_member_read_profile_content" on public.salon_profile_looks
for select to authenticated
using (public.user_can_manage_salon(salon_id) or status = 'published');

create policy "public_read_profile_looks" on public.salon_profile_looks
for select to anon
using (status = 'published' and public.salon_profile_public_salon_exists(salon_id));

create policy "salon_content_write_looks" on public.salon_profile_looks
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']));

create policy "salon_member_read_profile_updates" on public.salon_profile_updates
for select to authenticated
using (public.user_can_manage_salon(salon_id) or status = 'published');

create policy "public_read_profile_updates" on public.salon_profile_updates
for select to anon
using (status = 'published' and public.salon_profile_public_salon_exists(salon_id));

create policy "salon_content_write_updates" on public.salon_profile_updates
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']));

create policy "salon_profile_metadata_read_plans" on public.salon_profile_plan_catalog
for select to authenticated
using (auth.role() = 'authenticated');

create policy "salon_profile_metadata_read_entitlements" on public.salon_profile_entitlement_definitions
for select to authenticated
using (auth.role() = 'authenticated');

create policy "salon_profile_metadata_read_plan_entitlements" on public.salon_profile_plan_entitlements
for select to authenticated
using (auth.role() = 'authenticated');

create policy "salon_profile_manager_read_subscriptions" on public.salon_profile_subscriptions
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.manage']));

create policy "salon_profile_manager_read_overrides" on public.salon_profile_entitlement_overrides
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.manage']));

create policy "salon_profile_manager_read_usage_events" on public.salon_profile_usage_events
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage']));

create policy "salon_profile_manager_read_media_assets" on public.salon_profile_media_assets
for select to authenticated
using (
  uploaded_by_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage'])
);

create policy "public_read_active_media_assets" on public.salon_profile_media_assets
for select to anon, authenticated
using (status = 'active' and public.salon_profile_public_salon_exists(salon_id));

create policy "salon_profile_manager_write_media_assets" on public.salon_profile_media_assets
for all to authenticated
using (
  uploaded_by_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage'])
)
with check (
  uploaded_by_user_id = public.current_public_user_id()
  and (
    public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage'])
    or (
      upload_intent = 'staff'
      and public.current_user_staff_id_for_salon(salon_id) is not null
    )
  )
);

create policy "public_read_hashtags" on public.salon_profile_hashtags
for select to anon, authenticated
using (auth.role() in ('anon', 'authenticated'));

create policy "authenticated_write_hashtags" on public.salon_profile_hashtags
for all to authenticated
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');

create policy "public_read_published_look_hashtags" on public.salon_profile_look_hashtags
for select to anon, authenticated
using (
  exists (
    select 1
    from public.salon_profile_looks looks
    where looks.id = salon_profile_look_hashtags.look_id
      and looks.status = 'published'
      and public.salon_profile_public_salon_exists(looks.salon_id)
  )
);

create policy "content_manager_write_look_hashtags" on public.salon_profile_look_hashtags
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']));

create policy "public_read_published_update_hashtags" on public.salon_profile_update_hashtags
for select to anon, authenticated
using (
  exists (
    select 1
    from public.salon_profile_updates updates
    where updates.id = salon_profile_update_hashtags.update_id
      and updates.status = 'published'
      and public.salon_profile_public_salon_exists(updates.salon_id)
  )
);

create policy "content_manager_write_update_hashtags" on public.salon_profile_update_hashtags
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']));

create policy "public_read_visible_comments" on public.salon_profile_comments
for select to anon, authenticated
using (
  status in ('visible', 'published')
  and public.salon_profile_public_salon_exists(salon_id)
);

create policy "authenticated_create_own_comments" on public.salon_profile_comments
for insert to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and status in ('visible', 'published')
  and (
    is_salon_reply = false
    or public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage'])
  )
  and public.salon_profile_public_salon_exists(salon_id)
);

create policy "comment_owner_or_manager_update_comments" on public.salon_profile_comments
for update to authenticated
using (
  author_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage'])
)
with check (
  author_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage'])
);

create policy "public_read_visible_reviews" on public.salon_profile_reviews
for select to anon, authenticated
using (
  moderation_status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
);

create policy "authenticated_create_own_reviews" on public.salon_profile_reviews
for insert to authenticated
with check (
  author_user_id = public.current_public_user_id()
  and moderation_status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
);

create policy "review_owner_or_manager_update_reviews" on public.salon_profile_reviews
for update to authenticated
using (
  author_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage'])
)
with check (
  author_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage'])
);

create policy "public_read_visible_review_replies" on public.salon_profile_review_replies
for select to anon, authenticated
using (
  moderation_status = 'visible'
  and public.salon_profile_public_salon_exists(salon_id)
);

create policy "review_reply_manager_write" on public.salon_profile_review_replies
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage']))
with check (
  author_user_id = public.current_public_user_id()
  and public.user_has_salon_permission(salon_id, array['salon_profile.manage', 'salon_profile.content.manage'])
);

create policy "look_save_owner_read" on public.salon_profile_look_saves
for select to authenticated
using (
  user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage'])
);

create policy "look_save_owner_write" on public.salon_profile_look_saves
for all to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

create policy "follow_owner_read" on public.salon_profile_follows
for select to authenticated
using (
  user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['salon_profile.manage'])
);

create policy "follow_owner_write" on public.salon_profile_follows
for all to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

create policy "booking_request_customer_or_manager_read" on public.salon_profile_booking_requests
for select to authenticated
using (
  customer_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['booking.view', 'booking.manage', 'salon_profile.manage'])
);

create policy "booking_request_customer_create" on public.salon_profile_booking_requests
for insert to authenticated
with check (
  customer_user_id = public.current_public_user_id()
  and public.salon_profile_public_salon_exists(salon_id)
);

create policy "booking_request_customer_or_manager_update" on public.salon_profile_booking_requests
for update to authenticated
using (
  customer_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['booking.manage', 'salon_profile.manage'])
)
with check (
  customer_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['booking.manage', 'salon_profile.manage'])
);

create policy "content_manager_read_booking_configs" on public.salon_profile_content_booking_configs
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage', 'booking.view', 'booking.manage']));

create policy "content_manager_write_booking_configs" on public.salon_profile_content_booking_configs
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']));

create policy "content_manager_read_booking_config_services" on public.salon_profile_content_booking_services
for select to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage', 'booking.view', 'booking.manage']));

create policy "content_manager_write_booking_config_services" on public.salon_profile_content_booking_services
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']))
with check (public.user_has_salon_permission(salon_id, array['salon_profile.content.manage']));

create policy "booking_inspiration_customer_or_manager_read" on public.booking_inspirations
for select to authenticated
using (
  public.user_has_salon_permission(salon_id, array['booking.view', 'booking.manage'])
  or exists (
    select 1
    from public.bookings
    where bookings.id = booking_inspirations.booking_id
      and bookings.customer_user_id = public.current_public_user_id()
  )
);

create policy "booking_manager_write_inspirations" on public.booking_inspirations
for all to authenticated
using (public.user_has_salon_permission(salon_id, array['booking.manage']))
with check (public.user_has_salon_permission(salon_id, array['booking.manage']));

create policy "notifications_recipient_read" on public.app_notifications
for select to authenticated
using (recipient_user_id = public.current_public_user_id());

create policy "notifications_recipient_update" on public.app_notifications
for update to authenticated
using (recipient_user_id = public.current_public_user_id())
with check (recipient_user_id = public.current_public_user_id());

create policy "favorite_customers_self_read" on public.account_favorite_customers
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "favorite_customers_self_write" on public.account_favorite_customers
for all to authenticated
using (user_id = public.current_public_user_id())
with check (user_id = public.current_public_user_id());

grant usage on schema public to anon, authenticated, service_role;

create policy "public_read_active_salon_profile_media_objects" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'salon-profile-media'
  and (
    exists (
      select 1
      from public.salon_profile_media_assets assets
      where assets.bucket = storage.objects.bucket_id
        and assets.object_path = storage.objects.name
        and assets.status = 'active'
        and public.salon_profile_public_salon_exists(assets.salon_id)
    )
    or public.user_can_manage_salon_profile_media(
      storage.objects.name,
      array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
    )
  )
);

create policy "salon_profile_managers_insert_media_objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    storage.objects.name,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
);

create policy "salon_profile_managers_update_media_objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    storage.objects.name,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
)
with check (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    storage.objects.name,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
);

create policy "salon_profile_managers_delete_media_objects" on storage.objects
for delete to authenticated
using (
  bucket_id = 'salon-profile-media'
  and public.user_can_manage_salon_profile_media(
    storage.objects.name,
    array['salon_profile.manage', 'salon_profile.content.manage', 'staff.manage']::text[]
  )
);

create policy "payroll_users_read_paystub_objects" on storage.objects
for select to authenticated
using (
  bucket_id = 'payroll-paystubs'
  and exists (
    select 1
    from public.payroll_paystubs paystubs
    where paystubs.file_url_or_path = storage.objects.name
      and (
        public.user_has_salon_permission(
          paystubs.salon_id,
          array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
        )
        or paystubs.staff_id = public.current_user_staff_id_for_salon(paystubs.salon_id)
      )
  )
);

create policy "payroll_tax_company_insert_paystub_objects" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_salon_permission(
    ((storage.foldername(name))[2])::uuid,
    array['payroll.tax_company']::text[]
  )
);

create policy "payroll_tax_company_update_paystub_objects" on storage.objects
for update to authenticated
using (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_salon_permission(
    ((storage.foldername(name))[2])::uuid,
    array['payroll.tax_company']::text[]
  )
)
with check (
  bucket_id = 'payroll-paystubs'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.user_has_salon_permission(
    ((storage.foldername(name))[2])::uuid,
    array['payroll.tax_company']::text[]
  )
);

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on table
  public.locations,
  public.salon_settings,
  public.services,
  public.salon_profile_looks,
  public.salon_profile_updates,
  public.salon_profile_hashtags,
  public.salon_profile_look_hashtags,
  public.salon_profile_update_hashtags,
  public.salon_profile_comments,
  public.salon_profile_reviews,
  public.salon_profile_review_replies
to anon;

grant select on table
  public.account_favorite_customers,
  public.account_memberships,
  public.accounts,
  public.app_notifications,
  public.booking_customer_account_claims,
  public.booking_inspirations,
  public.booking_lines,
  public.booking_settings,
  public.booking_status_events,
  public.bookings,
  public.customers,
  public.locations,
  public.payroll_paystubs,
  public.payroll_period_staff_input_history,
  public.payroll_period_staff_inputs,
  public.payroll_runs,
  public.payroll_staff_daily_totals,
  public.payroll_staff_lines,
  public.permissions,
  public.pos_daily_closing_staff_snapshots,
  public.pos_daily_closings,
  public.pos_desk_session_lines,
  public.pos_desk_sessions,
  public.pos_display_channels,
  public.pos_financial_adjustments,
  public.pos_financial_correction_requests,
  public.pos_live_drafts,
  public.pos_payments,
  public.pos_ticket_adjustments,
  public.pos_ticket_audit_logs,
  public.pos_ticket_item_turn_parts,
  public.pos_ticket_items,
  public.pos_ticket_staff_earnings,
  public.pos_tickets,
  public.role_permissions,
  public.roles,
  public.salon_memberships,
  public.salon_payroll_settings,
  public.salon_profile_booking_requests,
  public.salon_profile_comments,
  public.salon_profile_content_booking_configs,
  public.salon_profile_content_booking_services,
  public.salon_profile_entitlement_definitions,
  public.salon_profile_entitlement_overrides,
  public.salon_profile_follows,
  public.salon_profile_hashtags,
  public.salon_profile_look_hashtags,
  public.salon_profile_look_saves,
  public.salon_profile_looks,
  public.salon_profile_media_assets,
  public.salon_profile_plan_catalog,
  public.salon_profile_plan_entitlements,
  public.salon_profile_review_replies,
  public.salon_profile_reviews,
  public.salon_profile_subscriptions,
  public.salon_profile_update_hashtags,
  public.salon_profile_updates,
  public.salon_profile_usage_events,
  public.salon_settings,
  public.service_add_on_links,
  public.services,
  public.staff,
  public.staff_availability_rules,
  public.staff_payroll_settings,
  public.staff_salon_connection_requests,
  public.staff_service_assignments,
  public.staff_time_blocks,
  public.staff_workdays,
  public.users
to authenticated;

grant select on table public.salon_profile_media_assets to anon;

grant insert, update, delete on table
  public.users,
  public.accounts,
  public.locations,
  public.customers,
  public.staff,
  public.services,
  public.service_add_on_links,
  public.salon_settings,
  public.booking_settings,
  public.bookings,
  public.booking_lines,
  public.pos_tickets,
  public.pos_ticket_items,
  public.pos_ticket_item_turn_parts,
  public.pos_payments,
  public.pos_desk_sessions,
  public.pos_desk_session_lines,
  public.pos_display_channels,
  public.pos_live_drafts,
  public.staff_workdays,
  public.pos_ticket_staff_earnings,
  public.pos_ticket_adjustments,
  public.pos_daily_closings,
  public.pos_daily_closing_staff_snapshots,
  public.pos_financial_correction_requests,
  public.pos_financial_adjustments,
  public.salon_payroll_settings,
  public.staff_payroll_settings,
  public.payroll_period_staff_inputs,
  public.payroll_runs,
  public.payroll_staff_lines,
  public.payroll_staff_daily_totals,
  public.payroll_paystubs,
  public.staff_salon_connection_requests,
  public.staff_service_assignments,
  public.staff_availability_rules,
  public.staff_time_blocks,
  public.salon_profile_media_assets,
  public.salon_profile_looks,
  public.salon_profile_updates,
  public.salon_profile_hashtags,
  public.salon_profile_look_hashtags,
  public.salon_profile_update_hashtags,
  public.salon_profile_comments,
  public.salon_profile_reviews,
  public.salon_profile_review_replies,
  public.salon_profile_look_saves,
  public.salon_profile_follows,
  public.account_favorite_customers,
  public.salon_profile_booking_requests,
  public.salon_profile_content_booking_configs,
  public.salon_profile_content_booking_services,
  public.booking_inspirations,
  public.app_notifications
to authenticated;

grant insert on table
  public.booking_status_events,
  public.pos_ticket_audit_logs,
  public.payroll_period_staff_input_history,
  public.booking_customer_account_claims,
  public.salon_profile_usage_events
to authenticated;

grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

do $$
declare
  routine_name text;
  routine_signature regprocedure;
begin
  foreach routine_name in array array[
    'current_public_user_id',
    'user_belongs_to_account',
    'user_can_manage_salon',
    'user_has_account_permission',
    'user_has_salon_permission',
    'user_is_salon_member',
    'current_user_staff_id_for_salon',
    'user_can_read_staff_scoped_row',
    'user_can_manage_salon_profile_media',
    'salon_profile_public_salon_exists',
    'get_public_booking_by_manage_token',
    'reschedule_public_booking_by_manage_token',
    'cancel_public_booking_by_manage_token',
    'create_public_booking',
    'get_public_booking_context',
    'get_public_salon_profile',
    'get_public_salon_profile_services',
    'get_public_salon_profile_staff',
    'get_public_salon_profile_looks',
    'get_public_salon_profile_updates',
    'get_public_salon_profile_comments',
    'get_public_salon_profile_review_summary',
    'get_public_salon_profile_reviews',
    'get_public_explore_decision_signals',
    'get_public_explore_home_salons',
    'get_public_explore_popular_services',
    'search_public_explore_salons',
    'get_public_explore_inspiration',
    'get_public_content_booking_options',
    'get_pos_display_channel_by_token',
    'confirm_pos_display_channel_tip',
    'get_pos_desk_session_by_token',
    'update_pos_desk_session_tip_by_token',
    'update_pos_desk_session_customer_by_token',
    'create_pos_desk_customer_by_token',
    'get_pos_live_draft_by_token',
    'upsert_pos_live_draft_customer_by_phone',
    'find_pos_live_draft_customer_by_phone',
    'create_pos_live_draft_customer_by_phone'
  ]
  loop
    for routine_signature in
      select pg_proc.oid::regprocedure
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and pg_proc.proname = routine_name
    loop
      execute format('grant execute on function %s to anon, authenticated', routine_signature);
    end loop;
  end loop;

  foreach routine_name in array array[
    'accept_staff_connection_invite',
    'accept_staff_connection_invite_by_request',
    'cancel_customer_booking',
    'cancel_staff_salon_application',
    'cancel_staff_time_block',
    'claim_guest_booking_by_manage_token',
    'complete_assigned_booking_line',
    'convert_booking_to_pos_ticket',
    'create_account_salon',
    'create_canonical_booking',
    'create_staff_time_block',
    'decline_staff_connection_invite',
    'decline_staff_connection_invite_by_request',
    'ensure_personal_account_for_current_user',
    'get_customer_crm_metrics',
    'get_salon_profile_entitlement_limit',
    'get_salon_profile_media_usage',
    'get_staff_connection_invite_by_token',
    'list_account_favorite_customers',
    'list_account_favorite_shops',
    'list_account_saved_posts',
    'list_my_staff_salon_connection_requests',
    'reschedule_canonical_booking',
    'reschedule_customer_booking',
    'resend_staff_connection_invite',
    'review_staff_salon_application',
    'revoke_staff_connection_invite',
    'save_salon_profile_content_booking_config',
    'save_service_config_batch',
    'save_staff_weekly_availability',
    'search_public_staff_application_salons',
    'search_staff_connection_account_exact',
    'start_assigned_booking_line',
    'submit_staff_salon_application',
    'update_closed_pos_ticket_tip_for_correction',
    'update_staff_public_team_batch'
  ]
  loop
    for routine_signature in
      select pg_proc.oid::regprocedure
      from pg_proc
      join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
      where pg_namespace.nspname = 'public'
        and pg_proc.proname = routine_name
    loop
      execute format('grant execute on function %s to authenticated', routine_signature);
    end loop;
  end loop;
end;
$$;
