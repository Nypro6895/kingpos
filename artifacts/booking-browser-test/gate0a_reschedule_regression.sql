do $$
declare
  v_actor_auth_user_id uuid;
  v_actor_user_id uuid;
  v_add_on_line_id uuid;
  v_add_on_service_id uuid;
  v_base_end timestamptz := timestamptz '2026-08-10 16:45:00+00';
  v_base_start timestamptz := timestamptz '2026-08-10 15:00:00+00';
  v_booking_id uuid;
  v_conflict_booking_id uuid;
  v_conflict_failed boolean := false;
  v_conflict_target_end timestamptz := timestamptz '2026-08-12 17:15:00+00';
  v_conflict_target_start timestamptz := timestamptz '2026-08-12 15:30:00+00';
  v_customer_id uuid;
  v_event_count integer;
  v_guest_result jsonb;
  v_guest_target_start timestamptz := timestamptz '2026-08-13 15:00:00+00';
  v_main_line_1_id uuid;
  v_main_line_2_id uuid;
  v_main_service_id uuid;
  v_organization_id uuid := '624cdaca-708c-44e1-b7c4-fff0ced26a63';
  v_overbooking_events integer;
  v_retry_event_count integer;
  v_run_key text := '[E2E] Gate0A ' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_salon_id uuid := 'ece42ee9-16c2-4dea-a1af-ca4789dcf695';
  v_shift_end timestamptz := timestamptz '2026-08-11 17:15:00+00';
  v_shift_start timestamptz := timestamptz '2026-08-11 15:30:00+00';
  v_staff_a_id uuid := '33374325-e96a-4123-9275-465e931620c2';
  v_staff_b_id uuid := '7dcf9750-ed8a-49f8-9203-3ee9f76bf045';
  v_token text;
