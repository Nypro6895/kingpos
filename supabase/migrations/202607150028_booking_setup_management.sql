-- Booking setup management contracts.
-- Adds audit columns and transaction-safe RPCs for staff-service assignments,
-- weekly staff availability, and one-time time blocks.

alter table public.staff_service_assignments
add column if not exists created_by_user_id uuid references public.users(id) on delete set null,
add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

alter table public.staff_availability_rules
add column if not exists created_by_user_id uuid references public.users(id) on delete set null,
add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

alter table public.staff_time_blocks
add column if not exists is_active boolean not null default true,
add column if not exists cancelled_at timestamptz,
add column if not exists cancelled_by_user_id uuid references public.users(id) on delete set null,
add column if not exists updated_by_user_id uuid references public.users(id) on delete set null;

create index if not exists staff_time_blocks_active_time_idx
on public.staff_time_blocks(salon_id, staff_id, starts_at, ends_at)
where is_active = true;

create or replace function public.save_staff_service_assignment_batch(
  p_salon_id uuid,
  p_staff_id uuid,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  assigned_value boolean;
  changed_count integer := 0;
  location_organization_id uuid;
  online_bookable_value boolean;
  payload_item jsonb;
  seen_service_ids uuid[] := array[]::uuid[];
  service_id_value uuid;
  staff_row public.staff%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in before managing booking setup.';
  end if;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id;

  if location_organization_id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage', 'staff.manage', 'services.manage']::text[]
  ) then
    raise exception 'Missing booking setup management permission.';
  end if;

  if jsonb_typeof(coalesce(p_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Assignments payload must be an array.';
  end if;

  select *
  into staff_row
  from public.staff
  where staff.id = p_staff_id
    and staff.salon_id = p_salon_id
    and staff.organization_id = location_organization_id;

  if staff_row.id is null then
    raise exception 'Staff profile was not found in this salon.';
  end if;

  if staff_row.is_active is not true then
    raise exception 'Inactive staff cannot be made booking-ready.';
  end if;

  for payload_item in
    select value
    from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    service_id_value := nullif(payload_item ->> 'service_id', '')::uuid;
    assigned_value := coalesce((payload_item ->> 'assigned')::boolean, false);
    online_bookable_value :=
      assigned_value and coalesce((payload_item ->> 'online_bookable')::boolean, false);

    if service_id_value is null then
      raise exception 'Every assignment row requires a service.';
    end if;

    if service_id_value = any(seen_service_ids) then
      raise exception 'Duplicate service assignment row.';
    end if;

    seen_service_ids := array_append(seen_service_ids, service_id_value);

    if not exists (
      select 1
      from public.services
      where services.id = service_id_value
        and services.salon_id = p_salon_id
        and services.organization_id = location_organization_id
    ) then
      raise exception 'Service does not belong to this salon.';
    end if;

    if assigned_value and not exists (
      select 1
      from public.services
      where services.id = service_id_value
        and services.salon_id = p_salon_id
        and services.organization_id = location_organization_id
        and services.is_active = true
    ) then
      raise exception 'Inactive services cannot be assigned for booking.';
    end if;

    if assigned_value then
      insert into public.staff_service_assignments (
        organization_id,
        salon_id,
        staff_id,
        service_id,
        is_active,
        online_bookable,
        created_by_user_id,
        updated_by_user_id
      )
      values (
        location_organization_id,
        p_salon_id,
        p_staff_id,
        service_id_value,
        true,
        online_bookable_value,
        actor_user_id,
        actor_user_id
      )
      on conflict (salon_id, staff_id, service_id)
      do update set
        is_active = excluded.is_active,
        online_bookable = excluded.online_bookable,
        updated_at = now(),
        updated_by_user_id = actor_user_id;
    else
      update public.staff_service_assignments
      set
        is_active = false,
        online_bookable = false,
        updated_at = now(),
        updated_by_user_id = actor_user_id
      where staff_service_assignments.organization_id = location_organization_id
        and staff_service_assignments.salon_id = p_salon_id
        and staff_service_assignments.staff_id = p_staff_id
        and staff_service_assignments.service_id = service_id_value;
    end if;

    changed_count := changed_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'changed_count', changed_count);
end;
$$;

create or replace function public.save_service_staff_assignment_batch(
  p_salon_id uuid,
  p_service_id uuid,
  p_staff_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  assigned_value boolean;
  changed_count integer := 0;
  location_organization_id uuid;
  online_bookable_value boolean;
  payload_item jsonb;
  seen_staff_ids uuid[] := array[]::uuid[];
  service_row public.services%rowtype;
  staff_id_value uuid;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in before managing booking setup.';
  end if;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id;

  if location_organization_id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage', 'staff.manage', 'services.manage']::text[]
  ) then
    raise exception 'Missing booking setup management permission.';
  end if;

  if jsonb_typeof(coalesce(p_staff_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Staff assignment payload must be an array.';
  end if;

  select *
  into service_row
  from public.services
  where services.id = p_service_id
    and services.salon_id = p_salon_id
    and services.organization_id = location_organization_id;

  if service_row.id is null then
    raise exception 'Service was not found in this salon.';
  end if;

  for payload_item in
    select value
    from jsonb_array_elements(coalesce(p_staff_assignments, '[]'::jsonb))
  loop
    staff_id_value := nullif(payload_item ->> 'staff_id', '')::uuid;
    assigned_value := coalesce((payload_item ->> 'assigned')::boolean, false);
    online_bookable_value :=
      assigned_value and coalesce((payload_item ->> 'online_bookable')::boolean, false);

    if staff_id_value is null then
      raise exception 'Every assignment row requires a staff profile.';
    end if;

    if staff_id_value = any(seen_staff_ids) then
      raise exception 'Duplicate staff assignment row.';
    end if;

    seen_staff_ids := array_append(seen_staff_ids, staff_id_value);

    if not exists (
      select 1
      from public.staff
      where staff.id = staff_id_value
        and staff.salon_id = p_salon_id
        and staff.organization_id = location_organization_id
    ) then
      raise exception 'Staff profile does not belong to this salon.';
    end if;

    if assigned_value and service_row.is_active is not true then
      raise exception 'Inactive services cannot be assigned for booking.';
    end if;

    if assigned_value and not exists (
      select 1
      from public.staff
      where staff.id = staff_id_value
        and staff.salon_id = p_salon_id
        and staff.organization_id = location_organization_id
        and staff.is_active = true
    ) then
      raise exception 'Inactive staff cannot be made booking-ready.';
    end if;

    if assigned_value then
      insert into public.staff_service_assignments (
        organization_id,
        salon_id,
        staff_id,
        service_id,
        is_active,
        online_bookable,
        created_by_user_id,
        updated_by_user_id
      )
      values (
        location_organization_id,
        p_salon_id,
        staff_id_value,
        p_service_id,
        true,
        online_bookable_value,
        actor_user_id,
        actor_user_id
      )
      on conflict (salon_id, staff_id, service_id)
      do update set
        is_active = excluded.is_active,
        online_bookable = excluded.online_bookable,
        updated_at = now(),
        updated_by_user_id = actor_user_id;
    else
      update public.staff_service_assignments
      set
        is_active = false,
        online_bookable = false,
        updated_at = now(),
        updated_by_user_id = actor_user_id
      where staff_service_assignments.organization_id = location_organization_id
        and staff_service_assignments.salon_id = p_salon_id
        and staff_service_assignments.staff_id = staff_id_value
        and staff_service_assignments.service_id = p_service_id;
    end if;

    changed_count := changed_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'changed_count', changed_count);
end;
$$;

create or replace function public.save_staff_weekly_availability(
  p_salon_id uuid,
  p_staff_id uuid,
  p_rules jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  inserted_count integer := 0;
  location_organization_id uuid;
  staff_row public.staff%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in before managing staff availability.';
  end if;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id;

  if location_organization_id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage', 'staff.manage']::text[]
  ) then
    raise exception 'Missing staff availability management permission.';
  end if;

  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'Weekly availability payload must be an array.';
  end if;

  select *
  into staff_row
  from public.staff
  where staff.id = p_staff_id
    and staff.salon_id = p_salon_id
    and staff.organization_id = location_organization_id;

  if staff_row.id is null then
    raise exception 'Staff profile was not found in this salon.';
  end if;

  if staff_row.is_active is not true then
    raise exception 'Inactive staff cannot have public availability enabled.';
  end if;

  if exists (
    with parsed as (
      select
        row_number() over () as row_index,
        value ->> 'rule_type' as rule_type,
        (value ->> 'day_of_week')::integer as day_of_week,
        nullif(value ->> 'starts_at_local', '')::time as starts_at_local,
        nullif(value ->> 'ends_at_local', '')::time as ends_at_local,
        nullif(btrim(coalesce(value ->> 'timezone_iana', '')), '') as timezone_iana
      from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb))
    )
    select 1
    from parsed
    where rule_type not in ('working', 'break')
      or day_of_week not between 0 and 6
      or starts_at_local is null
      or ends_at_local is null
      or ends_at_local <= starts_at_local
      or timezone_iana is null
  ) then
    raise exception 'Weekly availability contains an invalid interval.';
  end if;

  if exists (
    with parsed as (
      select
        row_number() over () as row_index,
        value ->> 'rule_type' as rule_type,
        (value ->> 'day_of_week')::integer as day_of_week,
        nullif(value ->> 'starts_at_local', '')::time as starts_at_local,
        nullif(value ->> 'ends_at_local', '')::time as ends_at_local
      from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb))
    )
    select 1
    from parsed left_rule
    join parsed right_rule
      on right_rule.row_index > left_rule.row_index
      and right_rule.rule_type = left_rule.rule_type
      and right_rule.day_of_week = left_rule.day_of_week
      and right_rule.starts_at_local < left_rule.ends_at_local
      and right_rule.ends_at_local > left_rule.starts_at_local
  ) then
    raise exception 'Weekly availability intervals cannot overlap.';
  end if;

  if exists (
    with parsed as (
      select
        row_number() over () as row_index,
        value ->> 'rule_type' as rule_type,
        (value ->> 'day_of_week')::integer as day_of_week,
        nullif(value ->> 'starts_at_local', '')::time as starts_at_local,
        nullif(value ->> 'ends_at_local', '')::time as ends_at_local
      from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb))
    )
    select 1
    from parsed break_rule
    where break_rule.rule_type = 'break'
      and not exists (
        select 1
        from parsed working_rule
        where working_rule.rule_type = 'working'
          and working_rule.day_of_week = break_rule.day_of_week
          and working_rule.starts_at_local <= break_rule.starts_at_local
          and working_rule.ends_at_local >= break_rule.ends_at_local
      )
  ) then
    raise exception 'Breaks must fit inside working intervals.';
  end if;

  update public.staff_availability_rules
  set
    is_active = false,
    updated_at = now(),
    updated_by_user_id = actor_user_id
  where staff_availability_rules.organization_id = location_organization_id
    and staff_availability_rules.salon_id = p_salon_id
    and staff_availability_rules.staff_id = p_staff_id
    and staff_availability_rules.is_active = true;

  insert into public.staff_availability_rules (
    organization_id,
    salon_id,
    staff_id,
    rule_type,
    day_of_week,
    starts_at_local,
    ends_at_local,
    timezone_iana,
    effective_start_date,
    effective_end_date,
    is_active,
    created_by_user_id,
    updated_by_user_id
  )
  select
    location_organization_id,
    p_salon_id,
    p_staff_id,
    parsed.rule_type,
    parsed.day_of_week,
    parsed.starts_at_local,
    parsed.ends_at_local,
    parsed.timezone_iana,
    parsed.effective_start_date,
    parsed.effective_end_date,
    true,
    actor_user_id,
    actor_user_id
  from (
    select
      value ->> 'rule_type' as rule_type,
      (value ->> 'day_of_week')::integer as day_of_week,
      nullif(value ->> 'starts_at_local', '')::time as starts_at_local,
      nullif(value ->> 'ends_at_local', '')::time as ends_at_local,
      nullif(btrim(coalesce(value ->> 'timezone_iana', '')), '') as timezone_iana,
      nullif(value ->> 'effective_start_date', '')::date as effective_start_date,
      nullif(value ->> 'effective_end_date', '')::date as effective_end_date
    from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb))
  ) parsed;

  get diagnostics inserted_count = row_count;

  return jsonb_build_object('ok', true, 'rule_count', inserted_count);
