-- Customer Booking Identity Foundation.
-- Additive only: keeps guest bookings working while making authenticated
-- customer ownership explicit and auditable.

alter table public.bookings
add column if not exists customer_account_linked_at timestamptz,
add column if not exists customer_account_linked_by_user_id uuid references public.users(id) on delete set null,
add column if not exists customer_account_link_method text,
add column if not exists customer_account_link_metadata jsonb not null default '{}'::jsonb;

alter table public.bookings
drop constraint if exists bookings_customer_account_link_method_check;

alter table public.bookings
add constraint bookings_customer_account_link_method_check check (
  customer_account_link_method is null
  or customer_account_link_method in (
    'authenticated_booking',
    'guest_manage_claim',
    'contact_verification_claim',
    'manual_account_link',
    'system_backfill'
  )
);

create index if not exists bookings_customer_user_start_idx
on public.bookings(customer_user_id, start_at desc, id)
where customer_user_id is not null;

create index if not exists bookings_customer_account_linked_at_idx
on public.bookings(customer_account_linked_at desc)
where customer_account_linked_at is not null;

update public.bookings
set
  customer_account_linked_at = coalesce(customer_account_linked_at, updated_at, created_at),
  customer_account_linked_by_user_id = coalesce(
    customer_account_linked_by_user_id,
    updated_by_user_id,
    created_by_user_id,
    customer_user_id
  ),
  customer_account_link_method = coalesce(customer_account_link_method, 'system_backfill'),
  customer_account_link_metadata = coalesce(customer_account_link_metadata, '{}'::jsonb)
    || jsonb_build_object('backfilled', true)
where customer_user_id is not null
  and customer_account_linked_at is null;

create or replace function public.prepare_booking_customer_account_link()
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
    raise exception 'Booking customer account link cannot be reassigned.';
  end if;

  if new.customer_user_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.customer_account_linked_at := coalesce(
      new.customer_account_linked_at,
      now()
    );
    new.customer_account_linked_by_user_id := coalesce(
      new.customer_account_linked_by_user_id,
      new.updated_by_user_id,
      new.created_by_user_id,
      new.customer_user_id
    );
    new.customer_account_link_method := coalesce(
      new.customer_account_link_method,
      case
        when new.source in ('public_profile', 'explore')
          and new.created_by_user_id is not distinct from new.customer_user_id
        then 'authenticated_booking'
        else 'manual_account_link'
      end
    );
    new.customer_account_link_metadata := coalesce(
      new.customer_account_link_metadata,
      '{}'::jsonb
    ) || jsonb_build_object('source', new.source);
  elsif new.customer_user_id is distinct from old.customer_user_id then
    new.customer_account_linked_at := coalesce(
      new.customer_account_linked_at,
      now()
    );
    new.customer_account_linked_by_user_id := coalesce(
      new.customer_account_linked_by_user_id,
      new.updated_by_user_id,
      new.created_by_user_id,
      new.customer_user_id
    );
    new.customer_account_link_method := coalesce(
      new.customer_account_link_method,
      case
        when new.source in ('public_profile', 'explore')
          and new.created_by_user_id is not distinct from new.customer_user_id
        then 'authenticated_booking'
        else 'manual_account_link'
      end
    );
    new.customer_account_link_metadata := coalesce(
      new.customer_account_link_metadata,
      '{}'::jsonb
    ) || jsonb_build_object('source', new.source);
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_booking_customer_account_link
on public.bookings;

create trigger prepare_booking_customer_account_link
before insert or update of customer_user_id on public.bookings
for each row
execute function public.prepare_booking_customer_account_link();

create table if not exists public.booking_customer_account_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_user_id uuid not null references public.users(id) on delete cascade,
  claim_method text not null,
  proof_type text not null,
  claim_status text not null default 'linked',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_customer_account_claims_method_check check (
    claim_method in ('guest_manage_claim', 'contact_verification_claim')
  ),
  constraint booking_customer_account_claims_proof_type_check check (
    proof_type in ('guest_manage_token', 'contact_magic_link', 'contact_otp')
  ),
  constraint booking_customer_account_claims_status_check check (
    claim_status in ('linked', 'idempotent')
  )
);

create unique index if not exists booking_customer_account_claims_user_method_uidx
on public.booking_customer_account_claims(booking_id, customer_user_id, claim_method);

create index if not exists booking_customer_account_claims_user_created_idx
on public.booking_customer_account_claims(customer_user_id, created_at desc);

create index if not exists booking_customer_account_claims_salon_created_idx
on public.booking_customer_account_claims(salon_id, created_at desc);

alter table public.booking_customer_account_claims enable row level security;

drop policy if exists "Customers can view own booking account claims"
on public.booking_customer_account_claims;

create policy "Customers can view own booking account claims"
on public.booking_customer_account_claims
for select
to authenticated
using (customer_user_id = public.current_public_user_id());

drop policy if exists "Booking managers can view booking account claims"
on public.booking_customer_account_claims;

create policy "Booking managers can view booking account claims"
on public.booking_customer_account_claims
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['booking.view', 'booking.manage']::text[]
  )
);

