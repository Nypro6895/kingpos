create or replace function public.user_has_organization_permission(
  target_organization_id uuid,
  permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships
    join public.role_permissions
      on role_permissions.role_id = organization_memberships.role_id
    join public.permissions
      on permissions.id = role_permissions.permission_id
    where organization_memberships.organization_id = target_organization_id
      and organization_memberships.user_id = public.current_public_user_id()
      and organization_memberships.status = 'active'
      and permissions.code = any(permission_codes)
  )
$$;

create table if not exists public.pos_daily_closings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  report_date date not null,
  cash_amount numeric(12,2) not null default 0,
  credit_card_amount numeric(12,2) not null default 0,
  other_amount numeric(12,2) not null default 0,
  note text,
  status text not null default 'draft',
  closed_at timestamptz,
  closed_by uuid references public.users(id) on delete restrict,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete restrict,
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_daily_closings_salon_report_date_unique unique (
    salon_id,
    report_date
  ),
  constraint pos_daily_closings_cash_amount_nonnegative check (
    cash_amount >= 0
  ),
  constraint pos_daily_closings_credit_card_amount_nonnegative check (
    credit_card_amount >= 0
  ),
  constraint pos_daily_closings_other_amount_nonnegative check (
    other_amount >= 0
  ),
  constraint pos_daily_closings_status_check check (
    status in ('draft', 'closed', 'approved', 'reopened')
  )
);

create index if not exists pos_daily_closings_organization_id_idx
on public.pos_daily_closings(organization_id);

create index if not exists pos_daily_closings_salon_id_idx
on public.pos_daily_closings(salon_id);

create index if not exists pos_daily_closings_report_date_idx
on public.pos_daily_closings(report_date);

drop trigger if exists update_pos_daily_closings_updated_at
on public.pos_daily_closings;

create trigger update_pos_daily_closings_updated_at
before update on public.pos_daily_closings
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_pos_daily_closing_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Daily closing organization cannot be changed.';
    end if;

    if new.salon_id is distinct from old.salon_id then
      raise exception 'Daily closing salon cannot be changed.';
    end if;

    if new.report_date is distinct from old.report_date then
      raise exception 'Daily closing report date cannot be changed.';
    end if;

    if new.created_by is distinct from old.created_by then
      raise exception 'Daily closing created_by cannot be changed.';
    end if;
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Daily closing salon must belong to daily closing organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_pos_daily_closing_scope
on public.pos_daily_closings;

create trigger validate_pos_daily_closing_scope
before insert or update on public.pos_daily_closings
for each row
execute function public.validate_pos_daily_closing_scope();

alter table public.pos_daily_closings enable row level security;

drop policy if exists "Report viewers can view salon daily closings"
on public.pos_daily_closings;
create policy "Report viewers can view salon daily closings"
on public.pos_daily_closings
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['reports.view']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
);

drop policy if exists "Payroll managers can create salon daily closings"
on public.pos_daily_closings;
create policy "Payroll managers can create salon daily closings"
on public.pos_daily_closings
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage']::text[]
  )
  and created_by = public.current_public_user_id()
  and (
    updated_by is null
    or updated_by = public.current_public_user_id()
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
);

drop policy if exists "Payroll managers can update salon daily closings"
on public.pos_daily_closings;
create policy "Payroll managers can update salon daily closings"
on public.pos_daily_closings
for update
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage']::text[]
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage']::text[]
  )
  and (
    updated_by is null
    or updated_by = public.current_public_user_id()
  )
  and exists (
    select 1
    from public.locations
    where locations.id = pos_daily_closings.salon_id
      and locations.organization_id = pos_daily_closings.organization_id
  )
);
