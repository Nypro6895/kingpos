-- Canonical online service eligibility and booking snapshots.
-- Online assignments affect public booking only; owner/manual operations keep
-- using active salon services and active salon staff without capability maps.

create or replace function public.prepare_booking_line()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  assignment_row public.staff_service_assignments%rowtype;
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

  if new.service_id is not null
    and (
      tg_op = 'INSERT'
      or new.service_id is distinct from old.service_id
    )
  then
    select *
    into service_row
    from public.services
    where services.id = new.service_id
      and services.organization_id = new.organization_id
      and services.salon_id = new.salon_id
      and services.is_active = true
      and (
        booking_row.source not in ('public_profile', 'explore')
        or services.online_booking_enabled = true
      );

    if service_row.id is null then
      raise exception 'Booking line service must be active for this salon.';
    end if;

    new.service_name_snapshot := service_row.name;
    new.service_category_snapshot := service_row.category;
    new.service_description_snapshot := service_row.description;
    new.unit_price := service_row.base_price;
    new.duration_minutes := service_row.duration_minutes;

    if booking_row.source in ('public_profile', 'explore')
      and new.assigned_staff_id is not null
    then
      select *
      into assignment_row
      from public.staff_service_assignments
      where staff_service_assignments.organization_id = new.organization_id
        and staff_service_assignments.salon_id = new.salon_id
        and staff_service_assignments.staff_id = new.assigned_staff_id
        and staff_service_assignments.service_id = new.service_id
        and staff_service_assignments.is_active = true
        and staff_service_assignments.online_bookable = true
      limit 1;

      if assignment_row.id is not null then
        new.unit_price := coalesce(
          assignment_row.custom_price,
          service_row.base_price
        );
        new.duration_minutes := coalesce(
          assignment_row.custom_duration_minutes,
          service_row.duration_minutes
        );
      end if;
    end if;
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

  return new;
end;
$$;

do $$
declare
  function_definition text;
  original_definition text;
