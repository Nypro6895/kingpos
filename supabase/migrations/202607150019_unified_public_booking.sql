create table if not exists public.service_add_on_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  parent_service_id uuid not null references public.services(id) on delete cascade,
  add_on_service_id uuid not null references public.services(id) on delete cascade,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_add_on_links_distinct_check check (parent_service_id <> add_on_service_id)
);

create unique index if not exists service_add_on_links_unique_active_idx
on public.service_add_on_links(salon_id, parent_service_id, add_on_service_id)
where is_active = true;

create index if not exists service_add_on_links_parent_idx
on public.service_add_on_links(salon_id, parent_service_id, is_active, display_order);

drop trigger if exists update_service_add_on_links_updated_at
on public.service_add_on_links;

create trigger update_service_add_on_links_updated_at
before update on public.service_add_on_links
for each row
execute function public.update_updated_at_column();

create or replace function public.prepare_service_add_on_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_row public.services%rowtype;
  add_on_row public.services%rowtype;
begin
  select *
  into parent_row
  from public.services
  where services.id = new.parent_service_id
    and services.salon_id = new.salon_id
    and services.organization_id = new.organization_id;

  select *
  into add_on_row
  from public.services
  where services.id = new.add_on_service_id
    and services.salon_id = new.salon_id
    and services.organization_id = new.organization_id;

  if parent_row.id is null or add_on_row.id is null then
    raise exception 'Add-on services must belong to the same salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_service_add_on_link
on public.service_add_on_links;

create trigger prepare_service_add_on_link
before insert or update on public.service_add_on_links
for each row
execute function public.prepare_service_add_on_link();

alter table public.service_add_on_links enable row level security;

drop policy if exists "Organization members can view service add-ons"
on public.service_add_on_links;
create policy "Organization members can view service add-ons"
on public.service_add_on_links
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['services.view', 'services.manage']::text[]
  )
);

drop policy if exists "Organization members can manage service add-ons"
on public.service_add_on_links;
create policy "Organization members can manage service add-ons"
on public.service_add_on_links
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['services.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['services.manage']::text[]
  )
);

revoke all privileges on table public.service_add_on_links from anon;
grant select, insert, update, delete on table public.service_add_on_links to authenticated;

