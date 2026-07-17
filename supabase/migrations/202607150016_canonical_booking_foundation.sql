-- Canonical Booking Foundation, Phase 1.
-- `public.bookings` remains the canonical appointment table. This migration is
-- additive and keeps the legacy `scheduled` status as a compatibility alias.

create or replace function public.normalize_booking_status(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select case input
    when 'scheduled' then 'confirmed'
    else input
  end
$$;

create or replace function public.booking_status_blocks_slot(input text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.normalize_booking_status(input) not in ('cancelled', 'no_show')
$$;

alter table public.bookings
add column if not exists customer_user_id uuid references public.users(id) on delete set null,
add column if not exists source text not null default 'owner_manual',
add column if not exists confirmation_mode text not null default 'request_confirmation',
add column if not exists confirmation_status text not null default 'confirmed',
add column if not exists salon_timezone_snapshot text not null default 'America/Chicago',
add column if not exists customer_cancellation_token_hash text,
add column if not exists pos_ticket_id uuid references public.pos_tickets(id) on delete set null,
add column if not exists source_reference_type text,
add column if not exists source_reference_id uuid,
add column if not exists idempotency_key text,
add column if not exists public_notes text,
add column if not exists internal_notes text,
add column if not exists cancellation_reason text,
add column if not exists cancelled_at timestamptz,
add column if not exists cancelled_by_user_id uuid references public.users(id) on delete set null,
add column if not exists no_show_at timestamptz,
add column if not exists no_show_by_user_id uuid references public.users(id) on delete set null,
add column if not exists no_show_reason text,
add column if not exists created_by_user_id uuid references public.users(id) on delete set null,
add column if not exists updated_by_user_id uuid references public.users(id) on delete set null,
add column if not exists payment_status text not null default 'not_required',
add column if not exists deposit_policy_snapshot jsonb not null default '{}'::jsonb,
add column if not exists cancellation_policy_snapshot jsonb not null default '{}'::jsonb;

comment on column public.bookings.status is
  'Canonical appointment lifecycle status. Legacy scheduled is accepted temporarily and maps to confirmed.';
comment on column public.bookings.notes is
  'Legacy internal notes field kept for compatibility. Prefer internal_notes or public_notes for new booking-domain code.';
comment on column public.bookings.source is
  'Canonical source of the appointment: public_profile, explore, owner_manual, staff_manual, phone, walk_in, legacy_request, or pos.';
comment on column public.bookings.customer_cancellation_token_hash is
  'Hash-only extension point for customer-facing cancellation/reschedule links. Never store raw tokens.';
comment on column public.bookings.deposit_policy_snapshot is
  'Payment/deposit extension point. Phase 1 keeps payment collection disabled.';
comment on column public.bookings.cancellation_policy_snapshot is
  'Customer-facing cancellation/no-show policy snapshot captured when the booking is created.';

alter table public.bookings
drop constraint if exists bookings_status_check;

alter table public.bookings
add constraint bookings_status_check check (
  status in (
    'scheduled',
    'pending',
    'confirmed',
    'checked_in',
    'in_service',
    'completed',
    'cancelled',
    'no_show'
  )
);

alter table public.bookings
drop constraint if exists bookings_source_check;
alter table public.bookings
add constraint bookings_source_check check (
  source in (
    'public_profile',
    'explore',
    'owner_manual',
    'staff_manual',
    'phone',
    'walk_in',
    'legacy_request',
    'pos'
  )
);

alter table public.bookings
drop constraint if exists bookings_confirmation_mode_check;
alter table public.bookings
add constraint bookings_confirmation_mode_check check (
  confirmation_mode in ('request_confirmation', 'instant_booking')
);

alter table public.bookings
drop constraint if exists bookings_confirmation_status_check;
alter table public.bookings
add constraint bookings_confirmation_status_check check (
  confirmation_status in (
    'requested',
    'confirmed',
    'declined',
    'cancelled',
    'expired',
    'not_required'
  )
);

alter table public.bookings
drop constraint if exists bookings_payment_status_check;
alter table public.bookings
add constraint bookings_payment_status_check check (
  payment_status in (
    'not_required',
    'pending',
    'authorized',
    'paid',
    'waived',
    'refunded'
  )
);

alter table public.bookings
drop constraint if exists bookings_timezone_not_blank;
alter table public.bookings
add constraint bookings_timezone_not_blank check (
  length(btrim(salon_timezone_snapshot)) > 0
);

alter table public.bookings
drop constraint if exists bookings_customer_cancellation_token_hash_not_blank;
alter table public.bookings
add constraint bookings_customer_cancellation_token_hash_not_blank check (
  customer_cancellation_token_hash is null
  or length(btrim(customer_cancellation_token_hash)) > 0
);

alter table public.bookings
drop constraint if exists bookings_idempotency_key_not_blank;
alter table public.bookings
add constraint bookings_idempotency_key_not_blank check (
  idempotency_key is null
  or length(btrim(idempotency_key)) > 0
);

alter table public.bookings
drop constraint if exists bookings_cancellation_reason_not_blank;
alter table public.bookings
add constraint bookings_cancellation_reason_not_blank check (
  cancellation_reason is null
  or length(btrim(cancellation_reason)) > 0
);

alter table public.bookings
drop constraint if exists bookings_no_show_reason_not_blank;
alter table public.bookings
add constraint bookings_no_show_reason_not_blank check (
  no_show_reason is null
  or length(btrim(no_show_reason)) > 0
);

create index if not exists bookings_customer_user_id_idx
on public.bookings(customer_user_id)
where customer_user_id is not null;

create index if not exists bookings_salon_source_idx
on public.bookings(salon_id, source, created_at desc);

create index if not exists bookings_salon_confirmation_status_idx
on public.bookings(salon_id, confirmation_status, created_at desc);

create unique index if not exists bookings_salon_idempotency_key_uidx
on public.bookings(salon_id, idempotency_key)
where idempotency_key is not null;

create unique index if not exists bookings_customer_cancellation_token_uidx
on public.bookings(customer_cancellation_token_hash)
where customer_cancellation_token_hash is not null;

create unique index if not exists bookings_pos_ticket_id_uidx
on public.bookings(pos_ticket_id)
where pos_ticket_id is not null;

create or replace function public.validate_booking_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Booking organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Booking salon must belong to booking organization.';
  end if;

  if not exists (
    select 1
    from public.customers
    where customers.id = new.customer_id
      and customers.location_id = new.salon_id
  ) then
    raise exception 'Booking customer must belong to booking salon.';
  end if;

  if new.customer_user_id is not null and not exists (
    select 1
    from public.users
    where users.id = new.customer_user_id
      and users.status <> 'deleted'
  ) then
    raise exception 'Booking customer user must be an active app user.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Booking staff must belong to booking salon.';
  end if;

  if new.pos_ticket_id is not null and not exists (
    select 1
    from public.pos_tickets
    where pos_tickets.id = new.pos_ticket_id
      and pos_tickets.organization_id = new.organization_id
      and pos_tickets.salon_id = new.salon_id
      and pos_tickets.customer_id = new.customer_id
  ) then
    raise exception 'Booking POS ticket must belong to the same salon and customer.';
  end if;

  return new;
end;
$$;

create table if not exists public.booking_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_enabled boolean not null default false,
  online_booking_visible boolean not null default false,
  confirmation_mode text not null default 'request_confirmation',
  minimum_lead_time_minutes integer not null default 1440,
  maximum_advance_window_days integer not null default 30,
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
  payment_required_enabled boolean not null default false,
  deposit_required_enabled boolean not null default false,
  deposit_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_settings_salon_unique unique (salon_id),
  constraint booking_settings_confirmation_mode_check check (
    confirmation_mode in ('request_confirmation', 'instant_booking')
  ),
  constraint booking_settings_lead_time_nonnegative check (
    minimum_lead_time_minutes >= 0
  ),
  constraint booking_settings_advance_window_positive check (
    maximum_advance_window_days > 0
  ),
  constraint booking_settings_slot_interval_positive check (
    slot_interval_minutes > 0
  ),
  constraint booking_settings_cleanup_buffer_nonnegative check (
    default_cleanup_buffer_minutes >= 0
  ),
  constraint booking_settings_cancellation_window_nonnegative check (
    cancellation_window_minutes >= 0
  ),
  constraint booking_settings_timezone_not_blank check (
    length(btrim(timezone_iana)) > 0
  )
);

comment on table public.booking_settings is
  'Per-salon booking settings. Defaults are conservative: existing salons are request-confirmation and not publicly bookable.';

create index if not exists booking_settings_organization_id_idx
on public.booking_settings(organization_id);

drop trigger if exists update_booking_settings_updated_at
on public.booking_settings;

create trigger update_booking_settings_updated_at
before update on public.booking_settings
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_booking_settings_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Booking settings organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Booking settings salon must belong to the organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_settings_scope
on public.booking_settings;

create trigger validate_booking_settings_scope
before insert or update on public.booking_settings
for each row
execute function public.validate_booking_settings_scope();

insert into public.booking_settings (organization_id, salon_id)
select locations.organization_id, locations.id
from public.locations
on conflict (salon_id) do nothing;

create or replace function public.create_default_booking_settings_for_location()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.booking_settings (organization_id, salon_id)
  values (new.organization_id, new.id)
  on conflict (salon_id) do nothing;

  return new;
end;
$$;

drop trigger if exists create_default_booking_settings_for_location
on public.locations;

create trigger create_default_booking_settings_for_location
after insert on public.locations
for each row
execute function public.create_default_booking_settings_for_location();

create table if not exists public.staff_service_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  is_active boolean not null default true,
  online_bookable boolean not null default false,
  custom_duration_minutes integer,
  custom_price numeric(10,2),
  effective_start_date date,
  effective_end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_service_assignments_staff_service_unique unique (
    salon_id,
    staff_id,
    service_id
  ),
  constraint staff_service_assignments_custom_duration_positive check (
    custom_duration_minutes is null or custom_duration_minutes > 0
  ),
  constraint staff_service_assignments_custom_price_nonnegative check (
    custom_price is null or custom_price >= 0
  ),
  constraint staff_service_assignments_effective_dates_check check (
    effective_end_date is null
    or effective_start_date is null
    or effective_end_date >= effective_start_date
  )
);