begin
  select pg_get_functiondef(
    'public.get_public_booking_context(uuid,timestamptz,timestamptz)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'get_public_booking_context function is missing.';
  end if;

  original_definition := function_definition;
  function_definition := replace(
    function_definition,
    $needle$        and services.is_active = true
        and is_public$needle$,
    $replacement$        and services.is_active = true
        and services.online_booking_enabled = true
        and is_public$replacement$
  );
  function_definition := replace(
    function_definition,
    '        and parent_services.is_active = true',
    E'        and parent_services.is_active = true\n        and parent_services.online_booking_enabled = true'
  );
  function_definition := replace(
    function_definition,
    '        and add_on_services.is_active = true',
    E'        and add_on_services.is_active = true\n        and add_on_services.online_booking_enabled = true'
  );
  function_definition := replace(
    function_definition,
    $needle$        and services.is_active = true
      where assignments.salon_id$needle$,
    $replacement$        and services.is_active = true
        and services.online_booking_enabled = true
      where assignments.salon_id$replacement$
  );

  if function_definition = original_definition
    or function_definition not like '%services.online_booking_enabled = true%'
    or function_definition not like '%add_on_services.online_booking_enabled = true%'
  then
    raise exception 'get_public_booking_context online eligibility patch failed.';
  end if;

  execute function_definition;
end;
$$;

do $$
declare
  function_definition text;
  original_definition text;
begin
  select pg_get_functiondef(
    'public.create_public_booking(uuid,timestamptz,timestamptz,text,text,text,text,text,text,text,text,uuid,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'create_public_booking function is missing.';
  end if;

  original_definition := function_definition;
  function_definition := replace(
    function_definition,
    '  service_row public.services%rowtype;',
    E'  service_row public.services%rowtype;\n  assignment_row public.staff_service_assignments%rowtype;\n  cleanup_buffer_minutes_value integer;'
  );
  function_definition := replace(
    function_definition,
    '      and services.is_active = true;',
    E'      and services.is_active = true\n      and services.online_booking_enabled = true;'
  );
  function_definition := replace(
    function_definition,
    $needle$    line_end_at := nullif(line_row ->> 'scheduled_end_at', '')::timestamptz;

    if line_service_id is null or line_staff_id is null then$needle$,
    $replacement$    line_end_at := nullif(line_row ->> 'scheduled_end_at', '')::timestamptz;
    cleanup_buffer_minutes_value :=
      coalesce(nullif(line_row ->> 'cleanup_buffer_minutes', '')::integer, 0);

    if line_service_id is null or line_staff_id is null then$replacement$
  );
  function_definition := replace(
    function_definition,
    $needle$    if not exists (
      select 1
      from public.staff
      join public.staff_service_assignments assignments
        on assignments.staff_id = staff.id
        and assignments.salon_id = staff.salon_id
        and assignments.organization_id = staff.organization_id
      where staff.id = line_staff_id
        and staff.salon_id = p_salon_id
        and staff.organization_id = location_organization_id
        and staff.is_active = true
        and staff.public_profile_visible = true
        and staff.owner_public_enabled = true
        and staff.staff_public_consent_status = 'granted'
        and staff.online_booking_enabled = true
        and assignments.service_id = line_service_id
        and assignments.is_active = true
        and assignments.online_bookable = true
    ) then
      raise exception 'Selected professional is not available for this service.';
    end if;$needle$,
    $replacement$    select assignments.*
    into assignment_row
    from public.staff_service_assignments assignments
    join public.staff
      on staff.id = assignments.staff_id
      and staff.salon_id = assignments.salon_id
      and staff.organization_id = assignments.organization_id
    where staff.id = line_staff_id
      and staff.salon_id = p_salon_id
      and staff.organization_id = location_organization_id
      and staff.is_active = true
      and staff.public_profile_visible = true
      and staff.owner_public_enabled = true
      and staff.staff_public_consent_status = 'granted'
      and staff.online_booking_enabled = true
      and assignments.service_id = line_service_id
      and assignments.is_active = true
      and assignments.online_bookable = true
    limit 1;

    if assignment_row.id is null then
      raise exception 'Selected professional is not available for this service.';
    end if;$replacement$
  );
  function_definition := replace(
    function_definition,
    $needle$    if line_start_at is null
      or line_end_at is null
      or line_end_at <= line_start_at
      or line_start_at < p_start_at
      or line_end_at > p_end_at
    then$needle$,
    $replacement$    if line_start_at is null
      or line_end_at is null
      or line_end_at <= line_start_at
      or line_start_at < p_start_at
      or line_end_at > p_end_at
      or cleanup_buffer_minutes_value < 0
      or line_end_at <> line_start_at + make_interval(
        mins => coalesce(
          assignment_row.custom_duration_minutes,
          service_row.duration_minutes
        ) + cleanup_buffer_minutes_value
      )
    then$replacement$
  );
  function_definition := replace(
    function_definition,
    '''unit_price'', service_row.base_price,',
    '''unit_price'', coalesce(assignment_row.custom_price, service_row.base_price),'
  );
  function_definition := replace(
    function_definition,
    '''duration_minutes'', service_row.duration_minutes,',
    '''duration_minutes'', coalesce(assignment_row.custom_duration_minutes, service_row.duration_minutes),'
  );
  function_definition := replace(
    function_definition,
    '''cleanup_buffer_minutes'', coalesce(nullif(line_row ->> ''cleanup_buffer_minutes'', '''')::integer, 0),',
    '''cleanup_buffer_minutes'', cleanup_buffer_minutes_value,'
  );

  if function_definition = original_definition
    or function_definition not like '%assignment_row.custom_price%'
    or function_definition not like '%services.online_booking_enabled = true%'
    or function_definition not like '%cleanup_buffer_minutes_value%'
  then
    raise exception 'create_public_booking effective snapshot patch failed.';
  end if;

  execute function_definition;
end;
$$;

drop function if exists public.get_public_salon_profile_services(uuid);

create function public.get_public_salon_profile_services(target_salon_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  base_price numeric,
  duration_minutes integer,
  description text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    services.id,
    services.name,
    services.category,
    services.base_price,
    services.duration_minutes,
    services.description
  from public.services
  where services.salon_id = target_salon_id
    and services.is_active = true
    and services.online_booking_enabled = true
    and public.salon_profile_public_salon_exists(target_salon_id)
  order by
    services.category asc nulls last,
    services.name asc;
$$;

revoke all on function public.get_public_salon_profile_services(uuid)
from public;
grant execute on function public.get_public_salon_profile_services(uuid)
to anon, authenticated;

create or replace function public.get_public_explore_decision_signals(
  target_salon_ids uuid[]
)
returns table (
  salon_id uuid,
  average_rating numeric,
  review_count bigint,
  booking_enabled boolean,
  bookable_service_id uuid,
  bookable_service_name text,
  next_available_at timestamptz,
  next_availability_label text,
  booking_href text
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_salons as (
    select distinct requested_ids.salon_id
    from unnest(coalesce(target_salon_ids, array[]::uuid[])) as requested_ids(salon_id)
    where requested_ids.salon_id is not null
  ),
  ready as (
    select
      requested_salons.salon_id,
      services.id as service_id,
      services.name as service_name,
      (
        public.salon_profile_public_salon_exists(requested_salons.salon_id)
        and coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and exists (
          select 1
          from public.staff_service_assignments assignments
          join public.staff
            on staff.id = assignments.staff_id
          where assignments.salon_id = requested_salons.salon_id
            and assignments.service_id = services.id
            and assignments.is_active = true
            and assignments.online_bookable = true
            and staff.is_active = true
            and staff.public_profile_visible = true
            and staff.owner_public_enabled = true
            and staff.staff_public_consent_status = 'granted'
            and staff.online_booking_enabled = true
        )
        and exists (
          select 1
          from public.staff_availability_rules rules
          where rules.salon_id = requested_salons.salon_id
            and rules.is_active = true
            and rules.rule_type = 'working'
            and (
              rules.staff_id is null
              or exists (
                select 1
                from public.staff_service_assignments assignments
                join public.staff
                  on staff.id = assignments.staff_id
                where assignments.salon_id = requested_salons.salon_id
                  and assignments.service_id = services.id
                  and assignments.staff_id = rules.staff_id
                  and assignments.is_active = true
                  and assignments.online_bookable = true
                  and staff.is_active = true
                  and staff.public_profile_visible = true
                  and staff.owner_public_enabled = true
                  and staff.staff_public_consent_status = 'granted'
                  and staff.online_booking_enabled = true
              )
            )
        )
      ) as is_ready
    from requested_salons
    left join public.booking_settings
      on booking_settings.salon_id = requested_salons.salon_id
    left join lateral (
      select services.id, services.name
      from public.services
      where services.salon_id = requested_salons.salon_id
        and services.is_active = true
        and services.online_booking_enabled = true
      order by services.name
      limit 1
    ) services on true
  )
  select
    requested_salons.salon_id,
    reviews.average_rating,
    coalesce(reviews.review_count, 0)::bigint as review_count,
    coalesce(ready.is_ready, false) as booking_enabled,
    case when ready.is_ready then ready.service_id else null end as bookable_service_id,
    case when ready.is_ready then ready.service_name else null end as bookable_service_name,
    null::timestamptz as next_available_at,
    case when ready.is_ready then 'Online booking' else null end as next_availability_label,
    case
      when ready.is_ready
      then '/book/' || requested_salons.salon_id::text || '?source=explore'
        || case when ready.service_id is not null then '&serviceId=' || ready.service_id::text else '' end
      else null
    end as booking_href
  from requested_salons
  left join ready
    on ready.salon_id = requested_salons.salon_id
  left join lateral public.get_public_salon_profile_review_summary(
    requested_salons.salon_id
  ) reviews
    on true
  where public.salon_profile_public_salon_exists(requested_salons.salon_id);
$$;

revoke all on function public.get_public_explore_decision_signals(uuid[])
from public;
grant execute on function public.get_public_explore_decision_signals(uuid[])
to anon, authenticated;
