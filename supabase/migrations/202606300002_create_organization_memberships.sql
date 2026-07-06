create or replace function public.current_public_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select users.id
  from public.users
  where users.auth_user_id = auth.uid()
  limit 1
$$;

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  invited_by_user_id uuid references public.users(id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_memberships_role_check check (
    role in ('owner', 'admin', 'manager', 'technician', 'receptionist', 'member')
  ),
  constraint organization_memberships_status_check check (
    status in ('invited', 'active', 'inactive', 'removed')
  ),
  constraint organization_memberships_organization_user_unique unique (
    organization_id,
    user_id
  )
);

create index if not exists organization_memberships_organization_id_idx
on public.organization_memberships(organization_id);

create index if not exists organization_memberships_user_id_idx
on public.organization_memberships(user_id);

drop trigger if exists update_organization_memberships_updated_at
on public.organization_memberships;

create trigger update_organization_memberships_updated_at
before update on public.organization_memberships
for each row
execute function public.update_updated_at_column();

create or replace function public.user_owns_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organizations
    where organizations.id = target_organization_id
      and organizations.owner_user_id = public.current_public_user_id()
  )
$$;

create or replace function public.user_belongs_to_organization(target_organization_id uuid)
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
      and organization_memberships.status <> 'removed'
  )
$$;

alter table public.organization_memberships enable row level security;

drop policy if exists "Users can view organization memberships" on public.organization_memberships;
create policy "Users can view organization memberships"
on public.organization_memberships
for select
to authenticated
using (
  user_id = public.current_public_user_id()
  or public.user_belongs_to_organization(organization_id)
);

drop policy if exists "Organization owners can create their owner membership"
on public.organization_memberships;
create policy "Organization owners can create their owner membership"
on public.organization_memberships
for insert
to authenticated
with check (
  user_id = public.current_public_user_id()
  and role = 'owner'
  and status = 'active'
  and public.user_owns_organization(organization_id)
);

drop policy if exists "Users can view their organizations" on public.organizations;
create policy "Users can view their organizations"
on public.organizations
for select
to authenticated
using (
  owner_user_id = public.current_public_user_id()
  or public.user_belongs_to_organization(id)
);
