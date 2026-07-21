insert into public.permissions (code, name, description, category, is_system)
values
  (
    'payroll.tax_company',
    'View payroll tax company',
    'View tax-company payroll exports for enabled staff only.',
    'Payroll',
    true
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions
  on permissions.code = any(
    case roles.code
      when 'OWNER' then array['payroll.tax_company']
      when 'ACCOUNTANT' then array['payroll.tax_company']
      else array[]::text[]
    end
  )
on conflict do nothing;

create table if not exists public.salon_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  cycle_type text not null default 'monthly',
  biweekly_anchor_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_payroll_settings_salon_unique unique (salon_id),
  constraint salon_payroll_settings_cycle_type_check check (
    cycle_type in ('monthly', 'biweekly')
  )
);

create index if not exists salon_payroll_settings_org_salon_idx
on public.salon_payroll_settings(organization_id, salon_id);

drop trigger if exists update_salon_payroll_settings_updated_at
on public.salon_payroll_settings;

create trigger update_salon_payroll_settings_updated_at
before update on public.salon_payroll_settings
for each row
execute function public.update_updated_at_column();

create table if not exists public.staff_payroll_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  legal_name text,
  pay_type text not null default 'commission',
  commission_rate numeric(5,2) not null default 60,
  fixed_pay_amount numeric(12,2) not null default 0,
  check_rate numeric(5,2) not null default 60,
  tax_rate numeric(5,2) not null default 0,
  apply_tax_to_fixed_pay boolean not null default true,
  tax_company_enabled boolean not null default false,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_payroll_settings_staff_effective_unique unique (
    staff_id,
    effective_from
  ),
  constraint staff_payroll_settings_pay_type_check check (
    pay_type in ('commission', 'fixed')
  ),
  constraint staff_payroll_settings_commission_rate_range check (
    commission_rate >= 0
    and commission_rate <= 100
  ),
  constraint staff_payroll_settings_fixed_pay_amount_nonnegative check (
    fixed_pay_amount >= 0
  ),
  constraint staff_payroll_settings_check_rate_range check (
    check_rate >= 0
    and check_rate <= 100
  ),
  constraint staff_payroll_settings_tax_rate_range check (
    tax_rate >= 0
    and tax_rate <= 100
  ),
  constraint staff_payroll_settings_effective_date_order check (
    effective_to is null
    or effective_to >= effective_from
  )
);

create index if not exists staff_payroll_settings_org_salon_staff_idx
on public.staff_payroll_settings(organization_id, salon_id, staff_id);

create index if not exists staff_payroll_settings_effective_idx
on public.staff_payroll_settings(staff_id, effective_from desc, effective_to);

drop trigger if exists update_staff_payroll_settings_updated_at
on public.staff_payroll_settings;

create trigger update_staff_payroll_settings_updated_at
before update on public.staff_payroll_settings
for each row
execute function public.update_updated_at_column();

create table if not exists public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  cycle_type text not null,
  status text not null default 'draft',
  settings_snapshot jsonb not null default '{}'::jsonb,
  correction_snapshot jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by uuid references public.users(id) on delete restrict,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_runs_salon_period_unique unique (
    salon_id,
    period_start,
    period_end
  ),
  constraint payroll_runs_period_order check (period_start <= period_end),
  constraint payroll_runs_cycle_type_check check (
    cycle_type in ('monthly', 'biweekly', 'custom')
  ),
  constraint payroll_runs_status_check check (
    status in ('draft', 'locked', 'paid', 'needs_review')
  )
);

create index if not exists payroll_runs_org_salon_period_idx
on public.payroll_runs(organization_id, salon_id, period_start, period_end);

create index if not exists payroll_runs_status_idx
on public.payroll_runs(status);

drop trigger if exists update_payroll_runs_updated_at
on public.payroll_runs;

create trigger update_payroll_runs_updated_at
before update on public.payroll_runs
for each row
execute function public.update_updated_at_column();

create table if not exists public.payroll_staff_lines (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  staff_display_name_snapshot text not null,
  staff_legal_name_snapshot text,
  gross_sales numeric(12,2) not null default 0,
  pay_type_used text not null,
  commission_rate_used numeric(5,2) not null default 0,
  fixed_pay_amount_used numeric(12,2) not null default 0,
  staff_commission_gross numeric(12,2) not null default 0,
  shop_share numeric(12,2) not null default 0,
  check_rate_used numeric(5,2) not null default 0,
  cash_amount numeric(12,2) not null default 0,
  check_gross numeric(12,2) not null default 0,
  tax_rate_used numeric(5,2) not null default 0,
  tax_withheld numeric(12,2) not null default 0,
  check_net numeric(12,2) not null default 0,
  check_number text,
  tip_amount numeric(12,2) not null default 0,
  tip_allocation_method text not null default 'prorated',
  bonus_amount numeric(12,2) not null default 0,
  final_staff_income numeric(12,2) not null default 0,
  tax_company_enabled_snapshot boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_staff_lines_run_staff_unique unique (
    payroll_run_id,
    staff_id
  ),
  constraint payroll_staff_lines_name_not_blank check (
    length(btrim(staff_display_name_snapshot)) > 0
  ),
  constraint payroll_staff_lines_pay_type_check check (
    pay_type_used in ('commission', 'fixed')
  ),
  constraint payroll_staff_lines_commission_rate_range check (
    commission_rate_used >= 0
    and commission_rate_used <= 100
  ),
  constraint payroll_staff_lines_fixed_pay_amount_nonnegative check (
    fixed_pay_amount_used >= 0
  ),
  constraint payroll_staff_lines_check_rate_range check (
    check_rate_used >= 0
    and check_rate_used <= 100
  ),
  constraint payroll_staff_lines_tax_rate_range check (
    tax_rate_used >= 0
    and tax_rate_used <= 100
  ),
  constraint payroll_staff_lines_bonus_amount_nonnegative check (
    bonus_amount >= 0
  ),
  constraint payroll_staff_lines_tip_allocation_method_check check (
    tip_allocation_method in ('prorated', 'manual', 'staff_earning', 'none')
  )
);

