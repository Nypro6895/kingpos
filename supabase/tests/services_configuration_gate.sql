begin;

do $$
declare
  actor_auth_user_id uuid;
  add_on_link_count integer;
  assignment_count integer;
  fixture_category text := '[E2E Services Gate]';
  fixture_service_a uuid;
  fixture_service_b uuid;
  fixture_service_c uuid;
  original_price numeric;
  result_payload jsonb;
  target_organization_id uuid;
  target_salon_id uuid;
  target_staff_id uuid;
begin
  select
    organizations.id,
    locations.id,
    owner_user.auth_user_id,
    staff.id
  into
    target_organization_id,
    target_salon_id,
    actor_auth_user_id,
    target_staff_id
  from public.organizations
  join public.users owner_user
    on owner_user.id = organizations.owner_user_id
  join public.locations
    on locations.organization_id = organizations.id
  join public.staff
    on staff.organization_id = organizations.id
    and staff.salon_id = locations.id
    and staff.is_active = true
  where owner_user.auth_user_id is not null
  order by organizations.created_at, locations.created_at, staff.created_at
  limit 1;

  if target_salon_id is null or actor_auth_user_id is null or target_staff_id is null then
    raise exception 'Services gate requires one owner salon with active staff.';
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  result_payload := public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'name', '[E2E Services Gate] Primary',
        'category', fixture_category,
        'description', 'Transaction-scoped fixture',
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', false,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', '[]'::jsonb
      ),
      jsonb_build_object(
        'name', '[E2E Services Gate] Add-on B',
        'category', fixture_category,
        'base_price', 15,
        'duration_minutes', 15,
        'is_active', true,
        'online_booking_enabled', false,
        'booking_staff_ids', '[]'::jsonb,
        'add_on_service_ids', '[]'::jsonb
      ),
      jsonb_build_object(
        'name', '[E2E Services Gate] Add-on C',
        'category', fixture_category,
        'base_price', 20,
        'duration_minutes', 20,
        'is_active', true,
        'online_booking_enabled', false,
        'booking_staff_ids', '[]'::jsonb,
        'add_on_service_ids', '[]'::jsonb
      )
    )
  );

  if coalesce((result_payload ->> 'ok')::boolean, false) is not true then
    raise exception 'Initial atomic service save failed.';
  end if;

  fixture_service_a := (result_payload -> 'service_ids' ->> 0)::uuid;
  fixture_service_b := (result_payload -> 'service_ids' ->> 1)::uuid;
  fixture_service_c := (result_payload -> 'service_ids' ->> 2)::uuid;

  update public.staff_service_assignments
  set
    custom_duration_minutes = 55,
    custom_price = 52
  where salon_id = target_salon_id
    and staff_id = target_staff_id
    and service_id = fixture_service_a;

  perform public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_a,
        'name', '[E2E Services Gate] Primary',
        'category', fixture_category,
        'description', 'Transaction-scoped fixture',
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', true,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', jsonb_build_array(fixture_service_b)
      )
    )
  );

  if not exists (
    select 1
    from public.staff_service_assignments
    where salon_id = target_salon_id
      and staff_id = target_staff_id
      and service_id = fixture_service_a
      and is_active = true
      and online_bookable = true
      and custom_duration_minutes = 55
      and custom_price = 52
  ) then
    raise exception 'Booking staff save did not preserve custom overrides.';
  end if;

  perform public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_a,
        'name', '[E2E Services Gate] Primary',
        'category', fixture_category,
        'description', 'Transaction-scoped fixture',
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', true,
        'booking_staff_ids', '[]'::jsonb,
        'add_on_service_ids', jsonb_build_array(fixture_service_b)
      )
    )
  );

  if not exists (
    select 1
    from public.staff_service_assignments
    where salon_id = target_salon_id
      and staff_id = target_staff_id
      and service_id = fixture_service_a
      and is_active = false
      and online_bookable = false
      and custom_duration_minutes = 55
      and custom_price = 52
  ) then
    raise exception 'Deselecting Booking staff removed its custom overrides.';
  end if;

  perform public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_a,
        'name', '[E2E Services Gate] Primary',
        'category', fixture_category,
        'description', 'Transaction-scoped fixture',
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', true,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', jsonb_build_array(fixture_service_b)
      )
    )
  );

  if not exists (
    select 1
    from public.staff_service_assignments
    where salon_id = target_salon_id
      and staff_id = target_staff_id
      and service_id = fixture_service_a
      and is_active = true
      and online_bookable = true
      and custom_duration_minutes = 55
      and custom_price = 52
  ) then
    raise exception 'Reselecting Booking staff did not restore preserved overrides.';
  end if;

  perform public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_a,
        'name', '[E2E Services Gate] Primary',
        'category', fixture_category,
        'description', 'Transaction-scoped fixture',
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', false,
        'online_booking_enabled', true,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', jsonb_build_array(fixture_service_b)
      )
    )
  );

  if exists (
    select 1
    from public.services
    where id = fixture_service_a
      and online_booking_enabled = true
  ) then
    raise exception 'Deactivating a service did not turn online booking off.';
  end if;

  select count(*)
  into assignment_count
  from public.staff_service_assignments
  where salon_id = target_salon_id
    and staff_id = target_staff_id
    and service_id = fixture_service_a
    and is_active = true
    and online_bookable = true;

  select count(*)
  into add_on_link_count
  from public.service_add_on_links
  where salon_id = target_salon_id
    and parent_service_id = fixture_service_a
    and add_on_service_id = fixture_service_b
    and is_active = true;

  if assignment_count <> 1 or add_on_link_count <> 1 then
    raise exception 'Deactivation removed booking staff or add-on configuration.';
  end if;

  perform public.save_service_config_batch(
    target_salon_id,
    jsonb_build_array(
      jsonb_build_object(
        'service_id', fixture_service_a,
        'name', '[E2E Services Gate] Primary',
        'category', fixture_category,
        'description', 'Transaction-scoped fixture',
        'base_price', 45,
        'duration_minutes', 45,
        'is_active', true,
        'online_booking_enabled', false,
        'booking_staff_ids', jsonb_build_array(target_staff_id),
        'add_on_service_ids', jsonb_build_array(fixture_service_b)
      ),
      jsonb_build_object(
        'service_id', fixture_service_b,
        'name', '[E2E Services Gate] Add-on B',
        'category', fixture_category,
        'base_price', 15,
        'duration_minutes', 15,
        'is_active', true,
        'online_booking_enabled', false,
        'booking_staff_ids', '[]'::jsonb,
        'add_on_service_ids', jsonb_build_array(fixture_service_c)
      )
    )
  );

  if exists (
    select 1
    from public.services
    where id = fixture_service_a
      and online_booking_enabled = true
  ) then
    raise exception 'Reactivating a service unexpectedly restored online booking.';
  end if;

  begin
    perform public.save_service_config_batch(
      target_salon_id,
      jsonb_build_array(
        jsonb_build_object(
          'service_id', fixture_service_c,
          'name', '[E2E Services Gate] Add-on C',
          'category', fixture_category,
          'base_price', 20,
          'duration_minutes', 20,
          'is_active', true,
          'online_booking_enabled', false,
          'booking_staff_ids', '[]'::jsonb,
          'add_on_service_ids', jsonb_build_array(fixture_service_a)
        )
      )
    );
    raise exception 'Circular add-on relationship was accepted.';
  exception
    when others then
      if sqlerrm not like '%circular relationship%' then
        raise;
      end if;
  end;

  select base_price
  into original_price
  from public.services
  where id = fixture_service_a;

  begin
    perform public.save_service_config_batch(
      target_salon_id,
      jsonb_build_array(
        jsonb_build_object(
          'service_id', fixture_service_a,
          'name', '[E2E Services Gate] Primary',
          'category', fixture_category,
          'base_price', 999,
          'duration_minutes', 45,
          'is_active', true,
          'online_booking_enabled', false,
          'booking_staff_ids', jsonb_build_array(target_staff_id),
          'add_on_service_ids', jsonb_build_array(fixture_service_b)
        ),
        jsonb_build_object(
          'name', '[E2E Services Gate] Invalid',
          'category', fixture_category,
          'base_price', -1,
          'duration_minutes', 15,
          'is_active', true,
          'online_booking_enabled', false,
          'booking_staff_ids', '[]'::jsonb,
          'add_on_service_ids', '[]'::jsonb
        )
      )
    );
    raise exception 'Invalid batch was accepted.';
  exception
    when others then
      if sqlerrm not like '%price must be zero or greater%' then
        raise;
      end if;
  end;

  if (
    select base_price
    from public.services
    where id = fixture_service_a
  ) is distinct from original_price then
    raise exception 'Failed batch partially saved a valid service.';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

  begin
    perform public.save_service_config_batch(
      target_salon_id,
      jsonb_build_array(
        jsonb_build_object(
          'service_id', fixture_service_a,
          'name', '[E2E Services Gate] Primary',
          'category', fixture_category,
          'base_price', 45,
          'duration_minutes', 45,
          'is_active', true,
          'online_booking_enabled', false,
          'booking_staff_ids', jsonb_build_array(target_staff_id),
          'add_on_service_ids', jsonb_build_array(fixture_service_b)
        )
      )
    );
    raise exception 'Unauthorized service save was accepted.';
  exception
    when others then
      if sqlerrm not like '%Sign in before managing services%' then
        raise;
      end if;
  end;

  raise notice 'Services configuration gate passed with rollback-only fixtures.';
end;
$$;

rollback;
