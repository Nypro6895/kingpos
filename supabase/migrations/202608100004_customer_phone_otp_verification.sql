create table if not exists public.customer_phone_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  normalized_phone text not null,
  provider text not null default 'supabase-auth',
  status text not null default 'pending',
  sent_count integer not null default 1,
  failed_attempt_count integer not null default 0,
  first_sent_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  locked_until timestamptz,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_phone_otp_challenges_phone_check check (
    normalized_phone = public.normalize_customer_claim_phone(normalized_phone)
  ),
  constraint customer_phone_otp_challenges_provider_check check (
    provider in ('supabase-auth')
  ),
  constraint customer_phone_otp_challenges_status_check check (
    status in ('pending', 'verified', 'expired', 'send_failed')
  ),
  constraint customer_phone_otp_challenges_sent_count_check check (sent_count >= 0),
  constraint customer_phone_otp_challenges_failed_count_check check (
    failed_attempt_count >= 0
  )
);

create index if not exists customer_phone_otp_challenges_user_phone_idx
on public.customer_phone_otp_challenges(user_id, normalized_phone, created_at desc);

create index if not exists customer_phone_otp_challenges_pending_idx
on public.customer_phone_otp_challenges(expires_at)
where status = 'pending';

drop trigger if exists set_customer_phone_otp_challenges_updated_at
on public.customer_phone_otp_challenges;

create trigger set_customer_phone_otp_challenges_updated_at
before update on public.customer_phone_otp_challenges
for each row execute function public.set_updated_at();

alter table public.customer_phone_otp_challenges enable row level security;

revoke all on table public.customer_phone_otp_challenges from public;

create or replace function public.customer_phone_otp_retry_after_seconds(
  p_until timestamptz
)
returns integer
language sql
stable
set search_path = public
as $$
  select greatest(0, ceil(extract(epoch from (p_until - now())))::integer)
$$;

create or replace function public.begin_customer_phone_otp_challenge(
  p_phone text,
  p_provider text default 'supabase-auth'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  challenge_row public.customer_phone_otp_challenges%rowtype;
  cooldown_until timestamptz;
  delivery_mode text := 'initial';
  locked_until_value timestamptz;
  normalized_phone_value text := public.normalize_customer_claim_phone(p_phone);
  resend_cooldown interval := interval '60 seconds';
  resend_limit integer := 3;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if coalesce(p_provider, '') <> 'supabase-auth' then
    return jsonb_build_object('ok', false, 'code', 'database_error');
  end if;

  if exists (
    select 1
    from public.customer_verified_phones verified
    join public.users owner_user on owner_user.id = verified.user_id
    where verified.user_id = actor_user_id
      and verified.normalized_phone = normalized_phone_value
      and owner_user.status = 'active'
  ) then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_verified',
      'normalizedPhone', normalized_phone_value,
      'resendAfterSeconds', 0
    );
  end if;

  select *
  into challenge_row
  from public.customer_phone_otp_challenges challenges
  where challenges.user_id = actor_user_id
    and challenges.normalized_phone = normalized_phone_value
    and challenges.status = 'pending'
  order by challenges.created_at desc
  limit 1
  for update;

  if challenge_row.id is not null then
    if challenge_row.locked_until is not null
      and challenge_row.locked_until > now()
    then
      return jsonb_build_object(
        'ok', false,
        'code', 'too_many_attempts',
        'retryAfterSeconds',
        public.customer_phone_otp_retry_after_seconds(challenge_row.locked_until)
      );
    end if;

    if challenge_row.expires_at <= now() then
      update public.customer_phone_otp_challenges
      set status = 'expired'
      where id = challenge_row.id;

      challenge_row.id := null;
    else
      cooldown_until := challenge_row.last_sent_at + resend_cooldown;

      if cooldown_until > now() then
        return jsonb_build_object(
          'ok', false,
          'code', 'send_throttled',
          'retryAfterSeconds',
          public.customer_phone_otp_retry_after_seconds(cooldown_until)
        );
      end if;

      if challenge_row.sent_count >= resend_limit then
        locked_until_value := now() + interval '15 minutes';

        update public.customer_phone_otp_challenges
        set locked_until = locked_until_value,
            metadata = metadata || jsonb_build_object('locked_reason', 'resend_limit')
        where id = challenge_row.id;

        return jsonb_build_object(
          'ok', false,
          'code', 'too_many_attempts',
          'retryAfterSeconds',
          public.customer_phone_otp_retry_after_seconds(locked_until_value)
        );
      end if;

      update public.customer_phone_otp_challenges
      set sent_count = sent_count + 1,
          last_sent_at = now(),
          expires_at = now() + interval '10 minutes'
      where id = challenge_row.id
      returning * into challenge_row;

      delivery_mode := 'resend';
    end if;
  end if;

  if challenge_row.id is null then
    insert into public.customer_phone_otp_challenges (
      user_id,
      normalized_phone,
      provider,
      status,
      sent_count,
      failed_attempt_count,
      first_sent_at,
      last_sent_at,
      expires_at
    )
    values (
      actor_user_id,
      normalized_phone_value,
      'supabase-auth',
      'pending',
      1,
      0,
      now(),
      now(),
      now() + interval '10 minutes'
    )
    returning * into challenge_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'challengeId', challenge_row.id,
    'deliveryMode', delivery_mode,
    'normalizedPhone', normalized_phone_value,
    'expiresAt', challenge_row.expires_at,
    'resendAfterSeconds', 60
  );
