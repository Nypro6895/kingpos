begin;
create table if not exists public.platform_admin_business_review_assignments (
 kind text not null check(kind in ('claims','verification')),
 request_id uuid not null,
 assigned_user_id uuid not null references public.users(id),
 created_at timestamptz not null default now(),
 primary key(kind,request_id)
);
alter table public.platform_admin_business_review_assignments enable row level security;
revoke all on public.platform_admin_business_review_assignments from anon,authenticated;

-- Private helper: physical businesses retain both inherited and direct ownership scopes.
create or replace function public.admin_business_workspace_rows() returns setof jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('id',l.id,'name',l.name,'status',l.status,'created_at',l.created_at,'updated_at',l.updated_at,
 'address_line1',l.address_line1,'address_line2',l.address_line2,'city',l.city,'state',l.state,'postal_code',l.postal_code,'country',l.country,'phone',l.phone,
 'account_id',case when platform_admin_has_permission('admin.businesses.read') then l.account_id else null end,
 'owners',case when platform_admin_has_permission('admin.users.read') then owners.items else '[]'::jsonb end,
 'creator',case when platform_admin_has_permission('admin.users.read') and creator.id is not null then jsonb_build_object('id',creator.id,'name',coalesce(creator.display_name,'Unnamed user'),'contact',case when platform_admin_has_permission('admin.users.read_sensitive') then coalesce(creator.email,creator.phone) end) end,
 'ownership',case when exists(select 1 from business_claim_requests c where c.salon_id=l.id and c.status='waiting') then 'pending' when owners.total>0 then 'claimed' else 'unclaimed' end,
 'verification',coalesce(v.status,'none'),
 'needs_review',exists(select 1 from business_claim_requests c where c.salon_id=l.id and c.status='waiting') or v.status='waiting' or (owners.total>0 and (nullif(btrim(l.phone),'') is null or nullif(btrim(l.address_line1),'') is null)),
 'missing_contact',owners.total>0 and (nullif(btrim(l.phone),'') is null or nullif(btrim(l.address_line1),'') is null),
 'marked',a.target_id is not null,'followup_reason',a.reason,'due_at',a.due_at,'overdue',a.due_at<now(),'assignee',assignee.display_name)
 from locations l
 left join users creator on creator.id=l.created_by_user_id
 left join platform_admin_attention a on a.target_type='location' and a.target_id=l.id
 left join users assignee on assignee.id=a.assigned_user_id
 left join lateral (select status from salon_verification_requests where salon_id=l.id order by attempt desc limit 1) v on true
 cross join lateral (
 select count(*) total,coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.display_name,'Unnamed user'),'contact',case when platform_admin_has_permission('admin.users.read_sensitive') then coalesce(u.email,u.phone) end) order by u.display_name,u.id),'[]'::jsonb) items
 from users u where exists(select 1 from account_memberships m join roles r on r.id=m.role_id where m.account_id=l.account_id and m.user_id=u.id and m.status='active' and upper(r.code)='OWNER')
 or exists(select 1 from salon_memberships m join roles r on r.id=m.role_id where m.salon_id=l.id and m.user_id=u.id and m.status='active' and upper(r.code)='OWNER')
 ) owners;
$$;
revoke all on function public.admin_business_workspace_rows() from public,anon,authenticated;

