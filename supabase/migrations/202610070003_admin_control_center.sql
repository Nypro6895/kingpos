begin;

insert into public.platform_admin_permissions(code, name, description, category) values
 ('admin.users.delete','Schedule account deletion','Schedule or cancel the existing 30-day account deletion lifecycle.','users'),
 ('admin.notifications.read','Read admin notifications','Review targeted in-app notification delivery history.','notifications'),
 ('admin.notifications.send','Send admin notifications','Send targeted in-app notifications with an audit trail.','notifications'),
 ('admin.advertising.manage','Manage advertising','Manage Explore campaigns and announcements.','advertising')
on conflict(code) do nothing;

insert into public.platform_admin_permissions(code,name,description,category)
values('admin.users.memberships.manage','Manage user memberships','Change existing non-owner business and salon memberships with an audit reason.','users') on conflict(code) do nothing;

insert into public.platform_admin_role_permissions(role_id,permission_id)
select r.id,p.id from public.platform_admin_roles r cross join public.platform_admin_permissions p
where (r.slug='platform_owner' and p.code in ('admin.users.delete','admin.notifications.read','admin.notifications.send','admin.advertising.manage','admin.users.memberships.manage'))
 or (r.slug='operations_admin' and p.code in ('admin.notifications.read','admin.notifications.send','admin.advertising.manage','admin.users.memberships.manage'))
 or (r.slug='support_agent' and p.code in ('admin.notifications.read','admin.notifications.send'))
 or (r.slug='auditor' and p.code='admin.notifications.read')
on conflict do nothing;

create table if not exists public.platform_admin_notifications (
 id uuid primary key,
 recipient_user_id uuid not null references public.users(id),
 actor_user_id uuid not null references public.users(id),
 notification_id uuid references public.app_notifications(id) on delete set null,
 title text not null check(length(title) between 1 and 120),
 body text not null check(length(body) between 1 and 2000),
 reason text not null,
 delivery_status text not null check(delivery_status in ('delivered','suppressed')),
 created_at timestamptz not null default now()
);
create index if not exists platform_admin_notifications_recipient_idx on public.platform_admin_notifications(recipient_user_id,created_at desc);
alter table public.platform_admin_notifications enable row level security;
revoke all on public.platform_admin_notifications from public,anon,authenticated;
grant all on public.platform_admin_notifications to service_role;