comment on table public.staff_service_assignments is
  'Canonical staff-service eligibility. Active staff is not automatically eligible for every service.';

create index if not exists staff_service_assignments_staff_idx
on public.staff_service_assignments(staff_id, is_active);

create index if not exists staff_service_assignments_service_idx
on public.staff_service_assignments(service_id, is_active);

create index if not exists staff_service_assignments_online_bookable_idx
on public.staff_service_assignments(salon_id, service_id, online_bookable)
where is_active = true;

drop trigger if exists update_staff_service_assignments_updated_at
on public.staff_service_assignments;

create trigger update_staff_service_assignments_updated_at
before update on public.staff_service_assignments
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_staff_service_assignment_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.staff_id is distinct from old.staff_id
    or new.service_id is distinct from old.service_id
  ) then
    raise exception 'Staff-service assignment ownership fields cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Staff-service assignment salon must belong to the organization.';
  end if;

  if new.is_active and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Staff-service assignment requires an active staff relationship.';
  end if;

  if new.is_active and not exists (
    select 1
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
      and services.is_active = true
  ) then
    raise exception 'Staff-service assignment requires an active salon service.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_service_assignment_scope
on public.staff_service_assignments;

create trigger validate_staff_service_assignment_scope
before insert or update on public.staff_service_assignments
for each row
execute function public.validate_staff_service_assignment_scope();

