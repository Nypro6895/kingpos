begin;

do $$
declare
  v_account uuid := '26000000-0000-4000-8000-000000000001';
  v_blocked_account uuid := '26000000-0000-4000-8000-000000000002';
  v_recovery_account uuid := '26000000-0000-4000-8000-000000000003';
  v_owner_a_auth uuid := '26000000-0000-4000-8000-000000000004';
  v_owner_b_auth uuid := '26000000-0000-4000-8000-000000000005';
  v_owner_c_auth uuid := '26000000-0000-4000-8000-000000000006';
  v_blocked_auth uuid := '26000000-0000-4000-8000-000000000007';
  v_recovery_auth uuid := '26000000-0000-4000-8000-000000000008';
  v_owner_a uuid := '26000000-0000-4000-8000-000000000009';
  v_owner_b uuid := '26000000-0000-4000-8000-00000000000a';
  v_owner_c uuid := '26000000-0000-4000-8000-00000000000b';
  v_blocked_user uuid := '26000000-0000-4000-8000-00000000000c';
  v_recovery_user uuid := '26000000-0000-4000-8000-00000000000d';
  v_customer uuid;
  v_invite jsonb;
  v_owner_role uuid;
  v_recovery_owner_role uuid;
  v_result jsonb;
  v_salon uuid;
  v_blocked_salon uuid;
  v_recovery_salon uuid;
  v_threw boolean;
