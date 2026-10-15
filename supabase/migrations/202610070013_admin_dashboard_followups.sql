begin;
alter table public.platform_admin_attention add column if not exists assigned_user_id uuid references public.users(id) on delete set null;
alter table public.platform_admin_attention add column if not exists due_at timestamptz;
alter table public.platform_admin_attention add column if not exists updated_at timestamptz not null default now();
create index if not exists platform_admin_attention_due_idx on public.platform_admin_attention(due_at,created_at);
create or replace function public.touch_platform_admin_attention() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at:=clock_timestamp(); return new; end;$$;
drop trigger if exists platform_admin_attention_touch on public.platform_admin_attention;
create trigger platform_admin_attention_touch before update on public.platform_admin_attention for each row execute function public.touch_platform_admin_attention();
create or replace function public.get_platform_admin_followup(p_kind text,p_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if p_kind is null or p_kind not in ('user','location') then raise exception 'Invalid follow-up target.'; end if;
 perform platform_admin_require_permission(case when p_kind='user' then 'admin.users.read' else 'admin.locations.read' end);
 return (select to_jsonb(a)||jsonb_build_object('assignee',u.display_name) from platform_admin_attention a left join users u on u.id=a.assigned_user_id where a.target_type=p_kind and a.target_id=p_id);
end;$$;
create or replace function public.get_platform_admin_followup_assignees() returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.dashboard.read');
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',coalesce(u.display_name,'Admin')) order by u.display_name,u.id)
 from platform_admin_memberships m join users u on u.id=m.user_id where m.status='active' and u.status='active'),'[]'::jsonb);
end;$$;
create or replace function public.save_platform_admin_followup(p_kind text,p_id uuid,p_reason text,p_assignee uuid default null,p_due_at timestamptz default null,p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; prior jsonb; clean_reason text; current_updated timestamptz;
begin
 if p_kind is null or p_kind not in ('user','location') then raise exception 'Invalid follow-up target.'; end if;
 select * into actor from platform_admin_require_permission(case when p_kind='user' then 'admin.users.update' else 'admin.locations.update_status' end);
 clean_reason:=platform_admin_normalize_reason(p_reason);
 if length(clean_reason)>1000 then raise exception 'Reason must be at most 1000 characters.'; end if;
 if p_due_at is not null and (p_due_at<now()-interval '10 years' or p_due_at>now()+interval '10 years') then raise exception 'Invalid follow-up date.'; end if;
 if p_assignee is not null and not exists(select 1 from platform_admin_memberships m join users u on u.id=m.user_id where m.user_id=p_assignee and m.status='active' and u.status='active') then raise exception 'Invalid assignee.'; end if;
 if (p_kind='user' and not exists(select 1 from users where id=p_id)) or (p_kind='location' and not exists(select 1 from locations where id=p_id)) then raise exception 'Record not found.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('admin-attention:'||p_kind||':'||p_id::text,0));
 select to_jsonb(a),a.updated_at into prior,current_updated from platform_admin_attention a where a.target_type=p_kind and a.target_id=p_id;
 if p_expected_updated_at is not null and current_updated is distinct from p_expected_updated_at then raise exception 'This follow-up changed. Refresh before saving.'; end if;
 insert into platform_admin_attention(target_type,target_id,reason,marked_by_user_id,assigned_user_id,due_at)
 values(p_kind,p_id,clean_reason,actor.actor_user_id,p_assignee,p_due_at)
 on conflict(target_type,target_id) do update set reason=excluded.reason,assigned_user_id=excluded.assigned_user_id,due_at=excluded.due_at,updated_at=clock_timestamp();
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,before_data,after_data)
 values(actor.actor_user_id,'followup.saved',p_kind,p_id,clean_reason,prior,jsonb_build_object('reason',clean_reason,'assigned_user_id',p_assignee,'due_at',p_due_at));
 return public.get_platform_admin_followup(p_kind,p_id);
end;$$;
create or replace function public.get_platform_admin_dashboard_followups() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb; day_end timestamptz;
begin
 perform platform_admin_require_permission('admin.dashboard.read');
 day_end:=(date_trunc('day',now() at time zone 'America/Chicago')+interval '1 day') at time zone 'America/Chicago';
 with visible as (select a.*,coalesce(u.display_name,l.name,'Unnamed record') as name,assignee.display_name as assignee,
 coalesce(u.status,l.status) as status from platform_admin_attention a
 left join users u on a.target_type='user' and u.id=a.target_id left join locations l on a.target_type='location' and l.id=a.target_id
 left join users assignee on assignee.id=a.assigned_user_id
 where (a.target_type='user' and platform_admin_has_permission('admin.users.read')) or (a.target_type='location' and platform_admin_has_permission('admin.locations.read'))),
 due as (select * from visible where due_at<day_end or due_at is null), paged as (select * from due order by due_at nulls last,created_at,target_id limit 3)
 select jsonb_build_object('total',(select count(*) from visible),'due_today',(select count(*) from due where due_at is not null),'overdue',(select count(*) from due where due_at<now()),
 'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.due_at nulls last,p.created_at,p.target_id) from paged p),'[]'::jsonb)) into result;
 return result;
end;$$;
create or replace function public.get_platform_admin_delivery_health() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb:='{}';
begin
 perform platform_admin_require_permission('admin.dashboard.read');
 if platform_admin_has_permission('admin.inbox.read') then
 result:=result||jsonb_build_object('email_failed',(select count(*) from support_inbox_messages where kind='email_reply' and delivery_status='failed'),
 'email_uncertain',(select count(*) from support_inbox_messages where kind='email_reply' and delivery_status in ('sending','unknown'))); end if;
 if platform_admin_has_permission('admin.notifications.read') then
 result:=result||jsonb_build_object('notifications_delivered_today',(select count(*) from platform_admin_notifications where delivery_status='delivered' and created_at>=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago'),
 'notifications_suppressed_today',(select count(*) from platform_admin_notifications where delivery_status='suppressed' and created_at>=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago')); end if;
 return result;
end;$$;
revoke all on function public.get_platform_admin_followup(text,uuid),public.get_platform_admin_followup_assignees(),public.save_platform_admin_followup(text,uuid,text,uuid,timestamptz,timestamptz),public.get_platform_admin_dashboard_followups(),public.get_platform_admin_delivery_health() from public,anon;
grant execute on function public.get_platform_admin_followup(text,uuid),public.get_platform_admin_followup_assignees(),public.save_platform_admin_followup(text,uuid,text,uuid,timestamptz,timestamptz),public.get_platform_admin_dashboard_followups(),public.get_platform_admin_delivery_health() to authenticated;
notify pgrst,'reload schema';
commit;
