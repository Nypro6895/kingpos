create or replace function public.start_assigned_booking_line(
  p_booking_line_id uuid,
  p_service_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff_id uuid;
  actor_user_id uuid := public.current_public_user_id();
  booking_row public.bookings%rowtype;
  old_booking_status text;
  target_line public.booking_lines%rowtype;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'message', 'Sign in required.');
  end if;

  select *
  into target_line
  from public.booking_lines
  where id = p_booking_line_id
  for update;

  if target_line.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Booking line was not found.');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = target_line.booking_id
    and salon_id = target_line.salon_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Booking was not found.');
  end if;

  actor_staff_id := public.current_user_staff_id_for_salon(target_line.salon_id);

  if actor_staff_id is null or target_line.assigned_staff_id is distinct from actor_staff_id then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You can only update your own assigned service.');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'not_changeable', 'message', 'This appointment is no longer active.');
  end if;

  if booking_row.status = 'pending' or booking_row.confirmation_status = 'requested' then
    return jsonb_build_object('ok', false, 'code', 'needs_confirmation', 'message', 'Confirm the booking before starting service.');
  end if;

  if target_line.line_status = 'in_service' then
    return jsonb_build_object('ok', true, 'already_started', true, 'booking_line_id', target_line.id);
  end if;

  if target_line.line_status not in ('scheduled', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'This service cannot be started.');
  end if;

  old_booking_status := case when booking_row.status = 'scheduled' then 'confirmed' else booking_row.status end;

  update public.booking_lines
  set line_status = 'in_service',
      started_at = coalesce(started_at, now()),
      performed_by_staff_id = coalesce(performed_by_staff_id, actor_staff_id),
      service_note = nullif(btrim(coalesce(p_service_note, '')), ''),
      line_status_updated_at = now(),
      line_status_updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = target_line.id;

  if old_booking_status in ('confirmed', 'checked_in') then
    update public.bookings
    set status = 'in_service',
        confirmation_status = 'confirmed',
        updated_by_user_id = actor_user_id,
        updated_at = now()
    where id = booking_row.id;
  end if;

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
    'line_started',
    old_booking_status,
    case when old_booking_status in ('confirmed', 'checked_in') then 'in_service' else old_booking_status end,
    actor_user_id,
    actor_staff_id,
    'staff',
    jsonb_build_object('booking_line_id', target_line.id)
  );

  if old_booking_status in ('confirmed', 'checked_in') then
    perform public.notify_booking_change(booking_row.id, 'status_in_service', actor_user_id);
  end if;

  return jsonb_build_object('ok', true, 'booking_line_id', target_line.id);
end;
$$;

grant execute on function public.start_assigned_booking_line(uuid, text) to authenticated;

create or replace function public.complete_assigned_booking_line(
  p_booking_line_id uuid,
  p_service_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_staff_id uuid;
  actor_user_id uuid := public.current_public_user_id();
  all_lines_complete boolean;
  booking_row public.bookings%rowtype;
  old_booking_status text;
  target_line public.booking_lines%rowtype;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'message', 'Sign in required.');
  end if;

  select *
  into target_line
  from public.booking_lines
  where id = p_booking_line_id
  for update;

  if target_line.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Booking line was not found.');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = target_line.booking_id
    and salon_id = target_line.salon_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Booking was not found.');
  end if;

  actor_staff_id := public.current_user_staff_id_for_salon(target_line.salon_id);

  if actor_staff_id is null or target_line.assigned_staff_id is distinct from actor_staff_id then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'message', 'You can only update your own assigned service.');
  end if;

  if booking_row.status in ('cancelled', 'completed', 'no_show') and target_line.line_status <> 'completed' then
    return jsonb_build_object('ok', false, 'code', 'not_changeable', 'message', 'This appointment is no longer active.');
  end if;

  if booking_row.status = 'pending' or booking_row.confirmation_status = 'requested' then
    return jsonb_build_object('ok', false, 'code', 'needs_confirmation', 'message', 'Confirm the booking before completing service.');
  end if;

  if target_line.line_status = 'completed' then
    return jsonb_build_object('ok', true, 'already_completed', true, 'booking_line_id', target_line.id);
  end if;

  if target_line.line_status not in ('scheduled', 'in_service', 'in_progress') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status', 'message', 'This service cannot be completed.');
  end if;

  old_booking_status := case when booking_row.status = 'scheduled' then 'confirmed' else booking_row.status end;

  update public.booking_lines
  set line_status = 'completed',
      started_at = coalesce(started_at, now()),
      completed_at = now(),
      performed_by_staff_id = coalesce(performed_by_staff_id, actor_staff_id),
      service_note = nullif(btrim(coalesce(p_service_note, '')), ''),
      line_status_updated_at = now(),
      line_status_updated_by_user_id = actor_user_id,
      updated_at = now()
  where id = target_line.id;

  select not exists (
    select 1
    from public.booking_lines
    where booking_id = booking_row.id
      and salon_id = booking_row.salon_id
      and line_status not in ('completed', 'cancelled', 'skipped')
  )
  into all_lines_complete;

  if all_lines_complete then
    update public.bookings
    set status = 'completed',
        confirmation_status = 'confirmed',
        updated_by_user_id = actor_user_id,
        updated_at = now()
    where id = booking_row.id;
  elsif old_booking_status in ('confirmed', 'checked_in') then
    update public.bookings
    set status = 'in_service',
        confirmation_status = 'confirmed',
        updated_by_user_id = actor_user_id,
        updated_at = now()
    where id = booking_row.id;
  end if;

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
    'line_completed',
    old_booking_status,
    case
      when all_lines_complete then 'completed'
      when old_booking_status in ('confirmed', 'checked_in') then 'in_service'
      else old_booking_status
    end,
    actor_user_id,
    actor_staff_id,
    'staff',
    jsonb_build_object('booking_line_id', target_line.id)
  );

  if all_lines_complete then
    perform public.notify_booking_change(booking_row.id, 'status_completed', actor_user_id);
  end if;

  return jsonb_build_object('ok', true, 'booking_line_id', target_line.id);
end;
$$;

grant execute on function public.complete_assigned_booking_line(uuid, text) to authenticated;
