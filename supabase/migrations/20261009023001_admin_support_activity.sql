begin;
-- A normal support reply does not create an information request. Explicit review
-- actions still set action_required, while customer replies requeue the request.
do $$declare definition text; begin
 definition:=pg_get_functiondef('public.send_support_case_message(uuid,text,boolean)'::regprocedure);
 if strpos(definition,'case when kind=''user'' then ''under_review'' else ''action_required'' end')=0 then raise exception 'Unexpected support message status implementation';end if;
 definition:=replace(definition,'case when kind=''user'' then ''under_review'' else ''action_required'' end','case when kind=''user'' or p_reopen then ''under_review'' else r.status end');
 execute definition;
end $$;
-- Evidence identifiers are one object inside this case. Reject path traversal,
-- encoded separators and references to another case before privileged URL signing.
alter table public.support_case_attachments add constraint support_evidence_case_path
 check(split_part(object_path,'/',1)=report_id::text and object_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,240}$') not valid;
alter table public.support_case_attachments validate constraint support_evidence_case_path;
create table public.platform_admin_activity_events (
 id uuid primary key default gen_random_uuid(), report_id uuid references platform_reports(id) on delete cascade,
 kind text not null, title text not null, href text not null, required_permission text not null default 'admin.reports.read',
 event_key text not null unique, created_at timestamptz not null default now()
);
create index on public.platform_admin_activity_events(created_at desc,id);
create table public.platform_admin_activity_reads (
 event_id uuid references platform_admin_activity_events(id) on delete cascade,
 user_id uuid references users(id) on delete cascade, read_at timestamptz not null default now(), primary key(event_id,user_id)
);
alter table public.platform_admin_activity_events enable row level security;
alter table public.platform_admin_activity_reads enable row level security;
revoke all on public.platform_admin_activity_events,public.platform_admin_activity_reads from public,anon,authenticated;

create function public.admin_activity_can_read(p_report uuid,p_permission text) returns boolean
language sql stable security definer set search_path=public as $$
 select platform_admin_has_permission('admin.access') and platform_admin_has_permission(
 case when exists(select 1 from review_support_links where report_id=p_report and kind='claim') then 'admin.locations.read' else p_permission end);
$$;
revoke all on function public.admin_activity_can_read(uuid,text) from public,anon,authenticated;

create function public.capture_admin_support_activity() returns trigger
language plpgsql security definer set search_path=public as $$
declare r platform_reports; event_kind text; event_title text;
begin
 if tg_table_name='platform_reports' then
  r:=new;event_kind:='new_request';event_title:='New request: '||left(r.summary,160);
 elsif tg_table_name='support_case_messages' then
  if new.sender<>'user' or new.message_kind<>'message' then return new; end if;
  select * into r from platform_reports where id=new.report_id;
  if (select count(*) from support_case_messages where report_id=r.id)=1 then return new; end if;
  event_kind:='user_reply';event_title:='User replied: '||left(r.summary,160);
 elsif tg_table_name='support_case_attachments' then
  select * into r from platform_reports where id=new.report_id;
  if new.actor_user_id is not null and new.actor_user_id is distinct from r.reporter_user_id then return new; end if;
  event_kind:='user_attachment';event_title:='New evidence: '||left(r.summary,160);
  -- Evidence answers an information request; moderation itself is not changed.
  update platform_reports set status='under_review',updated_at=now() where id=r.id and status='action_required'
   and exists(select 1 from review_support_links where report_id=r.id and kind='post_report');
 end if;
 insert into platform_admin_activity_events(report_id,kind,title,href,event_key)
 values(r.id,event_kind,event_title,'/admin/reports/'||r.id,tg_table_name||':'||new.id) on conflict(event_key) do nothing;
 return new;
end $$;
revoke all on function public.capture_admin_support_activity() from public,anon,authenticated;
create trigger capture_admin_request after insert on platform_reports for each row execute function capture_admin_support_activity();
create trigger capture_admin_user_reply after insert on support_case_messages for each row execute function capture_admin_support_activity();
create trigger capture_admin_user_attachment after insert on support_case_attachments for each row execute function capture_admin_support_activity();

create function public.deduplicate_admin_review_activity() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.kind='post_report' then
  delete from platform_admin_activity_events where kind='new_request' and report_id=(select platform_report_id from post_safety_cases where id=new.request_id) and report_id<>new.report_id;
 end if;
 return new;
end $$;
revoke all on function public.deduplicate_admin_review_activity() from public,anon,authenticated;
create trigger deduplicate_admin_review_activity after insert on review_support_links for each row execute function deduplicate_admin_review_activity();

