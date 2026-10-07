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


  v_result := public.get_salon_owner_roster(v_salon);
  if jsonb_array_length(v_result->'owners')<>2 or (v_result->>'canLeave')::boolean is not true then
    raise exception 'Roster must show two distinct owners and allow departure.';
  end if;
  -- Verify the new owner can leave, then roll back just this scenario.
  begin
    perform public.relinquish_current_salon_ownership(v_salon);
    if public.lifecycle_user_is_salon_owner(v_salon,v_owner_b,true) then raise exception 'New owner still owns salon after leaving.'; end if;
    if not public.lifecycle_user_is_salon_owner(v_salon,v_owner_a,true) then raise exception 'Old owner lost ownership unexpectedly.'; end if;
    raise sqlstate 'P0002' using message='Rollback new-owner departure scenario';
  exception when no_data_found then null;
  end;
  perform set_config('request.jwt.claim.sub',v_owner_c_auth::text,true);
  v_threw:=false;
  begin perform public.get_salon_owner_roster(v_salon); exception when others then v_threw:=true; end;
  if not v_threw then raise exception 'Non-owner could inspect roster.'; end if;
  v_threw:=false;
  begin perform public.relinquish_current_salon_ownership(v_salon); exception when others then v_threw:=true; end;
  if not v_threw then raise exception 'Non-owner could leave ownership.'; end if;
  perform set_config('request.jwt.claim.sub',v_owner_a_auth::text,true);
  perform public.relinquish_current_salon_ownership(v_salon);
  if public.lifecycle_user_is_salon_owner(v_salon,v_owner_a,true) then raise exception 'Old owner still owns salon after leaving.'; end if;
  if not public.lifecycle_user_is_salon_owner(v_salon,v_owner_b,true) then raise exception 'Remaining owner lost ownership.'; end if;
  perform set_config('request.jwt.claim.sub',v_owner_b_auth::text,true);
  v_result:=public.get_salon_owner_roster(v_salon);
  if jsonb_array_length(v_result->'owners')<>1 or (v_result->>'canLeave')::boolean then raise exception 'Last owner roster is incorrect.'; end if;
  v_threw:=false;
  begin perform public.relinquish_current_salon_ownership(v_salon); exception when others then v_threw:=true; end;
  if not v_threw then raise exception 'Last owner could leave active salon.'; end if;
  update public.locations set status='disabled' where id=v_salon;
  v_threw:=false;
  begin perform public.relinquish_current_salon_ownership(v_salon); exception when others then v_threw:=true; end;
  if not v_threw then raise exception 'Last owner could leave disabled salon.'; end if;
end;$$;
rollback;
