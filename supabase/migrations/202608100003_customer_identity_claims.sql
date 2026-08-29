create or replace function public.normalize_customer_claim_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  trimmed_phone text := btrim(coalesce(p_phone, ''));
  phone_digits text := regexp_replace(btrim(coalesce(p_phone, '')), '\D', '', 'g');
begin
  if trimmed_phone = '' or phone_digits = '' then
    return null;
  end if;

  if length(phone_digits) = 10 then
    return '+1' || phone_digits;
  end if;

  if length(phone_digits) = 11 and left(phone_digits, 1) = '1' then
    return '+' || phone_digits;
  end if;

  if left(trimmed_phone, 1) = '+'
    and length(phone_digits) >= 10
    and length(phone_digits) <= 15
  then
    return '+' || phone_digits;
  end if;

  if length(phone_digits) >= 10 and length(phone_digits) <= 15 then
    return '+' || phone_digits;
  end if;

  return null;
end;
$$;

create or replace function public.customer_claim_token_hash(p_token text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(coalesce(p_token, '')), '') is null then null
    else encode(extensions.digest(btrim(p_token), 'sha256'), 'hex')
  end
$$;

alter table public.customers
add column customer_account_claimed_at timestamptz,
add column customer_account_claim_method text,
add column customer_account_claim_metadata jsonb not null default '{}'::jsonb,
add constraint customers_customer_account_claim_method_check check (
  customer_account_claim_method is null
  or customer_account_claim_method in (
    'qr',
    'verified_phone',
    'auto_verified_phone',
    'manual_account_link',
    'deleted_account_release'
  )
);

create index customers_claim_normalized_phone_idx
on public.customers(public.normalize_customer_claim_phone(phone))
where phone is not null;

create table public.customer_verified_phones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  normalized_phone text not null,
  verified_at timestamptz not null default now(),
  verification_method text not null,
  last_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_verified_phones_phone_check check (
    normalized_phone = public.normalize_customer_claim_phone(normalized_phone)
  ),
  constraint customer_verified_phones_method_check check (
    verification_method in ('qr', 'otp', 'auth_phone')
  )
);

create unique index customer_verified_phones_normalized_phone_uidx
on public.customer_verified_phones(normalized_phone);
create unique index customer_verified_phones_user_phone_uidx
on public.customer_verified_phones(user_id, normalized_phone);
create index customer_verified_phones_user_verified_idx
on public.customer_verified_phones(user_id, verified_at desc);

create trigger set_customer_verified_phones_updated_at
before update on public.customer_verified_phones
for each row execute function public.set_updated_at();

create table public.customer_account_claims (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete cascade,
  claim_method text not null,
  proof_type text not null,
  claim_status text not null default 'linked',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint customer_account_claims_method_check check (
    claim_method in ('qr', 'verified_phone', 'auto_link')
  ),
  constraint customer_account_claims_proof_type_check check (
    proof_type in ('customer_claim_token', 'verified_phone_ownership')
  ),
  constraint customer_account_claims_status_check check (
    claim_status in ('linked', 'idempotent')
  )
);

create unique index customer_account_claims_user_method_uidx
on public.customer_account_claims(customer_id, customer_user_id, claim_method);
create index customer_account_claims_user_created_idx
on public.customer_account_claims(customer_user_id, created_at desc);
create index customer_account_claims_salon_created_idx
on public.customer_account_claims(salon_id, created_at desc);

create table public.customer_claim_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  salon_id uuid not null references public.locations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  ticket_id uuid references public.pos_tickets(id) on delete set null,
  issued_by_user_id uuid references public.users(id) on delete set null,
  claimed_by_user_id uuid references public.users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customer_claim_tokens_customer_idx
on public.customer_claim_tokens(customer_id, created_at desc);
create index customer_claim_tokens_ticket_idx
on public.customer_claim_tokens(ticket_id)
where ticket_id is not null;
create index customer_claim_tokens_unexpired_idx
on public.customer_claim_tokens(expires_at)
where used_at is null and revoked_at is null;

