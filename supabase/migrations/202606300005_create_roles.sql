create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_name_not_blank check (length(btrim(name)) > 0),
  constraint roles_code_not_blank check (length(btrim(code)) > 0),
  constraint roles_organization_id_id_unique unique (organization_id, id)
);

create unique index if not exists roles_organization_code_unique_idx
on public.roles(organization_id, upper(btrim(code)));

create index if not exists roles_organization_id_idx
on public.roles(organization_id);

drop trigger if exists update_roles_updated_at on public.roles;

create trigger update_roles_updated_at
before update on public.roles
for each row
execute function public.update_updated_at_column();

create or replace function public.seed_default_roles_for_organization(
  target_organization_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.roles (
    organization_id,
    name,
    code,
    description,
    is_system
  )
  values
    (
      target_organization_id,
      'Owner',
      'OWNER',
      'Primary business owner with full organization responsibility.',
      true
    ),
    (
      target_organization_id,
      'Manager',
      'MANAGER',
      'Operational manager for daily business workflows.',
      true
    ),
    (
      target_organization_id,
      'Front Desk',
      'FRONT_DESK',
      'Reception and customer-facing front desk team member.',
      true
    ),
    (
      target_organization_id,
      'Technician',
      'TECHNICIAN',
      'Service provider or technician working inside the organization.',
      true
    ),
    (
      target_organization_id,
      'Accountant',
      'ACCOUNTANT',
      'Finance and bookkeeping role for the organization.',
      true
    ),
    (
      target_organization_id,
      'Marketing',
      'MARKETING',
      'Marketing and customer growth role for the organization.',
      true
    )
  on conflict do nothing;
$$;

create or replace function public.seed_default_roles_after_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_roles_for_organization(new.id);
  return new;
end;
$$;

drop trigger if exists seed_default_roles_after_organization_insert
on public.organizations;

create trigger seed_default_roles_after_organization_insert
after insert on public.organizations
for each row
execute function public.seed_default_roles_after_organization_insert();

select public.seed_default_roles_for_organization(organizations.id)
from public.organizations;

alter table public.organization_memberships
add column if not exists role_id uuid;

update public.organization_memberships
set role_id = roles.id
from public.roles
where roles.organization_id = organization_memberships.organization_id
  and roles.code = case organization_memberships.role
    when 'owner' then 'OWNER'
    when 'admin' then 'MANAGER'
    when 'manager' then 'MANAGER'
    when 'technician' then 'TECHNICIAN'
    when 'receptionist' then 'FRONT_DESK'
    else 'FRONT_DESK'
  end
  and organization_memberships.role_id is null;

alter table public.organization_memberships
alter column role_id set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organization_memberships_organization_role_fk'
  ) then
    alter table public.organization_memberships
    add constraint organization_memberships_organization_role_fk
    foreign key (organization_id, role_id)
    references public.roles(organization_id, id)
    on delete restrict;
  end if;
end $$;

create index if not exists organization_memberships_role_id_idx
on public.organization_memberships(role_id);

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
    join public.roles
      on roles.id = organization_memberships.role_id
      and roles.organization_id = organization_memberships.organization_id
    where organization_memberships.organization_id = target_organization_id
      and organization_memberships.user_id = public.current_public_user_id()
      and roles.code = 'OWNER'
      and organization_memberships.status = 'active'
  )
$$;

alter table public.roles enable row level security;

drop policy if exists "Organization members can view roles" on public.roles;
create policy "Organization members can view roles"
on public.roles
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  or public.user_owns_organization(organization_id)
);

drop policy if exists "Organization owners can create custom roles" on public.roles;
create policy "Organization owners can create custom roles"
on public.roles
for insert
to authenticated
with check (
  public.user_is_organization_owner_member(organization_id)
  and is_system = false
);

drop policy if exists "Organization owners can update custom roles" on public.roles;
create policy "Organization owners can update custom roles"
on public.roles
for update
to authenticated
using (
  public.user_is_organization_owner_member(organization_id)
  and is_system = false
)
with check (
  public.user_is_organization_owner_member(organization_id)
  and is_system = false
);

drop policy if exists "Organization owners can delete custom roles" on public.roles;
create policy "Organization owners can delete custom roles"
on public.roles
for delete
to authenticated
using (
  public.user_is_organization_owner_member(organization_id)
  and is_system = false
);

create or replace function public.prevent_system_role_delete()
returns trigger
language plpgsql
as $$
begin
  if old.is_system then
    raise exception 'System roles cannot be deleted.';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_system_role_delete on public.roles;

create trigger prevent_system_role_delete
before delete on public.roles
for each row
execute function public.prevent_system_role_delete();

drop policy if exists "Organization owners can create their owner membership"
on public.organization_memberships;

create policy "Organization owners can create their owner membership"
on public.organization_memberships
for insert
to authenticated
with check (
  user_id = public.current_public_user_id()
  and status = 'active'
  and public.user_owns_organization(organization_id)
  and exists (
    select 1
    from public.roles
    where roles.id = role_id
      and roles.organization_id = organization_memberships.organization_id
      and roles.code = 'OWNER'
  )
);