begin
  select organizations.owner_user_id, users.auth_user_id
  into v_actor_user_id, v_actor_auth_user_id
  from public.organizations
  join public.users
    on users.id = organizations.owner_user_id
  where organizations.id = v_organization_id
    and organizations.name like '[E2E] Booking 20260716002831 Org%';

  if v_actor_user_id is null or v_actor_auth_user_id is null then
    raise exception 'Gate0A fixture owner was not found.';
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
    raise exception 'Gate0A fixture services were not found.';
  end if;

  insert into public.customers (location_id, name, phone, email, notes)
  values (
    v_salon_id,
    v_run_key || ' Customer',
    '+1555010900',
    lower(replace(replace(v_run_key, '[E2E] ', ''), ' ', '-')) || '@example.test',
    'Development-only Gate0A booking regression customer.'
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
    v_staff_a_id,
    v_base_start,
    v_base_end,
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' booking',
    'Gate0A public regression note.',
    'Gate0A internal regression note.',
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
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    10,
    v_staff_a_id,
    timestamptz '2026-08-10 15:00:00+00',
    timestamptz '2026-08-10 15:45:00+00'
  )
  returning id into v_main_line_1_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    parent_booking_line_id,
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
    v_booking_id,
    v_main_line_1_id,
    'add_on',
    v_add_on_service_id,
    'snapshot placeholder',
    0,
    1,
    20,
    v_staff_a_id,
    timestamptz '2026-08-10 15:45:00+00',
    timestamptz '2026-08-10 16:00:00+00'
  )
  returning id into v_add_on_line_id;

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
    v_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    30,
    v_staff_b_id,
    timestamptz '2026-08-10 16:00:00+00',
    timestamptz '2026-08-10 16:45:00+00'
  )
  returning id into v_main_line_2_id;

  create temporary table gate0a_line_baseline on commit drop as
  select
    id,
    parent_booking_line_id,
    assigned_staff_id,
    service_id,
    service_name_snapshot,
    service_category_snapshot,
    unit_price,
    duration_minutes,
    cleanup_buffer_minutes,
    scheduled_start_at - v_base_start as start_offset,
    scheduled_end_at - scheduled_start_at as line_duration
  from public.booking_lines
  where booking_id = v_booking_id;

  if (select count(*) from gate0a_line_baseline) <> 3 then
    raise exception 'Gate0A expected three booking lines.';
  end if;

  if not exists (
    select 1
    from gate0a_line_baseline
    where id = v_add_on_line_id
      and parent_booking_line_id = v_main_line_1_id
  ) then
    raise exception 'Gate0A add-on parent relationship was not captured.';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_auth_user_id::text, true);

  perform public.reschedule_canonical_booking(v_booking_id, v_shift_start, v_shift_end, null);

  if not exists (
    select 1
    from public.bookings
    where id = v_booking_id
      and start_at = v_shift_start
      and end_at = v_shift_end
  ) then
    raise exception 'Gate0A owner reschedule did not update the booking header.';
  end if;

  if exists (
    select 1
    from public.booking_lines line
    join gate0a_line_baseline base
      on base.id = line.id
    where line.scheduled_start_at is distinct from v_shift_start + base.start_offset
      or line.scheduled_end_at is distinct from v_shift_start + base.start_offset + base.line_duration
      or line.parent_booking_line_id is distinct from base.parent_booking_line_id
      or line.assigned_staff_id is distinct from base.assigned_staff_id
      or line.service_id is distinct from base.service_id
      or line.service_name_snapshot is distinct from base.service_name_snapshot
      or line.service_category_snapshot is distinct from base.service_category_snapshot
      or line.unit_price is distinct from base.unit_price
      or line.duration_minutes is distinct from base.duration_minutes
  ) then
    raise exception 'Gate0A owner reschedule changed line offsets, relationships, assignments, or snapshots.';
  end if;

  select count(*)
  into v_event_count
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'rescheduled';

  if v_event_count <> 1 then
    raise exception 'Gate0A expected one rescheduled event after first owner reschedule, got %.', v_event_count;
  end if;

  perform public.reschedule_canonical_booking(v_booking_id, v_shift_start, v_shift_end, null);

  select count(*)
  into v_retry_event_count
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'rescheduled';

  if v_retry_event_count <> v_event_count then
    raise exception 'Gate0A retry created a duplicate rescheduled event.';
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
    v_staff_a_id,
    timestamptz '2026-08-12 15:45:00+00',
    timestamptz '2026-08-12 16:30:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' conflict',
    'Gate0A conflict booking.',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_conflict_booking_id;

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
    v_conflict_booking_id,
    'service',
    v_main_service_id,
    'snapshot placeholder',
    0,
    1,
    10,
    v_staff_a_id,
    timestamptz '2026-08-12 15:45:00+00',
    timestamptz '2026-08-12 16:30:00+00'
  );

  create temporary table gate0a_pre_conflict_attempt on commit drop as
  select id, start_at, end_at
  from public.bookings
  where id = v_booking_id;

  create temporary table gate0a_lines_pre_conflict_attempt on commit drop as
  select id, scheduled_start_at, scheduled_end_at
  from public.booking_lines
  where booking_id = v_booking_id;

  begin
    perform public.reschedule_canonical_booking(
      v_booking_id,
      v_conflict_target_start,
      v_conflict_target_end,
      null
    );
  exception
    when others then
      v_conflict_failed := true;
  end;

  if not v_conflict_failed then
    raise exception 'Gate0A expected conflicting owner reschedule to fail.';
  end if;

  if exists (
    select 1
    from public.bookings booking
    join gate0a_pre_conflict_attempt before_booking
      on before_booking.id = booking.id
    where booking.start_at is distinct from before_booking.start_at
      or booking.end_at is distinct from before_booking.end_at
  ) or exists (
    select 1
    from public.booking_lines line
    join gate0a_lines_pre_conflict_attempt before_line
      on before_line.id = line.id
    where line.scheduled_start_at is distinct from before_line.scheduled_start_at
      or line.scheduled_end_at is distinct from before_line.scheduled_end_at
  ) then
    raise exception 'Gate0A conflict failure left a partial booking or line update.';
  end if;

  select count(*)
  into v_retry_event_count
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'rescheduled';

  if v_retry_event_count <> v_event_count then
    raise exception 'Gate0A conflict failure created a rescheduled event.';
  end if;

  perform public.reschedule_canonical_booking(
    v_booking_id,
    v_conflict_target_start,
    v_conflict_target_end,
    'Gate0A verified owner override'
  );

  if exists (
    select 1
    from public.booking_lines line
    join gate0a_line_baseline base
      on base.id = line.id
    where line.scheduled_start_at is distinct from v_conflict_target_start + base.start_offset
      or line.scheduled_end_at is distinct from v_conflict_target_start + base.start_offset + base.line_duration
      or line.parent_booking_line_id is distinct from base.parent_booking_line_id
      or line.assigned_staff_id is distinct from base.assigned_staff_id
  ) then
    raise exception 'Gate0A override reschedule did not preserve line invariants.';
  end if;

  select count(*)
  into v_overbooking_events
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'overbooking_override'
    and metadata ->> 'reason' = 'Gate0A verified owner override';

  if v_overbooking_events < 3 then
    raise exception 'Gate0A expected line-level overbooking audit events, got %.', v_overbooking_events;
  end if;

  v_token := 'gate0a-' || replace(v_booking_id::text, '-', '');

  update public.bookings
  set
    customer_cancellation_token_hash = public.public_booking_token_hash(v_token),
    updated_by_user_id = v_actor_user_id
  where id = v_booking_id;

  select count(*)
  into v_event_count
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'rescheduled';

  v_guest_result := public.reschedule_public_booking_by_manage_token(
    v_token,
    v_guest_target_start
  );

  if coalesce(v_guest_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Gate0A guest manage reschedule failed: %.', v_guest_result;
  end if;

  if exists (
    select 1
    from public.booking_lines line
    join gate0a_line_baseline base
      on base.id = line.id
    where line.scheduled_start_at is distinct from v_guest_target_start + base.start_offset
      or line.scheduled_end_at is distinct from v_guest_target_start + base.start_offset + base.line_duration
      or line.parent_booking_line_id is distinct from base.parent_booking_line_id
      or line.assigned_staff_id is distinct from base.assigned_staff_id
      or line.service_id is distinct from base.service_id
      or line.service_name_snapshot is distinct from base.service_name_snapshot
      or line.unit_price is distinct from base.unit_price
      or line.duration_minutes is distinct from base.duration_minutes
  ) then
    raise exception 'Gate0A guest manage reschedule changed line offsets, relationships, assignments, or snapshots.';
  end if;

  v_guest_result := public.reschedule_public_booking_by_manage_token(
    v_token,
    v_guest_target_start
  );

  if coalesce(v_guest_result ->> 'ok', 'false') <> 'true' then
    raise exception 'Gate0A guest manage retry failed: %.', v_guest_result;
  end if;

  select count(*)
  into v_retry_event_count
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'rescheduled';

  if v_retry_event_count <> v_event_count + 1 then
    raise exception 'Gate0A guest retry created duplicate reschedule events.';
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = 'Gate0A regression cleanup soft-cancel',
    cancelled_at = coalesce(cancelled_at, now()),
    cancelled_by_user_id = v_actor_user_id,
    updated_by_user_id = v_actor_user_id
  where id in (v_booking_id, v_conflict_booking_id);

  if exists (
    select 1
    from public.bookings
    where id in (v_booking_id, v_conflict_booking_id)
      and public.booking_status_blocks_slot(status)
  ) then
    raise exception 'Gate0A cleanup did not soft-cancel test bookings.';
  end if;
end $$;

select
  'gate0a_reschedule_regression_passed' as result,
  now() as verified_at;
