begin;

do $$
declare
  admin_auth_user_id uuid := gen_random_uuid();
  admin_context_count integer;
  admin_permission_count integer;
  admin_role_id uuid;
  admin_user_id uuid;
  audit_insert_denied boolean := false;
  audit_secret_denied boolean := false;
  auditor_auth_user_id uuid := gen_random_uuid();
  auditor_user_id uuid;
  deleted_public_auth_user_id uuid := gen_random_uuid();
  deleted_public_user_id uuid;
  empty_reason_denied boolean := false;
  membership_insert_denied boolean := false;
  moderator_auth_user_id uuid := gen_random_uuid();
  moderator_user_id uuid;
  normal_dashboard_denied boolean := false;
  normal_auth_user_id uuid := gen_random_uuid();
  normal_other_user_count integer;
  normal_own_user_count integer;
  normal_status_update_denied boolean := false;
  normal_visible_count integer;
  normal_user_id uuid;
  operations_auth_user_id uuid := gen_random_uuid();
  operations_user_id uuid;
  owner_permission_count integer;
  platform_permission_count integer;
  report_create_result jsonb;
  report_id uuid;
  revoked_auth_user_id uuid := gen_random_uuid();
  revoked_user_id uuid;
  role_permission_insert_denied boolean := false;
  salon_owner_auth_user_id uuid := gen_random_uuid();
  salon_owner_user_id uuid;
  support_auth_user_id uuid := gen_random_uuid();
  support_report_resolve_denied boolean := false;
  support_user_id uuid;
  suspended_membership_auth_user_id uuid := gen_random_uuid();
  suspended_membership_user_id uuid;
  suspended_public_auth_user_id uuid := gen_random_uuid();
  suspended_public_user_id uuid;
  target_membership_id uuid;
