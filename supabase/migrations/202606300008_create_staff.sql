create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null,
  first_name text,
  last_name text,
  phone text,
  email text,
  job_title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_display_name_not_blank check (length(btrim(display_name)) > 0)
);

create index if not exists staff_salon_created_at_idx
on public.staff(salon_id, created_at desc);

create index if not exists staff_organization_id_idx
on public.staff(organization_id);

create index if not exists staff_salon_active_idx
on public.staff(salon_id, is_active);

drop trigger if exists update_staff_updated_at on public.staff;

create trigger update_staff_updated_at
before update on public.staff
for each row
execute function public.update_updated_at_column();

create or replace function public.prevent_staff_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Staff cannot be hard deleted. Set is_active to false instead.';
end;
$$;

drop trigger if exists prevent_staff_delete on public.staff;

create trigger prevent_staff_delete
before delete on public.staff
for each row
execute function public.prevent_staff_delete();

insert into public.permissions (code, name, description, category, is_system)
values
  ('staff.view', 'View staff', 'View staff records.', 'Staff', true),
  ('staff.manage', 'Manage staff', 'Create and manage staff records.', 'Staff', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

alter table public.staff enable row level security;

drop policy if exists "Organization members can view salon staff" on public.staff;
create policy "Organization members can view salon staff"
on public.staff
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff.salon_id
      and locations.organization_id = staff.organization_id
  )
);

drop policy if exists "Organization members can create salon staff" on public.staff;
create policy "Organization members can create salon staff"
on public.staff
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = staff.salon_id
      and locations.organization_id = staff.organization_id
  )
);
