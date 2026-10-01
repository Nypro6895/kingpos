create or replace function public.create_pos_portable_appointment(
  p_key_id uuid, p_session_signature text, p_customer_name text,
  p_customer_phone text, p_customer_email text, p_service_id uuid,
  p_staff_id uuid, p_start_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_salon_id uuid; target_customer_id uuid; target_booking_id uuid;
  target_timezone text; service_row record; staff_name text;
  target_end_at timestamptz;
begin
  target_salon_id := public.pos_portable_access_salon_id(p_key_id, p_session_signature);
  if target_salon_id is null or not public.pos_portable_access_has_capability(
    p_key_id, p_session_signature, 'portable.book.create'
  ) then raise exception 'Portable device cannot create appointments'; end if;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;

  select services.id, services.name, services.category, services.description,
    services.base_price, services.duration_minutes into service_row
  from public.services where services.id = p_service_id
    and services.salon_id = target_salon_id and services.is_active = true;
  if service_row.id is null then raise exception 'Service is unavailable'; end if;

  if p_staff_id is not null then
    select staff.display_name into staff_name from public.staff
    where staff.id = p_staff_id and staff.salon_id = target_salon_id and staff.is_active = true;
    if staff_name is null then raise exception 'Professional is unavailable'; end if;
  end if;

  select customers.id into target_customer_id from public.customers
  where customers.location_id = target_salon_id and (
    (nullif(trim(p_customer_phone), '') is not null and customers.phone = trim(p_customer_phone))
    or (nullif(trim(p_customer_email), '') is not null and lower(customers.email) = lower(trim(p_customer_email)))
  ) order by customers.updated_at desc limit 1;

  if target_customer_id is null then
    insert into public.customers (location_id, name, phone, email, source)
    values (target_salon_id, trim(p_customer_name), nullif(trim(p_customer_phone), ''),
      nullif(lower(trim(p_customer_email)), ''), 'portable_pos')
    returning id into target_customer_id;
  end if;

  target_timezone := public.get_salon_business_timezone(target_salon_id);
  target_end_at := p_start_at + make_interval(mins => service_row.duration_minutes);
  insert into public.bookings (salon_id, customer_id, staff_id, start_at, end_at,
    status, source, confirmation_mode, confirmation_status, salon_timezone_snapshot)
  values (target_salon_id, target_customer_id, p_staff_id, p_start_at, target_end_at,
    'scheduled', 'pos', 'instant_book', 'confirmed', target_timezone)
  returning id into target_booking_id;

  insert into public.booking_lines (salon_id, booking_id, service_id,
    service_name_snapshot, service_category_snapshot, service_description_snapshot,
    unit_price, line_total, duration_minutes, assigned_staff_id,
    scheduled_start_at, scheduled_end_at)
  values (target_salon_id, target_booking_id, service_row.id, service_row.name,
    service_row.category, service_row.description, service_row.base_price,
    service_row.base_price, service_row.duration_minutes, p_staff_id,
    p_start_at, target_end_at);

  return jsonb_build_object('customerName', trim(p_customer_name),
    'customerPhone', nullif(trim(p_customer_phone), ''), 'endAt', target_end_at,
    'id', target_booking_id, 'serviceNames', jsonb_build_array(service_row.name),
    'staffName', staff_name, 'startAt', p_start_at, 'status', 'scheduled');
end;
$$;

revoke all on function public.create_pos_portable_appointment(
  uuid, text, text, text, text, uuid, uuid, timestamptz
) from public;
grant execute on function public.create_pos_portable_appointment(
  uuid, text, text, text, text, uuid, uuid, timestamptz
) to anon, authenticated;