begin
  insert into auth.users (id, email)
  values
    (v_owner_a_auth, 'phase3-owner-a@example.test'),
    (v_owner_b_auth, 'phase3-owner-b@example.test'),
    (v_owner_c_auth, 'phase3-owner-c@example.test'),
    (v_blocked_auth, 'phase3-blocked@example.test'),
    (v_recovery_auth, 'phase3-recovery@example.test');

  insert into public.users (id, auth_user_id, email, display_name, status)
  values
    (v_owner_a, v_owner_a_auth, 'phase3-owner-a@example.test', 'Phase3 Owner A', 'active'),
    (v_owner_b, v_owner_b_auth, 'phase3-owner-b@example.test', 'Phase3 Owner B', 'active'),
    (v_owner_c, v_owner_c_auth, 'phase3-owner-c@example.test', 'Phase3 Owner C', 'active'),
    (v_blocked_user, v_blocked_auth, 'phase3-blocked@example.test', 'Phase3 Blocked', 'active'),
    (v_recovery_user, v_recovery_auth, 'phase3-recovery@example.test', 'Phase3 Recovery', 'active');

  insert into public.accounts (id, name, status)
  values
    (v_account, 'Phase3 Owner Transfer Account', 'active'),
    (v_blocked_account, 'Phase3 Blocked Deletion Account', 'active'),
    (v_recovery_account, 'Phase3 Recovery Account', 'active');

  perform public.seed_default_roles_for_account(v_account);
  perform public.seed_default_roles_for_account(v_blocked_account);
  perform public.seed_default_roles_for_account(v_recovery_account);

  select id into v_owner_role
  from public.roles
  where account_id = v_account
    and code = 'OWNER';

  select id into v_recovery_owner_role
  from public.roles
  where account_id = v_recovery_account
    and code = 'OWNER';

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  values
    (v_account, v_owner_a, v_owner_role, 'active', now()),
    (v_blocked_account, v_blocked_user, (
      select id from public.roles where account_id = v_blocked_account and code = 'OWNER'
    ), 'active', now()),
    (v_recovery_account, v_recovery_user, v_recovery_owner_role, 'active', now());

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);

  v_salon := (public.create_account_salon(v_account, 'phase3-owner-transfer', 'Phase3 Owner Transfer Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_blocked_auth::text, true);
  v_blocked_salon := (public.create_account_salon(v_blocked_account, 'phase3-blocked-finalizer', 'Phase3 Blocked Finalizer Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_recovery_auth::text, true);
  v_recovery_salon := (public.create_account_salon(v_recovery_account, 'phase3-recovery', 'Phase3 Recovery Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);

  v_invite := public.create_salon_owner_transfer_invite(
    v_salon,
    'phase3-owner-b@example.test',
    'transfer_ownership',
    repeat('a', 64),
    now() + interval '14 days',
    'Transfer test',
    false
  );

  v_threw := false;
  perform set_config('request.jwt.claim.sub', v_owner_c_auth::text, true);
  begin
    perform public.accept_salon_owner_transfer_invite(repeat('a', 64));
  exception
    when others then
      v_threw := true;
  end;

  if not v_threw then
    raise exception 'Wrong recipient accepted owner invitation.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_b_auth::text, true);
  perform public.accept_salon_owner_transfer_invite(repeat('a', 64));

  if public.lifecycle_active_owner_count(v_salon, null) <> 2 then
    raise exception 'Accepted co-owner was not counted as active Owner.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);
  v_invite := public.create_salon_owner_transfer_invite(
    v_salon,
    'phase3-owner-c@example.test',
    'add_co_owner',
    repeat('b', 64),
    now() + interval '14 days',
    'Expired invite test',
    false
  );

  update public.salon_owner_transfer_invites
  set expires_at = now() - interval '1 minute'
  where id = (v_invite ->> 'id')::uuid;

  v_threw := false;
  perform set_config('request.jwt.claim.sub', v_owner_c_auth::text, true);
  begin
    perform public.accept_salon_owner_transfer_invite(repeat('b', 64));
  exception
    when others then
      v_threw := true;
  end;

  if not v_threw then
    raise exception 'Expired owner invitation was accepted.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);
  perform public.relinquish_current_salon_ownership(v_salon, 'Transfer accepted');

  if public.lifecycle_active_owner_count(v_salon, null) <> 1 then
    raise exception 'Relinquishment did not preserve exactly one active owner.';
  end if;

  v_customer := gen_random_uuid();
  insert into public.customers (id, location_id, name, status)
  values (v_customer, v_salon, 'Phase3 Customer', 'active');

  insert into public.bookings (
    salon_id,
    customer_id,
    start_at,
    end_at,
    status,
    created_by_user_id
  )
  values (
    v_salon,
    v_customer,
    now() - interval '1 day',
    now() - interval '23 hours',
    'completed',
    v_owner_a
  );

  update public.users
  set status = 'pending_deletion',
      deletion_requested_at = now() - interval '31 days',
      deletion_scheduled_for = now() - interval '1 day'
  where id = v_owner_a;

  v_result := public.finalize_account_deletion(v_owner_a);

  if coalesce((v_result ->> 'ok')::boolean, false) is not true then
    raise exception 'Due account deletion finalizer did not succeed: %', v_result;
  end if;

  if (
    select count(*)
    from public.bookings
    where created_by_user_id = v_owner_a
  ) <> 1 then
    raise exception 'Historical booking was destroyed by account finalization.';
  end if;

  if (
    select status
    from public.users
    where id = v_owner_a
  ) <> 'deleted' then
    raise exception 'Finalized user did not become deleted.';
  end if;

  if (
    select auth_user_id
    from public.users
    where id = v_owner_a
  ) is not null then
    raise exception 'Finalized user auth identity was not disconnected.';
  end if;

  if (
    select count(*)
    from public.account_lifecycle_events
    where user_id = v_owner_a
      and event_type = 'account_deletion_finalized'
  ) <> 1 then
    raise exception 'Finalized account audit event missing or duplicated.';
  end if;

  v_result := public.finalize_account_deletion(v_owner_a);

  if coalesce((v_result ->> 'changed')::boolean, true) is not false then
    raise exception 'Finalizer was not idempotent on second run.';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);

  if public.auth_identity_is_deleted(v_owner_a_auth) is not true then
    raise exception 'Deleted auth identity tombstone was not recognized.';
  end if;

  update public.users
  set status = 'pending_deletion',
      deletion_requested_at = now(),
      deletion_scheduled_for = now() + interval '1 day'
  where id = v_owner_c;

  v_result := public.finalize_account_deletion(v_owner_c);

  if v_result ->> 'reason' <> 'not_due' then
    raise exception 'Not-due account deletion was not skipped.';
  end if;

  update public.users
  set status = 'pending_deletion',
      deletion_requested_at = now() - interval '31 days',
      deletion_scheduled_for = now() - interval '1 day'
  where id = v_blocked_user;

  v_result := public.finalize_account_deletion(v_blocked_user);

  if v_result ->> 'reason' <> 'ownership_unresolved' then
    raise exception 'Finalizer did not refuse unresolved last-owner account.';
  end if;

  update public.locations
  set status = 'permanently_closed',
      closed_at = now(),
      closed_by = v_recovery_user,
      closure_reason = 'Recovery test setup'
  where id = v_recovery_salon;

  v_threw := false;
  perform set_config('request.jwt.claim.sub', v_recovery_auth::text, true);
  begin
    perform public.recover_permanently_closed_salon(
      v_recovery_salon,
      v_recovery_user,
      'Ordinary owner should fail'
    );
  exception
    when others then
      v_threw := true;
  end;

  if not v_threw then
    raise exception 'Ordinary owner recovered a permanently closed salon.';
  end if;

  insert into public.lifecycle_support_admins (
    user_id,
    granted_by_user_id,
    status,
    reason
  )
  values (
    v_recovery_user,
    v_recovery_user,
    'active',
    'Phase3 test support admin'
  );

  perform public.recover_permanently_closed_salon(
    v_recovery_salon,
    v_recovery_user,
    'Verified recovery test'
  );

  if (
    select public.normalize_salon_lifecycle_status(status)
    from public.locations
    where id = v_recovery_salon
  ) <> 'disabled' then
    raise exception 'Privileged recovery did not return salon to disabled.';
  end if;

  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_recovery_salon
      and event_type = 'SALON_RECOVERY_APPROVED'
  ) then
    raise exception 'Privileged recovery audit event was not recorded.';
  end if;
end;
$$;

rollback;