create table if not exists public.staff_availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_availability_rules_type_check check (
    rule_type in ('working', 'break')
  ),
  constraint staff_availability_rules_day_check check (
    day_of_week between 0 and 6
  ),
  constraint staff_availability_rules_time_check check (
    ends_at_local > starts_at_local
  ),
  constraint staff_availability_rules_effective_dates_check check (
    effective_end_date is null
    or effective_start_date is null
    or effective_end_date >= effective_start_date
  ),
  constraint staff_availability_rules_timezone_not_blank check (
    length(btrim(timezone_iana)) > 0
  )
);

comment on table public.staff_availability_rules is
  'Recurring salon/staff availability foundation. staff_id null is a salon fallback; staff_workdays remains same-day operational state.';

create index if not exists staff_availability_rules_staff_day_idx
on public.staff_availability_rules(salon_id, staff_id, day_of_week)
where is_active = true;

create index if not exists staff_availability_rules_salon_day_idx
on public.staff_availability_rules(salon_id, day_of_week)
where is_active = true;

drop trigger if exists update_staff_availability_rules_updated_at
on public.staff_availability_rules;

create trigger update_staff_availability_rules_updated_at
before update on public.staff_availability_rules
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_staff_availability_rule_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Staff availability rule organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Staff availability rule salon must belong to the organization.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Staff availability rule staff must be active for this salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_availability_rule_scope
on public.staff_availability_rules;

create trigger validate_staff_availability_rule_scope
before insert or update on public.staff_availability_rules
for each row
execute function public.validate_staff_availability_rule_scope();

create table if not exists public.staff_time_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  block_type text not null default 'blocked',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone_iana text not null default 'America/Chicago',
  reason text,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_time_blocks_type_check check (
    block_type in ('time_off', 'blocked', 'break', 'cleanup')
  ),
  constraint staff_time_blocks_time_check check (ends_at > starts_at),
  constraint staff_time_blocks_timezone_not_blank check (
    length(btrim(timezone_iana)) > 0
  )
);

comment on table public.staff_time_blocks is
  'One-off time off, blocked time, breaks, and cleanup blocks. staff_id null can represent a salon-level closure.';

create index if not exists staff_time_blocks_staff_time_idx
on public.staff_time_blocks(staff_id, starts_at, ends_at)
where staff_id is not null;

create index if not exists staff_time_blocks_salon_time_idx
on public.staff_time_blocks(salon_id, starts_at, ends_at);

drop trigger if exists update_staff_time_blocks_updated_at
on public.staff_time_blocks;

create trigger update_staff_time_blocks_updated_at
before update on public.staff_time_blocks
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_staff_time_block_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Staff time block organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Staff time block salon must belong to the organization.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Staff time block staff must be active for this salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_time_block_scope
on public.staff_time_blocks;

