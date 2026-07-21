begin;

do $$
declare
  actor_auth_user_id uuid;
  actor_user_id uuid;
  booking_visible_count integer;
  claim_payload jsonb;
  claim_row_count integer;
  fixture_booking_id uuid;
  fixture_customer_id uuid;
  fixture_line_id uuid;
  fixture_raw_token text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  local_fixture_date date := current_date + 90;
  original_start_at timestamptz;
  other_auth_user_id uuid;
  other_claim_count integer;
  other_user_id uuid;
  permission_denied boolean := false;
  reschedule_payload jsonb;
  target_organization_id uuid;
  target_salon_id uuid;
  target_staff_id uuid;
  timezone_value text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name = 'customer_account_linked_at'
  ) then
    raise exception 'Customer booking identity migration is not applied.';
  end if;

  if to_regclass('public.booking_customer_account_claims') is null then
    raise exception 'booking_customer_account_claims table is missing.';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookings'
      and column_name in (
        'customer_account_linked_at',
        'customer_account_linked_by_user_id',
        'customer_account_link_method',
        'customer_account_link_metadata'
      )
  ) <> 4 then
    raise exception 'One or more booking identity columns are missing.';
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'bookings'
      and constraint_name = 'bookings_customer_account_link_method_check'
  ) then
    raise exception 'Booking account link method constraint is missing.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.bookings'::regclass
      and tgname = 'prepare_booking_customer_account_link'
      and not tgisinternal
  ) then
    raise exception 'Booking account link trigger is missing.';
  end if;

  if (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'bookings_customer_user_start_idx',
        'bookings_customer_account_linked_at_idx',
        'booking_customer_account_claims_user_method_uidx',
        'booking_customer_account_claims_user_created_idx',
        'booking_customer_account_claims_salon_created_idx'
      )
  ) <> 5 then
    raise exception 'One or more customer booking identity indexes are missing.';
  end if;

  if (
    select count(*)
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname in (
        'prepare_booking_customer_account_link',
        'claim_guest_booking_by_manage_token',
        'cancel_customer_booking',
        'reschedule_customer_booking'
      )
  ) <> 4 then
    raise exception 'One or more customer booking identity functions are missing.';
  end if;

  if exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname in (
        'claim_guest_booking_by_manage_token',
        'cancel_customer_booking',
        'reschedule_customer_booking'
      )
      and pg_proc.prosecdef is not true
  ) then
    raise exception 'Customer booking identity RPCs must be security definer.';
  end if;

  if (
    select relrowsecurity
    from pg_class
    where oid = 'public.booking_customer_account_claims'::regclass
  ) is not true then
    raise exception 'Claim audit table RLS is not enabled.';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'booking_customer_account_claims'
      and policyname in (
        'Customers can view own booking account claims',
        'Booking managers can view booking account claims'
      )
  ) <> 2 then
    raise exception 'Claim audit RLS policies are missing.';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'bookings'
      and policyname = 'Booking participants can view bookings'
  ) then
    raise exception 'Booking participant RLS policy is missing.';
  end if;

  if has_table_privilege('anon', 'public.booking_customer_account_claims', 'select') then
    raise exception 'Anon can select claim audit rows.';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.booking_customer_account_claims',
    'select'
  ) then
    raise exception 'Authenticated cannot select own claim audit rows.';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_guest_booking_by_manage_token(text)',
    'execute'
  ) then
    raise exception 'Anon can execute claim_guest_booking_by_manage_token.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.claim_guest_booking_by_manage_token(text)',
    'execute'
  ) or not has_function_privilege(
    'authenticated',
    'public.cancel_customer_booking(uuid,text)',
    'execute'
  ) or not has_function_privilege(
    'authenticated',
    'public.reschedule_customer_booking(uuid,timestamp with time zone)',
    'execute'
  ) then
    raise exception 'Authenticated customer booking RPC grants are missing.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.prepare_booking_customer_account_link()',
    'execute'
  ) then
    raise exception 'Authenticated can execute internal booking account link trigger function.';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '202607180001'
  ) then
    raise exception 'Hosted migration history is missing 202607180001.';
  end if;

  select
    organizations.id,
    locations.id,
    staff.id,
    coalesce(booking_settings.timezone_iana, 'America/Chicago')
  into
    target_organization_id,
    target_salon_id,
    target_staff_id,
    timezone_value
  from public.organizations
  join public.users owner_user
    on owner_user.id = organizations.owner_user_id
  join public.locations
    on locations.organization_id = organizations.id
    and locations.status = 'active'
  join public.staff
    on staff.organization_id = organizations.id
    and staff.salon_id = locations.id
  join public.booking_settings
    on booking_settings.organization_id = organizations.id
    and booking_settings.salon_id = locations.id
  where owner_user.auth_user_id is not null
    and owner_user.status <> 'deleted'
    and public.salon_profile_public_salon_exists(locations.id)
  order by organizations.created_at, locations.created_at, staff.created_at
  limit 1;

  if target_salon_id is null
    or target_staff_id is null
  then
    raise exception 'Customer booking identity gate requires one public salon with staff and owner auth user.';
  end if;

  actor_auth_user_id := gen_random_uuid();
  other_auth_user_id := gen_random_uuid();

  insert into auth.users (
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values
    (
      actor_auth_user_id,
      'authenticated',
      'authenticated',
      'identity-gate-customer@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Identity Gate Customer"}'::jsonb,
      now(),
      now()
    ),
    (
      other_auth_user_id,
      'authenticated',
      'authenticated',
      'identity-gate-other@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Identity Gate Other"}'::jsonb,
      now(),
      now()
    );

  insert into public.users (
    auth_user_id,
    email,
    display_name,
    status
  )
  values (
    actor_auth_user_id,
    'identity-gate-customer@example.test',
    'Identity Gate Customer',
    'active'
  )
  on conflict (auth_user_id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status
  returning id into actor_user_id;

  insert into public.users (
    auth_user_id,
    email,
    display_name,
    status
  )
  values (
    other_auth_user_id,
    'identity-gate-other@example.test',
    'Identity Gate Other',
    'active'
  )
  on conflict (auth_user_id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status
  returning id into other_user_id;

  update public.booking_settings
  set
    booking_enabled = true,
    online_booking_visible = true,
    guest_booking_enabled = true,
    minimum_lead_time_minutes = 0,
    maximum_advance_window_days = 365,
    same_day_booking_enabled = true,
    timezone_iana = timezone_value
  where salon_id = target_salon_id
    and organization_id = target_organization_id;

  update public.staff
  set
    is_active = true,
    online_booking_enabled = true,
    owner_public_enabled = true,
    public_profile_visible = true,
    staff_public_consent_status = 'granted'
  where id = target_staff_id
    and salon_id = target_salon_id
    and organization_id = target_organization_id;

  original_start_at :=
    (local_fixture_date::text || ' 10:00:00')::timestamp
      at time zone timezone_value;

  update public.staff_time_blocks
  set is_active = false
  where salon_id = target_salon_id
    and organization_id = target_organization_id
    and (staff_id is null or staff_id = target_staff_id)
    and starts_at < original_start_at + interval '8 hours'
    and ends_at > original_start_at - interval '1 hour';

  insert into public.staff_availability_rules (
    organization_id,
    salon_id,
    staff_id,
    rule_type,
    day_of_week,
    starts_at_local,
    ends_at_local,
    timezone_iana,
    effective_start_date,
    effective_end_date,
    is_active
  )
  values (
    target_organization_id,
    target_salon_id,
    target_staff_id,
    'working',
    extract(dow from local_fixture_date)::integer,
    '09:00',
    '20:00',
    timezone_value,
    local_fixture_date,
    local_fixture_date,
    true
  );

  insert into public.customers (
    location_id,
    name,
    phone,
    email,
    status
  )
  values (
    target_salon_id,
    '[E2E Identity Gate] Guest',
    '1555010101',
    'identity-gate@example.test',
    'active'
  )
  returning id into fixture_customer_id;

  insert into public.bookings (
    organization_id,
    salon_id,
    customer_id,
    customer_user_id,
    staff_id,
    start_at,
    end_at,
    status,
    source,
    confirmation_mode,
    confirmation_status,
    salon_timezone_snapshot,
    customer_cancellation_token_hash,
    idempotency_key,
    payment_status,
    cancellation_policy_snapshot
  )
  values (
    target_organization_id,
    target_salon_id,
    fixture_customer_id,
    null,
    target_staff_id,
    original_start_at,
    original_start_at + interval '45 minutes',
    'confirmed',
    'public_profile',
    'instant_booking',
    'confirmed',
    timezone_value,
    public.public_booking_token_hash(fixture_raw_token),
    '[E2E Identity Gate] guest claim',
    'not_required',
    '{}'::jsonb
  )
  returning id into fixture_booking_id;

  insert into public.booking_lines (
    organization_id,
    salon_id,
    booking_id,
    line_type,
    service_name_snapshot,
    unit_price,
    quantity,
    duration_minutes,
    cleanup_buffer_minutes,
    display_order,
    assigned_staff_id,
    scheduled_start_at,
    scheduled_end_at
  )
  values (
    target_organization_id,
    target_salon_id,
    fixture_booking_id,
    'custom',
    '[E2E Identity Gate] Service',
    1,
    1,
    45,
    0,
    0,
    target_staff_id,
    original_start_at,
    original_start_at + interval '45 minutes'
  )
  returning id into fixture_line_id;

  if fixture_line_id is null then
    raise exception 'Identity gate failed to create a booking line.';
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*)
  into booking_visible_count
  from public.bookings
  where id = fixture_booking_id;
  execute 'reset role';

  if booking_visible_count <> 0 then
    raise exception 'Guest booking is visible to an unrelated authenticated customer before claim.';
  end if;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  claim_payload := public.claim_guest_booking_by_manage_token(fixture_raw_token);

  if coalesce((claim_payload ->> 'ok')::boolean, false) is true
    or claim_payload ->> 'code' <> 'sign_in_required'
  then
    raise exception 'Claim RPC did not reject an auth subject without a public user.';
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  claim_payload := public.claim_guest_booking_by_manage_token(fixture_raw_token);

  if coalesce((claim_payload ->> 'ok')::boolean, false) is not true then
    raise exception 'Claim RPC failed for authenticated customer: %', claim_payload;
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = fixture_booking_id
      and customer_user_id = actor_user_id
      and customer_account_link_method = 'guest_manage_claim'
      and customer_account_linked_by_user_id = actor_user_id
      and customer_account_linked_at is not null
  ) then
    raise exception 'Claim RPC did not link booking to authenticated customer.';
  end if;

  if not exists (
    select 1
    from public.booking_customer_account_claims
    where booking_id = fixture_booking_id
      and customer_user_id = actor_user_id
      and claim_method = 'guest_manage_claim'
      and proof_type = 'guest_manage_token'
  ) then
    raise exception 'Claim RPC did not write the claim audit row.';
  end if;

  claim_payload := public.claim_guest_booking_by_manage_token(fixture_raw_token);

  if coalesce((claim_payload ->> 'ok')::boolean, false) is not true
    or coalesce((claim_payload ->> 'idempotent')::boolean, false) is not true
  then
    raise exception 'Claim RPC was not idempotent for the same user: %', claim_payload;
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*)
  into booking_visible_count
  from public.bookings
  where id = fixture_booking_id;
  execute 'reset role';

  if booking_visible_count <> 1 then
    raise exception 'Authenticated customer cannot see owned booking after claim.';
  end if;

  perform set_config('request.jwt.claim.sub', other_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*)
  into booking_visible_count
  from public.bookings
  where id = fixture_booking_id;
  execute 'reset role';

  if booking_visible_count <> 0 then
    raise exception 'Owned booking is visible to another authenticated customer.';
  end if;

  claim_payload := public.claim_guest_booking_by_manage_token(fixture_raw_token);

  if coalesce((claim_payload ->> 'ok')::boolean, false) is true
    or claim_payload ->> 'code' <> 'booking_not_available'
  then
    raise exception 'Claim RPC did not reject a cross-account claim: %', claim_payload;
  end if;

  reschedule_payload := public.reschedule_customer_booking(
    fixture_booking_id,
    original_start_at + interval '3 hours'
  );

  if coalesce((reschedule_payload ->> 'ok')::boolean, false) is true
    or reschedule_payload ->> 'code' <> 'not_found'
  then
    raise exception 'Customer reschedule RPC did not reject cross-account access: %', reschedule_payload;
  end if;

  claim_payload := public.cancel_customer_booking(
    fixture_booking_id,
    'Cross-account cancellation attempt'
  );

  if coalesce((claim_payload ->> 'ok')::boolean, false) is true
    or claim_payload ->> 'code' <> 'not_found'
  then
    raise exception 'Customer cancel RPC did not reject cross-account access: %', claim_payload;
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  reschedule_payload := public.reschedule_customer_booking(
    fixture_booking_id,
    original_start_at + interval '2 hours'
  );

  if coalesce((reschedule_payload ->> 'ok')::boolean, false) is not true then
    raise exception 'Customer reschedule RPC failed: %', reschedule_payload;
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = fixture_booking_id
      and start_at = original_start_at + interval '2 hours'
      and customer_user_id = actor_user_id
  ) then
    raise exception 'Customer reschedule RPC did not shift the owned booking.';
  end if;

  claim_payload := public.cancel_customer_booking(
    fixture_booking_id,
    'Identity gate cancellation'
  );

  if coalesce((claim_payload ->> 'ok')::boolean, false) is not true then
    raise exception 'Customer cancel RPC failed: %', claim_payload;
  end if;

  if not exists (
    select 1
    from public.bookings
    where id = fixture_booking_id
      and status = 'cancelled'
      and cancelled_by_user_id = actor_user_id
  ) then
    raise exception 'Customer cancel RPC did not cancel the owned booking.';
  end if;

  perform set_config('request.jwt.claim.sub', actor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*)
  into claim_row_count
  from public.booking_customer_account_claims claims
  where claims.booking_id = fixture_booking_id;
  execute 'reset role';

  if claim_row_count <> 1 then
    raise exception 'Customer RLS did not expose own claim row; count %.', claim_row_count;
  end if;

  perform set_config('request.jwt.claim.sub', other_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*)
  into other_claim_count
  from public.booking_customer_account_claims claims
  where claims.booking_id = fixture_booking_id;
  execute 'reset role';

  if other_claim_count <> 0 then
    raise exception 'Claim RLS exposed rows to an unrelated auth subject.';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claim.role', 'anon', true);
    execute 'set local role anon';
    perform public.claim_guest_booking_by_manage_token(fixture_raw_token);
  exception
    when insufficient_privilege then
      permission_denied := true;
  end;
  execute 'reset role';

  if permission_denied is not true then
    raise exception 'Anon role can execute claim_guest_booking_by_manage_token.';
  end if;
end;
$$;

rollback;