end;
$$;

create or replace function public.create_staff_time_block(
  p_salon_id uuid,
  p_staff_id uuid,
  p_block_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone_iana text,
  p_reason text default null,
  p_override_conflicts boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  conflicts jsonb;
  created_block_id uuid;
  location_organization_id uuid;
  staff_row public.staff%rowtype;
  timezone_value text;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in before managing staff availability.';
  end if;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id;

  if location_organization_id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage', 'staff.manage']::text[]
  ) then
    raise exception 'Missing staff availability management permission.';
  end if;

  if p_block_type not in ('time_off', 'blocked', 'break', 'cleanup') then
    raise exception 'Invalid time block type.';
  end if;

  timezone_value := nullif(btrim(coalesce(p_timezone_iana, '')), '');

  if timezone_value is null then
    raise exception 'Timezone is required.';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'Time block start must be before end.';
  end if;

  select *
  into staff_row
  from public.staff
  where staff.id = p_staff_id
    and staff.salon_id = p_salon_id
    and staff.organization_id = location_organization_id;

  if staff_row.id is null then
    raise exception 'Staff profile was not found in this salon.';
  end if;

  if staff_row.is_active is not true then
    raise exception 'Inactive staff cannot receive availability blocks.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', bookings.id,
        'booking_line_id', booking_lines.id,
        'customer_name', coalesce(customers.name, 'Customer'),
        'scheduled_start_at', booking_lines.scheduled_start_at,
        'scheduled_end_at', booking_lines.scheduled_end_at,
        'status', bookings.status
      )
      order by booking_lines.scheduled_start_at
    ),
    '[]'::jsonb
  )
  into conflicts
  from public.booking_lines
  join public.bookings
    on bookings.id = booking_lines.booking_id
    and bookings.organization_id = booking_lines.organization_id
    and bookings.salon_id = booking_lines.salon_id
  left join public.customers
    on customers.id = bookings.customer_id
  where booking_lines.organization_id = location_organization_id
    and booking_lines.salon_id = p_salon_id
    and booking_lines.assigned_staff_id = p_staff_id
    and booking_lines.scheduled_start_at < p_ends_at
    and booking_lines.scheduled_end_at > p_starts_at
    and public.booking_status_blocks_slot(bookings.status);

  if jsonb_array_length(conflicts) > 0 and p_override_conflicts is not true then
    return jsonb_build_object(
      'ok', false,
      'code', 'booking_conflict',
      'message', 'This block overlaps existing appointments.',
      'conflicts', conflicts
    );
  end if;

  insert into public.staff_time_blocks (
    organization_id,
    salon_id,
    staff_id,
    block_type,
    starts_at,
    ends_at,
    timezone_iana,
    reason,
    is_active,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    location_organization_id,
    p_salon_id,
    p_staff_id,
    p_block_type,
    p_starts_at,
    p_ends_at,
    timezone_value,
    nullif(btrim(coalesce(p_reason, '')), ''),
    true,
    actor_user_id,
    actor_user_id
  )
  returning id into created_block_id;

  return jsonb_build_object(
    'ok', true,
    'block_id', created_block_id,
    'conflicts', conflicts
  );