create index if not exists payroll_staff_lines_run_idx
on public.payroll_staff_lines(payroll_run_id);

create index if not exists payroll_staff_lines_org_salon_staff_idx
on public.payroll_staff_lines(organization_id, salon_id, staff_id);

create index if not exists payroll_staff_lines_tax_company_idx
on public.payroll_staff_lines(payroll_run_id, tax_company_enabled_snapshot)
where tax_company_enabled_snapshot = true;

drop trigger if exists update_payroll_staff_lines_updated_at
on public.payroll_staff_lines;

create trigger update_payroll_staff_lines_updated_at
before update on public.payroll_staff_lines
for each row
execute function public.update_updated_at_column();

create table if not exists public.payroll_staff_daily_totals (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  business_date date not null,
  gross_sales numeric(12,2) not null default 0,
  tip_amount numeric(12,2) not null default 0,
  correction_delta numeric(12,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_staff_daily_totals_run_staff_date_unique unique (
    payroll_run_id,
    staff_id,
    business_date
  )
);

create index if not exists payroll_staff_daily_totals_run_idx
on public.payroll_staff_daily_totals(payroll_run_id);

create index if not exists payroll_staff_daily_totals_org_salon_date_idx
on public.payroll_staff_daily_totals(organization_id, salon_id, business_date);

drop trigger if exists update_payroll_staff_daily_totals_updated_at
on public.payroll_staff_daily_totals;

create trigger update_payroll_staff_daily_totals_updated_at
before update on public.payroll_staff_daily_totals
for each row
execute function public.update_updated_at_column();

create table if not exists public.payroll_paystubs (
  id uuid primary key default gen_random_uuid(),
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  uploaded_by uuid references public.users(id) on delete set null,
  file_url_or_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_paystubs_run_staff_unique unique (
    payroll_run_id,
    staff_id
  ),
  constraint payroll_paystubs_size_nonnegative check (
    size_bytes is null
    or size_bytes >= 0
  )
);

create index if not exists payroll_paystubs_run_idx
on public.payroll_paystubs(payroll_run_id);

create index if not exists payroll_paystubs_org_salon_staff_idx
on public.payroll_paystubs(organization_id, salon_id, staff_id);

drop trigger if exists update_payroll_paystubs_updated_at
on public.payroll_paystubs;

create trigger update_payroll_paystubs_updated_at
before update on public.payroll_paystubs
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_salon_payroll_setting_scope()
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
    raise exception 'Payroll setting salon must belong to payroll setting organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_payroll_setting_scope
on public.salon_payroll_settings;

create trigger validate_salon_payroll_setting_scope
before insert or update on public.salon_payroll_settings
for each row
execute function public.validate_salon_payroll_setting_scope();

create or replace function public.validate_staff_payroll_setting_scope()
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
    raise exception 'Staff payroll setting staff must belong to its salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_payroll_setting_scope
on public.staff_payroll_settings;

create trigger validate_staff_payroll_setting_scope
before insert or update on public.staff_payroll_settings
for each row
execute function public.validate_staff_payroll_setting_scope();

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

  if new.status = 'locked' and new.locked_at is null then
    raise exception 'Locked payroll runs require locked_at.';
  end if;

  if new.status = 'paid' and new.paid_at is null then
    raise exception 'Paid payroll runs require paid_at.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_run_scope
on public.payroll_runs;

create trigger validate_payroll_run_scope
before insert or update on public.payroll_runs
for each row
execute function public.validate_payroll_run_scope();

create or replace function public.validate_payroll_staff_line_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.payroll_runs
    where payroll_runs.id = new.payroll_run_id
      and payroll_runs.organization_id = new.organization_id
      and payroll_runs.salon_id = new.salon_id
  ) then
    raise exception 'Payroll staff line must belong to its payroll run.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Payroll staff line staff must belong to its salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_staff_line_scope
on public.payroll_staff_lines;

create trigger validate_payroll_staff_line_scope
before insert or update on public.payroll_staff_lines
for each row
execute function public.validate_payroll_staff_line_scope();

