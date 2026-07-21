create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  category text,
  base_price numeric(10,2) not null default 0,
  duration_minutes integer not null default 30,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_name_not_blank check (length(btrim(name)) > 0),
  constraint services_base_price_not_negative check (base_price >= 0),
  constraint services_duration_minutes_positive check (duration_minutes > 0)
);

create index if not exists services_salon_created_at_idx
on public.services(salon_id, created_at desc);

create index if not exists services_organization_id_idx
on public.services(organization_id);

create index if not exists services_salon_active_idx
on public.services(salon_id, is_active);

drop trigger if exists update_services_updated_at on public.services;

create trigger update_services_updated_at
before update on public.services
for each row
execute function public.update_updated_at_column();

create or replace function public.prevent_service_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Services cannot be hard deleted. Set is_active to false instead.';
end;
$$;

drop trigger if exists prevent_service_delete on public.services;

create trigger prevent_service_delete
before delete on public.services
for each row
execute function public.prevent_service_delete();

insert into public.permissions (code, name, description, category, is_system)
values
  ('services.view', 'View services', 'View service records.', 'Services', true),
  ('services.manage', 'Manage services', 'Create and manage service records.', 'Services', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

alter table public.services enable row level security;

drop policy if exists "Organization members can view salon services" on public.services;
create policy "Organization members can view salon services"
on public.services
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = services.salon_id
      and locations.organization_id = services.organization_id
  )
);

drop policy if exists "Organization members can create salon services" on public.services;
create policy "Organization members can create salon services"
on public.services
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = services.salon_id
      and locations.organization_id = services.organization_id
  )
);
