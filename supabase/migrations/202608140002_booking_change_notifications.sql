create or replace function public.notify_booking_change(
  target_booking_id uuid,
  p_change_type text,
  p_actor_user_id uuid default null,
  p_old_staff_ids uuid[] default '{}'::uuid[],
  p_new_staff_ids uuid[] default '{}'::uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_notice record;
  booking_local_date text;
  customer_href text;
  staff_href text;
  change_label text;
  customer_title text;
  staff_title text;
begin
  select
    bookings.id,
    bookings.salon_id,
    bookings.customer_user_id,
    bookings.start_at,
    bookings.salon_timezone_snapshot,
    salons.account_id,
    coalesce(nullif(btrim(settings.business_name), ''), salons.name, 'this salon') as salon_name,
    coalesce(nullif(btrim(customers.name), ''), 'Customer') as customer_name
  into booking_notice
  from public.bookings bookings
  join public.locations salons on salons.id = bookings.salon_id
  join public.customers customers on customers.id = bookings.customer_id
  left join public.salon_settings settings on settings.salon_id = bookings.salon_id
  where bookings.id = target_booking_id
  limit 1;

  if not found then
    return;
  end if;

  booking_local_date := to_char(
    booking_notice.start_at at time zone coalesce(
      nullif(booking_notice.salon_timezone_snapshot, ''),
      'America/Chicago'
    ),
    'YYYY-MM-DD'
  );
  customer_href := '/my-bookings/' || booking_notice.id::text;
  staff_href := '/staff/appointments?date=' || booking_local_date || '&bookingId=' || booking_notice.id::text;

  change_label := case
    when p_change_type in ('status_confirmed', 'confirmed') then 'confirmed'
    when p_change_type in ('status_cancel', 'status_cancelled', 'cancelled') then 'cancelled'
    when p_change_type = 'status_checked_in' then 'checked in'
    when p_change_type = 'status_in_service' then 'started'
    when p_change_type = 'status_completed' then 'completed'
    when p_change_type = 'status_mark_no_show' or p_change_type = 'status_no_show' then 'marked no-show'
    when p_change_type = 'rescheduled' then 'rescheduled'
    when p_change_type = 'staff_reassigned' then 'reassigned'
    when p_change_type = 'services_adjusted' then 'adjusted'
    else 'updated'
  end;
  customer_title := 'Appointment ' || change_label;
  staff_title := 'Appointment ' || change_label;

  if booking_notice.customer_user_id is not null then
    insert into public.app_notifications (
      account_id,
      salon_id,
      recipient_user_id,
      recipient_kind,
      notification_type,
      booking_id,
      title,
      body,
      href,
      event_key
    )
    values (
      booking_notice.account_id,
      booking_notice.salon_id,
      booking_notice.customer_user_id,
      'customer',
      'booking_change',
      booking_notice.id,
      customer_title,
      'Your appointment at ' || booking_notice.salon_name || ' was ' || change_label || '.',
      customer_href,
      null
    );
  end if;

  insert into public.app_notifications (
    account_id,
    salon_id,
    recipient_user_id,
    recipient_kind,
    notification_type,
    booking_id,
    title,
    body,
    href,
    event_key
  )
  select
    booking_notice.account_id,
    booking_notice.salon_id,
    staff_recipients.recipient_user_id,
    'staff',
    'booking_change',
    booking_notice.id,
    staff_title,
    booking_notice.customer_name || '''s appointment was ' || change_label || '.',
    staff_href,
    null
  from (
    select distinct
      coalesce(staff.account_user_id, staff.user_id) as recipient_user_id
    from public.staff staff
    join (
      select unnest(
        coalesce(p_old_staff_ids, '{}'::uuid[]) ||
        coalesce(p_new_staff_ids, '{}'::uuid[]) ||
        coalesce(
          array(
            select distinct booking_lines.assigned_staff_id
            from public.booking_lines booking_lines
            where booking_lines.booking_id = booking_notice.id
              and booking_lines.salon_id = booking_notice.salon_id
              and booking_lines.assigned_staff_id is not null
          ),
          '{}'::uuid[]
        )
      ) as staff_id
    ) targets on targets.staff_id = staff.id
    where staff.salon_id = booking_notice.salon_id
      and coalesce(staff.account_user_id, staff.user_id) is not null
  ) staff_recipients;
end;
$$;

create or replace function public.replace_booking_services(
  p_booking_id uuid,
  p_lines jsonb,
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
  clean_override text := nullif(btrim(coalesce(p_overbooking_override_reason, '')), '');
  line_payload jsonb;
  line_service public.services%rowtype;
  old_services jsonb;
  representative_staff_id uuid;
begin
  if actor_user_id is null then
    raise exception 'Sign in required.';
  end if;

  if p_booking_id is null or p_end_at is null or p_lines is null then
    raise exception 'Booking service adjustment requires a booking and services.';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Select at least one service.';
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

  if booking_row.status in ('in_service', 'cancelled', 'completed', 'no_show') then
    raise exception 'This appointment can no longer have services adjusted.';
  end if;

  if booking_row.pos_ticket_id is not null then
    raise exception 'Open the POS ticket to adjust services after ticket creation.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_line_id', booking_lines.id,
        'service_id', booking_lines.service_id,
        'service_name', booking_lines.service_name_snapshot,
        'staff_id', booking_lines.assigned_staff_id,
        'scheduled_start_at', booking_lines.scheduled_start_at,
        'scheduled_end_at', booking_lines.scheduled_end_at
      )
      order by booking_lines.display_order
    ),
    '[]'::jsonb
  )
  into old_services
  from public.booking_lines booking_lines
  where booking_lines.booking_id = booking_row.id
    and booking_lines.salon_id = booking_row.salon_id;

  select nullif(payload.value ->> 'assigned_staff_id', '')::uuid
  into representative_staff_id
  from jsonb_array_elements(p_lines) as payload(value)
  where nullif(payload.value ->> 'assigned_staff_id', '') is not null
  limit 1;

  delete from public.booking_lines
  where booking_id = booking_row.id
    and salon_id = booking_row.salon_id;

  for line_payload in
    select value from jsonb_array_elements(p_lines) as payload(value)
  loop
    if nullif(line_payload ->> 'service_id', '') is null then
      raise exception 'Booking service id is required.';
    end if;

    select *
    into line_service
    from public.services
    where id = (line_payload ->> 'service_id')::uuid
      and salon_id = booking_row.salon_id
      and is_active = true
    limit 1;

    if line_service.id is null then
      raise exception 'Booking service must be active for this salon.';
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
      line_status,
      overbooking_override_reason,
      overbooking_override_by_user_id,
      overbooking_override_at
    )
    values (
      booking_row.salon_id,
      booking_row.id,
      'service',
      line_service.id,
      line_service.name,
      line_service.category,
      line_service.description,
      line_service.base_price,
      1,
      line_service.base_price,
      line_service.duration_minutes,
      coalesce((line_payload ->> 'cleanup_buffer_minutes')::integer, 0),
      coalesce((line_payload ->> 'display_order')::integer, 0),
      nullif(line_payload ->> 'assigned_staff_id', '')::uuid,
      (line_payload ->> 'scheduled_start_at')::timestamptz,
      (line_payload ->> 'scheduled_end_at')::timestamptz,
      'scheduled',
      clean_override,
      case when clean_override is null then null else actor_user_id end,
      case when clean_override is null then null else now() end
    );
  end loop;

  update public.bookings
  set end_at = p_end_at,
      staff_id = representative_staff_id,
      updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = booking_row.id;

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
    'services_adjusted',
    booking_row.status,
    booking_row.status,
    actor_user_id,
    'manager',
    jsonb_build_object(
      'old_services', old_services,
      'new_services', p_lines,
      'overbooking_override_reason', clean_override
    )
  );

  return booking_row.id;
end;
$$;