begin
  if (
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'platform_admin_roles',
        'platform_admin_permissions',
        'platform_admin_role_permissions',
        'platform_admin_memberships',
        'platform_admin_audit_logs',
        'platform_reports',
        'platform_admin_notes'
      )
  ) <> 7 then
    raise exception 'One or more platform admin tables are missing.';
  end if;

  if exists (
    select 1
    from pg_class
    where oid in (
      'public.platform_admin_roles'::regclass,
      'public.platform_admin_permissions'::regclass,
      'public.platform_admin_role_permissions'::regclass,
      'public.platform_admin_memberships'::regclass,
      'public.platform_admin_audit_logs'::regclass,
      'public.platform_reports'::regclass,
      'public.platform_admin_notes'::regclass
    )
      and relrowsecurity is not true
  ) then
    raise exception 'Platform admin table RLS is not enabled.';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.users'::regclass
      and relrowsecurity is true
      and relforcerowsecurity is false
  ) then
    raise exception 'public.users RLS state is not hardened as expected.';
  end if;

  if (
    select count(*)
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and pg_proc.proname in (
        'platform_admin_has_permission',
        'is_platform_admin',
        'get_current_platform_admin_context',
        'bootstrap_platform_owner'
      )
      and pg_proc.prosecdef is true
  ) <> 4 then
    raise exception 'Platform admin security-definer functions are missing.';
  end if;

  if has_table_privilege('anon', 'public.platform_admin_roles', 'select')
    or has_table_privilege('anon', 'public.platform_admin_audit_logs', 'select')
  then
    raise exception 'Anon has platform admin table privileges.';
  end if;

  if has_table_privilege('anon', 'public.users', 'select')
    or has_table_privilege('anon', 'public.users', 'insert')
    or has_table_privilege('anon', 'public.users', 'update')
    or has_table_privilege('anon', 'public.users', 'delete')
  then
    raise exception 'Anon has public.users table privileges.';
  end if;

  if not has_table_privilege('authenticated', 'public.users', 'select')
    or not has_table_privilege('authenticated', 'public.users', 'insert')
    or not has_column_privilege('authenticated', 'public.users', 'display_name', 'update')
    or has_column_privilege('authenticated', 'public.users', 'status', 'update')
    or has_table_privilege('authenticated', 'public.users', 'delete')
  then
    raise exception 'Authenticated public.users privileges are not minimally scoped.';
  end if;

  if has_table_privilege('authenticated', 'public.platform_admin_memberships', 'insert')
    or has_table_privilege('authenticated', 'public.platform_admin_role_permissions', 'insert')
    or has_table_privilege('authenticated', 'public.platform_admin_audit_logs', 'insert')
    or has_table_privilege('authenticated', 'public.platform_admin_audit_logs', 'update')
    or has_table_privilege('authenticated', 'public.platform_admin_audit_logs', 'delete')
    or has_table_privilege('authenticated', 'public.platform_reports', 'insert')
    or has_table_privilege('authenticated', 'public.platform_reports', 'update')
    or has_table_privilege('authenticated', 'public.platform_admin_notes', 'insert')
    or has_table_privilege('authenticated', 'public.platform_admin_notes', 'update')
  then
    raise exception 'Authenticated has direct platform admin mutation privileges.';
  end if;

  if has_table_privilege('service_role', 'public.platform_admin_audit_logs', 'update')
    or has_table_privilege('service_role', 'public.platform_admin_audit_logs', 'delete')
    or has_table_privilege('service_role', 'public.platform_reports', 'delete')
  then
    raise exception 'Service role has an unsafe platform admin direct mutation privilege.';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.bootstrap_platform_owner(uuid,text)',
    'execute'
  ) then
    raise exception 'Authenticated can execute bootstrap_platform_owner.';
  end if;

  if has_function_privilege(
    'anon',
    'public.get_current_platform_admin_context()',
    'execute'
  )
    or has_function_privilege('anon', 'public.is_platform_admin()', 'execute')
    or has_function_privilege(
      'anon',
      'public.get_platform_admin_dashboard()',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.bootstrap_platform_owner(uuid,text)',
      'execute'
    )
  then
    raise exception 'Anon can execute platform admin helper functions.';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.bootstrap_platform_owner(uuid,text)',
    'execute'
  ) then
    raise exception 'Service role cannot execute bootstrap_platform_owner.';
  end if;

  select count(*)
  into platform_permission_count
  from public.platform_admin_permissions;

  select permissions.id
  into admin_role_id
  from public.platform_admin_permissions permissions
  where permissions.code = 'admin.access';

  if admin_role_id is null then
    raise exception 'admin.access permission is missing.';
  end if;

  select count(*)
  into owner_permission_count
  from public.platform_admin_role_permissions role_permissions
  join public.platform_admin_roles roles
    on roles.id = role_permissions.role_id
  where roles.slug = 'platform_owner';

  if owner_permission_count <> platform_permission_count then
    raise exception 'Platform owner does not have all seeded permissions.';
  end if;

  insert into auth.users (
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values
    (
      normal_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-normal@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Normal"}'::jsonb,
      now(),
      now()
    ),
    (
      admin_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-owner@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Owner"}'::jsonb,
      now(),
      now()
    ),
    (
      auditor_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-auditor@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Auditor"}'::jsonb,
      now(),
      now()
    ),
    (
      revoked_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-revoked@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Revoked"}'::jsonb,
      now(),
      now()
    ),
    (
      operations_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-operations@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Operations"}'::jsonb,
      now(),
      now()
    ),
    (
      support_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-support@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Support"}'::jsonb,
      now(),
      now()
    ),
    (
      moderator_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-moderator@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Moderator"}'::jsonb,
      now(),
      now()
    ),
    (
      salon_owner_auth_user_id,
      'authenticated',
      'authenticated',
      'salon-owner@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Salon Owner"}'::jsonb,
      now(),
      now()
    ),
    (
      suspended_public_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-suspended-public@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Suspended Public"}'::jsonb,
      now(),
      now()
    ),
    (
      deleted_public_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-deleted-public@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Deleted Public"}'::jsonb,
      now(),
      now()
    ),
    (
      suspended_membership_auth_user_id,
      'authenticated',
      'authenticated',
      'platform-suspended-membership@example.test',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"display_name":"Platform Suspended Membership"}'::jsonb,
      now(),
      now()
    );

  insert into public.users (auth_user_id, email, display_name, status)
  values
    (normal_auth_user_id, 'platform-normal@example.test', 'Platform Normal', 'active'),
    (admin_auth_user_id, 'platform-owner@example.test', 'Platform Owner', 'active'),
    (auditor_auth_user_id, 'platform-auditor@example.test', 'Platform Auditor', 'active'),
    (revoked_auth_user_id, 'platform-revoked@example.test', 'Platform Revoked', 'active'),
    (operations_auth_user_id, 'platform-operations@example.test', 'Platform Operations', 'active'),
    (support_auth_user_id, 'platform-support@example.test', 'Platform Support', 'active'),
    (moderator_auth_user_id, 'platform-moderator@example.test', 'Platform Moderator', 'active'),
    (salon_owner_auth_user_id, 'salon-owner@example.test', 'Salon Owner', 'active'),
    (
      suspended_public_auth_user_id,
      'platform-suspended-public@example.test',
      'Platform Suspended Public',
      'suspended'
    ),
    (
      deleted_public_auth_user_id,
      'platform-deleted-public@example.test',
      'Platform Deleted Public',
      'deleted'
    ),
    (
      suspended_membership_auth_user_id,
      'platform-suspended-membership@example.test',
      'Platform Suspended Membership',
      'active'
    )
  on conflict (auth_user_id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    status = excluded.status;

  select id into normal_user_id
  from public.users
  where auth_user_id = normal_auth_user_id;

  select id into admin_user_id
  from public.users
  where auth_user_id = admin_auth_user_id;

  select id into auditor_user_id
  from public.users
  where auth_user_id = auditor_auth_user_id;

  select id into revoked_user_id
  from public.users
  where auth_user_id = revoked_auth_user_id;

  select id into operations_user_id
  from public.users
  where auth_user_id = operations_auth_user_id;

  select id into support_user_id
  from public.users
  where auth_user_id = support_auth_user_id;

  select id into moderator_user_id
  from public.users
  where auth_user_id = moderator_auth_user_id;

  select id into salon_owner_user_id
  from public.users
  where auth_user_id = salon_owner_auth_user_id;

  select id into suspended_public_user_id
  from public.users
  where auth_user_id = suspended_public_auth_user_id;

  select id into deleted_public_user_id
  from public.users
  where auth_user_id = deleted_public_auth_user_id;

  select id into suspended_membership_user_id
  from public.users
  where auth_user_id = suspended_membership_auth_user_id;

  perform set_config('request.jwt.claim.sub', normal_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  update public.users
  set display_name = 'Platform Normal Updated'
  where auth_user_id = normal_auth_user_id;
  select count(*)
  into normal_other_user_count
  from public.users
  where auth_user_id <> normal_auth_user_id;
  select count(*)
  into normal_own_user_count
  from public.users
  where auth_user_id = normal_auth_user_id;
  select count(*)
  into normal_visible_count
  from public.platform_admin_roles;
  execute 'reset role';

  if normal_own_user_count <> 1 then
    raise exception 'Normal authenticated user cannot view their own public.users row.';
  end if;

  if normal_other_user_count <> 0 then
    raise exception 'Normal authenticated user can view unrelated public.users rows.';
  end if;

  if normal_visible_count <> 0 then
    raise exception 'Normal authenticated user can view platform admin roles.';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', normal_auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    perform public.get_platform_admin_dashboard();
  exception
    when others then
      normal_dashboard_denied := true;
  end;
  execute 'reset role';

  if normal_dashboard_denied is not true then
    raise exception 'Normal authenticated user can execute platform admin dashboard RPC.';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', normal_auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    update public.users
    set status = 'suspended'
    where auth_user_id = normal_auth_user_id;
  exception
    when insufficient_privilege then
      normal_status_update_denied := true;
  end;
  execute 'reset role';

  if normal_status_update_denied is not true then
    raise exception 'Normal authenticated user can update public.users.status.';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', normal_auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    insert into public.platform_admin_memberships (user_id, role_id, status)
    select normal_user_id, roles.id, 'active'
    from public.platform_admin_roles roles
    where roles.slug = 'platform_owner';
  exception
    when insufficient_privilege then
      membership_insert_denied := true;
  end;
  execute 'reset role';

  if membership_insert_denied is not true then
    raise exception 'Authenticated user can directly insert platform admin membership.';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', normal_auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    insert into public.platform_admin_audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      normal_user_id,
      'test.direct_insert',
      'platform_admin_test',
      normal_user_id,
      '{}'::jsonb
    );
  exception
    when insufficient_privilege then
      audit_insert_denied := true;
  end;
  execute 'reset role';

  if audit_insert_denied is not true then
    raise exception 'Authenticated user can directly insert platform admin audit logs.';
  end if;

  begin
    perform set_config('request.jwt.claim.sub', normal_auth_user_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    execute 'set local role authenticated';
    insert into public.platform_admin_role_permissions (role_id, permission_id)
    select roles.id, permissions.id
    from public.platform_admin_roles roles
    cross join public.platform_admin_permissions permissions
    where roles.slug = 'support_agent'
      and permissions.code = 'admin.team.manage'
    limit 1;
  exception
    when insufficient_privilege then
      role_permission_insert_denied := true;
  end;
  execute 'reset role';

  if role_permission_insert_denied is not true then
    raise exception 'Authenticated user can directly insert platform admin role permissions.';
  end if;

  if public.platform_admin_json_contains_forbidden_key(
    '{"nested":{"Secret":"value"}}'::jsonb
  ) is not true then
    raise exception 'Audit forbidden-key helper does not catch mixed-case nested keys.';
  end if;

  begin
    insert into public.platform_admin_audit_logs (
      actor_user_id,
      action,
      target_type,
      target_id,
      metadata
    )
    values (
      normal_user_id,
      'test.secret_rejection',
      'platform_admin_test',
      normal_user_id,
      '{"nested":{"Secret":"value"}}'::jsonb
    );
  exception
    when others then
      audit_secret_denied := true;
  end;

  if audit_secret_denied is not true then
    raise exception 'Platform admin audit logs accept nested secret metadata.';
  end if;

  begin
    perform public.bootstrap_platform_owner(admin_user_id, '');
  exception
    when others then
      empty_reason_denied := true;
  end;

  if empty_reason_denied is not true then
    raise exception 'Bootstrap accepts an empty reason.';
  end if;

  target_membership_id := public.bootstrap_platform_owner(
    admin_user_id,
    'platform admin foundation gate'
  );

  if target_membership_id is null then
    raise exception 'Bootstrap did not return a membership id.';
  end if;

  if public.bootstrap_platform_owner(admin_user_id, 'idempotency gate') <> target_membership_id then
    raise exception 'Bootstrap is not idempotent for the same platform owner.';
  end if;

  perform set_config('request.jwt.claim.sub', admin_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*)
  into admin_context_count
  from public.get_current_platform_admin_context();
  select count(*)
  into admin_permission_count
  from public.platform_admin_permissions;
  execute 'reset role';

  if admin_context_count <> 1 then
    raise exception 'Active platform owner cannot resolve admin context.';
  end if;

  if admin_permission_count <> platform_permission_count then
    raise exception 'Active platform owner cannot view platform admin permissions.';
  end if;

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select operations_user_id, roles.id, 'active'
  from public.platform_admin_roles roles
  where roles.slug = 'operations_admin';

  perform set_config('request.jwt.claim.sub', operations_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.platform_admin_has_permission('admin.businesses.update_status') is not true
    or public.platform_admin_has_permission('admin.locations.update_status') is not true
    or public.platform_admin_has_permission('admin.users.suspend') is not true
    or public.platform_admin_has_permission('admin.users.restore') is not true
    or public.platform_admin_has_permission('admin.reports.assign') is not true
    or public.platform_admin_has_permission('admin.audit.read') is not true
    or public.platform_admin_has_permission('admin.team.read') is not true
    or public.platform_admin_has_permission('admin.team.manage') is true
  then
    raise exception 'Operations admin permission matrix is incorrect.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select support_user_id, roles.id, 'active'
  from public.platform_admin_roles roles
  where roles.slug = 'support_agent';

  perform set_config('request.jwt.claim.sub', support_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.platform_admin_has_permission('admin.access') is not true
    or public.platform_admin_has_permission('admin.users.read') is not true
    or public.platform_admin_has_permission('admin.users.read_sensitive') is not true
    or public.platform_admin_has_permission('admin.reports.create') is not true
    or public.platform_admin_has_permission('admin.reports.update') is not true
    or public.platform_admin_has_permission('admin.notes.read') is not true
    or public.platform_admin_has_permission('admin.users.suspend') is true
    or public.platform_admin_has_permission('admin.reports.assign') is true
    or public.platform_admin_has_permission('admin.reports.resolve') is true
    or public.platform_admin_has_permission('admin.audit.read') is true
    or public.platform_admin_has_permission('admin.team.manage') is true
  then
    raise exception 'Support agent permission matrix is incorrect.';
  end if;

  report_create_result := public.create_platform_admin_report(
    'support',
    'normal',
    'Support smoke report',
    'Created by platform admin foundation gate.',
    'manual',
    null,
    normal_user_id,
    null,
    null,
    null,
    null
  );
  report_id := (report_create_result ->> 'report_id')::uuid;

  perform public.update_platform_admin_report(
    report_id,
    'high',
    'under_review',
    'Support smoke report',
    'Updated by platform admin foundation gate.',
    'support can update report workflow'
  );

  begin
    perform public.resolve_platform_admin_report(
      report_id,
      'Resolved by support should be denied.',
      'support resolve denied gate'
    );
  exception
    when others then
      support_report_resolve_denied := true;
  end;

  if support_report_resolve_denied is not true then
    raise exception 'Support agent can resolve platform reports.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select moderator_user_id, roles.id, 'active'
  from public.platform_admin_roles roles
  where roles.slug = 'moderator';

  perform set_config('request.jwt.claim.sub', moderator_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.platform_admin_has_permission('admin.reports.assign') is not true
    or public.platform_admin_has_permission('admin.reports.resolve') is not true
    or public.platform_admin_has_permission('admin.reports.create') is not true
    or public.platform_admin_has_permission('admin.reports.update') is not true
    or public.platform_admin_has_permission('admin.notes.read') is not true
    or public.platform_admin_has_permission('admin.users.read_sensitive') is true
    or public.platform_admin_has_permission('admin.businesses.update_status') is true
    or public.platform_admin_has_permission('admin.locations.update_status') is true
    or public.platform_admin_has_permission('admin.team.manage') is true
  then
    raise exception 'Moderator permission matrix is incorrect.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select auditor_user_id, roles.id, 'active'
  from public.platform_admin_roles roles
  where roles.slug = 'auditor';

  perform set_config('request.jwt.claim.sub', auditor_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.platform_admin_has_permission('admin.audit.read') is not true
    or public.platform_admin_has_permission('admin.dashboard.read') is not true
    or public.platform_admin_has_permission('admin.team.read') is not true
    or public.platform_admin_has_permission('admin.reports.read') is not true
    or public.platform_admin_has_permission('admin.users.suspend') is true
    or public.platform_admin_has_permission('admin.reports.update') is true
    or public.platform_admin_has_permission('admin.notes.create') is true
    or public.platform_admin_has_permission('admin.team.manage') is true
  then
    raise exception 'Auditor permission matrix is incorrect.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select revoked_user_id, roles.id, 'revoked'
  from public.platform_admin_roles roles
  where roles.slug = 'platform_owner';

  perform set_config('request.jwt.claim.sub', revoked_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  if public.is_platform_admin() is true then
    raise exception 'Revoked platform admin membership can access admin.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select suspended_membership_user_id, roles.id, 'suspended'
  from public.platform_admin_roles roles
  where roles.slug = 'platform_owner';

  perform set_config('request.jwt.claim.sub', suspended_membership_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.is_platform_admin() is true then
    raise exception 'Suspended platform admin membership can access admin.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select suspended_public_user_id, roles.id, 'active'
  from public.platform_admin_roles roles
  where roles.slug = 'platform_owner';

  perform set_config('request.jwt.claim.sub', suspended_public_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.is_platform_admin() is true then
    raise exception 'Suspended public user with active membership can access admin.';
  end if;
  execute 'reset role';

  insert into public.platform_admin_memberships (user_id, role_id, status)
  select deleted_public_user_id, roles.id, 'active'
  from public.platform_admin_roles roles
  where roles.slug = 'platform_owner';

  perform set_config('request.jwt.claim.sub', deleted_public_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.is_platform_admin() is true then
    raise exception 'Deleted public user with active membership can access admin.';
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', salon_owner_auth_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  if public.is_platform_admin() is true then
    raise exception 'Salon owner without platform membership can access admin.';
  end if;
  execute 'reset role';
end;
$$;

rollback;
