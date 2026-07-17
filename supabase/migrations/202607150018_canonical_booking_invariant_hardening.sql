-- Canonical Booking invariant hardening.
-- Keep historical rows untouched, but enforce staff-service eligibility and
-- normalize idempotency keys for new canonical booking mutations.

create or replace function public.prepare_booking_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  service_row public.services%rowtype;
begin
  select *
  into booking_row
  from public.bookings
  where bookings.id = new.booking_id;

  if booking_row.id is null then
    raise exception 'Booking line booking must exist.';
  end if;

  if new.organization_id is distinct from booking_row.organization_id
    or new.salon_id is distinct from booking_row.salon_id
  then
    raise exception 'Booking line must belong to the same salon as the booking.';
  end if;

  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.booking_id is distinct from old.booking_id
  ) then
    raise exception 'Booking line ownership fields cannot be changed.';
  end if;

  if new.service_id is not null then
    select *
    into service_row
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
      and services.is_active = true;

    if service_row.id is null then
      raise exception 'Booking line service must be active for this salon.';
    end if;

    new.service_name_snapshot := service_row.name;
    new.service_category_snapshot := service_row.category;
    new.service_description_snapshot := service_row.description;
    new.unit_price := service_row.base_price;
    new.duration_minutes := service_row.duration_minutes;
  end if;

  if new.parent_booking_line_id is not null and not exists (
    select 1
    from public.booking_lines parent_line
    where parent_line.id = new.parent_booking_line_id
      and parent_line.booking_id = new.booking_id
      and parent_line.organization_id = new.organization_id
      and parent_line.salon_id = new.salon_id
  ) then
    raise exception 'Booking add-on parent line must belong to the same booking.';
  end if;

  if (tg_op = 'INSERT' or new.assigned_staff_id is distinct from old.assigned_staff_id)
    and new.assigned_staff_id is not null
    and not exists (
      select 1
      from public.staff
      where staff.id = new.assigned_staff_id
        and staff.organization_id = new.organization_id
        and staff.salon_id = new.salon_id
        and staff.is_active = true
    )
  then
    raise exception 'Booking line staff must be active for this salon.';
  end if;

  if new.scheduled_start_at is null then
    new.scheduled_start_at := booking_row.start_at;
  end if;

  if new.scheduled_end_at is null then
    new.scheduled_end_at := booking_row.end_at;
  end if;

  if new.scheduled_start_at < booking_row.start_at
    or new.scheduled_end_at > booking_row.end_at
  then
    raise exception 'Booking line schedule must be inside the booking interval.';
  end if;

  if new.assigned_staff_id is not null
    and new.service_id is not null
    and not exists (
      select 1
      from public.staff_service_assignments
      where staff_service_assignments.organization_id = new.organization_id
        and staff_service_assignments.salon_id = new.salon_id
        and staff_service_assignments.staff_id = new.assigned_staff_id
        and staff_service_assignments.service_id = new.service_id
        and staff_service_assignments.is_active = true
        and (
          staff_service_assignments.effective_start_date is null
          or staff_service_assignments.effective_start_date <= new.scheduled_start_at::date
        )
        and (
          staff_service_assignments.effective_end_date is null
          or staff_service_assignments.effective_end_date >= new.scheduled_start_at::date
        )
    )
  then
    raise exception 'Booking line staff must be assigned to this service.';
  end if;

  return new;
end;
$$;

