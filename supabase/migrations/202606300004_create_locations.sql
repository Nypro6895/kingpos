create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_status_check check (
    status in ('active', 'inactive')
  ),
  constraint locations_name_not_blank check (length(btrim(name)) > 0)
);

create unique index if not exists locations_organization_name_unique_idx
on public.locations(organization_id, lower(btrim(name)));

create index if not exists locations_organization_id_idx
on public.locations(organization_id);

drop trigger if exists update_locations_updated_at on public.locations;

create trigger update_locations_updated_at
before update on public.locations
for each row
execute function public.update_updated_at_column();

create or replace function public.user_is_organization_owner_member(
  target_organization_id uuid
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
    where organization_memberships.organization_id = target_organization_id
      and organization_memberships.user_id = public.current_public_user_id()
      and organization_memberships.role = 'owner'
      and organization_memberships.status = 'active'
  )
$$;

alter table public.locations enable row level security;

drop policy if exists "Organization members can view locations" on public.locations;
create policy "Organization members can view locations"
on public.locations
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
);

drop policy if exists "Organization owners can create locations" on public.locations;
create policy "Organization owners can create locations"
on public.locations
for insert
to authenticated
with check (
  public.user_is_organization_owner_member(organization_id)
);

drop policy if exists "Organization owners can update locations" on public.locations;
create policy "Organization owners can update locations"
on public.locations
for update
to authenticated
using (
  public.user_is_organization_owner_member(organization_id)
)
with check (
  public.user_is_organization_owner_member(organization_id)
);

drop policy if exists "Organization owners can delete locations" on public.locations;
create policy "Organization owners can delete locations"
on public.locations
for delete
to authenticated
using (
  public.user_is_organization_owner_member(organization_id)
);