end;
$$;

create or replace function public.record_customer_phone_otp_send_failed(
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  update public.customer_phone_otp_challenges
  set status = 'send_failed',
      metadata = metadata || jsonb_build_object('send_failed_at', now())
  where id = p_challenge_id
    and user_id = actor_user_id
    and status = 'pending';

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.begin_customer_phone_otp_verification(
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  challenge_row public.customer_phone_otp_challenges%rowtype;
  locked_until_value timestamptz;
  normalized_phone_value text := public.normalize_customer_claim_phone(p_phone);
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  select *
  into challenge_row
  from public.customer_phone_otp_challenges challenges
  where challenges.user_id = actor_user_id
    and challenges.normalized_phone = normalized_phone_value
    and challenges.status = 'pending'
  order by challenges.created_at desc
  limit 1
  for update;

  if challenge_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_or_expired_code');
  end if;

  if challenge_row.expires_at <= now() then
    update public.customer_phone_otp_challenges
    set status = 'expired'
    where id = challenge_row.id;

    return jsonb_build_object('ok', false, 'code', 'invalid_or_expired_code');
  end if;

  if challenge_row.locked_until is not null
    and challenge_row.locked_until > now()
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'too_many_attempts',
      'retryAfterSeconds',
      public.customer_phone_otp_retry_after_seconds(challenge_row.locked_until)
    );
  end if;

  if challenge_row.failed_attempt_count >= 5 then
    locked_until_value := now() + interval '15 minutes';

    update public.customer_phone_otp_challenges
    set locked_until = locked_until_value,
        metadata = metadata || jsonb_build_object('locked_reason', 'attempt_limit')
    where id = challenge_row.id;

    return jsonb_build_object(
      'ok', false,
      'code', 'too_many_attempts',
      'retryAfterSeconds',
      public.customer_phone_otp_retry_after_seconds(locked_until_value)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'challengeId', challenge_row.id,
    'normalizedPhone', normalized_phone_value
  );
end;
$$;

create or replace function public.record_customer_phone_otp_verify_failure(
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  challenge_row public.customer_phone_otp_challenges%rowtype;
  next_failed_count integer;
  next_locked_until timestamptz;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select *
  into challenge_row
  from public.customer_phone_otp_challenges challenges
  where challenges.id = p_challenge_id
    and challenges.user_id = actor_user_id
    and challenges.status = 'pending'
  for update;

  if challenge_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_or_expired_code');
  end if;

  next_failed_count := challenge_row.failed_attempt_count + 1;

  if next_failed_count >= 5 then
    next_locked_until := now() + interval '15 minutes';
  end if;

  update public.customer_phone_otp_challenges
  set failed_attempt_count = next_failed_count,
      locked_until = coalesce(next_locked_until, locked_until),
      metadata = metadata || jsonb_build_object('last_failed_at', now())
  where id = challenge_row.id;

  return jsonb_build_object(
    'ok', true,
    'locked', next_locked_until is not null,
    'retryAfterSeconds',
    public.customer_phone_otp_retry_after_seconds(next_locked_until)
  );
end;
$$;

create or replace function public.record_customer_verified_phone_from_auth(
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  actor_user_id uuid := public.current_public_user_id();
  auth_confirmed_at timestamptz;
  auth_normalized_phone text;
  normalized_phone_value text := public.normalize_customer_claim_phone(p_phone);
begin
  if actor_auth_user_id is null or actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  select
    public.normalize_customer_claim_phone(auth_user.phone),
    auth_user.phone_confirmed_at
  into auth_normalized_phone, auth_confirmed_at
  from auth.users auth_user
  where auth_user.id = actor_auth_user_id;

  if auth_normalized_phone is distinct from normalized_phone_value
    or auth_confirmed_at is null
  then
    return jsonb_build_object('ok', false, 'code', 'unverified_phone');
  end if;

  return public.record_customer_verified_phone_for_claim(
    actor_user_id,
    normalized_phone_value,
    'otp'
  );
end;
$$;

create or replace function public.complete_customer_phone_otp_challenge(
  p_challenge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  update public.customer_phone_otp_challenges
  set status = 'verified',
      verified_at = now(),
      failed_attempt_count = 0,
      locked_until = null
  where id = p_challenge_id
    and user_id = actor_user_id
    and status = 'pending';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.customer_phone_otp_retry_after_seconds(timestamptz) from public;
revoke all on function public.begin_customer_phone_otp_challenge(text, text) from public;
revoke all on function public.record_customer_phone_otp_send_failed(uuid) from public;
revoke all on function public.begin_customer_phone_otp_verification(text) from public;
revoke all on function public.record_customer_phone_otp_verify_failure(uuid) from public;
revoke all on function public.record_customer_verified_phone_from_auth(text) from public;
revoke all on function public.complete_customer_phone_otp_challenge(uuid) from public;

grant execute on function public.begin_customer_phone_otp_challenge(text, text) to authenticated;
grant execute on function public.record_customer_phone_otp_send_failed(uuid) to authenticated;
grant execute on function public.begin_customer_phone_otp_verification(text) to authenticated;
grant execute on function public.record_customer_phone_otp_verify_failure(uuid) to authenticated;
grant execute on function public.record_customer_verified_phone_from_auth(text) to authenticated;
grant execute on function public.complete_customer_phone_otp_challenge(uuid) to authenticated;
