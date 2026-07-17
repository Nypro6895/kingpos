do $$
declare
  v_actor_auth_user_id uuid := '65fba7bb-0c6f-46b8-a129-4d2658e55f3d';
  v_actor_user_id uuid := 'eedd29d9-87c8-426d-96d2-97328d7898ec';
  v_add_on_service_id uuid;
  v_assignment_booking_id uuid;
  v_assignment_line_id uuid;
  v_customer_id uuid;
  v_forbidden_booking_id uuid;
  v_forbidden_line_id uuid;
  v_inactive_booking_id uuid;
  v_inactive_line_id uuid;
  v_lifecycle_booking_id uuid;
  v_line_1_id uuid;
  v_line_2_id uuid;
  v_linked_staff_id uuid;
  v_main_service_id uuid;
  v_notification_count integer;
  v_organization_id uuid := '624cdaca-708c-44e1-b7c4-fff0ced26a63';
  v_other_staff_id uuid := '7dcf9750-ed8a-49f8-9203-3ee9f76bf045';
  v_result jsonb;
  v_run_key text := '[E2E] Phase4 SQL ' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_salon_id uuid := 'ece42ee9-16c2-4dea-a1af-ca4789dcf695';
begin
  if not exists (
    select 1
    from public.users
    where id = v_actor_user_id
      and auth_user_id = v_actor_auth_user_id
      and email like 'kingpos.e2e+booking-phase4-%@gmail.com'
  ) then
    raise exception 'Phase4 E2E auth-backed user was not found.';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_auth_user_id::text, true);

  if not public.user_has_organization_permission(
    v_organization_id,
    array['booking.manage']::text[]
  ) then
    raise exception 'Phase4 E2E user is missing booking.manage.';
  end if;

  select id
  into v_main_service_id
  from public.services
  where salon_id = v_salon_id
    and name like '[E2E] Booking 20260716002831 Gel Manicure%'
    and is_active = true
  limit 1;

  select id
  into v_add_on_service_id
  from public.services
  where salon_id = v_salon_id
    and name like '[E2E] Booking 20260716002831 Nail Art Add-on%'
    and is_active = true
  limit 1;

  if v_main_service_id is null or v_add_on_service_id is null then
    raise exception 'Phase4 fixture services were not found.';
  end if;

  select id
  into v_linked_staff_id
  from public.staff
  where organization_id = v_organization_id
    and salon_id = v_salon_id
    and account_user_id = v_actor_user_id
  order by created_at
  limit 1;

  if v_linked_staff_id is null then
    insert into public.staff (
      organization_id,
      salon_id,
      account_user_id,
      display_name,
      first_name,
      last_name,
      email,
      job_title,
      is_active,
      online_booking_enabled,
      public_profile_visible,
      owner_public_enabled,
      staff_public_consent_status,
      profile_display_order
    )
    values (
      v_organization_id,
      v_salon_id,
      v_actor_user_id,
      '[E2E] Phase4 Linked Staff',
      '[E2E]',
      'Phase4 Linked Staff',
      'kingpos.e2e+booking-phase4-20260716153944@gmail.com',
      'Development test professional',
      true,
      true,
      true,
      true,
      'granted',
      40
    )
    returning id into v_linked_staff_id;
  else
    update public.staff
    set
      display_name = '[E2E] Phase4 Linked Staff',
      job_title = 'Development test professional',
      is_active = true,
      online_booking_enabled = true,
      public_profile_visible = true,
      owner_public_enabled = true,
      staff_public_consent_status = 'granted',
      updated_at = now()
    where id = v_linked_staff_id;
  end if;

  insert into public.staff_service_assignments (
    organization_id,
    salon_id,
    staff_id,
    service_id,
    is_active,
    online_bookable
  )
  values
    (v_organization_id, v_salon_id, v_linked_staff_id, v_main_service_id, true, true),
    (v_organization_id, v_salon_id, v_linked_staff_id, v_add_on_service_id, true, true)
  on conflict (salon_id, staff_id, service_id) do update
  set
    is_active = true,
    online_bookable = true,
    updated_at = now();

  insert into public.staff_availability_rules (
    organization_id,
    salon_id,
    staff_id,
    rule_type,
    day_of_week,
    starts_at_local,
    ends_at_local,
    timezone_iana,
    is_active
  )
  select
    v_organization_id,
    v_salon_id,
    v_linked_staff_id,
    'working',
    day_index,
    time '09:00',
    time '17:00',
    'America/Chicago',
    true
  from generate_series(0, 6) as days(day_index)
  where not exists (
    select 1
    from public.staff_availability_rules existing
    where existing.salon_id = v_salon_id
      and existing.staff_id = v_linked_staff_id
      and existing.rule_type = 'working'
      and existing.day_of_week = days.day_index
      and existing.starts_at_local = time '09:00'
      and existing.ends_at_local = time '17:00'
      and existing.is_active = true
  );

  insert into public.customers (location_id, name, phone, email, notes)
  values (
    v_salon_id,
    v_run_key || ' Customer',
    '+1555010400',
    lower(replace(replace(v_run_key, '[E2E] ', ''), ' ', '-')) || '@gmail.com',
    'Development-only Phase4 staff lifecycle regression customer.'
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
    public_notes,
    internal_notes,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    v_linked_staff_id,
    timestamptz '2026-08-14 15:00:00+00',
    timestamptz '2026-08-14 16:30:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' lifecycle',
    'Customer-safe public note for Phase4.',
    'Internal note must stay out of staff projection.',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_lifecycle_booking_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_id,
    service_name_snapshot,
    unit_price,
    duration_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    v_organization_id,
    v_salon_id,
    v_lifecycle_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    10,
    v_linked_staff_id,
    timestamptz '2026-08-14 15:00:00+00',
    timestamptz '2026-08-14 15:45:00+00'
  )
  returning id into v_line_1_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_id,
    service_name_snapshot,
    unit_price,
    duration_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    v_organization_id,
    v_salon_id,
    v_lifecycle_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    20,
    v_linked_staff_id,
    timestamptz '2026-08-14 15:45:00+00',
    timestamptz '2026-08-14 16:30:00+00'
  )
  returning id into v_line_2_id;

  v_result := public.start_assigned_booking_line(
    v_line_1_id,
    'Phase4 start note'
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Phase4 start assigned line failed: %.', v_result;
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = v_lifecycle_booking_id
      and status = 'in_service'
  ) then
    raise exception 'Phase4 starting first line did not move booking to in_service.';
  end if;

  if not exists (
    select 1
    from public.booking_lines
    where id = v_line_1_id
      and line_status = 'in_service'
      and performed_by_staff_id = v_linked_staff_id
      and service_note = 'Phase4 start note'
  ) then
    raise exception 'Phase4 line start did not store execution state.';
  end if;

  v_result := public.start_assigned_booking_line(
    v_line_1_id,
    'Phase4 start note'
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Phase4 repeated start failed: %.', v_result;
  end if;

  if (
    select count(*)
    from public.booking_status_events
    where booking_id = v_lifecycle_booking_id
      and event_type = 'line_started'
      and metadata ->> 'booking_line_id' = v_line_1_id::text
  ) <> 1 then
    raise exception 'Phase4 repeated start created duplicate line_started events.';
  end if;

  v_result := public.complete_assigned_booking_line(
    v_line_1_id,
    'Phase4 line 1 complete'
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Phase4 complete first line failed: %.', v_result;
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = v_lifecycle_booking_id
      and status = 'in_service'
  ) then
    raise exception 'Phase4 first completed line completed the booking too early.';
  end if;

  if not exists (
    select 1
    from public.booking_lines
    where id = v_line_1_id
      and line_status = 'completed'
      and performed_by_staff_id = v_linked_staff_id
      and completed_at is not null
  ) then
    raise exception 'Phase4 first line completion did not store execution state.';
  end if;

  v_result := public.complete_assigned_booking_line(
    v_line_1_id,
    'Phase4 line 1 complete'
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Phase4 repeated completion failed: %.', v_result;
  end if;

  if (
    select count(*)
    from public.booking_status_events
    where booking_id = v_lifecycle_booking_id
      and event_type = 'line_completed'
      and metadata ->> 'booking_line_id' = v_line_1_id::text
  ) <> 1 then
    raise exception 'Phase4 repeated completion created duplicate line_completed events.';
  end if;

  v_result := public.complete_assigned_booking_line(
    v_line_2_id,
    'Phase4 final line complete'
  );

  if coalesce(v_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Phase4 final line completion failed: %.', v_result;
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = v_lifecycle_booking_id
      and status = 'completed'
  ) then
    raise exception 'Phase4 final line did not complete booking.';
  end if;

  if (
    select count(*)
    from public.booking_status_events
    where booking_id = v_lifecycle_booking_id
      and event_type = 'completed'
  ) <> 1 then
    raise exception 'Phase4 booking completed event was not exactly once.';
  end if;

  select count(*)
  into v_notification_count
  from public.app_notifications
  where recipient_user_id = v_actor_user_id
    and booking_id = v_lifecycle_booking_id
    and notification_type in ('staff_line_started', 'staff_line_completed');

  if v_notification_count < 3 then
    raise exception 'Phase4 expected staff lifecycle notifications, got %.', v_notification_count;
  end if;

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
    internal_notes,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    v_other_staff_id,
    timestamptz '2026-08-15 15:00:00+00',
    timestamptz '2026-08-15 15:45:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' other staff',
    'Phase4 other-staff denial booking.',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_forbidden_booking_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_id,
    service_name_snapshot,
    unit_price,
    duration_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    v_organization_id,
    v_salon_id,
    v_forbidden_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    10,
    v_other_staff_id,
    timestamptz '2026-08-15 15:00:00+00',
    timestamptz '2026-08-15 15:45:00+00'
  )
  returning id into v_forbidden_line_id;

  v_result := public.start_assigned_booking_line(v_forbidden_line_id, null);

  if coalesce(v_result ->> 'code', '') <> 'forbidden' then
    raise exception 'Phase4 other-staff line mutation was not denied: %.', v_result;
  end if;

  if exists (
    select 1
    from public.booking_lines
    where id = v_forbidden_line_id
      and line_status <> 'scheduled'
  ) then
    raise exception 'Phase4 denied other-staff mutation changed line status.';
  end if;

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
    internal_notes,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    v_linked_staff_id,
    timestamptz '2026-08-16 15:00:00+00',
    timestamptz '2026-08-16 15:45:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' inactive',
    'Phase4 inactive staff denial booking.',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_inactive_booking_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_id,
    service_name_snapshot,
    unit_price,
    duration_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    v_organization_id,
    v_salon_id,
    v_inactive_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    10,
    v_linked_staff_id,
    timestamptz '2026-08-16 15:00:00+00',
    timestamptz '2026-08-16 15:45:00+00'
  )
  returning id into v_inactive_line_id;

  update public.staff
  set is_active = false, updated_at = now()
  where id = v_linked_staff_id;

  v_result := public.start_assigned_booking_line(v_inactive_line_id, null);

  if coalesce(v_result ->> 'code', '') <> 'forbidden' then
    raise exception 'Phase4 inactive staff mutation was not denied: %.', v_result;
  end if;

  update public.staff
  set is_active = true, updated_at = now()
  where id = v_linked_staff_id;

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
    internal_notes,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    null,
    timestamptz '2026-08-17 15:00:00+00',
    timestamptz '2026-08-17 15:45:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' notification',
    'Phase4 assignment/reschedule/cancel notification booking.',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_assignment_booking_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_id,
    service_name_snapshot,
    unit_price,
    duration_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    v_organization_id,
    v_salon_id,
    v_assignment_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    10,
    v_linked_staff_id,
    timestamptz '2026-08-17 15:00:00+00',
    timestamptz '2026-08-17 15:45:00+00'
  )
  returning id into v_assignment_line_id;

  update public.bookings
  set staff_id = v_linked_staff_id,
      updated_by_user_id = v_actor_user_id,
      updated_at = now()
  where id = v_assignment_booking_id;

  if not exists (
    select 1
    from public.app_notifications
    where recipient_user_id = v_actor_user_id
      and booking_id = v_assignment_booking_id
      and booking_line_id is null
      and notification_type = 'staff_booking_assigned'
      and href = '/staff/appointments?bookingId=' || v_assignment_booking_id::text
  ) then
    raise exception 'Phase4 assignment notification/deep link was not created.';
  end if;

  perform public.reschedule_canonical_booking(
    v_assignment_booking_id,
    timestamptz '2026-08-18 15:30:00+00',
    timestamptz '2026-08-18 16:15:00+00',
    null
  );

  perform public.reschedule_canonical_booking(
    v_assignment_booking_id,
    timestamptz '2026-08-18 15:30:00+00',
    timestamptz '2026-08-18 16:15:00+00',
    null
  );

  if (
    select count(*)
    from public.app_notifications
    where recipient_user_id = v_actor_user_id
      and booking_id = v_assignment_booking_id
      and notification_type = 'staff_booking_rescheduled'
  ) <> 1 then
    raise exception 'Phase4 reschedule retry created duplicate staff notifications.';
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = 'Phase4 notification cleanup soft-cancel',
    cancelled_at = now(),
    cancelled_by_user_id = v_actor_user_id,
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where id = v_assignment_booking_id;

  if not exists (
    select 1
    from public.app_notifications
    where recipient_user_id = v_actor_user_id
      and booking_id = v_assignment_booking_id
      and notification_type = 'staff_booking_cancelled'
      and href = '/staff/appointments?bookingId=' || v_assignment_booking_id::text
  ) then
    raise exception 'Phase4 cancel notification/deep link was not created.';
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = 'Phase4 regression cleanup soft-cancel',
    cancelled_at = coalesce(cancelled_at, now()),
    cancelled_by_user_id = v_actor_user_id,
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where id in (
    v_lifecycle_booking_id,
    v_forbidden_booking_id,
    v_inactive_booking_id
  );

  if exists (
    select 1
    from public.bookings
    where id in (
      v_lifecycle_booking_id,
      v_forbidden_booking_id,
      v_inactive_booking_id,
      v_assignment_booking_id
    )
      and public.booking_status_blocks_slot(status)
  ) then
    raise exception 'Phase4 regression cleanup did not soft-cancel test bookings.';
  end if;
end $$;

select
  'phase4_staff_lifecycle_notifications_passed' as result,
  'eedd29d9-87c8-426d-96d2-97328d7898ec'::uuid as test_user_id,
  (
    select id
    from public.staff
    where account_user_id = 'eedd29d9-87c8-426d-96d2-97328d7898ec'
      and salon_id = 'ece42ee9-16c2-4dea-a1af-ca4789dcf695'
    order by created_at
    limit 1
  ) as linked_staff_id,
  now() as verified_at;