create or replace function public.create_canonical_booking(
  p_salon_id uuid,
  p_customer_id uuid,
  p_customer_user_id uuid default null,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null,
  p_status text default 'pending',
  p_source text default 'owner_manual',
  p_confirmation_mode text default 'request_confirmation',
  p_confirmation_status text default 'requested',
  p_public_notes text default null,
  p_internal_notes text default null,
  p_idempotency_key text default null,
  p_lines jsonb default '[]'::jsonb,
  p_actor_source text default 'system',
  p_overbooking_override_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_id uuid;
  line_row jsonb;
  line_service_id uuid;
  line_staff_id uuid;
  line_start_at timestamptz;
  line_end_at timestamptz;
  location_organization_id uuid;
  normalized_idempotency_key text;
  settings_row public.booking_settings%rowtype;
begin
  actor_user_id := public.current_public_user_id();
  normalized_idempotency_key := nullif(btrim(coalesce(p_idempotency_key, '')), '');

  select locations.organization_id
  into location_organization_id
  from public.locations
  where locations.id = p_salon_id
    and locations.status = 'active';

  if location_organization_id is null then
    raise exception 'Booking salon must be active.';
  end if;

  if actor_user_id is null then
    raise exception 'Authenticated booking creation requires a user. Guest booking must use a dedicated public RPC in a later phase.';
  end if;

  if not public.user_has_organization_permission(
    location_organization_id,
    array['booking.manage']::text[]
  ) then
    raise exception 'Missing required permission: booking.manage';
  end if;

  if p_start_at is null or p_end_at is null or p_end_at <= p_start_at then
    raise exception 'Booking requires a valid start and end interval.';
  end if;

  select *
  into settings_row
  from public.booking_settings
  where booking_settings.salon_id = p_salon_id;

  if normalized_idempotency_key is not null then
    select bookings.id
    into booking_id
    from public.bookings
    where bookings.salon_id = p_salon_id
      and bookings.idempotency_key = normalized_idempotency_key
    limit 1;

    if booking_id is not null then
      return booking_id;
    end if;
  end if;

  begin
    insert into public.bookings (
      organization_id,
      salon_id,
      customer_id,
      customer_user_id,
      start_at,
      end_at,
      status,
      source,
      confirmation_mode,
      confirmation_status,
      salon_timezone_snapshot,
      public_notes,
      internal_notes,
      idempotency_key,
      created_by_user_id,
      updated_by_user_id,
      cancellation_policy_snapshot
    )
    values (
      location_organization_id,
      p_salon_id,
      p_customer_id,
      p_customer_user_id,
      p_start_at,
      p_end_at,
      p_status,
      p_source,
      p_confirmation_mode,
      p_confirmation_status,
      coalesce(settings_row.timezone_iana, 'America/Chicago'),
      nullif(btrim(coalesce(p_public_notes, '')), ''),
      nullif(btrim(coalesce(p_internal_notes, '')), ''),
      normalized_idempotency_key,
      actor_user_id,
      actor_user_id,
      jsonb_build_object(
        'cancellation_window_minutes',
        coalesce(settings_row.cancellation_window_minutes, 1440)
      )
    )
    returning id into booking_id;
  exception
    when unique_violation then
      if normalized_idempotency_key is not null then
        select bookings.id
        into booking_id
        from public.bookings
        where bookings.salon_id = p_salon_id
          and bookings.idempotency_key = normalized_idempotency_key
        limit 1;

        if booking_id is not null then
          return booking_id;
        end if;
      end if;

      raise;
  end;

  if p_confirmation_status = 'requested' then
    insert into public.booking_status_events (
      organization_id,
      salon_id,
      booking_id,
      event_type,
      new_status,
      actor_user_id,
      actor_source
    )
    values (
      location_organization_id,
      p_salon_id,
      booking_id,
      'confirmation_requested',
      public.normalize_booking_status(p_status),
      actor_user_id,
      p_actor_source
    );
  end if;

  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'Booking lines payload must be an array.';
  end if;

  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'Canonical booking creation requires at least one booking line.';
  end if;

  for line_row in
    select value
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    line_service_id := nullif(line_row ->> 'service_id', '')::uuid;
    line_staff_id := nullif(line_row ->> 'assigned_staff_id', '')::uuid;
    line_start_at := coalesce(
      nullif(line_row ->> 'scheduled_start_at', '')::timestamptz,
      p_start_at
    );
    line_end_at := coalesce(
      nullif(line_row ->> 'scheduled_end_at', '')::timestamptz,
      p_end_at
    );

    insert into public.booking_lines (
      organization_id,
      salon_id,
      booking_id,
      parent_booking_line_id,
      line_type,
      service_id,
      service_name_snapshot,
      service_category_snapshot,
      service_description_snapshot,
      unit_price,
      quantity,
      duration_minutes,
      cleanup_buffer_minutes,
      display_order,
      assigned_staff_id,
      scheduled_start_at,
      scheduled_end_at,
      overbooking_override_reason,
      overbooking_override_by_user_id,
      overbooking_override_at
    )
    values (
      location_organization_id,
      p_salon_id,
      booking_id,
      nullif(line_row ->> 'parent_booking_line_id', '')::uuid,
      coalesce(nullif(line_row ->> 'line_type', ''), 'service'),
      line_service_id,
      coalesce(nullif(line_row ->> 'service_name_snapshot', ''), 'Pending service snapshot'),
      nullif(line_row ->> 'service_category_snapshot', ''),
      nullif(line_row ->> 'service_description_snapshot', ''),
      coalesce(nullif(line_row ->> 'unit_price', '')::numeric, 0),
      coalesce(nullif(line_row ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(line_row ->> 'duration_minutes', '')::integer, 1),
      coalesce(nullif(line_row ->> 'cleanup_buffer_minutes', '')::integer, 0),
      coalesce(nullif(line_row ->> 'display_order', '')::integer, 0),
      line_staff_id,
      line_start_at,
      line_end_at,
      nullif(btrim(coalesce(p_overbooking_override_reason, '')), ''),
      case
        when nullif(btrim(coalesce(p_overbooking_override_reason, '')), '') is null
        then null
        else actor_user_id
      end,
      case
        when nullif(btrim(coalesce(p_overbooking_override_reason, '')), '') is null
        then null
        else now()
      end
    );
  end loop;

  return booking_id;
end;
$$;

revoke all on function public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) from public, anon;
grant execute on function public.create_canonical_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
) to authenticated;