create function public.capture_admin_workflow_activity() returns trigger
language plpgsql security definer set search_path=public as $$
declare title_value text; href_value text; permission_value text;
begin
 if tg_op='DELETE' then delete from platform_admin_activity_events where event_key=tg_table_name||':'||old.id;return old;end if;
 if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
 if tg_table_name='post_safety_cases' then
  if new.origin<>'automatic' or new.status<>'pending' then return new;end if;
  title_value:='Automatic content review needs attention';href_value:='/admin/post-safety?origin=automatic&case='||new.id;permission_value:='admin.reports.read';
 elsif tg_table_name='salon_verification_requests' then
  if new.status<>'waiting' then return new;end if;
  title_value:='Business verification needs review';href_value:='/admin/verification';permission_value:='admin.locations.read';
 else
  if new.status not in ('open','needs_info') then return new;end if;
  title_value:='Account recovery needs attention';href_value:='/admin/recovery';permission_value:='admin.recovery.read';
 end if;
 insert into platform_admin_activity_events(kind,title,href,required_permission,event_key)
 values('workflow',title_value,href_value,permission_value,tg_table_name||':'||new.id) on conflict do nothing;
 return new;
end $$;
revoke all on function public.capture_admin_workflow_activity() from public,anon,authenticated;
create trigger capture_admin_moderation after insert or update or delete on post_safety_cases for each row execute function capture_admin_workflow_activity();
create trigger capture_admin_verification after insert or update or delete on salon_verification_requests for each row execute function capture_admin_workflow_activity();
create trigger capture_admin_recovery after insert or update or delete on account_recovery_requests for each row execute function capture_admin_workflow_activity();

create function public.get_platform_admin_activity() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=support_active_user(); result jsonb; unread_count bigint;
begin
 perform platform_admin_require_permission('admin.access');
 select count(*) into unread_count from platform_admin_activity_events e where admin_activity_can_read(e.report_id,e.required_permission)
 and not exists(select 1 from platform_admin_activity_reads where event_id=e.id and user_id=actor);
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id desc),'[]') into result from (
  select e.id,e.created_at,jsonb_build_object('id',e.id,'report_id',e.report_id,'kind',e.kind,'title',e.title,'href',e.href,'created_at',e.created_at,
   'can_chat',r.source in ('user_support','guest_support'),'unread',not exists(select 1 from platform_admin_activity_reads where event_id=e.id and user_id=actor)) item
  from platform_admin_activity_events e left join platform_reports r on r.id=e.report_id
  where admin_activity_can_read(e.report_id,e.required_permission) order by e.created_at desc,e.id desc limit 50
 ) x;
 return jsonb_build_object('items',result,'unread_count',unread_count);
end $$;
create function public.mark_platform_admin_activity_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=support_active_user();
begin
 perform platform_admin_require_permission('admin.access');
 if coalesce(cardinality(p_ids),0)>50 then raise exception 'Maximum 50 notifications.'; end if;
 insert into platform_admin_activity_reads(event_id,user_id)
 select id,actor from platform_admin_activity_events where id=any(p_ids) and admin_activity_can_read(report_id,required_permission)
 on conflict do nothing;
end $$;
create function public.get_admin_review_communication_states(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.reports.read');perform support_active_user();
 if coalesce(cardinality(p_ids),0)>200 then raise exception 'Maximum 200 cases.'; end if;
 return coalesce((select jsonb_object_agg(l.request_id,jsonb_build_object('report_id',r.id,'status',r.status,
 'responded',exists(select 1 from support_case_messages where report_id=r.id and sender='user' and message_kind='message') or exists(select 1 from support_case_attachments where report_id=r.id)))
 from review_support_links l join platform_reports r on r.id=l.report_id where l.kind='post_report' and l.request_id=any(p_ids)),'{}');
end $$;
revoke all on function public.get_platform_admin_activity(),public.mark_platform_admin_activity_read(uuid[]),public.get_admin_review_communication_states(uuid[]) from public,anon;
grant execute on function public.get_platform_admin_activity(),public.mark_platform_admin_activity_read(uuid[]),public.get_admin_review_communication_states(uuid[]) to authenticated;
-- Existing unresolved cases enter the team's queue; no historical replies are replayed as chat popups.
insert into platform_admin_activity_events(report_id,kind,title,href,event_key,created_at)
select r.id,'new_request','Request awaiting review: '||left(r.summary,160),'/admin/reports/'||r.id,'platform_reports:'||r.id,r.created_at
from platform_reports r where r.status not in ('resolved','closed')
and not exists(select 1 from post_safety_cases c join review_support_links l on l.request_id=c.id and l.kind='post_report' where c.platform_report_id=r.id and l.report_id<>r.id)
on conflict do nothing;
insert into platform_admin_activity_events(kind,title,href,required_permission,event_key,created_at)
select 'workflow','Automatic content review needs attention','/admin/post-safety?origin=automatic&case='||id,'admin.reports.read','post_safety_cases:'||id,created_at from post_safety_cases where origin='automatic' and status='pending'
union all select 'workflow','Business verification needs review','/admin/verification','admin.locations.read','salon_verification_requests:'||id,created_at from salon_verification_requests where status='waiting'
union all select 'workflow','Account recovery needs attention','/admin/recovery','admin.recovery.read','account_recovery_requests:'||id,created_at from account_recovery_requests where status in ('open','reviewing','needs_info')
on conflict do nothing;
commit;
