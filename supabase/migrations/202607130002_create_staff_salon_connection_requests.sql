-- Staff-Salon Connection request foundation.
-- This supports salon invitations now and leaves direction/status space for
-- staff applications without introducing a separate relationship table.

create or replace function public.normalize_staff_connection_email(input text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(coalesce(input, ''))), '')
$$;

create or replace function public.normalize_staff_connection_phone(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  trimmed text;
  digits text;
begin
  trimmed := btrim(coalesce(input, ''));

  if trimmed = '' then
    return null;
  end if;

  digits := regexp_replace(trimmed, '[^0-9]', '', 'g');

  if digits = '' then
    return null;
  end if;

  if left(trimmed, 1) = '+' then
    return '+' || digits;
  end if;

  return digits;
end;
$$;

create or replace function public.mask_staff_connection_email(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text;
  at_position integer;
  domain_part text;
  local_part text;
begin
  normalized := public.normalize_staff_connection_email(input);

  if normalized is null then
    return null;
  end if;

  at_position := strpos(normalized, '@');

  if at_position <= 1 then
    return '***';
  end if;

  local_part := substring(normalized from 1 for at_position - 1);
  domain_part := substring(normalized from at_position + 1);

  return left(local_part, 1) || repeat('*', greatest(length(local_part) - 1, 3)) || '@' || domain_part;
end;
$$;

create or replace function public.mask_staff_connection_phone(input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  normalized text;
begin
  normalized := public.normalize_staff_connection_phone(input);

  if normalized is null then
    return null;
  end if;

  if length(normalized) <= 4 then
    return repeat('*', length(normalized));
  end if;

  return repeat('*', greatest(length(normalized) - 4, 3)) || right(normalized, 4);
end;
$$;

create index if not exists users_staff_connection_email_lookup_idx
on public.users(public.normalize_staff_connection_email(email))
where email is not null
  and status = 'active';

create index if not exists users_staff_connection_phone_lookup_idx
on public.users(public.normalize_staff_connection_phone(phone))
where phone is not null
  and status = 'active';

create table if not exists public.staff_salon_connection_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete restrict,
  account_user_id uuid references public.users(id) on delete set null,
  direction text not null,
  initiated_by_user_id uuid not null references public.users(id) on delete restrict,
  target_email_normalized text,
  target_phone_e164 text,
  status text not null default 'pending',
  token_hash text,
  expires_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  revoked_at timestamptz,
  reviewed_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_salon_connection_requests_direction_check check (
    direction in ('salon_invite', 'staff_application')
  ),
  constraint staff_salon_connection_requests_status_check check (
    status in ('pending', 'accepted', 'declined', 'cancelled', 'revoked', 'expired')
  ),
  constraint staff_salon_connection_requests_email_check check (
    target_email_normalized is null
    or target_email_normalized = public.normalize_staff_connection_email(target_email_normalized)
  ),
  constraint staff_salon_connection_requests_phone_check check (
    target_phone_e164 is null
    or target_phone_e164 ~ '^\+?[0-9]{7,15}$'
  ),
  constraint staff_salon_connection_requests_token_hash_check check (
    token_hash is null
    or length(btrim(token_hash)) > 0
  ),
  constraint staff_salon_connection_requests_salon_invite_required_check check (
    direction <> 'salon_invite'
    or (
      staff_id is not null
      and token_hash is not null
      and expires_at is not null
      and (
        account_user_id is not null
        or target_email_normalized is not null
        or target_phone_e164 is not null
      )
    )
  ),
  constraint staff_salon_connection_requests_application_required_check check (
    direction <> 'staff_application'
    or account_user_id is not null
  )
);

comment on table public.staff_salon_connection_requests is
  'Shared lifecycle table for salon-initiated staff invites and future staff-initiated salon applications.';

comment on column public.staff_salon_connection_requests.target_phone_e164 is
  'Canonical phone lookup value. Stores E.164 only when the input includes an explicit country code; otherwise stores digits-only without guessing a country.';

create index if not exists staff_salon_connection_requests_salon_created_idx
on public.staff_salon_connection_requests(organization_id, salon_id, created_at desc);

create index if not exists staff_salon_connection_requests_salon_status_idx
on public.staff_salon_connection_requests(organization_id, salon_id, status, created_at desc);

create index if not exists staff_salon_connection_requests_account_idx
on public.staff_salon_connection_requests(account_user_id, created_at desc)
where account_user_id is not null;

create unique index if not exists staff_salon_connection_requests_pending_staff_unique_idx
on public.staff_salon_connection_requests(staff_id)
where status = 'pending'
  and staff_id is not null;

create unique index if not exists staff_salon_connection_requests_pending_account_salon_unique_idx
on public.staff_salon_connection_requests(salon_id, account_user_id)
where status = 'pending'
  and account_user_id is not null;

create unique index if not exists staff_salon_connection_requests_pending_email_salon_unique_idx
on public.staff_salon_connection_requests(salon_id, target_email_normalized)
where status = 'pending'
  and direction = 'salon_invite'
  and target_email_normalized is not null;

create unique index if not exists staff_salon_connection_requests_pending_phone_salon_unique_idx
on public.staff_salon_connection_requests(salon_id, target_phone_e164)
where status = 'pending'
  and direction = 'salon_invite'
  and target_phone_e164 is not null;

drop trigger if exists update_staff_salon_connection_requests_updated_at
on public.staff_salon_connection_requests;
create trigger update_staff_salon_connection_requests_updated_at
before update on public.staff_salon_connection_requests
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_staff_salon_connection_request_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
    or new.staff_id is distinct from old.staff_id
    or new.direction is distinct from old.direction
    or new.initiated_by_user_id is distinct from old.initiated_by_user_id
  ) then
    raise exception 'Staff-Salon connection request ownership fields cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Staff-Salon connection request salon must belong to the organization.';
  end if;

  if new.staff_id is not null and not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Staff-Salon connection request staff member must belong to the organization and salon.';
  end if;

  if new.direction = 'salon_invite' then
    if new.staff_id is null then
      raise exception 'Salon invites require a staff record.';
    end if;

    if new.account_user_id is null
      and new.target_email_normalized is null
      and new.target_phone_e164 is null
    then
      raise exception 'Salon invites require an account, email, or phone target.';
    end if;

    if new.token_hash is null or new.expires_at is null then
      raise exception 'Salon invites require a token hash and expiration.';
    end if;
  end if;

  if new.direction = 'staff_application' and new.account_user_id is null then
    raise exception 'Staff applications require an account user.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_salon_connection_request_scope
on public.staff_salon_connection_requests;
create trigger validate_staff_salon_connection_request_scope
before insert or update on public.staff_salon_connection_requests
for each row
execute function public.validate_staff_salon_connection_request_scope();

create or replace function public.search_staff_connection_account_exact(
  target_organization_id uuid,
  target_salon_id uuid,
  p_email text default null,
  p_phone text default null
)
returns table (
  result_status text,
  account_user_id uuid,
  display_name text,
  avatar_url text,
  masked_email text,
  masked_phone text,
  match_type text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  normalized_email text;
  normalized_phone text;
begin
  normalized_email := public.normalize_staff_connection_email(p_email);
  normalized_phone := public.normalize_staff_connection_phone(p_phone);

  if normalized_email is null and normalized_phone is null then
    raise exception 'Email or phone is required for exact account search.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = target_salon_id
      and locations.organization_id = target_organization_id
  ) then
    raise exception 'Salon must belong to the organization.';
  end if;

  if not public.user_has_organization_permission(
    target_organization_id,
    array['staff.manage']::text[]
  ) then
    raise exception 'Missing required permission: staff.manage';
  end if;

  return query
  with matches as (
    select
      users.id,
      users.display_name,
      users.avatar_url,
      users.email,
      users.phone,
      (
        normalized_email is not null
        and public.normalize_staff_connection_email(users.email) = normalized_email
      ) as email_match,
      (
        normalized_phone is not null
        and public.normalize_staff_connection_phone(users.phone) = normalized_phone
      ) as phone_match
    from public.users
    where users.status = 'active'
      and (
        (
          normalized_email is not null
          and public.normalize_staff_connection_email(users.email) = normalized_email
        )
        or (
          normalized_phone is not null
          and public.normalize_staff_connection_phone(users.phone) = normalized_phone
        )
      )
  ),
  match_count as (
    select count(*)::integer as value
    from matches
  )
  select
    'not_found'::text,
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text
  from match_count
  where match_count.value = 0

  union all

  select
    'ambiguous'::text,
    null::uuid,
    null::text,
    null::text,
    null::text,
    null::text,
    null::text
  from match_count
  where match_count.value > 1

  union all

  select
    'found'::text,
    matches.id,
    matches.display_name,
    matches.avatar_url,
    public.mask_staff_connection_email(matches.email),
    public.mask_staff_connection_phone(matches.phone),
    case
      when matches.email_match and matches.phone_match then 'email_phone'
      when matches.email_match then 'email'
      else 'phone'
    end
  from matches
  cross join match_count
  where match_count.value = 1;
end;
$$;

revoke all on function public.search_staff_connection_account_exact(uuid, uuid, text, text)
from public;
grant execute on function public.search_staff_connection_account_exact(uuid, uuid, text, text)
to authenticated;

alter table public.staff_salon_connection_requests enable row level security;

drop policy if exists "Staff managers can create salon connection invites"
on public.staff_salon_connection_requests;
create policy "Staff managers can create salon connection invites"
on public.staff_salon_connection_requests
for insert
to authenticated
with check (
  direction = 'salon_invite'
  and status = 'pending'
  and initiated_by_user_id = public.current_public_user_id()
  and public.user_has_organization_permission(
    organization_id,
    array['staff.manage']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = staff_salon_connection_requests.salon_id
      and locations.organization_id = staff_salon_connection_requests.organization_id
  )
);

drop policy if exists "Staff managers can view salon connection requests"
on public.staff_salon_connection_requests;
create policy "Staff managers can view salon connection requests"
on public.staff_salon_connection_requests
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['staff.manage']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = staff_salon_connection_requests.salon_id
      and locations.organization_id = staff_salon_connection_requests.organization_id
  )
);

drop policy if exists "Account users can view own connection requests"
on public.staff_salon_connection_requests;
create policy "Account users can view own connection requests"
on public.staff_salon_connection_requests
for select
to authenticated
using (
  account_user_id = public.current_public_user_id()
);