create trigger validate_staff_time_block_scope
before insert or update on public.staff_time_blocks
for each row
execute function public.validate_staff_time_block_scope();

create table if not exists public.booking_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  parent_booking_line_id uuid references public.booking_lines(id) on delete set null,
  line_type text not null default 'service',
  service_id uuid references public.services(id) on delete set null,
  service_name_snapshot text not null,
  service_category_snapshot text,
  service_description_snapshot text,
  unit_price numeric(10,2) not null default 0,
  quantity numeric(10,2) not null default 1,
  line_total numeric(12,2) generated always as (quantity * unit_price) stored,
  duration_minutes integer not null,
  cleanup_buffer_minutes integer not null default 0,
  display_order integer not null default 0,
  assigned_staff_id uuid references public.staff(id) on delete set null,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  overbooking_override_reason text,
  overbooking_override_by_user_id uuid references public.users(id) on delete set null,
  overbooking_override_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_lines_type_check check (
    line_type in ('service', 'add_on', 'custom')
  ),
  constraint booking_lines_service_name_not_blank check (
    length(btrim(service_name_snapshot)) > 0
  ),
  constraint booking_lines_unit_price_nonnegative check (unit_price >= 0),
  constraint booking_lines_quantity_positive check (quantity > 0),
  constraint booking_lines_duration_positive check (duration_minutes > 0),
  constraint booking_lines_cleanup_buffer_nonnegative check (
    cleanup_buffer_minutes >= 0
  ),
  constraint booking_lines_time_check check (
    scheduled_start_at is null
    or scheduled_end_at is null
    or scheduled_end_at > scheduled_start_at
  ),
  constraint booking_lines_override_complete_check check (
    overbooking_override_reason is null
    or (
      length(btrim(overbooking_override_reason)) > 0
      and overbooking_override_by_user_id is not null
      and overbooking_override_at is not null
    )
  )
);

comment on table public.booking_lines is
  'Canonical booking service/add-on lines with immutable service price/name/duration snapshots.';

create index if not exists booking_lines_booking_display_idx
on public.booking_lines(booking_id, display_order, created_at);

create index if not exists booking_lines_service_id_idx
on public.booking_lines(service_id)
where service_id is not null;

create index if not exists booking_lines_staff_time_idx
on public.booking_lines(assigned_staff_id, scheduled_start_at, scheduled_end_at)
where assigned_staff_id is not null
  and scheduled_start_at is not null
  and scheduled_end_at is not null;

drop trigger if exists update_booking_lines_updated_at
on public.booking_lines;

create trigger update_booking_lines_updated_at
before update on public.booking_lines
for each row
execute function public.update_updated_at_column();

create or replace function public.prepare_booking_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  service_row public.services%rowtype;
begin
  select *
  into booking_row
  from public.bookings
  where bookings.id = new.booking_id;

  if booking_row.id is null then
    raise exception 'Booking line booking must exist.';
  end if;

  if new.organization_id is distinct from booking_row.organization_id
    or new.salon_id is distinct from booking_row.salon_id
  then
    raise exception 'Booking line must belong to the same salon as the booking.';
  end if;

  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.booking_id is distinct from old.booking_id
  ) then
    raise exception 'Booking line ownership fields cannot be changed.';
  end if;

  if new.service_id is not null then
    select *
    into service_row
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
      and services.is_active = true;

    if service_row.id is null then
      raise exception 'Booking line service must be active for this salon.';
    end if;

    new.service_name_snapshot := service_row.name;
    new.service_category_snapshot := service_row.category;
    new.service_description_snapshot := service_row.description;
    new.unit_price := service_row.base_price;
    new.duration_minutes := service_row.duration_minutes;
  end if;

  if new.parent_booking_line_id is not null and not exists (
    select 1
    from public.booking_lines parent_line
    where parent_line.id = new.parent_booking_line_id
      and parent_line.booking_id = new.booking_id
      and parent_line.organization_id = new.organization_id
      and parent_line.salon_id = new.salon_id
  ) then
    raise exception 'Booking add-on parent line must belong to the same booking.';
  end if;

  if (tg_op = 'INSERT' or new.assigned_staff_id is distinct from old.assigned_staff_id)
    and new.assigned_staff_id is not null
    and not exists (
      select 1
      from public.staff
      where staff.id = new.assigned_staff_id
        and staff.organization_id = new.organization_id
        and staff.salon_id = new.salon_id
        and staff.is_active = true
    )
  then
    raise exception 'Booking line staff must be active for this salon.';
  end if;

  if new.scheduled_start_at is null then
    new.scheduled_start_at := booking_row.start_at;
  end if;

  if new.scheduled_end_at is null then
    new.scheduled_end_at := booking_row.end_at;
  end if;

  if new.scheduled_start_at < booking_row.start_at
    or new.scheduled_end_at > booking_row.end_at
  then
    raise exception 'Booking line schedule must be inside the booking interval.';
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_booking_line
on public.booking_lines;