create or replace function public.public_booking_token_hash(raw_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(
    extensions.digest(convert_to(coalesce(raw_token, ''), 'UTF8'), 'sha256'::text),
    'hex'
  )
$$;

revoke all on function public.public_booking_token_hash(text) from public;

create or replace function public.get_public_booking_context(
  target_salon_id uuid,
  p_range_start timestamptz default now(),
  p_range_end timestamptz default now() + interval '45 days'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  context_payload jsonb;
  is_public boolean;
  location_row record;
  settings_row public.booking_settings%rowtype;
begin
  select
    locations.id,
    locations.organization_id,
    locations.name,
    locations.phone,
    locations.address_line1,
    locations.address_line2,
    locations.city,
    locations.state,
    locations.postal_code,
    locations.country,
    locations.status,
    salon_settings.business_name,
    salon_settings.email,
    salon_settings.website,
    salon_settings.business_description,
    salon_settings.public_profile_tagline,
    salon_settings.public_profile_story,
    salon_settings.public_profile_logo_path,
    salon_settings.public_profile_cover_path,
    salon_settings.public_discovery_enabled,
    salon_settings.public_discovery_published_at
  into location_row
  from public.locations
  left join public.salon_settings
    on salon_settings.salon_id = locations.id
    and salon_settings.organization_id = locations.organization_id
  where locations.id = target_salon_id;

  if location_row.id is null then
    return jsonb_build_object('state', 'not_found');
  end if;

  is_public := public.salon_profile_public_salon_exists(target_salon_id);

  select *
  into settings_row
  from public.booking_settings
  where booking_settings.salon_id = target_salon_id;

  context_payload := jsonb_build_object(
    'state',
    case
      when is_public is not true then 'not_public'
      when coalesce(settings_row.booking_enabled, false) is not true
        or coalesce(settings_row.online_booking_visible, false) is not true
      then 'booking_disabled'
      else 'ready'
    end,
    'profile',
    jsonb_build_object(
      'organization_id', location_row.organization_id,
      'salon_id', location_row.id,
      'name', coalesce(nullif(btrim(location_row.business_name), ''), location_row.name),
      'tagline', nullif(btrim(location_row.public_profile_tagline), ''),
      'description', nullif(btrim(location_row.business_description), ''),
      'story', nullif(btrim(location_row.public_profile_story), ''),
      'phone', coalesce(nullif(btrim(location_row.phone), ''), null),
      'email', nullif(btrim(location_row.email), ''),
      'website', nullif(btrim(location_row.website), ''),
      'address_line1', location_row.address_line1,
      'address_line2', location_row.address_line2,
      'city', location_row.city,
      'state', location_row.state,
      'postal_code', location_row.postal_code,
      'country', location_row.country,
      'logo_path', nullif(btrim(location_row.public_profile_logo_path), ''),
      'cover_path', nullif(btrim(location_row.public_profile_cover_path), ''),
      'public_discovery_enabled', coalesce(location_row.public_discovery_enabled, false),
      'public_discovery_published_at', location_row.public_discovery_published_at
    ),
    'settings',
    jsonb_build_object(
      'booking_enabled', coalesce(settings_row.booking_enabled, false),
      'online_booking_visible', coalesce(settings_row.online_booking_visible, false),
      'confirmation_mode', coalesce(settings_row.confirmation_mode, 'request_confirmation'),
      'minimum_lead_time_minutes', coalesce(settings_row.minimum_lead_time_minutes, 120),
      'maximum_advance_window_days', coalesce(settings_row.maximum_advance_window_days, 30),
      'slot_interval_minutes', coalesce(settings_row.slot_interval_minutes, 15),
      'default_cleanup_buffer_minutes', coalesce(settings_row.default_cleanup_buffer_minutes, 0),
      'same_day_booking_enabled', coalesce(settings_row.same_day_booking_enabled, true),
      'cancellation_window_minutes', coalesce(settings_row.cancellation_window_minutes, 1440),
      'late_cancellation_policy', coalesce(settings_row.late_cancellation_policy, '{}'::jsonb),
      'no_show_policy', coalesce(settings_row.no_show_policy, '{}'::jsonb),
      'any_professional_enabled', coalesce(settings_row.any_professional_enabled, true),
      'split_staff_appointment_enabled', coalesce(settings_row.split_staff_appointment_enabled, false),
      'guest_booking_enabled', coalesce(settings_row.guest_booking_enabled, false),
      'timezone_iana', coalesce(nullif(btrim(settings_row.timezone_iana), ''), 'America/Chicago'),
      'payment_required_enabled', coalesce(settings_row.payment_required_enabled, false),
      'deposit_required_enabled', coalesce(settings_row.deposit_required_enabled, false)
    )
  );

  context_payload := context_payload || jsonb_build_object(
    'services',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', services.id,
          'name', services.name,
          'category', services.category,
          'base_price', services.base_price,
          'duration_minutes', services.duration_minutes,
          'description', services.description
        )
        order by services.category nulls last, services.name
      )
      from public.services
      where services.salon_id = target_salon_id
        and services.organization_id = location_row.organization_id
        and services.is_active = true
        and is_public
    ), '[]'::jsonb),
    'add_on_links',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', links.id,
          'parent_service_id', links.parent_service_id,
          'add_on_service_id', links.add_on_service_id,
          'display_order', links.display_order
        )
        order by links.display_order, add_on_services.name
      )
      from public.service_add_on_links links
      join public.services parent_services
        on parent_services.id = links.parent_service_id
        and parent_services.salon_id = links.salon_id
        and parent_services.organization_id = links.organization_id
        and parent_services.is_active = true
      join public.services add_on_services
        on add_on_services.id = links.add_on_service_id
        and add_on_services.salon_id = links.salon_id
        and add_on_services.organization_id = links.organization_id
        and add_on_services.is_active = true
      where links.salon_id = target_salon_id
        and links.organization_id = location_row.organization_id
        and links.is_active = true
        and is_public
    ), '[]'::jsonb),
    'staff',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', staff.id,
          'display_name', staff.display_name,
          'job_title', staff.job_title,
          'avatar_path', nullif(btrim(staff.public_profile_photo_path), ''),
          'bio', nullif(btrim(staff.public_bio), ''),
          'specialties', coalesce(staff.specialties, '{}'::text[])
        )
        order by staff.profile_display_order nulls last, staff.display_name
      )
      from public.staff
      where staff.salon_id = target_salon_id
        and staff.organization_id = location_row.organization_id
        and staff.is_active = true
        and staff.public_profile_visible = true
        and staff.owner_public_enabled = true
        and staff.staff_public_consent_status = 'granted'
        and staff.online_booking_enabled = true
        and is_public
    ), '[]'::jsonb),
    'assignments',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', assignments.id,
          'staff_id', assignments.staff_id,
          'service_id', assignments.service_id,
          'custom_duration_minutes', assignments.custom_duration_minutes,
          'custom_price', assignments.custom_price
        )
      )
      from public.staff_service_assignments assignments
      join public.staff
        on staff.id = assignments.staff_id
        and staff.salon_id = assignments.salon_id
        and staff.organization_id = assignments.organization_id
        and staff.is_active = true
        and staff.public_profile_visible = true
        and staff.owner_public_enabled = true
        and staff.staff_public_consent_status = 'granted'
        and staff.online_booking_enabled = true
      join public.services
        on services.id = assignments.service_id
        and services.salon_id = assignments.salon_id
        and services.organization_id = assignments.organization_id
        and services.is_active = true
      where assignments.salon_id = target_salon_id
        and assignments.organization_id = location_row.organization_id
        and assignments.is_active = true
        and assignments.online_bookable = true
        and is_public
    ), '[]'::jsonb),
    'availability_rules',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', rules.id,
          'staff_id', rules.staff_id,
          'rule_type', rules.rule_type,
          'day_of_week', rules.day_of_week,
          'starts_at_local', rules.starts_at_local,
          'ends_at_local', rules.ends_at_local,
          'timezone_iana', rules.timezone_iana,
          'effective_start_date', rules.effective_start_date,
          'effective_end_date', rules.effective_end_date
        )
      )
      from public.staff_availability_rules rules
      where rules.salon_id = target_salon_id
        and rules.organization_id = location_row.organization_id
        and rules.is_active = true
        and (
          rules.staff_id is null
          or exists (
            select 1
            from public.staff
            where staff.id = rules.staff_id
              and staff.salon_id = rules.salon_id
              and staff.organization_id = rules.organization_id
              and staff.is_active = true
              and staff.public_profile_visible = true
              and staff.owner_public_enabled = true
              and staff.staff_public_consent_status = 'granted'
              and staff.online_booking_enabled = true
          )
        )
        and is_public
    ), '[]'::jsonb),
    'time_blocks',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', blocks.id,
          'staff_id', blocks.staff_id,
          'block_type', blocks.block_type,
          'starts_at', blocks.starts_at,
          'ends_at', blocks.ends_at
        )
      )
      from public.staff_time_blocks blocks
      where blocks.salon_id = target_salon_id
        and blocks.organization_id = location_row.organization_id
        and blocks.starts_at < p_range_end
        and blocks.ends_at > p_range_start
        and (
          blocks.staff_id is null
          or exists (
            select 1
            from public.staff
            where staff.id = blocks.staff_id
              and staff.salon_id = blocks.salon_id
              and staff.organization_id = blocks.organization_id
              and staff.is_active = true
              and staff.public_profile_visible = true
              and staff.owner_public_enabled = true
              and staff.staff_public_consent_status = 'granted'
              and staff.online_booking_enabled = true
          )
        )
        and is_public
    ), '[]'::jsonb),
    'busy_lines',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'booking_line_id', booking_lines.id,
          'booking_id', booking_lines.booking_id,
          'staff_id', booking_lines.assigned_staff_id,
          'scheduled_start_at', booking_lines.scheduled_start_at,
          'scheduled_end_at', booking_lines.scheduled_end_at
        )
      )
      from public.booking_lines
      join public.bookings
        on bookings.id = booking_lines.booking_id
      where booking_lines.salon_id = target_salon_id
        and booking_lines.organization_id = location_row.organization_id
        and booking_lines.assigned_staff_id is not null
        and booking_lines.scheduled_start_at < p_range_end
        and booking_lines.scheduled_end_at > p_range_start
        and public.booking_status_blocks_slot(bookings.status)
        and is_public
    ), '[]'::jsonb),
    'looks',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', looks.id,
          'title', looks.title,
          'service_id', looks.service_id,
          'recommended_staff_id', looks.recommended_staff_id
        )
        order by looks.is_pinned desc, looks.published_at desc nulls last
      )
      from public.salon_profile_looks looks
      where looks.salon_id = target_salon_id
        and looks.organization_id = location_row.organization_id
        and looks.status = 'published'
        and is_public
    ), '[]'::jsonb)
  );

  return context_payload;
