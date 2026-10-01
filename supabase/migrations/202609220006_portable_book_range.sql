create or replace function public.get_pos_portable_book_data(
  p_key_id uuid,
  p_session_signature text,
  p_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_salon_id uuid;
  target_timezone text;
  range_start timestamptz;
  range_end timestamptz;
  appointments_json jsonb;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);

  if target_salon_id is null
    or not public.pos_portable_access_has_capability(
      p_key_id,
      p_session_signature,
      'portable.book.view'
    )
  then
    return null;
  end if;

  select coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into target_timezone
  from public.booking_settings
  where booking_settings.salon_id = target_salon_id
  limit 1;

  target_timezone := coalesce(target_timezone, 'America/Chicago');
  range_start := p_date::timestamp at time zone target_timezone;
  range_end := (p_date + 31)::timestamp at time zone target_timezone;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customerName', booking_rows.customer_name,
        'customerPhone', booking_rows.customer_phone,
        'endAt', booking_rows.end_at,
        'id', booking_rows.id,
        'serviceNames', booking_rows.service_names,
        'staffName', booking_rows.staff_name,
        'startAt', booking_rows.start_at,
        'status', booking_rows.status
      )
      order by booking_rows.start_at
    ),
    '[]'::jsonb
  )
  into appointments_json
  from (
    select
      bookings.id,
      bookings.start_at,
      bookings.end_at,
      bookings.status,
      customers.name as customer_name,
      customers.phone as customer_phone,
      staff.display_name as staff_name,
      coalesce(
        (
          select jsonb_agg(booking_lines.service_name_snapshot order by booking_lines.display_order)
          from public.booking_lines
          where booking_lines.booking_id = bookings.id
            and booking_lines.salon_id = target_salon_id
            and booking_lines.line_status <> 'cancelled'
        ),
        '[]'::jsonb
      ) as service_names
    from public.bookings
    left join public.customers on customers.id = bookings.customer_id
    left join public.staff on staff.id = bookings.staff_id
    where bookings.salon_id = target_salon_id
      and bookings.start_at < range_end
      and bookings.end_at > range_start
      and bookings.status not in ('cancelled', 'no_show')
    order by bookings.start_at
    limit 500
  ) booking_rows;

  return jsonb_build_object(
    'appointments', appointments_json,
    'timezone', target_timezone
  );
end;
$$;
