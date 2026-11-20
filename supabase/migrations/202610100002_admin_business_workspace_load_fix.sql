begin;
create or replace function public.admin_business_workspace_rows() returns setof jsonb
language sql stable security definer set search_path=public as $$

 -- Evaluate the actor permissions once, not for every business and owner.
 with permissions as materialized (
 select platform_admin_has_permission('admin.businesses.read') businesses,
 platform_admin_has_permission('admin.users.read') users,
 platform_admin_has_permission('admin.users.read_sensitive') sensitive
 ), owner_memberships as materialized (
 select l.id location_id,m.user_id from locations l
 join account_memberships m on m.account_id=l.account_id
 join roles r on r.id=m.role_id where m.status='active' and upper(r.code)='OWNER'
 union
 select m.salon_id,m.user_id from salon_memberships m
 join roles r on r.id=m.role_id where m.status='active' and upper(r.code)='OWNER'
 ), owner_rows as materialized (
 select m.location_id,count(*) total,
 jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.display_name,'Unnamed user'),
 'contact',case when permissions.sensitive then coalesce(u.email,u.phone) end)
 order by u.display_name,u.id) items
 from owner_memberships m join users u on u.id=m.user_id cross join permissions
 group by m.location_id
 )
 select jsonb_build_object('id',l.id,'name',l.name,'status',l.status,'created_at',l.created_at,'updated_at',l.updated_at,
 'address_line1',l.address_line1,'address_line2',l.address_line2,'city',l.city,'state',l.state,'postal_code',l.postal_code,'country',l.country,'phone',l.phone,
 'account_id',case when permissions.businesses then l.account_id else null end,
 'owners',case when permissions.users then coalesce(owners.items,'[]'::jsonb) else '[]'::jsonb end,
 'creator',case when permissions.users and creator.id is not null then jsonb_build_object('id',creator.id,'name',coalesce(creator.display_name,'Unnamed user'),'contact',case when permissions.sensitive then coalesce(creator.email,creator.phone) end) end,
 'ownership',case when exists(select 1 from business_claim_requests c where c.salon_id=l.id and c.status='waiting') then 'pending' when coalesce(owners.total,0)>0 then 'claimed' else 'unclaimed' end,
 'verification',coalesce(v.status,'none'),
 'needs_review',exists(select 1 from business_claim_requests c where c.salon_id=l.id and c.status='waiting') or v.status='waiting' or (coalesce(owners.total,0)>0 and (nullif(btrim(l.phone),'') is null or nullif(btrim(l.address_line1),'') is null)),
 'missing_contact',coalesce(owners.total,0)>0 and (nullif(btrim(l.phone),'') is null or nullif(btrim(l.address_line1),'') is null),
 'marked',a.target_id is not null,'followup_reason',a.reason,'due_at',a.due_at,'overdue',a.due_at<now(),'assignee',assignee.display_name)
 from locations l cross join permissions
 left join users creator on creator.id=l.created_by_user_id
 left join platform_admin_attention a on a.target_type='location' and a.target_id=l.id
 left join users assignee on assignee.id=a.assigned_user_id
 left join lateral (select status from salon_verification_requests where salon_id=l.id order by attempt desc limit 1) v on true
 left join owner_rows owners on owners.location_id=l.id;
$$;
revoke all on function public.admin_business_workspace_rows() from public,anon,authenticated;


notify pgrst,'reload schema';
commit;
