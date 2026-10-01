begin;

insert into auth.users (id, email)
values
  ('21000000-0000-4000-8000-000000000011', 'fallback-public-user@example.test');

select set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000011', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into public.users (id, auth_user_id, email, display_name)
values (
  '21000000-0000-4000-8000-000000000012',
  '21000000-0000-4000-8000-000000000011',
  'fallback-public-user@example.test',
  'Fallback Public User'
);

do $$
declare
  v_bootstrap_account_id uuid;
  v_bootstrap_membership_id uuid;
  v_created_account boolean;
  v_created_membership boolean;
  v_retry_account_id uuid;
  v_retry_membership_id uuid;
  v_salon_id uuid;
  v_blocked boolean := false;
begin
  if public.current_public_user_id() <> '21000000-0000-4000-8000-000000000012'::uuid then
    raise exception 'Authenticated fallback public user insert did not map auth.uid() to public.users.id.';
  end if;

  begin
    insert into public.users (id, auth_user_id, email, display_name)
    values (
      '21000000-0000-4000-8000-000000000013',
      '21000000-0000-4000-8000-000000000014',
      'forged-public-user@example.test',
      'Forged Public User'
    );
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Authenticated user inserted public.users row for a different auth user.';
  end if;

  select account_id, account_membership_id, created_account, created_membership
  into v_bootstrap_account_id, v_bootstrap_membership_id, v_created_account, v_created_membership
  from public.ensure_personal_account_for_current_user('Fallback Public Account');

  if v_bootstrap_account_id is null or v_bootstrap_membership_id is null then
    raise exception 'Personal account bootstrap did not return account and membership.';
  end if;

  if v_created_account is not true or v_created_membership is not true then
    raise exception 'First personal account bootstrap did not create required rows.';
  end if;

  if not exists (
    select 1
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    where memberships.id = v_bootstrap_membership_id
      and memberships.account_id = v_bootstrap_account_id
      and memberships.user_id = '21000000-0000-4000-8000-000000000012'::uuid
      and memberships.status = 'active'
      and roles.code = 'OWNER'
  ) then
    raise exception 'Personal account bootstrap did not create active OWNER membership.';
  end if;

  select account_id, account_membership_id
  into v_retry_account_id, v_retry_membership_id
  from public.ensure_personal_account_for_current_user('Fallback Public Account Retry');

  if v_retry_account_id <> v_bootstrap_account_id
    or v_retry_membership_id <> v_bootstrap_membership_id
  then
    raise exception 'Personal account bootstrap retry did not return the existing owner account.';
  end if;

  if (
    select count(*)
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    where memberships.user_id = '21000000-0000-4000-8000-000000000012'::uuid
      and memberships.status = 'active'
      and roles.code = 'OWNER'
  ) <> 1 then
    raise exception 'Personal account bootstrap created duplicate owner memberships.';
  end if;

  v_salon_id := (
    public.create_account_salon(
      v_bootstrap_account_id,
      'fallback-public-user-create-salon',
      'Fallback Public User Salon'
    ) ->> 'salon_id'
  )::uuid;

  if (select account_id from public.locations where id = v_salon_id) <> v_bootstrap_account_id then
    raise exception 'Create Salon after personal account bootstrap used the wrong account.';
  end if;
end;
$$;

reset role;