end;
$$;

revoke all on function public.get_public_booking_context(uuid, timestamptz, timestamptz)
from public;
grant execute on function public.get_public_booking_context(uuid, timestamptz, timestamptz)
to anon, authenticated;

create or replace function public.public_staff_line_is_available(
  p_salon_id uuid,
  p_organization_id uuid,
  p_staff_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_timezone_iana text,
  p_ignore_booking_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  local_end timestamp;
  local_start timestamp;
  local_start_date date;
  local_day integer;
  local_end_time time;
  local_start_time time;
  timezone_value text;
begin
  if p_salon_id is null
    or p_organization_id is null
    or p_staff_id is null
    or p_start_at is null
    or p_end_at is null
    or p_end_at <= p_start_at
  then
    return false;
  end if;

  timezone_value := coalesce(nullif(btrim(p_timezone_iana), ''), 'America/Chicago');
  local_start := p_start_at at time zone timezone_value;
  local_end := p_end_at at time zone timezone_value;

  if local_start::date <> local_end::date then
    return false;
  end if;

  local_start_date := local_start::date;
  local_day := extract(dow from local_start)::integer;
  local_start_time := local_start::time;
  local_end_time := local_end::time;

  if not exists (
    select 1
    from public.staff
    where staff.id = p_staff_id
      and staff.salon_id = p_salon_id
      and staff.organization_id = p_organization_id
      and staff.is_active = true
      and staff.public_profile_visible = true
      and staff.owner_public_enabled = true
      and staff.staff_public_consent_status = 'granted'
      and staff.online_booking_enabled = true
  ) then
    return false;
  end if;

  if not exists (
    select 1
    from public.staff_availability_rules rules
    where rules.salon_id = p_salon_id
      and rules.organization_id = p_organization_id
      and rules.is_active = true
      and rules.rule_type = 'working'
      and rules.day_of_week = local_day
      and (rules.staff_id is null or rules.staff_id = p_staff_id)
      and (rules.effective_start_date is null or rules.effective_start_date <= local_start_date)
      and (rules.effective_end_date is null or rules.effective_end_date >= local_start_date)
      and rules.starts_at_local <= local_start_time
      and rules.ends_at_local >= local_end_time
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.staff_availability_rules rules
    where rules.salon_id = p_salon_id
      and rules.organization_id = p_organization_id
      and rules.is_active = true
      and rules.rule_type = 'break'
      and rules.day_of_week = local_day
      and (rules.staff_id is null or rules.staff_id = p_staff_id)
      and (rules.effective_start_date is null or rules.effective_start_date <= local_start_date)
      and (rules.effective_end_date is null or rules.effective_end_date >= local_start_date)
      and rules.starts_at_local < local_end_time
      and rules.ends_at_local > local_start_time
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.staff_time_blocks blocks
    where blocks.salon_id = p_salon_id
      and blocks.organization_id = p_organization_id
      and (blocks.staff_id is null or blocks.staff_id = p_staff_id)
      and blocks.starts_at < p_end_at
      and blocks.ends_at > p_start_at
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.booking_lines
    join public.bookings
      on bookings.id = booking_lines.booking_id
    where booking_lines.salon_id = p_salon_id
      and booking_lines.organization_id = p_organization_id
      and booking_lines.assigned_staff_id = p_staff_id
      and booking_lines.scheduled_start_at < p_end_at
      and booking_lines.scheduled_end_at > p_start_at
      and (p_ignore_booking_id is null or bookings.id <> p_ignore_booking_id)
      and public.booking_status_blocks_slot(bookings.status)
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.public_staff_line_is_available(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  uuid
) from public;

create or replace function public.create_public_booking(
  p_salon_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_customer_first_name text,
  p_customer_last_name text,
  p_customer_phone text,
  p_customer_email text,
  p_public_notes text,
  p_idempotency_key text,
  p_source text,
  p_source_reference_type text,
  p_source_reference_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_id uuid;
  customer_id uuid;
  display_name text;
  email_normalized text;
  existing_email_customer public.customers%rowtype;
  existing_phone_customer public.customers%rowtype;
  line_end_at timestamptz;
  line_row jsonb;
  line_service_id uuid;
  line_staff_id uuid;
  line_start_at timestamptz;
  location_organization_id uuid;
  normalized_idempotency_key text;
  parent_service_id uuid;
  phone_digits text;
  prepared_lines jsonb := '[]'::jsonb;
  raw_manage_token text;
  representative_staff_id uuid;
  service_row public.services%rowtype;
  settings_row public.booking_settings%rowtype;
  source_value text;
  status_value text;
  token_hash text;
begin
  actor_user_id := public.current_public_user_id();
  normalized_idempotency_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  source_value := case
    when p_source in ('public_profile', 'explore') then p_source
    else 'public_profile'
  end;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id
    and locations.status = 'active';

  if location_organization_id is null
    or public.salon_profile_public_salon_exists(p_salon_id) is not true
  then
    raise exception 'Online booking is not available for this salon.';
  end if;

  select *
  into settings_row
  from public.booking_settings
  where booking_settings.salon_id = p_salon_id;

  if settings_row.id is null
    or settings_row.booking_enabled is not true
    or settings_row.online_booking_visible is not true
  then
    raise exception 'Online booking is not enabled for this salon.';
  end if;

  if actor_user_id is null and settings_row.guest_booking_enabled is not true then
    raise exception 'Guest booking is not enabled for this salon.';
  end if;

  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'Choose a valid appointment time.';
  end if;

  if p_start_at < now() + make_interval(mins => settings_row.minimum_lead_time_minutes) then
    raise exception 'Selected time is inside the minimum lead time.';
  end if;

  if p_start_at > now() + make_interval(days => settings_row.maximum_advance_window_days) then
    raise exception 'Selected time is outside the booking window.';
  end if;

  if not settings_row.same_day_booking_enabled
    and (p_start_at at time zone settings_row.timezone_iana)::date
      <= (now() at time zone settings_row.timezone_iana)::date
  then
    raise exception 'Same-day booking is not enabled.';
  end if;

  if normalized_idempotency_key is not null then
    select bookings.id
    into booking_id
    from public.bookings
    where bookings.salon_id = p_salon_id
      and bookings.idempotency_key = normalized_idempotency_key
    limit 1;

    if booking_id is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'booking_id', booking_id,
        'manage_token', null
      );
    end if;
  end if;

  if nullif(btrim(coalesce(p_source_reference_type, '')), '') is not null then
    if p_source_reference_type <> 'salon_profile_look'
      or p_source_reference_id is null
      or not exists (
        select 1
        from public.salon_profile_looks
        where salon_profile_looks.id = p_source_reference_id
          and salon_profile_looks.salon_id = p_salon_id
          and salon_profile_looks.organization_id = location_organization_id
          and salon_profile_looks.status = 'published'
      )
    then
      raise exception 'Booking source context is not available.';
    end if;
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0
  then
    raise exception 'Select at least one service.';
  end if;

  for line_row in
    select value
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    line_service_id := nullif(line_row ->> 'service_id', '')::uuid;
    line_staff_id := nullif(line_row ->> 'assigned_staff_id', '')::uuid;
    parent_service_id := nullif(line_row ->> 'parent_service_id', '')::uuid;
    line_start_at := nullif(line_row ->> 'scheduled_start_at', '')::timestamptz;
    line_end_at := nullif(line_row ->> 'scheduled_end_at', '')::timestamptz;

    if line_service_id is null or line_staff_id is null then
      raise exception 'Every public booking line requires a service and professional.';
    end if;

    select *
    into service_row
    from public.services
    where services.id = line_service_id
      and services.salon_id = p_salon_id
      and services.organization_id = location_organization_id
      and services.is_active = true;

    if service_row.id is null then
      raise exception 'Selected service is no longer available.';
    end if;

    if coalesce(line_row ->> 'line_type', 'service') = 'add_on' then
      if parent_service_id is null or not exists (
        select 1
        from public.service_add_on_links
        where service_add_on_links.salon_id = p_salon_id
          and service_add_on_links.organization_id = location_organization_id
          and service_add_on_links.parent_service_id = parent_service_id
          and service_add_on_links.add_on_service_id = line_service_id
          and service_add_on_links.is_active = true
      ) then
        raise exception 'Selected add-on is not available for this service.';
      end if;
    end if;

    if not exists (
      select 1
      from public.staff
      join public.staff_service_assignments assignments
        on assignments.staff_id = staff.id
        and assignments.salon_id = staff.salon_id
        and assignments.organization_id = staff.organization_id
      where staff.id = line_staff_id
        and staff.salon_id = p_salon_id
        and staff.organization_id = location_organization_id
        and staff.is_active = true
        and staff.public_profile_visible = true
        and staff.owner_public_enabled = true
        and staff.staff_public_consent_status = 'granted'
        and staff.online_booking_enabled = true
        and assignments.service_id = line_service_id
        and assignments.is_active = true
        and assignments.online_bookable = true
    ) then
      raise exception 'Selected professional is not available for this service.';
    end if;

    if line_start_at is null
      or line_end_at is null
      or line_end_at <= line_start_at
      or line_start_at < p_start_at
      or line_end_at > p_end_at
    then
      raise exception 'Selected service schedule is invalid.';
    end if;

    if not public.public_staff_line_is_available(
      p_salon_id,
      location_organization_id,
      line_staff_id,
      line_start_at,
      line_end_at,
      settings_row.timezone_iana,
      null
    ) then
      raise exception 'Selected professional is not available for this time.';
    end if;

    if representative_staff_id is null then
      representative_staff_id := line_staff_id;
    end if;

    prepared_lines := prepared_lines || jsonb_build_array(jsonb_build_object(
      'service_id', service_row.id,
      'assigned_staff_id', line_staff_id,
      'line_type', coalesce(nullif(line_row ->> 'line_type', ''), 'service'),
      'parent_booking_line_id', null,
      'service_name_snapshot', service_row.name,
      'service_category_snapshot', service_row.category,
      'service_description_snapshot', service_row.description,
      'unit_price', service_row.base_price,
      'quantity', 1,
      'duration_minutes', service_row.duration_minutes,
      'cleanup_buffer_minutes', coalesce(nullif(line_row ->> 'cleanup_buffer_minutes', '')::integer, 0),
      'display_order', coalesce(nullif(line_row ->> 'display_order', '')::integer, jsonb_array_length(prepared_lines)),
      'scheduled_start_at', line_start_at,
      'scheduled_end_at', line_end_at
    ));
  end loop;

  phone_digits := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]+', '', 'g'), '');
  email_normalized := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
  display_name := nullif(
    btrim(concat_ws(' ', nullif(btrim(coalesce(p_customer_first_name, '')), ''), nullif(btrim(coalesce(p_customer_last_name, '')), ''))),
    ''
  );

  if actor_user_id is null and (
    display_name is null
    or phone_digits is null
    or email_normalized is null
  ) then
    raise exception 'Guest booking requires name, phone, and email.';
  end if;

  if display_name is null then
    select coalesce(nullif(btrim(users.display_name), ''), users.email, users.phone)
    into display_name
    from public.users
    where users.id = actor_user_id;
  end if;

  display_name := coalesce(display_name, email_normalized, phone_digits, 'Guest Customer');

  if phone_digits is not null then
    select *
    into existing_phone_customer
    from public.customers
    where customers.location_id = p_salon_id
      and customers.phone = phone_digits
      and customers.status = 'active'
    limit 1;
  end if;

  if email_normalized is not null then
    select *
    into existing_email_customer
    from public.customers
    where customers.location_id = p_salon_id
      and lower(customers.email) = email_normalized
      and customers.status = 'active'
    limit 1;
  end if;

  if existing_phone_customer.id is not null
    and (existing_email_customer.id is null or existing_email_customer.id = existing_phone_customer.id)
  then
    customer_id := existing_phone_customer.id;
  elsif existing_email_customer.id is not null
    and existing_phone_customer.id is null
  then
    customer_id := existing_email_customer.id;
  else
    insert into public.customers (
      location_id,
      name,
      phone,
      email,
      status
    )
    values (
      p_salon_id,
      display_name,
      phone_digits,
      email_normalized,
      'active'
    )
    returning id into customer_id;
  end if;

  raw_manage_token := encode(extensions.gen_random_bytes(32), 'hex');
  token_hash := public.public_booking_token_hash(raw_manage_token);
  status_value := case
    when settings_row.confirmation_mode = 'instant_booking' then 'confirmed'
    else 'pending'
  end;

  insert into public.bookings (
    organization_id,
    salon_id,
    customer_id,
    customer_user_id,
    staff_id,
    start_at,
    end_at,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    customer_cancellation_token_hash,
    source_reference_type,
    source_reference_id,
    idempotency_key,
    public_notes,
    created_by_user_id,
    updated_by_user_id,
    payment_status,
    cancellation_policy_snapshot
  )
  values (
    location_organization_id,
    p_salon_id,
    customer_id,
    actor_user_id,
    representative_staff_id,
    p_start_at,
    p_end_at,
    status_value,
    source_value,
    settings_row.confirmation_mode,
    case when status_value = 'confirmed' then 'confirmed' else 'requested' end,
    settings_row.timezone_iana,
    token_hash,
    nullif(btrim(coalesce(p_source_reference_type, '')), ''),
    p_source_reference_id,
    normalized_idempotency_key,
    nullif(btrim(coalesce(p_public_notes, '')), ''),
    actor_user_id,
    actor_user_id,
    'not_required',
    jsonb_build_object(
      'cancellation_window_minutes',
      coalesce(settings_row.cancellation_window_minutes, 1440)
    )
  )
  returning id into booking_id;

  if status_value = 'pending' then
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
      'pending',
      actor_user_id,
      case when actor_user_id is null then 'guest' else 'customer' end
    );
  elsif status_value = 'confirmed' then
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
      'confirmed',
      'confirmed',
      actor_user_id,
      case when actor_user_id is null then 'guest' else 'customer' end
    );
  end if;

  for line_row in
    select value
    from jsonb_array_elements(prepared_lines)
  loop
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
      scheduled_end_at
    )
    values (
      location_organization_id,
      p_salon_id,
      booking_id,
      nullif(line_row ->> 'parent_booking_line_id', '')::uuid,
      coalesce(nullif(line_row ->> 'line_type', ''), 'service'),
      nullif(line_row ->> 'service_id', '')::uuid,
      coalesce(nullif(line_row ->> 'service_name_snapshot', ''), 'Pending service snapshot'),
      nullif(line_row ->> 'service_category_snapshot', ''),
      nullif(line_row ->> 'service_description_snapshot', ''),
      coalesce(nullif(line_row ->> 'unit_price', '')::numeric, 0),
      1,
      coalesce(nullif(line_row ->> 'duration_minutes', '')::integer, 1),
      coalesce(nullif(line_row ->> 'cleanup_buffer_minutes', '')::integer, 0),
      coalesce(nullif(line_row ->> 'display_order', '')::integer, 0),
      nullif(line_row ->> 'assigned_staff_id', '')::uuid,
      nullif(line_row ->> 'scheduled_start_at', '')::timestamptz,
      nullif(line_row ->> 'scheduled_end_at', '')::timestamptz
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'booking_id', booking_id,
    'manage_token', raw_manage_token,
    'status', status_value,
    'confirmation_status', case when status_value = 'confirmed' then 'confirmed' else 'requested' end
  );