create trigger prepare_booking_line
before insert or update on public.booking_lines
for each row
execute function public.prepare_booking_line();

create or replace function public.validate_booking_line_staff_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  booking_status text;
begin
  if new.assigned_staff_id is null
    or new.scheduled_start_at is null
    or new.scheduled_end_at is null
  then
    return new;
  end if;

  select bookings.status
  into booking_status
  from public.bookings
  where bookings.id = new.booking_id;

  if not public.booking_status_blocks_slot(booking_status) then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.salon_id::text || ':' || new.assigned_staff_id::text, 0)
  );

  if new.overbooking_override_reason is not null then
    return new;
  end if;

  if exists (
    select 1
    from public.booking_lines other_lines
    join public.bookings other_bookings
      on other_bookings.id = other_lines.booking_id
    where other_lines.id <> new.id
      and other_lines.salon_id = new.salon_id
      and other_lines.assigned_staff_id = new.assigned_staff_id
      and other_lines.scheduled_start_at is not null
      and other_lines.scheduled_end_at is not null
      and public.booking_status_blocks_slot(other_bookings.status)
      and tstzrange(
        other_lines.scheduled_start_at,
        other_lines.scheduled_end_at,
        '[)'
      ) && tstzrange(new.scheduled_start_at, new.scheduled_end_at, '[)')
  ) then
    raise exception 'Booking line overlaps an existing assigned staff booking.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_line_staff_overlap
on public.booking_lines;

create trigger validate_booking_line_staff_overlap
before insert or update on public.booking_lines
for each row
execute function public.validate_booking_line_staff_overlap();

create table if not exists public.booking_status_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_staff_id uuid references public.staff(id) on delete set null,
  actor_source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_status_events_type_check check (
    event_type in (
      'booking_created',
      'confirmation_requested',
      'confirmed',
      'staff_assigned',
      'staff_reassigned',
      'rescheduled',
      'checked_in',
      'service_started',
      'completed',
      'cancelled',
      'no_show',
      'converted_to_ticket',
      'overbooking_override'
    )
  ),
  constraint booking_status_events_actor_source_check check (
    actor_source in (
      'owner',
      'manager',
      'staff',
      'customer',
      'guest',
      'system',
      'public',
      'pos'
    )
  )
);

comment on table public.booking_status_events is
  'Append-only booking lifecycle and audit history. Do not store unnecessary sensitive customer data in metadata.';

create index if not exists booking_status_events_booking_created_idx
on public.booking_status_events(booking_id, created_at desc);

create index if not exists booking_status_events_salon_created_idx
on public.booking_status_events(salon_id, created_at desc);

create or replace function public.validate_booking_status_event_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Booking status events are append-only.';
  end if;

  if not exists (
    select 1
    from public.bookings
    where bookings.id = new.booking_id
      and bookings.organization_id = new.organization_id
      and bookings.salon_id = new.salon_id
  ) then
    raise exception 'Booking status event must belong to its booking.';
  end if;

  if new.actor_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.actor_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Booking status event staff actor must belong to the salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_status_event_scope
on public.booking_status_events;

create trigger validate_booking_status_event_scope
before insert or update on public.booking_status_events
for each row
execute function public.validate_booking_status_event_scope();

