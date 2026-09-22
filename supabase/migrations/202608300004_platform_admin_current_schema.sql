-- Platform admin merge for the current account/salon schema.
-- Consolidates Admin Phase 1 after the 20260724 account/salon baseline so a
-- fresh database applies in the correct order.
create table if not exists public.platform_admin_roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_admin_roles_slug_not_blank check (length(btrim(slug)) > 0),
  constraint platform_admin_roles_name_not_blank check (length(btrim(name)) > 0)
);

create index if not exists platform_admin_roles_slug_idx
on public.platform_admin_roles(slug);

drop trigger if exists update_platform_admin_roles_updated_at
on public.platform_admin_roles;

create trigger update_platform_admin_roles_updated_at
before update on public.platform_admin_roles
for each row
execute function public.set_updated_at();

create table if not exists public.platform_admin_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  category text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_admin_permissions_code_not_blank check (length(btrim(code)) > 0),
  constraint platform_admin_permissions_name_not_blank check (length(btrim(name)) > 0),
  constraint platform_admin_permissions_category_not_blank check (length(btrim(category)) > 0)
);

create index if not exists platform_admin_permissions_category_code_idx
on public.platform_admin_permissions(category, code);

drop trigger if exists update_platform_admin_permissions_updated_at
on public.platform_admin_permissions;

create trigger update_platform_admin_permissions_updated_at
before update on public.platform_admin_permissions
for each row
execute function public.set_updated_at();

create table if not exists public.platform_admin_role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.platform_admin_roles(id) on delete cascade,
  permission_id uuid not null references public.platform_admin_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint platform_admin_role_permissions_role_permission_unique unique (
    role_id,
    permission_id
  )
);

create index if not exists platform_admin_role_permissions_role_id_idx
on public.platform_admin_role_permissions(role_id);

create index if not exists platform_admin_role_permissions_permission_id_idx
on public.platform_admin_role_permissions(permission_id);

create table if not exists public.platform_admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete restrict,
  role_id uuid not null references public.platform_admin_roles(id) on delete restrict,
  status text not null default 'active',
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_admin_memberships_status_check check (
    status in ('active', 'suspended', 'revoked')
  )
);

create unique index if not exists platform_admin_memberships_current_user_unique_idx
on public.platform_admin_memberships(user_id)
where status in ('active', 'suspended');

create index if not exists platform_admin_memberships_role_status_idx
on public.platform_admin_memberships(role_id, status);

create index if not exists platform_admin_memberships_created_by_idx
on public.platform_admin_memberships(created_by_user_id);

drop trigger if exists update_platform_admin_memberships_updated_at
on public.platform_admin_memberships;

create trigger update_platform_admin_memberships_updated_at
before update on public.platform_admin_memberships
for each row
execute function public.set_updated_at();

create table if not exists public.platform_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  reason text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now(),
  constraint platform_admin_audit_logs_action_not_blank check (length(btrim(action)) > 0),
  constraint platform_admin_audit_logs_target_type_not_blank check (
    length(btrim(target_type)) > 0
  ),
  constraint platform_admin_audit_logs_metadata_object_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists platform_admin_audit_logs_actor_created_idx
on public.platform_admin_audit_logs(actor_user_id, created_at desc);

create index if not exists platform_admin_audit_logs_action_created_idx
on public.platform_admin_audit_logs(action, created_at desc);

create index if not exists platform_admin_audit_logs_target_idx
on public.platform_admin_audit_logs(target_type, target_id, created_at desc);

create index if not exists platform_admin_audit_logs_created_at_idx
on public.platform_admin_audit_logs(created_at desc);