end;
$$;

revoke all on function public.create_public_booking(
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
  text,
  uuid,
  jsonb
) from public;
grant execute on function public.create_public_booking(
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
  text,
  uuid,
  jsonb
) to anon, authenticated;

create or replace function public.get_public_booking_by_manage_token(raw_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'ok', true,
      'booking',
      jsonb_build_object(
        'id', bookings.id,
        'salon_id', bookings.salon_id,
        'status', public.normalize_booking_status(bookings.status),
        'confirmation_status', bookings.confirmation_status,
        'source', bookings.source,
        'start_at', bookings.start_at,
        'end_at', bookings.end_at,
        'timezone', bookings.salon_timezone_snapshot,
        'public_notes', bookings.public_notes,
        'cancellation_reason', bookings.cancellation_reason,
        'cancelled_at', bookings.cancelled_at,
        'can_change',
          public.normalize_booking_status(bookings.status) not in ('completed', 'cancelled', 'no_show')
          and bookings.start_at > now(),
        'cancellation_window_minutes',
          coalesce((bookings.cancellation_policy_snapshot ->> 'cancellation_window_minutes')::integer, 1440)
      ),
      'salon',
      jsonb_build_object(
        'name', coalesce(nullif(btrim(salon_settings.business_name), ''), locations.name),
        'phone', coalesce(nullif(btrim(salon_settings.phone), ''), locations.phone),
        'address_line1', coalesce(nullif(btrim(salon_settings.address_line1), ''), locations.address_line1),
        'city', coalesce(nullif(btrim(salon_settings.city), ''), locations.city),
        'state', coalesce(nullif(btrim(salon_settings.state), ''), locations.state),
        'timezone', bookings.salon_timezone_snapshot
      ),
      'customer',
      jsonb_build_object(
        'name', customers.name,
        'phone', customers.phone,
        'email', customers.email
      ),
      'lines',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', booking_lines.id,
            'line_type', booking_lines.line_type,
            'service_id', booking_lines.service_id,
            'service_name', booking_lines.service_name_snapshot,
            'category', booking_lines.service_category_snapshot,
            'duration_minutes', booking_lines.duration_minutes,
            'line_total', booking_lines.line_total,
            'scheduled_start_at', booking_lines.scheduled_start_at,
            'scheduled_end_at', booking_lines.scheduled_end_at,
            'staff_id', booking_lines.assigned_staff_id,
            'staff_name', staff.display_name,
            'staff_avatar_path', nullif(btrim(staff.public_profile_photo_path), '')
          )
          order by booking_lines.display_order
        )
        from public.booking_lines
        left join public.staff
          on staff.id = booking_lines.assigned_staff_id
        where booking_lines.booking_id = bookings.id
      ), '[]'::jsonb)
    )
    from public.bookings
    join public.locations
      on locations.id = bookings.salon_id
    left join public.salon_settings
      on salon_settings.salon_id = bookings.salon_id
      and salon_settings.organization_id = bookings.organization_id
    join public.customers
      on customers.id = bookings.customer_id
    where bookings.customer_cancellation_token_hash = public.public_booking_token_hash(raw_token)
    limit 1
  ), jsonb_build_object('ok', false, 'code', 'invalid_token'))
