alter table public.users
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_scheduled_for timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists anonymized_at timestamptz;

alter table public.locations
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references public.users(id) on delete set null,
  add column if not exists disabled_reason text,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references public.users(id) on delete set null,
  add column if not exists reactivation_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.users(id) on delete set null,
  add column if not exists closure_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_lifecycle_status_check'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_lifecycle_status_check
      check (status in ('active', 'inactive', 'suspended', 'pending_deletion', 'deleted'))
      not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'locations_lifecycle_status_check'
      and conrelid = 'public.locations'::regclass
  ) then
    alter table public.locations
      add constraint locations_lifecycle_status_check
      check (status in ('active', 'inactive', 'disabled', 'permanently_closed'))
      not valid;
  end if;
end;
$$;

create table if not exists public.salon_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.locations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  old_status text,
  new_status text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists salon_lifecycle_events_salon_created_idx
on public.salon_lifecycle_events(salon_id, created_at desc);

alter table public.salon_lifecycle_events enable row level security;

drop policy if exists "salon_member_read_lifecycle_events" on public.salon_lifecycle_events;
create policy "salon_member_read_lifecycle_events" on public.salon_lifecycle_events
for select to authenticated
using (
  exists (
    select 1
    from public.locations salons
    where salons.id = salon_lifecycle_events.salon_id
      and public.user_belongs_to_account(salons.account_id)
  )
);

create or replace function public.normalize_salon_lifecycle_status(status_value text)
returns text
language sql
immutable
as $$
  select case
    when status_value = 'active' then 'active'
    when status_value = 'permanently_closed' then 'permanently_closed'
    else 'disabled'
  end
$$;

create or replace function public.salon_is_operational(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    where salons.id = target_salon_id
      and public.normalize_salon_lifecycle_status(salons.status) = 'active'
  )
$$;

create or replace function public.salon_has_active_owner(target_salon_id uuid)
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
    where salons.id = target_salon_id
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles
      on roles.id = memberships.role_id
    where memberships.salon_id = target_salon_id
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
  )
$$;

create or replace function public.enforce_active_salon_has_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.normalize_salon_lifecycle_status(new.status) = 'active'
    and public.normalize_salon_lifecycle_status(old.status) <> 'active'
    and not public.salon_has_active_owner(new.id)
  then
    raise exception 'An active salon must have at least one active owner.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_active_salon_has_owner on public.locations;
create trigger enforce_active_salon_has_owner
before update of status on public.locations
for each row execute function public.enforce_active_salon_has_owner();

create or replace function public.record_salon_lifecycle_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_old_status text := public.normalize_salon_lifecycle_status(old.status);
  normalized_new_status text := public.normalize_salon_lifecycle_status(new.status);
  transition_reason text;
begin
  if normalized_old_status = normalized_new_status then
    return new;
  end if;

  transition_reason := case normalized_new_status
    when 'disabled' then new.disabled_reason
    when 'active' then new.reactivation_reason
    when 'permanently_closed' then new.closure_reason
    else null
  end;

  insert into public.salon_lifecycle_events (
    salon_id,
    actor_user_id,
    old_status,
    new_status,
    reason,
    metadata
  )
  values (
    new.id,
    public.current_public_user_id(),
    normalized_old_status,
    normalized_new_status,
    nullif(btrim(coalesce(transition_reason, '')), ''),
    jsonb_build_object(
      'raw_old_status', old.status,
      'raw_new_status', new.status
    )
  );

  return new;
end;
$$;

drop trigger if exists record_salon_lifecycle_status_change on public.locations;
create trigger record_salon_lifecycle_status_change
after update of status on public.locations
for each row execute function public.record_salon_lifecycle_status_change();

create or replace function public.prevent_non_operational_salon_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  salon_column text := tg_argv[0];
  target_salon_id uuid;
begin
  if salon_column is null or btrim(salon_column) = '' then
    raise exception 'Salon lifecycle guard requires a salon id column name.';
  end if;

  row_data := case
    when tg_op = 'DELETE' then to_jsonb(old)
    else to_jsonb(new)
  end;

  target_salon_id := nullif(row_data ->> salon_column, '')::uuid;

  if target_salon_id is not null
    and not public.salon_is_operational(target_salon_id)
  then
    raise exception 'Salon is not active. New operational activity is not allowed.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

do $$
declare
  guard record;