do $$
declare
  v_account_a uuid := '21000000-0000-4000-8000-000000000001';
  v_account_b uuid := '21000000-0000-4000-8000-000000000002';
  v_auth_a uuid := '21000000-0000-4000-8000-000000000003';
  v_auth_b uuid := '21000000-0000-4000-8000-000000000004';
  v_user_a uuid := '21000000-0000-4000-8000-000000000005';
  v_user_b uuid := '21000000-0000-4000-8000-000000000006';
  v_salon_a uuid;
  v_salon_b uuid;
  v_staff_a uuid;
  v_staff_b uuid;
  v_blocked boolean;
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename <> 'permissions'
      and (
        lower(coalesce(qual, '')) = 'true'
        or lower(coalesce(with_check, '')) = 'true'
      )
  ) then
    raise exception 'Public schema still has non-permission USING(true) or WITH CHECK(true) policies.';
  end if;

  if exists (
    select 1
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'public'
      and pg_class.relkind = 'r'
      and pg_class.relrowsecurity is not true
  ) then
    raise exception 'One or more public tables do not have RLS enabled.';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'salon-profile-media'
      and public = true
      and file_size_limit = 15728640
  ) then
    raise exception 'salon-profile-media storage bucket contract is missing.';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'payroll-paystubs'
      and public = false
      and file_size_limit = 10485760
  ) then
    raise exception 'payroll-paystubs storage bucket contract is missing.';
  end if;

  insert into auth.users (id, email)
  values
    (v_auth_a, 'owner-a@example.test'),
    (v_auth_b, 'owner-b@example.test');

  insert into public.users (id, auth_user_id, email, display_name)
  values
    (v_user_a, v_auth_a, 'owner-a@example.test', 'Owner A'),
    (v_user_b, v_auth_b, 'owner-b@example.test', 'Owner B');

  insert into public.accounts (id, name, status)
  values
    (v_account_a, 'Account A', 'active'),
    (v_account_b, 'Account B', 'active');

  perform public.seed_default_roles_for_account(v_account_a);
  perform public.seed_default_roles_for_account(v_account_b);

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  select v_account_a, v_user_a, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_account_a and roles.code = 'OWNER';

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  select v_account_b, v_user_b, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_account_b and roles.code = 'OWNER';

  perform set_config('request.jwt.claim.sub', v_auth_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  if public.current_public_user_id() <> v_user_a then
    raise exception 'current_public_user_id did not map auth A to public user A.';
  end if;

  v_salon_a := (public.create_account_salon(v_account_a, 'owner-a-create', 'Salon A') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_auth_b::text, true);
  v_salon_b := (public.create_account_salon(v_account_b, 'owner-b-create', 'Salon B') ->> 'salon_id')::uuid;
  perform set_config('app.test.salon_a', v_salon_a::text, true);
  perform set_config('app.test.salon_b', v_salon_b::text, true);

  if not exists (
    select 1
    from public.salon_memberships
    where salon_id = v_salon_a
      and user_id = v_user_a
      and account_id = v_account_a
  ) then
    raise exception 'Salon A membership did not use public.users.id.';
  end if;

  insert into public.staff (salon_id, account_user_id, display_name, is_active)
  values (v_salon_a, v_user_a, 'Staff Bridge A', true)
  returning id into v_staff_a;

  insert into public.staff (salon_id, account_user_id, display_name, is_active)
  values (v_salon_b, v_user_b, 'Staff Bridge B', true)
  returning id into v_staff_b;

  insert into public.customers (location_id, customer_user_id, name, status)
  values (v_salon_a, v_user_a, 'Customer Bridge A', 'active');

  insert into public.bookings (
    salon_id,
    customer_id,
    customer_user_id,
    start_at,
    end_at,
    status
  )
  select v_salon_a, customers.id, v_user_a, now() + interval '1 day', now() + interval '1 day 30 minutes', 'pending'
  from public.customers
  where customers.location_id = v_salon_a
    and customers.customer_user_id = v_user_a
  limit 1;

  if exists (
    select 1
    from public.staff
    where account_user_id = v_auth_a
  ) then
    raise exception 'Staff bridge incorrectly stored auth.users.id instead of public.users.id.';
  end if;

  if exists (
    select 1
    from public.customers
    where customer_user_id = v_auth_a
  ) then
    raise exception 'Customer bridge incorrectly stored auth.users.id instead of public.users.id.';
  end if;

  if exists (
    select 1
    from public.bookings
    where customer_user_id = v_auth_a
  ) then
    raise exception 'Booking bridge incorrectly stored auth.users.id instead of public.users.id.';
  end if;

  insert into public.staff_time_blocks (
    salon_id,
    staff_id,
    block_type,
    starts_at,
    ends_at,
    reason
  )
  values
    (v_salon_a, v_staff_a, 'blocked', now() + interval '2 days', now() + interval '2 days 1 hour', 'A private block'),
    (v_salon_b, v_staff_b, 'blocked', now() + interval '2 days', now() + interval '2 days 1 hour', 'B private block');

  insert into public.pos_tickets (salon_id, ticket_number, status)
  values
    (v_salon_a, 'A-001', 'open'),
    (v_salon_b, 'B-001', 'open');

  insert into public.payroll_runs (
    salon_id,
    period_start,
    period_end,
    cycle_type,
    status
  )
  values
    (v_salon_a, current_date, current_date + 14, 'semi_monthly', 'draft'),
    (v_salon_b, current_date, current_date + 14, 'semi_monthly', 'draft');

  perform set_config('request.jwt.claim.sub', v_auth_a::text, true);

  v_blocked := false;
  begin
    perform public.create_account_salon(v_account_b, 'owner-a-under-b', 'Illegal Salon');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'User A created a salon under User B account.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '21000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_account_b uuid := '21000000-0000-4000-8000-000000000002';
  v_user_a uuid := '21000000-0000-4000-8000-000000000005';
  v_salon_a uuid;
  v_salon_b uuid;
  v_blocked boolean;
begin
  v_salon_a := current_setting('app.test.salon_a')::uuid;
  v_salon_b := current_setting('app.test.salon_b')::uuid;

  if (select count(*) from public.locations where id = v_salon_a) <> 1 then
    raise exception 'User A cannot read own salon through RLS.';
  end if;

  if (select count(*) from public.locations where id = v_salon_b) <> 0 then
    raise exception 'User A can read User B salon through RLS.';
  end if;

  if (select count(*) from public.staff_time_blocks where salon_id = v_salon_a) <> 1 then
    raise exception 'User A cannot read own staff time blocks.';
  end if;

  if (select count(*) from public.staff_time_blocks where salon_id = v_salon_b) <> 0 then
    raise exception 'User A can read User B staff time blocks.';
  end if;

  if (select count(*) from public.pos_tickets where salon_id = v_salon_b) <> 0 then
    raise exception 'User A can read User B POS tickets.';
  end if;

  if (select count(*) from public.payroll_runs where salon_id = v_salon_b) <> 0 then
    raise exception 'User A can read User B payroll runs.';
  end if;

  v_blocked := false;
  begin
    insert into public.salon_memberships (
      account_id,
      salon_id,
      user_id,
      status
    )
    values (v_account_b, v_salon_b, v_user_a, 'active');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'User A self-added a salon membership in User B salon.';
  end if;

  v_blocked := false;
  begin
    insert into public.staff_time_blocks (
      salon_id,
      block_type,
      starts_at,
      ends_at,
      reason
    )
    values (
      v_salon_b,
      'blocked',
      now() + interval '3 days',
      now() + interval '3 days 1 hour',
      'Cross salon write attempt'
    );
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'User A inserted a staff time block into User B salon.';
  end if;
end;
$$;

reset role;

rollback;
