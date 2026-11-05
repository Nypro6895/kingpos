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
create or replace function public.user_belongs_to_account(target_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_memberships memberships
    where memberships.account_id = target_account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
  )
$$;
create or replace function public.user_has_account_permission(
  target_account_id uuid,
  permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.account_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
    left join public.permissions permissions on permissions.id = role_permissions.permission_id
    where memberships.account_id = target_account_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (
        roles.code = 'OWNER'
        or permissions.code = any(permission_codes)
      )
  )
$$;
create or replace function public.user_can_manage_salon(target_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    left join public.roles roles
      on roles.id = memberships.role_id
    where salons.id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (upper(roles.code) = 'OWNER' or upper(roles.code) = 'MANAGER')
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    left join public.roles roles
      on roles.id = memberships.role_id
    where memberships.salon_id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (upper(roles.code) = 'OWNER' or upper(roles.code) = 'MANAGER')
  )
$$;
create or replace function public.user_has_salon_permission(
  target_salon_id uuid,
  permission_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    where salons.id = target_salon_id
      and public.user_has_account_permission(salons.account_id, permission_codes)
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles on roles.id = memberships.role_id
    left join public.role_permissions role_permissions on role_permissions.role_id = roles.id
    left join public.permissions permissions on permissions.id = role_permissions.permission_id
    where memberships.salon_id = target_salon_id
      and memberships.user_id = public.current_public_user_id()
      and memberships.status = 'active'
      and (
        upper(roles.code) = 'OWNER'
        or permissions.code = any(permission_codes)
      )
  )
$$;
create or replace function public.lifecycle_user_is_salon_owner(
  p_salon_id uuid,
  p_user_id uuid,
  p_count_pending_deletion boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations salons
    join public.account_memberships memberships
      on memberships.account_id = salons.account_id
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users owner_users
      on owner_users.id = memberships.user_id
    where salons.id = p_salon_id
      and memberships.user_id = p_user_id
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
      and (
        owner_users.status = 'active'
        or (p_count_pending_deletion and owner_users.status = 'pending_deletion')
      )
  )
  or exists (
    select 1
    from public.salon_memberships memberships
    join public.roles roles
      on roles.id = memberships.role_id
    join public.users owner_users
      on owner_users.id = memberships.user_id
    where memberships.salon_id = p_salon_id
      and memberships.user_id = p_user_id
      and memberships.status = 'active'
      and upper(roles.code) = 'OWNER'
      and (
        owner_users.status = 'active'
        or (p_count_pending_deletion and owner_users.status = 'pending_deletion')
      )
  )