end;
$$;

create or replace function public.cancel_staff_time_block(
  p_salon_id uuid,
  p_block_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  affected_count integer;
  location_organization_id uuid;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in before managing staff availability.';
  end if;

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id;

  if location_organization_id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage', 'staff.manage']::text[]
  ) then
    raise exception 'Missing staff availability management permission.';
  end if;

  update public.staff_time_blocks
  set
    is_active = false,
    cancelled_at = coalesce(cancelled_at, now()),
    cancelled_by_user_id = coalesce(cancelled_by_user_id, actor_user_id),
    updated_at = now(),
    updated_by_user_id = actor_user_id
  where staff_time_blocks.id = p_block_id
    and staff_time_blocks.salon_id = p_salon_id
    and staff_time_blocks.organization_id = location_organization_id
    and staff_time_blocks.is_active = true;

  get diagnostics affected_count = row_count;

  if affected_count = 0 then
    raise exception 'Active time block was not found.';
  end if;

  return jsonb_build_object('ok', true, 'block_id', p_block_id);
end;
$$;

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
      and coalesce(blocks.is_active, true) = true
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

do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.get_public_booking_context(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure
  )
  into function_definition;

  if position('coalesce(blocks.is_active, true) = true' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      'and blocks.starts_at < p_range_end',
      'and coalesce(blocks.is_active, true) = true
        and blocks.starts_at < p_range_end'
    );

    execute function_definition;
  end if;
end;
$$;

revoke all on function public.save_staff_service_assignment_batch(uuid, uuid, jsonb) from public;
revoke all on function public.save_service_staff_assignment_batch(uuid, uuid, jsonb) from public;
revoke all on function public.save_staff_weekly_availability(uuid, uuid, jsonb) from public;
revoke all on function public.create_staff_time_block(uuid, uuid, text, timestamptz, timestamptz, text, text, boolean) from public;
revoke all on function public.cancel_staff_time_block(uuid, uuid) from public;

grant execute on function public.save_staff_service_assignment_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_service_staff_assignment_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_staff_weekly_availability(uuid, uuid, jsonb) to authenticated;
grant execute on function public.create_staff_time_block(uuid, uuid, text, timestamptz, timestamptz, text, text, boolean) to authenticated;
grant execute on function public.cancel_staff_time_block(uuid, uuid) to authenticated;
