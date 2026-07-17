do $$
declare
  v_actor_auth_user_id uuid;
  v_actor_user_id uuid;
  v_block_id uuid;
  v_booking_id uuid;
  v_conflict jsonb;
  v_customer_id uuid;
  v_duplicate_failed boolean := false;
  v_inactive_service_failed boolean := false;
  v_inactive_staff_failed boolean := false;
  v_invalid_break_failed boolean := false;
  v_invalid_time_failed boolean := false;
  v_overlap_failed boolean := false;
  v_organization_id uuid;
  v_result jsonb;
  v_run_key text := '[E2E] Phase45 SQL ' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_salon_id uuid;
  v_service_a_id uuid;
  v_service_b_id uuid;
  v_service_inactive_id uuid;
  v_staff_id uuid;
  v_staff_inactive_id uuid;
begin
  select booking_settings.organization_id, booking_settings.salon_id
  into v_organization_id, v_salon_id
  from public.booking_settings
  order by booking_settings.created_at
  limit 1;

  if v_organization_id is null or v_salon_id is null then
    raise exception 'Phase45 could not find a development booking salon.';
  end if;

  select organizations.owner_user_id, users.auth_user_id
  into v_actor_user_id, v_actor_auth_user_id
  from public.organizations
  join public.users
    on users.id = organizations.owner_user_id
  where organizations.id = v_organization_id;

  if v_actor_user_id is null or v_actor_auth_user_id is null then
    raise exception 'Phase45 owner user was not found.';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_auth_user_id::text, true);

  if not public.user_has_organization_permission(
    v_organization_id,
    array['booking.manage', 'staff.manage', 'services.manage']::text[]
  ) then
    raise exception 'Phase45 owner is missing booking setup permissions.';
  end if;

  insert into public.staff (
    organization_id,
    salon_id,
    display_name,
    job_title,
    public_profile_visible,
    owner_public_enabled,
    staff_public_consent_status,
    online_booking_enabled,
    is_active
  )
  values (
    v_organization_id,
    v_salon_id,
    v_run_key || ' Staff',
    'Phase45 Test',
    true,
    true,
    'granted',
    true,
    true
  )
  returning id into v_staff_id;

  insert into public.staff (
    organization_id,
    salon_id,
    display_name,
    job_title,
    is_active
  )
  values (
    v_organization_id,
    v_salon_id,
    v_run_key || ' Inactive Staff',
    'Phase45 Test',
    false
  )
  returning id into v_staff_inactive_id;

  insert into public.services (
    organization_id,
    salon_id,
    name,
    category,
    base_price,
    duration_minutes,
    is_active
  )
  values (v_organization_id, v_salon_id, v_run_key || ' Gel', 'Phase45', 45, 45, true)
  returning id into v_service_a_id;

  insert into public.services (
    organization_id,
    salon_id,
    name,
    category,
    base_price,
    duration_minutes,
    is_active
  )
  values (v_organization_id, v_salon_id, v_run_key || ' Pedi', 'Phase45', 55, 60, true)
  returning id into v_service_b_id;

  insert into public.services (
    organization_id,
    salon_id,
    name,
    category,
    base_price,
    duration_minutes,
    is_active
  )
  values (v_organization_id, v_salon_id, v_run_key || ' Inactive', 'Phase45', 10, 15, false)
  returning id into v_service_inactive_id;

  v_result := public.save_staff_service_assignment_batch(
    v_salon_id,
    v_staff_id,
    jsonb_build_array(
      jsonb_build_object('service_id', v_service_a_id, 'assigned', true, 'online_bookable', true),
      jsonb_build_object('service_id', v_service_b_id, 'assigned', true, 'online_bookable', false)
    )
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'Phase45 staff-centric assignment batch failed: %.', v_result;
  end if;

  if not exists (
    select 1
    from public.staff_service_assignments
    where salon_id = v_salon_id
      and staff_id = v_staff_id
      and service_id = v_service_a_id
      and is_active = true
      and online_bookable = true
      and updated_by_user_id = v_actor_user_id
  ) then
    raise exception 'Phase45 staff assignment was not persisted with audit actor.';
  end if;

  begin
    perform public.save_staff_service_assignment_batch(
      v_salon_id,
      v_staff_id,
      jsonb_build_array(
        jsonb_build_object('service_id', v_service_a_id, 'assigned', true, 'online_bookable', true),
        jsonb_build_object('service_id', v_service_a_id, 'assigned', true, 'online_bookable', true)
      )
    );
  exception
    when others then
      v_duplicate_failed := true;
  end;

  if not v_duplicate_failed then
    raise exception 'Phase45 duplicate assignment payload was not rejected.';
  end if;

  begin
    perform public.save_staff_service_assignment_batch(
      v_salon_id,
      v_staff_id,
      jsonb_build_array(
        jsonb_build_object('service_id', v_service_inactive_id, 'assigned', true, 'online_bookable', true)
      )
    );
  exception
    when others then
      v_inactive_service_failed := true;
  end;

  if not v_inactive_service_failed then
    raise exception 'Phase45 inactive service assignment was not rejected.';
  end if;

  begin
    perform public.save_staff_service_assignment_batch(
      v_salon_id,
      v_staff_inactive_id,
      jsonb_build_array(
        jsonb_build_object('service_id', v_service_a_id, 'assigned', true, 'online_bookable', true)
      )
    );
  exception
    when others then
      v_inactive_staff_failed := true;
  end;

  if not v_inactive_staff_failed then
    raise exception 'Phase45 inactive staff assignment was not rejected.';
  end if;

  v_result := public.save_service_staff_assignment_batch(
    v_salon_id,
    v_service_b_id,
    jsonb_build_array(
      jsonb_build_object('staff_id', v_staff_id, 'assigned', true, 'online_bookable', true)
    )
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'Phase45 service-centric assignment batch failed: %.', v_result;
  end if;

  if not exists (
    select 1
    from public.staff_service_assignments
    where salon_id = v_salon_id
      and staff_id = v_staff_id
      and service_id = v_service_b_id
      and is_active = true
      and online_bookable = true
  ) then
    raise exception 'Phase45 service-centric assignment did not update canonical row.';
  end if;

  v_result := public.save_staff_weekly_availability(
    v_salon_id,
    v_staff_id,
    jsonb_build_array(
      jsonb_build_object('rule_type', 'working', 'day_of_week', 1, 'starts_at_local', '09:00', 'ends_at_local', '17:00', 'timezone_iana', 'America/Chicago'),
      jsonb_build_object('rule_type', 'break', 'day_of_week', 1, 'starts_at_local', '12:00', 'ends_at_local', '13:00', 'timezone_iana', 'America/Chicago')
    )
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'Phase45 weekly availability save failed: %.', v_result;
  end if;

  begin
    perform public.save_staff_weekly_availability(
      v_salon_id,
      v_staff_id,
      jsonb_build_array(
        jsonb_build_object('rule_type', 'working', 'day_of_week', 2, 'starts_at_local', '09:00', 'ends_at_local', '12:00', 'timezone_iana', 'America/Chicago'),
        jsonb_build_object('rule_type', 'working', 'day_of_week', 2, 'starts_at_local', '11:00', 'ends_at_local', '14:00', 'timezone_iana', 'America/Chicago')
      )
    );
  exception
    when others then
      v_overlap_failed := true;
  end;

  if not v_overlap_failed then
    raise exception 'Phase45 overlapping weekly intervals were not rejected.';
  end if;

  begin
    perform public.save_staff_weekly_availability(
      v_salon_id,
      v_staff_id,
      jsonb_build_array(
        jsonb_build_object('rule_type', 'working', 'day_of_week', 2, 'starts_at_local', '12:00', 'ends_at_local', '10:00', 'timezone_iana', 'America/Chicago')
      )
    );
  exception
    when others then
      v_invalid_time_failed := true;
  end;

  if not v_invalid_time_failed then
    raise exception 'Phase45 invalid weekly time range was not rejected.';
  end if;

  begin
    perform public.save_staff_weekly_availability(
      v_salon_id,
      v_staff_id,
      jsonb_build_array(
        jsonb_build_object('rule_type', 'working', 'day_of_week', 2, 'starts_at_local', '09:00', 'ends_at_local', '12:00', 'timezone_iana', 'America/Chicago'),
        jsonb_build_object('rule_type', 'break', 'day_of_week', 2, 'starts_at_local', '13:00', 'ends_at_local', '14:00', 'timezone_iana', 'America/Chicago')
      )
    );
  exception
    when others then
      v_invalid_break_failed := true;
  end;

  if not v_invalid_break_failed then
    raise exception 'Phase45 break outside working hours was not rejected.';
  end if;

  perform public.save_staff_weekly_availability(
    v_salon_id,
    v_staff_id,
    jsonb_build_array(
      jsonb_build_object('rule_type', 'working', 'day_of_week', 1, 'starts_at_local', '09:00', 'ends_at_local', '17:00', 'timezone_iana', 'America/Chicago'),
      jsonb_build_object('rule_type', 'break', 'day_of_week', 1, 'starts_at_local', '12:00', 'ends_at_local', '13:00', 'timezone_iana', 'America/Chicago')
    )
  );

  if not public.public_staff_line_is_available(
    v_salon_id,
    v_organization_id,
    v_staff_id,
    timestamptz '2026-09-14 15:00:00+00',
    timestamptz '2026-09-14 15:45:00+00',
    'America/Chicago',
    null
  ) then
    raise exception 'Phase45 saved working hours did not generate an available slot.';
  end if;

  if public.public_staff_line_is_available(
    v_salon_id,
    v_organization_id,
    v_staff_id,
    timestamptz '2026-09-14 17:15:00+00',
    timestamptz '2026-09-14 17:45:00+00',
    'America/Chicago',
    null
  ) then
    raise exception 'Phase45 recurring break did not remove a slot.';
  end if;

  v_result := public.create_staff_time_block(
    v_salon_id,
    v_staff_id,
    'blocked',
    timestamptz '2026-09-14 20:00:00+00',
    timestamptz '2026-09-14 21:00:00+00',
    'America/Chicago',
    v_run_key || ' block',
    false
  );

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'Phase45 create time block failed: %.', v_result;
  end if;

  v_block_id := (v_result ->> 'block_id')::uuid;

  if public.public_staff_line_is_available(
    v_salon_id,
    v_organization_id,
    v_staff_id,
    timestamptz '2026-09-14 20:00:00+00',
    timestamptz '2026-09-14 20:45:00+00',
    'America/Chicago',
    null
  ) then
    raise exception 'Phase45 one-time time block did not remove a slot.';
  end if;

  perform public.cancel_staff_time_block(v_salon_id, v_block_id);

  if not public.public_staff_line_is_available(
    v_salon_id,
    v_organization_id,
    v_staff_id,
    timestamptz '2026-09-14 20:00:00+00',
    timestamptz '2026-09-14 20:45:00+00',
    'America/Chicago',
    null
  ) then
    raise exception 'Phase45 cancelled time block still blocked a slot.';
  end if;

  insert into public.customers (
    location_id,
    name,
    phone,
    email,
    source,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_salon_id,
    v_run_key || ' Customer',
    '+1555010450',
    lower(replace(replace(v_run_key, '[E2E] ', ''), ' ', '-')) || '@example.test',
    'owner_booking',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_customer_id;

  insert into public.bookings (
    organization_id,
    salon_id,
    customer_id,
    staff_id,
    start_at,
    end_at,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    idempotency_key,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    v_staff_id,
    timestamptz '2026-09-14 21:00:00+00',
    timestamptz '2026-09-14 21:30:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' conflict booking',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_booking_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_id,
    service_name_snapshot,
    unit_price,
    quantity,
    duration_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    v_organization_id,
    v_salon_id,
    v_booking_id,
    'service',
    v_service_a_id,
    v_run_key || ' Conflict Service',
    45,
    1,
    30,
    1,
    v_staff_id,
    timestamptz '2026-09-14 21:00:00+00',
    timestamptz '2026-09-14 21:30:00+00'
  );

  v_conflict := public.create_staff_time_block(
    v_salon_id,
    v_staff_id,
    'time_off',
    timestamptz '2026-09-14 21:00:00+00',
    timestamptz '2026-09-14 21:30:00+00',
    'America/Chicago',
    v_run_key || ' conflict',
    false
  );

  if coalesce((v_conflict ->> 'ok')::boolean, true) is not false
    or coalesce(jsonb_array_length(v_conflict -> 'conflicts'), 0) = 0
  then
    raise exception 'Phase45 time block conflict did not return affected appointment: %.', v_conflict;
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = 'Phase45 SQL cleanup',
    cancelled_at = now(),
    cancelled_by_user_id = v_actor_user_id,
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where id = v_booking_id;

  update public.staff_time_blocks
  set
    is_active = false,
    cancelled_at = coalesce(cancelled_at, now()),
    cancelled_by_user_id = coalesce(cancelled_by_user_id, v_actor_user_id),
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where salon_id = v_salon_id
    and reason like v_run_key || '%';

  update public.staff_availability_rules
  set
    is_active = false,
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where salon_id = v_salon_id
    and staff_id in (v_staff_id, v_staff_inactive_id);

  update public.staff_service_assignments
  set
    is_active = false,
    online_bookable = false,
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where salon_id = v_salon_id
    and staff_id in (v_staff_id, v_staff_inactive_id);

  update public.staff
  set is_active = false, updated_at = now()
  where id in (v_staff_id, v_staff_inactive_id);

  update public.services
  set is_active = false, updated_at = now()
  where id in (v_service_a_id, v_service_b_id, v_service_inactive_id);
end $$;

select
  'phase45_booking_setup_regression_passed' as result,
  now() as verified_at;
