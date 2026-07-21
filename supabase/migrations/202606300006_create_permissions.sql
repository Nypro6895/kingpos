create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  category text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permissions_code_not_blank check (length(btrim(code)) > 0),
  constraint permissions_name_not_blank check (length(btrim(name)) > 0),
  constraint permissions_category_not_blank check (length(btrim(category)) > 0)
);

create index if not exists permissions_category_code_idx
on public.permissions(category, code);

drop trigger if exists update_permissions_updated_at on public.permissions;

create trigger update_permissions_updated_at
before update on public.permissions
for each row
execute function public.update_updated_at_column();

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint role_permissions_role_id_permission_id_unique unique (role_id, permission_id)
);

create index if not exists role_permissions_role_id_idx
on public.role_permissions(role_id);

create index if not exists role_permissions_permission_id_idx
on public.role_permissions(permission_id);

insert into public.permissions (code, name, description, category, is_system)
values
  ('organization.view', 'View organization', 'View organization profile and business details.', 'Organization', true),
  ('organization.manage', 'Manage organization', 'Manage critical organization settings.', 'Organization', true),
  ('salon.view', 'View salons', 'View salon and location records.', 'Salon', true),
  ('salon.manage', 'Manage salons', 'Create and manage salon and location records.', 'Salon', true),
  ('members.view', 'View members', 'View organization members.', 'Members', true),
  ('members.manage', 'Manage members', 'Manage organization member records.', 'Members', true),
  ('roles.view', 'View roles', 'View roles in the organization.', 'Roles', true),
  ('roles.manage', 'Manage roles', 'Manage role definitions and assignments.', 'Roles', true),
  ('customers.view', 'View customers', 'View customer records when customer features are available.', 'Customers', true),
  ('customers.manage', 'Manage customers', 'Create and manage customer records when customer features are available.', 'Customers', true),
  ('staff.view', 'View staff', 'View staff records when staff features are available.', 'Staff', true),
  ('staff.manage', 'Manage staff', 'Create and manage staff records when staff features are available.', 'Staff', true),
  ('services.view', 'View services', 'View services when service features are available.', 'Services', true),
  ('services.manage', 'Manage services', 'Create and manage services when service features are available.', 'Services', true),
  ('booking.view', 'View bookings', 'View bookings when booking features are available.', 'Booking', true),
  ('booking.manage', 'Manage bookings', 'Create and manage bookings when booking features are available.', 'Booking', true),
  ('tickets.view', 'View tickets', 'View tickets when ticket features are available.', 'Tickets', true),
  ('tickets.manage', 'Manage tickets', 'Create and manage tickets when ticket features are available.', 'Tickets', true),
  ('tickets.void', 'Void tickets', 'Void tickets when ticket features are available.', 'Tickets', true),
  ('tickets.refund', 'Refund tickets', 'Refund tickets when ticket features are available.', 'Tickets', true),
  ('payroll.view', 'View payroll', 'View payroll when payroll features are available.', 'Payroll', true),
  ('payroll.manage', 'Manage payroll', 'Manage payroll when payroll features are available.', 'Payroll', true),
  ('reports.view', 'View reports', 'View reports when reporting features are available.', 'Reports', true),
  ('settings.view', 'View settings', 'View settings areas.', 'Settings', true),
  ('settings.manage', 'Manage settings', 'Manage settings areas.', 'Settings', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

create or replace function public.assign_default_permissions_for_organization(
  target_organization_id uuid
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.role_permissions (role_id, permission_id)
  select roles.id, permissions.id
  from public.roles
  join public.permissions
    on permissions.code = any(
      case roles.code
        when 'OWNER' then array[
          'organization.view',
          'organization.manage',
          'salon.view',
          'salon.manage',
          'members.view',
          'members.manage',
          'roles.view',
          'roles.manage',
          'customers.view',
          'customers.manage',
          'staff.view',
          'staff.manage',
          'services.view',
          'services.manage',
          'booking.view',
          'booking.manage',
          'tickets.view',
          'tickets.manage',
          'tickets.void',
          'tickets.refund',
          'payroll.view',
          'payroll.manage',
          'reports.view',
          'settings.view',
          'settings.manage'
        ]
        when 'MANAGER' then array[
          'organization.view',
          'salon.view',
          'salon.manage',
          'members.view',
          'members.manage',
          'roles.view',
          'customers.view',
          'customers.manage',
          'staff.view',
          'staff.manage',
          'services.view',
          'services.manage',
          'booking.view',
          'booking.manage',
          'tickets.view',
          'tickets.manage',
          'tickets.void',
          'tickets.refund',
          'payroll.view',
          'reports.view',
          'settings.view'
        ]
        when 'FRONT_DESK' then array[
          'salon.view',
          'customers.view',
          'customers.manage',
          'booking.view',
          'booking.manage',
          'tickets.view',
          'tickets.manage',
          'services.view',
          'staff.view'
        ]
        when 'TECHNICIAN' then array[
          'salon.view',
          'booking.view',
          'tickets.view',
          'customers.view',
          'services.view'
        ]
        when 'ACCOUNTANT' then array[
          'salon.view',
          'reports.view',
          'payroll.view',
          'payroll.manage',
          'tickets.view'
        ]
        when 'MARKETING' then array[
          'salon.view',
          'customers.view',
          'reports.view'
        ]
        else array[]::text[]
      end
    )
  where roles.organization_id = target_organization_id
  on conflict do nothing;
$$;

create or replace function public.seed_default_roles_for_organization(
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

  perform public.assign_default_permissions_for_organization(target_organization_id);
end;
$$;

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

create or replace function public.user_is_active_organization_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships
    where organization_memberships.user_id = public.current_public_user_id()
      and organization_memberships.status = 'active'
  )
$$;

create or replace function public.prevent_system_permission_delete()
returns trigger
language plpgsql
as $$
begin
  if old.is_system then
    raise exception 'System permissions cannot be deleted.';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_system_permission_delete on public.permissions;

create trigger prevent_system_permission_delete
before delete on public.permissions
for each row
execute function public.prevent_system_permission_delete();

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

drop policy if exists "Organization members can view permissions" on public.permissions;
create policy "Organization members can view permissions"
on public.permissions
for select
to authenticated
using (
  public.user_is_active_organization_member()
);

drop policy if exists "Organization members can view role permissions" on public.role_permissions;
create policy "Organization members can view role permissions"
on public.role_permissions
for select
to authenticated
using (
  exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and public.user_belongs_to_organization(roles.organization_id)
  )
);

drop policy if exists "Organization owners can create role permissions" on public.role_permissions;
create policy "Organization owners can create role permissions"
on public.role_permissions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and public.user_is_organization_owner_member(roles.organization_id)
  )
);

drop policy if exists "Organization owners can delete role permissions" on public.role_permissions;
create policy "Organization owners can delete role permissions"
on public.role_permissions
for delete
to authenticated
using (
  exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and public.user_is_organization_owner_member(roles.organization_id)
  )
);

drop policy if exists "Organization owners can update role permissions" on public.role_permissions;
create policy "Organization owners can update role permissions"
on public.role_permissions
for update
to authenticated
using (
  exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and public.user_is_organization_owner_member(roles.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.roles
    where roles.id = role_permissions.role_id
      and public.user_is_organization_owner_member(roles.organization_id)
  )
);
