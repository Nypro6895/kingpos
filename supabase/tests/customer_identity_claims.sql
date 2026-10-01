begin;

do $$
declare
  v_account uuid := '23000000-0000-4000-8000-000000000001';
  v_owner_auth uuid := '23000000-0000-4000-8000-000000000002';
  v_user_a_auth uuid := '23000000-0000-4000-8000-000000000003';
  v_user_b_auth uuid := '23000000-0000-4000-8000-000000000004';
  v_user_c_auth uuid := '23000000-0000-4000-8000-000000000005';
  v_owner uuid := '23000000-0000-4000-8000-000000000006';
  v_user_a uuid := '23000000-0000-4000-8000-000000000007';
  v_user_b uuid := '23000000-0000-4000-8000-000000000008';
  v_user_c uuid := '23000000-0000-4000-8000-000000000009';
  v_salon_a uuid := '23000000-0000-4000-8000-000000000010';
  v_salon_b uuid := '23000000-0000-4000-8000-000000000011';
  v_customer_a uuid := '23000000-0000-4000-8000-000000000012';
  v_customer_b uuid := '23000000-0000-4000-8000-000000000013';
  v_customer_auto uuid := '23000000-0000-4000-8000-000000000014';
  v_customer_other uuid := '23000000-0000-4000-8000-000000000015';
  v_customer_unverified uuid := '23000000-0000-4000-8000-000000000016';
  v_customer_otp uuid := '23000000-0000-4000-8000-000000000020';
  v_customer_auth_confirmed uuid := '23000000-0000-4000-8000-000000000022';
  v_ticket_a uuid := '23000000-0000-4000-8000-000000000017';
  v_ticket_b uuid := '23000000-0000-4000-8000-000000000018';
  v_ticket_unrelated uuid := '23000000-0000-4000-8000-000000000019';
  v_ticket_otp uuid := '23000000-0000-4000-8000-000000000021';
  v_ticket_auth_confirmed uuid := '23000000-0000-4000-8000-000000000023';
  v_owner_role uuid;
  v_before_auth_id uuid;
  v_after_auth_id uuid;
  v_claim jsonb;
  v_claim_token text;
  v_otp_challenge uuid;
  v_activity jsonb;
  v_confirmed_at timestamptz;
