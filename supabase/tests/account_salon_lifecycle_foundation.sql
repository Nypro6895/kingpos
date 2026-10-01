begin;

do $$
declare
  v_account_a uuid := '24000000-0000-4000-8000-000000000001';
  v_account_b uuid := '24000000-0000-4000-8000-000000000002';
  v_owner_a_auth uuid := '24000000-0000-4000-8000-000000000003';
  v_owner_b_auth uuid := '24000000-0000-4000-8000-000000000004';
  v_owner_a uuid := '24000000-0000-4000-8000-000000000005';
  v_owner_b uuid := '24000000-0000-4000-8000-000000000006';
  v_customer_a uuid;
  v_salon_a uuid;
  v_salon_b uuid;
  v_blocked boolean;
begin
  insert into auth.users (id, email)
  values
    (v_owner_a_auth, 'lifecycle-owner-a@example.test'),
    (v_owner_b_auth, 'lifecycle-owner-b@example.test');

  insert into public.users (id, auth_user_id, email, display_name, status)
  values
    (v_owner_a, v_owner_a_auth, 'lifecycle-owner-a@example.test', 'Lifecycle Owner A', 'active'),
    (v_owner_b, v_owner_b_auth, 'lifecycle-owner-b@example.test', 'Lifecycle Owner B', 'active');

  insert into public.accounts (id, name, status)
  values
    (v_account_a, 'Lifecycle Account A', 'active'),
    (v_account_b, 'Lifecycle Account B', 'active');

  perform public.seed_default_roles_for_account(v_account_a);
  perform public.seed_default_roles_for_account(v_account_b);

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  select v_account_a, v_owner_a, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_account_a
    and roles.code = 'OWNER';

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  select v_account_b, v_owner_b, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_account_b
    and roles.code = 'OWNER';

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_salon_a := (public.create_account_salon(v_account_a, 'lifecycle-a', 'Lifecycle Salon A') ->> 'salon_id')::uuid;
  v_salon_b := (public.create_account_salon(v_account_a, 'lifecycle-b', 'Lifecycle Salon B') ->> 'salon_id')::uuid;

  insert into public.customers (location_id, name, status)
  values (v_salon_a, 'Lifecycle Customer A', 'active')
  returning id into v_customer_a;

  insert into public.bookings (
    salon_id,
    customer_id,
    start_at,
    end_at,
    status
  )
  values (
    v_salon_a,
    v_customer_a,
    now() + interval '1 day',
    now() + interval '1 day 30 minutes',
    'pending'
  );

  insert into public.pos_tickets (salon_id, ticket_number, status)
  values (v_salon_a, 'LIFE-A-001', 'open');

  if public.salon_is_operational(v_salon_a) is not true then
    raise exception 'Active salon did not resolve as operational.';
  end if;

  perform public.disable_salon(v_salon_a, 'Seasonal pause');

  if (select public.normalize_salon_lifecycle_status(status) from public.locations where id = v_salon_a) <> 'disabled' then
    raise exception 'Disable transition did not set salon lifecycle to disabled.';
  end if;

  if (select count(*) from public.pos_tickets where salon_id = v_salon_a) <> 1 then
    raise exception 'Disabling a salon removed POS history.';
  end if;

  v_blocked := false;
  begin
    insert into public.bookings (
      salon_id,
      customer_id,
      start_at,
      end_at,
      status
    )
    values (
      v_salon_a,
      v_customer_a,
      now() + interval '2 days',
      now() + interval '2 days 30 minutes',
      'pending'
    );
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Disabled salon accepted a new booking.';
  end if;

  perform public.close_salon_permanently(v_salon_a, 'Owner closed permanently');

  if (select public.normalize_salon_lifecycle_status(status) from public.locations where id = v_salon_a) <> 'permanently_closed' then
    raise exception 'Permanent close transition did not set salon lifecycle.';
  end if;

  if (select count(*) from public.salon_lifecycle_events where salon_id = v_salon_a) < 2 then
    raise exception 'Lifecycle transitions were not audit recorded.';
  end if;

  v_blocked := false;
  begin
    perform public.reactivate_salon(v_salon_a, 'Attempt reopen');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Permanently closed salon was reactivated by default.';
  end if;

  insert into public.pos_tickets (salon_id, ticket_number, status)
  values (v_salon_b, 'LIFE-B-001', 'open');

  if (select count(*) from public.pos_tickets where salon_id = v_salon_b) <> 1 then
    raise exception 'Active Salon B did not remain operational.';
  end if;

  perform set_config('app.test.lifecycle_salon_a', v_salon_a::text, true);
  perform set_config('app.test.lifecycle_salon_b', v_salon_b::text, true);
  perform set_config('app.test.lifecycle_owner_a_auth', v_owner_a_auth::text, true);
  perform set_config('app.test.lifecycle_owner_b_auth', v_owner_b_auth::text, true);
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('app.test.lifecycle_owner_a_auth'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_salon_a uuid := current_setting('app.test.lifecycle_salon_a')::uuid;
  v_blocked boolean := false;
begin
  if (select count(*) from public.pos_tickets where salon_id = v_salon_a) <> 1 then
    raise exception 'Owner cannot read closed salon POS history through RLS.';
  end if;

  begin
    insert into public.pos_tickets (salon_id, ticket_number, status)
    values (v_salon_a, 'LIFE-A-BYPASS', 'open');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Client-side bypass inserted POS activity into a closed salon.';
  end if;
end;
$$;

reset role;

select set_config('request.jwt.claim.sub', current_setting('app.test.lifecycle_owner_b_auth'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_salon_a uuid := current_setting('app.test.lifecycle_salon_a')::uuid;
begin
  if (select count(*) from public.locations where id = v_salon_a) <> 0 then
    raise exception 'Unrelated user can read closed salon.';
  end if;

  if (select count(*) from public.pos_tickets where salon_id = v_salon_a) <> 0 then
    raise exception 'Unrelated user can read closed salon business history.';
  end if;
end;
$$;

reset role;

rollback;