create or replace function public.claim_guest_booking_by_manage_token(raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
  normalized_token text;
begin
  actor_user_id := public.current_public_user_id();
  normalized_token := nullif(btrim(coalesce(raw_token, '')), '');

  if actor_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'sign_in_required',
      'message', 'Sign in to save this booking.'
    );
  end if;

  if normalized_token is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_token',
      'message', 'This booking cannot be saved to this account.'
    );
  end if;

  select *
  into booking_row
  from public.bookings
  where customer_cancellation_token_hash =
    public.public_booking_token_hash(normalized_token)
  for update;

  if booking_row.id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_token',
      'message', 'This booking cannot be saved to this account.'
    );
  end if;

  if booking_row.customer_user_id = actor_user_id then
    insert into public.booking_customer_account_claims (
      organization_id,
      salon_id,
      booking_id,
      customer_user_id,
      claim_method,
      proof_type,
      claim_status,
      metadata
    )
    values (
      booking_row.organization_id,
      booking_row.salon_id,
      booking_row.id,
      actor_user_id,
      'guest_manage_claim',
      'guest_manage_token',
      'idempotent',
      jsonb_build_object('idempotent', true)
    )
    on conflict (booking_id, customer_user_id, claim_method) do nothing;

    return jsonb_build_object(
      'ok', true,
      'booking_id', booking_row.id,
      'idempotent', true
    );
  end if;

  if booking_row.customer_user_id is not null then
    return jsonb_build_object(
      'ok', false,
      'code', 'booking_not_available',
      'message', 'This booking cannot be saved to this account.'
    );
  end if;

  update public.bookings
  set
    customer_user_id = actor_user_id,
    customer_account_linked_at = now(),
    customer_account_linked_by_user_id = actor_user_id,
    customer_account_link_method = 'guest_manage_claim',
    customer_account_link_metadata = coalesce(customer_account_link_metadata, '{}'::jsonb)
      || jsonb_build_object('proof_type', 'guest_manage_token'),
    updated_by_user_id = actor_user_id,
    updated_at = now()
  where id = booking_row.id
    and customer_user_id is null
  returning * into booking_row;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'booking_not_available',
      'message', 'This booking cannot be saved to this account.'
    );
  end if;

  insert into public.booking_customer_account_claims (
    organization_id,
    salon_id,
    booking_id,
    customer_user_id,
    claim_method,
    proof_type,
    claim_status,
    metadata
  )
  values (
    booking_row.organization_id,
    booking_row.salon_id,
    booking_row.id,
    actor_user_id,
    'guest_manage_claim',
    'guest_manage_token',
    'linked',
    jsonb_build_object('linked_at', booking_row.customer_account_linked_at)
  )
  on conflict (booking_id, customer_user_id, claim_method) do nothing;

  return jsonb_build_object(
    'ok', true,
    'booking_id', booking_row.id,
    'idempotent', false
  );
end;
$$;

create or replace function public.cancel_customer_booking(
  p_booking_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
    and customer_user_id = actor_user_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  if booking_row.start_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'past_booking');
  end if;

  update public.bookings
  set
    status = 'cancelled',
    confirmation_status = 'cancelled',
    cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    cancelled_at = now(),
    cancelled_by_user_id = actor_user_id,
    updated_by_user_id = actor_user_id,
    updated_at = now()
  where id = booking_row.id;

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

create or replace function public.reschedule_customer_booking(
  p_booking_id uuid,
  p_start_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid;
  booking_row public.bookings%rowtype;
  new_end_at timestamptz;
  settings_row public.booking_settings%rowtype;
begin
  actor_user_id := public.current_public_user_id();

  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
    and customer_user_id = actor_user_id
  for update;

  if booking_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if public.normalize_booking_status(booking_row.status) in ('completed', 'cancelled', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'terminal_booking');
  end if;

  select *
  into settings_row
  from public.booking_settings
  where salon_id = booking_row.salon_id;

  if p_start_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_time');
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(settings_row.minimum_lead_time_minutes, 120)) then
    return jsonb_build_object('ok', false, 'code', 'lead_time');
  end if;

  if p_start_at > now() + make_interval(days => coalesce(settings_row.maximum_advance_window_days, 30)) then
    return jsonb_build_object('ok', false, 'code', 'advance_window');
  end if;

  if coalesce(settings_row.same_day_booking_enabled, true) is not true
    and (p_start_at at time zone coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'))::date
      <= (now() at time zone coalesce(settings_row.timezone_iana, booking_row.salon_timezone_snapshot, 'America/Chicago'))::date
  then
    return jsonb_build_object('ok', false, 'code', 'same_day_disabled');
  end if;

  new_end_at := p_start_at + (booking_row.end_at - booking_row.start_at);

  begin
    perform public.perform_booking_reschedule(
      booking_row.id,
      p_start_at,
      new_end_at,
      actor_user_id,
      null,
      true
    );
  exception
    when others then
      return jsonb_build_object(
        'ok', false,
        'code', 'unavailable_slot',
        'message', sqlerrm
      );
  end;

  return jsonb_build_object('ok', true, 'booking_id', booking_row.id);
end;
$$;

revoke all on table public.booking_customer_account_claims from public, anon;
grant select on table public.booking_customer_account_claims to authenticated;

revoke all on function public.prepare_booking_customer_account_link() from public, anon, authenticated;

revoke all on function public.claim_guest_booking_by_manage_token(text)
from public, anon;
grant execute on function public.claim_guest_booking_by_manage_token(text)
to authenticated;

revoke all on function public.cancel_customer_booking(uuid, text)
from public, anon;
grant execute on function public.cancel_customer_booking(uuid, text)
to authenticated;

revoke all on function public.reschedule_customer_booking(uuid, timestamptz)
from public, anon;
grant execute on function public.reschedule_customer_booking(uuid, timestamptz)
to authenticated;
