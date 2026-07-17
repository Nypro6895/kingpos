do $$
declare
  v_actor_auth_user_id uuid;
  v_actor_user_id uuid;
  v_add_on_line_id uuid;
  v_add_on_service_id uuid;
  v_audit_count integer;
  v_booking_id uuid;
  v_cancelled_booking_id uuid;
  v_cancelled_error boolean := false;
  v_customer_id uuid;
  v_event_count integer;
  v_line_count integer;
  v_main_line_id uuid;
  v_main_service_id uuid;
  v_main_snapshot_name text;
  v_main_snapshot_price numeric;
  v_metric record;
  v_organization_id uuid := '624cdaca-708c-44e1-b7c4-fff0ced26a63';
  v_pending_booking_id uuid;
  v_pending_error boolean := false;
  v_run_key text := '[E2E] Phase5 SQL ' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
  v_salon_id uuid := 'ece42ee9-16c2-4dea-a1af-ca4789dcf695';
  v_staff_id uuid := 'ff0934c7-b712-458c-b51b-e52221ad0e80';
  v_ticket_id uuid;
  v_ticket_retry_id uuid;
  v_add_on_snapshot_name text;
  v_add_on_snapshot_price numeric;
begin
  select organizations.owner_user_id, users.auth_user_id
  into v_actor_user_id, v_actor_auth_user_id
  from public.organizations
  join public.users
    on users.id = organizations.owner_user_id
  where organizations.id = v_organization_id;

  if v_actor_user_id is null or v_actor_auth_user_id is null then
    raise exception 'Phase5 owner user was not found.';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor_auth_user_id::text, true);

  if not public.user_has_organization_permission(
    v_organization_id,
    array['booking.manage', 'tickets.manage', 'customers.view']::text[]
  ) then
    raise exception 'Phase5 owner is missing required booking/ticket/customer permissions.';
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
    raise exception 'Phase5 fixture services were not found.';
  end if;

  insert into public.customers (
    location_id,
    name,
    phone,
    email,
    notes,
    staff_notes,
    internal_notes,
    source,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_salon_id,
    v_run_key || ' Customer',
    '+1555010500',
    lower(replace(replace(v_run_key, '[E2E] ', ''), ' ', '-')) || '@example.test',
    'Phase5 public customer note.',
    'Phase5 staff-safe note.',
    'Phase5 owner-only note.',
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
    public_notes,
    internal_notes,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    v_staff_id,
    timestamptz '2026-08-20 15:00:00+00',
    timestamptz '2026-08-20 16:00:00+00',
    'confirmed',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' confirmed',
    'Phase5 ticket conversion public note.',
    'Phase5 ticket conversion internal note.',
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
    service_category_snapshot,
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
    v_main_service_id,
    v_run_key || ' Gel Snapshot',
    'Manicure',
    41.25,
    1,
    45,
    10,
    v_staff_id,
    timestamptz '2026-08-20 15:00:00+00',
    timestamptz '2026-08-20 15:45:00+00'
  )
  returning id into v_main_line_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    parent_booking_line_id,
    line_type,
    service_id,
    service_name_snapshot,
    service_category_snapshot,
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
    v_main_line_id,
    'add_on',
    v_add_on_service_id,
    v_run_key || ' Add-on Snapshot',
    'Add-on',
    12.50,
    1,
    15,
    20,
    v_staff_id,
    timestamptz '2026-08-20 15:45:00+00',
    timestamptz '2026-08-20 16:00:00+00'
  )
  returning id into v_add_on_line_id;

  select service_name_snapshot, unit_price
  into v_main_snapshot_name, v_main_snapshot_price
  from public.booking_lines
  where id = v_main_line_id;

  select service_name_snapshot, unit_price
  into v_add_on_snapshot_name, v_add_on_snapshot_price
  from public.booking_lines
  where id = v_add_on_line_id;

  v_ticket_id := public.convert_booking_to_pos_ticket(v_booking_id);
  v_ticket_retry_id := public.convert_booking_to_pos_ticket(v_booking_id);

  if v_ticket_id is null or v_ticket_retry_id is distinct from v_ticket_id then
    raise exception 'Phase5 conversion was not idempotent.';
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = v_booking_id
      and pos_ticket_id = v_ticket_id
      and payment_status = 'pending'
  ) then
    raise exception 'Phase5 booking was not linked to the POS ticket.';
  end if;

  if not exists (
    select 1
    from public.pos_tickets
    where id = v_ticket_id
      and source_booking_id = v_booking_id
      and customer_id = v_customer_id
      and status = 'open'
  ) then
    raise exception 'Phase5 POS ticket source/customer/status was incorrect.';
  end if;

  select count(*)
  into v_line_count
  from public.pos_ticket_items
  where pos_ticket_id = v_ticket_id
    and source_booking_id = v_booking_id
    and source_kind = 'booking'
    and is_removed = false;

  if v_line_count <> 2 then
    raise exception 'Phase5 expected two booking-sourced ticket items, got %.', v_line_count;
  end if;

  if not exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_id = v_ticket_id
      and source_booking_line_id = v_main_line_id
      and service_name_snapshot = v_main_snapshot_name
      and booked_unit_price_snapshot = v_main_snapshot_price
      and unit_price = v_main_snapshot_price
      and assigned_staff_id = v_staff_id
      and performed_by_staff_id = v_staff_id
  ) or not exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_id = v_ticket_id
      and source_booking_line_id = v_add_on_line_id
      and service_name_snapshot = v_add_on_snapshot_name
      and booked_unit_price_snapshot = v_add_on_snapshot_price
      and unit_price = v_add_on_snapshot_price
  ) then
    raise exception 'Phase5 ticket item snapshots/staff/source line mapping were incorrect: %.',
      (
        select jsonb_agg(
          jsonb_build_object(
            'source_booking_line_id', source_booking_line_id,
            'service_name_snapshot', service_name_snapshot,
            'booked_unit_price_snapshot', booked_unit_price_snapshot,
            'unit_price', unit_price,
            'assigned_staff_id', assigned_staff_id,
            'performed_by_staff_id', performed_by_staff_id,
            'source_kind', source_kind
          )
          order by created_at
        )
        from public.pos_ticket_items
        where pos_ticket_id = v_ticket_id
      );
  end if;

  select count(*)
  into v_event_count
  from public.booking_status_events
  where booking_id = v_booking_id
    and event_type = 'converted_to_ticket';

  if v_event_count <> 1 then
    raise exception 'Phase5 expected one converted_to_ticket event, got %.', v_event_count;
  end if;

  select count(*)
  into v_audit_count
  from public.pos_ticket_audit_logs
  where ticket_id = v_ticket_id
    and action = 'ticket_created_from_booking';

  if v_audit_count <> 1 then
    raise exception 'Phase5 expected one ticket_created_from_booking audit, got %.', v_audit_count;
  end if;

  update public.booking_lines
  set
    unit_price = 999.99,
    service_name_snapshot = v_run_key || ' Mutated After Ticket',
    updated_at = now()
  where id = v_main_line_id;

  if exists (
    select 1
    from public.pos_ticket_items
    where pos_ticket_id = v_ticket_id
      and source_booking_line_id = v_main_line_id
      and (
        unit_price <> v_main_snapshot_price
        or booked_unit_price_snapshot <> v_main_snapshot_price
        or service_name_snapshot <> v_main_snapshot_name
      )
  ) then
    raise exception 'Phase5 booking mutation rewrote an existing POS ticket item.';
  end if;

  update public.booking_lines
  set
    line_status = 'completed',
    performed_by_staff_id = v_staff_id,
    completed_at = now(),
    line_status_updated_at = now(),
    line_status_updated_by_user_id = v_actor_user_id
  where id = v_add_on_line_id;

  if not exists (
    select 1
    from public.pos_ticket_items
    where source_booking_line_id = v_add_on_line_id
      and performed_by_staff_id = v_staff_id
  ) then
    raise exception 'Phase5 performed staff did not sync to booking-sourced POS item.';
  end if;

  for v_metric in
    select *
    from public.get_customer_crm_metrics(v_salon_id, array[v_customer_id]::uuid[])
  loop
    if v_metric.customer_id <> v_customer_id
      or v_metric.appointment_count < 1
      or v_metric.active_pos_ticket_count < 1
    then
      raise exception 'Phase5 customer CRM metrics did not include booking/ticket activity: %.', row_to_json(v_metric);
    end if;
  end loop;

  insert into public.bookings (
    organization_id,
    salon_id,
    customer_id,
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
    timestamptz '2026-08-21 15:00:00+00',
    timestamptz '2026-08-21 15:45:00+00',
    'pending',
    'owner_manual',
    'request_confirmation',
    'requested',
    'America/Chicago',
    v_run_key || ' pending reject',
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_pending_booking_id;

  begin
    perform public.convert_booking_to_pos_ticket(v_pending_booking_id);
  exception
    when others then
      v_pending_error := true;
  end;

  if not v_pending_error then
    raise exception 'Phase5 pending booking conversion was not rejected.';
  end if;

  insert into public.bookings (
    organization_id,
    salon_id,
    customer_id,
    start_at,
    end_at,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    idempotency_key,
    cancellation_reason,
    cancelled_at,
    cancelled_by_user_id,
    created_by_user_id,
    updated_by_user_id
  )
  values (
    v_organization_id,
    v_salon_id,
    v_customer_id,
    timestamptz '2026-08-22 15:00:00+00',
    timestamptz '2026-08-22 15:45:00+00',
    'cancelled',
    'owner_manual',
    'instant_booking',
    'confirmed',
    'America/Chicago',
    v_run_key || ' cancelled reject',
    'Phase5 cancelled before ticket.',
    now(),
    v_actor_user_id,
    v_actor_user_id,
    v_actor_user_id
  )
  returning id into v_cancelled_booking_id;

  begin
    perform public.convert_booking_to_pos_ticket(v_cancelled_booking_id);
  exception
    when others then
      v_cancelled_error := true;
  end;

  if not v_cancelled_error then
    raise exception 'Phase5 cancelled booking conversion was not rejected.';
  end if;

  update public.pos_tickets
  set
    status = 'voided',
    updated_at = now()
  where id = v_ticket_id;

  insert into public.pos_ticket_audit_logs (
    organization_id,
    salon_id,
    ticket_id,
    action,
    note,
    created_by
  )
  values (
    v_organization_id,
    v_salon_id,
    v_ticket_id,
    'ticket_voided',
    'Phase5 regression cleanup void.',
    v_actor_user_id
  );

  if exists (
    select 1
    from public.bookings
    where id = v_booking_id
      and status = 'cancelled'
  ) then
    raise exception 'Phase5 voiding ticket cancelled the booking.';
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = 'Phase5 regression cleanup soft-cancel',
    cancelled_at = coalesce(cancelled_at, now()),
    cancelled_by_user_id = v_actor_user_id,
    updated_by_user_id = v_actor_user_id,
    updated_at = now()
  where id in (v_booking_id, v_pending_booking_id, v_cancelled_booking_id);

  if exists (
    select 1
    from public.bookings
    where id in (v_booking_id, v_pending_booking_id, v_cancelled_booking_id)
      and public.booking_status_blocks_slot(status)
  ) then
    raise exception 'Phase5 cleanup did not soft-cancel test bookings.';
  end if;
end $$;

select
  'phase5_customer_ticket_regression_passed' as result,
  now() as verified_at;