create trigger set_customer_claim_tokens_updated_at
before update on public.customer_claim_tokens
for each row execute function public.set_updated_at();

alter table public.customer_verified_phones enable row level security;
alter table public.customer_account_claims enable row level security;
alter table public.customer_claim_tokens enable row level security;

create policy "customer_verified_phones_self_read"
on public.customer_verified_phones
for select to authenticated
using (user_id = public.current_public_user_id());

create policy "customer_account_claims_participant_read"
on public.customer_account_claims
for select to authenticated
using (
  customer_user_id = public.current_public_user_id()
  or public.user_has_salon_permission(salon_id, array['customers.manage', 'tickets.view'])
);

create or replace function public.prepare_customer_account_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.customer_user_id is not null
    and new.customer_user_id is not null
    and new.customer_user_id is distinct from old.customer_user_id
  then
    raise exception 'Customer account link cannot be reassigned.';
  end if;

  if new.customer_user_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    or new.customer_user_id is distinct from old.customer_user_id
  then
    new.customer_account_claimed_at := coalesce(new.customer_account_claimed_at, now());
    new.customer_account_claim_method := coalesce(
      new.customer_account_claim_method,
      'manual_account_link'
    );
    new.customer_account_claim_metadata := coalesce(
      new.customer_account_claim_metadata,
      '{}'::jsonb
    ) || jsonb_build_object('source', new.source);
  end if;

  return new;
end;
$$;

create trigger prepare_customer_account_claim
before insert or update of customer_user_id on public.customers
for each row execute function public.prepare_customer_account_claim();

create or replace function public.auto_link_customer_to_verified_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone_value text;
  verified_owner_id uuid;
begin
  if new.customer_user_id is not null then
    return new;
  end if;

  normalized_phone_value := public.normalize_customer_claim_phone(new.phone);

  if normalized_phone_value is null then
    return new;
  end if;

  select verified.user_id
  into verified_owner_id
  from public.customer_verified_phones verified
  join public.users owner_user on owner_user.id = verified.user_id
  where verified.normalized_phone = normalized_phone_value
    and owner_user.status = 'active'
  order by verified.verified_at desc
  limit 1;

  if verified_owner_id is null then
    return new;
  end if;

  new.customer_user_id := verified_owner_id;
  new.customer_account_claimed_at := coalesce(new.customer_account_claimed_at, now());
  new.customer_account_claim_method := coalesce(
    new.customer_account_claim_method,
    'auto_verified_phone'
  );
  new.customer_account_claim_metadata := coalesce(
    new.customer_account_claim_metadata,
    '{}'::jsonb
  ) || jsonb_build_object(
    'normalized_phone',
    normalized_phone_value,
    'source',
    'verified_phone_auto_link'
  );

  return new;
end;
$$;

create trigger auto_link_customer_to_verified_phone
before insert or update of phone, customer_user_id on public.customers
for each row execute function public.auto_link_customer_to_verified_phone();

create or replace function public.record_customer_verified_phone_for_claim(
  p_user_id uuid,
  p_phone text,
  p_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone_value text := public.normalize_customer_claim_phone(p_phone);
  inserted_row public.customer_verified_phones%rowtype;
  existing_row public.customer_verified_phones%rowtype;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if coalesce(p_method, '') not in ('qr', 'otp', 'auth_phone') then
    return jsonb_build_object('ok', false, 'code', 'database_error');
  end if;

  if not exists (
    select 1
    from public.users
    where id = p_user_id
      and status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  insert into public.customer_verified_phones (
    user_id,
    normalized_phone,
    verification_method,
    last_claimed_at
  )
  values (
    p_user_id,
    normalized_phone_value,
    p_method,
    now()
  )
  on conflict (normalized_phone) do nothing
  returning * into inserted_row;

  if inserted_row.id is not null then
    return jsonb_build_object(
      'ok', true,
      'normalizedPhone', normalized_phone_value,
      'idempotent', false
    );
  end if;

  select *
  into existing_row
  from public.customer_verified_phones
  where customer_verified_phones.normalized_phone = normalized_phone_value
  for update;

  if existing_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'database_error');
  end if;

  if existing_row.user_id is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'code', 'phone_conflict');
  end if;

  update public.customer_verified_phones
  set last_claimed_at = now()
  where id = existing_row.id;

  return jsonb_build_object(
    'ok', true,
    'normalizedPhone', normalized_phone_value,
    'idempotent', true
  );
