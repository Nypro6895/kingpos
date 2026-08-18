create or replace function public.resolve_public_booking_request_notifications(
  target_booking_id uuid
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
  is_assigned_staff boolean := false;
  updated_count integer := 0;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if target_booking_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_booking');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = target_booking_id;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if not public.user_can_manage_salon(booking_row.salon_id) then
    actor_staff_id := public.current_user_staff_id_for_salon(booking_row.salon_id);

    if actor_staff_id is not null then
      select exists (
        select 1
        from public.booking_lines booking_lines
        where booking_lines.booking_id = booking_row.id
          and booking_lines.salon_id = booking_row.salon_id
          and booking_lines.assigned_staff_id = actor_staff_id
          and booking_lines.line_status not in ('cancelled', 'skipped')
      )
      into is_assigned_staff;
    end if;

    if actor_staff_id is null or not is_assigned_staff then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
  end if;

  if booking_row.status <> 'confirmed'
    or booking_row.confirmation_status <> 'confirmed'
  then
    return jsonb_build_object('ok', true, 'resolved', false, 'reason', 'not_confirmed');
  end if;

  update public.app_notifications
  set title = 'New booking confirmed',
      updated_at = now()
  where booking_id = booking_row.id
    and notification_type = 'public_booking_created'
    and title = 'New booking request'
    and recipient_kind in ('owner_manager', 'staff')
    and event_key is not null
    and (
      event_key like 'public_booking_created:' || booking_row.id::text || ':%'
      or event_key like 'public_booking_created_staff:' || booking_row.id::text || ':%'
    );

  get diagnostics updated_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'booking_id', booking_row.id,
    'resolved', updated_count > 0,
    'updated_count', updated_count
  );
end;
$$;

grant execute on function public.resolve_public_booking_request_notifications(uuid) to authenticated;

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
    perform public.resolve_public_booking_request_notifications(booking_row.id);

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

  perform public.resolve_public_booking_request_notifications(booking_row.id);

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