create or replace function public.search_platform_admin_business_workspace(p_page integer default 1,p_query text default '',p_tab text default 'all',p_status text default '',p_ownership text default '',p_city text default '',p_sort text default 'created_desc') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb; day_start timestamptz; day_end timestamptz;
begin
 perform platform_admin_require_permission('admin.locations.read');
 if p_page is null or p_page<1 or p_page>100000 or p_tab is null or p_tab not in ('all','new','unclaimed','review','followup') or p_status is null or p_status not in ('','active','inactive') or p_ownership is null or p_ownership not in ('','claimed','unclaimed','pending') or p_sort is null or p_sort not in ('created_desc','name_asc','updated_desc') or length(coalesce(p_query,''))>100 or length(coalesce(p_city,''))>100 then raise exception 'Invalid business filters.'; end if;
 day_start:=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
 day_end:=(date_trunc('day',now() at time zone 'America/Chicago')+interval '1 day') at time zone 'America/Chicago';
 with source as materialized(select row from admin_business_workspace_rows() row), filtered as (
 select row from source where (p_status='' or row->>'status'=p_status) and (p_ownership='' or row->>'ownership'=p_ownership) and (coalesce(p_city,'')='' or row->>'city'=p_city)
 and (coalesce(btrim(p_query),'')='' or concat_ws(' ',row->>'name',row->>'address_line1',row->>'city',row->>'state',row->>'phone',row->'owners') ilike '%'||btrim(p_query)||'%')
 and (p_tab='all' or p_tab='new' and (row->>'created_at')::timestamptz>=day_start and (row->>'created_at')::timestamptz<day_end or p_tab='unclaimed' and row->>'ownership'='unclaimed' or p_tab='review' and coalesce((row->>'needs_review')::boolean,false) or p_tab='followup' and (row->>'marked')::boolean)
 ), paged as (select row from filtered order by case when p_sort='name_asc' then lower(row->>'name') end,case when p_sort='created_desc' then (row->>'created_at')::timestamptz end desc,case when p_sort='updated_desc' then (row->>'updated_at')::timestamptz end desc,row->>'id' limit 25 offset (p_page-1)*25),
 tasks as (
 select c.id request_id,c.salon_id location_id,l.name,'claims' kind,'Ownership claim' label,c.created_at,a.assigned_user_id,u.display_name assignee from business_claim_requests c join locations l on l.id=c.salon_id left join platform_admin_business_review_assignments a on a.kind='claims' and a.request_id=c.id left join users u on u.id=a.assigned_user_id where c.status='waiting'
 union all select c.id,c.salon_id,l.name,'verification','Verification request',c.created_at,a.assigned_user_id,u.display_name from salon_verification_requests c join locations l on l.id=c.salon_id left join platform_admin_business_review_assignments a on a.kind='verification' and a.request_id=c.id left join users u on u.id=a.assigned_user_id where c.status='waiting' and not exists(select 1 from salon_verification_requests newer where newer.salon_id=c.salon_id and newer.attempt>c.attempt)
 ), task_page as (select * from tasks order by created_at,request_id limit 3), followups as (select row from source where (row->>'marked')::boolean and (row->>'due_at' is null or (row->>'due_at')::timestamptz<day_end) order by (row->>'due_at')::timestamptz nulls last,row->>'id' limit 3)
 select jsonb_build_object('items',coalesce((select jsonb_agg(row) from paged),'[]'),'total',(select count(*) from filtered),'page',p_page,
 'counts',(select jsonb_build_object('all',count(*),'active',count(*) filter(where row->>'status'='active'),'new',count(*) filter(where (row->>'created_at')::timestamptz>=day_start and (row->>'created_at')::timestamptz<day_end),'unclaimed',count(*) filter(where row->>'ownership'='unclaimed'),'review',count(*) filter(where coalesce((row->>'needs_review')::boolean,false)),'followup',count(*) filter(where (row->>'marked')::boolean)) from source),
 'cities',coalesce((select jsonb_agg(city order by city) from (select distinct row->>'city' city from source where nullif(row->>'city','') is not null) cities),'[]'),
 'reviews',coalesce((select jsonb_agg(to_jsonb(t)) from task_page t),'[]'),'review_total',(select count(*) from tasks),'missing_contacts',coalesce((select jsonb_agg(row) from (select row from source where (row->>'missing_contact')::boolean order by row->>'created_at',row->>'id' limit 3) missing),'[]'),'missing_contact_total',(select count(*) from source where (row->>'missing_contact')::boolean),'followup_due_total',(select count(*) from source where (row->>'marked')::boolean and (row->>'due_at' is null or (row->>'due_at')::timestamptz<day_end)),'followups',coalesce((select jsonb_agg(row) from followups),'[]')) into result;
 return result;
