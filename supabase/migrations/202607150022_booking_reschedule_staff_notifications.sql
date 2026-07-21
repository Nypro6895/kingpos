-- Booking reschedule repair + Phase 4 staff appointment foundations.
-- Additive only: keeps historical booking data intact while moving multi-line
-- reschedule into a single database transaction and adding line execution /
-- in-app notification primitives.

alter table public.booking_lines
add column if not exists line_status text not null default 'scheduled',
add column if not exists started_at timestamptz,
add column if not exists completed_at timestamptz,
add column if not exists performed_by_staff_id uuid references public.staff(id) on delete set null,
add column if not exists service_note text,
add column if not exists internal_staff_note text,
add column if not exists line_status_updated_at timestamptz,
add column if not exists line_status_updated_by_user_id uuid references public.users(id) on delete set null;

alter table public.booking_lines
drop constraint if exists booking_lines_line_status_check;

alter table public.booking_lines
add constraint booking_lines_line_status_check check (
  line_status in ('scheduled', 'in_service', 'completed', 'skipped', 'cancelled')
);

alter table public.booking_lines
drop constraint if exists booking_lines_line_completion_check;

alter table public.booking_lines
add constraint booking_lines_line_completion_check check (
  (line_status <> 'in_service' or started_at is not null)
  and (line_status <> 'completed' or completed_at is not null)
  and (completed_at is null or started_at is null or completed_at >= started_at)
);

alter table public.booking_status_events
drop constraint if exists booking_status_events_type_check;

alter table public.booking_status_events
add constraint booking_status_events_type_check check (
  event_type in (
    'booking_created',
    'confirmation_requested',
    'confirmed',
    'staff_assigned',
    'staff_reassigned',
    'rescheduled',
    'checked_in',
    'service_started',
    'line_started',
    'line_completed',
    'line_note_updated',
    'completed',
    'cancelled',
    'no_show',
    'converted_to_ticket',
    'overbooking_override'
  )
);

create index if not exists booking_lines_staff_status_time_idx
on public.booking_lines(assigned_staff_id, line_status, scheduled_start_at)
where assigned_staff_id is not null;

create index if not exists booking_lines_performer_idx
on public.booking_lines(performed_by_staff_id, completed_at desc)
where performed_by_staff_id is not null;