$$;
create or replace function public.auth_identity_is_deleted(p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_auth_user_id is not null
    and p_auth_user_id = auth.uid()
    and exists (
      select 1
      from public.deleted_auth_identities deleted_identities
      where deleted_identities.auth_user_id = p_auth_user_id
    )
$$;
create or replace function public.seed_default_roles_for_account(target_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_role_id uuid;
  manager_role_id uuid;
  staff_role_id uuid;
begin
  insert into public.roles (account_id, name, code, description, is_system)
  values
    (target_account_id, 'Owner', 'OWNER', 'Full account and salon access.', true),
    (target_account_id, 'Manager', 'MANAGER', 'Manage salon operations.', true),
    (target_account_id, 'Staff', 'STAFF', 'Staff workspace access.', true)
  on conflict (account_id, code) do update
  set name = excluded.name,
      description = excluded.description,
      is_system = excluded.is_system
  ;

  select id into owner_role_id from public.roles where account_id = target_account_id and code = 'OWNER';
  select id into manager_role_id from public.roles where account_id = target_account_id and code = 'MANAGER';
  select id into staff_role_id from public.roles where account_id = target_account_id and code = 'STAFF';

  insert into public.permissions (code, name, description, category, is_system)
  values
    ('staff.view', 'View staff', 'View staff.', 'Staff', true),
    ('staff.manage', 'Manage staff', 'Manage staff.', 'Staff', true),
    ('booking.view', 'View booking', 'View booking.', 'Booking', true),
    ('booking.manage', 'Manage booking', 'Manage booking.', 'Booking', true),
    ('tickets.view', 'View tickets', 'View POS tickets.', 'Tickets', true),
    ('tickets.manage', 'Manage tickets', 'Manage POS tickets.', 'Tickets', true),
    ('tickets.void', 'Void tickets', 'Void and reopen tickets.', 'Tickets', true),
    ('payroll.view', 'View payroll', 'View payroll.', 'Payroll', true),
    ('payroll.manage', 'Manage payroll', 'Manage payroll.', 'Payroll', true),
    ('payroll.tax_company', 'Tax company payroll', 'View tax company payroll.', 'Payroll', true),
    ('reports.view', 'View reports', 'View reports.', 'Reports', true),
    ('customers.view', 'View customers', 'View customers.', 'Customers', true),
    ('customers.manage', 'Manage customers', 'Manage customers.', 'Customers', true),
    ('services.view', 'View services', 'View services.', 'Services', true),
    ('services.manage', 'Manage services', 'Manage services.', 'Services', true),
    ('salon_settings.view', 'View salon settings', 'View salon settings.', 'Settings', true),
    ('salon_settings.manage', 'Manage salon settings', 'Manage salon settings.', 'Settings', true),
    ('salon_profile.view', 'View salon profile', 'View salon profile.', 'Salon', true),
    ('salon_profile.manage', 'Manage salon profile', 'Manage salon profile.', 'Salon', true),
    ('salon_profile.content.manage', 'Manage salon content', 'Manage salon profile content.', 'Salon', true),
    ('financial_corrections.request', 'Request corrections', 'Request financial corrections.', 'Reports', true),
    ('financial_corrections.apply', 'Apply corrections', 'Apply financial corrections.', 'Reports', true)
  on conflict (code) do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select owner_role_id, permissions.id from public.permissions
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select manager_role_id, permissions.id
  from public.permissions
  where permissions.code <> 'payroll.tax_company'
  on conflict do nothing;

  insert into public.role_permissions (role_id, permission_id)
  select staff_role_id, permissions.id
  from public.permissions
  where permissions.code in ('booking.view', 'tickets.view', 'salon_profile.view')
  on conflict do nothing;
end;
$$;
create or replace function public.ensure_personal_account_for_current_user(
  p_account_name text default null
)
returns table (
  account_id uuid,
  account_membership_id uuid,
  created_account boolean,
  created_membership boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  account_name text;
  existing_account_id uuid;
  existing_membership_id uuid;
  owner_role_id uuid;
  target_account_id uuid;
  target_membership_id uuid;
  user_row public.users%rowtype;
begin
  if actor_user_id is null then
    raise exception 'Authenticated public user is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor_user_id::text, 0));

  select *
  into user_row
  from public.users
  where id = actor_user_id;

  if user_row.id is null or user_row.status not in ('active', 'pending_deletion') then
    raise exception 'Active public user is required.';
  end if;

  select memberships.account_id, memberships.id
  into existing_account_id, existing_membership_id
  from public.account_memberships memberships
  join public.roles roles on roles.id = memberships.role_id
  join public.accounts accounts on accounts.id = memberships.account_id
  where memberships.user_id = actor_user_id
    and memberships.status = 'active'
    and accounts.status = 'active'
    and upper(roles.code) = 'OWNER'
  order by memberships.created_at, memberships.id
  limit 1;

  if existing_account_id is not null then
    account_id := existing_account_id;
    account_membership_id := existing_membership_id;
    created_account := false;
    created_membership := false;
    return next;
    return;
  end if;

  if user_row.status = 'pending_deletion' then
    return;
  end if;

  account_name := nullif(btrim(p_account_name), '');
  if account_name is null then
    account_name := coalesce(
      nullif(btrim(user_row.display_name), ''),
      nullif(split_part(coalesce(user_row.email, ''), '@', 1), ''),
      'Personal Account'
    );
  end if;

  insert into public.accounts (name, status)
  values (account_name, 'active')
  returning id into target_account_id;

  perform public.seed_default_roles_for_account(target_account_id);

  select id
  into owner_role_id
  from public.roles
  where roles.account_id = target_account_id
    and roles.code = 'OWNER';

  if owner_role_id is null then
    raise exception 'Owner role could not be provisioned for account.';
  end if;

  insert into public.account_memberships (
    account_id,
    user_id,
    role_id,
    status,
    joined_at
  )
  values (
    target_account_id,
    actor_user_id,
    owner_role_id,
    'active',
    now()
  )
  returning id into target_membership_id;

  account_id := target_account_id;
  account_membership_id := target_membership_id;
  created_account := true;
  created_membership := true;
  return next;
end;
$$;
-- Deny-by-default synthetic finance gate retained from original contract fixture.
CREATE FUNCTION public.market_billing_require_admin() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,qa_bootstrap AS $$
DECLARE actor uuid:=public.current_public_user_id();BEGIN IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM qa_bootstrap.financial_admins WHERE user_id=actor) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Separate financial administrator approval required';END IF;RETURN actor;END $$;