end;
$$;

create or replace function public.claim_customers_for_verified_phone_internal(
  p_user_id uuid,
  p_normalized_phone text,
  p_claim_method text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone_value text := public.normalize_customer_claim_phone(p_normalized_phone);
  linked_count integer := 0;
  conflict_count integer := 0;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if not exists (
    select 1
    from public.customer_verified_phones verified
    join public.users owner_user on owner_user.id = verified.user_id
    where verified.user_id = p_user_id
      and verified.normalized_phone = normalized_phone_value
      and owner_user.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'unverified_phone');
  end if;

  with updated_customers as (
    update public.customers
    set customer_user_id = p_user_id,
        customer_account_claimed_at = coalesce(customer_account_claimed_at, now()),
        customer_account_claim_method = case
          when p_claim_method = 'auto_verified_phone' then 'auto_verified_phone'
          else 'verified_phone'
        end,
        customer_account_claim_metadata = coalesce(customer_account_claim_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'normalized_phone',
            normalized_phone_value,
            'source',
            p_claim_method
          ),
        updated_at = now()
    where customer_user_id is null
      and public.normalize_customer_claim_phone(phone) = normalized_phone_value
    returning id, location_id
  ),
  inserted_claims as (
    insert into public.customer_account_claims (
      salon_id,
      customer_id,
      customer_user_id,
      claim_method,
      proof_type,
      claim_status,
      metadata
    )
    select
      location_id,
      id,
      p_user_id,
      case
        when p_claim_method = 'auto_verified_phone' then 'auto_link'
        else 'verified_phone'
      end,
      'verified_phone_ownership',
      'linked',
      jsonb_build_object('normalized_phone', normalized_phone_value)
    from updated_customers
    on conflict (customer_id, customer_user_id, claim_method) do nothing
    returning 1
  )
  select count(*)::integer
  into linked_count
  from updated_customers;

  select count(*)::integer
  into conflict_count
  from public.customers customers
  join public.users owner_user on owner_user.id = customers.customer_user_id
  where public.normalize_customer_claim_phone(customers.phone) = normalized_phone_value
    and customers.customer_user_id is not null
    and customers.customer_user_id is distinct from p_user_id
    and owner_user.status = 'active';

  update public.customer_verified_phones
  set last_claimed_at = now()
  where user_id = p_user_id
    and customer_verified_phones.normalized_phone = normalized_phone_value;

  return jsonb_build_object(
    'ok', true,
    'linkedCount', linked_count,
    'conflictCount', conflict_count
  );
end;
$$;

create or replace function public.claim_customers_for_verified_phone(p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  normalized_phone_value text := public.normalize_customer_claim_phone(p_phone);
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  return public.claim_customers_for_verified_phone_internal(
    actor_user_id,
    normalized_phone_value,
    'verified_phone'
  );
end;
$$;

create or replace function public.inspect_customer_phone_claim(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  normalized_phone_value text := public.normalize_customer_claim_phone(p_phone);
  verified_owner_id uuid;
  verified_by_current boolean := false;
  eligible_unclaimed_count integer := 0;
  historical_unclaimed_count integer := 0;
  owned_by_current_count integer := 0;
  owned_by_other_count integer := 0;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if normalized_phone_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  select verified.user_id
  into verified_owner_id
  from public.customer_verified_phones verified
  join public.users owner_user on owner_user.id = verified.user_id
  where verified.normalized_phone = normalized_phone_value
    and owner_user.status = 'active'
  order by verified.verified_at desc
  limit 1;

  verified_by_current := verified_owner_id is not null
    and verified_owner_id = actor_user_id;

  select count(*)::integer
  into eligible_unclaimed_count
  from public.customers customers
  where customers.customer_user_id is null
    and public.normalize_customer_claim_phone(customers.phone) = normalized_phone_value;

  select count(*)::integer
  into historical_unclaimed_count
  from public.customers customers
  where customers.customer_user_id is null
    and public.normalize_customer_claim_phone(customers.phone) = normalized_phone_value
    and exists (
      select 1
      from public.pos_tickets tickets
      where tickets.customer_id = customers.id
        and tickets.salon_id = customers.location_id
        and tickets.status = 'closed'
    );

  select count(*)::integer
  into owned_by_current_count
  from public.customers customers
  where customers.customer_user_id = actor_user_id
    and public.normalize_customer_claim_phone(customers.phone) = normalized_phone_value;

  select count(*)::integer
  into owned_by_other_count
  from public.customers customers
  join public.users owner_user on owner_user.id = customers.customer_user_id
  where customers.customer_user_id is not null
    and customers.customer_user_id is distinct from actor_user_id
    and owner_user.status = 'active'
    and public.normalize_customer_claim_phone(customers.phone) = normalized_phone_value;

  return jsonb_build_object(
    'ok', true,
    'normalizedPhone', normalized_phone_value,
    'verifiedByCurrentUser', verified_by_current,
    'hasHistoricalMatch', historical_unclaimed_count > 0,
    'eligibleUnclaimedCount', eligible_unclaimed_count,
    'ownedByCurrentCount', owned_by_current_count,
    'ownedByOtherCount', owned_by_other_count,
    'conflict', (
      verified_owner_id is not null
      and verified_owner_id is distinct from actor_user_id
    )
  );
end;
$$;

create or replace function public.issue_customer_claim_token(
  p_customer_id uuid,
  p_ticket_id uuid default null,
  p_expires_in_seconds integer default 1800
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  customer_row public.customers%rowtype;
  token_value text;
  expires_at timestamptz;
  safe_expiry_seconds integer;
  salon_name text;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if p_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  select *
  into customer_row
  from public.customers
  where id = p_customer_id;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  if not public.user_has_salon_permission(
    customer_row.location_id,
    array['tickets.manage', 'customers.manage']
  ) then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  if customer_row.customer_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  if public.normalize_customer_claim_phone(customer_row.phone) is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if p_ticket_id is not null and not exists (
    select 1
    from public.pos_tickets tickets
    where tickets.id = p_ticket_id
      and tickets.salon_id = customer_row.location_id
      and tickets.customer_id = customer_row.id
      and tickets.status = 'closed'
  ) then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  safe_expiry_seconds := greatest(
    60,
    least(coalesce(p_expires_in_seconds, 1800), 3600)
  );
  expires_at := now() + make_interval(secs => safe_expiry_seconds);
  token_value := encode(extensions.gen_random_bytes(32), 'hex');

  select coalesce(nullif(btrim(settings.business_name), ''), salons.name)
  into salon_name
  from public.locations salons
  left join public.salon_settings settings on settings.salon_id = salons.id
  where salons.id = customer_row.location_id
  limit 1;

  insert into public.customer_claim_tokens (
    token_hash,
    salon_id,
    customer_id,
    ticket_id,
    issued_by_user_id,
    expires_at,
    metadata
  )
  values (
    public.customer_claim_token_hash(token_value),
    customer_row.location_id,
    customer_row.id,
    p_ticket_id,
    actor_user_id,
    expires_at,
    jsonb_build_object('source', 'pos_checkout')
  );

  return jsonb_build_object(
    'ok', true,
    'token', token_value,
    'claimPath', '/claim/customer?token=' || token_value,
    'expiresAt', expires_at,
    'salonName', coalesce(salon_name, 'this salon')
  );
end;
$$;

create or replace function public.get_customer_claim_token_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  token_row public.customer_claim_tokens%rowtype;
  customer_row public.customers%rowtype;
  token_hash_value text := public.customer_claim_token_hash(p_token);
  salon_name text;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if token_hash_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select *
  into token_row
  from public.customer_claim_tokens
  where customer_claim_tokens.token_hash = token_hash_value
  limit 1;

  if token_row.id is null or token_row.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if token_row.used_at is not null then
    return jsonb_build_object('ok', false, 'code', 'token_used');
  end if;

  if token_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;

  select *
  into customer_row
  from public.customers
  where id = token_row.customer_id
  limit 1;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if customer_row.customer_user_id is not null
    and customer_row.customer_user_id is distinct from actor_user_id
  then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  select coalesce(nullif(btrim(settings.business_name), ''), salons.name)
  into salon_name
  from public.locations salons
  left join public.salon_settings settings on settings.salon_id = salons.id
  where salons.id = token_row.salon_id
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'salonName', coalesce(salon_name, 'this salon'),
    'expiresAt', token_row.expires_at,
    'alreadyLinked', customer_row.customer_user_id = actor_user_id
  );
end;
$$;

create or replace function public.claim_customer_from_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  token_row public.customer_claim_tokens%rowtype;
  customer_row public.customers%rowtype;
  token_hash_value text := public.customer_claim_token_hash(p_token);
  normalized_phone_value text;
  phone_result jsonb;
  phone_claim_result jsonb;
  additional_linked_count integer := 0;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if token_hash_value is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  select *
  into token_row
  from public.customer_claim_tokens
  where customer_claim_tokens.token_hash = token_hash_value
  for update;

  if token_row.id is null or token_row.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  if token_row.used_at is not null then
    return jsonb_build_object('ok', false, 'code', 'token_used');
  end if;

  if token_row.expires_at <= now() then
    update public.customer_claim_tokens
    set revoked_at = coalesce(revoked_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('revoked_reason', 'expired')
    where id = token_row.id;

    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;

  select *
  into customer_row
  from public.customers
  where id = token_row.customer_id
  for update;

  if customer_row.id is null then
    update public.customer_claim_tokens
    set revoked_at = coalesce(revoked_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('revoked_reason', 'missing_customer')
    where id = token_row.id;

    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;

  normalized_phone_value := public.normalize_customer_claim_phone(customer_row.phone);

  if normalized_phone_value is null then
    update public.customer_claim_tokens
    set revoked_at = coalesce(revoked_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('revoked_reason', 'invalid_phone')
    where id = token_row.id;

    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;

  if customer_row.customer_user_id = actor_user_id then
    phone_result := public.record_customer_verified_phone_for_claim(
      actor_user_id,
      normalized_phone_value,
      'qr'
    );

    update public.customer_claim_tokens
    set used_at = now(),
        claimed_by_user_id = actor_user_id
    where id = token_row.id;

    insert into public.customer_account_claims (
      salon_id,
      customer_id,
      customer_user_id,
      claim_method,
      proof_type,
      claim_status,
      metadata
    )
    values (
      customer_row.location_id,
      customer_row.id,
      actor_user_id,
      'qr',
      'customer_claim_token',
      'idempotent',
      jsonb_build_object(
        'token_id',
        token_row.id,
        'normalized_phone',
        normalized_phone_value,
        'phone_verified',
        phone_result ->> 'ok'
      )
    )
    on conflict (customer_id, customer_user_id, claim_method) do nothing;

    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'linkedCount', 0
    );
  end if;

  if customer_row.customer_user_id is not null then
    update public.customer_claim_tokens
    set revoked_at = coalesce(revoked_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('revoked_reason', 'customer_unavailable')
    where id = token_row.id;

    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  phone_result := public.record_customer_verified_phone_for_claim(
    actor_user_id,
    normalized_phone_value,
    'qr'
  );

  if phone_result ->> 'ok' <> 'true' then
    update public.customer_claim_tokens
    set revoked_at = coalesce(revoked_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('revoked_reason', phone_result ->> 'code')
    where id = token_row.id;

    return jsonb_build_object(
      'ok', false,
      'code', coalesce(phone_result ->> 'code', 'database_error')
    );
  end if;

  update public.customers
  set customer_user_id = actor_user_id,
      customer_account_claimed_at = now(),
      customer_account_claim_method = 'qr',
      customer_account_claim_metadata = coalesce(customer_account_claim_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'token_id',
          token_row.id,
          'normalized_phone',
          normalized_phone_value
        ),
      updated_at = now()
  where id = customer_row.id
    and customer_user_id is null
  returning * into customer_row;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'customer_unavailable');
  end if;

  insert into public.customer_account_claims (
    salon_id,
    customer_id,
    customer_user_id,
    claim_method,
    proof_type,
    claim_status,
    metadata
  )
  values (
    customer_row.location_id,
    customer_row.id,
    actor_user_id,
    'qr',
    'customer_claim_token',
    'linked',
    jsonb_build_object(
      'token_id',
      token_row.id,
      'normalized_phone',
      normalized_phone_value
    )
  )
  on conflict (customer_id, customer_user_id, claim_method) do nothing;

  phone_claim_result := public.claim_customers_for_verified_phone_internal(
    actor_user_id,
    normalized_phone_value,
    'verified_phone'
  );

  if phone_claim_result ->> 'ok' = 'true' then
    additional_linked_count := coalesce(
      nullif(phone_claim_result ->> 'linkedCount', '')::integer,
      0
    );
  end if;

  update public.customer_claim_tokens
  set used_at = now(),
      claimed_by_user_id = actor_user_id
  where id = token_row.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'linkedCount', 1 + additional_linked_count
  );
end;
$$;

create or replace function public.release_customer_identity_for_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and new.status = 'deleted'
    and old.status is distinct from 'deleted'
  then
    update public.customer_claim_tokens
    set revoked_at = coalesce(revoked_at, now()),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object('revoked_reason', 'deleted_account')
    where used_at is null
      and revoked_at is null
      and (
        issued_by_user_id = new.id
        or claimed_by_user_id = new.id
        or exists (
          select 1
          from public.customers customers
          where customers.id = customer_claim_tokens.customer_id
            and customers.customer_user_id = new.id
        )
      );

    delete from public.customer_verified_phones
    where user_id = new.id;

    update public.customers
    set customer_user_id = null,
        customer_account_claim_method = 'deleted_account_release',
        customer_account_claim_metadata = coalesce(customer_account_claim_metadata, '{}'::jsonb)
          || jsonb_build_object('released_user_id', new.id, 'released_at', now()),
        updated_at = now()
    where customer_user_id = new.id;
  end if;

  return new;
end;
$$;

create trigger release_customer_identity_for_deleted_user
after update of status on public.users
for each row execute function public.release_customer_identity_for_deleted_user();

grant select on public.customer_verified_phones to authenticated;
grant select on public.customer_account_claims to authenticated;

revoke all on function public.record_customer_verified_phone_for_claim(uuid, text, text) from public;
revoke all on function public.claim_customers_for_verified_phone_internal(uuid, text, text) from public;
revoke all on function public.prepare_customer_account_claim() from public;
revoke all on function public.auto_link_customer_to_verified_phone() from public;
revoke all on function public.release_customer_identity_for_deleted_user() from public;

revoke all on function public.issue_customer_claim_token(uuid, uuid, integer) from public;
revoke all on function public.get_customer_claim_token_preview(text) from public;
revoke all on function public.claim_customer_from_token(text) from public;
revoke all on function public.inspect_customer_phone_claim(text) from public;
revoke all on function public.claim_customers_for_verified_phone(text) from public;

grant execute on function public.issue_customer_claim_token(uuid, uuid, integer) to authenticated;
grant execute on function public.get_customer_claim_token_preview(text) to authenticated;
grant execute on function public.claim_customer_from_token(text) to authenticated;
grant execute on function public.inspect_customer_phone_claim(text) to authenticated;
grant execute on function public.claim_customers_for_verified_phone(text) to authenticated;