create or replace function public.record_booking_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.booking_status_events (
      organization_id,
      salon_id,
      booking_id,
      event_type,
      new_status,
      actor_user_id,
      actor_source,
      metadata
    )
    values (
      new.organization_id,
      new.salon_id,
      new.id,
      'booking_created',
      public.normalize_booking_status(new.status),
      new.created_by_user_id,
      'system',
      jsonb_build_object('source', new.source)
    );

    return new;
  end if;

  if new.status is distinct from old.status then
    event_name := case public.normalize_booking_status(new.status)
      when 'confirmed' then 'confirmed'
      when 'checked_in' then 'checked_in'
      when 'in_service' then 'service_started'
      when 'completed' then 'completed'
      when 'cancelled' then 'cancelled'
      when 'no_show' then 'no_show'
      else null
    end;

    if event_name is not null then
      insert into public.booking_status_events (
        organization_id,
        salon_id,
        booking_id,
        event_type,
        old_status,
        new_status,
        actor_user_id,
        actor_source
      )
      values (
        new.organization_id,
        new.salon_id,
        new.id,
        event_name,
        public.normalize_booking_status(old.status),
        public.normalize_booking_status(new.status),
        new.updated_by_user_id,
        'system'
      );
    end if;
  end if;

  if new.start_at is distinct from old.start_at
    or new.end_at is distinct from old.end_at
  then
    insert into public.booking_status_events (
      organization_id,
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
      new.organization_id,
      new.salon_id,
      new.id,
      'rescheduled',
      public.normalize_booking_status(old.status),
      public.normalize_booking_status(new.status),
      new.updated_by_user_id,
      'system',
      jsonb_build_object(
        'old_start_at', old.start_at,
        'old_end_at', old.end_at,
        'new_start_at', new.start_at,
        'new_end_at', new.end_at
      )
    );
  end if;

  if new.staff_id is distinct from old.staff_id then
    insert into public.booking_status_events (
      organization_id,
      salon_id,
      booking_id,
      event_type,
      old_status,
      new_status,
      actor_user_id,
      actor_staff_id,
      actor_source,
      metadata
    )
    values (
      new.organization_id,
      new.salon_id,
      new.id,
      case when old.staff_id is null then 'staff_assigned' else 'staff_reassigned' end,
      public.normalize_booking_status(old.status),
      public.normalize_booking_status(new.status),
      new.updated_by_user_id,
      new.staff_id,
      'system',
      jsonb_build_object('old_staff_id', old.staff_id, 'new_staff_id', new.staff_id)
    );
  end if;

  if new.pos_ticket_id is not null and new.pos_ticket_id is distinct from old.pos_ticket_id then
    insert into public.booking_status_events (
      organization_id,
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
      new.organization_id,
      new.salon_id,
      new.id,
      'converted_to_ticket',
      public.normalize_booking_status(old.status),
      public.normalize_booking_status(new.status),
      new.updated_by_user_id,
      'pos',
      jsonb_build_object('pos_ticket_id', new.pos_ticket_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists record_booking_lifecycle_event
on public.bookings;

create trigger record_booking_lifecycle_event
after insert or update on public.bookings
for each row
execute function public.record_booking_lifecycle_event();

create or replace function public.record_booking_line_overbooking_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.overbooking_override_reason is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.overbooking_override_reason is not distinct from old.overbooking_override_reason
    and new.overbooking_override_by_user_id is not distinct from old.overbooking_override_by_user_id
  then
    return new;
  end if;

  insert into public.booking_status_events (
    organization_id,
    salon_id,
    booking_id,
    event_type,
    actor_user_id,
    actor_staff_id,
    actor_source,
    metadata,
    created_at
  )
  values (
    new.organization_id,
    new.salon_id,
    new.booking_id,
    'overbooking_override',
    new.overbooking_override_by_user_id,
    new.assigned_staff_id,
    'manager',
    jsonb_build_object(
      'booking_line_id', new.id,
      'reason', new.overbooking_override_reason,
      'scheduled_start_at', new.scheduled_start_at,
      'scheduled_end_at', new.scheduled_end_at
    ),
    coalesce(new.overbooking_override_at, now())
  );

  return new;
end;
$$;

drop trigger if exists record_booking_line_overbooking_event
on public.booking_lines;

create trigger record_booking_line_overbooking_event
after insert or update on public.booking_lines
for each row
execute function public.record_booking_line_overbooking_event();

create or replace function public.current_user_can_view_booking(
  target_booking_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bookings
    where bookings.id = target_booking_id
      and (
        public.user_has_organization_permission(
          bookings.organization_id,
          array['booking.view', 'booking.manage']::text[]
        )
        or bookings.customer_user_id = public.current_public_user_id()
        or (
          bookings.staff_id is not null
          and public.current_auth_user_matches_staff(
            bookings.staff_id,
            bookings.organization_id,
            bookings.salon_id
          )
        )
        or exists (
          select 1
          from public.booking_lines
          where booking_lines.booking_id = bookings.id
            and booking_lines.assigned_staff_id is not null
            and public.current_auth_user_matches_staff(
              booking_lines.assigned_staff_id,
              booking_lines.organization_id,
              booking_lines.salon_id
            )
        )
      )
  )
$$;

create or replace function public.current_user_can_view_booking_line(
  target_booking_line_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.booking_lines
    join public.bookings
      on bookings.id = booking_lines.booking_id
    where booking_lines.id = target_booking_line_id
      and (
        public.user_has_organization_permission(
          booking_lines.organization_id,
          array['booking.view', 'booking.manage']::text[]
        )
        or bookings.customer_user_id = public.current_public_user_id()
        or (
          booking_lines.assigned_staff_id is not null
          and public.current_auth_user_matches_staff(
            booking_lines.assigned_staff_id,
            booking_lines.organization_id,
            booking_lines.salon_id
          )
        )
      )
  )
$$;

drop function if exists public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
);

create function public.create_canonical_booking(
  p_salon_id uuid,
  p_customer_id uuid,
  p_customer_user_id uuid default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_status text default 'pending',
  p_source text default 'owner_manual',
  p_confirmation_mode text default 'request_confirmation',
  p_confirmation_status text default 'requested',
  p_public_notes text default null,
  p_internal_notes text default null,
  p_idempotency_key text default null,
  p_lines jsonb default '[]'::jsonb,
  p_actor_source text default 'system',
  p_overbooking_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_id uuid;
  line_row jsonb;
  line_service_id uuid;
  line_staff_id uuid;
  line_start_at timestamptz;
  line_end_at timestamptz;
  location_organization_id uuid;
  settings_row public.booking_settings%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id
    and locations.status = 'active';

  if location_organization_id is null then
    raise exception 'Booking salon must be active.';
  end if;

  if actor_user_id is null then
    raise exception 'Authenticated booking creation requires a user. Guest booking must use a dedicated public RPC in a later phase.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage']::text[]
  ) then
    raise exception 'Missing required permission: booking.manage';
  end if;

  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'Booking requires a valid start and end interval.';
  end if;

  select *
  into settings_row
  from public.booking_settings
  where booking_settings.salon_id = p_salon_id;

  if p_idempotency_key is not null then
    select bookings.id
    into booking_id
    from public.bookings
    where bookings.salon_id = p_salon_id
      and bookings.idempotency_key = p_idempotency_key
    limit 1;

    if booking_id is not null then
      return booking_id;
    end if;
  end if;

  insert into public.bookings (
    organization_id,
    salon_id,
    customer_id,
    customer_user_id,
    start_at,
    end_at,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    public_notes,
    internal_notes,
    idempotency_key,
    created_by_user_id,
    updated_by_user_id,
    cancellation_policy_snapshot
  )
  values (
    location_organization_id,
    p_salon_id,
    p_customer_id,
    p_customer_user_id,
    p_start_at,
    p_end_at,
    p_status,
    p_source,
    p_confirmation_mode,
    p_confirmation_status,
    coalesce(settings_row.timezone_iana, 'America/Chicago'),
    nullif(btrim(coalesce(p_public_notes, '')), ''),
    nullif(btrim(coalesce(p_internal_notes, '')), ''),
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    actor_user_id,
    actor_user_id,
    jsonb_build_object(
      'cancellation_window_minutes',
      coalesce(settings_row.cancellation_window_minutes, 1440)
    )
  )
  returning id into booking_id;

  if p_confirmation_status = 'requested' then
    insert into public.booking_status_events (
      organization_id,
      salon_id,
      booking_id,
      event_type,
      new_status,
      actor_user_id,
      actor_source
    )
    values (
      location_organization_id,
      p_salon_id,
      booking_id,
      'confirmation_requested',
      public.normalize_booking_status(p_status),
      actor_user_id,
      p_actor_source
    );
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Booking lines payload must be an array.';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Canonical booking creation requires at least one booking line.';
  end if;

  for line_row in
    select value
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    line_service_id := nullif(line_row ->> 'service_id', '')::uuid;
    line_staff_id := nullif(line_row ->> 'assigned_staff_id', '')::uuid;
    line_start_at := coalesce(
      nullif(line_row ->> 'scheduled_start_at', '')::timestamptz,
      p_start_at
    );
    line_end_at := coalesce(
      nullif(line_row ->> 'scheduled_end_at', '')::timestamptz,
      p_end_at
    );

    insert into public.booking_lines (
      organization_id,
      salon_id,
      booking_id,
      parent_booking_line_id,
      line_type,
      service_id,
      service_name_snapshot,
      service_category_snapshot,
      service_description_snapshot,
      unit_price,
      quantity,
      duration_minutes,
      cleanup_buffer_minutes,
      display_order,
      assigned_staff_id,
      scheduled_start_at,
      scheduled_end_at,
      overbooking_override_reason,
      overbooking_override_by_user_id,
      overbooking_override_at
    )
    values (
      location_organization_id,
      p_salon_id,
      booking_id,
      nullif(line_row ->> 'parent_booking_line_id', '')::uuid,
      coalesce(nullif(line_row ->> 'line_type', ''), 'service'),
      line_service_id,
      coalesce(nullif(line_row ->> 'service_name_snapshot', ''), 'Pending service snapshot'),
      nullif(line_row ->> 'service_category_snapshot', ''),
      nullif(line_row ->> 'service_description_snapshot', ''),
      coalesce(nullif(line_row ->> 'unit_price', '')::numeric, 0),
      coalesce(nullif(line_row ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(line_row ->> 'duration_minutes', '')::integer, 1),
      coalesce(nullif(line_row ->> 'cleanup_buffer_minutes', '')::integer, 0),
      coalesce(nullif(line_row ->> 'display_order', '')::integer, 0),
      line_staff_id,
      line_start_at,
      line_end_at,
      nullif(btrim(coalesce(p_overbooking_override_reason, '')), ''),
      case
        when nullif(btrim(coalesce(p_overbooking_override_reason, '')), '') is null
        then null
        else actor_user_id
      end,
      case
        when nullif(btrim(coalesce(p_overbooking_override_reason, '')), '') is null
        then null
        else now()
      end
    );
  end loop;

  return booking_id;
end;
$$;

alter table public.booking_settings enable row level security;
alter table public.staff_service_assignments enable row level security;
alter table public.staff_availability_rules enable row level security;
alter table public.staff_time_blocks enable row level security;
alter table public.booking_lines enable row level security;
alter table public.booking_status_events enable row level security;

drop policy if exists "Organization members can view salon bookings"
on public.bookings;
drop policy if exists "Organization members can create salon bookings"
on public.bookings;
drop policy if exists "Organization members can update salon bookings"
on public.bookings;

drop policy if exists "Booking viewers can view salon bookings"
on public.bookings;
drop policy if exists "Assigned staff can view own bookings"
on public.bookings;
drop policy if exists "Customers can view own authenticated bookings"
on public.bookings;
drop policy if exists "Booking participants can view bookings"
on public.bookings;

create policy "Booking participants can view bookings"
on public.bookings
for select
to authenticated
using (
  public.current_user_can_view_booking(id)
);

create policy "Booking managers can create salon bookings"
on public.bookings
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = bookings.salon_id
      and locations.organization_id = bookings.organization_id
  )
);

