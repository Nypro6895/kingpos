-- One self-scoped read snapshot; keep table grants/RLS and existing JS workspace
-- selection, lifecycle and permission semantics. No user/tenant argument exists.
create or replace function public.read_my_workspace_graph_v1()
returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if not exists (select 1 from public.users where auth_user_id=auth.uid() and status in ('active','pending_deletion')) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  with me as materialized (select id,status from public.users where auth_user_id=auth.uid()),
  am as materialized (
    select m.id,m.account_id,m.user_id,m.role_id,m.status,m.joined_at,m.created_at,m.updated_at
    from public.account_memberships m join me on me.id=m.user_id where m.status='active'
  ), sm as materialized (
    select m.id,m.account_id,m.salon_id,m.user_id,m.role_id,m.status,m.joined_at,m.created_at,m.updated_at
    from public.salon_memberships m join me on me.id=m.user_id where m.status='active'
  ), st as materialized (
    select s.id,s.salon_id from public.staff s join me on me.id=s.account_user_id where s.is_active=true
  ), managed_accounts as (select account_id from am union select account_id from sm),
  loc as materialized (
    select l.id,l.account_id,l.name,l.phone,l.address_line1,l.address_line2,l.city,l.state,l.postal_code,l.country,l.latitude,l.longitude,l.status,l.created_at,l.updated_at
    from public.locations l where l.account_id in (select account_id from managed_accounts)
      or l.id in (select salon_id from sm) or (l.status='active' and l.id in (select salon_id from st))
  ), acc as materialized (
    select a.id,a.name,a.status,a.created_at,a.updated_at from public.accounts a
    where a.id in (select account_id from managed_accounts union select account_id from loc)
  ), rol as materialized (
    select r.id,r.account_id,r.name,r.code,r.description,r.is_system,r.created_at,r.updated_at from public.roles r
    where r.id in (select role_id from am union select role_id from sm)
  ), profile as (
    select s.salon_id,s.public_profile_logo_path from public.salon_settings s where s.salon_id in (select id from loc)
  ), grant_codes as (
    select rp.role_id,p.code from public.role_permissions rp join public.permissions p on p.id=rp.permission_id
    where rp.role_id in (select id from rol)
  )
  select jsonb_build_object(
    'version',1,'userId',(select id from me),
    'bootstrapRequired', (select status='active' from me) and not exists (
      select 1 from am join rol on rol.id=am.role_id join acc on acc.id=am.account_id
      where upper(rol.code)='OWNER' and acc.status='active'
    ),
    'accountMemberships',coalesce((select jsonb_agg(to_jsonb(am) order by created_at,id) from am),'[]'::jsonb),
    'salonMemberships',coalesce((select jsonb_agg(to_jsonb(sm) order by created_at,id) from sm),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(to_jsonb(acc)) from acc),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(to_jsonb(rol)) from rol),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(to_jsonb(loc) order by created_at,id) from loc),'[]'::jsonb),
    'staff',coalesce((select jsonb_agg(to_jsonb(st)) from st),'[]'::jsonb),
    'profiles',coalesce((select jsonb_agg(to_jsonb(profile)) from profile),'[]'::jsonb),
    'grants',coalesce((select jsonb_agg(to_jsonb(grant_codes)) from grant_codes),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.read_my_workspace_graph_v1() from public, anon;
grant execute on function public.read_my_workspace_graph_v1() to authenticated;
