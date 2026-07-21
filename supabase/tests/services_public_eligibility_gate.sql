begin;

do $$
declare
  actor_auth_user_id uuid;
  fixture_category text := '[E2E Services Gate]';
  fixture_service_add_on uuid;
  fixture_service_offline uuid;
  fixture_service_primary uuid;
  local_fixture_date date := current_date + 90;
  manage_payload jsonb;
  manual_booking_id uuid;
  public_booking_id uuid;
  public_result jsonb;
  public_start_at timestamptz;
  result_payload jsonb;
  target_customer_id uuid;
  target_organization_id uuid;
  target_salon_id uuid;
  target_staff_id uuid;
  timezone_value text;
begin
  select
    organizations.id,
    locations.id,
    owner_user.auth_user_id,
    staff.id,
    coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into
    target_organization_id,
    target_salon_id,
    actor_auth_user_id,
    target_staff_id,
    timezone_value
  from public.organizations
  join public.users owner_user
    on owner_user.id = organizations.owner_user_id
  join public.locations
    on locations.organization_id = organizations.id
    and locations.status = 'active'
  join public.staff
    on staff.organization_id = organizations.id
    and staff.salon_id = locations.id
    and staff.is_active = true
  join public.booking_settings
    on booking_settings.organization_id = organizations.id
    and booking_settings.salon_id = locations.id
  where owner_user.auth_user_id is not null
    and public.salon_profile_public_salon_exists(locations.id)
  order by organizations.created_at, locations.created_at, staff.created_at
  limit 1;

  if target_salon_id is null or actor_auth_user_id is null or target_staff_id is null then
    raise exception 'Public eligibility gate requires one public owner salon with active staff.';
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  update public.booking_settings
  set
    booking_enabled = true,
    online_booking_visible = true,
    guest_booking_enabled = true,
    minimum_lead_time_minutes = 0,
    maximum_advance_window_days = 365,
    same_day_booking_enabled = true
  where salon_id = target_salon_id
    and organization_id = target_organization_id;

  update public.staff
  set
    is_active = true,
    online_booking_enabled = true,
    owner_public_enabled = true,
    public_profile_visible = true,
    staff_public_consent_status = 'granted'
  where id = target_staff_id
    and salon_id = target_salon_id
    and organization_id = target_organization_id;

  public_start_at :=
    (local_fixture_date::text || ' 12:00:00')::timestamp
      at time zone timezone_value;

  update public.staff_availability_rules
  set is_active = false
  where salon_id = target_salon_id
    and organization_id = target_organization_id
    and rule_type = 'break'
    and day_of_week = extract(dow from local_fixture_date)::integer
    and (staff_id is null or staff_id = target_staff_id);

  update public.staff_time_blocks
  set is_active = false
  where salon_id = target_salon_id
    and organization_id = target_organization_id
    and (staff_id is null or staff_id = target_staff_id)
    and starts_at < public_start_at + interval '8 hours'
    and ends_at > public_start_at;

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
    is_active
  )
  values (
    target_organization_id,
    target_salon_id,
    target_staff_id,
    'working',
    extract(dow from local_fixture_date)::integer,
    '09:00',
    '20:00',
    timezone_value,
    local_fixture_date,
    local_fixture_date,
    true
  );

  result_payload := public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'name', '[E2E Services Gate] Public primary',
        'category', fixture_category,
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', true,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', '[]'::jsonb
      ),
      jsonb_build_object(
        'name', '[E2E Services Gate] Public add-on',
        'category', fixture_category,
        'base_price', 15,
        'duration_minutes', 15,
        'is_active', true,
        'online_booking_enabled', true,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', '[]'::jsonb
      ),
      jsonb_build_object(
        'name', '[E2E Services Gate] Offline',
        'category', fixture_category,
        'base_price', 30,
        'duration_minutes', 30,
        'is_active', true,
        'online_booking_enabled', false,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', '[]'::jsonb
      )
    )
  );

  fixture_service_primary := (result_payload -> 'service_ids' ->> 0)::uuid;
  fixture_service_add_on := (result_payload -> 'service_ids' ->> 1)::uuid;
  fixture_service_offline := (result_payload -> 'service_ids' ->> 2)::uuid;

  update public.staff_service_assignments
  set
    custom_duration_minutes = case
      when service_id = fixture_service_primary then 40
      else 20
    end,
    custom_price = case
      when service_id = fixture_service_primary then 48
      else 18
    end
  where salon_id = target_salon_id
    and staff_id = target_staff_id
    and service_id in (fixture_service_primary, fixture_service_add_on);

  perform public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_primary,
        'name', '[E2E Services Gate] Public primary',
        'category', fixture_category,
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', true,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', jsonb_build_array(fixture_service_add_on)
      )
    )
  );

  if exists (
    select 1
    from public.get_public_salon_profile_services(target_salon_id)
    where id = fixture_service_offline
  ) then
    raise exception 'Online-off service remained in public service selection.';
  end if;

  public_result := public.create_public_booking(
    target_salon_id,
    public_start_at,
    public_start_at + interval '65 minutes',
    'E2E',
    'Services Gate',
    '13125550199',
    'e2e-services-gate@example.invalid',
    'Transaction-scoped fixture',
    gen_random_uuid()::text,
    'public_profile',
    null,
    null,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_primary,
        'assigned_staff_id', target_staff_id,
        'line_type', 'service',
        'scheduled_start_at', public_start_at,
        'scheduled_end_at', public_start_at + interval '45 minutes',
        'cleanup_buffer_minutes', 5,
        'display_order', 0
      ),
      jsonb_build_object(
        'service_id', fixture_service_add_on,
        'assigned_staff_id', target_staff_id,
        'line_type', 'add_on',
        'parent_service_id', fixture_service_primary,
        'scheduled_start_at', public_start_at + interval '45 minutes',
        'scheduled_end_at', public_start_at + interval '65 minutes',
        'cleanup_buffer_minutes', 0,
        'display_order', 1
      )
    )
  );

  public_booking_id := (public_result ->> 'booking_id')::uuid;

  if public_booking_id is null then
    raise exception 'Public booking fixture was not created.';
  end if;

  if not exists (
    select 1
    from public.booking_lines
    where booking_id = public_booking_id
      and service_id = fixture_service_primary
      and line_type = 'service'
      and unit_price = 48
      and duration_minutes = 40
      and cleanup_buffer_minutes = 5
  ) then
    raise exception 'Primary public line did not snapshot effective assignment values.';
  end if;

  if not exists (
    select 1
    from public.booking_lines add_on_line
    join public.booking_lines parent_line
      on parent_line.id = add_on_line.parent_booking_line_id
      and parent_line.booking_id = add_on_line.booking_id
    where add_on_line.booking_id = public_booking_id
      and add_on_line.service_id = fixture_service_add_on
      and add_on_line.line_type = 'add_on'
      and add_on_line.unit_price = 18
      and add_on_line.duration_minutes = 20
      and parent_line.service_id = fixture_service_primary
  ) then
    raise exception 'Add-on snapshot or parent booking line relationship is invalid.';
  end if;

  if (
    select sum(unit_price * quantity)
    from public.booking_lines
    where booking_id = public_booking_id
  ) <> 66 then
    raise exception 'Main service and add-on total price is incorrect.';
  end if;

  manage_payload := public.get_public_booking_by_manage_token(
    public_result ->> 'manage_token'
  );

  if not exists (
    select 1
    from jsonb_array_elements(manage_payload -> 'lines') managed_line
    where managed_line ->> 'line_type' = 'add_on'
      and (managed_line ->> 'parent_service_id')::uuid = fixture_service_primary
      and (managed_line ->> 'unit_price')::numeric = 18
  ) then
    raise exception 'Manage-token booking payload lost add-on snapshot details.';
  end if;

  select customer_id
  into target_customer_id
  from public.bookings
  where id = public_booking_id;

  update public.staff_service_assignments
  set
    is_active = false,
    online_bookable = false
  where salon_id = target_salon_id
    and service_id = fixture_service_primary
    and staff_id = target_staff_id;

  manual_booking_id := public.create_canonical_booking(
    p_salon_id => target_salon_id,
    p_customer_id => target_customer_id,
    p_start_at => public_start_at + interval '3 hours',
    p_end_at => public_start_at + interval '3 hours 45 minutes',
    p_status => 'confirmed',
    p_source => 'owner_manual',
    p_confirmation_mode => 'instant_booking',
    p_confirmation_status => 'confirmed',
    p_idempotency_key => gen_random_uuid()::text,
    p_lines => jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_primary,
        'assigned_staff_id', target_staff_id,
        'line_type', 'service',
        'scheduled_start_at', public_start_at + interval '3 hours',
        'scheduled_end_at', public_start_at + interval '3 hours 45 minutes'
      )
    ),
    p_actor_source => 'owner'
  );

  if not exists (
    select 1
    from public.booking_lines
    where booking_id = manual_booking_id
      and service_id = fixture_service_primary
      and assigned_staff_id = target_staff_id
      and unit_price = 45
      and duration_minutes = 45
  ) then
    raise exception 'Owner manual booking was blocked or used online assignment overrides.';
  end if;

  raise notice 'Services public eligibility gate passed with rollback-only fixtures.';
end;
$$;

rollback;