create policy "Booking managers can update salon bookings"
on public.bookings
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
);

create policy "Booking viewers can view booking settings"
on public.booking_settings
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.view', 'booking.manage']::text[]
  )
  or public.current_user_is_active_staff_for_salon(salon_id)
);

create policy "Booking managers can manage booking settings"
on public.booking_settings
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
);

create policy "Booking viewers can view staff service assignments"
on public.staff_service_assignments
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.view', 'booking.manage', 'staff.view', 'services.view']::text[]
  )
  or public.current_auth_user_matches_staff(staff_id, organization_id, salon_id)
);

create policy "Booking managers can manage staff service assignments"
on public.staff_service_assignments
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage', 'staff.manage', 'services.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage', 'staff.manage', 'services.manage']::text[]
  )
);

create policy "Booking viewers can view staff availability rules"
on public.staff_availability_rules
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.view', 'booking.manage', 'staff.view']::text[]
  )
  or (
    staff_id is not null
    and public.current_auth_user_matches_staff(staff_id, organization_id, salon_id)
  )
);

create policy "Booking managers can manage staff availability rules"
on public.staff_availability_rules
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage', 'staff.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage', 'staff.manage']::text[]
  )
);

create policy "Booking viewers can view staff time blocks"
on public.staff_time_blocks
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.view', 'booking.manage', 'staff.view']::text[]
  )
  or (
    staff_id is not null
    and public.current_auth_user_matches_staff(staff_id, organization_id, salon_id)
  )
);