begin
  insert into auth.users (id, email)
  values
    (v_owner_auth, 'claim-owner@example.test'),
    (v_user_a_auth, 'claim-a@example.test'),
    (v_user_b_auth, 'claim-b@example.test'),
    (v_user_c_auth, 'claim-c@example.test');

  insert into public.users (id, auth_user_id, email, display_name, status)
  values
    (v_owner, v_owner_auth, 'claim-owner@example.test', 'Claim Owner', 'active'),
    (v_user_a, v_user_a_auth, 'claim-a@example.test', 'Claim A', 'active'),
    (v_user_b, v_user_b_auth, 'claim-b@example.test', 'Claim B', 'active'),
    (v_user_c, v_user_c_auth, 'claim-c@example.test', 'Claim C', 'active');

  insert into public.accounts (id, name, status)
  values (v_account, 'Claim Account', 'active');
  perform public.seed_default_roles_for_account(v_account);

  select id
  into v_owner_role
  from public.roles
  where account_id = v_account
    and code = 'OWNER';

  insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
  values (v_account, v_owner, v_owner_role, 'active', now());

  insert into public.locations (id, account_id, name, status, country)
  values
    (v_salon_a, v_account, 'Claim Salon A', 'active', 'US'),
    (v_salon_b, v_account, 'Claim Salon B', 'active', 'US');

  insert into public.customers (id, location_id, name, phone, status)
  values
    (v_customer_a, v_salon_a, 'Claim Customer A', '(469) 555-1234', 'active'),
    (v_customer_b, v_salon_b, 'Claim Customer B', '4695551234', 'active');

  insert into public.customers (id, location_id, customer_user_id, name, phone, status)
  values
    (v_customer_other, v_salon_b, v_user_b, 'Already Linked Other', '+14695551234', 'active');

  insert into public.pos_tickets (
    id,
    salon_id,
    customer_id,
    ticket_number,
    opened_at,
    closed_at,
    status
  )
  values
    (v_ticket_a, v_salon_a, v_customer_a, 'CLAIM-A', now() - interval '2 days', now() - interval '2 days', 'closed'),
    (v_ticket_b, v_salon_b, v_customer_b, 'CLAIM-B', now() - interval '1 day', now() - interval '1 day', 'closed'),
    (v_ticket_unrelated, v_salon_b, v_customer_other, 'CLAIM-OTHER', now() - interval '1 day', now() - interval '1 day', 'closed');

  perform set_config('request.jwt.claim.sub', v_owner_auth::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_claim := public.issue_customer_claim_token(v_customer_a, v_ticket_a, 1800);
  if v_claim ->> 'ok' <> 'true' or nullif(v_claim ->> 'token', '') is null then
    raise exception 'Owner could not issue a QR claim token: %', v_claim;
  end if;
  v_claim_token := v_claim ->> 'token';

  perform set_config('request.jwt.claim.sub', v_user_a_auth::text, true);

  v_claim := public.claim_customer_from_token(v_claim_token);
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Valid unclaimed QR token did not claim: %', v_claim;
  end if;

  if (select customer_user_id from public.customers where id = v_customer_a) <> v_user_a then
    raise exception 'QR target customer was not linked to the claiming user.';
  end if;

  if (select customer_user_id from public.customers where id = v_customer_b) <> v_user_a then
    raise exception 'Cross-salon unclaimed same-phone customer was not claimed after QR phone proof.';
  end if;

  if (select customer_user_id from public.customers where id = v_customer_other) <> v_user_b then
    raise exception 'Claim overwrote a customer already linked to another user.';
  end if;

  v_claim := public.claim_customer_from_token(v_claim_token);
  if v_claim ->> 'code' <> 'token_used' then
    raise exception 'Reused token did not fail as token_used: %', v_claim;
  end if;

  insert into public.customer_claim_tokens (
    token_hash,
    salon_id,
    customer_id,
    ticket_id,
    issued_by_user_id,
    expires_at
  )
  values (
    public.customer_claim_token_hash('fresh-idempotent-token'),
    v_salon_a,
    v_customer_a,
    v_ticket_a,
    v_owner,
    now() + interval '15 minutes'
  );

  v_claim := public.claim_customer_from_token('fresh-idempotent-token');
  if v_claim ->> 'ok' <> 'true' or v_claim ->> 'idempotent' <> 'true' then
    raise exception 'Fresh token against already owned target was not idempotent: %', v_claim;
  end if;

  insert into public.customer_claim_tokens (
    token_hash,
    salon_id,
    customer_id,
    ticket_id,
    issued_by_user_id,
    expires_at
  )
  values (
    public.customer_claim_token_hash('expired-token'),
    v_salon_a,
    v_customer_a,
    v_ticket_a,
    v_owner,
    now() - interval '1 minute'
  );

  v_claim := public.claim_customer_from_token('expired-token');
  if v_claim ->> 'code' <> 'expired_token' then
    raise exception 'Expired token did not fail: %', v_claim;
  end if;

  insert into public.customer_claim_tokens (
    token_hash,
    salon_id,
    customer_id,
    ticket_id,
    issued_by_user_id,
    expires_at
  )
  values (
    public.customer_claim_token_hash('other-owned-token'),
    v_salon_b,
    v_customer_other,
    v_ticket_unrelated,
    v_owner,
    now() + interval '15 minutes'
  );

  v_claim := public.claim_customer_from_token('other-owned-token');
  if v_claim ->> 'code' <> 'customer_unavailable' then
    raise exception 'Other-owned customer token did not return conflict: %', v_claim;
  end if;

  insert into public.customers (id, location_id, name, phone, status)
  values (v_customer_auto, v_salon_b, 'Future Auto Link', '+1 (469) 555-1234', 'active');

  if (select customer_user_id from public.customers where id = v_customer_auto) <> v_user_a then
    raise exception 'Future same-phone customer did not auto-link after verified ownership.';
  end if;

  insert into public.customers (id, location_id, name, phone, status)
  values (v_customer_unverified, v_salon_a, 'Unverified Remote', '(214) 555-0000', 'active');

  insert into public.customers (id, location_id, name, phone, status)
  values (v_customer_otp, v_salon_a, 'OTP Remote', '(214) 555-0001', 'active');

  insert into public.customers (id, location_id, name, phone, status)
  values (
    v_customer_auth_confirmed,
    v_salon_a,
    'Confirmed Auth Remote',
    '(214) 555-0003',
    'active'
  );

  insert into public.pos_tickets (
    id,
    salon_id,
    customer_id,
    ticket_number,
    opened_at,
    closed_at,
    status
  )
  values (
    v_ticket_otp,
    v_salon_a,
    v_customer_otp,
    'CLAIM-OTP',
    now() - interval '3 hours',
    now() - interval '3 hours',
    'closed'
  );

  insert into public.pos_tickets (
    id,
    salon_id,
    customer_id,
    ticket_number,
    opened_at,
    closed_at,
    status
  )
  values (
    v_ticket_auth_confirmed,
    v_salon_a,
    v_customer_auth_confirmed,
    'CLAIM-AUTH-CONFIRMED',
    now() - interval '2 hours',
    now() - interval '2 hours',
    'closed'
  );

  perform set_config('request.jwt.claim.sub', v_user_b_auth::text, true);
  v_claim := public.claim_customers_for_verified_phone('+12145550000');
  if v_claim ->> 'code' <> 'unverified_phone' then
    raise exception 'Unverified remote phone was allowed to claim: %', v_claim;
  end if;

  update auth.users
  set phone = '+12145550003',
      phone_confirmed_at = now()
  where id = v_user_b_auth;

  v_claim := public.record_customer_verified_phone_from_auth('+12145550003');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Confirmed Auth phone did not create verified phone record: %', v_claim;
  end if;

  if exists (
    select 1
    from public.customer_phone_otp_challenges
    where user_id = v_user_b
      and normalized_phone = '+12145550003'
  ) then
    raise exception 'Confirmed Auth phone bypass created an OTP challenge.';
  end if;

  v_claim := public.claim_customers_for_verified_phone('+12145550003');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Confirmed Auth phone did not claim eligible records: %', v_claim;
  end if;

  if (
    select customer_user_id
    from public.customers
    where id = v_customer_auth_confirmed
  ) <> v_user_b then
    raise exception 'Confirmed Auth phone did not link the matching unowned customer.';
  end if;

  v_claim := public.record_customer_verified_phone_from_auth('+12145550003');
  if v_claim ->> 'ok' <> 'true' or v_claim ->> 'idempotent' <> 'true' then
    raise exception 'Repeated confirmed Auth phone record was not idempotent: %', v_claim;
  end if;

  v_claim := public.claim_customers_for_verified_phone('+12145550003');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Repeated confirmed Auth phone claim was not idempotent: %', v_claim;
  end if;

  v_claim := public.record_customer_verified_phone_from_auth('+12145550004');
  if v_claim ->> 'code' <> 'unverified_phone' then
    raise exception 'Different Auth phone was allowed to bypass OTP: %', v_claim;
  end if;

  update auth.users
  set phone = '+12145550004',
      phone_confirmed_at = null
  where id = v_user_b_auth;

  v_claim := public.record_customer_verified_phone_from_auth('+12145550004');
  if v_claim ->> 'code' <> 'unverified_phone' then
    raise exception 'Unconfirmed Auth phone was allowed to bypass OTP: %', v_claim;
  end if;

  v_claim := public.begin_customer_phone_otp_challenge('+12145550000', 'supabase-auth');
  if v_claim ->> 'ok' <> 'true' or v_claim ->> 'status' <> 'pending' then
    raise exception 'OTP challenge did not start: %', v_claim;
  end if;
  v_otp_challenge := (v_claim ->> 'challengeId')::uuid;

  v_claim := public.begin_customer_phone_otp_challenge('+12145550000', 'supabase-auth');
  if v_claim ->> 'code' <> 'send_throttled' then
    raise exception 'Immediate OTP resend was not throttled: %', v_claim;
  end if;

  update public.customer_phone_otp_challenges
  set expires_at = now() - interval '1 minute'
  where id = v_otp_challenge;

  v_claim := public.begin_customer_phone_otp_verification('+12145550000');
  if v_claim ->> 'code' <> 'invalid_or_expired_code' then
    raise exception 'Expired OTP challenge was not rejected: %', v_claim;
  end if;

  v_claim := public.begin_customer_phone_otp_challenge('+12145550002', 'supabase-auth');
  v_otp_challenge := (v_claim ->> 'challengeId')::uuid;
  for i in 1..5 loop
    perform public.record_customer_phone_otp_verify_failure(v_otp_challenge);
  end loop;

  v_claim := public.begin_customer_phone_otp_verification('+12145550002');
  if v_claim ->> 'code' <> 'too_many_attempts' then
    raise exception 'Wrong OTP attempts did not lock verification: %', v_claim;
  end if;

  v_claim := public.begin_customer_phone_otp_challenge('+12145550001', 'supabase-auth');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Correct-code OTP challenge did not start: %', v_claim;
  end if;
  v_otp_challenge := (v_claim ->> 'challengeId')::uuid;

  v_claim := public.record_customer_verified_phone_from_auth('+12145550001');
  if v_claim ->> 'code' <> 'unverified_phone' then
    raise exception 'Verified phone was recorded before provider confirmation: %', v_claim;
  end if;

  select current_setting('request.jwt.claim.sub', true)::uuid
  into v_before_auth_id;

  update auth.users
  set phone = '+12145550001',
      phone_confirmed_at = now()
  where id = v_user_b_auth;

  select id, phone_confirmed_at
  into v_after_auth_id, v_confirmed_at
  from auth.users
  where id = v_user_b_auth;

  if v_after_auth_id <> v_before_auth_id then
    raise exception 'Phone change verification changed auth user id.';
  end if;

  if v_confirmed_at is null then
    raise exception 'Phone change verification did not set phone_confirmed_at.';
  end if;

  v_claim := public.record_customer_verified_phone_from_auth('+12145550001');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Confirmed provider phone was not recorded: %', v_claim;
  end if;

  if not exists (
    select 1
    from public.customer_verified_phones
    where user_id = v_user_b
      and phone = '+12145550001'
  ) then
    raise exception 'Verified phone record was not created after provider confirmation.';
  end if;

  perform public.complete_customer_phone_otp_challenge(v_otp_challenge);

  v_claim := public.claim_customers_for_verified_phone('+12145550001');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Verified OTP phone did not claim eligible records: %', v_claim;
  end if;

  if (select customer_user_id from public.customers where id = v_customer_otp) <> v_user_b then
    raise exception 'Verified OTP phone did not link the matching unowned customer.';
  end if;

  v_claim := public.begin_customer_phone_otp_challenge('+12145550001', 'supabase-auth');
  if v_claim ->> 'status' <> 'already_verified' then
    raise exception 'Already verified phone would trigger repeated SMS: %', v_claim;
  end if;

  update auth.users
  set phone = '+14695551234',
      phone_confirmed_at = now()
  where id = v_user_b_auth;

  v_claim := public.record_customer_verified_phone_from_auth('+14695551234');
  if v_claim ->> 'code' <> 'phone_conflict' then
    raise exception 'Verified phone conflict was not blocked: %', v_claim;
  end if;

  update auth.users
  set phone = null,
      phone_confirmed_at = null
  where id = v_user_b_auth;

  perform set_config('request.jwt.claim.sub', v_user_a_auth::text, true);
  v_activity := public.get_customer_activity(20);
  if v_activity ->> 'ok' <> 'true'
    or (v_activity::text not like '%' || v_ticket_a::text || '%')
    or (v_activity::text not like '%' || v_ticket_b::text || '%')
  then
    raise exception 'Claimed activity did not include newly linked POS history: %', v_activity;
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b_auth::text, true);
  v_activity := public.get_customer_activity(20);
  if v_activity::text like '%' || v_ticket_a::text || '%' then
    raise exception 'Unrelated user could see claimed ticket history: %', v_activity;
  end if;

  update public.users
  set status = 'inactive'
  where id = v_user_a;

  if (select count(*) from public.customers where customer_user_id = v_user_a) = 0 then
    raise exception 'Pending/non-final status released customer links.';
  end if;

  update public.users
  set status = 'active'
  where id = v_user_a;

  update public.users
  set status = 'deleted'
  where id = v_user_a;

  if exists (select 1 from public.customer_verified_phones where user_id = v_user_a) then
    raise exception 'Final deletion did not remove verified phone ownership.';
  end if;

  if exists (select 1 from public.customers where customer_user_id = v_user_a) then
    raise exception 'Final deletion did not release customer ownership links.';
  end if;

  if not exists (select 1 from public.pos_tickets where id = v_ticket_a) then
    raise exception 'Final deletion removed canonical POS business history.';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_c_auth::text, true);

  v_claim := public.claim_customers_for_verified_phone('+14695551234');
  if v_claim ->> 'code' <> 'unverified_phone' then
    raise exception 'New account silently inherited deleted-account history: %', v_claim;
  end if;

  update auth.users
  set phone = '+14695551234',
      phone_confirmed_at = now()
  where id = v_user_c_auth;

  v_claim := public.record_customer_verified_phone_from_auth('+14695551234');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Re-verified new account did not record phone ownership: %', v_claim;
  end if;

  perform set_config('request.jwt.claim.sub', v_user_c_auth::text, true);

  v_claim := public.claim_customers_for_verified_phone('+14695551234');
  if v_claim ->> 'ok' <> 'true' then
    raise exception 'Re-verified new account could not reclaim released history: %', v_claim;
  end if;
end;
$$;

rollback;
