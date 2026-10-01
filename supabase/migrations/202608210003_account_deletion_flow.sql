create table if not exists public.account_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_lifecycle_events_user_created_idx
on public.account_lifecycle_events(user_id, created_at desc);

alter table public.account_lifecycle_events enable row level security;

drop policy if exists "user_read_own_account_lifecycle_events" on public.account_lifecycle_events;
create policy "user_read_own_account_lifecycle_events" on public.account_lifecycle_events
for select to authenticated
using (
  user_id = public.current_public_user_id()
  or actor_user_id = public.current_public_user_id()
);

create or replace function public.ensure_personal_account_for_current_user(
  p_account_name text default null
)
returns table (
  account_id uuid,
  account_membership_id uuid,
  created_account boolean,
  created_membership boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  account_name text;
  existing_account_id uuid;
  existing_membership_id uuid;
  owner_role_id uuid;
  target_account_id uuid;
  target_membership_id uuid;
  user_row public.users%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = actor_user_id;

  if user_row.id is null or user_row.status not in ('active', 'pending_deletion') then
    raise exception 'Active public user is required.';
  end if;

  select memberships.account_id, memberships.id
  into existing_account_id, existing_membership_id
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  join public.accounts accounts on accounts.id = memberships.account_id
  where memberships.user_id = actor_user_id
    and memberships.status = 'active'
    and accounts.status = 'active'
    and upper(roles.code) = 'OWNER'
  order by memberships.created_at, memberships.id
  limit 1;

  if existing_account_id is not null then
    account_id := existing_account_id;
    account_membership_id := existing_membership_id;
    created_account := false;
    created_membership := false;
    return next;
    return;
  end if;

  if user_row.status = 'pending_deletion' then
    return;
  end if;

  account_name := nullif(btrim(p_account_name), '');
  if account_name is null then
    account_name := coalesce(
      nullif(btrim(user_row.display_name), ''),
      nullif(split_part(coalesce(user_row.email, ''), '@', 1), ''),
      'Personal Account'
    );
  end if;

  insert into public.accounts (name, status)
  values (account_name, 'active')
  returning id into target_account_id;

  perform public.seed_default_roles_for_account(target_account_id);

  select id
  into owner_role_id
  from public.roles
  where roles.account_id = target_account_id
    and roles.code = 'OWNER';

  if owner_role_id is null then
    raise exception 'Owner role could not be provisioned for account.';
  end if;

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  values (
    target_account_id,
    actor_user_id,
    owner_role_id,
    'active',
    now()
  )
  returning id into target_membership_id;

  account_id := target_account_id;
  account_membership_id := target_membership_id;
  created_account := true;
  created_membership := true;
  return next;
end;
$$;

create or replace function public.account_deletion_other_active_owner_exists(
  p_salon_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users owner_users
      on owner_users.id = memberships.user_id
    where salons.id = p_salon_id
      and memberships.user_id <> p_actor_user_id
      and memberships.status = 'active'
      and owner_users.status = 'active'
      and upper(roles.code) = 'OWNER'
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users owner_users
      on owner_users.id = memberships.user_id
    where memberships.salon_id = p_salon_id
      and memberships.user_id <> p_actor_user_id
      and memberships.status = 'active'
      and owner_users.status = 'active'
      and upper(roles.code) = 'OWNER'
  )
$$;

create or replace function public.request_account_deletion(
  p_continue_without_transfer boolean default false,
  p_backup_acknowledged boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  closed_last_owner_count integer := 0;
  v_deletion_requested_at timestamptz := now();
  v_deletion_scheduled_for timestamptz := v_deletion_requested_at + interval '30 days';
  existing_pending boolean := false;
  owned_salon_count integer := 0;
  pending_last_owner_names text[] := array[]::text[];
  salon_row public.locations%rowtype;
  user_row public.users%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = actor_user_id
  for update;

  if user_row.id is null then
    raise exception 'Public user was not found.';
  end if;

  if user_row.status = 'pending_deletion' then
    existing_pending := true;
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'status', user_row.status,
      'deletion_requested_at', user_row.deletion_requested_at,
      'deletion_scheduled_for', user_row.deletion_scheduled_for
    );
  end if;

  if user_row.status <> 'active' then
    raise exception 'Only an active Personal Account can request deletion.';
  end if;

  for salon_row in
    select distinct salons.*
    from public.locations salons
    where exists (
      select 1
      from public.account_memberships memberships
      join public.roles roles on roles.id = memberships.role_id
      where memberships.account_id = salons.account_id
        and memberships.user_id = actor_user_id
        and memberships.status = 'active'
        and upper(roles.code) = 'OWNER'
    )
    or exists (
      select 1
      from public.salon_memberships memberships
      join public.roles roles on roles.id = memberships.role_id
      where memberships.salon_id = salons.id
        and memberships.user_id = actor_user_id
        and memberships.status = 'active'
        and upper(roles.code) = 'OWNER'
    )
    order by salons.name
  loop
    owned_salon_count := owned_salon_count + 1;

    perform pg_advisory_xact_lock(hashtextextended('salon-lifecycle:' || salon_row.id::text, 0));

    select *
    into salon_row
    from public.locations
    where id = salon_row.id
    for update;

    if public.normalize_salon_lifecycle_status(salon_row.status) <> 'permanently_closed'
      and not public.account_deletion_other_active_owner_exists(salon_row.id, actor_user_id)
    then
      pending_last_owner_names := array_append(pending_last_owner_names, salon_row.name);

      if p_continue_without_transfer then
        perform public.close_salon_permanently(
          salon_row.id,
          coalesce(nullif(btrim(p_reason), ''), 'Closed during Personal Account deletion request without ownership transfer.')
        );
        closed_last_owner_count := closed_last_owner_count + 1;
      end if;
    end if;
  end loop;

  if owned_salon_count > 0 and p_backup_acknowledged is not true then
    raise exception 'Review the backup/export acknowledgement before requesting account deletion.';
  end if;

  if array_length(pending_last_owner_names, 1) is not null
    and p_continue_without_transfer is not true
  then
    raise exception 'Transfer ownership or continue without transfer before account deletion can be requested. Last-owner salons: %',
      array_to_string(pending_last_owner_names, ', ');
  end if;

  update public.users
  set status = 'pending_deletion',
      deletion_requested_at = v_deletion_requested_at,
      deletion_scheduled_for = v_deletion_scheduled_for,
      deleted_at = null,
      anonymized_at = null,
      updated_at = now()
  where id = actor_user_id;

  insert into public.account_lifecycle_events (
    user_id,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    actor_user_id,
    actor_user_id,
    'deletion_requested',
    jsonb_build_object(
      'backup_acknowledged', p_backup_acknowledged,
      'closed_last_owner_salon_count', closed_last_owner_count,
      'continue_without_transfer', p_continue_without_transfer,
      'owned_salon_count', owned_salon_count,
      'requested_at', v_deletion_requested_at,
      'scheduled_for', v_deletion_scheduled_for
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', not existing_pending,
    'status', 'pending_deletion',
    'closed_last_owner_salon_count', closed_last_owner_count,
    'owned_salon_count', owned_salon_count,
    'deletion_requested_at', v_deletion_requested_at,
    'deletion_scheduled_for', v_deletion_scheduled_for
  );
end;
$$;

create or replace function public.cancel_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  user_row public.users%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('account-deletion:' || actor_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = actor_user_id
  for update;

  if user_row.id is null then
    raise exception 'Public user was not found.';
  end if;

  if user_row.status <> 'pending_deletion' then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'status', user_row.status
    );
  end if;

  update public.users
  set status = 'active',
      deletion_requested_at = null,
      deletion_scheduled_for = null,
      updated_at = now()
  where id = actor_user_id;

  insert into public.account_lifecycle_events (
    user_id,
    actor_user_id,
    event_type,
    metadata
  )
  values (
    actor_user_id,
    actor_user_id,
    'deletion_cancelled',
    jsonb_build_object(
      'cancelled_at', now(),
      'previous_requested_at', user_row.deletion_requested_at,
      'previous_scheduled_for', user_row.deletion_scheduled_for
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'status', 'active'
  );
end;
$$;

grant select on table public.account_lifecycle_events to authenticated;
grant all on table public.account_lifecycle_events to service_role;

grant execute on function public.account_deletion_other_active_owner_exists(uuid, uuid) to authenticated;
grant execute on function public.request_account_deletion(boolean, boolean, text) to authenticated;
grant execute on function public.cancel_account_deletion() to authenticated;