begin
  for guard in
    select *
    from (
      values
        ('booking_inspirations', 'salon_id'),
        ('booking_lines', 'salon_id'),
        ('booking_status_events', 'salon_id'),
        ('bookings', 'salon_id'),
        ('customers', 'location_id'),
        ('payroll_paystubs', 'salon_id'),
        ('payroll_period_staff_input_history', 'salon_id'),
        ('payroll_period_staff_inputs', 'salon_id'),
        ('payroll_runs', 'salon_id'),
        ('payroll_staff_daily_totals', 'salon_id'),
        ('payroll_staff_lines', 'salon_id'),
        ('pos_daily_closing_staff_snapshots', 'salon_id'),
        ('pos_daily_closings', 'salon_id'),
        ('pos_desk_session_lines', 'salon_id'),
        ('pos_desk_sessions', 'salon_id'),
        ('pos_display_channels', 'salon_id'),
        ('pos_financial_adjustments', 'salon_id'),
        ('pos_financial_correction_requests', 'salon_id'),
        ('pos_live_drafts', 'salon_id'),
        ('pos_payments', 'salon_id'),
        ('pos_ticket_adjustments', 'salon_id'),
        ('pos_ticket_item_turn_parts', 'salon_id'),
        ('pos_ticket_items', 'salon_id'),
        ('pos_ticket_staff_earnings', 'salon_id'),
        ('pos_tickets', 'salon_id'),
        ('salon_profile_booking_requests', 'salon_id'),
        ('service_add_on_links', 'salon_id'),
        ('services', 'salon_id'),
        ('staff', 'salon_id'),
        ('staff_availability_rules', 'salon_id'),
        ('staff_salon_connection_requests', 'salon_id'),
        ('staff_service_assignments', 'salon_id'),
        ('staff_time_blocks', 'salon_id'),
        ('staff_workdays', 'salon_id')
    ) as guards(table_name, salon_column)
  loop
    if to_regclass(format('public.%I', guard.table_name)) is not null then
      execute format(
        'drop trigger if exists enforce_operational_salon_write on public.%I',
        guard.table_name
      );
      execute format(
        'create trigger enforce_operational_salon_write before insert or update or delete on public.%I for each row execute function public.prevent_non_operational_salon_write(%L)',
        guard.table_name,
        guard.salon_column
      );
    end if;
  end loop;
end;
$$;

create or replace function public.disable_salon(
  p_salon_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  current_status text;
  salon_row public.locations%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  select *
  into salon_row
  from public.locations
  where id = p_salon_id;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_account_permission(salon_row.account_id, array['account.manage']::text[]) then
    raise exception 'Only Account owners can change salon lifecycle.';
  end if;

  current_status := public.normalize_salon_lifecycle_status(salon_row.status);

  if current_status = 'permanently_closed' then
    raise exception 'A permanently closed salon cannot be disabled.';
  end if;

  if current_status = 'disabled' then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'salon_id', p_salon_id,
      'status', current_status
    );
  end if;

  update public.locations
  set status = 'disabled',
      disabled_at = now(),
      disabled_by = actor_user_id,
      disabled_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_salon_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'salon_id', p_salon_id,
    'status', 'disabled'
  );
end;
$$;

create or replace function public.reactivate_salon(
  p_salon_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  current_status text;
  salon_row public.locations%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  select *
  into salon_row
  from public.locations
  where id = p_salon_id;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_account_permission(salon_row.account_id, array['account.manage']::text[]) then
    raise exception 'Only Account owners can change salon lifecycle.';
  end if;

  current_status := public.normalize_salon_lifecycle_status(salon_row.status);

  if current_status = 'permanently_closed' then
    raise exception 'A permanently closed salon requires a privileged recovery workflow.';
  end if;

  if current_status = 'active' then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'salon_id', p_salon_id,
      'status', current_status
    );
  end if;

  if not public.salon_has_active_owner(p_salon_id) then
    raise exception 'An active salon must have at least one active owner.';
  end if;

  update public.locations
  set status = 'active',
      reactivated_at = now(),
      reactivated_by = actor_user_id,
      reactivation_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_salon_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'salon_id', p_salon_id,
    'status', 'active'
  );
end;
$$;

create or replace function public.close_salon_permanently(
  p_salon_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  current_status text;
  salon_row public.locations%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  select *
  into salon_row
  from public.locations
  where id = p_salon_id;

  if salon_row.id is null then
    raise exception 'Salon was not found.';
  end if;

  if not public.user_has_account_permission(salon_row.account_id, array['account.manage']::text[]) then
    raise exception 'Only Account owners can change salon lifecycle.';
  end if;

  current_status := public.normalize_salon_lifecycle_status(salon_row.status);

  if current_status = 'permanently_closed' then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'salon_id', p_salon_id,
      'status', current_status
    );
  end if;

  update public.locations
  set status = 'permanently_closed',
      closed_at = coalesce(closed_at, now()),
      closed_by = coalesce(closed_by, actor_user_id),
      closure_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), closure_reason)
  where id = p_salon_id;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'salon_id', p_salon_id,
    'status', 'permanently_closed'
  );
end;
$$;

grant select on table public.salon_lifecycle_events to authenticated;
grant all on table public.salon_lifecycle_events to service_role;

grant execute on function public.normalize_salon_lifecycle_status(text) to anon, authenticated;
grant execute on function public.salon_is_operational(uuid) to authenticated;
grant execute on function public.salon_has_active_owner(uuid) to authenticated;
grant execute on function public.disable_salon(uuid, text) to authenticated;
grant execute on function public.reactivate_salon(uuid, text) to authenticated;
grant execute on function public.close_salon_permanently(uuid, text) to authenticated;
