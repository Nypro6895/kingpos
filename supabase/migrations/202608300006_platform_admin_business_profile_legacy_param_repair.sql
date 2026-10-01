-- Keep the legacy RPC signature stable while making the ignored legacy
-- legal-name parameter explicit for database linting.

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
  ignored_legacy_legal_name text := nullif(btrim(coalesce(p_legal_name, '')), '');
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
    after_data,
    metadata
  )
  values (
    actor.actor_user_id,
    'platform_admin.business_profile_updated',
    'platform_admin_business',
    p_business_id,
    clean_reason,
    jsonb_build_object('name', before_row.name),
    jsonb_build_object('name', after_row.name),
    jsonb_build_object(
      'legacy_legal_name_ignored',
      ignored_legacy_legal_name is not null
    )
  );

  return jsonb_build_object(
    'business_id', after_row.id,
    'status', after_row.status
  );
end;
$$;

revoke all on function public.update_platform_admin_business_profile(uuid, text, text, text)
from public, anon;
grant execute on function public.update_platform_admin_business_profile(uuid, text, text, text)
to authenticated;
