-- Repair Admin Control functions after applying the current-schema merge.
-- The initial compat view matched the old organization model too narrowly and
-- two business update functions attempted to lock a view with lateral joins.

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
  memberships.updated_at,
  null::uuid as invited_by_user_id
from public.account_memberships memberships
left join public.roles roles on roles.id = memberships.role_id;

revoke all on public.platform_admin_business_memberships_compat
from public, anon, authenticated;

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
  before_row public.accounts%rowtype;
  after_row public.accounts%rowtype;
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
  from public.accounts
  where id = p_business_id
  for update;

  if before_row.id is null then
    raise exception 'Business not found.';
  end if;

  update public.accounts
  set name = clean_name,
      updated_at = now()
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
    jsonb_build_object('name', before_row.name),
    jsonb_build_object('name', after_row.name)
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
  before_row public.accounts%rowtype;
  after_row public.accounts%rowtype;
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
  from public.accounts
  where id = p_business_id
  for update;

  if before_row.id is null then
    raise exception 'Business not found.';
  end if;

  update public.accounts
  set status = clean_status,
      updated_at = now()
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

revoke all on function public.update_platform_admin_business_profile(uuid, text, text, text)
from public, anon;
revoke all on function public.update_platform_admin_business_status(uuid, text, text)
from public, anon;
grant execute on function public.update_platform_admin_business_profile(uuid, text, text, text)
to authenticated;
grant execute on function public.update_platform_admin_business_status(uuid, text, text)
to authenticated;
