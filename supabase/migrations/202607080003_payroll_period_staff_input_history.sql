create table if not exists public.payroll_period_staff_input_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete restrict,
  period_staff_input_id uuid references public.payroll_period_staff_inputs(id) on delete set null,
  payroll_run_id uuid references public.payroll_runs(id) on delete set null,
  period_start date not null,
  period_end date not null,
  cycle_type text not null,
  change_type text not null default 'input_update',
  field_changes jsonb not null default '{}'::jsonb,
  previous_value_json jsonb not null default '{}'::jsonb,
  new_value_json jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint payroll_period_staff_input_history_period_order check (
    period_start <= period_end
  ),
  constraint payroll_period_staff_input_history_cycle_type_check check (
    cycle_type in ('monthly', 'semi_monthly', 'biweekly', 'custom')
  ),
  constraint payroll_period_staff_input_history_change_type_check check (
    change_type in ('input_update', 'correction_request')
  )
);

create index if not exists payroll_period_staff_input_history_staff_period_idx
on public.payroll_period_staff_input_history(
  organization_id,
  salon_id,
  staff_id,
  period_start,
  period_end,
  created_at desc
);

create index if not exists payroll_period_staff_input_history_run_idx
on public.payroll_period_staff_input_history(payroll_run_id)
where payroll_run_id is not null;

create or replace function public.validate_payroll_period_staff_input_history_scope()
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
    raise exception 'Payroll input history staff must belong to its salon.';
  end if;

  if new.period_staff_input_id is not null and not exists (
    select 1
    from public.payroll_period_staff_inputs
    where payroll_period_staff_inputs.id = new.period_staff_input_id
      and payroll_period_staff_inputs.organization_id = new.organization_id
      and payroll_period_staff_inputs.salon_id = new.salon_id
      and payroll_period_staff_inputs.staff_id = new.staff_id
      and payroll_period_staff_inputs.period_start = new.period_start
      and payroll_period_staff_inputs.period_end = new.period_end
  ) then
    raise exception 'Payroll input history must reference a matching period input.';
  end if;

  if new.payroll_run_id is not null and not exists (
    select 1
    from public.payroll_runs
    where payroll_runs.id = new.payroll_run_id
      and payroll_runs.organization_id = new.organization_id
      and payroll_runs.salon_id = new.salon_id
      and payroll_runs.period_start = new.period_start
      and payroll_runs.period_end = new.period_end
  ) then
    raise exception 'Payroll input history must reference a matching payroll run.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payroll_period_staff_input_history_scope
on public.payroll_period_staff_input_history;

create trigger validate_payroll_period_staff_input_history_scope
before insert or update on public.payroll_period_staff_input_history
for each row
execute function public.validate_payroll_period_staff_input_history_scope();

alter table public.payroll_period_staff_input_history enable row level security;

drop policy if exists "Payroll viewers can view period staff input history"
on public.payroll_period_staff_input_history;
create policy "Payroll viewers can view period staff input history"
on public.payroll_period_staff_input_history
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
    where staff.id = payroll_period_staff_input_history.staff_id
      and staff.user_id = auth.uid()
  )
);

drop policy if exists "Payroll managers can create period staff input history"
on public.payroll_period_staff_input_history;
create policy "Payroll managers can create period staff input history"
on public.payroll_period_staff_input_history
for insert
to authenticated
with check (
  public.user_has_organization_permission(
    organization_id,
    array['payroll.manage']::text[]
  )
);
