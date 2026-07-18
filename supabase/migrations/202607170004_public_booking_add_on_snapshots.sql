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
    E'AS $function$\ndeclare',
    E'AS $function$\n#variable_conflict use_variable\ndeclare'
  );
  function_definition := replace(
    function_definition,
    $needle$'parent_booking_line_id', null,$needle$,
    $replacement$'parent_booking_line_id', null,
      'parent_service_id', line_parent_service_id,$replacement$
  );
  function_definition := replace(
    function_definition,
    $needle$nullif(line_row ->> 'parent_booking_line_id', '')::uuid,$needle$,
    $replacement$case
        when coalesce(nullif(line_row ->> 'line_type', ''), 'service') = 'add_on'
        then (
          select parent_line.id
          from public.booking_lines parent_line
          where parent_line.booking_id = booking_id
            and parent_line.organization_id = location_organization_id
            and parent_line.salon_id = p_salon_id
            and parent_line.line_type = 'service'
            and parent_line.service_id =
              nullif(line_row ->> 'parent_service_id', '')::uuid
          order by parent_line.display_order, parent_line.created_at
          limit 1
        )
        else null
      end,$replacement$
  );

  if function_definition = original_definition
    or function_definition not like '%''parent_service_id'', line_parent_service_id%'
    or function_definition not like '%#variable_conflict use_variable%'
    or function_definition not like '%parent_line.booking_id = booking_id%'
  then
    raise exception 'create_public_booking add-on parent snapshot patch failed.';
  end if;

  execute function_definition;
end;
$$;

create or replace function public.get_public_booking_by_manage_token(raw_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'ok', true,
      'booking',
      jsonb_build_object(
        'id', bookings.id,
        'salon_id', bookings.salon_id,
        'status', public.normalize_booking_status(bookings.status),
        'confirmation_status', bookings.confirmation_status,
        'source', bookings.source,
        'start_at', bookings.start_at,
        'end_at', bookings.end_at,
        'timezone', bookings.salon_timezone_snapshot,
        'public_notes', bookings.public_notes,
        'cancellation_reason', bookings.cancellation_reason,
        'cancelled_at', bookings.cancelled_at,
        'can_change',
          public.normalize_booking_status(bookings.status)
            not in ('completed', 'cancelled', 'no_show')
          and bookings.start_at > now(),
        'cancellation_window_minutes',
          coalesce(
            (bookings.cancellation_policy_snapshot
              ->> 'cancellation_window_minutes')::integer,
            1440
          )
      ),
      'salon',
      jsonb_build_object(
        'name',
          coalesce(nullif(btrim(salon_settings.business_name), ''), locations.name),
        'phone', coalesce(nullif(btrim(salon_settings.phone), ''), locations.phone),
        'address_line1',
          coalesce(
            nullif(btrim(salon_settings.address_line1), ''),
            locations.address_line1
          ),
        'city', coalesce(nullif(btrim(salon_settings.city), ''), locations.city),
        'state', coalesce(nullif(btrim(salon_settings.state), ''), locations.state),
        'timezone', bookings.salon_timezone_snapshot
      ),
      'customer',
      jsonb_build_object(
        'name', customers.name,
        'phone', customers.phone,
        'email', customers.email
      ),
      'lines',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', booking_lines.id,
            'line_type', booking_lines.line_type,
            'parent_service_id', parent_lines.service_id,
            'service_id', booking_lines.service_id,
            'service_name', booking_lines.service_name_snapshot,
            'category', booking_lines.service_category_snapshot,
            'unit_price', booking_lines.unit_price,
            'duration_minutes', booking_lines.duration_minutes,
            'line_total', booking_lines.line_total,
            'scheduled_start_at', booking_lines.scheduled_start_at,
            'scheduled_end_at', booking_lines.scheduled_end_at,
            'staff_id', booking_lines.assigned_staff_id,
            'staff_name', staff.display_name,
            'staff_avatar_path',
              nullif(btrim(staff.public_profile_photo_path), '')
          )
          order by booking_lines.display_order
        )
        from public.booking_lines
        left join public.booking_lines parent_lines
          on parent_lines.id = booking_lines.parent_booking_line_id
          and parent_lines.booking_id = booking_lines.booking_id
        left join public.staff
          on staff.id = booking_lines.assigned_staff_id
        where booking_lines.booking_id = bookings.id
      ), '[]'::jsonb)
    )
    from public.bookings
    join public.locations
      on locations.id = bookings.salon_id
    left join public.salon_settings
      on salon_settings.salon_id = bookings.salon_id
      and salon_settings.organization_id = bookings.organization_id
    join public.customers
      on customers.id = bookings.customer_id
    where bookings.customer_cancellation_token_hash =
      public.public_booking_token_hash(raw_token)
    limit 1
  ), jsonb_build_object('ok', false, 'code', 'invalid_token'))
$$;

revoke all on function public.get_public_booking_by_manage_token(text) from public;
grant execute on function public.get_public_booking_by_manage_token(text)
to anon, authenticated;