create or replace function public.validate_payroll_staff_daily_total_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.payroll_runs
    where payroll_runs.id = new.payroll_run_id
      and payroll_runs.organization_id = new.organization_id
      and payroll_runs.salon_id = new.salon_id
      and new.business_date between payroll_runs.period_start and payroll_runs.period_end
  ) then
    raise exception 'Payroll daily total must belong to its payroll run period.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Payroll daily total staff must belong to its salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_staff_daily_total_scope
on public.payroll_staff_daily_totals;

create trigger validate_payroll_staff_daily_total_scope
before insert or update on public.payroll_staff_daily_totals
for each row
execute function public.validate_payroll_staff_daily_total_scope();

create or replace function public.validate_payroll_paystub_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.payroll_runs
    where payroll_runs.id = new.payroll_run_id
      and payroll_runs.organization_id = new.organization_id
      and payroll_runs.salon_id = new.salon_id
  ) then
    raise exception 'Payroll paystub must belong to its payroll run.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
  ) then
    raise exception 'Payroll paystub staff must belong to its salon.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_paystub_scope
on public.payroll_paystubs;

create trigger validate_payroll_paystub_scope
before insert or update on public.payroll_paystubs
for each row
execute function public.validate_payroll_paystub_scope();

alter table public.salon_payroll_settings enable row level security;
alter table public.staff_payroll_settings enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_staff_lines enable row level security;
alter table public.payroll_staff_daily_totals enable row level security;
alter table public.payroll_paystubs enable row level security;

drop policy if exists "Payroll viewers can view salon payroll settings"
on public.salon_payroll_settings;
create policy "Payroll viewers can view salon payroll settings"
on public.salon_payroll_settings
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
);

drop policy if exists "Payroll managers can manage salon payroll settings"
on public.salon_payroll_settings;
create policy "Payroll managers can manage salon payroll settings"
on public.salon_payroll_settings
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

drop policy if exists "Payroll viewers can view staff payroll settings"
on public.staff_payroll_settings;
create policy "Payroll viewers can view staff payroll settings"
on public.staff_payroll_settings
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or exists (
    select 1
    from public.staff
    where staff.id = staff_payroll_settings.staff_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can manage staff payroll settings"
on public.staff_payroll_settings;
create policy "Payroll managers can manage staff payroll settings"
on public.staff_payroll_settings
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

drop policy if exists "Payroll viewers can view salon payroll runs"
on public.payroll_runs;
create policy "Payroll viewers can view salon payroll runs"
on public.payroll_runs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage', 'payroll.tax_company']::text[]
  )
  or exists (
    select 1
    from public.payroll_staff_lines
    join public.staff
      on staff.id = payroll_staff_lines.staff_id
    where payroll_staff_lines.payroll_run_id = payroll_runs.id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can manage salon payroll runs"
on public.payroll_runs;
create policy "Payroll managers can manage salon payroll runs"
on public.payroll_runs
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

drop policy if exists "Payroll viewers can view salon payroll staff lines"
on public.payroll_staff_lines;
create policy "Payroll viewers can view salon payroll staff lines"
on public.payroll_staff_lines
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or (
    tax_company_enabled_snapshot = true
    and public.user_has_organization_permission(
      organization_id,
      array['payroll.tax_company']::text[]
    )
  )
  or exists (
    select 1
    from public.staff
    where staff.id = payroll_staff_lines.staff_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can manage salon payroll staff lines"
on public.payroll_staff_lines;
create policy "Payroll managers can manage salon payroll staff lines"
on public.payroll_staff_lines
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

drop policy if exists "Payroll viewers can view salon payroll daily totals"
on public.payroll_staff_daily_totals;
create policy "Payroll viewers can view salon payroll daily totals"
on public.payroll_staff_daily_totals
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or exists (
    select 1
    from public.staff
    where staff.id = payroll_staff_daily_totals.staff_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can manage salon payroll daily totals"
on public.payroll_staff_daily_totals;
create policy "Payroll managers can manage salon payroll daily totals"
on public.payroll_staff_daily_totals
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

drop policy if exists "Payroll viewers can view salon paystubs"
on public.payroll_paystubs;
create policy "Payroll viewers can view salon paystubs"
on public.payroll_paystubs
for select
to authenticated
using (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.view', 'payroll.manage']::text[]
  )
  or (
    public.user_has_organization_permission(
      organization_id,
      array['payroll.tax_company']::text[]
    )
    and exists (
      select 1
      from public.payroll_staff_lines
      where payroll_staff_lines.payroll_run_id = payroll_paystubs.payroll_run_id
        and payroll_staff_lines.staff_id = payroll_paystubs.staff_id
        and payroll_staff_lines.tax_company_enabled_snapshot = true
    )
  )
  or exists (
    select 1
    from public.staff
    where staff.id = payroll_paystubs.staff_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can manage salon paystubs"
on public.payroll_paystubs;
create policy "Payroll managers can manage salon paystubs"
on public.payroll_paystubs
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