create or replace function public.search_platform_admin_users_v2(
 p_page integer default 1,p_page_size integer default 25,p_query text default null,p_status text default null,
 p_role text default null,p_business_id uuid default null,p_sort text default 'created_desc'
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare sensitive boolean; result jsonb;
begin
 perform public.platform_admin_require_permission('admin.users.read');
 sensitive:=public.platform_admin_has_permission('admin.users.read_sensitive');
 if p_page<1 or p_page_size not between 1 and 100 or length(coalesce(p_query,''))>100
 or (p_status is not null and p_status not in ('active','inactive','suspended','pending_deletion','deleted'))
 or (p_role is not null and p_role not in ('owner','manager','staff','customer','platform_admin'))
 or p_sort not in ('created_desc','name_asc','last_login_desc') then raise exception 'Invalid user search.'; end if;
 with candidates as (
 select u.*, coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name) order by a.name)
 from accounts a where exists(select 1 from account_memberships m where m.account_id=a.id and m.user_id=u.id and m.status='active')),'[]'::jsonb) as businesses,
 coalesce((select array_agg(distinct lower(r.code)) from account_memberships m join roles r on r.id=m.role_id where m.user_id=u.id and m.status='active'),'{}'::text[]) as roles
 from users u where
 (p_status is null or u.status=p_status)
 and (p_business_id is null or exists(select 1 from account_memberships m where m.user_id=u.id and m.account_id=p_business_id and m.status='active'))
 and (nullif(btrim(p_query),'') is null or u.display_name ilike '%'||btrim(p_query)||'%' or u.id::text=btrim(p_query)
 or (sensitive and (u.email ilike '%'||btrim(p_query)||'%' or u.phone ilike '%'||btrim(p_query)||'%'))
 or exists(select 1 from account_memberships m join accounts a on a.id=m.account_id where m.user_id=u.id and a.name ilike '%'||btrim(p_query)||'%'))
 ), filtered as (
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
end;$$;

create or replace function public.get_platform_admin_user_security(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.platform_admin_require_permission('admin.recovery.read');
 return jsonb_build_object('sessions',coalesce((select jsonb_agg(to_jsonb(s)) from (
 select id,device_label,browser_name,os_name,device_type,created_at,last_seen_at,revoked_at
 from account_login_sessions where user_id=p_user_id order by last_seen_at desc limit 25) s),'[]'::jsonb));
end;$$;

create or replace function public.revoke_platform_admin_user_sessions(p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; amount integer; reason text;
begin
 select * into actor from public.platform_admin_require_permission('admin.recovery.manage');
 reason:=public.platform_admin_normalize_reason(p_reason);
 if p_user_id=actor.actor_user_id then raise exception 'Use account settings to manage your own sessions.'; end if;
 update account_login_sessions set revoked_at=now(),revoked_by_user_id=actor.actor_user_id where user_id=p_user_id and revoked_at is null;
 get diagnostics amount=row_count;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor.actor_user_id,'platform_admin.user_sessions_revoked','platform_admin_user',p_user_id,reason,jsonb_build_object('session_count',amount));
 return jsonb_build_object('revoked',amount);
end;$$;

create or replace function public.admin_set_user_access(p_user_id uuid,p_reason text,p_suspend boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; actor uuid; current_status text;
begin
 perform public.platform_admin_require_permission(case when p_suspend then 'admin.users.suspend' else 'admin.users.restore' end);
 actor:=public.current_public_user_id();
 if actor=p_user_id then raise exception 'You cannot change your own account access here.'; end if;
 select status into current_status from users where id=p_user_id for update;
 if current_status is null then raise exception 'User not found.'; end if;
 if current_status in ('deleted','pending_deletion') then raise exception 'Cancel pending deletion before changing account access.'; end if;
 if p_suspend then
 result:=public.suspend_platform_user(p_user_id,p_reason);
 update account_login_sessions set revoked_at=now(),revoked_by_user_id=actor where user_id=p_user_id and revoked_at is null;
 else
 if current_status<>'suspended' then raise exception 'Only suspended users can be restored.'; end if;
 result:=public.restore_platform_user(p_user_id,p_reason);
 end if;
 return result;
end;$$;

create or replace function public.get_platform_admin_deletion_impact(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare items jsonb; user_status text;
begin
 perform public.platform_admin_require_permission('admin.users.delete');
 select status into user_status from users where id=p_user_id;
 if user_status is null then raise exception 'User not found.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',l.status,
 'last_owner',not public.account_deletion_other_active_owner_exists(l.id,p_user_id)) order by l.name),'[]'::jsonb) into items
 from locations l where exists(select 1 from account_memberships m join roles r on r.id=m.role_id
 where m.account_id=l.account_id and m.user_id=p_user_id and m.status='active' and upper(r.code)='OWNER')
 or exists(select 1 from salon_memberships m join roles r on r.id=m.role_id
 where m.salon_id=l.id and m.user_id=p_user_id and m.status='active' and upper(r.code)='OWNER');
 return jsonb_build_object('salons',items,'status',user_status,'grace_days',30,
 'blocked',exists(select 1 from jsonb_array_elements(items) s where (s->>'last_owner')::boolean
 and public.normalize_salon_lifecycle_status(s->>'status')<>'permanently_closed'));
end;$$;

create or replace function public.schedule_platform_admin_user_deletion(p_user_id uuid,p_reason text,p_confirmation text,p_backup_acknowledged boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; target users%rowtype; impact jsonb; owner_membership uuid; salon record; reason text;
begin
 select * into actor from public.platform_admin_require_permission('admin.users.delete');
 reason:=public.platform_admin_normalize_reason(p_reason);
 if p_user_id=actor.actor_user_id then raise exception 'Use account settings to request your own deletion.'; end if;
 if p_confirmation is distinct from 'DELETE' or p_backup_acknowledged is not true then raise exception 'Type DELETE and acknowledge the retention policy before scheduling deletion.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
 select * into target from users where id=p_user_id for update;
 if target.id is null then raise exception 'User not found.'; end if;
 if target.status='pending_deletion' then return jsonb_build_object('status',target.status,'deletion_scheduled_for',target.deletion_scheduled_for); end if;
 if target.status<>'active' then raise exception 'Only active accounts can enter the deletion grace period. Restore access separately before scheduling deletion.'; end if;
 for salon in select l.id from locations l where exists(select 1 from account_memberships m join roles r on r.id=m.role_id where m.account_id=l.account_id and m.user_id=p_user_id and m.status='active' and upper(r.code)='OWNER')
 or exists(select 1 from salon_memberships m join roles r on r.id=m.role_id where m.salon_id=l.id and m.user_id=p_user_id and m.status='active' and upper(r.code)='OWNER') order by l.id loop
 perform pg_advisory_xact_lock(hashtextextended('salon-lifecycle:'||salon.id::text,0));
 end loop;
 impact:=public.get_platform_admin_deletion_impact(p_user_id);
 if (impact->>'blocked')::boolean then raise exception 'Transfer ownership or close last-owner salons through the salon lifecycle before deleting this account.'; end if;
 select m.id into owner_membership from platform_admin_memberships m join platform_admin_roles r on r.id=m.role_id where m.user_id=p_user_id and m.status='active' and r.slug='platform_owner';
 if owner_membership is not null then perform public.platform_admin_assert_not_last_owner(owner_membership,'platform_owner','suspended'); end if;
 update users set status='pending_deletion',deletion_requested_at=now(),deletion_scheduled_for=now()+interval '30 days',deleted_at=null,anonymized_at=null where id=p_user_id;
 insert into account_lifecycle_events(user_id,actor_user_id,event_type,metadata) values(p_user_id,actor.actor_user_id,'deletion_requested',jsonb_build_object('source','platform_admin','reason',reason,'scheduled_for',now()+interval '30 days','backup_acknowledged',true,'previous_status',target.status));
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,before_data,after_data)
 values(actor.actor_user_id,'platform_admin.user_deletion_scheduled','platform_admin_user',p_user_id,reason,jsonb_build_object('status',target.status),jsonb_build_object('status','pending_deletion','deletion_scheduled_for',now()+interval '30 days'));
 return jsonb_build_object('status','pending_deletion','deletion_scheduled_for',now()+interval '30 days');
end;$$;

create or replace function public.cancel_platform_admin_user_deletion(p_user_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; target users%rowtype; reason text; prior_status text;
begin
 select * into actor from public.platform_admin_require_permission('admin.users.delete');
 reason:=public.platform_admin_normalize_reason(p_reason);
 perform pg_advisory_xact_lock(hashtextextended('account-deletion:'||p_user_id::text,0));
 select * into target from users where id=p_user_id for update;
 if target.status is distinct from 'pending_deletion' or target.deletion_finalization_started_at is not null then raise exception 'This deletion can no longer be cancelled.'; end if;
 prior_status:='active';
 prior_status:=case when prior_status in ('active','inactive','suspended') then prior_status else 'active' end;
 update users set status=prior_status,deletion_requested_at=null,deletion_scheduled_for=null where id=p_user_id;
 insert into account_lifecycle_events(user_id,actor_user_id,event_type,metadata) values(p_user_id,actor.actor_user_id,'deletion_cancelled',jsonb_build_object('source','platform_admin','reason',reason));
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,before_data,after_data)
 values(actor.actor_user_id,'platform_admin.user_deletion_cancelled','platform_admin_user',p_user_id,reason,jsonb_build_object('status','pending_deletion'),jsonb_build_object('status',prior_status));
 return jsonb_build_object('status',prior_status);
end;$$;

create or replace function public.send_platform_admin_notification(p_user_id uuid,p_title text,p_body text,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; sent_id uuid; previous platform_admin_notifications%rowtype; reason text;
begin
 select * into actor from public.platform_admin_require_permission('admin.notifications.send');
 reason:=public.platform_admin_normalize_reason(p_reason);
 if p_request_id is null or length(btrim(coalesce(p_title,''))) not between 1 and 120 or length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Title and message are required and must fit the character limits.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('admin-notification:'||p_request_id::text,0));
 select * into previous from platform_admin_notifications where id=p_request_id;
 if previous.id is not null then
 if previous.actor_user_id<>actor.actor_user_id or previous.recipient_user_id<>p_user_id or previous.title<>btrim(p_title) or previous.body<>btrim(p_body) then raise exception 'This request has already been used for another notification.'; end if;
 return jsonb_build_object('status',previous.delivery_status,'id',previous.id);
 end if;
 if not exists(select 1 from users where id=p_user_id and status in ('active','pending_deletion')) then raise exception 'Only active or pending-deletion accounts can receive notifications.'; end if;
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(p_user_id,'customer','admin_message',btrim(p_title),btrim(p_body),'/notifications','admin-message:'||p_request_id::text) returning id into sent_id;
 insert into platform_admin_notifications(id,recipient_user_id,actor_user_id,notification_id,title,body,reason,delivery_status)
 values(p_request_id,p_user_id,actor.actor_user_id,sent_id,btrim(p_title),btrim(p_body),reason,case when sent_id is null then 'suppressed' else 'delivered' end);
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(actor.actor_user_id,'platform_admin.notification_sent','platform_admin_user',p_user_id,reason,jsonb_build_object('notification_id',p_request_id,'delivery_status',case when sent_id is null then 'suppressed' else 'delivered' end));
 return jsonb_build_object('id',p_request_id,'status',case when sent_id is null then 'suppressed' else 'delivered' end);
end;$$;

create or replace function public.list_platform_admin_notifications(p_page integer default 1,p_page_size integer default 25,p_user_id uuid default null,p_query text default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform public.platform_admin_require_permission('admin.notifications.read');
 if p_page<1 or p_page_size not between 1 and 100 or length(coalesce(p_query,''))>100 then raise exception 'Invalid notification search.'; end if;
 with filtered as (select n.*,u.display_name as recipient_name,a.display_name as sender_name,app.read_at from platform_admin_notifications n join users u on u.id=n.recipient_user_id join users a on a.id=n.actor_user_id left join app_notifications app on app.id=n.notification_id
 where (p_user_id is null or n.recipient_user_id=p_user_id) and (nullif(btrim(p_query),'') is null or n.title ilike '%'||btrim(p_query)||'%' or u.display_name ilike '%'||btrim(p_query)||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(rows)) from (select * from filtered order by created_at desc,id limit p_page_size offset (p_page-1)::bigint*p_page_size) rows),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'page_size',p_page_size) into result;
 return result;
end;$$;

create or replace function public.search_platform_admin_audit_logs_v2(p_page integer default 1,p_page_size integer default 25,p_query text default null,p_action text default null,p_target_type text default null,p_target_id uuid default null,p_actor_id uuid default null,p_from timestamptz default null,p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; sensitive boolean;
begin
 perform public.platform_admin_require_permission('admin.audit.read');
 sensitive:=public.platform_admin_has_permission('admin.users.read_sensitive');
 if p_page<1 or p_page_size not between 1 and 100 or length(coalesce(p_query,''))>100 or (p_from is not null and p_to is not null and p_from>=p_to) then raise exception 'Invalid audit search.'; end if;
 with filtered as (select l.*,jsonb_build_object('id',u.id,'display_name',u.display_name) as actor from platform_admin_audit_logs l left join users u on u.id=l.actor_user_id where
 (p_action is null or l.action=p_action) and (p_target_type is null or l.target_type=p_target_type)
 and (p_target_id is null or l.target_id=p_target_id) and (p_actor_id is null or l.actor_user_id=p_actor_id)
 and (p_from is null or l.created_at>=p_from) and (p_to is null or l.created_at<p_to)
 and (nullif(btrim(p_query),'') is null or l.action ilike '%'||btrim(p_query)||'%' or l.reason ilike '%'||btrim(p_query)||'%' or u.display_name ilike '%'||btrim(p_query)||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(rows)||jsonb_build_object('before_data',case when sensitive then before_data else before_data-'email'-'phone'-'auth_user_id' end,'after_data',case when sensitive then after_data else after_data-'email'-'phone'-'auth_user_id' end)) from (select * from filtered order by created_at desc,id limit p_page_size offset (p_page-1)::bigint*p_page_size) rows),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'page_size',p_page_size) into result;
 return result;
end;$$;

revoke all on function public.search_platform_admin_users_v2(integer,integer,text,text,text,uuid,text), public.get_platform_admin_user_security(uuid), public.revoke_platform_admin_user_sessions(uuid,text), public.admin_set_user_access(uuid,text,boolean), public.get_platform_admin_deletion_impact(uuid), public.schedule_platform_admin_user_deletion(uuid,text,text,boolean), public.cancel_platform_admin_user_deletion(uuid,text), public.send_platform_admin_notification(uuid,text,text,text,uuid), public.list_platform_admin_notifications(integer,integer,uuid,text), public.search_platform_admin_audit_logs_v2(integer,integer,text,text,text,uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.search_platform_admin_users_v2(integer,integer,text,text,text,uuid,text), public.get_platform_admin_user_security(uuid), public.revoke_platform_admin_user_sessions(uuid,text), public.admin_set_user_access(uuid,text,boolean), public.get_platform_admin_deletion_impact(uuid), public.schedule_platform_admin_user_deletion(uuid,text,text,boolean), public.cancel_platform_admin_user_deletion(uuid,text), public.send_platform_admin_notification(uuid,text,text,text,uuid), public.list_platform_admin_notifications(integer,integer,uuid,text), public.search_platform_admin_audit_logs_v2(integer,integer,text,text,text,uuid,uuid,timestamptz,timestamptz) to authenticated;
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
      'updated_at', user_row.updated_at,
      'deletion_requested_at', user_row.deletion_requested_at,
      'deletion_scheduled_for', user_row.deletion_scheduled_for,
      'can_read_sensitive', can_read_sensitive
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
    'salon_memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'salon_id',l.id,'salon_name',l.name,'role',r.code,'status',m.status,'created_at',m.created_at) order by l.name)
      from salon_memberships m join locations l on l.id=m.salon_id left join roles r on r.id=m.role_id where m.user_id=user_row.id),'[]'::jsonb),
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
      from (select * from public.platform_reports where subject_user_id = user_row.id order by created_at desc, id limit 20) reports
    ), '[]'::jsonb)
  );

  return result;
