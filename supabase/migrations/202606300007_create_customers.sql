create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_status_check check (
    status in ('active', 'inactive')
  ),
  constraint customers_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists customers_location_created_at_idx
on public.customers(location_id, created_at desc);

create index if not exists customers_location_status_idx
on public.customers(location_id, status);

create index if not exists customers_location_name_idx
on public.customers(location_id, lower(btrim(name)));

create index if not exists customers_location_phone_idx
on public.customers(location_id, phone);

drop trigger if exists update_customers_updated_at on public.customers;

create trigger update_customers_updated_at
before update on public.customers
for each row
execute function public.update_updated_at_column();

create or replace function public.prevent_customer_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Customers cannot be hard deleted. Set status to inactive instead.';
end;
$$;

drop trigger if exists prevent_customer_delete on public.customers;

create trigger prevent_customer_delete
before delete on public.customers
for each row
execute function public.prevent_customer_delete();

insert into public.permissions (code, name, description, category, is_system)
values
  ('customers.view', 'View customers', 'View customer records.', 'Customers', true),
  ('customers.manage', 'Manage customers', 'Create and manage customer records.', 'Customers', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

alter table public.customers enable row level security;

drop policy if exists "Organization members can view salon customers" on public.customers;
create policy "Organization members can view salon customers"
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.locations
    where locations.id = customers.location_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
);

drop policy if exists "Organization members can create salon customers" on public.customers;
create policy "Organization members can create salon customers"
on public.customers
for insert
to authenticated
with check (
  exists (
    select 1
    from public.locations
    where locations.id = customers.location_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
);

drop policy if exists "Organization members can update salon customers" on public.customers;
create policy "Organization members can update salon customers"
on public.customers
for update
to authenticated
using (
  exists (
    select 1
    from public.locations
    where locations.id = customers.location_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.locations
    where locations.id = customers.location_id
      and public.user_belongs_to_organization(locations.organization_id)
  )
);
