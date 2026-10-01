create or replace function public.notify_public_booking_created(target_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_notice record;
  booking_href text;
  booking_local_date text;
begin
  select
    bookings.id,
    bookings.salon_id,
    bookings.status,
    bookings.confirmation_status,
    bookings.start_at,
    bookings.salon_timezone_snapshot,
    salons.account_id,
    coalesce(nullif(btrim(settings.business_name), ''), salons.name, 'this salon') as salon_name,
    coalesce(nullif(btrim(customers.name), ''), 'A customer') as customer_name
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
  booking_href := '/bookings?date=' || booking_local_date || '&bookingId=' || booking_notice.id::text;

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
    memberships.user_id,
    'owner_manager',
    'public_booking_created',
    booking_notice.id,
    case
      when booking_notice.status = 'pending'
        or booking_notice.confirmation_status = 'requested'
      then 'New booking request'
      else 'New booking confirmed'
    end,
    booking_notice.customer_name || ' booked at ' || booking_notice.salon_name || '.',
    booking_href,
    'public_booking_created:' || booking_notice.id::text || ':' || memberships.user_id::text
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
  left join public.permissions permissions on permissions.id = role_permissions.permission_id
  where memberships.account_id = booking_notice.account_id
    and memberships.status = 'active'
    and (
      roles.code = 'OWNER'
      or permissions.code = 'booking.manage'
    )
  group by memberships.user_id
  on conflict (recipient_user_id, event_key) where event_key is not null do update
  set account_id = excluded.account_id,
      salon_id = excluded.salon_id,
      recipient_kind = excluded.recipient_kind,
      notification_type = excluded.notification_type,
      booking_id = excluded.booking_id,
      title = excluded.title,
      body = excluded.body,
      href = excluded.href,
      read_at = null,
      updated_at = now();
end;
$$;

drop policy if exists "customer_read_own_booking_lines" on public.booking_lines;

create policy "customer_read_own_booking_lines" on public.booking_lines
for select to authenticated
using (
  exists (
    select 1
    from public.bookings
    where bookings.id = booking_lines.booking_id
      and bookings.customer_user_id = public.current_public_user_id()
  )
);

create or replace function public.create_public_booking(
  p_salon_id uuid,
  p_customer_first_name text,
  p_customer_last_name text,
  p_customer_phone text,
  p_customer_email text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_lines jsonb,
  p_public_notes text default null,
  p_source text default 'public_profile',
  p_source_reference_type text default null,
  p_source_reference_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  existing_booking public.bookings%rowtype;
  saved_customer public.customers%rowtype;
  new_booking_id uuid;
  line_item jsonb;
  line_service public.services%rowtype;
  manage_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  selected_confirmation_mode text;
  booking_status text;
  customer_display_name text;
  customer_email text;
  customer_phone text;
begin
  customer_display_name := nullif(btrim(concat_ws(' ', p_customer_first_name, p_customer_last_name)), '');
  customer_email := nullif(btrim(lower(coalesce(p_customer_email, ''))), '');
  customer_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');

  if actor_user_id is not null then
    select
      coalesce(
        customer_display_name,
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        nullif(btrim(users.email), ''),
        nullif(btrim(users.phone), '')
      ),
      coalesce(customer_email, nullif(btrim(lower(coalesce(users.email, ''))), '')),
      coalesce(customer_phone, nullif(btrim(coalesce(users.phone, '')), ''))
    into customer_display_name, customer_email, customer_phone
    from public.users
    where users.id = actor_user_id
    limit 1;
  end if;

  customer_display_name := coalesce(customer_display_name, 'Customer');

  if p_idempotency_key is not null then
    select *
    into existing_booking
    from public.bookings
    where salon_id = p_salon_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if existing_booking.id is not null then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'booking_id', existing_booking.id,
        'manage_token', existing_booking.customer_cancellation_token_hash,
        'status', existing_booking.status,
        'confirmation_status', existing_booking.confirmation_status
      );
    end if;
  end if;

  select booking_settings.confirmation_mode
  into selected_confirmation_mode
  from public.booking_settings
  where salon_id = p_salon_id;

  selected_confirmation_mode := coalesce(selected_confirmation_mode, 'request_confirmation');
  booking_status := case when selected_confirmation_mode = 'instant_booking' then 'confirmed' else 'pending' end;

  insert into public.customers (
    location_id,
    customer_user_id,
    name,
    phone,
    email,
    source,
    status,
    created_by_user_id
  )
  values (
    p_salon_id,
    actor_user_id,
    customer_display_name,
    customer_phone,
    customer_email,
    coalesce(nullif(p_source, ''), 'public_profile'),
    'active',
    actor_user_id
  )
  returning * into saved_customer;

  insert into public.bookings (
    salon_id,
    customer_id,
    customer_user_id,
    start_at,
    end_at,
    public_notes,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    customer_cancellation_token_hash,
    source_reference_type,
    source_reference_id,
    idempotency_key,
    created_by_user_id
  )
  values (
    p_salon_id,
    saved_customer.id,
    saved_customer.customer_user_id,
    p_start_at,
    p_end_at,
    nullif(btrim(coalesce(p_public_notes, '')), ''),
    booking_status,
    coalesce(nullif(p_source, ''), 'public_profile'),
    selected_confirmation_mode,
    case when selected_confirmation_mode = 'instant_booking' then 'confirmed' else 'requested' end,
    coalesce((select timezone_iana from public.booking_settings where salon_id = p_salon_id), 'America/Chicago'),
    manage_token,
    p_source_reference_type,
    p_source_reference_id,
    p_idempotency_key,
    actor_user_id
  )
  returning id into new_booking_id;

  for line_item in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    select *
    into line_service
    from public.services
    where id = (line_item ->> 'service_id')::uuid
      and salon_id = p_salon_id
    limit 1;

    if line_service.id is null then
      raise exception 'Booking service does not belong to salon.';
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
      line_status
    )
    values (
      p_salon_id,
      new_booking_id,
      case when line_item ->> 'line_type' = 'add_on' then 'add_on' else 'service' end,
      line_service.id,
      line_service.name,
      line_service.category,
      line_service.description,
      line_service.base_price,
      1,
      line_service.base_price,
      line_service.duration_minutes,
      coalesce((line_item ->> 'cleanup_buffer_minutes')::integer, 0),
      coalesce((line_item ->> 'display_order')::integer, 0),
      nullif(line_item ->> 'assigned_staff_id', '')::uuid,
      (line_item ->> 'scheduled_start_at')::timestamptz,
      (line_item ->> 'scheduled_end_at')::timestamptz,
      'scheduled'
    );
  end loop;

  insert into public.booking_status_events (
    salon_id,
    booking_id,
    event_type,
    new_status,
    actor_user_id,
    actor_source
  )
  values (
    p_salon_id,
    new_booking_id,
    'booking_created',
    booking_status,
    actor_user_id,
    case when actor_user_id is null then 'public' else 'customer' end
  );

  perform public.notify_public_booking_created(new_booking_id);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'booking_id', new_booking_id,
    'manage_token', manage_token,
    'status', booking_status,
    'confirmation_status', case when selected_confirmation_mode = 'instant_booking' then 'confirmed' else 'requested' end
  );
end;
$$;
