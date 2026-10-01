begin;

do $$
declare
  v_account_last uuid := '25000000-0000-4000-8000-000000000001';
  v_account_shared uuid := '25000000-0000-4000-8000-000000000002';
  v_owner_a_auth uuid := '25000000-0000-4000-8000-000000000003';
  v_owner_b_auth uuid := '25000000-0000-4000-8000-000000000004';
  v_no_salon_auth uuid := '25000000-0000-4000-8000-000000000005';
  v_owner_a uuid := '25000000-0000-4000-8000-000000000006';
  v_owner_b uuid := '25000000-0000-4000-8000-000000000007';
  v_no_salon_user uuid := '25000000-0000-4000-8000-000000000008';
  v_last_salon uuid;
  v_shared_salon uuid;
  v_blocked boolean;
  v_owner_role_last uuid;
  v_owner_role_shared uuid;
begin
  insert into auth.users (id, email)
  values
    (v_owner_a_auth, 'delete-owner-a@example.test'),
    (v_owner_b_auth, 'delete-owner-b@example.test'),
    (v_no_salon_auth, 'delete-no-salon@example.test');

  insert into public.users (id, auth_user_id, email, display_name, status)
  values
    (v_owner_a, v_owner_a_auth, 'delete-owner-a@example.test', 'Delete Owner A', 'active'),
    (v_owner_b, v_owner_b_auth, 'delete-owner-b@example.test', 'Delete Owner B', 'active'),
    (v_no_salon_user, v_no_salon_auth, 'delete-no-salon@example.test', 'No Salon', 'active');

  insert into public.accounts (id, name, status)
  values
    (v_account_last, 'Deletion Last Owner Account', 'active'),
    (v_account_shared, 'Deletion Shared Owner Account', 'active');

  perform public.seed_default_roles_for_account(v_account_last);
  perform public.seed_default_roles_for_account(v_account_shared);

  select id
  into v_owner_role_last
  from public.roles
  where account_id = v_account_last
    and code = 'OWNER';

  select id
  into v_owner_role_shared
  from public.roles
  where account_id = v_account_shared
    and code = 'OWNER';

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  values
    (v_account_last, v_owner_a, v_owner_role_last, 'active', now()),
    (v_account_shared, v_owner_a, v_owner_role_shared, 'active', now()),
    (v_account_shared, v_owner_b, v_owner_role_shared, 'active', now());

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_last_salon := (public.create_account_salon(v_account_last, 'delete-last', 'Deletion Last Owner Salon') ->> 'salon_id')::uuid;
  v_shared_salon := (public.create_account_salon(v_account_shared, 'delete-shared', 'Deletion Shared Salon') ->> 'salon_id')::uuid;

  v_blocked := false;
  begin
    perform public.request_account_deletion(false, true, 'Transfer incomplete');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Last-owner deletion finalized without transfer or no-transfer confirmation.';
  end if;

  v_blocked := false;
  begin
    perform public.request_account_deletion(true, false, 'Missing backup acknowledgement');
  exception
    when others then
      v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Owned-salon deletion skipped backup acknowledgement.';
  end if;

  perform public.request_account_deletion(true, true, 'No transfer selected');

  if (select status from public.users where id = v_owner_a) <> 'pending_deletion' then
    raise exception 'Account did not enter pending deletion.';
  end if;

  if (
    select deletion_scheduled_for::date - deletion_requested_at::date
    from public.users
    where id = v_owner_a
  ) <> 30 then
    raise exception 'Deletion grace period was not scheduled for 30 days.';
  end if;

  if (
    select public.normalize_salon_lifecycle_status(status)
    from public.locations
    where id = v_last_salon
  ) <> 'permanently_closed' then
    raise exception 'Last-owner no-transfer salon was not permanently closed.';
  end if;

  if (
    select public.normalize_salon_lifecycle_status(status)
    from public.locations
    where id = v_shared_salon
  ) <> 'active' then
    raise exception 'Co-owned salon was closed unexpectedly.';
  end if;

  perform public.cancel_account_deletion();

  if (select status from public.users where id = v_owner_a) <> 'active' then
    raise exception 'Cancel deletion did not restore account status.';
  end if;

  if (
    select public.normalize_salon_lifecycle_status(status)
    from public.locations
    where id = v_last_salon
  ) <> 'permanently_closed' then
    raise exception 'Cancel deletion reopened a permanently closed salon.';
  end if;

  perform set_config('request.jwt.claim.sub', v_no_salon_auth::text, true);
  perform public.request_account_deletion(false, false, 'No salon account');

  if (select status from public.users where id = v_no_salon_user) <> 'pending_deletion' then
    raise exception 'No-salon account did not enter pending deletion.';
  end if;
end;
$$;

rollback;
