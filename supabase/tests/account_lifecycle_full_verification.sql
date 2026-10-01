begin;

create temporary table verification_assertions (
  name text primary key
) on commit drop;

create or replace function pg_temp.pass(p_name text)
returns void
language plpgsql
security definer
set search_path = pg_temp
as $$
begin
  insert into verification_assertions (name)
  values (p_name);
end;
$$;

grant execute on function pg_temp.pass(text) to public;

do $$
declare
  v_account_main uuid := '27000000-0000-4000-8000-000000001001';
  v_account_transfer uuid := '27000000-0000-4000-8000-000000001002';
  v_account_shared_delete uuid := '27000000-0000-4000-8000-000000001003';
  v_account_last_delete uuid := '27000000-0000-4000-8000-000000001004';
  v_account_unresolved uuid := '27000000-0000-4000-8000-000000001005';
  v_account_race uuid := '27000000-0000-4000-8000-000000001006';
  v_account_recovery uuid := '27000000-0000-4000-8000-000000001007';

  v_owner_a_auth uuid := '27000000-0000-4000-8000-000000000001';
  v_owner_b_auth uuid := '27000000-0000-4000-8000-000000000002';
  v_candidate_auth uuid := '27000000-0000-4000-8000-000000000003';
  v_unrelated_auth uuid := '27000000-0000-4000-8000-000000000004';
  v_staff_auth uuid := '27000000-0000-4000-8000-000000000005';
  v_no_salon_auth uuid := '27000000-0000-4000-8000-000000000006';
  v_shared_a_auth uuid := '27000000-0000-4000-8000-000000000007';
  v_shared_b_auth uuid := '27000000-0000-4000-8000-000000000008';
  v_last_auth uuid := '27000000-0000-4000-8000-000000000009';
  v_unresolved_auth uuid := '27000000-0000-4000-8000-00000000000a';
  v_race_auth uuid := '27000000-0000-4000-8000-00000000000b';
  v_support_auth uuid := '27000000-0000-4000-8000-00000000000c';

  v_owner_a uuid := '27000000-0000-4000-8000-000000000101';
  v_owner_b uuid := '27000000-0000-4000-8000-000000000102';
  v_candidate uuid := '27000000-0000-4000-8000-000000000103';
  v_unrelated uuid := '27000000-0000-4000-8000-000000000104';
  v_staff_user uuid := '27000000-0000-4000-8000-000000000105';
  v_no_salon uuid := '27000000-0000-4000-8000-000000000106';
  v_shared_a uuid := '27000000-0000-4000-8000-000000000107';
  v_shared_b uuid := '27000000-0000-4000-8000-000000000108';
  v_last_user uuid := '27000000-0000-4000-8000-000000000109';
  v_unresolved_user uuid := '27000000-0000-4000-8000-00000000010a';
  v_race_user uuid := '27000000-0000-4000-8000-00000000010b';
  v_support_user uuid := '27000000-0000-4000-8000-00000000010c';

  v_main_salon uuid;
  v_active_close_salon uuid;
  v_multi_salon uuid;
  v_transfer_salon uuid;
  v_shared_salon uuid;
  v_last_salon uuid;
  v_unresolved_salon uuid;
  v_race_salon uuid;
  v_recovery_salon uuid;
  v_customer uuid := '27000000-0000-4000-8000-000000000201';
  v_shared_customer uuid := '27000000-0000-4000-8000-000000000202';
  v_staff_id uuid := '27000000-0000-4000-8000-000000000203';