insert into public.platform_admin_roles (slug, name, description, is_system)
values
  (
    'platform_owner',
    'Platform Owner',
    'Owns platform administration, platform team membership, and emergency controls.',
    true
  ),
  (
    'operations_admin',
    'Operations Admin',
    'Manages operational platform queues and business/location status workflows.',
    true
  ),
  (
    'support_agent',
    'Support Agent',
    'Views account and business support context and creates internal support notes.',
    true
  ),
  (
    'moderator',
    'Moderator',
    'Triages and resolves platform reports without team-management privileges.',
    true
  ),
  (
    'auditor',
    'Auditor',
    'Reviews platform audit history without mutation privileges.',
    true
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.platform_admin_permissions (
  code,
  name,
  description,
  category,
  is_system
)
values
  ('admin.access', 'Access Admin Center', 'Access the platform admin area.', 'Admin', true),
  ('admin.dashboard.read', 'Read Admin Dashboard', 'View the admin proof dashboard.', 'Admin', true),
  ('admin.users.read', 'Read Users', 'View platform user records in admin workflows.', 'Users', true),
  (
    'admin.users.read_sensitive',
    'Read Sensitive User Fields',
    'View user email and phone fields in platform admin workflows.',
    'Users',
    true
  ),
  ('admin.users.update', 'Update Users', 'Update safe public user profile fields.', 'Users', true),
  ('admin.users.suspend', 'Suspend Users', 'Suspend platform user accounts.', 'Users', true),
  ('admin.users.restore', 'Restore Users', 'Restore suspended platform user accounts.', 'Users', true),
  ('admin.businesses.read', 'Read Businesses', 'View platform business records.', 'Businesses', true),
  (
    'admin.businesses.update',
    'Update Businesses',
    'Update safe business profile fields through approved admin workflows.',
    'Businesses',
    true
  ),
  (
    'admin.businesses.update_status',
    'Update Business Status',
    'Update platform business status through approved admin workflows.',
    'Businesses',
    true
  ),
  ('admin.locations.read', 'Read Locations', 'View platform location records.', 'Locations', true),
  (
    'admin.locations.update',
    'Update Locations',
    'Update safe location profile fields through approved admin workflows.',
    'Locations',
    true
  ),
  (
    'admin.locations.update_status',
    'Update Location Status',
    'Update platform location status through approved admin workflows.',
    'Locations',
    true
  ),
  ('admin.reports.read', 'Read Reports', 'View platform trust and support reports.', 'Reports', true),
  ('admin.reports.create', 'Create Reports', 'Create platform trust and support reports.', 'Reports', true),
  ('admin.reports.assign', 'Assign Reports', 'Assign platform reports for handling.', 'Reports', true),
  ('admin.reports.update', 'Update Reports', 'Update report priority and workflow status.', 'Reports', true),
  ('admin.reports.resolve', 'Resolve Reports', 'Resolve platform reports.', 'Reports', true),
  ('admin.recovery.read', 'Read Recovery Cases', 'View account recovery back-office cases.', 'Recovery', true),
  (
    'admin.recovery.manage',
    'Manage Recovery Cases',
    'Update account recovery cases and secure affected accounts.',
    'Recovery',
    true
  ),
  ('admin.notes.read', 'Read Notes', 'View internal platform admin notes.', 'Notes', true),
  ('admin.notes.create', 'Create Notes', 'Create platform admin notes.', 'Notes', true),
  ('admin.audit.read', 'Read Audit Log', 'View platform admin audit logs.', 'Audit', true),
  ('admin.team.read', 'Read Admin Team', 'View platform admin team membership.', 'Admin Team', true),
  ('admin.team.manage', 'Manage Admin Team', 'Manage platform admin team membership.', 'Admin Team', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  is_system = excluded.is_system,
  updated_at = now();

insert into public.platform_admin_role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.platform_admin_roles roles
cross join public.platform_admin_permissions permissions
where roles.slug = 'platform_owner'
on conflict do nothing;

with role_permission_matrix(role_slug, permission_code) as (
  values
    ('operations_admin', 'admin.access'),
    ('operations_admin', 'admin.dashboard.read'),
    ('operations_admin', 'admin.users.read'),
    ('operations_admin', 'admin.users.read_sensitive'),
    ('operations_admin', 'admin.users.update'),
    ('operations_admin', 'admin.users.suspend'),
    ('operations_admin', 'admin.users.restore'),
    ('operations_admin', 'admin.businesses.read'),
    ('operations_admin', 'admin.businesses.update'),
    ('operations_admin', 'admin.businesses.update_status'),
    ('operations_admin', 'admin.locations.read'),
    ('operations_admin', 'admin.locations.update'),
    ('operations_admin', 'admin.locations.update_status'),
    ('operations_admin', 'admin.reports.read'),
    ('operations_admin', 'admin.reports.create'),
    ('operations_admin', 'admin.reports.assign'),
    ('operations_admin', 'admin.reports.update'),
    ('operations_admin', 'admin.reports.resolve'),
    ('operations_admin', 'admin.recovery.read'),
    ('operations_admin', 'admin.recovery.manage'),
    ('operations_admin', 'admin.notes.read'),
    ('operations_admin', 'admin.notes.create'),
    ('operations_admin', 'admin.audit.read'),
    ('operations_admin', 'admin.team.read'),
    ('support_agent', 'admin.access'),
    ('support_agent', 'admin.dashboard.read'),
    ('support_agent', 'admin.users.read'),
    ('support_agent', 'admin.users.read_sensitive'),
    ('support_agent', 'admin.businesses.read'),
    ('support_agent', 'admin.locations.read'),
    ('support_agent', 'admin.reports.read'),
    ('support_agent', 'admin.reports.create'),
    ('support_agent', 'admin.reports.update'),
    ('support_agent', 'admin.recovery.read'),
    ('support_agent', 'admin.recovery.manage'),
    ('support_agent', 'admin.notes.read'),
    ('support_agent', 'admin.notes.create'),
    ('moderator', 'admin.access'),
    ('moderator', 'admin.dashboard.read'),
    ('moderator', 'admin.users.read'),
    ('moderator', 'admin.businesses.read'),
    ('moderator', 'admin.locations.read'),
    ('moderator', 'admin.reports.read'),
    ('moderator', 'admin.reports.create'),
    ('moderator', 'admin.reports.assign'),
    ('moderator', 'admin.reports.update'),
    ('moderator', 'admin.reports.resolve'),
    ('moderator', 'admin.notes.read'),
    ('moderator', 'admin.notes.create'),
    ('auditor', 'admin.access'),
    ('auditor', 'admin.dashboard.read'),
    ('auditor', 'admin.users.read'),
    ('auditor', 'admin.businesses.read'),
    ('auditor', 'admin.locations.read'),
    ('auditor', 'admin.reports.read'),
    ('auditor', 'admin.team.read'),
    ('auditor', 'admin.audit.read')
)
insert into public.platform_admin_role_permissions (role_id, permission_id)
select roles.id, permissions.id
from role_permission_matrix
join public.platform_admin_roles roles
  on roles.slug = role_permission_matrix.role_slug
join public.platform_admin_permissions permissions
  on permissions.code = role_permission_matrix.permission_code
on conflict do nothing;

create or replace function public.platform_admin_json_contains_forbidden_key(
  payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  entry record;
  forbidden_keys text[] := array[
    'access_token',
    'refresh_token',
    'password',
    'secret',
    'service_role_key',
    'api_key'
  ];
begin
  if payload is null then
    return false;
  end if;

  if jsonb_typeof(payload) = 'object' then
    for entry in
      select key, value
      from jsonb_each(payload)
    loop
      if lower(entry.key) = any(forbidden_keys) then
        return true;
      end if;

      if public.platform_admin_json_contains_forbidden_key(entry.value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(payload) = 'array' then
    for entry in
      select value
      from jsonb_array_elements(payload)
    loop
      if public.platform_admin_json_contains_forbidden_key(entry.value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function public.validate_platform_admin_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Platform admin audit logs are append-only.';
  end if;

  if public.platform_admin_json_contains_forbidden_key(new.before_data)
    or public.platform_admin_json_contains_forbidden_key(new.after_data)
    or public.platform_admin_json_contains_forbidden_key(new.metadata)
  then
    raise exception 'Platform admin audit logs cannot store secrets.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_platform_admin_audit_log
on public.platform_admin_audit_logs;

create trigger validate_platform_admin_audit_log
before insert or update or delete on public.platform_admin_audit_logs
for each row
execute function public.validate_platform_admin_audit_log();

create or replace function public.platform_admin_has_permission(
  permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admin_memberships memberships
    join public.users users
      on users.id = memberships.user_id
    join public.platform_admin_role_permissions role_permissions
      on role_permissions.role_id = memberships.role_id
    join public.platform_admin_permissions permissions
      on permissions.id = role_permissions.permission_id
    where memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and users.status not in ('suspended', 'deleted')
      and permissions.code = btrim(permission_code)
  )
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.platform_admin_has_permission('admin.access')
$$;

create or replace function public.get_current_platform_admin_context()
returns table (
  user_id uuid,
  membership_id uuid,
  role_id uuid,
  role_slug text,
  role_name text,
  permissions text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    users.id as user_id,
    memberships.id as membership_id,
    roles.id as role_id,
    roles.slug as role_slug,
    roles.name as role_name,
    coalesce(
      array_agg(permissions.code order by permissions.code)
        filter (where permissions.code is not null),
      array[]::text[]
    ) as permissions
  from public.users users
  join public.platform_admin_memberships memberships
    on memberships.user_id = users.id
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  left join public.platform_admin_role_permissions role_permissions
    on role_permissions.role_id = roles.id
  left join public.platform_admin_permissions permissions
    on permissions.id = role_permissions.permission_id
  where users.id = public.current_public_user_id()
    and users.status not in ('suspended', 'deleted')
    and memberships.status = 'active'
  group by users.id, memberships.id, roles.id, roles.slug, roles.name
  having bool_or(permissions.code = 'admin.access')
  limit 1
$$;

create or replace function public.bootstrap_platform_owner(
  target_user_id uuid,
  bootstrap_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_membership public.platform_admin_memberships%rowtype;
  owner_role_id uuid;
  target_user public.users%rowtype;
  resulting_membership_id uuid;
begin
  bootstrap_reason := nullif(btrim(bootstrap_reason), '');

  if bootstrap_reason is null then
    raise exception 'Platform owner bootstrap reason is required.';
  end if;

  select *
  into target_user
  from public.users
  where users.id = target_user_id;

  if target_user.id is null then
    raise exception 'Target user does not exist.';
  end if;

  if target_user.status in ('suspended', 'deleted') then
    raise exception 'Target user is not eligible for platform owner bootstrap.';
  end if;

  select id
  into owner_role_id
  from public.platform_admin_roles
  where slug = 'platform_owner';

  if owner_role_id is null then
    raise exception 'Platform owner role is missing.';
  end if;

  select *
  into existing_membership
  from public.platform_admin_memberships
  where user_id = target_user_id
    and status in ('active', 'suspended')
  limit 1;

  if existing_membership.id is not null
    and existing_membership.role_id <> owner_role_id
  then
    raise exception 'Target user already has a different current platform role.';
  end if;

  if existing_membership.id is not null
    and existing_membership.status = 'suspended'
  then
    raise exception 'Target user has a suspended platform admin membership.';
  end if;

  if existing_membership.id is not null then
    resulting_membership_id := existing_membership.id;

    insert into public.platform_admin_audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      reason,
      before_data,
      after_data,
      metadata
    )
    values (
      null,
      'platform_admin.owner_bootstrap_idempotent',
      'platform_admin_membership',
      resulting_membership_id,
      bootstrap_reason,
      null,
      jsonb_build_object(
        'membership_id', resulting_membership_id,
        'user_id', target_user_id,
        'role', 'platform_owner',
        'status', existing_membership.status
      ),
      jsonb_build_object('source', 'service_role_bootstrap')
    );

    return resulting_membership_id;
  end if;

  insert into public.platform_admin_memberships (
    user_id,
    role_id,
    status,
    created_by_user_id
  )
  values (
    target_user_id,
    owner_role_id,
    'active',
    null
  )
  returning id into resulting_membership_id;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data,
    metadata
  )
  values (
    null,
    'platform_admin.owner_bootstrapped',
    'platform_admin_membership',
    resulting_membership_id,
    bootstrap_reason,
    null,
    jsonb_build_object(
      'membership_id', resulting_membership_id,
      'user_id', target_user_id,
      'role', 'platform_owner',
      'status', 'active'
    ),
    jsonb_build_object('source', 'service_role_bootstrap')
  );

  return resulting_membership_id;
end;
$$;

alter table public.platform_admin_roles enable row level security;
alter table public.platform_admin_permissions enable row level security;
alter table public.platform_admin_role_permissions enable row level security;
alter table public.platform_admin_memberships enable row level security;
alter table public.platform_admin_audit_logs enable row level security;

drop policy if exists "Platform admins can view platform admin roles"
on public.platform_admin_roles;
create policy "Platform admins can view platform admin roles"
on public.platform_admin_roles
for select
to authenticated
using (public.platform_admin_has_permission('admin.access'));

drop policy if exists "Platform admins can view platform admin permissions"
on public.platform_admin_permissions;
create policy "Platform admins can view platform admin permissions"
on public.platform_admin_permissions
for select
to authenticated
using (public.platform_admin_has_permission('admin.access'));

drop policy if exists "Platform admins can view platform admin role permissions"
on public.platform_admin_role_permissions;
create policy "Platform admins can view platform admin role permissions"
on public.platform_admin_role_permissions
for select
to authenticated
using (public.platform_admin_has_permission('admin.access'));

drop policy if exists "Platform admins can view platform admin memberships"
on public.platform_admin_memberships;
create policy "Platform admins can view platform admin memberships"
on public.platform_admin_memberships
for select
to authenticated
  using (
    (
      user_id = public.current_public_user_id()
      and status = 'active'
    )
    or public.platform_admin_has_permission('admin.team.read')
  );

drop policy if exists "Platform auditors can view platform admin audit logs"
on public.platform_admin_audit_logs;
create policy "Platform auditors can view platform admin audit logs"
on public.platform_admin_audit_logs
for select
to authenticated
using (public.platform_admin_has_permission('admin.audit.read'));

revoke all privileges on table public.platform_admin_roles from anon;
revoke all privileges on table public.platform_admin_permissions from anon;
revoke all privileges on table public.platform_admin_role_permissions from anon;
revoke all privileges on table public.platform_admin_memberships from anon;
revoke all privileges on table public.platform_admin_audit_logs from anon;

revoke insert, update, delete, truncate, references, trigger
on table public.platform_admin_roles
from authenticated;
revoke insert, update, delete, truncate, references, trigger
on table public.platform_admin_permissions
from authenticated;
revoke insert, update, delete, truncate, references, trigger
on table public.platform_admin_role_permissions
from authenticated;
revoke insert, update, delete, truncate, references, trigger
on table public.platform_admin_memberships
from authenticated;
revoke insert, update, delete, truncate, references, trigger
on table public.platform_admin_audit_logs
from authenticated;

grant select on table public.platform_admin_roles to authenticated;
grant select on table public.platform_admin_permissions to authenticated;
grant select on table public.platform_admin_role_permissions to authenticated;
grant select on table public.platform_admin_memberships to authenticated;
grant select on table public.platform_admin_audit_logs to authenticated;

grant select, insert, update, delete on table public.platform_admin_roles to service_role;
grant select, insert, update, delete on table public.platform_admin_permissions to service_role;
grant select, insert, update, delete on table public.platform_admin_role_permissions to service_role;
grant select, insert, update, delete on table public.platform_admin_memberships to service_role;
revoke update, delete, truncate, references, trigger
on table public.platform_admin_audit_logs
from service_role;
grant select, insert on table public.platform_admin_audit_logs to service_role;

revoke all on function public.platform_admin_json_contains_forbidden_key(jsonb)
from public, anon, authenticated;
revoke all on function public.validate_platform_admin_audit_log()
from public, anon, authenticated;
revoke all on function public.platform_admin_has_permission(text)
from public, anon;
revoke all on function public.is_platform_admin()
from public, anon;
revoke all on function public.get_current_platform_admin_context()
from public, anon;
revoke all on function public.bootstrap_platform_owner(uuid, text)
from public, anon, authenticated;

grant execute on function public.platform_admin_has_permission(text)
to authenticated;
grant execute on function public.is_platform_admin()
to authenticated;
grant execute on function public.get_current_platform_admin_context()
to authenticated;
grant execute on function public.bootstrap_platform_owner(uuid, text)
to service_role;

-- Compatibility layer for Admin Phase 1 on the current account/salon schema.
-- The original admin UI calls businesses "organizations". In the current app,
-- those records are public.accounts with salons in public.locations.
create or replace view public.platform_admin_businesses_compat as
select
  accounts.id,
  accounts.name,
  null::text as legal_name,
  coalesce(owner_membership.user_id, first_membership.user_id) as owner_user_id,
  accounts.status,
  accounts.created_at,
  accounts.updated_at
from public.accounts accounts
left join lateral (
  select memberships.user_id
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  join public.users users on users.id = memberships.user_id
  where memberships.account_id = accounts.id
    and memberships.status = 'active'
    and upper(roles.code) = 'OWNER'
    and users.status not in ('suspended', 'deleted')
  order by coalesce(memberships.joined_at, memberships.created_at), memberships.id
  limit 1
) owner_membership on true
left join lateral (
  select memberships.user_id
  from public.account_memberships memberships
  join public.users users on users.id = memberships.user_id
  where memberships.account_id = accounts.id
    and memberships.status = 'active'
    and users.status not in ('suspended', 'deleted')
  order by coalesce(memberships.joined_at, memberships.created_at), memberships.id
  limit 1
) first_membership on true;

create or replace function public.platform_admin_update_businesses_compat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_account public.accounts%rowtype;
begin
  update public.accounts
  set name = coalesce(nullif(btrim(new.name), ''), old.name),
      status = coalesce(nullif(btrim(new.status), ''), old.status)
  where accounts.id = old.id
  returning * into updated_account;

  new.id := updated_account.id;
  new.name := updated_account.name;
  new.legal_name := null;
  new.owner_user_id := old.owner_user_id;
  new.status := updated_account.status;
  new.created_at := updated_account.created_at;
  new.updated_at := updated_account.updated_at;

  return new;
end;
$$;

drop trigger if exists platform_admin_update_businesses_compat
on public.platform_admin_businesses_compat;
create trigger platform_admin_update_businesses_compat
instead of update on public.platform_admin_businesses_compat
for each row execute function public.platform_admin_update_businesses_compat();

create or replace view public.platform_admin_business_memberships_compat as
select
  memberships.id,
  memberships.account_id as organization_id,
  memberships.user_id,
  memberships.role_id,
  coalesce(nullif(roles.name, ''), roles.code, 'Member') as role,
  memberships.status,
  memberships.joined_at,
  memberships.created_at,
  memberships.updated_at
from public.account_memberships memberships
left join public.roles roles on roles.id = memberships.role_id;

revoke all on public.platform_admin_businesses_compat from public, anon, authenticated;
revoke all on public.platform_admin_business_memberships_compat from public, anon, authenticated;
revoke all on function public.platform_admin_update_businesses_compat()
from public, anon, authenticated;
create sequence if not exists public.platform_report_number_seq;

create table if not exists public.platform_reports (
  id uuid primary key default gen_random_uuid(),
  report_number text not null unique default (
    'RPT-' || lpad(nextval('public.platform_report_number_seq')::text, 6, '0')
  ),
  category text not null default 'general',
  priority text not null default 'normal',
  status text not null default 'new',
  summary text not null,
  description text,
  source text not null default 'manual',
  reporter_user_id uuid references public.users(id) on delete set null,
  subject_user_id uuid references public.users(id) on delete set null,
  subject_organization_id uuid references public.accounts(id) on delete set null,
  subject_location_id uuid references public.locations(id) on delete set null,
  assigned_membership_id uuid references public.platform_admin_memberships(id) on delete set null,
  resolution text,
  created_by_user_id uuid references public.users(id) on delete set null,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  closed_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  constraint platform_reports_priority_check check (
    priority in ('low', 'normal', 'high', 'urgent')
  ),
  constraint platform_reports_status_check check (
    status in ('new', 'under_review', 'action_required', 'resolved', 'closed')
  ),
  constraint platform_reports_summary_not_blank check (
    length(btrim(summary)) between 3 and 200
  ),
  constraint platform_reports_subject_single_check check (
    num_nonnulls(subject_user_id, subject_organization_id, subject_location_id) <= 1
  )
);

create index if not exists platform_reports_status_priority_created_idx
on public.platform_reports(status, priority, created_at desc);

create index if not exists platform_reports_assigned_membership_idx
on public.platform_reports(assigned_membership_id, status);

create index if not exists platform_reports_subject_user_idx
on public.platform_reports(subject_user_id, created_at desc);

create index if not exists platform_reports_subject_organization_idx
on public.platform_reports(subject_organization_id, created_at desc);

create index if not exists platform_reports_subject_location_idx
on public.platform_reports(subject_location_id, created_at desc);

drop trigger if exists update_platform_reports_updated_at
on public.platform_reports;

create trigger update_platform_reports_updated_at
before update on public.platform_reports
for each row
execute function public.set_updated_at();

create table if not exists public.platform_admin_notes (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references public.users(id) on delete set null,
  target_organization_id uuid references public.accounts(id) on delete set null,
  target_location_id uuid references public.locations(id) on delete set null,
  target_report_id uuid references public.platform_reports(id) on delete cascade,
  target_membership_id uuid references public.platform_admin_memberships(id) on delete set null,
  body text not null,
  author_user_id uuid references public.users(id) on delete set null,
  author_membership_id uuid references public.platform_admin_memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint platform_admin_notes_body_check check (
    length(btrim(body)) between 2 and 5000
  ),
  constraint platform_admin_notes_target_single_check check (
    num_nonnulls(
      target_user_id,
      target_organization_id,
      target_location_id,
      target_report_id,
      target_membership_id
    ) = 1
  )
);

create index if not exists platform_admin_notes_user_created_idx
on public.platform_admin_notes(target_user_id, created_at desc);

create index if not exists platform_admin_notes_organization_created_idx
on public.platform_admin_notes(target_organization_id, created_at desc);

create index if not exists platform_admin_notes_location_created_idx
on public.platform_admin_notes(target_location_id, created_at desc);

create index if not exists platform_admin_notes_report_created_idx
on public.platform_admin_notes(target_report_id, created_at desc);

create index if not exists platform_admin_notes_membership_created_idx
on public.platform_admin_notes(target_membership_id, created_at desc);

create or replace function public.validate_platform_admin_note()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Platform admin notes are append-only.';
  end if;

  if public.platform_admin_json_contains_forbidden_key(
    jsonb_build_object('body', new.body)
  ) then
    raise exception 'Platform admin notes cannot store secrets.';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_platform_admin_note
on public.platform_admin_notes;

create trigger validate_platform_admin_note
before insert or update or delete on public.platform_admin_notes
for each row
execute function public.validate_platform_admin_note();

create or replace function public.platform_admin_clamp_page_size(
  page_size integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select least(greatest(coalesce(page_size, 25), 1), 100)
$$;

create or replace function public.platform_admin_normalize_page(
  page_number integer
)
returns integer
language sql
immutable
set search_path = public
as $$
  select greatest(coalesce(page_number, 1), 1)
$$;

create or replace function public.platform_admin_normalize_reason(
  reason text
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  clean_reason text;
begin
  clean_reason := nullif(btrim(coalesce(reason, '')), '');

  if clean_reason is null or length(clean_reason) < 3 then
    raise exception 'A reason of at least 3 characters is required.';
  end if;

  if length(clean_reason) > 1000 then
    raise exception 'Reason must be 1000 characters or fewer.';
  end if;

  return clean_reason;
end;
$$;

create or replace function public.platform_admin_current_actor()
returns table (
  actor_user_id uuid,
  actor_membership_id uuid,
  actor_role_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  select users.id, memberships.id, roles.slug
  from public.users users
  join public.platform_admin_memberships memberships
    on memberships.user_id = users.id
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  where users.id = public.current_public_user_id()
    and users.status not in ('suspended', 'deleted')
    and memberships.status = 'active'
  limit 1
$$;

create or replace function public.platform_admin_require_permission(
  permission_code text
)
returns table (
  actor_user_id uuid,
  actor_membership_id uuid,
  actor_role_slug text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.platform_admin_has_permission(permission_code) then
    raise exception 'Platform admin permission denied.';
  end if;

  return query
  select *
  from public.platform_admin_current_actor();

  if not found then
    raise exception 'Platform admin context is not active.';
  end if;
end;
$$;

create or replace function public.platform_admin_assert_safe_audit_payload(
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.platform_admin_json_contains_forbidden_key(payload) then
    raise exception 'Platform admin audit payload cannot include secrets.';
  end if;
end;
$$;

create or replace function public.platform_admin_assert_not_last_owner(
  target_membership_id uuid,
  next_role_slug text,
  next_status text
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_role_slug text;
  current_status text;
  active_owner_count integer;
begin
  lock table public.platform_admin_memberships in share row exclusive mode;

  select roles.slug, memberships.status
  into current_role_slug, current_status
  from public.platform_admin_memberships memberships
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  where memberships.id = target_membership_id;

  if current_role_slug <> 'platform_owner' or current_status <> 'active' then
    return;
  end if;

  if next_role_slug = 'platform_owner' and next_status = 'active' then
    return;
  end if;

  select count(*)
  into active_owner_count
  from public.platform_admin_memberships memberships
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  join public.users users
    on users.id = memberships.user_id
  where memberships.id <> target_membership_id
    and memberships.status = 'active'
    and roles.slug = 'platform_owner'
    and users.status not in ('suspended', 'deleted');

  if active_owner_count = 0 then
    raise exception 'Cannot remove or suspend the last active platform owner.';
  end if;
end;
$$;

create or replace function public.platform_report_transition_allowed(
  current_status text,
  next_status text,
  actor_role_slug text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    current_status = next_status
    or (current_status = 'new' and next_status = 'under_review')
    or (current_status = 'under_review' and next_status in ('action_required', 'resolved'))
    or (current_status = 'action_required' and next_status in ('under_review', 'resolved'))
    or (current_status = 'resolved' and next_status in ('closed', 'under_review'))
    or (
      current_status = 'closed'
      and next_status = 'under_review'
      and actor_role_slug = 'platform_owner'
    )
$$;

alter table public.platform_reports enable row level security;
alter table public.platform_admin_notes enable row level security;

drop policy if exists "Platform admins can view platform reports"
on public.platform_reports;
create policy "Platform admins can view platform reports"
on public.platform_reports
for select
to authenticated
using (public.platform_admin_has_permission('admin.reports.read'));

drop policy if exists "Platform admins can view platform notes"
on public.platform_admin_notes;
create policy "Platform admins can view platform notes"
on public.platform_admin_notes
for select
to authenticated
using (public.platform_admin_has_permission('admin.notes.read'));

revoke all privileges on table public.platform_reports from anon;
revoke all privileges on table public.platform_admin_notes from anon;
revoke insert, update, delete, truncate, references, trigger
on table public.platform_reports
from authenticated;
revoke insert, update, delete, truncate, references, trigger
on table public.platform_admin_notes
from authenticated;
grant select on table public.platform_reports to authenticated;
grant select on table public.platform_admin_notes to authenticated;
grant select, insert, update on table public.platform_reports to service_role;
grant select, insert on table public.platform_admin_notes to service_role;

create or replace function public.get_platform_admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor record;
  can_read_audit boolean;
  result jsonb;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.dashboard.read');

  can_read_audit := public.platform_admin_has_permission('admin.audit.read');

  select jsonb_build_object(
    'users', jsonb_build_object(
      'total', (select count(*) from public.users),
      'active', (select count(*) from public.users where status = 'active'),
      'suspended', (select count(*) from public.users where status = 'suspended'),
      'new_30d', (
        select count(*)
        from public.users
        where created_at >= now() - interval '30 days'
      )
    ),
    'businesses', jsonb_build_object(
      'total', (select count(*) from public.platform_admin_businesses_compat),
      'by_status', coalesce((
        select jsonb_object_agg(status, count_value)
        from (
          select status, count(*) as count_value
          from public.platform_admin_businesses_compat
          group by status
        ) status_counts
      ), '{}'::jsonb)
    ),
    'locations', jsonb_build_object(
      'total', (select count(*) from public.locations),
      'by_status', coalesce((
        select jsonb_object_agg(status, count_value)
        from (
          select status, count(*) as count_value
          from public.locations
          group by status
        ) status_counts
      ), '{}'::jsonb)
    ),
    'reports', jsonb_build_object(
      'open', (
        select count(*)
        from public.platform_reports
        where status in ('new', 'under_review', 'action_required')
      ),
      'urgent_or_high', (
        select count(*)
        from public.platform_reports
        where status in ('new', 'under_review', 'action_required')
          and priority in ('urgent', 'high')
      ),
      'assigned_to_me', (
        select count(*)
        from public.platform_reports
        where assigned_membership_id = actor.actor_membership_id
          and status in ('new', 'under_review', 'action_required')
      )
    ),
    'recent_audit', case
      when can_read_audit then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', logs.id,
            'action', logs.action,
            'target_type', logs.target_type,
            'target_id', logs.target_id,
            'reason', logs.reason,
            'created_at', logs.created_at,
            'actor', jsonb_build_object(
              'id', users.id,
              'display_name', users.display_name
            )
          )
          order by logs.created_at desc
        )
        from (
          select *
          from public.platform_admin_audit_logs
          order by created_at desc
          limit 8
        ) logs
        left join public.users users
          on users.id = logs.actor_user_id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  )
  into result;

  return result;
end;
$$;

create or replace function public.search_platform_admin_users(
  p_query text default null,
  p_status text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  can_read_sensitive boolean;
  total_count integer;
  items jsonb;
begin
  perform public.platform_admin_require_permission('admin.users.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  if clean_status is not null
    and clean_status not in ('active', 'inactive', 'suspended', 'deleted')
  then
    raise exception 'Invalid user status filter.';
  end if;

  row_offset := (page_number - 1) * page_size;
  can_read_sensitive := public.platform_admin_has_permission('admin.users.read_sensitive');

  select count(*)
  into total_count
  from public.users users
  where (clean_status is null or users.status = clean_status)
    and (
      clean_query is null
      or users.id::text = clean_query
      or users.display_name ilike '%' || clean_query || '%'
      or users.first_name ilike '%' || clean_query || '%'
      or users.last_name ilike '%' || clean_query || '%'
      or (
        can_read_sensitive
        and (
          users.email ilike '%' || clean_query || '%'
          or users.phone ilike '%' || clean_query || '%'
        )
      )
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      users.created_at as sort_created_at,
      jsonb_build_object(
        'id', users.id,
        'display_name', users.display_name,
        'first_name', users.first_name,
        'last_name', users.last_name,
        'email', case when can_read_sensitive then users.email else null end,
        'phone', case when can_read_sensitive then users.phone else null end,
        'status', users.status,
        'created_at', users.created_at,
        'updated_at', users.updated_at,
        'organization_count', (
          select count(*)
          from public.platform_admin_business_memberships_compat memberships
          where memberships.user_id = users.id
            and memberships.status <> 'removed'
        )
      ) as item
    from public.users users
    where (clean_status is null or users.status = clean_status)
      and (
        clean_query is null
        or users.id::text = clean_query
        or users.display_name ilike '%' || clean_query || '%'
        or users.first_name ilike '%' || clean_query || '%'
        or users.last_name ilike '%' || clean_query || '%'
        or (
          can_read_sensitive
          and (
            users.email ilike '%' || clean_query || '%'
            or users.phone ilike '%' || clean_query || '%'
          )
        )
      )
    order by users.created_at desc, users.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size,
    'can_read_sensitive', can_read_sensitive
  );
end;
$$;

create or replace function public.get_platform_admin_user_detail(
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  can_read_sensitive boolean;
  user_row public.users%rowtype;
  result jsonb;
begin
  perform public.platform_admin_require_permission('admin.users.read');
  can_read_sensitive := public.platform_admin_has_permission('admin.users.read_sensitive');

  select *
  into user_row
  from public.users
  where id = p_user_id;

  if user_row.id is null then
    raise exception 'User not found.';
  end if;

  result := jsonb_build_object(
    'user', jsonb_build_object(
      'id', user_row.id,
      'auth_user_id', user_row.auth_user_id,
      'display_name', user_row.display_name,
      'first_name', user_row.first_name,
      'last_name', user_row.last_name,
      'avatar_url', user_row.avatar_url,
      'email', case when can_read_sensitive then user_row.email else null end,
      'phone', case when can_read_sensitive then user_row.phone else null end,
      'status', user_row.status,
      'language', user_row.language,
      'timezone', user_row.timezone,
      'last_login_at', user_row.last_login_at,
      'created_at', user_row.created_at,
      'updated_at', user_row.updated_at
    ),
    'organization_memberships', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'organization_id', organizations.id,
          'organization_name', organizations.name,
          'role', memberships.role,
          'status', memberships.status,
          'joined_at', memberships.joined_at,
          'created_at', memberships.created_at
        )
        order by memberships.created_at desc
      )
      from public.platform_admin_business_memberships_compat memberships
      join public.platform_admin_businesses_compat organizations
        on organizations.id = memberships.organization_id
      where memberships.user_id = user_row.id
    ), '[]'::jsonb),
    'platform_membership', (
      select jsonb_build_object(
        'id', memberships.id,
        'status', memberships.status,
        'role_slug', roles.slug,
        'role_name', roles.name,
        'created_at', memberships.created_at,
        'updated_at', memberships.updated_at
      )
      from public.platform_admin_memberships memberships
      join public.platform_admin_roles roles
        on roles.id = memberships.role_id
      where memberships.user_id = user_row.id
        and memberships.status in ('active', 'suspended')
      limit 1
    ),
    'related_reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reports.id,
          'report_number', reports.report_number,
          'summary', reports.summary,
          'priority', reports.priority,
          'status', reports.status,
          'created_at', reports.created_at
        )
        order by reports.created_at desc
      )
      from public.platform_reports reports
      where reports.subject_user_id = user_row.id
      limit 20
    ), '[]'::jsonb)
  );

  return result;
end;
$$;

create or replace function public.update_platform_admin_user_profile(
  p_user_id uuid,
  p_display_name text,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.users%rowtype;
  after_row public.users%rowtype;
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.users.update');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into before_row
  from public.users
  where id = p_user_id
  for update;

  if before_row.id is null then
    raise exception 'User not found.';
  end if;

  update public.users
  set
    display_name = nullif(btrim(coalesce(p_display_name, '')), ''),
    first_name = nullif(btrim(coalesce(p_first_name, '')), ''),
    last_name = nullif(btrim(coalesce(p_last_name, '')), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), '')
  where id = p_user_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.user_profile_updated',
    'platform_admin_user',
    p_user_id,
    clean_reason,
    to_jsonb(before_row) - 'auth_user_id',
    to_jsonb(after_row) - 'auth_user_id'
  );

  return jsonb_build_object('user_id', after_row.id, 'status', after_row.status);
end;
$$;

create or replace function public.suspend_platform_user(
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.users%rowtype;
  after_row public.users%rowtype;
  clean_reason text;
  target_owner_membership_id uuid;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.users.suspend');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into before_row
  from public.users
  where id = p_user_id
  for update;

  if before_row.id is null then
    raise exception 'User not found.';
  end if;

  if before_row.status = 'deleted' then
    raise exception 'Deleted users cannot be suspended.';
  end if;

  select memberships.id
  into target_owner_membership_id
  from public.platform_admin_memberships memberships
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  where memberships.user_id = p_user_id
    and memberships.status = 'active'
    and roles.slug = 'platform_owner'
  limit 1;

  if target_owner_membership_id is not null then
    perform public.platform_admin_assert_not_last_owner(
      target_owner_membership_id,
      'platform_owner',
      'suspended'
    );
  end if;

  update public.users
  set status = 'suspended'
  where id = p_user_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.user_suspended',
    'platform_admin_user',
    p_user_id,
    clean_reason,
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', after_row.status)
  );

  return jsonb_build_object('user_id', after_row.id, 'status', after_row.status);
end;
$$;

create or replace function public.restore_platform_user(
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.users%rowtype;
  after_row public.users%rowtype;
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.users.restore');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into before_row
  from public.users
  where id = p_user_id
  for update;

  if before_row.id is null then
    raise exception 'User not found.';
  end if;

  if before_row.status = 'deleted' then
    raise exception 'Deleted users cannot be restored by this workflow.';
  end if;

  update public.users
  set status = 'active'
  where id = p_user_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.user_restored',
    'platform_admin_user',
    p_user_id,
    clean_reason,
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', after_row.status)
  );

  return jsonb_build_object('user_id', after_row.id, 'status', after_row.status);
end;
$$;

create or replace function public.list_organization_members_directory(
  p_organization_id uuid,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid := public.current_public_user_id();
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.platform_admin_business_memberships_compat memberships
    where memberships.organization_id = p_organization_id
      and memberships.user_id = current_user_id
      and memberships.status = 'active'
  ) then
    raise exception 'Organization access denied.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.platform_admin_business_memberships_compat memberships
  where memberships.organization_id = p_organization_id
    and memberships.status <> 'removed';

  select coalesce(jsonb_agg(item order by sort_created_at asc), '[]'::jsonb)
  into items
  from (
    select
      memberships.created_at as sort_created_at,
      jsonb_build_object(
        'id', memberships.id,
        'organization_id', memberships.organization_id,
        'user_id', users.id,
        'role_id', memberships.role_id,
        'legacy_role', memberships.role,
        'status', memberships.status,
        'invited_by_user_id', memberships.invited_by_user_id,
        'joined_at', memberships.joined_at,
        'created_at', memberships.created_at,
        'updated_at', memberships.updated_at,
        'user', jsonb_build_object(
          'id', users.id,
          'display_name', users.display_name,
          'avatar_url', users.avatar_url,
          'status', users.status
        )
      ) as item
    from public.platform_admin_business_memberships_compat memberships
    join public.users users
      on users.id = memberships.user_id
    where memberships.organization_id = p_organization_id
      and memberships.status <> 'removed'
    order by memberships.created_at asc, memberships.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;

create or replace function public.search_platform_admin_businesses(
  p_query text default null,
  p_status text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  can_read_sensitive boolean;
  total_count integer;
  items jsonb;
begin
  perform public.platform_admin_require_permission('admin.businesses.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  if clean_status is not null
    and clean_status not in ('active', 'inactive', 'suspended', 'archived')
  then
    raise exception 'Invalid business status filter.';
  end if;

  row_offset := (page_number - 1) * page_size;
  can_read_sensitive := public.platform_admin_has_permission('admin.users.read_sensitive');

  select count(*)
  into total_count
  from public.platform_admin_businesses_compat organizations
  left join public.users owners
    on owners.id = organizations.owner_user_id
  where (clean_status is null or organizations.status = clean_status)
    and (
      clean_query is null
      or organizations.id::text = clean_query
      or organizations.name ilike '%' || clean_query || '%'
      or organizations.legal_name ilike '%' || clean_query || '%'
      or owners.display_name ilike '%' || clean_query || '%'
      or (can_read_sensitive and owners.email ilike '%' || clean_query || '%')
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      organizations.created_at as sort_created_at,
      jsonb_build_object(
        'id', organizations.id,
        'name', organizations.name,
        'legal_name', organizations.legal_name,
        'owner_user_id', organizations.owner_user_id,
        'status', organizations.status,
        'created_at', organizations.created_at,
        'updated_at', organizations.updated_at,
        'owner', jsonb_build_object(
          'id', owners.id,
          'display_name', owners.display_name,
          'email', case when can_read_sensitive then owners.email else null end,
          'status', owners.status
        ),
        'location_count', (
          select count(*)
          from public.locations locations
          where locations.account_id = organizations.id
        ),
        'member_count', (
          select count(*)
          from public.platform_admin_business_memberships_compat memberships
          where memberships.organization_id = organizations.id
            and memberships.status <> 'removed'
        )
      ) as item
    from public.platform_admin_businesses_compat organizations
    left join public.users owners
      on owners.id = organizations.owner_user_id
    where (clean_status is null or organizations.status = clean_status)
      and (
        clean_query is null
        or organizations.id::text = clean_query
        or organizations.name ilike '%' || clean_query || '%'
        or organizations.legal_name ilike '%' || clean_query || '%'
        or owners.display_name ilike '%' || clean_query || '%'
        or (can_read_sensitive and owners.email ilike '%' || clean_query || '%')
      )
    order by organizations.created_at desc, organizations.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size,
    'can_read_sensitive', can_read_sensitive
  );
end;
$$;

create or replace function public.get_platform_admin_business_detail(
  p_business_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  business_row public.platform_admin_businesses_compat%rowtype;
  can_read_sensitive boolean;
begin
  perform public.platform_admin_require_permission('admin.businesses.read');
  can_read_sensitive := public.platform_admin_has_permission('admin.users.read_sensitive');

  select *
  into business_row
  from public.platform_admin_businesses_compat
  where id = p_business_id;

  if business_row.id is null then
    raise exception 'Business not found.';
  end if;

  return jsonb_build_object(
    'business', jsonb_build_object(
      'id', business_row.id,
      'name', business_row.name,
      'legal_name', business_row.legal_name,
      'owner_user_id', business_row.owner_user_id,
      'status', business_row.status,
      'created_at', business_row.created_at,
      'updated_at', business_row.updated_at
    ),
    'owner', (
      select jsonb_build_object(
        'id', users.id,
        'display_name', users.display_name,
        'email', case when can_read_sensitive then users.email else null end,
        'phone', case when can_read_sensitive then users.phone else null end,
        'status', users.status
      )
      from public.users users
      where users.id = business_row.owner_user_id
    ),
    'locations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', locations.id,
          'name', locations.name,
          'city', locations.city,
          'state', locations.state,
          'status', locations.status,
          'created_at', locations.created_at,
          'updated_at', locations.updated_at
        )
        order by locations.created_at desc
      )
      from public.locations locations
      where locations.account_id = business_row.id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', memberships.id,
          'user_id', users.id,
          'display_name', users.display_name,
          'role', memberships.role,
          'status', memberships.status,
          'joined_at', memberships.joined_at,
          'created_at', memberships.created_at
        )
        order by memberships.created_at desc
      )
      from public.platform_admin_business_memberships_compat memberships
      join public.users users
        on users.id = memberships.user_id
      where memberships.organization_id = business_row.id
        and memberships.status <> 'removed'
      limit 50
    ), '[]'::jsonb),
    'related_reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reports.id,
          'report_number', reports.report_number,
          'summary', reports.summary,
          'priority', reports.priority,
          'status', reports.status,
          'created_at', reports.created_at
        )
        order by reports.created_at desc
      )
      from public.platform_reports reports
      where reports.subject_organization_id = business_row.id
      limit 20
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_platform_admin_business_profile(
  p_business_id uuid,
  p_name text,
  p_legal_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_admin_businesses_compat%rowtype;
  after_row public.platform_admin_businesses_compat%rowtype;
  clean_name text := nullif(btrim(coalesce(p_name, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.businesses.update');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if clean_name is null or length(clean_name) > 150 then
    raise exception 'Business name must be between 1 and 150 characters.';
  end if;

  select *
  into before_row
  from public.platform_admin_businesses_compat
  where id = p_business_id
  for update;

  if before_row.id is null then
    raise exception 'Business not found.';
  end if;

  update public.platform_admin_businesses_compat
  set
    name = clean_name,
    legal_name = nullif(btrim(coalesce(p_legal_name, '')), '')
  where id = p_business_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.business_profile_updated',
    'platform_admin_business',
    p_business_id,
    clean_reason,
    jsonb_build_object('name', before_row.name, 'legal_name', before_row.legal_name),
    jsonb_build_object('name', after_row.name, 'legal_name', after_row.legal_name)
  );

  return jsonb_build_object(
    'business_id', after_row.id,
    'status', after_row.status
  );
end;
$$;

create or replace function public.update_platform_admin_business_status(
  p_business_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_admin_businesses_compat%rowtype;
  after_row public.platform_admin_businesses_compat%rowtype;
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.businesses.update_status');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if clean_status not in ('active', 'inactive', 'suspended', 'archived') then
    raise exception 'Invalid business status.';
  end if;

  select *
  into before_row
  from public.platform_admin_businesses_compat
  where id = p_business_id
  for update;

  if before_row.id is null then
    raise exception 'Business not found.';
  end if;

  update public.platform_admin_businesses_compat
  set status = clean_status
  where id = p_business_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.business_status_updated',
    'platform_admin_business',
    p_business_id,
    clean_reason,
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', after_row.status)
  );

  return jsonb_build_object(
    'business_id', after_row.id,
    'status', after_row.status
  );
end;
$$;

create or replace function public.search_platform_admin_locations(
  p_query text default null,
  p_status text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  perform public.platform_admin_require_permission('admin.locations.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  if clean_status is not null and clean_status not in ('active', 'inactive') then
    raise exception 'Invalid location status filter.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.locations locations
  join public.platform_admin_businesses_compat organizations
    on organizations.id = locations.account_id
  where (clean_status is null or locations.status = clean_status)
    and (
      clean_query is null
      or locations.id::text = clean_query
      or locations.name ilike '%' || clean_query || '%'
      or locations.phone ilike '%' || clean_query || '%'
      or locations.address_line1 ilike '%' || clean_query || '%'
      or locations.city ilike '%' || clean_query || '%'
      or locations.state ilike '%' || clean_query || '%'
      or locations.postal_code ilike '%' || clean_query || '%'
      or organizations.name ilike '%' || clean_query || '%'
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      locations.created_at as sort_created_at,
      jsonb_build_object(
        'id', locations.id,
        'organization_id', locations.account_id,
        'organization_name', organizations.name,
        'name', locations.name,
        'phone', locations.phone,
        'address_line1', locations.address_line1,
        'address_line2', locations.address_line2,
        'city', locations.city,
        'state', locations.state,
        'postal_code', locations.postal_code,
        'country', locations.country,
        'latitude', locations.latitude,
        'longitude', locations.longitude,
        'status', locations.status,
        'created_at', locations.created_at,
        'updated_at', locations.updated_at
      ) as item
    from public.locations locations
    join public.platform_admin_businesses_compat organizations
      on organizations.id = locations.account_id
    where (clean_status is null or locations.status = clean_status)
      and (
        clean_query is null
        or locations.id::text = clean_query
        or locations.name ilike '%' || clean_query || '%'
        or locations.phone ilike '%' || clean_query || '%'
        or locations.address_line1 ilike '%' || clean_query || '%'
        or locations.city ilike '%' || clean_query || '%'
        or locations.state ilike '%' || clean_query || '%'
        or locations.postal_code ilike '%' || clean_query || '%'
        or organizations.name ilike '%' || clean_query || '%'
      )
    order by locations.created_at desc, locations.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;

create or replace function public.get_platform_admin_location_detail(
  p_location_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  location_row public.locations%rowtype;
begin
  perform public.platform_admin_require_permission('admin.locations.read');

  select *
  into location_row
  from public.locations
  where id = p_location_id;

  if location_row.id is null then
    raise exception 'Location not found.';
  end if;

  return jsonb_build_object(
    'location', jsonb_build_object(
      'id', location_row.id,
      'organization_id', location_row.account_id,
      'name', location_row.name,
      'phone', location_row.phone,
      'address_line1', location_row.address_line1,
      'address_line2', location_row.address_line2,
      'city', location_row.city,
      'state', location_row.state,
      'postal_code', location_row.postal_code,
      'country', location_row.country,
      'latitude', location_row.latitude,
      'longitude', location_row.longitude,
      'geocoding_status', location_row.geocoding_status,
      'status', location_row.status,
      'created_at', location_row.created_at,
      'updated_at', location_row.updated_at
    ),
    'business', (
      select jsonb_build_object(
        'id', organizations.id,
        'name', organizations.name,
        'legal_name', organizations.legal_name,
        'status', organizations.status
      )
      from public.platform_admin_businesses_compat organizations
      where organizations.id = location_row.account_id
    ),
    'related_reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', reports.id,
          'report_number', reports.report_number,
          'summary', reports.summary,
          'priority', reports.priority,
          'status', reports.status,
          'created_at', reports.created_at
        )
        order by reports.created_at desc
      )
      from public.platform_reports reports
      where reports.subject_location_id = location_row.id
      limit 20
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.update_platform_admin_location_profile(
  p_location_id uuid,
  p_name text,
  p_phone text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_postal_code text,
  p_country text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.locations%rowtype;
  after_row public.locations%rowtype;
  clean_name text := nullif(btrim(coalesce(p_name, '')), '');
  clean_country text := upper(nullif(btrim(coalesce(p_country, '')), ''));
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.locations.update');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if clean_name is null or length(clean_name) > 150 then
    raise exception 'Location name must be between 1 and 150 characters.';
  end if;

  if clean_country is null or length(clean_country) <> 2 then
    raise exception 'Country must be a 2-letter code.';
  end if;

  select *
  into before_row
  from public.locations
  where id = p_location_id
  for update;

  if before_row.id is null then
    raise exception 'Location not found.';
  end if;

  update public.locations
  set
    name = clean_name,
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    address_line1 = nullif(btrim(coalesce(p_address_line1, '')), ''),
    address_line2 = nullif(btrim(coalesce(p_address_line2, '')), ''),
    city = nullif(btrim(coalesce(p_city, '')), ''),
    state = nullif(btrim(coalesce(p_state, '')), ''),
    postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
    country = clean_country
  where id = p_location_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.location_profile_updated',
    'platform_admin_location',
    p_location_id,
    clean_reason,
    jsonb_build_object(
      'name', before_row.name,
      'phone', before_row.phone,
      'address_line1', before_row.address_line1,
      'address_line2', before_row.address_line2,
      'city', before_row.city,
      'state', before_row.state,
      'postal_code', before_row.postal_code,
      'country', before_row.country
    ),
    jsonb_build_object(
      'name', after_row.name,
      'phone', after_row.phone,
      'address_line1', after_row.address_line1,
      'address_line2', after_row.address_line2,
      'city', after_row.city,
      'state', after_row.state,
      'postal_code', after_row.postal_code,
      'country', after_row.country
    )
  );

  return jsonb_build_object(
    'location_id', after_row.id,
    'status', after_row.status
  );
end;
$$;

create or replace function public.update_platform_admin_location_status(
  p_location_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.locations%rowtype;
  after_row public.locations%rowtype;
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.locations.update_status');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if clean_status not in ('active', 'inactive') then
    raise exception 'Invalid location status.';
  end if;

  select *
  into before_row
  from public.locations
  where id = p_location_id
  for update;

  if before_row.id is null then
    raise exception 'Location not found.';
  end if;

  update public.locations
  set status = clean_status
  where id = p_location_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.location_status_updated',
    'platform_admin_location',
    p_location_id,
    clean_reason,
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', after_row.status)
  );

  return jsonb_build_object(
    'location_id', after_row.id,
    'status', after_row.status
  );
end;
$$;

create or replace function public.search_platform_admin_reports(
  p_query text default null,
  p_status text default null,
  p_priority text default null,
  p_assigned text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor record;
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_priority text := nullif(btrim(coalesce(p_priority, '')), '');
  clean_assigned text := nullif(btrim(coalesce(p_assigned, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  if clean_status is not null
    and clean_status not in ('new', 'under_review', 'action_required', 'resolved', 'closed')
  then
    raise exception 'Invalid report status filter.';
  end if;

  if clean_priority is not null
    and clean_priority not in ('low', 'normal', 'high', 'urgent')
  then
    raise exception 'Invalid report priority filter.';
  end if;

  if clean_assigned is not null and clean_assigned not in ('me', 'unassigned') then
    raise exception 'Invalid assignment filter.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.platform_reports reports
  left join public.users subject_users
    on subject_users.id = reports.subject_user_id
  left join public.platform_admin_businesses_compat subject_organizations
    on subject_organizations.id = reports.subject_organization_id
  left join public.locations subject_locations
    on subject_locations.id = reports.subject_location_id
  where (clean_status is null or reports.status = clean_status)
    and (clean_priority is null or reports.priority = clean_priority)
    and (
      clean_assigned is null
      or (clean_assigned = 'me' and reports.assigned_membership_id = actor.actor_membership_id)
      or (clean_assigned = 'unassigned' and reports.assigned_membership_id is null)
    )
    and (
      clean_query is null
      or reports.id::text = clean_query
      or reports.report_number ilike '%' || clean_query || '%'
      or reports.summary ilike '%' || clean_query || '%'
      or reports.category ilike '%' || clean_query || '%'
      or subject_users.display_name ilike '%' || clean_query || '%'
      or subject_organizations.name ilike '%' || clean_query || '%'
      or subject_locations.name ilike '%' || clean_query || '%'
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      reports.created_at as sort_created_at,
      jsonb_build_object(
        'id', reports.id,
        'report_number', reports.report_number,
        'category', reports.category,
        'priority', reports.priority,
        'status', reports.status,
        'summary', reports.summary,
        'source', reports.source,
        'created_at', reports.created_at,
        'updated_at', reports.updated_at,
        'resolved_at', reports.resolved_at,
        'closed_at', reports.closed_at,
        'subject', case
          when reports.subject_user_id is not null then jsonb_build_object(
            'type', 'user',
            'id', subject_users.id,
            'label', coalesce(subject_users.display_name, 'Unnamed user')
          )
          when reports.subject_organization_id is not null then jsonb_build_object(
            'type', 'business',
            'id', subject_organizations.id,
            'label', subject_organizations.name
          )
          when reports.subject_location_id is not null then jsonb_build_object(
            'type', 'location',
            'id', subject_locations.id,
            'label', subject_locations.name
          )
          else null
        end,
        'assignee', case
          when assigned_memberships.id is null then null
          else jsonb_build_object(
            'membership_id', assigned_memberships.id,
            'user_id', assigned_users.id,
            'display_name', assigned_users.display_name,
            'role_slug', assigned_roles.slug,
            'status', assigned_memberships.status
          )
        end
      ) as item
    from public.platform_reports reports
    left join public.users subject_users
      on subject_users.id = reports.subject_user_id
    left join public.platform_admin_businesses_compat subject_organizations
      on subject_organizations.id = reports.subject_organization_id
    left join public.locations subject_locations
      on subject_locations.id = reports.subject_location_id
    left join public.platform_admin_memberships assigned_memberships
      on assigned_memberships.id = reports.assigned_membership_id
    left join public.users assigned_users
      on assigned_users.id = assigned_memberships.user_id
    left join public.platform_admin_roles assigned_roles
      on assigned_roles.id = assigned_memberships.role_id
    where (clean_status is null or reports.status = clean_status)
      and (clean_priority is null or reports.priority = clean_priority)
      and (
        clean_assigned is null
        or (clean_assigned = 'me' and reports.assigned_membership_id = actor.actor_membership_id)
        or (clean_assigned = 'unassigned' and reports.assigned_membership_id is null)
      )
      and (
        clean_query is null
        or reports.id::text = clean_query
        or reports.report_number ilike '%' || clean_query || '%'
        or reports.summary ilike '%' || clean_query || '%'
        or reports.category ilike '%' || clean_query || '%'
        or subject_users.display_name ilike '%' || clean_query || '%'
        or subject_organizations.name ilike '%' || clean_query || '%'
        or subject_locations.name ilike '%' || clean_query || '%'
      )
    order by reports.created_at desc, reports.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;

create or replace function public.get_platform_admin_report_detail(
  p_report_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  report_row public.platform_reports%rowtype;
  can_read_notes boolean;
  can_read_audit boolean;
begin
  perform public.platform_admin_require_permission('admin.reports.read');
  can_read_notes := public.platform_admin_has_permission('admin.notes.read');
  can_read_audit := public.platform_admin_has_permission('admin.audit.read');

  select *
  into report_row
  from public.platform_reports
  where id = p_report_id;

  if report_row.id is null then
    raise exception 'Report not found.';
  end if;

  return jsonb_build_object(
    'report', jsonb_build_object(
      'id', report_row.id,
      'report_number', report_row.report_number,
      'category', report_row.category,
      'priority', report_row.priority,
      'status', report_row.status,
      'summary', report_row.summary,
      'description', report_row.description,
      'source', report_row.source,
      'reporter_user_id', report_row.reporter_user_id,
      'subject_user_id', report_row.subject_user_id,
      'subject_organization_id', report_row.subject_organization_id,
      'subject_location_id', report_row.subject_location_id,
      'assigned_membership_id', report_row.assigned_membership_id,
      'resolution', report_row.resolution,
      'created_by_user_id', report_row.created_by_user_id,
      'resolved_by_user_id', report_row.resolved_by_user_id,
      'closed_by_user_id', report_row.closed_by_user_id,
      'created_at', report_row.created_at,
      'updated_at', report_row.updated_at,
      'resolved_at', report_row.resolved_at,
      'closed_at', report_row.closed_at
    ),
    'reporter', (
      select jsonb_build_object(
        'id', users.id,
        'display_name', users.display_name,
        'status', users.status
      )
      from public.users users
      where users.id = report_row.reporter_user_id
    ),
    'subject', case
      when report_row.subject_user_id is not null then (
        select jsonb_build_object(
          'type', 'user',
          'id', users.id,
          'label', coalesce(users.display_name, 'Unnamed user'),
          'status', users.status
        )
        from public.users users
        where users.id = report_row.subject_user_id
      )
      when report_row.subject_organization_id is not null then (
        select jsonb_build_object(
          'type', 'business',
          'id', organizations.id,
          'label', organizations.name,
          'status', organizations.status
        )
        from public.platform_admin_businesses_compat organizations
        where organizations.id = report_row.subject_organization_id
      )
      when report_row.subject_location_id is not null then (
        select jsonb_build_object(
          'type', 'location',
          'id', locations.id,
          'label', locations.name,
          'status', locations.status,
          'organization_id', locations.account_id
        )
        from public.locations locations
        where locations.id = report_row.subject_location_id
      )
      else null
    end,
    'assignee', (
      select jsonb_build_object(
        'membership_id', memberships.id,
        'status', memberships.status,
        'user_id', users.id,
        'display_name', users.display_name,
        'role_slug', roles.slug,
        'role_name', roles.name
      )
      from public.platform_admin_memberships memberships
      join public.users users
        on users.id = memberships.user_id
      join public.platform_admin_roles roles
        on roles.id = memberships.role_id
      where memberships.id = report_row.assigned_membership_id
    ),
    'notes', case
      when can_read_notes then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', notes.id,
            'body', notes.body,
            'created_at', notes.created_at,
            'author', jsonb_build_object(
              'id', users.id,
              'display_name', users.display_name
            )
          )
          order by notes.created_at desc
        )
        from public.platform_admin_notes notes
        left join public.users users
          on users.id = notes.author_user_id
        where notes.target_report_id = report_row.id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    'timeline', case
      when can_read_audit then coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', logs.id,
            'action', logs.action,
            'reason', logs.reason,
            'before_data', logs.before_data,
            'after_data', logs.after_data,
            'created_at', logs.created_at,
            'actor', jsonb_build_object(
              'id', users.id,
              'display_name', users.display_name
            )
          )
          order by logs.created_at desc
        )
        from public.platform_admin_audit_logs logs
        left join public.users users
          on users.id = logs.actor_user_id
        where logs.target_type = 'platform_admin_report'
          and logs.target_id = report_row.id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  );
end;
$$;

create or replace function public.create_platform_admin_report(
  p_category text,
  p_priority text,
  p_summary text,
  p_description text default null,
  p_source text default 'manual',
  p_reporter_user_id uuid default null,
  p_subject_user_id uuid default null,
  p_subject_organization_id uuid default null,
  p_subject_location_id uuid default null,
  p_assigned_membership_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  inserted_row public.platform_reports%rowtype;
  clean_category text := nullif(btrim(coalesce(p_category, '')), '');
  clean_priority text := nullif(btrim(coalesce(p_priority, 'normal')), '');
  clean_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  clean_source text := nullif(btrim(coalesce(p_source, 'manual')), '');
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.create');

  if p_assigned_membership_id is not null
    and not public.platform_admin_has_permission('admin.reports.assign')
  then
    raise exception 'Report assignment permission denied.';
  end if;

  if clean_category is null or length(clean_category) > 80 then
    raise exception 'Report category must be between 1 and 80 characters.';
  end if;

  if clean_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid report priority.';
  end if;

  if clean_summary is null or length(clean_summary) > 200 then
    raise exception 'Report summary must be between 3 and 200 characters.';
  end if;

  if length(clean_summary) < 3 then
    raise exception 'Report summary must be at least 3 characters.';
  end if;

  if clean_source is null or length(clean_source) > 80 then
    raise exception 'Report source must be between 1 and 80 characters.';
  end if;

  if p_description is not null and length(btrim(p_description)) > 5000 then
    raise exception 'Report description must be 5000 characters or fewer.';
  end if;

  if num_nonnulls(p_subject_user_id, p_subject_organization_id, p_subject_location_id) > 1 then
    raise exception 'Reports can have only one primary subject.';
  end if;

  if p_assigned_membership_id is not null and not exists (
    select 1
    from public.platform_admin_memberships memberships
    where memberships.id = p_assigned_membership_id
      and memberships.status = 'active'
  ) then
    raise exception 'Assigned platform admin membership is not active.';
  end if;

  insert into public.platform_reports (
    category,
    priority,
    summary,
    description,
    source,
    reporter_user_id,
    subject_user_id,
    subject_organization_id,
    subject_location_id,
    assigned_membership_id,
    created_by_user_id
  )
  values (
    clean_category,
    clean_priority,
    clean_summary,
    nullif(btrim(coalesce(p_description, '')), ''),
    clean_source,
    p_reporter_user_id,
    p_subject_user_id,
    p_subject_organization_id,
    p_subject_location_id,
    p_assigned_membership_id,
    actor.actor_user_id
  )
  returning * into inserted_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.report_created',
    'platform_admin_report',
    inserted_row.id,
    clean_reason,
    null,
    jsonb_build_object(
      'report_number', inserted_row.report_number,
      'category', inserted_row.category,
      'priority', inserted_row.priority,
      'status', inserted_row.status,
      'assigned_membership_id', inserted_row.assigned_membership_id
    )
  );

  return jsonb_build_object(
    'report_id', inserted_row.id,
    'report_number', inserted_row.report_number,
    'status', inserted_row.status
  );
end;
$$;

create or replace function public.assign_platform_admin_report(
  p_report_id uuid,
  p_assigned_membership_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_reports%rowtype;
  after_row public.platform_reports%rowtype;
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.assign');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if p_assigned_membership_id is not null and not exists (
    select 1
    from public.platform_admin_memberships memberships
    where memberships.id = p_assigned_membership_id
      and memberships.status = 'active'
  ) then
    raise exception 'Assigned platform admin membership is not active.';
  end if;

  select *
  into before_row
  from public.platform_reports
  where id = p_report_id
  for update;

  if before_row.id is null then
    raise exception 'Report not found.';
  end if;

  update public.platform_reports
  set assigned_membership_id = p_assigned_membership_id
  where id = p_report_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.report_assigned',
    'platform_admin_report',
    p_report_id,
    clean_reason,
    jsonb_build_object('assigned_membership_id', before_row.assigned_membership_id),
    jsonb_build_object('assigned_membership_id', after_row.assigned_membership_id)
  );

  return jsonb_build_object(
    'report_id', after_row.id,
    'assigned_membership_id', after_row.assigned_membership_id
  );
end;
$$;

create or replace function public.update_platform_admin_report(
  p_report_id uuid,
  p_priority text,
  p_status text,
  p_summary text,
  p_description text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_reports%rowtype;
  after_row public.platform_reports%rowtype;
  clean_priority text := nullif(btrim(coalesce(p_priority, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.update');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into before_row
  from public.platform_reports
  where id = p_report_id
  for update;

  if before_row.id is null then
    raise exception 'Report not found.';
  end if;

  if clean_priority is null then
    clean_priority := before_row.priority;
  end if;

  if clean_status is null then
    clean_status := before_row.status;
  end if;

  if clean_summary is null then
    clean_summary := before_row.summary;
  end if;

  if clean_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Invalid report priority.';
  end if;

  if clean_status not in ('new', 'under_review', 'action_required', 'resolved', 'closed') then
    raise exception 'Invalid report status.';
  end if;

  if clean_status in ('resolved', 'closed')
    and not public.platform_admin_has_permission('admin.reports.resolve')
  then
    raise exception 'Report resolve permission denied.';
  end if;

  if not public.platform_report_transition_allowed(
    before_row.status,
    clean_status,
    actor.actor_role_slug
  ) then
    raise exception 'Invalid report status transition.';
  end if;

  if length(clean_summary) < 3 or length(clean_summary) > 200 then
    raise exception 'Report summary must be between 3 and 200 characters.';
  end if;

  if p_description is not null and length(btrim(p_description)) > 5000 then
    raise exception 'Report description must be 5000 characters or fewer.';
  end if;

  update public.platform_reports
  set
    priority = clean_priority,
    status = clean_status,
    summary = clean_summary,
    description = nullif(btrim(coalesce(p_description, '')), ''),
    resolved_by_user_id = case
      when clean_status = 'resolved' and before_row.status <> 'resolved' then actor.actor_user_id
      else resolved_by_user_id
    end,
    resolved_at = case
      when clean_status = 'resolved' and before_row.status <> 'resolved' then now()
      when clean_status <> 'resolved' then null
      else resolved_at
    end,
    closed_by_user_id = case
      when clean_status = 'closed' and before_row.status <> 'closed' then actor.actor_user_id
      else closed_by_user_id
    end,
    closed_at = case
      when clean_status = 'closed' and before_row.status <> 'closed' then now()
      when clean_status <> 'closed' then null
      else closed_at
    end
  where id = p_report_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.report_updated',
    'platform_admin_report',
    p_report_id,
    clean_reason,
    jsonb_build_object(
      'priority', before_row.priority,
      'status', before_row.status,
      'summary', before_row.summary,
      'description', before_row.description
    ),
    jsonb_build_object(
      'priority', after_row.priority,
      'status', after_row.status,
      'summary', after_row.summary,
      'description', after_row.description
    )
  );

  return jsonb_build_object(
    'report_id', after_row.id,
    'status', after_row.status,
    'priority', after_row.priority
  );
end;
$$;

create or replace function public.resolve_platform_admin_report(
  p_report_id uuid,
  p_resolution text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_reports%rowtype;
  after_row public.platform_reports%rowtype;
  clean_resolution text := nullif(btrim(coalesce(p_resolution, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.resolve');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if clean_resolution is null or length(clean_resolution) > 5000 then
    raise exception 'Resolution must be between 1 and 5000 characters.';
  end if;

  select *
  into before_row
  from public.platform_reports
  where id = p_report_id
  for update;

  if before_row.id is null then
    raise exception 'Report not found.';
  end if;

  if not public.platform_report_transition_allowed(
    before_row.status,
    'resolved',
    actor.actor_role_slug
  ) then
    raise exception 'Invalid report status transition.';
  end if;

  update public.platform_reports
  set
    status = 'resolved',
    resolution = clean_resolution,
    resolved_by_user_id = actor.actor_user_id,
    resolved_at = now()
  where id = p_report_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.report_resolved',
    'platform_admin_report',
    p_report_id,
    clean_reason,
    jsonb_build_object(
      'status', before_row.status,
      'resolution', before_row.resolution
    ),
    jsonb_build_object(
      'status', after_row.status,
      'resolution', after_row.resolution
    )
  );

  return jsonb_build_object('report_id', after_row.id, 'status', after_row.status);
end;
$$;

create or replace function public.close_platform_admin_report(
  p_report_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_reports%rowtype;
  after_row public.platform_reports%rowtype;
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.resolve');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into before_row
  from public.platform_reports
  where id = p_report_id
  for update;

  if before_row.id is null then
    raise exception 'Report not found.';
  end if;

  if before_row.resolution is null then
    raise exception 'Report must be resolved before it can be closed.';
  end if;

  if not public.platform_report_transition_allowed(
    before_row.status,
    'closed',
    actor.actor_role_slug
  ) then
    raise exception 'Invalid report status transition.';
  end if;

  update public.platform_reports
  set
    status = 'closed',
    closed_by_user_id = actor.actor_user_id,
    closed_at = now()
  where id = p_report_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.report_closed',
    'platform_admin_report',
    p_report_id,
    clean_reason,
    jsonb_build_object('status', before_row.status),
    jsonb_build_object('status', after_row.status)
  );

  return jsonb_build_object('report_id', after_row.id, 'status', after_row.status);
end;
$$;

create or replace function public.list_platform_admin_notes(
  p_target_type text,
  p_target_id uuid,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_target_type text := nullif(btrim(coalesce(p_target_type, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  perform public.platform_admin_require_permission('admin.notes.read');

  if clean_target_type not in ('user', 'business', 'location', 'report', 'team_membership') then
    raise exception 'Invalid note target type.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.platform_admin_notes notes
  where (clean_target_type = 'user' and notes.target_user_id = p_target_id)
    or (clean_target_type = 'business' and notes.target_organization_id = p_target_id)
    or (clean_target_type = 'location' and notes.target_location_id = p_target_id)
    or (clean_target_type = 'report' and notes.target_report_id = p_target_id)
    or (clean_target_type = 'team_membership' and notes.target_membership_id = p_target_id);

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      notes.created_at as sort_created_at,
      jsonb_build_object(
        'id', notes.id,
        'body', notes.body,
        'target_type', clean_target_type,
        'created_at', notes.created_at,
        'author', jsonb_build_object(
          'id', users.id,
          'display_name', users.display_name
        )
      ) as item
    from public.platform_admin_notes notes
    left join public.users users
      on users.id = notes.author_user_id
    where (clean_target_type = 'user' and notes.target_user_id = p_target_id)
      or (clean_target_type = 'business' and notes.target_organization_id = p_target_id)
      or (clean_target_type = 'location' and notes.target_location_id = p_target_id)
      or (clean_target_type = 'report' and notes.target_report_id = p_target_id)
      or (clean_target_type = 'team_membership' and notes.target_membership_id = p_target_id)
    order by notes.created_at desc, notes.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;

create or replace function public.create_platform_admin_note(
  p_target_type text,
  p_target_id uuid,
  p_body text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  clean_target_type text := nullif(btrim(coalesce(p_target_type, '')), '');
  clean_body text := nullif(btrim(coalesce(p_body, '')), '');
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  inserted_row public.platform_admin_notes%rowtype;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.notes.create');

  if clean_target_type not in ('user', 'business', 'location', 'report', 'team_membership') then
    raise exception 'Invalid note target type.';
  end if;

  if clean_body is null or length(clean_body) < 2 or length(clean_body) > 5000 then
    raise exception 'Note body must be between 2 and 5000 characters.';
  end if;

  insert into public.platform_admin_notes (
    target_user_id,
    target_organization_id,
    target_location_id,
    target_report_id,
    target_membership_id,
    body,
    author_user_id,
    author_membership_id
  )
  values (
    case when clean_target_type = 'user' then p_target_id else null end,
    case when clean_target_type = 'business' then p_target_id else null end,
    case when clean_target_type = 'location' then p_target_id else null end,
    case when clean_target_type = 'report' then p_target_id else null end,
    case when clean_target_type = 'team_membership' then p_target_id else null end,
    clean_body,
    actor.actor_user_id,
    actor.actor_membership_id
  )
  returning * into inserted_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.note_created',
    'platform_admin_note',
    inserted_row.id,
    clean_reason,
    null,
    jsonb_build_object(
      'note_id', inserted_row.id,
      'target_type', clean_target_type,
      'target_id', p_target_id
    )
  );

  return jsonb_build_object('note_id', inserted_row.id, 'created_at', inserted_row.created_at);
end;
$$;

create or replace function public.search_platform_admin_audit_logs(
  p_query text default null,
  p_action text default null,
  p_target_type text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_action text := nullif(btrim(coalesce(p_action, '')), '');
  clean_target_type text := nullif(btrim(coalesce(p_target_type, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  perform public.platform_admin_require_permission('admin.audit.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.platform_admin_audit_logs logs
  left join public.users users
    on users.id = logs.actor_user_id
  where (clean_action is null or logs.action = clean_action)
    and (clean_target_type is null or logs.target_type = clean_target_type)
    and (
      clean_query is null
      or logs.id::text = clean_query
      or logs.target_id::text = clean_query
      or logs.action ilike '%' || clean_query || '%'
      or logs.target_type ilike '%' || clean_query || '%'
      or logs.reason ilike '%' || clean_query || '%'
      or users.display_name ilike '%' || clean_query || '%'
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      logs.created_at as sort_created_at,
      jsonb_build_object(
        'id', logs.id,
        'actor_user_id', logs.actor_user_id,
        'action', logs.action,
        'target_type', logs.target_type,
        'target_id', logs.target_id,
        'reason', logs.reason,
        'before_data', logs.before_data,
        'after_data', logs.after_data,
        'metadata', logs.metadata,
        'request_id', logs.request_id,
        'created_at', logs.created_at,
        'actor', jsonb_build_object(
          'id', users.id,
          'display_name', users.display_name
        )
      ) as item
    from public.platform_admin_audit_logs logs
    left join public.users users
      on users.id = logs.actor_user_id
    where (clean_action is null or logs.action = clean_action)
      and (clean_target_type is null or logs.target_type = clean_target_type)
      and (
        clean_query is null
        or logs.id::text = clean_query
        or logs.target_id::text = clean_query
        or logs.action ilike '%' || clean_query || '%'
        or logs.target_type ilike '%' || clean_query || '%'
        or logs.reason ilike '%' || clean_query || '%'
        or users.display_name ilike '%' || clean_query || '%'
      )
    order by logs.created_at desc, logs.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;

create or replace function public.list_platform_admin_team(
  p_query text default null,
  p_status text default null,
  p_role_slug text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_role_slug text := nullif(btrim(coalesce(p_role_slug, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  perform public.platform_admin_require_permission('admin.team.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  if clean_status is not null and clean_status not in ('active', 'suspended', 'revoked') then
    raise exception 'Invalid team status filter.';
  end if;

  if clean_role_slug is not null and not exists (
    select 1 from public.platform_admin_roles roles where roles.slug = clean_role_slug
  ) then
    raise exception 'Invalid platform admin role.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.platform_admin_memberships memberships
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  join public.users users
    on users.id = memberships.user_id
  where (clean_status is null or memberships.status = clean_status)
    and (clean_role_slug is null or roles.slug = clean_role_slug)
    and (
      clean_query is null
      or memberships.id::text = clean_query
      or users.id::text = clean_query
      or users.display_name ilike '%' || clean_query || '%'
      or users.email ilike '%' || clean_query || '%'
      or roles.name ilike '%' || clean_query || '%'
      or roles.slug ilike '%' || clean_query || '%'
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      memberships.created_at as sort_created_at,
      jsonb_build_object(
        'id', memberships.id,
        'user_id', users.id,
        'user_display_name', users.display_name,
        'user_email', users.email,
        'user_status', users.status,
        'role_id', roles.id,
        'role_slug', roles.slug,
        'role_name', roles.name,
        'status', memberships.status,
        'created_by_user_id', memberships.created_by_user_id,
        'created_at', memberships.created_at,
        'updated_at', memberships.updated_at
      ) as item
    from public.platform_admin_memberships memberships
    join public.platform_admin_roles roles
      on roles.id = memberships.role_id
    join public.users users
      on users.id = memberships.user_id
    where (clean_status is null or memberships.status = clean_status)
      and (clean_role_slug is null or roles.slug = clean_role_slug)
      and (
        clean_query is null
        or memberships.id::text = clean_query
        or users.id::text = clean_query
        or users.display_name ilike '%' || clean_query || '%'
        or users.email ilike '%' || clean_query || '%'
        or roles.name ilike '%' || clean_query || '%'
        or roles.slug ilike '%' || clean_query || '%'
      )
    order by memberships.created_at desc, memberships.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;

create or replace function public.create_platform_admin_membership(
  p_user_id uuid,
  p_role_slug text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  target_user public.users%rowtype;
  target_role public.platform_admin_roles%rowtype;
  existing_membership public.platform_admin_memberships%rowtype;
  inserted_row public.platform_admin_memberships%rowtype;
  clean_role_slug text := nullif(btrim(coalesce(p_role_slug, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.team.manage');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  select *
  into target_user
  from public.users
  where id = p_user_id;

  if target_user.id is null then
    raise exception 'Target user not found.';
  end if;

  if target_user.status in ('suspended', 'deleted') then
    raise exception 'Suspended or deleted users cannot become platform admins.';
  end if;

  select *
  into target_role
  from public.platform_admin_roles
  where slug = clean_role_slug;

  if target_role.id is null then
    raise exception 'Platform admin role not found.';
  end if;

  select *
  into existing_membership
  from public.platform_admin_memberships
  where user_id = p_user_id
    and status in ('active', 'suspended')
  limit 1;

  if existing_membership.id is not null then
    raise exception 'Target user already has a current platform admin membership.';
  end if;

  insert into public.platform_admin_memberships (
    user_id,
    role_id,
    status,
    created_by_user_id
  )
  values (
    p_user_id,
    target_role.id,
    'active',
    actor.actor_user_id
  )
  returning * into inserted_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.membership_created',
    'platform_admin_membership',
    inserted_row.id,
    clean_reason,
    null,
    jsonb_build_object(
      'user_id', inserted_row.user_id,
      'role_slug', target_role.slug,
      'status', inserted_row.status
    )
  );

  return jsonb_build_object(
    'membership_id', inserted_row.id,
    'user_id', inserted_row.user_id,
    'role_slug', target_role.slug,
    'status', inserted_row.status
  );
end;
$$;

create or replace function public.update_platform_admin_membership(
  p_membership_id uuid,
  p_role_slug text,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor record;
  before_row public.platform_admin_memberships%rowtype;
  after_row public.platform_admin_memberships%rowtype;
  target_role public.platform_admin_roles%rowtype;
  before_role_slug text;
  clean_role_slug text := nullif(btrim(coalesce(p_role_slug, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_reason text;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.team.manage');
  clean_reason := public.platform_admin_normalize_reason(p_reason);

  if clean_status not in ('active', 'suspended', 'revoked') then
    raise exception 'Invalid platform admin membership status.';
  end if;

  select *
  into before_row
  from public.platform_admin_memberships memberships
  where memberships.id = p_membership_id
  for update;

  if before_row.id is null then
    raise exception 'Platform admin membership not found.';
  end if;

  select roles.slug
  into before_role_slug
  from public.platform_admin_roles roles
  where roles.id = before_row.role_id;

  if before_row.id = actor.actor_membership_id
    and (clean_status <> before_row.status or clean_role_slug <> before_role_slug)
  then
    raise exception 'Platform admins cannot change their own platform membership.';
  end if;

  select *
  into target_role
  from public.platform_admin_roles
  where slug = clean_role_slug;

  if target_role.id is null then
    raise exception 'Platform admin role not found.';
  end if;

  perform public.platform_admin_assert_not_last_owner(
    p_membership_id,
    target_role.slug,
    clean_status
  );

  update public.platform_admin_memberships
  set
    role_id = target_role.id,
    status = clean_status
  where id = p_membership_id
  returning * into after_row;

  insert into public.platform_admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    reason,
    before_data,
    after_data
  )
  values (
    actor.actor_user_id,
    'platform_admin.membership_updated',
    'platform_admin_membership',
    p_membership_id,
    clean_reason,
    jsonb_build_object(
      'role_slug', before_role_slug,
      'status', before_row.status
    ),
    jsonb_build_object(
      'role_slug', target_role.slug,
      'status', after_row.status
    )
  );

  return jsonb_build_object(
    'membership_id', after_row.id,
    'role_slug', target_role.slug,
    'status', after_row.status
  );
end;
$$;

revoke all privileges on sequence public.platform_report_number_seq
from public, anon, authenticated;
grant usage, select on sequence public.platform_report_number_seq to service_role;

revoke all on function public.validate_platform_admin_note()
from public, anon, authenticated;
revoke all on function public.platform_admin_clamp_page_size(integer)
from public, anon, authenticated;
revoke all on function public.platform_admin_normalize_page(integer)
from public, anon, authenticated;
revoke all on function public.platform_admin_normalize_reason(text)
from public, anon, authenticated;
revoke all on function public.platform_admin_current_actor()
from public, anon, authenticated;
revoke all on function public.platform_admin_require_permission(text)
from public, anon, authenticated;
revoke all on function public.platform_admin_assert_safe_audit_payload(jsonb)
from public, anon, authenticated;
revoke all on function public.platform_admin_assert_not_last_owner(uuid, text, text)
from public, anon, authenticated;

create or replace function public.account_recovery_current_user_can_read_support()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.lifecycle_current_user_is_support_admin()
    or public.platform_admin_has_permission('admin.recovery.read')
    or public.platform_admin_has_permission('admin.recovery.manage')
$$;

create or replace function public.account_recovery_current_user_can_manage_support()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.lifecycle_current_user_is_support_admin()
    or public.platform_admin_has_permission('admin.recovery.manage')
$$;

drop policy if exists "account_security_preferences_support_read"
on public.account_security_preferences;
create policy "account_security_preferences_support_read"
on public.account_security_preferences
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

drop policy if exists "account_login_sessions_support_read"
on public.account_login_sessions;
create policy "account_login_sessions_support_read"
on public.account_login_sessions
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

drop policy if exists "account_trusted_devices_support_read"
on public.account_trusted_devices;
create policy "account_trusted_devices_support_read"
on public.account_trusted_devices
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

drop policy if exists "account_login_activity_support_read"
on public.account_login_activity;
create policy "account_login_activity_support_read"
on public.account_login_activity
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

drop policy if exists "account_recovery_requests_support_read"
on public.account_recovery_requests;
create policy "account_recovery_requests_support_read"
on public.account_recovery_requests
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

drop policy if exists "account_recovery_requests_support_update"
on public.account_recovery_requests;
create policy "account_recovery_requests_support_update"
on public.account_recovery_requests
for update to authenticated
using (public.account_recovery_current_user_can_manage_support())
with check (public.account_recovery_current_user_can_manage_support());

drop policy if exists "account_recovery_request_events_support_read"
on public.account_recovery_request_events;
create policy "account_recovery_request_events_support_read"
on public.account_recovery_request_events
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

drop policy if exists "account_recovery_request_events_support_insert"
on public.account_recovery_request_events;
create policy "account_recovery_request_events_support_insert"
on public.account_recovery_request_events
for insert to authenticated
with check (public.account_recovery_current_user_can_manage_support());

drop policy if exists "users_support_read_recovery_cases"
on public.users;
create policy "users_support_read_recovery_cases"
on public.users
for select to authenticated
using (public.account_recovery_current_user_can_read_support());

create or replace function public.account_recovery_support_update_request(
  p_request_id uuid,
  p_status text,
  p_priority text,
  p_risk_level text,
  p_note text,
  p_resolution_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  request_row public.account_recovery_requests%rowtype;
  next_status text :=
    coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'reviewing');
  next_priority text :=
    coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'normal');
  next_risk_level text :=
    coalesce(nullif(btrim(coalesce(p_risk_level, '')), ''), 'unknown');
  safe_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  safe_resolution text :=
    nullif(left(btrim(coalesce(p_resolution_summary, '')), 2000), '');
begin
  if actor_user_id is null
    or not public.account_recovery_current_user_can_manage_support()
  then
    raise exception 'Recovery support permission is required.';
  end if;

  if next_status not in ('open', 'reviewing', 'needs_info', 'approved', 'denied', 'resolved', 'cancelled') then
    raise exception 'Unsupported recovery request status.';
  end if;

  if next_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'Unsupported recovery request priority.';
  end if;

  if next_risk_level not in ('unknown', 'low', 'medium', 'high', 'critical') then
    raise exception 'Unsupported recovery request risk level.';
  end if;

  select *
  into request_row
  from public.account_recovery_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Recovery request was not found.';
  end if;

  update public.account_recovery_requests
  set status = next_status,
      priority = next_priority,
      risk_level = next_risk_level,
      assigned_to_user_id = coalesce(assigned_to_user_id, actor_user_id),
      reviewed_by_user_id = actor_user_id,
      reviewed_at = coalesce(reviewed_at, now()),
      resolved_by_user_id =
        case
          when next_status in ('approved', 'denied', 'resolved', 'cancelled') then actor_user_id
          else resolved_by_user_id
        end,
      resolved_at =
        case
          when next_status in ('approved', 'denied', 'resolved', 'cancelled') then now()
          else resolved_at
        end,
      resolution_summary =
        case
          when safe_resolution is not null then safe_resolution
          else resolution_summary
        end,
      updated_at = now()
  where id = request_row.id;

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    request_row.id,
    actor_user_id,
    case
      when request_row.status is distinct from next_status then 'status_changed'
      else 'note_added'
    end,
    request_row.status,
    next_status,
    safe_note,
    jsonb_build_object(
      'priority', next_priority,
      'risk_level', next_risk_level,
      'resolution_summary_updated', safe_resolution is not null
    )
  );

  return jsonb_build_object(
    'request_id', request_row.id,
    'status', next_status
  );
end;
$$;

create or replace function public.account_recovery_support_secure_account(
  p_request_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  request_row public.account_recovery_requests%rowtype;
  safe_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  revoked_session_count integer := 0;
  removed_device_count integer := 0;
begin
  if actor_user_id is null
    or not public.account_recovery_current_user_can_manage_support()
  then
    raise exception 'Recovery support permission is required.';
  end if;

  select *
  into request_row
  from public.account_recovery_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Recovery request was not found.';
  end if;

  update public.account_login_sessions
  set revoked_at = now(),
      revoked_by_user_id = actor_user_id,
      updated_at = now()
  where user_id = request_row.user_id
    and revoked_at is null;

  get diagnostics revoked_session_count = row_count;

  update public.account_trusted_devices
  set removed_at = now(),
      updated_at = now()
  where user_id = request_row.user_id
    and removed_at is null;

  get diagnostics removed_device_count = row_count;

  insert into public.account_login_activity (
    user_id,
    activity_type,
    metadata
  )
  values (
    request_row.user_id,
    'support_account_secured',
    jsonb_build_object(
      'request_id', request_row.id,
      'actor_user_id', actor_user_id,
      'revoked_session_count', revoked_session_count,
      'removed_device_count', removed_device_count
    )
  );

  update public.account_recovery_requests
  set status = 'reviewing',
      priority = case when priority = 'urgent' then priority else 'high' end,
      risk_level = case when risk_level = 'critical' then risk_level else 'high' end,
      assigned_to_user_id = coalesce(assigned_to_user_id, actor_user_id),
      reviewed_by_user_id = actor_user_id,
      reviewed_at = coalesce(reviewed_at, now()),
      updated_at = now()
  where id = request_row.id;

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    request_row.id,
    actor_user_id,
    'account_secured',
    request_row.status,
    'reviewing',
    safe_note,
    jsonb_build_object(
      'revoked_session_count', revoked_session_count,
      'removed_device_count', removed_device_count
    )
  );

  return jsonb_build_object(
    'removed_device_count', removed_device_count,
    'revoked_session_count', revoked_session_count,
    'status', 'reviewing'
  );
end;
$$;

create or replace function public.account_recovery_support_update_user_status(
  p_request_id uuid,
  p_status text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  request_row public.account_recovery_requests%rowtype;
  safe_note text := nullif(left(btrim(coalesce(p_note, '')), 2000), '');
  next_status text := nullif(btrim(coalesce(p_status, '')), '');
begin
  if actor_user_id is null
    or not public.account_recovery_current_user_can_manage_support()
  then
    raise exception 'Recovery support permission is required.';
  end if;

  if next_status not in ('active', 'suspended') then
    raise exception 'Only active or suspended account status can be set from recovery support.';
  end if;

  select *
  into request_row
  from public.account_recovery_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Recovery request was not found.';
  end if;

  update public.users
  set status = next_status,
      updated_at = now()
  where id = request_row.user_id
    and status in ('active', 'suspended');

  insert into public.account_login_activity (
    user_id,
    activity_type,
    metadata
  )
  values (
    request_row.user_id,
    'support_account_status_updated',
    jsonb_build_object(
      'actor_user_id', actor_user_id,
      'request_id', request_row.id,
      'status', next_status
    )
  );

  insert into public.account_recovery_request_events (
    request_id,
    actor_user_id,
    event_type,
    from_status,
    to_status,
    note,
    metadata
  )
  values (
    request_row.id,
    actor_user_id,
    case when next_status = 'suspended' then 'account_suspended' else 'account_restored' end,
    request_row.status,
    request_row.status,
    safe_note,
    jsonb_build_object('user_status', next_status)
  );

  return jsonb_build_object(
    'request_id', request_row.id,
    'user_status', next_status
  );
end;
$$;

revoke all on function public.account_recovery_current_user_can_read_support()
from public, anon;
revoke all on function public.account_recovery_current_user_can_manage_support()
from public, anon;
grant execute on function public.account_recovery_current_user_can_read_support()
to authenticated;
grant execute on function public.account_recovery_current_user_can_manage_support()
to authenticated;
revoke all on function public.platform_report_transition_allowed(text, text, text)
from public, anon, authenticated;

revoke all on function public.list_organization_members_directory(uuid, integer, integer)
from public, anon;
revoke all on function public.get_platform_admin_dashboard()
from public, anon;
revoke all on function public.search_platform_admin_users(text, text, integer, integer)
from public, anon;
revoke all on function public.get_platform_admin_user_detail(uuid)
from public, anon;
revoke all on function public.update_platform_admin_user_profile(uuid, text, text, text, text, text)
from public, anon;
revoke all on function public.suspend_platform_user(uuid, text)
from public, anon;
revoke all on function public.restore_platform_user(uuid, text)
from public, anon;
revoke all on function public.search_platform_admin_businesses(text, text, integer, integer)
from public, anon;
revoke all on function public.get_platform_admin_business_detail(uuid)
from public, anon;
revoke all on function public.update_platform_admin_business_profile(uuid, text, text, text)
from public, anon;
revoke all on function public.update_platform_admin_business_status(uuid, text, text)
from public, anon;
revoke all on function public.search_platform_admin_locations(text, text, integer, integer)
from public, anon;
revoke all on function public.get_platform_admin_location_detail(uuid)
from public, anon;
revoke all on function public.update_platform_admin_location_profile(uuid, text, text, text, text, text, text, text, text, text)
from public, anon;
revoke all on function public.update_platform_admin_location_status(uuid, text, text)
from public, anon;
revoke all on function public.search_platform_admin_reports(text, text, text, text, integer, integer)
from public, anon;
revoke all on function public.get_platform_admin_report_detail(uuid)
from public, anon;
revoke all on function public.create_platform_admin_report(text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text)
from public, anon;
revoke all on function public.assign_platform_admin_report(uuid, uuid, text)
from public, anon;
revoke all on function public.update_platform_admin_report(uuid, text, text, text, text, text)
from public, anon;
revoke all on function public.resolve_platform_admin_report(uuid, text, text)
from public, anon;
revoke all on function public.close_platform_admin_report(uuid, text)
from public, anon;
revoke all on function public.list_platform_admin_notes(text, uuid, integer, integer)
from public, anon;
revoke all on function public.create_platform_admin_note(text, uuid, text, text)
from public, anon;
revoke all on function public.search_platform_admin_audit_logs(text, text, text, integer, integer)
from public, anon;
revoke all on function public.list_platform_admin_team(text, text, text, integer, integer)
from public, anon;
revoke all on function public.create_platform_admin_membership(uuid, text, text)
from public, anon;
revoke all on function public.update_platform_admin_membership(uuid, text, text, text)
from public, anon;

grant execute on function public.list_organization_members_directory(uuid, integer, integer)
to authenticated;

grant execute on function public.get_platform_admin_dashboard()
to authenticated;
grant execute on function public.search_platform_admin_users(text, text, integer, integer)
to authenticated;
grant execute on function public.get_platform_admin_user_detail(uuid)
to authenticated;
grant execute on function public.update_platform_admin_user_profile(uuid, text, text, text, text, text)
to authenticated;
grant execute on function public.suspend_platform_user(uuid, text)
to authenticated;
grant execute on function public.restore_platform_user(uuid, text)
to authenticated;
grant execute on function public.search_platform_admin_businesses(text, text, integer, integer)
to authenticated;
grant execute on function public.get_platform_admin_business_detail(uuid)
to authenticated;
grant execute on function public.update_platform_admin_business_profile(uuid, text, text, text)
to authenticated;
grant execute on function public.update_platform_admin_business_status(uuid, text, text)
to authenticated;
grant execute on function public.search_platform_admin_locations(text, text, integer, integer)
to authenticated;
grant execute on function public.get_platform_admin_location_detail(uuid)
to authenticated;
grant execute on function public.update_platform_admin_location_profile(uuid, text, text, text, text, text, text, text, text, text)
to authenticated;
grant execute on function public.update_platform_admin_location_status(uuid, text, text)
to authenticated;
grant execute on function public.search_platform_admin_reports(text, text, text, text, integer, integer)
to authenticated;
grant execute on function public.get_platform_admin_report_detail(uuid)
to authenticated;
grant execute on function public.create_platform_admin_report(text, text, text, text, text, uuid, uuid, uuid, uuid, uuid, text)
to authenticated;
grant execute on function public.assign_platform_admin_report(uuid, uuid, text)
to authenticated;
grant execute on function public.update_platform_admin_report(uuid, text, text, text, text, text)
to authenticated;
grant execute on function public.resolve_platform_admin_report(uuid, text, text)
to authenticated;
grant execute on function public.close_platform_admin_report(uuid, text)
to authenticated;
grant execute on function public.list_platform_admin_notes(text, uuid, integer, integer)
to authenticated;
grant execute on function public.create_platform_admin_note(text, uuid, text, text)
to authenticated;
grant execute on function public.search_platform_admin_audit_logs(text, text, text, integer, integer)
to authenticated;
grant execute on function public.list_platform_admin_team(text, text, text, integer, integer)
to authenticated;
grant execute on function public.create_platform_admin_membership(uuid, text, text)
to authenticated;
grant execute on function public.update_platform_admin_membership(uuid, text, text, text)
to authenticated;

-- Forward-only repair for an applied Phase 1 function.
-- Rollback reasoning: the previous STABLE declaration is invalid for a function
-- that takes an explicit table lock. Reverting would restore the lint/runtime
-- defect, so rollback should be another forward migration if behavior changes.

create or replace function public.platform_admin_assert_not_last_owner(
  target_membership_id uuid,
  next_role_slug text,
  next_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role_slug text;
  current_status text;
  active_owner_count integer;
begin
  lock table public.platform_admin_memberships in share row exclusive mode;

  select roles.slug, memberships.status
  into current_role_slug, current_status
  from public.platform_admin_memberships memberships
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  where memberships.id = target_membership_id;

  if current_role_slug <> 'platform_owner' or current_status <> 'active' then
    return;
  end if;

  if next_role_slug = 'platform_owner' and next_status = 'active' then
    return;
  end if;

  select count(*)
  into active_owner_count
  from public.platform_admin_memberships memberships
  join public.platform_admin_roles roles
    on roles.id = memberships.role_id
  join public.users users
    on users.id = memberships.user_id
  where memberships.id <> target_membership_id
    and memberships.status = 'active'
    and roles.slug = 'platform_owner'
    and users.status not in ('suspended', 'deleted');

  if active_owner_count = 0 then
    raise exception 'Cannot remove or suspend the last active platform owner.';
  end if;
end;
$$;

revoke all on function public.platform_admin_assert_not_last_owner(uuid, text, text)
from public, anon, authenticated;