end;
$$;



create or replace function public.get_platform_admin_case_assignees()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not public.platform_admin_has_permission('admin.reports.assign') and not public.platform_admin_has_permission('admin.reports.create') then raise exception 'Permission denied.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',u.display_name,'role',r.name) order by u.display_name,m.id) from platform_admin_memberships m join users u on u.id=m.user_id join platform_admin_roles r on r.id=m.role_id where m.status='active' and u.status='active'),'[]'::jsonb);
end;$$;
revoke all on function public.get_platform_admin_case_assignees() from public,anon;
grant execute on function public.get_platform_admin_case_assignees() to authenticated;

create or replace function public.get_platform_admin_work_queues()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform public.platform_admin_require_permission('admin.dashboard.read');
 return jsonb_build_object(
 'claims',case when public.platform_admin_has_permission('admin.locations.read') then (select count(*) from business_claim_requests where status='waiting') else null end,
 'verification',case when public.platform_admin_has_permission('admin.locations.read') then (select count(*) from salon_verification_requests where status='waiting') else null end,
 'cases',case when public.platform_admin_has_permission('admin.reports.read') then (select count(*) from platform_reports where status not in ('closed','resolved')) else null end,
 'pending_deletion',case when public.platform_admin_has_permission('admin.users.read') then (select count(*) from users where status='pending_deletion') else null end);
