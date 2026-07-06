create table if not exists public.staff_workdays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  status text not null default 'checked_in',
  check_in_at timestamptz,
  check_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_workdays_status_check check (
    status in ('checked_in', 'working', 'checked_out')
  ),
  constraint staff_workdays_check_out_after_check_in check (
    check_out_at is null
    or check_in_at is null
    or check_out_at >= check_in_at
  ),
  constraint staff_workdays_staff_date_salon_unique unique (
    staff_id,
    work_date,
    salon_id
  )
);

create index if not exists staff_workdays_salon_work_date_idx
on public.staff_workdays(salon_id, work_date desc);

create index if not exists staff_workdays_staff_work_date_idx
on public.staff_workdays(staff_id, work_date desc);

create index if not exists staff_workdays_organization_id_idx
on public.staff_workdays(organization_id);

drop trigger if exists update_staff_workdays_updated_at on public.staff_workdays;

create trigger update_staff_workdays_updated_at
before update on public.staff_workdays
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_staff_workday_scope()
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
    raise exception 'Staff workday salon must belong to Staff workday organization.';
  end if;

  if not exists (
    select 1
    from public.staff
    where staff.id = new.staff_id
      and staff.organization_id = new.organization_id
      and staff.salon_id = new.salon_id
      and staff.is_active = true
  ) then
    raise exception 'Staff workday staff member must belong to Staff workday salon.';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id then
      raise exception 'Staff workday organization cannot be changed.';
    end if;

    if new.salon_id <> old.salon_id then
      raise exception 'Staff workday salon cannot be changed.';
    end if;

    if new.staff_id <> old.staff_id then
      raise exception 'Staff workday staff member cannot be changed.';
    end if;

    if new.work_date <> old.work_date then
      raise exception 'Staff workday date cannot be changed.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_staff_workday_scope on public.staff_workdays;

create trigger validate_staff_workday_scope
before insert or update on public.staff_workdays
for each row
execute function public.validate_staff_workday_scope();

alter table public.staff_workdays enable row level security;

drop policy if exists "Organization members can view salon staff workdays"
on public.staff_workdays;
create policy "Organization members can view salon staff workdays"
on public.staff_workdays
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff_workdays.salon_id
      and locations.organization_id = staff_workdays.organization_id
  )
);

drop policy if exists "Organization members can create salon staff workdays"
on public.staff_workdays;
create policy "Organization members can create salon staff workdays"
on public.staff_workdays
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff_workdays.salon_id
      and locations.organization_id = staff_workdays.organization_id
  )
);

drop policy if exists "Organization members can update salon staff workdays"
on public.staff_workdays;
create policy "Organization members can update salon staff workdays"
on public.staff_workdays
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff_workdays.salon_id
      and locations.organization_id = staff_workdays.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff_workdays.salon_id
      and locations.organization_id = staff_workdays.organization_id
  )
);
