alter table public.payroll_runs
add column if not exists version integer not null default 1;

alter table public.payroll_runs
add column if not exists printed_at timestamptz;

alter table public.payroll_runs
add column if not exists printed_by uuid references public.users(id) on delete restrict;

alter table public.payroll_runs
drop constraint if exists payroll_runs_salon_period_unique;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payroll_runs_salon_period_version_unique'
      and conrelid = 'public.payroll_runs'::regclass
  ) then
    alter table public.payroll_runs
    add constraint payroll_runs_salon_period_version_unique unique (
      salon_id,
      period_start,
      period_end,
      version
    );
  end if;
end;
$$;

create index if not exists payroll_runs_org_salon_period_version_idx
on public.payroll_runs(organization_id, salon_id, period_start, period_end, version desc);

alter table public.payroll_runs
drop constraint if exists payroll_runs_status_check;

alter table public.payroll_runs
add constraint payroll_runs_status_check check (
  status in ('draft', 'locked', 'printed', 'paid', 'needs_review')
);

update public.payroll_runs
set
  status = case
    when status in ('draft', 'locked', 'needs_review') then 'printed'
    else status
  end,
  printed_at = coalesce(printed_at, locked_at, generated_at),
  printed_by = coalesce(printed_by, locked_by)
where status in ('draft', 'locked', 'needs_review')
  and printed_at is null;

create or replace function public.validate_payroll_run_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Payroll run salon must belong to payroll run organization.';
  end if;

  if new.status in ('printed', 'paid') and new.printed_at is null then
    raise exception 'Printed payroll statements require printed_at.';
  end if;

  if new.status = 'paid' and new.paid_at is null then
    raise exception 'Paid payroll statements require paid_at.';
  end if;

  return new;
end;
$$;

alter table public.payroll_staff_lines
add column if not exists is_mixed_rate boolean not null default false;

alter table public.payroll_staff_lines
add column if not exists settings_used_snapshot jsonb not null default '{}'::jsonb;

alter table public.payroll_staff_lines
add column if not exists period_staff_input_snapshot jsonb not null default '{}'::jsonb;

alter table public.payroll_staff_daily_totals
add column if not exists pay_type_used text;

alter table public.payroll_staff_daily_totals
add column if not exists commission_rate_used numeric(5,2);

alter table public.payroll_staff_daily_totals
add column if not exists fixed_pay_amount_used numeric(12,2);

alter table public.payroll_staff_daily_totals
add column if not exists check_rate_used numeric(5,2);

alter table public.payroll_staff_daily_totals
add column if not exists tax_rate_used numeric(5,2);

alter table public.payroll_staff_daily_totals
add column if not exists settings_used_snapshot jsonb not null default '{}'::jsonb;

drop policy if exists "Payroll viewers can view staff payroll settings"
on public.staff_payroll_settings;
create policy "Payroll viewers can view staff payroll settings"
on public.staff_payroll_settings
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
  or exists (
    select 1
    from public.staff
    where staff.id = staff_payroll_settings.staff_id
      and staff.user_id = auth.uid()
  )
);

create table if not exists public.payroll_period_staff_inputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  cycle_type text not null,
  check_number text,
  bonus_amount numeric(12,2) not null default 0,
  note text,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_period_staff_inputs_unique unique (
    salon_id,
    staff_id,
    period_start,
    period_end
  ),
  constraint payroll_period_staff_inputs_period_order check (
    period_start <= period_end
  ),
  constraint payroll_period_staff_inputs_cycle_type_check check (
    cycle_type in ('monthly', 'biweekly', 'custom')
  ),
  constraint payroll_period_staff_inputs_bonus_nonnegative check (
    bonus_amount >= 0
  )
);

create index if not exists payroll_period_staff_inputs_org_salon_period_idx
on public.payroll_period_staff_inputs(
  organization_id,
  salon_id,
  period_start,
  period_end
);

create index if not exists payroll_period_staff_inputs_staff_idx
on public.payroll_period_staff_inputs(staff_id, period_start desc);

drop trigger if exists update_payroll_period_staff_inputs_updated_at
on public.payroll_period_staff_inputs;

create trigger update_payroll_period_staff_inputs_updated_at
before update on public.payroll_period_staff_inputs
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_payroll_period_staff_input_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Payroll period staff input staff must belong to its salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_period_staff_input_scope
on public.payroll_period_staff_inputs;

create trigger validate_payroll_period_staff_input_scope
before insert or update on public.payroll_period_staff_inputs
for each row
execute function public.validate_payroll_period_staff_input_scope();

alter table public.payroll_period_staff_inputs enable row level security;

drop policy if exists "Payroll viewers can view period staff inputs"
on public.payroll_period_staff_inputs;
create policy "Payroll viewers can view period staff inputs"
on public.payroll_period_staff_inputs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
  or exists (
    select 1
    from public.staff
    where staff.id = payroll_period_staff_inputs.staff_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can manage period staff inputs"
on public.payroll_period_staff_inputs;
create policy "Payroll managers can manage period staff inputs"
on public.payroll_period_staff_inputs
for all
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage']::text[]
  )
)
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage']::text[]
  )
);
