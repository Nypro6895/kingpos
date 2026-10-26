-- Presentation only: preserve accounts, locations and both permission scopes.
begin;
create or replace function public.admin_user_store_grants(p_user_id uuid)
returns table(store_id uuid,account_id uuid,store_name text,membership_id uuid,scope text,entity_id uuid,role text,status text,account_status text,store_count bigint)
language sql stable security definer set search_path=public as $$
 select l.id,l.account_id,l.name,m.id,'business',m.account_id,upper(coalesce(r.code,'MEMBER')),m.status,a.status,
 (select count(*) from locations siblings where siblings.account_id=l.account_id)
 from account_memberships m join locations l on l.account_id=m.account_id join accounts a on a.id=l.account_id left join roles r on r.id=m.role_id where m.user_id=p_user_id
 union all
 select l.id,l.account_id,l.name,m.id,'salon',l.id,upper(coalesce(r.code,'MEMBER')),m.status,a.status,1::bigint
 from salon_memberships m join locations l on l.id=m.salon_id join accounts a on a.id=l.account_id left join roles r on r.id=m.role_id where m.user_id=p_user_id;
$$;
revoke all on function public.admin_user_store_grants(uuid) from public,anon,authenticated;

create or replace function public.admin_user_access_stores(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.users.read');
 if not exists(select 1 from users where id=p_user_id) then raise exception 'User not found.'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',l.status,'sources',
 (select coalesce(jsonb_agg(jsonb_build_object('membership_id',g.membership_id,'scope',g.scope,'entity_id',g.entity_id,'role',g.role,'status',g.status,'account_status',g.account_status,'store_count',g.store_count) order by g.scope,g.membership_id),'[]') from admin_user_store_grants(p_user_id) g where g.store_id=l.id),
 'staff_linked',exists(select 1 from staff s join users u on u.id=p_user_id where s.salon_id=l.id and s.is_active and (s.account_user_id=u.id or s.user_id=u.auth_user_id))) order by l.name,l.id),'[]')
 from locations l where exists(select 1 from admin_user_store_grants(p_user_id) g where g.store_id=l.id)
 or exists(select 1 from staff s join users u on u.id=p_user_id where s.salon_id=l.id and s.is_active and (s.account_user_id=u.id or s.user_id=u.auth_user_id)));
end;$$;
revoke all on function public.admin_user_access_stores(uuid) from public,anon;
grant execute on function public.admin_user_access_stores(uuid) to authenticated;

create or replace function public.admin_store_owners(p_store_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.locations.read');
 perform platform_admin_require_permission('admin.users.read');
 return (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.display_name,'Unnamed user'),'status',u.status) order by u.display_name,u.id),'[]') from users u where exists(
 select 1 from admin_user_store_grants(u.id) g where g.store_id=p_store_id and g.role='OWNER' and g.status='active'));
end;$$;
revoke all on function public.admin_store_owners(uuid) from public,anon;
grant execute on function public.admin_store_owners(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.search_platform_admin_users_stores(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_business_id uuid DEFAULT NULL::uuid, p_sort text DEFAULT 'created_desc'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare sensitive boolean; result jsonb;
begin
 perform public.platform_admin_require_permission('admin.users.read');
 sensitive:=public.platform_admin_has_permission('admin.users.read_sensitive');
 if p_page<1 or p_page_size not between 1 and 100 or length(coalesce(p_query,''))>100
 or (p_status is not null and p_status not in ('active','inactive','suspended','pending_deletion','deleted'))
 or (p_role is not null and p_role not in ('owner','manager','staff','customer','platform_admin'))
 or p_sort not in ('created_desc','name_asc','last_login_desc') then raise exception 'Invalid user search.'; end if;
 with candidates as (
 select u.*,coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name) order by l.name,l.id) from locations l where exists(select 1 from admin_user_store_grants(u.id) g where g.store_id=l.id and g.status='active') or exists(select 1 from staff s where s.salon_id=l.id and s.is_active and (s.account_user_id=u.id or s.user_id=u.auth_user_id))),'[]'::jsonb) businesses,
 coalesce((select array_agg(distinct case when g.role='OWNER' then 'owner' when g.role='MANAGER' then 'manager' else 'staff' end) from (select role from admin_user_store_grants(u.id) where status='active' union all select 'STAFF' where exists(select 1 from staff s where s.is_active and (s.account_user_id=u.id or s.user_id=u.auth_user_id))) g),'{}'::text[]) roles
 from users u where (p_status is null or u.status=p_status)
 and (p_business_id is null or exists(select 1 from admin_user_store_grants(u.id) g where g.store_id=p_business_id and g.status='active') or exists(select 1 from staff s where s.salon_id=p_business_id and s.is_active and (s.account_user_id=u.id or s.user_id=u.auth_user_id)))
 and (nullif(btrim(p_query),'') is null or u.display_name ilike '%'||btrim(p_query)||'%' or u.id::text=btrim(p_query)
 or (sensitive and (u.email ilike '%'||btrim(p_query)||'%' or u.phone ilike '%'||btrim(p_query)||'%'))
 or exists(select 1 from admin_user_store_grants(u.id) g where g.store_name ilike '%'||btrim(p_query)||'%') or exists(select 1 from staff s join locations l on l.id=s.salon_id where s.is_active and (s.account_user_id=u.id or s.user_id=u.auth_user_id) and l.name ilike '%'||btrim(p_query)||'%')) ), filtered as (
 select * from candidates c where p_role is null
 or (p_role='platform_admin' and exists(select 1 from platform_admin_memberships m where m.user_id=c.id and m.status='active'))
 or (p_role='customer' and cardinality(c.roles)=0)
 or (p_role=any(c.roles))
 ), paged as (
 select * from filtered order by
 case when p_sort='name_asc' then lower(coalesce(display_name,email,id::text)) end asc,
 case when p_sort='last_login_desc' then last_login_at end desc nulls last,
 case when p_sort='created_desc' then created_at end desc,id
 limit p_page_size offset (p_page-1)::bigint*p_page_size
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'display_name',display_name,'first_name',first_name,'last_name',last_name,
 'email',case when sensitive then email else null end,'phone',case when sensitive then phone else null end,
 'status',status,'created_at',created_at,'updated_at',updated_at,'last_login_at',last_login_at,
 'organization_count',jsonb_array_length(businesses),'businesses',businesses,'roles',roles)) from paged),'[]'::jsonb),
 'total',(select count(*) from filtered),'page',p_page,'page_size',p_page_size,'can_read_sensitive',sensitive) into result;
 return result;
end;$function$;

revoke all on function public.search_platform_admin_users_stores(integer,integer,text,text,text,uuid,text) from public,anon;
grant execute on function public.search_platform_admin_users_stores(integer,integer,text,text,text,uuid,text) to authenticated;
create or replace function public.admin_user_export_stores(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.users.read');
 if p_ids is null or cardinality(p_ids) not between 1 and 100 then raise exception 'Select between 1 and 100 users.'; end if;
 return (select coalesce(jsonb_agg(item),'[]') from (select distinct unnest(p_ids) id) selected cross join lateral jsonb_array_elements(search_platform_admin_users_stores(1,1,selected.id::text,null,null,null,'created_desc')->'items') item);
end;$$;
revoke all on function public.admin_user_export_stores(uuid[]) from public,anon;
grant execute on function public.admin_user_export_stores(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;