$$;

revoke all on function public.get_public_booking_by_manage_token(text) from public;
grant execute on function public.get_public_booking_by_manage_token(text) to anon, authenticated;

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
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
  cursor_at timestamptz;
  line_row public.booking_lines%rowtype;
  line_duration interval;
  new_end_at timestamptz;
  settings_row public.booking_settings%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash = public.public_booking_token_hash(raw_token)
  limit 1;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  select *
  into settings_row
  from public.booking_settings
  where salon_id = booking_row.salon_id;

  if p_start_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_time');
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(settings_row.minimum_lead_time_minutes, 120)) then
    return jsonb_build_object('ok', false, 'code', 'lead_time');
  end if;

  if p_start_at > now() + make_interval(days => coalesce(settings_row.maximum_advance_window_days, 30)) then
    return jsonb_build_object('ok', false, 'code', 'advance_window');
  end if;

  if coalesce(settings_row.same_day_booking_enabled, true) is not true
    and (p_start_at at time zone coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'))::date
      <= (now() at time zone coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'))::date
  then
    return jsonb_build_object('ok', false, 'code', 'same_day_disabled');
  end if;

  new_end_at := p_start_at + (booking_row.end_at - booking_row.start_at);

  cursor_at := p_start_at;

  for line_row in
    select *
    from public.booking_lines
    where booking_id = booking_row.id
    order by display_order, created_at
  loop
    line_duration := coalesce(
      line_row.scheduled_end_at - line_row.scheduled_start_at,
      make_interval(mins => line_row.duration_minutes)
    );

    if line_row.assigned_staff_id is not null
      and not public.public_staff_line_is_available(
        booking_row.salon_id,
        booking_row.organization_id,
        line_row.assigned_staff_id,
        cursor_at,
        cursor_at + line_duration,
        coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'),
        booking_row.id
      )
    then
      return jsonb_build_object('ok', false, 'code', 'unavailable_slot');
    end if;

    cursor_at := cursor_at + line_duration + make_interval(mins => coalesce(line_row.cleanup_buffer_minutes, 0));
  end loop;

  update public.bookings
  set
    start_at = p_start_at,
    end_at = new_end_at,
    updated_by_user_id = actor_user_id,
    updated_at = now()
  where id = booking_row.id;

  cursor_at := p_start_at;

  for line_row in
    select *
    from public.booking_lines
    where booking_id = booking_row.id
    order by display_order, created_at
  loop
    line_duration := coalesce(
      line_row.scheduled_end_at - line_row.scheduled_start_at,
      make_interval(mins => line_row.duration_minutes)
    );

    update public.booking_lines
    set
      scheduled_start_at = cursor_at,
      scheduled_end_at = cursor_at + line_duration,
      updated_at = now()
    where id = line_row.id;

    cursor_at := cursor_at + line_duration + make_interval(mins => coalesce(line_row.cleanup_buffer_minutes, 0));
  end loop;

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

revoke all on function public.reschedule_public_booking_by_manage_token(text, timestamptz)
from public;
grant execute on function public.reschedule_public_booking_by_manage_token(text, timestamptz)
to anon, authenticated;

create or replace function public.cancel_public_booking_by_manage_token(
  raw_token text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash = public.public_booking_token_hash(raw_token)
  limit 1;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    cancelled_at = now(),
    cancelled_by_user_id = actor_user_id,
    updated_by_user_id = actor_user_id,
    updated_at = now()
  where id = booking_row.id;

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

revoke all on function public.cancel_public_booking_by_manage_token(text, text)
from public;
grant execute on function public.cancel_public_booking_by_manage_token(text, text)
to anon, authenticated;

create or replace function public.get_public_explore_decision_signals(
  target_salon_ids uuid[]
)
returns table (
  salon_id uuid,
  average_rating numeric,
  review_count bigint,
  booking_enabled boolean,
  bookable_service_id uuid,
  bookable_service_name text,
  next_available_at timestamptz,
  next_availability_label text,
  booking_href text
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_salons as (
    select distinct requested_ids.salon_id
    from unnest(coalesce(target_salon_ids, array[]::uuid[])) as requested_ids(salon_id)
    where requested_ids.salon_id is not null
  ),
  ready as (
    select
      requested_salons.salon_id,
      services.id as service_id,
      services.name as service_name,
      (
        public.salon_profile_public_salon_exists(requested_salons.salon_id)
        and coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and exists (
          select 1
          from public.staff_service_assignments assignments
          join public.staff
            on staff.id = assignments.staff_id
          where assignments.salon_id = requested_salons.salon_id
            and assignments.service_id = services.id
            and assignments.is_active = true
            and assignments.online_bookable = true
            and staff.is_active = true
            and staff.public_profile_visible = true
            and staff.owner_public_enabled = true
            and staff.staff_public_consent_status = 'granted'
            and staff.online_booking_enabled = true
        )
        and exists (
          select 1
          from public.staff_availability_rules rules
          where rules.salon_id = requested_salons.salon_id
            and rules.is_active = true
            and rules.rule_type = 'working'
        )
      ) as is_ready
    from requested_salons
    left join public.booking_settings
      on booking_settings.salon_id = requested_salons.salon_id
    left join lateral (
      select services.id, services.name
      from public.services
      where services.salon_id = requested_salons.salon_id
        and services.is_active = true
      order by services.name
      limit 1
    ) services on true
  )
  select
    requested_salons.salon_id,
    reviews.average_rating,
    coalesce(reviews.review_count, 0)::bigint as review_count,
    coalesce(ready.is_ready, false) as booking_enabled,
    case when ready.is_ready then ready.service_id else null end as bookable_service_id,
    case when ready.is_ready then ready.service_name else null end as bookable_service_name,
    null::timestamptz as next_available_at,
    case when ready.is_ready then 'Online booking' else null end as next_availability_label,
    case
      when ready.is_ready
      then '/book/' || requested_salons.salon_id::text || '?source=explore'
        || case when ready.service_id is not null then '&serviceId=' || ready.service_id::text else '' end
      else null
    end as booking_href
  from requested_salons
  left join ready
    on ready.salon_id = requested_salons.salon_id
  left join lateral public.get_public_salon_profile_review_summary(
    requested_salons.salon_id
  ) reviews
    on true
  where public.salon_profile_public_salon_exists(requested_salons.salon_id);
$$;

comment on function public.get_public_explore_decision_signals(uuid[])
is 'Public Explore card decision signals for canonical public booking readiness.';

revoke all on function public.get_public_explore_decision_signals(uuid[])
from public;
grant execute on function public.get_public_explore_decision_signals(uuid[])
to anon, authenticated;
