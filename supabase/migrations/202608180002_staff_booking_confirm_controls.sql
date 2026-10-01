drop policy if exists "salon_member_read_booking_setup" on public.booking_settings;

create policy "salon_member_read_booking_setup" on public.booking_settings
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or public.current_user_staff_id_for_salon(salon_id) is not null
);

drop policy if exists "salon_member_read_services" on public.services;

create policy "salon_member_read_services" on public.services
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or public.current_user_staff_id_for_salon(salon_id) is not null
);

drop policy if exists "salon_member_read_bookings" on public.bookings;

create policy "salon_member_read_bookings" on public.bookings
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or customer_user_id = public.current_public_user_id()
  or exists (
    select 1
    from public.booking_lines assigned_lines
    where assigned_lines.booking_id = bookings.id
      and assigned_lines.salon_id = bookings.salon_id
      and assigned_lines.assigned_staff_id = public.current_user_staff_id_for_salon(bookings.salon_id)
  )
);

drop policy if exists "salon_member_read_booking_lines" on public.booking_lines;

create policy "salon_member_read_booking_lines" on public.booking_lines
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or assigned_staff_id = public.current_user_staff_id_for_salon(salon_id)
);

drop policy if exists "salon_member_read_booking_events" on public.booking_status_events;

create policy "salon_member_read_booking_events" on public.booking_status_events
for select to authenticated
using (
  public.user_can_manage_salon(salon_id)
  or exists (
    select 1
    from public.booking_lines assigned_lines
    where assigned_lines.booking_id = booking_status_events.booking_id
      and assigned_lines.salon_id = booking_status_events.salon_id
      and assigned_lines.assigned_staff_id = public.current_user_staff_id_for_salon(booking_status_events.salon_id)
  )
);

create or replace function public.set_own_staff_online_booking(
  p_salon_id uuid,
  p_online_booking_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  actor_staff_id uuid;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if p_salon_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_salon');
  end if;

  actor_staff_id := public.current_user_staff_id_for_salon(p_salon_id);

  if actor_staff_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  update public.staff
  set online_booking_enabled = coalesce(p_online_booking_enabled, false),
      updated_at = now()
  where id = actor_staff_id
    and salon_id = p_salon_id
    and account_user_id = actor_user_id
    and is_active = true;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'salon_id', p_salon_id,
    'staff_id', actor_staff_id,
    'online_booking_enabled', coalesce(p_online_booking_enabled, false)
  );
end;
$$;

grant execute on function public.set_own_staff_online_booking(uuid, boolean) to authenticated;

create or replace function public.confirm_assigned_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  actor_staff_id uuid;
  already_confirmed boolean;
  assigned_to_staff boolean;
  booking_row public.bookings%rowtype;
  old_confirmation_status text;
  old_status text;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if p_booking_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_booking');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  actor_staff_id := public.current_user_staff_id_for_salon(booking_row.salon_id);

  if actor_staff_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select exists (
    select 1
    from public.booking_lines booking_lines
    where booking_lines.booking_id = booking_row.id
      and booking_lines.salon_id = booking_row.salon_id
      and booking_lines.assigned_staff_id = actor_staff_id
      and booking_lines.line_status not in ('cancelled', 'skipped')
  )
  into assigned_to_staff;

  if not assigned_to_staff then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'not_changeable');
  end if;

  already_confirmed :=
    booking_row.status = 'confirmed'
    and booking_row.confirmation_status = 'confirmed';

  if already_confirmed then
    return jsonb_build_object(
      'ok', true,
      'already_confirmed', true,
      'booking_id', booking_row.id,
      'staff_id', actor_staff_id
    );
  end if;

  if booking_row.status not in ('pending', 'scheduled', 'confirmed')
    and booking_row.confirmation_status <> 'requested'
  then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;

  old_status := booking_row.status;
  old_confirmation_status := booking_row.confirmation_status;

  update public.bookings
  set status = 'confirmed',
      confirmation_status = 'confirmed',
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
    actor_staff_id,
    actor_source,
    metadata
  )
  values (
    booking_row.salon_id,
    booking_row.id,
    'confirmed',
    old_status,
    'confirmed',
    actor_user_id,
    actor_staff_id,
    'staff',
    jsonb_build_object(
      'confirmation_source', 'staff',
      'old_confirmation_status', old_confirmation_status,
      'new_confirmation_status', 'confirmed'
    )
  );

  perform public.notify_booking_change(booking_row.id, 'status_confirmed', actor_user_id);

  return jsonb_build_object(
    'ok', true,
    'already_confirmed', false,
    'booking_id', booking_row.id,
    'staff_id', actor_staff_id
  );
end;
$$;

grant execute on function public.confirm_assigned_booking(uuid) to authenticated;

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
  staff_href text;
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
  staff_href := '/staff/appointments?date=' || booking_local_date || '&bookingId=' || booking_notice.id::text;

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
    'public_booking_created',
    booking_notice.id,
    case
      when booking_notice.status = 'pending'
        or booking_notice.confirmation_status = 'requested'
      then 'New booking request'
      else 'New booking confirmed'
    end,
    booking_notice.customer_name || ' booked with you at ' || booking_notice.salon_name || '.',
    staff_href,
    'public_booking_created_staff:' || booking_notice.id::text || ':' || staff_recipients.recipient_user_id::text
  from (
    select distinct
      coalesce(staff.account_user_id, staff.user_id) as recipient_user_id
    from public.booking_lines booking_lines
    join public.staff staff on staff.id = booking_lines.assigned_staff_id
    where booking_lines.booking_id = booking_notice.id
      and booking_lines.salon_id = booking_notice.salon_id
      and staff.is_active = true
      and coalesce(staff.account_user_id, staff.user_id) is not null
  ) staff_recipients
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