end;$$;
revoke all on function public.get_platform_admin_work_queues() from public,anon;
grant execute on function public.get_platform_admin_work_queues() to authenticated;

create or replace function public.update_platform_admin_user_profile_v2(p_user_id uuid,p_display_name text,p_first_name text,p_last_name text,p_phone text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare saved_phone text; target_status text;
begin
 perform public.platform_admin_require_permission('admin.users.update');
 if length(coalesce(p_display_name,''))>120 or length(coalesce(p_first_name,''))>80 or length(coalesce(p_last_name,''))>80 or length(coalesce(p_phone,''))>40 then raise exception 'Profile fields exceed the allowed length.'; end if;
 select phone,status into saved_phone,target_status from users where id=p_user_id for update;
 if target_status is null then raise exception 'User not found.'; end if;
 if target_status='deleted' then raise exception 'Deleted user profiles cannot be changed.'; end if;
 return public.update_platform_admin_user_profile(p_user_id,p_display_name,p_first_name,p_last_name,case when public.platform_admin_has_permission('admin.users.read_sensitive') then p_phone else saved_phone end,p_reason);
end;$$;
revoke all on function public.update_platform_admin_user_profile_v2(uuid,text,text,text,text,text) from public,anon;
grant execute on function public.update_platform_admin_user_profile_v2(uuid,text,text,text,text,text) to authenticated;


create or replace function public.update_platform_admin_user_membership(p_user_id uuid,p_membership_id uuid,p_scope text,p_role text,p_status text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; business uuid; old_role text; new_role uuid; old_status text; target_status text; reason text;
begin
 select * into actor from public.platform_admin_require_permission('admin.users.memberships.manage');
 reason:=public.platform_admin_normalize_reason(p_reason);
 if p_user_id=actor.actor_user_id then raise exception 'You cannot change your own memberships here.'; end if;
 if p_scope not in ('business','salon') or p_role not in ('MANAGER','STAFF') or p_status not in ('active','inactive','suspended') then raise exception 'Invalid membership change.'; end if;
 select status into target_status from users where id=p_user_id for update;
 if target_status is null or target_status in ('deleted','pending_deletion') then raise exception 'This account cannot change memberships.'; end if;
 if p_scope='business' then
 select m.account_id,r.code,m.status into business,old_role,old_status from account_memberships m left join roles r on r.id=m.role_id where m.id=p_membership_id and m.user_id=p_user_id for update of m;
 else
 select m.account_id,r.code,m.status into business,old_role,old_status from salon_memberships m left join roles r on r.id=m.role_id where m.id=p_membership_id and m.user_id=p_user_id for update of m;
 end if;
 if business is null then raise exception 'Membership not found.'; end if;
 if upper(coalesce(old_role,''))='OWNER' then raise exception 'Use the ownership transfer workflow to change an owner membership.'; end if;
 select id into new_role from roles where account_id=business and code=p_role;
 if new_role is null then raise exception 'Role not found for this business.'; end if;
 if p_scope='business' then update account_memberships set role_id=new_role,status=p_status where id=p_membership_id;
 else update salon_memberships set role_id=new_role,status=p_status where id=p_membership_id; end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,before_data,after_data,metadata)
 values(actor.actor_user_id,'platform_admin.user_membership_updated','platform_admin_user',p_user_id,reason,jsonb_build_object('role',old_role,'status',old_status),jsonb_build_object('role',p_role,'status',p_status),jsonb_build_object('membership_id',p_membership_id,'scope',p_scope));
 return jsonb_build_object('status',p_status);
end;$$;
revoke all on function public.update_platform_admin_user_membership(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.update_platform_admin_user_membership(uuid,uuid,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