create policy "Booking managers can manage staff time blocks"
on public.staff_time_blocks
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage', 'staff.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage', 'staff.manage']::text[]
  )
);

drop policy if exists "Booking viewers can view booking lines"
on public.booking_lines;
drop policy if exists "Assigned staff can view own booking lines"
on public.booking_lines;
drop policy if exists "Customers can view own authenticated booking lines"
on public.booking_lines;
drop policy if exists "Booking participants can view booking lines"
on public.booking_lines;

create policy "Booking participants can view booking lines"
on public.booking_lines
for select
to authenticated
using (
  public.current_user_can_view_booking_line(id)
);

create policy "Booking managers can create booking lines"
on public.booking_lines
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
);

create policy "Booking managers can update booking lines"
on public.booking_lines
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
);

drop policy if exists "Booking viewers can view booking status events"
on public.booking_status_events;
drop policy if exists "Assigned staff can view own booking status events"
on public.booking_status_events;
drop policy if exists "Customers can view own authenticated booking status events"
on public.booking_status_events;
drop policy if exists "Booking participants can view booking status events"
on public.booking_status_events;

create policy "Booking participants can view booking status events"
on public.booking_status_events
for select
to authenticated
using (
  public.current_user_can_view_booking(booking_id)
);

create policy "Booking managers can create booking status events"
on public.booking_status_events
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['booking.manage']::text[]
  )
);

grant select, insert, update on public.bookings to authenticated;
grant select, insert, update on public.booking_settings to authenticated;
grant select, insert, update on public.staff_service_assignments to authenticated;
grant select, insert, update on public.staff_availability_rules to authenticated;
grant select, insert, update on public.staff_time_blocks to authenticated;
grant select, insert, update on public.booking_lines to authenticated;
grant select, insert on public.booking_status_events to authenticated;

revoke all on function public.normalize_booking_status(text) from public;
grant execute on function public.normalize_booking_status(text) to anon, authenticated;

revoke all on function public.booking_status_blocks_slot(text) from public;
grant execute on function public.booking_status_blocks_slot(text) to authenticated;

revoke all on function public.current_user_can_view_booking(uuid) from public;
grant execute on function public.current_user_can_view_booking(uuid) to authenticated;

revoke all on function public.current_user_can_view_booking_line(uuid) from public;
grant execute on function public.current_user_can_view_booking_line(uuid) to authenticated;

revoke all on function public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) from public;
grant execute on function public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) to authenticated;