begin
  insert into auth.users (id, email)
  values
    (v_owner_a_auth, 'full-owner-a@example.test'),
    (v_owner_b_auth, 'full-owner-b@example.test'),
    (v_candidate_auth, 'full-candidate@example.test'),
    (v_unrelated_auth, 'full-unrelated@example.test'),
    (v_staff_auth, 'full-staff@example.test'),
    (v_no_salon_auth, 'full-no-salon@example.test'),
    (v_shared_a_auth, 'full-shared-a@example.test'),
    (v_shared_b_auth, 'full-shared-b@example.test'),
    (v_last_auth, 'full-last-owner@example.test'),
    (v_unresolved_auth, 'full-unresolved@example.test'),
    (v_race_auth, 'full-race@example.test'),
    (v_support_auth, 'full-support@example.test');

  insert into public.users (id, auth_user_id, email, display_name, status)
  values
    (v_owner_a, v_owner_a_auth, 'full-owner-a@example.test', 'Full Owner A', 'active'),
    (v_owner_b, v_owner_b_auth, 'full-owner-b@example.test', 'Full Owner B', 'active'),
    (v_candidate, v_candidate_auth, 'full-candidate@example.test', 'Full Candidate', 'active'),
    (v_unrelated, v_unrelated_auth, 'full-unrelated@example.test', 'Full Unrelated', 'active'),
    (v_staff_user, v_staff_auth, 'full-staff@example.test', 'Full Staff', 'active'),
    (v_no_salon, v_no_salon_auth, 'full-no-salon@example.test', 'Full No Salon', 'active'),
    (v_shared_a, v_shared_a_auth, 'full-shared-a@example.test', 'Full Shared A', 'active'),
    (v_shared_b, v_shared_b_auth, 'full-shared-b@example.test', 'Full Shared B', 'active'),
    (v_last_user, v_last_auth, 'full-last-owner@example.test', 'Full Last Owner', 'active'),
    (v_unresolved_user, v_unresolved_auth, 'full-unresolved@example.test', 'Full Unresolved', 'active'),
    (v_race_user, v_race_auth, 'full-race@example.test', 'Full Race', 'active'),
    (v_support_user, v_support_auth, 'full-support@example.test', 'Full Support', 'active');

  insert into public.accounts (id, name, status)
  values
    (v_account_main, 'Full Verification Main', 'active'),
    (v_account_transfer, 'Full Verification Transfer', 'active'),
    (v_account_shared_delete, 'Full Verification Shared Delete', 'active'),
    (v_account_last_delete, 'Full Verification Last Delete', 'active'),
    (v_account_unresolved, 'Full Verification Unresolved', 'active'),
    (v_account_race, 'Full Verification Race', 'active'),
    (v_account_recovery, 'Full Verification Recovery', 'active');

  perform public.seed_default_roles_for_account(v_account_main);
  perform public.seed_default_roles_for_account(v_account_transfer);
  perform public.seed_default_roles_for_account(v_account_shared_delete);
  perform public.seed_default_roles_for_account(v_account_last_delete);
  perform public.seed_default_roles_for_account(v_account_unresolved);
  perform public.seed_default_roles_for_account(v_account_race);
  perform public.seed_default_roles_for_account(v_account_recovery);

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  values
    (v_account_main, v_owner_a, (select id from public.roles where account_id = v_account_main and code = 'OWNER'), 'active', now()),
    (v_account_main, v_owner_b, (select id from public.roles where account_id = v_account_main and code = 'OWNER'), 'active', now()),
    (v_account_main, v_staff_user, (select id from public.roles where account_id = v_account_main and code = 'STAFF'), 'active', now()),
    (v_account_transfer, v_owner_a, (select id from public.roles where account_id = v_account_transfer and code = 'OWNER'), 'active', now()),
    (v_account_shared_delete, v_shared_a, (select id from public.roles where account_id = v_account_shared_delete and code = 'OWNER'), 'active', now()),
    (v_account_shared_delete, v_shared_b, (select id from public.roles where account_id = v_account_shared_delete and code = 'OWNER'), 'active', now()),
    (v_account_last_delete, v_last_user, (select id from public.roles where account_id = v_account_last_delete and code = 'OWNER'), 'active', now()),
    (v_account_unresolved, v_unresolved_user, (select id from public.roles where account_id = v_account_unresolved and code = 'OWNER'), 'active', now()),
    (v_account_race, v_race_user, (select id from public.roles where account_id = v_account_race and code = 'OWNER'), 'active', now()),
    (v_account_recovery, v_owner_a, (select id from public.roles where account_id = v_account_recovery and code = 'OWNER'), 'active', now()),
    (v_account_recovery, v_staff_user, (select id from public.roles where account_id = v_account_recovery and code = 'STAFF'), 'active', now());

  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', v_owner_a_auth::text, true);
  v_main_salon := (public.create_account_salon(v_account_main, 'full-main-salon', 'Full Main Salon') ->> 'salon_id')::uuid;
  v_active_close_salon := (public.create_account_salon(v_account_main, 'full-active-close-salon', 'Full Active Close Salon') ->> 'salon_id')::uuid;
  v_multi_salon := (public.create_account_salon(v_account_main, 'full-multi-owner-salon', 'Full Multi Owner Salon') ->> 'salon_id')::uuid;
  v_transfer_salon := (public.create_account_salon(v_account_transfer, 'full-transfer-salon', 'Full Transfer Salon') ->> 'salon_id')::uuid;
  v_recovery_salon := (public.create_account_salon(v_account_recovery, 'full-recovery-salon', 'Full Recovery Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_shared_a_auth::text, true);
  v_shared_salon := (public.create_account_salon(v_account_shared_delete, 'full-shared-delete-salon', 'Full Shared Delete Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_last_auth::text, true);
  v_last_salon := (public.create_account_salon(v_account_last_delete, 'full-last-owner-salon', 'Full Last Owner Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_unresolved_auth::text, true);
  v_unresolved_salon := (public.create_account_salon(v_account_unresolved, 'full-unresolved-salon', 'Full Unresolved Salon') ->> 'salon_id')::uuid;

  perform set_config('request.jwt.claim.sub', v_race_auth::text, true);
  v_race_salon := (public.create_account_salon(v_account_race, 'full-race-salon', 'Full Race Salon') ->> 'salon_id')::uuid;

  perform set_config('app.test.recovery_salon', v_recovery_salon::text, true);

  insert into public.salon_memberships (account_id, salon_id, user_id, role_id, status, joined_at)
  values
    (v_account_main, v_main_salon, v_staff_user, (select id from public.roles where account_id = v_account_main and code = 'STAFF'), 'active', now())
  on conflict do nothing;
exception
  when foreign_key_violation then
    raise exception 'Setup failed before lifecycle verification: %', sqlerrm;
end;
$$;

do $$
declare
  v_account_main uuid := '27000000-0000-4000-8000-000000001001';
  v_account_recovery uuid := '27000000-0000-4000-8000-000000001007';
  v_owner_a uuid := '27000000-0000-4000-8000-000000000101';
  v_staff_user uuid := '27000000-0000-4000-8000-000000000105';
  v_main_salon uuid;
  v_recovery_salon uuid;
  v_customer uuid := '27000000-0000-4000-8000-000000000201';
  v_shared_customer uuid := '27000000-0000-4000-8000-000000000202';
  v_staff_id uuid := '27000000-0000-4000-8000-000000000203';
  v_shared_salon uuid;
begin
  select id into v_main_salon from public.locations where create_request_key = 'full-main-salon';
  select id into v_recovery_salon from public.locations where create_request_key = 'full-recovery-salon';
  select id into v_shared_salon from public.locations where create_request_key = 'full-shared-delete-salon';

  insert into public.customers (id, location_id, name, status, email)
  values
    (v_customer, v_main_salon, 'Full Main Customer', 'active', 'full-main-customer@example.test'),
    (v_shared_customer, v_shared_salon, 'Full Shared Customer', 'active', 'full-shared-customer@example.test');

  insert into public.staff (id, salon_id, account_user_id, display_name, email)
  values
    (v_staff_id, v_main_salon, v_staff_user, 'Full Staff Row', 'full-staff-row@example.test');

  insert into public.bookings (salon_id, customer_id, start_at, end_at, status, created_by_user_id)
  values
    (v_main_salon, v_customer, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'completed', v_owner_a),
    (v_shared_salon, v_shared_customer, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'completed', '27000000-0000-4000-8000-000000000107');

  insert into public.pos_tickets (salon_id, ticket_number, customer_id, status, closed_at)
  values
    (v_main_salon, 'FULL-MAIN-001', v_customer, 'closed', now() - interval '1 day'),
    (v_shared_salon, 'FULL-SHARED-001', v_shared_customer, 'closed', now() - interval '1 day');

  insert into public.pos_daily_closings (salon_id, report_date, status, cash_amount, credit_card_amount, other_amount)
  values
    (v_main_salon, current_date - 1, 'closed', 12, 34, 0),
    (v_shared_salon, current_date - 2, 'closed', 10, 20, 0);

  insert into public.payroll_runs (salon_id, period_start, period_end, cycle_type, status)
  values
    (v_main_salon, current_date - 7, current_date - 1, 'weekly', 'draft'),
    (v_shared_salon, current_date - 7, current_date - 1, 'weekly', 'draft');

  insert into public.salon_memberships (account_id, salon_id, user_id, role_id, status, joined_at)
  values (
    v_account_recovery,
    v_recovery_salon,
    v_staff_user,
    (select id from public.roles where account_id = v_account_recovery and code = 'STAFF'),
    'active',
    now()
  )
  on conflict (salon_id, user_id) do update
  set role_id = excluded.role_id,
      status = 'active',
      updated_at = now();

  perform pg_temp.pass('setup isolated fixtures and historical records');
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_main_salon uuid;
  v_active_close_salon uuid;
  v_owner_a uuid := '27000000-0000-4000-8000-000000000101';
  v_changed jsonb;
  v_owner_count integer;
  v_blocked boolean;
begin
  select id into v_main_salon from public.locations where create_request_key = 'full-main-salon';
  select id into v_active_close_salon from public.locations where create_request_key = 'full-active-close-salon';

  select counts.active_owner_count
  into v_owner_count
  from public.get_account_deletion_owner_counts(array[v_main_salon]) counts;

  if v_owner_count <> 2 then
    raise exception 'Owner count RPC returned %, expected 2.', v_owner_count;
  end if;
  perform pg_temp.pass('owner count RPC returns aggregate co-owner count');

  v_changed := public.disable_salon(v_main_salon, 'Seasonal verification pause');
  if (v_changed ->> 'status') <> 'disabled' then
    raise exception 'disable_salon did not return disabled: %', v_changed;
  end if;

  if not exists (
    select 1
    from public.locations
    where id = v_main_salon
      and status = 'disabled'
      and disabled_at is not null
      and disabled_by = v_owner_a
      and disabled_reason = 'Seasonal verification pause'
  ) then
    raise exception 'Disabled metadata was not written correctly.';
  end if;
  perform pg_temp.pass('salon active to disabled metadata');

  v_blocked := false;
  begin
    insert into public.pos_tickets (salon_id, ticket_number, status)
    values (v_main_salon, 'FULL-DISABLED-POS', 'open');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Disabled salon accepted POS write.';
  end if;
  perform pg_temp.pass('disabled salon blocks POS writes');

  v_blocked := false;
  begin
    insert into public.bookings (salon_id, customer_id, start_at, end_at, status, created_by_user_id)
    values (
      v_main_salon,
      '27000000-0000-4000-8000-000000000201',
      now(),
      now() + interval '1 hour',
      'pending',
      v_owner_a
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Disabled salon accepted booking write.';
  end if;
  perform pg_temp.pass('disabled salon blocks booking writes');

  v_blocked := false;
  begin
    insert into public.staff (salon_id, display_name)
    values (v_main_salon, 'Blocked Disabled Staff');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Disabled salon accepted staff write.';
  end if;
  perform pg_temp.pass('disabled salon blocks staff writes');

  v_blocked := false;
  begin
    insert into public.pos_daily_closings (salon_id, report_date, status)
    values (v_main_salon, current_date, 'draft');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Disabled salon accepted daily closing write.';
  end if;
  perform pg_temp.pass('disabled salon blocks daily log writes');

  v_blocked := false;
  begin
    insert into public.payroll_runs (salon_id, period_start, period_end, cycle_type, status)
    values (v_main_salon, current_date, current_date + 6, 'weekly', 'draft');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Disabled salon accepted payroll write.';
  end if;
  perform pg_temp.pass('disabled salon blocks payroll writes');

  v_changed := public.reactivate_salon(v_main_salon, 'Verification reopen');
  if (v_changed ->> 'status') <> 'active' then
    raise exception 'reactivate_salon did not return active: %', v_changed;
  end if;

  if not exists (
    select 1
    from public.locations
    where id = v_main_salon
      and status = 'active'
      and reactivated_at is not null
      and reactivated_by = v_owner_a
      and reactivation_reason = 'Verification reopen'
  ) then
    raise exception 'Reactivation metadata was not written correctly.';
  end if;
  perform pg_temp.pass('salon disabled to active metadata');

  perform public.disable_salon(v_main_salon, 'Disable before permanent close');
  v_changed := public.close_salon_permanently(v_main_salon, 'Verification close from disabled');
  if (v_changed ->> 'status') <> 'permanently_closed' then
    raise exception 'close_salon_permanently did not return permanently_closed: %', v_changed;
  end if;

  if not exists (
    select 1
    from public.locations
    where id = v_main_salon
      and status = 'permanently_closed'
      and closed_at is not null
      and closed_by = v_owner_a
      and closure_reason = 'Verification close from disabled'
  ) then
    raise exception 'Permanent close metadata was not written correctly.';
  end if;
  perform pg_temp.pass('salon disabled to permanently closed metadata');

  v_changed := public.close_salon_permanently(v_active_close_salon, 'Verification close from active');
  if (v_changed ->> 'status') <> 'permanently_closed' then
    raise exception 'Active salon did not permanently close.';
  end if;
  perform pg_temp.pass('salon active to permanently closed');

  v_blocked := false;
  begin
    perform public.reactivate_salon(v_main_salon, 'Normal reopen should fail');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Normal flow reopened permanently closed salon.';
  end if;
  perform pg_temp.pass('normal flow blocks permanently closed to active');

  v_blocked := false;
  begin
    insert into public.pos_tickets (salon_id, ticket_number, status)
    values (v_main_salon, 'FULL-CLOSED-POS', 'open');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Closed salon accepted POS write.';
  end if;
  perform pg_temp.pass('closed salon blocks POS writes');

  v_blocked := false;
  begin
    insert into public.bookings (salon_id, customer_id, start_at, end_at, status, created_by_user_id)
    values (
      v_main_salon,
      '27000000-0000-4000-8000-000000000201',
      now(),
      now() + interval '1 hour',
      'pending',
      v_owner_a
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Closed salon accepted booking write.';
  end if;
  perform pg_temp.pass('closed salon blocks booking writes');

  v_blocked := false;
  begin
    insert into public.staff (salon_id, display_name)
    values (v_main_salon, 'Blocked Closed Staff');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Closed salon accepted staff write.';
  end if;
  perform pg_temp.pass('closed salon blocks staff writes');

  v_blocked := false;
  begin
    insert into public.pos_daily_closings (salon_id, report_date, status)
    values (v_main_salon, current_date + 1, 'draft');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Closed salon accepted daily closing write.';
  end if;
  perform pg_temp.pass('closed salon blocks daily log writes');

  v_blocked := false;
  begin
    insert into public.payroll_runs (salon_id, period_start, period_end, cycle_type, status)
    values (v_main_salon, current_date + 7, current_date + 13, 'weekly', 'draft');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Closed salon accepted payroll write.';
  end if;
  perform pg_temp.pass('closed salon blocks payroll writes');

  if (select count(*) from public.pos_tickets where salon_id = v_main_salon) = 0
    or (select count(*) from public.bookings where salon_id = v_main_salon) = 0
    or (select count(*) from public.payroll_runs where salon_id = v_main_salon) = 0
    or (select count(*) from public.staff where salon_id = v_main_salon) = 0
  then
    raise exception 'Owner lost historical read access after salon close.';
  end if;
  perform pg_temp.pass('owner keeps historical read access after close');
end;
$$;

reset role;

do $$
declare
  v_main_salon uuid;
begin
  select id into v_main_salon from public.locations where create_request_key = 'full-main-salon';

  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_main_salon
      and event_type = 'SALON_DISABLED'
      and old_status = 'active'
      and new_status = 'disabled'
  ) then
    raise exception 'SALON_DISABLED audit event missing.';
  end if;

  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_main_salon
      and event_type = 'SALON_REACTIVATED'
      and old_status = 'disabled'
      and new_status = 'active'
  ) then
    raise exception 'SALON_REACTIVATED audit event missing.';
  end if;

  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_main_salon
      and event_type = 'SALON_PERMANENTLY_CLOSED'
      and old_status = 'disabled'
      and new_status = 'permanently_closed'
  ) then
    raise exception 'SALON_PERMANENTLY_CLOSED audit event missing.';
  end if;

  perform pg_temp.pass('salon lifecycle audit events recorded');
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000004', true);
set local role authenticated;

do $$
declare
  v_main_salon uuid;
  v_active_close_salon uuid;
  v_blocked boolean;
begin
  select id into v_main_salon from public.locations where create_request_key = 'full-main-salon';
  select id into v_active_close_salon from public.locations where create_request_key = 'full-active-close-salon';

  if (select count(*) from public.locations where id in (v_main_salon, v_active_close_salon)) <> 0 then
    raise exception 'Unrelated user can read private salon rows.';
  end if;
  if exists (
    select 1
    from public.get_account_deletion_owner_counts(array[v_main_salon])
  ) then
    raise exception 'Unrelated user can read owner count for private salon.';
  end if;
  perform pg_temp.pass('unrelated user cannot read owner count RPC for private salon');

  if (select count(*) from public.pos_tickets where salon_id = v_main_salon) <> 0
    or (select count(*) from public.bookings where salon_id = v_main_salon) <> 0
    or (select count(*) from public.payroll_runs where salon_id = v_main_salon) <> 0
  then
    raise exception 'Unrelated user can read private operational history.';
  end if;
  perform pg_temp.pass('unrelated user cannot read active disabled or closed private data');

  v_blocked := false;
  begin
    perform public.disable_salon(v_active_close_salon, 'Unrelated disable');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unrelated user disabled a salon.';
  end if;
  perform pg_temp.pass('unrelated user cannot disable salon');

  v_blocked := false;
  begin
    perform public.close_salon_permanently(v_active_close_salon, 'Unrelated close');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unrelated user permanently closed a salon.';
  end if;
  perform pg_temp.pass('unrelated user cannot permanently close salon');

  v_blocked := false;
  begin
    perform public.create_salon_owner_transfer_invite(
      v_active_close_salon,
      'full-candidate@example.test',
      'add_co_owner',
      repeat('c', 64),
      now() + interval '14 days',
      'Unrelated invite',
      false
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unrelated user created owner invite.';
  end if;
  perform pg_temp.pass('unrelated user cannot invite owner');

  v_blocked := false;
  begin
    insert into public.lifecycle_exports (
      export_type,
      account_id,
      salon_id,
      requested_by_user_id,
      storage_path,
      manifest
    )
    values (
      'salon_lifecycle',
      '27000000-0000-4000-8000-000000001001',
      v_main_salon,
      '27000000-0000-4000-8000-000000000104',
      '27000000-0000-4000-8000-000000000104/unauthorized.json',
      '{}'::jsonb
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unrelated user created lifecycle export metadata.';
  end if;
  perform pg_temp.pass('unrelated user cannot export salon');

  v_blocked := false;
  begin
    perform public.finalize_account_deletion('27000000-0000-4000-8000-000000000106');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Authenticated user invoked service-only finalizer.';
  end if;
  perform pg_temp.pass('authenticated direct finalizer RPC is blocked');

  v_blocked := false;
  begin
    truncate table public.salon_lifecycle_events;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Authenticated user truncated lifecycle audit.';
  end if;
  perform pg_temp.pass('authenticated lifecycle truncate bypass is blocked');

  if exists (
    select 1
    from public.salon_lifecycle_events
    where actor_user_id = '27000000-0000-4000-8000-000000000104'
      and event_type in ('SALON_DISABLED', 'SALON_REACTIVATED', 'SALON_PERMANENTLY_CLOSED', 'OWNER_INVITED', 'SALON_RECOVERY_APPROVED')
  ) then
    raise exception 'Failed unauthorized attempts created misleading success audit events.';
  end if;
  perform pg_temp.pass('failed unauthorized attempts do not create success audit events');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_main_salon uuid;
  v_multi_salon uuid;
  v_owner_a uuid := '27000000-0000-4000-8000-000000000101';
  v_export_id uuid := '27000000-0000-4000-8000-000000000301';
  v_blocked boolean;
begin
  select id into v_main_salon from public.locations where create_request_key = 'full-main-salon';
  select id into v_multi_salon from public.locations where create_request_key = 'full-multi-owner-salon';

  insert into public.lifecycle_exports (
    id,
    export_type,
    account_id,
    salon_id,
    requested_by_user_id,
    storage_path,
    manifest
  )
  values (
    v_export_id,
    'salon_lifecycle',
    '27000000-0000-4000-8000-000000001001',
    v_main_salon,
    v_owner_a,
    v_owner_a::text || '/full-closed-salon-export.json',
    jsonb_build_object(
      'domains',
      jsonb_build_array('customer_data', 'payroll', 'tax', 'booking', 'pos')
    )
  );

  if not exists (
    select 1
    from public.lifecycle_exports
    where id = v_export_id
      and requested_by_user_id = v_owner_a
      and salon_id = v_main_salon
      and export_type = 'salon_lifecycle'
      and expires_at > now()
      and manifest::text !~* '(service_role|secret|token)'
  ) then
    raise exception 'Owner export metadata was not created with safe metadata.';
  end if;
  perform pg_temp.pass('owner can create closed salon lifecycle export metadata');

  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_main_salon
      and event_type = 'EXPORT_CREATED'
      and metadata ->> 'export_id' = v_export_id::text
  ) then
    raise exception 'EXPORT_CREATED audit event missing.';
  end if;
  perform pg_temp.pass('export audit event recorded');

  insert into storage.objects (bucket_id, name, owner, metadata)
  values (
    'lifecycle-exports',
    v_owner_a::text || '/full-closed-salon-export.json',
    '27000000-0000-4000-8000-000000000001',
    '{"contentType":"application/json"}'::jsonb
  );

  if not exists (
    select 1
    from storage.objects
    where bucket_id = 'lifecycle-exports'
      and name = v_owner_a::text || '/full-closed-salon-export.json'
  ) then
    raise exception 'Owner could not read own private export object.';
  end if;
  perform pg_temp.pass('owner can insert and read own private export object');

  v_blocked := false;
  begin
    update public.locations
    set status = 'active'
    where id = v_main_salon;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Owner directly updated salon lifecycle status.';
  end if;
  perform pg_temp.pass('owner direct locations status update is blocked');

  v_blocked := false;
  begin
    update public.users
    set status = 'pending_deletion'
    where id = v_owner_a;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Owner directly updated account lifecycle status.';
  end if;
  perform pg_temp.pass('owner direct users status update is blocked');

  v_blocked := false;
  begin
    insert into public.salon_lifecycle_events (salon_id, actor_user_id, event_type, old_status, new_status)
    values (v_main_salon, v_owner_a, 'FORGED_EVENT', 'active', 'active');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Owner directly forged lifecycle audit event.';
  end if;
  perform pg_temp.pass('owner direct lifecycle audit insert is blocked');

  perform public.relinquish_current_salon_ownership(v_multi_salon, 'Co-owner remains');
  if public.lifecycle_user_is_salon_owner(v_multi_salon, v_owner_a, true) then
    raise exception 'Relinquished owner still appears active.';
  end if;
  if not public.lifecycle_user_is_salon_owner(v_multi_salon, '27000000-0000-4000-8000-000000000102', true) then
    raise exception 'Remaining co-owner is not active.';
  end if;
  if (select status from public.locations where id = v_multi_salon) <> 'active' then
    raise exception 'Multi-owner relinquish changed salon lifecycle status.';
  end if;
  perform pg_temp.pass('multi-owner relinquish preserves active salon and remaining owner');
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'lifecycle-exports'
      and public is false
      and file_size_limit = 52428800
  ) then
    raise exception 'Lifecycle export bucket is not private with expected metadata.';
  end if;
  perform pg_temp.pass('lifecycle export storage bucket is private');
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000009', true);
set local role authenticated;

do $$
declare
  v_last_salon uuid;
  v_blocked boolean;
begin
  select id into v_last_salon from public.locations where create_request_key = 'full-last-owner-salon';

  v_blocked := false;
  begin
    perform public.relinquish_current_salon_ownership(v_last_salon, 'Should fail last owner');
  exception when others then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'Last owner relinquished an active salon.';
  end if;
  if public.lifecycle_user_is_salon_owner(v_last_salon, '27000000-0000-4000-8000-000000000109', true) is not true then
    raise exception 'Last owner invariant removed ownership after reject.';
  end if;
  perform pg_temp.pass('last-owner active salon relinquish is rejected');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_transfer_salon uuid;
  v_invite jsonb;
begin
  select id into v_transfer_salon from public.locations where create_request_key = 'full-transfer-salon';
  v_invite := public.create_salon_owner_transfer_invite(
    v_transfer_salon,
    'full-candidate@example.test',
    'transfer_ownership',
    repeat('d', 64),
    now() + interval '14 days',
    'Transfer verification',
    true
  );

  if (v_invite ->> 'status') <> 'pending' then
    raise exception 'Owner invitation was not pending: %', v_invite;
  end if;
  if public.lifecycle_user_is_salon_owner(v_transfer_salon, '27000000-0000-4000-8000-000000000103', true) then
    raise exception 'Candidate became owner before accepting invite.';
  end if;
  perform pg_temp.pass('owner transfer invite created and recipient not owner yet');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000004', true);
set local role authenticated;

do $$
declare
  v_blocked boolean;
begin
  v_blocked := false;
  begin
    perform public.accept_salon_owner_transfer_invite(repeat('d', 64));
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unauthorized user accepted owner invitation.';
  end if;
  perform pg_temp.pass('unauthorized user cannot accept owner invite');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000003', true);
set local role authenticated;

do $$
declare
  v_transfer_salon uuid;
  v_result jsonb;
  v_blocked boolean;
begin
  v_result := public.accept_salon_owner_transfer_invite(repeat('d', 64));
  v_transfer_salon := (v_result ->> 'salon_id')::uuid;

  if v_transfer_salon is null then
    raise exception 'Owner transfer acceptance did not return salon_id: %', v_result;
  end if;

  if (v_result ->> 'status') <> 'accepted'
    or (v_result ->> 'relinquished_inviter')::boolean is not true then
    raise exception 'Owner transfer acceptance returned unexpected result: %', v_result;
  end if;
  if not public.lifecycle_user_is_salon_owner(v_transfer_salon, '27000000-0000-4000-8000-000000000103', true) then
    raise exception 'Accepted recipient is not canonical Owner.';
  end if;
  if not exists (
    select 1
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    join public.locations salons on salons.account_id = memberships.account_id
    where salons.id = v_transfer_salon
      and memberships.user_id = '27000000-0000-4000-8000-000000000103'
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
  ) then
    raise exception 'Accepted recipient is not account-level Owner.';
  end if;
  if public.lifecycle_user_is_salon_owner(v_transfer_salon, '27000000-0000-4000-8000-000000000101', true) then
    raise exception 'Relinquish-on-accept did not remove inviter ownership.';
  end if;
  if (select status from public.locations where id = v_transfer_salon) <> 'active' then
    raise exception 'Owner transfer changed salon lifecycle status.';
  end if;
  perform pg_temp.pass('owner transfer acceptance grants canonical owner and preserves salon');

  v_blocked := false;
  begin
    perform public.accept_salon_owner_transfer_invite(repeat('d', 64));
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Owner invitation replay acceptance succeeded.';
  end if;

  if (
    select count(*)
    from public.salon_lifecycle_events
    where salon_id = v_transfer_salon
      and event_type = 'OWNER_ACCEPTED'
  ) <> 1 then
    raise exception 'Owner invitation replay duplicated acceptance audit.';
  end if;
  perform pg_temp.pass('owner transfer replay is safe');
end;
$$;

reset role;

do $$
declare
  v_transfer_salon uuid;
begin
  select id into v_transfer_salon from public.locations where create_request_key = 'full-transfer-salon';
  if not exists (
    select 1 from public.salon_lifecycle_events
    where salon_id = v_transfer_salon
      and event_type = 'OWNER_INVITED'
  )
  or not exists (
    select 1 from public.salon_lifecycle_events
    where salon_id = v_transfer_salon
      and event_type = 'OWNER_ACCEPTED'
  )
  or not exists (
    select 1 from public.salon_lifecycle_events
    where salon_id = v_transfer_salon
      and event_type = 'OWNERSHIP_TRANSFER_COMPLETED'
  ) then
    raise exception 'Owner transfer audit events missing.';
  end if;
  perform pg_temp.pass('owner transfer audit events recorded');
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000006', true);
set local role authenticated;

do $$
declare
  v_result jsonb;
begin
  v_result := public.request_account_deletion(false, false, 'No salon verification');
  if (v_result ->> 'status') <> 'pending_deletion'
    or (v_result ->> 'owned_salon_count')::integer <> 0 then
    raise exception 'No-salon deletion request returned unexpected result: %', v_result;
  end if;
  if not exists (
    select 1
    from public.users
    where id = '27000000-0000-4000-8000-000000000106'
      and status = 'pending_deletion'
      and deletion_requested_at is not null
      and deletion_scheduled_for between deletion_requested_at + interval '29 days 23 hours'
          and deletion_requested_at + interval '30 days 1 hour'
  ) then
    raise exception 'No-salon deletion scheduling was not approximately 30 days.';
  end if;
  if not exists (
    select 1
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000106'
      and event_type = 'deletion_requested'
  ) then
    raise exception 'Deletion requested audit missing for no-salon account.';
  end if;
  perform pg_temp.pass('delete account no salon schedules pending deletion');
end;
$$;

reset role;

set local role service_role;

do $$
declare
  v_result jsonb;
begin
  v_result := public.finalize_account_deletion('27000000-0000-4000-8000-000000000106');
  if v_result ->> 'reason' <> 'not_due' then
    raise exception 'Not-due finalizer did not skip: %', v_result;
  end if;
  if exists (
    select 1
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000106'
      and event_type = 'account_deletion_finalization_started'
  ) then
    raise exception 'Not-due finalizer wrote started audit.';
  end if;
  perform pg_temp.pass('not-due account finalizer safely skips');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000007', true);
set local role authenticated;

do $$
declare
  v_shared_salon uuid;
  v_result jsonb;
begin
  select id into v_shared_salon from public.locations where create_request_key = 'full-shared-delete-salon';
  v_result := public.request_account_deletion(false, true, 'Shared owner deletion');
  if (v_result ->> 'status') <> 'pending_deletion' then
    raise exception 'Shared-owner deletion request failed: %', v_result;
  end if;
  if (select status from public.locations where id = v_shared_salon) <> 'active' then
    raise exception 'Shared-owner account deletion closed salon unexpectedly.';
  end if;
  if not public.lifecycle_user_is_salon_owner(v_shared_salon, '27000000-0000-4000-8000-000000000108', true) then
    raise exception 'Remaining shared owner was not retained.';
  end if;
  perform pg_temp.pass('delete account with other owner preserves salon and remaining owner');
end;
$$;

reset role;

do $$
begin
  update public.users
  set deletion_scheduled_for = now() - interval '1 minute'
  where id = '27000000-0000-4000-8000-000000000107';
end;
$$;

set local role service_role;

do $$
declare
  v_result jsonb;
  v_second jsonb;
begin
  v_result := public.finalize_account_deletion('27000000-0000-4000-8000-000000000107');
  if coalesce((v_result ->> 'ok')::boolean, false) is not true
    or coalesce((v_result ->> 'changed')::boolean, false) is not true then
    raise exception 'Due account finalizer failed: %', v_result;
  end if;
  if not exists (
    select 1
    from public.users
    where id = '27000000-0000-4000-8000-000000000107'
      and status = 'deleted'
      and auth_user_id is null
      and email is null
      and phone is null
      and display_name = 'Deleted user'
      and anonymized_at is not null
      and deletion_finalized_at is not null
  ) then
    raise exception 'Due finalizer did not anonymize public user.';
  end if;
  if (select count(*) from public.deleted_auth_identities where auth_user_id = '27000000-0000-4000-8000-000000000007') <> 1 then
    raise exception 'Deleted auth tombstone missing or duplicated after finalizer.';
  end if;
  if exists (
    select 1
    from public.deleted_auth_identities
    where auth_user_id = '27000000-0000-4000-8000-000000000007'
      and metadata::text ~* '@|full-shared-a|service_role|secret|token'
  ) then
    raise exception 'Deleted auth tombstone contains recoverable PII or secrets.';
  end if;
  if (select count(*) from public.bookings where created_by_user_id = '27000000-0000-4000-8000-000000000107') <> 1
    or (select count(*) from public.pos_tickets where salon_id = (select id from public.locations where create_request_key = 'full-shared-delete-salon')) <> 1
    or (select count(*) from public.payroll_runs where salon_id = (select id from public.locations where create_request_key = 'full-shared-delete-salon')) <> 1 then
    raise exception 'Finalizer destroyed business history.';
  end if;
  if not exists (
    select 1
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000107'
      and event_type = 'account_deletion_finalization_started'
  )
  or not exists (
    select 1
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000107'
      and event_type = 'account_anonymized'
  )
  or not exists (
    select 1
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000107'
      and event_type = 'account_deletion_finalized'
  ) then
    raise exception 'Finalizer audit events missing.';
  end if;
  perform pg_temp.pass('due account finalizer anonymizes identity and preserves history');

  v_second := public.finalize_account_deletion('27000000-0000-4000-8000-000000000107');
  if coalesce((v_second ->> 'changed')::boolean, true) is not false then
    raise exception 'Finalizer second run was not idempotent: %', v_second;
  end if;
  if (select count(*) from public.deleted_auth_identities where auth_user_id = '27000000-0000-4000-8000-000000000007') <> 1 then
    raise exception 'Finalizer second run duplicated tombstone.';
  end if;
  if (
    select count(*)
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000107'
      and event_type = 'account_deletion_finalized'
  ) <> 1 then
    raise exception 'Finalizer second run duplicated finalized audit.';
  end if;
  perform pg_temp.pass('finalizer idempotency');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000007', true);
set local role authenticated;

do $$
declare
  v_visible integer := 0;
  v_blocked boolean := false;
begin
  begin
    select count(*)
    into v_visible
    from public.deleted_auth_identities
    where auth_user_id = '27000000-0000-4000-8000-000000000007';
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked and v_visible <> 0 then
    raise exception 'Deleted auth tombstone is visible to normal authenticated user.';
  end if;
  perform pg_temp.pass('deleted-auth tombstone hidden from normal authenticated users');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000009', true);
set local role authenticated;

do $$
declare
  v_last_salon uuid;
  v_result jsonb;
begin
  select id into v_last_salon from public.locations where create_request_key = 'full-last-owner-salon';
  v_result := public.request_account_deletion(true, true, 'Continue without transfer verification');
  if (v_result ->> 'status') <> 'pending_deletion'
    or (v_result ->> 'closed_last_owner_salon_count')::integer <> 1 then
    raise exception 'Last-owner deletion with continue failed: %', v_result;
  end if;
  if (select status from public.locations where id = v_last_salon) <> 'permanently_closed' then
    raise exception 'Last-owner deletion did not permanently close salon.';
  end if;
  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_last_salon
      and event_type = 'SALON_PERMANENTLY_CLOSED'
  ) then
    raise exception 'Last-owner close audit missing.';
  end if;
  perform pg_temp.pass('delete account last owner continue closes salon atomically');

  v_result := public.cancel_account_deletion();
  if (v_result ->> 'status') <> 'active'
    or (select status from public.locations where id = v_last_salon) <> 'permanently_closed' then
    raise exception 'Cancel deletion reopened closed salon or failed: %', v_result;
  end if;
  if exists (
    select 1
    from public.users
    where id = '27000000-0000-4000-8000-000000000109'
      and (deletion_requested_at is not null or deletion_scheduled_for is not null)
  ) then
    raise exception 'Cancel deletion did not clear deletion timestamps.';
  end if;
  if not exists (
    select 1
    from public.account_lifecycle_events
    where user_id = '27000000-0000-4000-8000-000000000109'
      and event_type = 'deletion_cancelled'
  ) then
    raise exception 'Deletion cancelled audit missing.';
  end if;
  perform pg_temp.pass('cancel deletion resets account without reopening closed salon');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-00000000000a', true);
set local role authenticated;

do $$
declare
  v_unresolved_salon uuid;
  v_blocked boolean;
begin
  select id into v_unresolved_salon from public.locations where create_request_key = 'full-unresolved-salon';
  perform public.create_salon_owner_transfer_invite(
    v_unresolved_salon,
    'full-candidate@example.test',
    'transfer_ownership',
    repeat('e', 64),
    now() + interval '14 days',
    'Pending transfer only',
    true
  );

  v_blocked := false;
  begin
    perform public.request_account_deletion(false, true, 'Unaccepted transfer should not resolve');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Deletion proceeded with unresolved transfer invitation.';
  end if;
  if (select status from public.users where id = '27000000-0000-4000-8000-00000000010a') <> 'active' then
    raise exception 'Failed unresolved transfer deletion changed account status.';
  end if;
  perform pg_temp.pass('unaccepted owner transfer does not resolve deletion constraints');
end;
$$;

reset role;

do $$
begin
  update public.users
  set status = 'pending_deletion',
      deletion_requested_at = now() - interval '31 days',
      deletion_scheduled_for = now() - interval '1 day'
  where id = '27000000-0000-4000-8000-00000000010b';
end;
$$;

set local role service_role;

do $$
declare
  v_race_salon uuid;
  v_result jsonb;
begin
  select id into v_race_salon from public.locations where create_request_key = 'full-race-salon';
  v_result := public.finalize_account_deletion('27000000-0000-4000-8000-00000000010b');
  if v_result ->> 'reason' <> 'ownership_unresolved' then
    raise exception 'Finalizer did not refuse ownership race: %', v_result;
  end if;
  if (select status from public.users where id = '27000000-0000-4000-8000-00000000010b') <> 'pending_deletion'
    or (select auth_user_id from public.users where id = '27000000-0000-4000-8000-00000000010b') is null
    or (select status from public.locations where id = v_race_salon) <> 'active' then
    raise exception 'Ownership race finalizer corrupted dependent account or salon.';
  end if;
  perform pg_temp.pass('finalizer rechecks ownership and refuses race to zero-owner');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_recovery_salon uuid;
  v_blocked boolean;
begin
  select id into v_recovery_salon from public.locations where create_request_key = 'full-recovery-salon';
  perform public.close_salon_permanently(v_recovery_salon, 'Prepare recovery verification');

  v_blocked := false;
  begin
    perform public.recover_permanently_closed_salon(
      v_recovery_salon,
      '27000000-0000-4000-8000-000000000101',
      'Ordinary owner recovery should fail'
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Ordinary owner recovered permanently closed salon.';
  end if;
  perform pg_temp.pass('ordinary owner cannot invoke support recovery');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000005', true);
set local role authenticated;

do $$
declare
  v_recovery_salon uuid;
  v_blocked boolean;
begin
  select id into v_recovery_salon from public.locations where create_request_key = 'full-recovery-salon';
  v_blocked := false;
  begin
    perform public.recover_permanently_closed_salon(
      v_recovery_salon,
      '27000000-0000-4000-8000-000000000101',
      'Staff recovery should fail'
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Staff recovered permanently closed salon.';
  end if;
  perform pg_temp.pass('staff cannot invoke support recovery');
end;
$$;

reset role;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000004', true);
set local role authenticated;

do $$
declare
  v_recovery_salon uuid;
  v_blocked boolean;
begin
  select id into v_recovery_salon from public.locations where create_request_key = 'full-recovery-salon';
  v_blocked := false;
  begin
    perform public.recover_permanently_closed_salon(
      v_recovery_salon,
      '27000000-0000-4000-8000-000000000101',
      'Unrelated recovery should fail'
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unrelated user recovered permanently closed salon.';
  end if;
  perform pg_temp.pass('unrelated user cannot invoke support recovery');
end;
$$;

reset role;

do $$
begin
  insert into public.lifecycle_support_admins (user_id, granted_by_user_id, status, reason)
  values (
    '27000000-0000-4000-8000-00000000010c',
    '27000000-0000-4000-8000-000000000101',
    'active',
    'Full verification support admin'
  );
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-00000000000c', true);
set local role authenticated;

do $$
declare
  v_recovery_salon uuid;
  v_result jsonb;
begin
  v_recovery_salon := current_setting('app.test.recovery_salon')::uuid;
  v_result := public.recover_permanently_closed_salon(
    v_recovery_salon,
    '27000000-0000-4000-8000-000000000101',
    'Verified claimant approved'
  );
  if (v_result ->> 'status') <> 'disabled' then
    raise exception 'Support recovery did not restore to disabled: %', v_result;
  end if;
  perform pg_temp.pass('privileged support recovery RPC returns disabled');
end;
$$;

reset role;

do $$
declare
  v_recovery_salon uuid;
begin
  v_recovery_salon := current_setting('app.test.recovery_salon')::uuid;

  if (select status from public.locations where id = v_recovery_salon) <> 'disabled' then
    raise exception 'Support recovery did not persist disabled salon status.';
  end if;

  if not exists (
    select 1
    from public.salon_lifecycle_events
    where salon_id = v_recovery_salon
      and event_type = 'SALON_RECOVERY_APPROVED'
      and actor_user_id = '27000000-0000-4000-8000-00000000010c'
      and metadata ->> 'claimant_user_id' = '27000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'Support recovery audit missing claimant/actor metadata.';
  end if;
  perform pg_temp.pass('privileged support recovery persists disabled status and audit');
end;
$$;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000004', true);
set local role authenticated;

do $$
declare
  v_owner_a uuid := '27000000-0000-4000-8000-000000000101';
  v_blocked boolean;
begin
  if (select count(*) from storage.objects where bucket_id = 'lifecycle-exports' and name like v_owner_a::text || '/%') <> 0 then
    raise exception 'Unrelated user can read owner private export object.';
  end if;

  v_blocked := false;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('lifecycle-exports', v_owner_a::text || '/forged.json', '{}'::jsonb);
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'Unrelated user inserted object under owner export prefix.';
  end if;
  perform pg_temp.pass('unauthorized user cannot retrieve or forge private export object');
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'disable_salon',
        'reactivate_salon',
        'close_salon_permanently',
        'request_account_deletion',
        'cancel_account_deletion',
        'create_salon_owner_transfer_invite',
        'accept_salon_owner_transfer_invite',
        'get_account_deletion_owner_counts',
        'finalize_account_deletion',
        'recover_permanently_closed_salon'
      )
      and p.prosecdef
      and 'search_path=public' = any(coalesce(p.proconfig, array[]::text[]))
  ) then
    raise exception 'Expected lifecycle SECURITY DEFINER functions with search_path not found.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('finalize_account_deletion', 'finalize_due_account_deletions', 'lifecycle_remove_owner_access_from_salon')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception 'Authenticated still has execute on service-only/internal lifecycle functions.';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'disable_salon',
        'reactivate_salon',
        'close_salon_permanently',
        'request_account_deletion',
        'cancel_account_deletion',
        'create_salon_owner_transfer_invite',
        'accept_salon_owner_transfer_invite',
        'get_account_deletion_owner_counts',
        'finalize_account_deletion',
        'finalize_due_account_deletions',
        'lifecycle_remove_owner_access_from_salon',
        'recover_permanently_closed_salon'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'Anon still has execute on lifecycle RPC functions.';
  end if;

  if exists (
    select 1
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name in ('salon_lifecycle_events', 'account_lifecycle_events', 'lifecycle_exports', 'deleted_auth_identities', 'lifecycle_support_admins', 'salon_owner_transfer_invites')
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'TRIGGER')
  ) then
    raise exception 'Anon/authenticated still have lifecycle maintenance table grants.';
  end if;

  if exists (
    select 1
    from public.account_memberships memberships
    left join public.roles roles on roles.id = memberships.role_id
    left join public.users users on users.id = memberships.user_id
    where memberships.account_id::text like '27000000-0000-4000-8000-000000001%'
      and (roles.id is null or users.id is null)
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    left join public.roles roles on roles.id = memberships.role_id
    left join public.users users on users.id = memberships.user_id
    where memberships.account_id::text like '27000000-0000-4000-8000-000000001%'
      and (roles.id is null or users.id is null)
  ) then
    raise exception 'Ownership/membership orphan references found.';
  end if;

  if (
    select count(*)
    from public.users
    where auth_user_id = '27000000-0000-4000-8000-000000000001'
      and status = 'active'
  ) <> 1 then
    raise exception 'Active auth user does not resolve exactly one public user.';
  end if;

  if (
    select count(*)
    from public.users
    where auth_user_id = '27000000-0000-4000-8000-000000000006'
      and status = 'pending_deletion'
  ) <> 1 then
    raise exception 'Pending-deletion auth user does not resolve to expected public row.';
  end if;

  if exists (
    select 1
    from public.users
    where auth_user_id = '27000000-0000-4000-8000-000000000007'
      and status = 'active'
  ) then
    raise exception 'Finalized auth identity still resolves as active public user.';
  end if;

  if not public.auth_identity_is_deleted('27000000-0000-4000-8000-000000000007') then
    perform set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000007', true);
    if not public.auth_identity_is_deleted('27000000-0000-4000-8000-000000000007') then
      raise exception 'Deleted auth identity tombstone does not resolve through helper.';
    end if;
  end if;

  perform pg_temp.pass('security definer search_path and explicit grants verified');
  perform pg_temp.pass('membership references remain structurally valid');
  perform pg_temp.pass('auth users to public users identity integrity');
end;
$$;

select count(*) as account_lifecycle_full_verification_passed
from verification_assertions;

rollback;