create or replace function public.validate_booking_line_execution_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.performed_by_staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.performed_by_staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Performed-by staff must be active for this salon.';
  end if;

  if new.line_status <> coalesce(old.line_status, 'scheduled')
    or new.started_at is distinct from old.started_at
    or new.completed_at is distinct from old.completed_at
  then
    new.line_status_updated_at := coalesce(new.line_status_updated_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists validate_booking_line_execution_scope
on public.booking_lines;

create trigger validate_booking_line_execution_scope
before update on public.booking_lines
for each row
execute function public.validate_booking_line_execution_scope();

create or replace function public.perform_booking_reschedule(
  p_booking_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_actor_user_id uuid,
  p_overbooking_override_reason text default null,
  p_require_public_availability boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  conflict_found boolean;
  duration_interval interval;
  line_row public.booking_lines%rowtype;
  local_timezone text;
  offset_interval interval;
  override_reason text;
  shifted_end_at timestamptz;
  shifted_start_at timestamptz;
begin
  if p_booking_id is null or p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'Booking requires a valid reschedule interval.';
  end if;

  override_reason := nullif(btrim(coalesce(p_overbooking_override_reason, '')), '');

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
  for update;

  if booking_row.id is null then
    raise exception 'Booking was not found.';
  end if;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    raise exception 'Terminal bookings cannot be rescheduled.';
  end if;

  local_timezone := coalesce(booking_row.salon_timezone_snapshot, 'America/Chicago');

  for line_row in
    select *
    from public.booking_lines
    where booking_id = booking_row.id
    order by display_order, created_at
  loop
    duration_interval := case
      when line_row.scheduled_start_at is not null
        and line_row.scheduled_end_at is not null
        and line_row.scheduled_end_at > line_row.scheduled_start_at
      then line_row.scheduled_end_at - line_row.scheduled_start_at
      else make_interval(
        mins => greatest(
          1,
          coalesce(line_row.duration_minutes, 1)
          + coalesce(line_row.cleanup_buffer_minutes, 0)
        )
      )
    end;
    offset_interval := greatest(
      interval '0 minutes',
      coalesce(line_row.scheduled_start_at, booking_row.start_at) - booking_row.start_at
    );
    shifted_start_at := p_start_at + offset_interval;
    shifted_end_at := shifted_start_at + duration_interval;

    if shifted_start_at < p_start_at or shifted_end_at > p_end_at then
      raise exception 'Booking interval is too short for existing service lines.';
    end if;

    if line_row.assigned_staff_id is not null then
      if p_require_public_availability then
        if not public.public_staff_line_is_available(
          booking_row.salon_id,
          booking_row.organization_id,
          line_row.assigned_staff_id,
          shifted_start_at,
          shifted_end_at,
          local_timezone,
          booking_row.id
        ) then
          raise exception 'That time is no longer available.';
        end if;
      elsif override_reason is null then
        select exists (
          select 1
          from public.booking_lines other_lines
          join public.bookings other_bookings
            on other_bookings.id = other_lines.booking_id
          where other_lines.booking_id <> booking_row.id
            and other_lines.salon_id = booking_row.salon_id
            and other_lines.assigned_staff_id = line_row.assigned_staff_id
            and other_lines.scheduled_start_at is not null
            and other_lines.scheduled_end_at is not null
            and public.booking_status_blocks_slot(other_bookings.status)
            and tstzrange(
              other_lines.scheduled_start_at,
              other_lines.scheduled_end_at,
              '[)'
            ) && tstzrange(shifted_start_at, shifted_end_at, '[)')
        )
        or exists (
          select 1
          from public.staff_time_blocks blocks
          where blocks.salon_id = booking_row.salon_id
            and (blocks.staff_id is null or blocks.staff_id = line_row.assigned_staff_id)
            and tstzrange(blocks.starts_at, blocks.ends_at, '[)')
              && tstzrange(shifted_start_at, shifted_end_at, '[)')
        )
        into conflict_found;

        if conflict_found then
          raise exception 'Assigned staff already has a booking or block in this interval.';
        end if;
      end if;
    end if;
  end loop;

  if p_start_at is distinct from booking_row.start_at
    or p_end_at is distinct from booking_row.end_at
  then
    update public.bookings
    set
      start_at = p_start_at,
      end_at = p_end_at,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
    where id = booking_row.id;
  end if;

  for line_row in
    select *
    from public.booking_lines
    where booking_id = booking_row.id
    order by
      case
        when p_start_at >= booking_row.start_at
        then coalesce(scheduled_start_at, booking_row.start_at)
      end desc nulls last,
      case
        when p_start_at < booking_row.start_at
        then coalesce(scheduled_start_at, booking_row.start_at)
      end asc nulls last,
      display_order asc,
      created_at asc
  loop
    duration_interval := case
      when line_row.scheduled_start_at is not null
        and line_row.scheduled_end_at is not null
        and line_row.scheduled_end_at > line_row.scheduled_start_at
      then line_row.scheduled_end_at - line_row.scheduled_start_at
      else make_interval(
        mins => greatest(
          1,
          coalesce(line_row.duration_minutes, 1)
          + coalesce(line_row.cleanup_buffer_minutes, 0)
        )
      )
    end;
    offset_interval := greatest(
      interval '0 minutes',
      coalesce(line_row.scheduled_start_at, booking_row.start_at) - booking_row.start_at
    );
    shifted_start_at := p_start_at + offset_interval;
    shifted_end_at := shifted_start_at + duration_interval;

    update public.booking_lines
    set
      scheduled_start_at = shifted_start_at,
      scheduled_end_at = shifted_end_at,
      overbooking_override_reason = coalesce(override_reason, overbooking_override_reason),
      overbooking_override_by_user_id = case
        when override_reason is null then overbooking_override_by_user_id
        else p_actor_user_id
      end,
      overbooking_override_at = case
        when override_reason is null then overbooking_override_at
        else coalesce(overbooking_override_at, now())
      end,
      updated_at = now()
    where id = line_row.id;
  end loop;
end;
$$;

revoke all on function public.perform_booking_reschedule(
  uuid,
  timestamptz,
  timestamptz,
  uuid,
  text,
  boolean
) from public, anon, authenticated;

create or replace function public.reschedule_canonical_booking(
  p_booking_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_overbooking_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_organization_id uuid;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    raise exception 'Sign in required.';
  end if;

  select organization_id
  into booking_organization_id
  from public.bookings
  where id = p_booking_id;

  if booking_organization_id is null then
    raise exception 'Booking was not found.';
  end if;

  if not public.user_has_organization_permission(
    booking_organization_id,
    array['booking.manage']::text[]
  ) then
    raise exception 'Missing required permission: booking.manage';
  end if;

  perform public.perform_booking_reschedule(
    p_booking_id,
    p_start_at,
    p_end_at,
    actor_user_id,
    p_overbooking_override_reason,
    false
  );

  return p_booking_id;
end;
$$;

revoke all on function public.reschedule_canonical_booking(
  uuid,
  timestamptz,
  timestamptz,
  text
) from public, anon;
grant execute on function public.reschedule_canonical_booking(
  uuid,
  timestamptz,
  timestamptz,
  text
) to authenticated;

create or replace function public.reschedule_public_booking_by_manage_token(
  raw_token text,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
  new_end_at timestamptz;
  settings_row public.booking_settings%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash = public.public_booking_token_hash(raw_token)
  limit 1;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  select *
  into settings_row
  from public.booking_settings
  where salon_id = booking_row.salon_id;

  if p_start_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_time');
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(settings_row.minimum_lead_time_minutes, 120)) then
    return jsonb_build_object('ok', false, 'code', 'lead_time');
  end if;

  if p_start_at > now() + make_interval(days => coalesce(settings_row.maximum_advance_window_days, 30)) then
    return jsonb_build_object('ok', false, 'code', 'advance_window');
  end if;

  if coalesce(settings_row.same_day_booking_enabled, true) is not true
    and (p_start_at at time zone coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'))::date
      <= (now() at time zone coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'))::date
  then
    return jsonb_build_object('ok', false, 'code', 'same_day_disabled');
  end if;

  new_end_at := p_start_at + (booking_row.end_at - booking_row.start_at);

  begin
    perform public.perform_booking_reschedule(
      booking_row.id,
      p_start_at,
      new_end_at,
      actor_user_id,
      null,
      true
    );
  exception
    when others then
      return jsonb_build_object(
        'ok', false,
        'code', 'unavailable_slot',
        'message', sqlerrm
      );
  end;

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

revoke all on function public.reschedule_public_booking_by_manage_token(text, timestamptz)
from public;
grant execute on function public.reschedule_public_booking_by_manage_token(text, timestamptz)
to anon, authenticated;

create or replace function public.current_user_staff_id_for_line(
  target_booking_line_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff.id
  from public.booking_lines
  join public.staff
    on staff.id = booking_lines.assigned_staff_id
  where booking_lines.id = target_booking_line_id
    and staff.account_user_id = public.current_public_user_id()
    and staff.organization_id = booking_lines.organization_id
    and staff.salon_id = booking_lines.salon_id
    and staff.is_active = true
  limit 1
$$;

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
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
  line_row public.booking_lines%rowtype;
  note_value text;
begin
  actor_user_id := public.current_public_user_id();
  actor_staff_id := public.current_user_staff_id_for_line(p_booking_line_id);
  note_value := nullif(btrim(coalesce(p_service_note, '')), '');

  if actor_user_id is null or actor_staff_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select *
  into line_row
  from public.booking_lines
  where id = p_booking_line_id
  for update;

  if line_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = line_row.booking_id
  for update;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  if line_row.line_status in ('in_service', 'completed') then
    if note_value is not null and note_value is distinct from line_row.service_note then
      update public.booking_lines
      set
        service_note = note_value,
        line_status_updated_by_user_id = actor_user_id,
        updated_at = now()
      where id = line_row.id;

      insert into public.booking_status_events (
        organization_id,
        salon_id,
        booking_id,
        event_type,
        actor_user_id,
        actor_staff_id,
        actor_source,
        metadata
      )
      values (
        line_row.organization_id,
        line_row.salon_id,
        line_row.booking_id,
        'line_note_updated',
        actor_user_id,
        actor_staff_id,
        'staff',
        jsonb_build_object('booking_line_id', line_row.id)
      );
    end if;

    return jsonb_build_object('ok', true, 'booking_id', line_row.booking_id);
  end if;

  if public.normalize_booking_status(booking_row.status) = 'confirmed' then
    update public.bookings
    set status = 'checked_in', updated_by_user_id = actor_user_id, updated_at = now()
    where id = booking_row.id;
  end if;

  if public.normalize_booking_status(booking_row.status) in ('confirmed', 'checked_in') then
    update public.bookings
    set status = 'in_service', updated_by_user_id = actor_user_id, updated_at = now()
    where id = booking_row.id;
  end if;

  update public.booking_lines
  set
    line_status = 'in_service',
    started_at = coalesce(started_at, now()),
    performed_by_staff_id = coalesce(performed_by_staff_id, actor_staff_id),
    service_note = coalesce(note_value, service_note),
    line_status_updated_by_user_id = actor_user_id,
    updated_at = now()
  where id = line_row.id;

  insert into public.booking_status_events (
    organization_id,
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
    line_row.organization_id,
    line_row.salon_id,
    line_row.booking_id,
    'line_started',
    public.normalize_booking_status(booking_row.status),
    'in_service',
    actor_user_id,
    actor_staff_id,
    'staff',
    jsonb_build_object('booking_line_id', line_row.id)
  );

  return jsonb_build_object('ok', true, 'booking_id', line_row.booking_id);
end;
$$;

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
  actor_user_id uuid;
  active_remaining_count integer;
  booking_row public.bookings%rowtype;
  line_row public.booking_lines%rowtype;
  note_value text;
begin
  actor_user_id := public.current_public_user_id();
  actor_staff_id := public.current_user_staff_id_for_line(p_booking_line_id);
  note_value := nullif(btrim(coalesce(p_service_note, '')), '');

  if actor_user_id is null or actor_staff_id is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select *
  into line_row
  from public.booking_lines
  where id = p_booking_line_id
  for update;

  if line_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if line_row.line_status = 'completed' then
    return jsonb_build_object('ok', true, 'booking_id', line_row.booking_id);
  end if;

  select *
  into booking_row
  from public.bookings
  where id = line_row.booking_id
  for update;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  if line_row.line_status = 'scheduled' then
    perform public.start_assigned_booking_line(p_booking_line_id, note_value);
  elsif note_value is not null and note_value is distinct from line_row.service_note then
    update public.booking_lines
    set
      service_note = note_value,
      line_status_updated_by_user_id = actor_user_id,
      updated_at = now()
    where id = line_row.id;
  end if;

  update public.booking_lines
  set
    line_status = 'completed',
    started_at = coalesce(started_at, now()),
    completed_at = coalesce(completed_at, now()),
    performed_by_staff_id = coalesce(performed_by_staff_id, actor_staff_id),
    service_note = coalesce(note_value, service_note),
    line_status_updated_by_user_id = actor_user_id,
    updated_at = now()
  where id = line_row.id;

  insert into public.booking_status_events (
    organization_id,
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
    line_row.organization_id,
    line_row.salon_id,
    line_row.booking_id,
    'line_completed',
    public.normalize_booking_status(booking_row.status),
    public.normalize_booking_status(booking_row.status),
    actor_user_id,
    actor_staff_id,
    'staff',
    jsonb_build_object('booking_line_id', line_row.id)
  );

  select count(*)
  into active_remaining_count
  from public.booking_lines
  where booking_id = line_row.booking_id
    and line_status not in ('completed', 'skipped', 'cancelled');

  if active_remaining_count = 0 then
    update public.bookings
    set status = 'completed', updated_by_user_id = actor_user_id, updated_at = now()
    where id = line_row.booking_id
      and public.normalize_booking_status(status) not in ('completed', 'cancelled', 'no_show');
  else
    update public.bookings
    set status = 'in_service', updated_by_user_id = actor_user_id, updated_at = now()
    where id = line_row.booking_id
      and public.normalize_booking_status(status) in ('confirmed', 'checked_in');
  end if;

  return jsonb_build_object('ok', true, 'booking_id', line_row.booking_id);
end;
$$;

revoke all on function public.current_user_staff_id_for_line(uuid) from public, anon;
grant execute on function public.current_user_staff_id_for_line(uuid) to authenticated;

revoke all on function public.start_assigned_booking_line(uuid, text) from public, anon;
grant execute on function public.start_assigned_booking_line(uuid, text) to authenticated;

revoke all on function public.complete_assigned_booking_line(uuid, text) from public, anon;
grant execute on function public.complete_assigned_booking_line(uuid, text) to authenticated;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  salon_id uuid references public.locations(id) on delete cascade,
  recipient_user_id uuid not null references public.users(id) on delete cascade,
  recipient_kind text not null,
  notification_type text not null,
  source_table text not null default 'booking_status_events',
  source_event_id uuid references public.booking_status_events(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  booking_line_id uuid references public.booking_lines(id) on delete cascade,
  title text not null,
  body text,
  href text not null,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_notifications_recipient_kind_check check (
    recipient_kind in ('owner_manager', 'staff', 'customer')
  ),
  constraint app_notifications_type_not_blank check (length(btrim(notification_type)) > 0),
  constraint app_notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint app_notifications_href_not_blank check (length(btrim(href)) > 0)
);

create index if not exists app_notifications_recipient_unread_idx
on public.app_notifications(recipient_user_id, read_at, created_at desc);

create index if not exists app_notifications_booking_idx
on public.app_notifications(booking_id, created_at desc)
where booking_id is not null;

create unique index if not exists app_notifications_event_recipient_uidx
on public.app_notifications(
  recipient_user_id,
  notification_type,
  coalesce(source_event_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(booking_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(booking_line_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

drop trigger if exists update_app_notifications_updated_at
on public.app_notifications;

create trigger update_app_notifications_updated_at
before update on public.app_notifications
for each row
execute function public.update_updated_at_column();

alter table public.app_notifications enable row level security;

drop policy if exists "Users can view own app notifications"
on public.app_notifications;

create policy "Users can view own app notifications"
on public.app_notifications
for select
to authenticated
using (recipient_user_id = public.current_public_user_id());

drop policy if exists "Users can mark own app notifications"
on public.app_notifications;

create policy "Users can mark own app notifications"
on public.app_notifications
for update
to authenticated
using (recipient_user_id = public.current_public_user_id())
with check (recipient_user_id = public.current_public_user_id());

create or replace function public.insert_app_notification(
  p_recipient_user_id uuid,
  p_recipient_kind text,
  p_notification_type text,
  p_source_event_id uuid,
  p_booking_id uuid,
  p_booking_line_id uuid,
  p_organization_id uuid,
  p_salon_id uuid,
  p_title text,
  p_body text,
  p_href text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient_user_id is null then
    return;
  end if;

  insert into public.app_notifications (
    organization_id,
    salon_id,
    recipient_user_id,
    recipient_kind,
    notification_type,
    source_event_id,
    booking_id,
    booking_line_id,
    title,
    body,
    href,
    metadata
  )
  values (
    p_organization_id,
    p_salon_id,
    p_recipient_user_id,
    p_recipient_kind,
    p_notification_type,
    p_source_event_id,
    p_booking_id,
    p_booking_line_id,
    p_title,
    p_body,
    p_href,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing;
end;
$$;

create or replace function public.notify_booking_status_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assignment jsonb;
  booking_row public.bookings%rowtype;
  customer_title text;
  line_id uuid;
  owner_recipient record;
  staff_recipient record;
begin
  select *
  into booking_row
  from public.bookings
  where id = new.booking_id;

  if booking_row.id is null then
    return new;
  end if;

  line_id := nullif(new.metadata ->> 'booking_line_id', '')::uuid;

  for owner_recipient in
    select distinct organization_memberships.user_id
    from public.organization_memberships
    left join public.roles
      on roles.id = organization_memberships.role_id
    left join public.role_permissions
      on role_permissions.role_id = roles.id
    left join public.permissions
      on permissions.id = role_permissions.permission_id
    where organization_memberships.organization_id = new.organization_id
      and organization_memberships.status = 'active'
      and (
        organization_memberships.user_id = (
          select organizations.owner_user_id
          from public.organizations
          where organizations.id = new.organization_id
        )
        or permissions.code in ('booking.view', 'booking.manage')
      )
  loop
    if new.event_type in ('confirmation_requested', 'booking_created')
      and booking_row.source in ('public_profile', 'explore')
    then
      perform public.insert_app_notification(
        owner_recipient.user_id,
        'owner_manager',
        'booking_requested',
        new.id,
        new.booking_id,
        null,
        new.organization_id,
        new.salon_id,
        'New online booking',
        'A customer submitted an online appointment.',
        '/bookings?bookingId=' || new.booking_id::text,
        jsonb_build_object('source', booking_row.source)
      );
    elsif new.event_type in ('rescheduled', 'cancelled') then
      perform public.insert_app_notification(
        owner_recipient.user_id,
        'owner_manager',
        'booking_' || new.event_type,
        new.id,
        new.booking_id,
        null,
        new.organization_id,
        new.salon_id,
        case new.event_type
          when 'rescheduled' then 'Appointment rescheduled'
          else 'Appointment cancelled'
        end,
        'An appointment changed and may need review.',
        '/bookings?bookingId=' || new.booking_id::text,
        new.metadata
      );
    end if;
  end loop;

  if new.event_type in (
    'staff_assigned',
    'staff_reassigned',
    'confirmed',
    'rescheduled',
    'cancelled',
    'checked_in',
    'service_started',
    'line_started',
    'line_completed'
  ) then
    for staff_recipient in
      select distinct staff.account_user_id, staff.id as staff_id
      from public.booking_lines
      join public.staff
        on staff.id = booking_lines.assigned_staff_id
      where booking_lines.booking_id = new.booking_id
        and (line_id is null or booking_lines.id = line_id)
        and staff.account_user_id is not null
        and staff.is_active = true
    loop
      perform public.insert_app_notification(
        staff_recipient.account_user_id,
        'staff',
        case
          when new.event_type = 'staff_assigned' then 'booking_assigned'
          when new.event_type = 'staff_reassigned' then 'booking_reassigned'
          else 'booking_' || new.event_type
        end,
        new.id,
        new.booking_id,
        line_id,
        new.organization_id,
        new.salon_id,
        case
          when new.event_type in ('staff_assigned', 'staff_reassigned') then 'Appointment assigned'
          when new.event_type = 'rescheduled' then 'Appointment rescheduled'
          when new.event_type = 'cancelled' then 'Appointment cancelled'
          when new.event_type = 'checked_in' then 'Customer checked in'
          when new.event_type = 'line_started' then 'Service started'
          when new.event_type = 'line_completed' then 'Service completed'
          else 'Appointment update'
        end,
        'Open your schedule for details.',
        '/staff/appointments?bookingId=' || new.booking_id::text,
        new.metadata || jsonb_build_object('staff_id', staff_recipient.staff_id)
      );
    end loop;
  end if;

  if new.event_type = 'staff_reassigned'
    and jsonb_typeof(new.metadata -> 'line_assignments') = 'array'
  then
    for assignment in
      select value
      from jsonb_array_elements(new.metadata -> 'line_assignments')
    loop
      for staff_recipient in
        select staff.account_user_id, staff.id as staff_id
        from public.staff
        where staff.id = nullif(assignment ->> 'old_staff_id', '')::uuid
          and staff.account_user_id is not null
          and staff.is_active = true
      loop
        perform public.insert_app_notification(
          staff_recipient.account_user_id,
          'staff',
          'booking_reassigned_away',
          new.id,
          new.booking_id,
          nullif(assignment ->> 'booking_line_id', '')::uuid,
          new.organization_id,
          new.salon_id,
          'Appointment reassigned',
          'This appointment line moved off your schedule.',
          '/staff/appointments?bookingId=' || new.booking_id::text,
          new.metadata || jsonb_build_object('staff_id', staff_recipient.staff_id)
        );
      end loop;
    end loop;
  end if;

  if booking_row.customer_user_id is not null
    and new.event_type in ('confirmed', 'rescheduled', 'cancelled', 'completed')
  then
    customer_title := case new.event_type
      when 'confirmed' then 'Appointment confirmed'
      when 'rescheduled' then 'Appointment rescheduled'
      when 'cancelled' then 'Appointment cancelled'
      else 'Appointment completed'
    end;

    perform public.insert_app_notification(
      booking_row.customer_user_id,
      'customer',
      'booking_' || new.event_type,
      new.id,
      new.booking_id,
      null,
      new.organization_id,
      new.salon_id,
      customer_title,
      'Your appointment status changed.',
      '/notifications',
      jsonb_build_object('booking_id', new.booking_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_booking_status_event
on public.booking_status_events;

create trigger notify_booking_status_event
after insert on public.booking_status_events
for each row
execute function public.notify_booking_status_event();

grant select, update on table public.app_notifications to authenticated;
revoke all on table public.app_notifications from anon;

revoke all on function public.insert_app_notification(
  uuid,
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

revoke all on function public.notify_booking_status_event() from public, anon, authenticated;