end;$$;

create or replace function public.get_platform_admin_business_workspace_record(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform platform_admin_require_permission('admin.locations.read');
 select row into result from admin_business_workspace_rows() row where row->>'id'=p_id::text;
 if result is null then raise exception 'Business not found.'; end if;
 return result;
end;$$;

create or replace function public.take_platform_admin_business_review(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor record; assigned uuid; location_id uuid;
begin
 select * into actor from platform_admin_require_permission('admin.locations.update_status');
 if p_kind is null or p_kind not in ('claims','verification') or p_id is null then raise exception 'Invalid review.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('business-review:'||p_kind||':'||p_id,0));
 if p_kind='claims' then select salon_id into location_id from business_claim_requests where id=p_id and status='waiting' for update;
 else select salon_id into location_id from salon_verification_requests c where id=p_id and status='waiting' and not exists(select 1 from salon_verification_requests newer where newer.salon_id=c.salon_id and newer.attempt>c.attempt) for update; end if;
 if location_id is null then raise exception 'This request is no longer waiting for review. Refresh the page.'; end if;
 select assigned_user_id into assigned from platform_admin_business_review_assignments where kind=p_kind and request_id=p_id;
 if assigned is not null and assigned<>actor.actor_user_id then raise exception 'Another administrator has already taken this request.'; end if;
 if assigned is null then
 insert into platform_admin_business_review_assignments(kind,request_id,assigned_user_id) values(p_kind,p_id,actor.actor_user_id);
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,after_data) values(actor.actor_user_id,'business.review_taken','location',location_id,'Review assigned to current administrator',jsonb_build_object('kind',p_kind,'request_id',p_id));
 end if;
 return jsonb_build_object('assigned_user_id',actor.actor_user_id);
end;$$;
create or replace function public.bulk_platform_admin_business_followup(p_ids uuid[],p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 perform platform_admin_require_permission('admin.locations.read');
 perform platform_admin_require_permission('admin.locations.update_status');
 if p_ids is null or cardinality(p_ids) not between 1 and 25 or exists(select 1 from unnest(p_ids) as selected(target_id) where selected.target_id is null or not exists(select 1 from locations l where l.id=selected.target_id)) then raise exception 'Select 1–25 existing businesses.'; end if;
 for target in select distinct selected.target_id from unnest(p_ids) as selected(target_id) order by selected.target_id loop
 perform set_platform_admin_attention('location',target,true,p_reason);
 end loop;
 return jsonb_build_object('ok',true);
end;$$;
create or replace function public.set_platform_admin_business_workspace_status(p_id uuid,p_status text,p_expected_status text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare current_status text;
begin
 perform platform_admin_require_permission('admin.locations.read');
 perform platform_admin_require_permission('admin.locations.update_status');
 select status into current_status from locations where id=p_id for update;
 if current_status is null then raise exception 'Business not found.'; end if;
 if current_status is distinct from p_expected_status then raise exception 'Business status changed. Refresh before retrying.'; end if;
 return update_platform_admin_location_status(p_id,p_status,p_reason);
end;$$;
revoke all on function public.search_platform_admin_business_workspace(integer,text,text,text,text,text,text),public.get_platform_admin_business_workspace_record(uuid),public.take_platform_admin_business_review(text,uuid),public.bulk_platform_admin_business_followup(uuid[],text),public.set_platform_admin_business_workspace_status(uuid,text,text,text) from public,anon;
grant execute on function public.search_platform_admin_business_workspace(integer,text,text,text,text,text,text),public.get_platform_admin_business_workspace_record(uuid),public.take_platform_admin_business_review(text,uuid),public.bulk_platform_admin_business_followup(uuid[],text),public.set_platform_admin_business_workspace_status(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
