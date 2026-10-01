begin;

do $$
declare
  v_account_id uuid := '10000000-0000-4000-8000-000000000001';
  v_auth_user_id uuid := '10000000-0000-4000-8000-000000000002';
  v_other_auth_user_id uuid := '10000000-0000-4000-8000-000000000004';
  v_public_user_id uuid := '10000000-0000-4000-8000-000000000003';
  v_other_account_id uuid := '10000000-0000-4000-8000-000000000005';
  v_other_public_user_id uuid := '10000000-0000-4000-8000-000000000006';
  v_first_result jsonb;
  v_second_result jsonb;
  v_third_result jsonb;
  v_other_account_result jsonb;
  v_salon_id uuid;
  v_blocked boolean;
begin
  insert into auth.users (id, email)
  values
    (v_auth_user_id, 'owner-create-salon@example.test'),
    (v_other_auth_user_id, 'owner-create-salon-other@example.test');

  insert into public.users (id, auth_user_id, email, display_name)
  values
    (v_public_user_id, v_auth_user_id, 'owner-create-salon@example.test', 'Owner'),
    (v_other_public_user_id, v_other_auth_user_id, 'owner-create-salon-other@example.test', 'Other Owner');

  insert into public.accounts (id, name, status)
  values
    (v_account_id, 'Create Salon Contract Account', 'active'),
    (v_other_account_id, 'Create Salon Contract Other Account', 'active');

  perform public.seed_default_roles_for_account(v_account_id);
  perform public.seed_default_roles_for_account(v_other_account_id);

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  select v_account_id, v_public_user_id, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_account_id
    and roles.code = 'OWNER';

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  select v_other_account_id, v_other_public_user_id, roles.id, 'active', now()
  from public.roles
  where roles.account_id = v_other_account_id
    and roles.code = 'OWNER';

  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_first_result := public.create_account_salon(
    v_account_id,
    'same-logical-create-request',
    'Runtime Verified Salon',
    '555-1000',
    '1 Main St',
    null,
    'Austin',
    'TX',
    '78701',
    'US'
  );

  if coalesce((v_first_result ->> 'created')::boolean, false) is not true then
    raise exception 'Expected first create request to create a salon.';
  end if;

  v_salon_id := (v_first_result ->> 'salon_id')::uuid;

  if not exists (
    select 1
    from public.locations
    where id = v_salon_id
      and account_id = v_account_id
      and create_request_key = 'same-logical-create-request'
  ) then
    raise exception 'Created salon was not scoped to the expected account.';
  end if;

  if not exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    where memberships.salon_id = v_salon_id
      and memberships.account_id = v_account_id
      and memberships.user_id = v_public_user_id
      and memberships.status = 'active'
      and roles.code = 'OWNER'
  ) then
    raise exception 'Created salon owner membership was not provisioned.';
  end if;

  if not exists (select 1 from public.salon_settings where salon_id = v_salon_id) then
    raise exception 'Salon settings were not provisioned.';
  end if;

  if not exists (select 1 from public.booking_settings where salon_id = v_salon_id) then
    raise exception 'Booking settings were not provisioned.';
  end if;

  if not exists (select 1 from public.salon_payroll_settings where salon_id = v_salon_id) then
    raise exception 'Salon payroll settings were not provisioned.';
  end if;

  v_second_result := public.create_account_salon(
    v_account_id,
    'same-logical-create-request',
    'Runtime Verified Salon Duplicate',
    null,
    null,
    null,
    null,
    null,
    null,
    'US'
  );

  if coalesce((v_second_result ->> 'created')::boolean, true) is not false then
    raise exception 'Expected duplicate create request to be idempotent.';
  end if;

  if (v_second_result ->> 'salon_id')::uuid <> v_salon_id then
    raise exception 'Idempotent create request returned a different salon.';
  end if;

  if (
    select count(*)
    from public.locations
    where account_id = v_account_id
      and create_request_key = 'same-logical-create-request'
  ) <> 1 then
    raise exception 'Idempotent create request created duplicate salons.';
  end if;

  if (
    select count(*)
    from public.salon_memberships
    where salon_id = v_salon_id
      and user_id = v_public_user_id
  ) <> 1 then
    raise exception 'Idempotent create request created duplicate salon memberships.';
  end if;

  if (select count(*) from public.salon_settings where salon_id = v_salon_id) <> 1 then
    raise exception 'Idempotent create request duplicated salon settings.';
  end if;

  if (select count(*) from public.booking_settings where salon_id = v_salon_id) <> 1 then
    raise exception 'Idempotent create request duplicated booking settings.';
  end if;

  if (select count(*) from public.salon_payroll_settings where salon_id = v_salon_id) <> 1 then
    raise exception 'Idempotent create request duplicated payroll settings.';
  end if;

  v_third_result := public.create_account_salon(
    v_account_id,
    'second-logical-create-request',
    'Runtime Verified Salon 2'
  );

  if coalesce((v_third_result ->> 'created')::boolean, false) is not true then
    raise exception 'Different create request key did not create a second salon.';
  end if;

  if (v_third_result ->> 'salon_id')::uuid = v_salon_id then
    raise exception 'Different create request key returned the first salon.';
  end if;

  perform set_config('request.jwt.claim.sub', v_other_auth_user_id::text, true);

  v_other_account_result := public.create_account_salon(
    v_other_account_id,
    'same-logical-create-request',
    'Other Account Reused Key Salon'
  );

  if coalesce((v_other_account_result ->> 'created')::boolean, false) is not true then
    raise exception 'Different account could not reuse the same create request key.';
  end if;

  if (v_other_account_result ->> 'salon_id')::uuid = v_salon_id then
    raise exception 'Different account reused key returned another account salon.';
  end if;

  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);

  v_blocked := false;
  begin
    perform public.create_account_salon(v_account_id, '   ', 'Blank Key Salon');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Blank create request key was accepted.';
  end if;

  v_blocked := false;
  begin
    perform public.create_account_salon(v_other_account_id, 'owner-under-other-account', 'Unauthorized Salon');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Owner created a salon under an account they do not own.';
  end if;
end;
$$;

rollback;
