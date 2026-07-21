create table if not exists public.salon_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  salon_id uuid not null references public.locations(id) on delete cascade,
  business_name text not null,
  phone text,
  email text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  business_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_settings_salon_id_unique unique (salon_id),
  constraint salon_settings_organization_id_salon_id_unique unique (organization_id, salon_id),
  constraint salon_settings_business_name_not_blank check (length(btrim(business_name)) > 0)
);

create index if not exists salon_settings_organization_id_idx
on public.salon_settings(organization_id);

drop trigger if exists update_salon_settings_updated_at on public.salon_settings;

create trigger update_salon_settings_updated_at
before update on public.salon_settings
for each row
execute function public.update_updated_at_column();

create or replace function public.validate_salon_settings_salon()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.salon_id is distinct from old.salon_id
  ) then
    raise exception 'Salon Settings organization and salon cannot be changed.';
  end if;

  if not exists (
    select 1
    from public.locations
    where locations.id = new.salon_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Salon Settings salon must belong to the organization.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_salon_settings_salon on public.salon_settings;

create trigger validate_salon_settings_salon
before insert or update on public.salon_settings
for each row
execute function public.validate_salon_settings_salon();

create or replace function public.prevent_salon_settings_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Salon Settings cannot be deleted.';
end;
$$;

drop trigger if exists prevent_salon_settings_delete on public.salon_settings;

create trigger prevent_salon_settings_delete
before delete on public.salon_settings
for each row
execute function public.prevent_salon_settings_delete();

insert into public.permissions (code, name, description, category, is_system)
values
  ('salon_settings.view', 'View salon settings', 'View salon settings.', 'Settings', true),
  ('salon_settings.manage', 'Manage salon settings', 'Manage salon settings.', 'Settings', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

select public.assign_default_permissions_for_organization(organizations.id)
from public.organizations;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles
join public.permissions
  on permissions.code = any(
    case roles.code
      when 'OWNER' then array[
        'salon_settings.view',
        'salon_settings.manage'
      ]
      when 'MANAGER' then array[
        'salon_settings.view'
      ]
      else array[]::text[]
    end
  )
on conflict do nothing;

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
          'settings.manage',
          'salon_settings.view',
          'salon_settings.manage'
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
          'settings.view',
          'salon_settings.view'
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

alter table public.salon_settings enable row level security;

drop policy if exists "Organization members can view salon settings" on public.salon_settings;
create policy "Organization members can view salon settings"
on public.salon_settings
for select
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = salon_settings.salon_id
      and locations.organization_id = salon_settings.organization_id
  )
);

drop policy if exists "Organization members can create salon settings" on public.salon_settings;
create policy "Organization members can create salon settings"
on public.salon_settings
for insert
to authenticated
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = salon_settings.salon_id
      and locations.organization_id = salon_settings.organization_id
  )
);

drop policy if exists "Organization members can update salon settings" on public.salon_settings;
create policy "Organization members can update salon settings"
on public.salon_settings
for update
to authenticated
using (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = salon_settings.salon_id
      and locations.organization_id = salon_settings.organization_id
  )
)
with check (
  public.user_belongs_to_organization(organization_id)
  and exists (
    select 1
    from public.locations
    where locations.id = salon_settings.salon_id
      and locations.organization_id = salon_settings.organization_id
  )
);
