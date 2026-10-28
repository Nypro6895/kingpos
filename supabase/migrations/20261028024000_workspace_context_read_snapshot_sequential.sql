-- Bound the planner expansion of nested RLS: keep one HTTP call and the same
-- stable invoker snapshot, but plan each self-scoped table read independently.
create or replace function public.read_my_workspace_graph_v1()
returns jsonb language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
declare
  my_id uuid; my_status text;
  am jsonb; sm jsonb; st jsonb; loc jsonb; acc jsonb; rol jsonb; profile jsonb; grants jsonb;
  account_ids uuid[]; salon_ids uuid[]; staff_salon_ids uuid[]; role_ids uuid[];
  all_account_ids uuid[]; location_ids uuid[]; owner_exists boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select id,status into my_id,my_status from public.users where auth_user_id=auth.uid();
  if my_id is null or my_status not in ('active','pending_deletion') then
    raise exception 'Active account required' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]'::jsonb) into am
  from (select m.id,m.account_id,m.user_id,m.role_id,m.status,m.joined_at,m.created_at,m.updated_at from public.account_memberships m where m.user_id=my_id and m.status='active') x;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]'::jsonb) into sm
  from (select m.id,m.account_id,m.salon_id,m.user_id,m.role_id,m.status,m.joined_at,m.created_at,m.updated_at from public.salon_memberships m where m.user_id=my_id and m.status='active') x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into st
  from (select s.id,s.salon_id from public.staff s where s.account_user_id=my_id and s.is_active=true) x;
  select coalesce(array_agg(distinct (x->>'account_id')::uuid),'{}'::uuid[]) into account_ids from jsonb_array_elements(am || sm) x;
  select coalesce(array_agg(distinct (x->>'salon_id')::uuid),'{}'::uuid[]) into salon_ids from jsonb_array_elements(sm) x;
  select coalesce(array_agg(distinct (x->>'salon_id')::uuid),'{}'::uuid[]) into staff_salon_ids from jsonb_array_elements(st) x;
  select coalesce(array_agg(distinct (x->>'role_id')::uuid),'{}'::uuid[]) into role_ids from jsonb_array_elements(am || sm) x;
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at,id),'[]'::jsonb) into loc
  from (select l.id,l.account_id,l.name,l.phone,l.address_line1,l.address_line2,l.city,l.state,l.postal_code,l.country,l.latitude,l.longitude,l.status,l.created_at,l.updated_at from public.locations l where l.account_id=any(account_ids) or l.id=any(salon_ids) or (l.status='active' and l.id=any(staff_salon_ids))) x;
  select account_ids || coalesce(array_agg(distinct (x->>'account_id')::uuid),'{}'::uuid[]) into all_account_ids from jsonb_array_elements(loc) x;
  select coalesce(array_agg(distinct (x->>'id')::uuid),'{}'::uuid[]) into location_ids from jsonb_array_elements(loc) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into acc
  from (select a.id,a.name,a.status,a.created_at,a.updated_at from public.accounts a where a.id=any(all_account_ids)) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into rol
  from (select r.id,r.account_id,r.name,r.code,r.description,r.is_system,r.created_at,r.updated_at from public.roles r where r.id=any(role_ids)) x;
  select coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into role_ids from jsonb_array_elements(rol) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into profile
  from (select s.salon_id,s.public_profile_logo_path from public.salon_settings s where s.salon_id=any(location_ids)) x;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into grants
  from (select rp.role_id,p.code from public.role_permissions rp join public.permissions p on p.id=rp.permission_id where rp.role_id=any(role_ids)) x;
  select exists (
    select 1 from jsonb_array_elements(am) m
    join jsonb_array_elements(rol) r on r->>'id'=m->>'role_id'
    join jsonb_array_elements(acc) a on a->>'id'=m->>'account_id'
    where upper(r->>'code')='OWNER' and a->>'status'='active'
  ) into owner_exists;
  return jsonb_build_object('version',1,'userId',my_id,'bootstrapRequired',my_status='active' and not owner_exists,
    'accountMemberships',am,'salonMemberships',sm,'accounts',acc,'roles',rol,'locations',loc,'staff',st,'profiles',profile,'grants',grants);
end;
$$;
revoke all on function public.read_my_workspace_graph_v1() from public, anon;
grant execute on function public.read_my_workspace_graph_v1() to authenticated;
