begin;
alter table public.platform_reports add column if not exists support_context jsonb not null default '{}'::jsonb;
alter table public.platform_reports add column if not exists support_request_id uuid;
create unique index platform_reports_support_request_idx on public.platform_reports(support_request_id) where support_request_id is not null;
create table public.support_case_messages (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.platform_reports(id) on delete cascade,
 actor_user_id uuid references public.users(id),
 sender text not null check(sender in ('user','support')),
 body text not null check(length(btrim(body)) between 1 and 5000),
 created_at timestamptz not null default now()
);
create index support_case_messages_report_idx on public.support_case_messages(report_id,created_at);
alter table public.support_case_messages enable row level security;
revoke all on public.support_case_messages from public,anon,authenticated;

create function public.submit_user_support_case(p_request_id uuid,p_category text,p_summary text,p_message text,p_context jsonb default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); result uuid;
begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in to contact support.'; end if;
 if p_request_id is null or p_category not in ('booking','data_calculation','ticket','review_dispute','account','salon_access','moderation_appeal','app_issue','other') or p_summary is null or length(btrim(p_summary)) not between 3 and 200 or p_message is null or length(btrim(p_message)) not between 1 and 5000 or p_context is null or jsonb_typeof(p_context)<>'object' or octet_length(p_context::text)>4000 then raise exception 'Please check your request.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support:'||actor::text,0));
 select id into result from platform_reports where support_request_id=p_request_id and reporter_user_id=actor;
 if found then return result; end if;
 if (select count(*) from platform_reports where reporter_user_id=actor and source='user_support' and created_at>now()-interval '1 hour')>=5 then raise exception 'Too many requests. Please continue an existing conversation.'; end if;
 insert into platform_reports(category,summary,description,source,reporter_user_id,created_by_user_id,support_request_id,support_context)
 values(p_category,btrim(p_summary),btrim(p_message),'user_support',actor,actor,p_request_id,p_context) returning id into result;
 insert into support_case_messages(report_id,actor_user_id,sender,body) values(result,actor,'user',btrim(p_message));
 return result;
end;$$;

create table public.support_case_attachments (
 id uuid primary key default gen_random_uuid(),report_id uuid not null references platform_reports(id) on delete cascade,
 actor_user_id uuid references users(id),object_path text not null unique,file_name text not null,created_at timestamptz not null default now()
);
alter table public.support_case_attachments enable row level security;
revoke all on public.support_case_attachments from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('support-evidence','support-evidence',false,5242880,array['image/png','image/jpeg','image/webp','application/pdf']) on conflict(id) do nothing;
create function public.add_support_case_attachment(p_report_id uuid,p_path text,p_name text) returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support') for update;
 if not found or current_public_user_id() is null then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id is distinct from current_public_user_id() then perform platform_admin_require_permission('admin.reports.update'); end if;
 if p_path is null or p_path not like r.id::text||'/%' or p_name is null or length(p_name) not between 1 and 200 then raise exception 'Invalid attachment.'; end if;
 if (select count(*) from support_case_attachments where report_id=r.id)>=20 then raise exception 'Maximum 20 attachments per request.'; end if;
 insert into support_case_attachments(report_id,actor_user_id,object_path,file_name) values(r.id,current_public_user_id(),p_path,p_name);
end;$$;
revoke all on function public.add_support_case_attachment(uuid,text,text) from public,anon;
grant execute on function public.add_support_case_attachment(uuid,text,text) to authenticated;

create function public.get_support_conversation(p_report_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r platform_reports; admin_view boolean:=false; messages jsonb;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support');
 if not found or current_public_user_id() is null then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id is distinct from current_public_user_id() then perform platform_admin_require_permission('admin.reports.read'); admin_view:=true; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sender',sender,'body',body,'created_at',created_at) order by created_at,id),'[]') into messages from support_case_messages where report_id=r.id;
 return jsonb_build_object('id',r.id,'reference',r.report_number,'summary',r.summary,'category',r.category,'status',r.status,'resolution',r.resolution,'context',r.support_context,'messages',messages,'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path,'name',file_name)),'[]') from support_case_attachments where report_id=r.id),'admin_view',admin_view);
end;$$;

create function public.list_my_support_cases()
returns jsonb language plpgsql security definer set search_path=public as $$
begin
 if current_public_user_id() is null then raise exception 'Sign in to view your requests.'; end if;
 return (select coalesce(jsonb_agg(row_to_json(r)),'[]') from (select id,report_number as reference,summary,status,updated_at from platform_reports where reporter_user_id=current_public_user_id() and source='user_support' order by updated_at desc limit 100) r);
end;$$;

create function public.send_support_case_message(p_report_id uuid,p_body text,p_reopen boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports; kind text;
begin
 select * into r from platform_reports where id=p_report_id and source in ('user_support','guest_support') for update;
 if not found or current_public_user_id() is null then raise exception 'Request unavailable.'; end if;
 if r.reporter_user_id=current_public_user_id() then kind:='user';
 else perform platform_admin_require_permission('admin.reports.update'); kind:='support'; end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 5000 then raise exception 'Enter a message (maximum 5,000 characters).'; end if;
 if (select count(*) from support_case_messages where actor_user_id=current_public_user_id() and created_at>now()-interval '1 minute')>=10 then raise exception 'Please wait before sending another message.'; end if;
 if r.status in ('resolved','closed') and not p_reopen then raise exception 'Reopen this request to continue.'; end if;
 insert into support_case_messages(report_id,actor_user_id,sender,body) values(r.id,current_public_user_id(),kind,btrim(p_body));
 update platform_reports set updated_at=now(),status=case when kind='user' then 'under_review' else 'action_required' end,resolved_at=null,closed_at=null,resolution=case when p_reopen then null else resolution end where id=r.id;
end;$$;

-- Guest contact stays in its existing email workflow; the case is linked rather than duplicated independently.
alter table public.support_inbox_threads add column platform_report_id uuid references public.platform_reports(id);
create function public.link_guest_support_case() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into platform_reports(category,summary,description,source,support_context)
 values('other',left('Help request: '||new.customer_name,200),new.message,'guest_support',jsonb_build_object('inbox_thread_id',new.id)) returning id into new.platform_report_id;
 return new;
end;$$;
create trigger link_guest_support_case before insert on public.support_inbox_threads for each row execute function public.link_guest_support_case();
revoke all on function public.link_guest_support_case() from public,anon,authenticated;
revoke all on function public.submit_user_support_case(uuid,text,text,text,jsonb), public.get_support_conversation(uuid), public.list_my_support_cases(), public.send_support_case_message(uuid,text,boolean) from public,anon;
grant execute on function public.submit_user_support_case(uuid,text,text,text,jsonb), public.get_support_conversation(uuid), public.list_my_support_cases(), public.send_support_case_message(uuid,text,boolean) to authenticated;
create function public.get_guest_support_case_link(p_report_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 perform platform_admin_require_permission('admin.reports.read');
 return (select jsonb_build_object('context',support_context) from platform_reports where id=p_report_id and source='guest_support');
end;$$;
revoke all on function public.get_guest_support_case_link(uuid) from public,anon;
grant execute on function public.get_guest_support_case_link(uuid) to authenticated;
create function public.notify_support_case_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.source='user_support' and (new.status in ('resolved','closed') and new.status is distinct from old.status or new.resolution is distinct from old.resolution) then
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(new.reporter_user_id,'customer','support_case','Support request updated',new.report_number||': '||replace(new.status,'_',' '),'/support/'||new.id,'support-case:'||gen_random_uuid());
 end if;
 return new;
end;$$;
create trigger notify_support_case_change after update on platform_reports for each row execute function notify_support_case_change();
revoke all on function public.notify_support_case_change() from public,anon,authenticated;
create or replace function public.search_platform_admin_reports(
  p_query text default null,
  p_status text default null,
  p_priority text default null,
  p_assigned text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor record;
  clean_query text := nullif(btrim(coalesce(p_query, '')), '');
  clean_status text := nullif(btrim(coalesce(p_status, '')), '');
  clean_priority text := nullif(btrim(coalesce(p_priority, '')), '');
  clean_assigned text := nullif(btrim(coalesce(p_assigned, '')), '');
  page_number integer := public.platform_admin_normalize_page(p_page);
  page_size integer := public.platform_admin_clamp_page_size(p_page_size);
  row_offset integer;
  total_count integer;
  items jsonb;
begin
  select *
  into actor
  from public.platform_admin_require_permission('admin.reports.read');

  if clean_query is not null and length(clean_query) > 100 then
    raise exception 'Search query must be 100 characters or fewer.';
  end if;

  if clean_status is not null
    and clean_status not in ('new', 'under_review', 'action_required', 'resolved', 'closed')
  then
    raise exception 'Invalid report status filter.';
  end if;

  if clean_priority is not null
    and clean_priority not in ('low', 'normal', 'high', 'urgent')
  then
    raise exception 'Invalid report priority filter.';
  end if;

  if clean_assigned is not null and clean_assigned not in ('me', 'unassigned') then
    raise exception 'Invalid assignment filter.';
  end if;

  row_offset := (page_number - 1) * page_size;

  select count(*)
  into total_count
  from public.platform_reports reports
  left join public.users subject_users
    on subject_users.id = reports.subject_user_id
  left join public.platform_admin_businesses_compat subject_organizations
    on subject_organizations.id = reports.subject_organization_id
  left join public.locations subject_locations
    on subject_locations.id = reports.subject_location_id
  where reports.source not in ('user_post_report','automatic_post_scan') and reports.category <> 'post_content' and (clean_status is null or reports.status = clean_status)
    and (clean_priority is null or reports.priority = clean_priority)
    and (
      clean_assigned is null
      or (clean_assigned = 'me' and reports.assigned_membership_id = actor.actor_membership_id)
      or (clean_assigned = 'unassigned' and reports.assigned_membership_id is null)
    )
    and (
      clean_query is null
      or reports.id::text = clean_query
      or reports.report_number ilike '%' || clean_query || '%'
      or reports.summary ilike '%' || clean_query || '%'
      or reports.category ilike '%' || clean_query || '%'
      or subject_users.display_name ilike '%' || clean_query || '%'
      or subject_organizations.name ilike '%' || clean_query || '%'
      or subject_locations.name ilike '%' || clean_query || '%'
    );

  select coalesce(jsonb_agg(item order by sort_created_at desc), '[]'::jsonb)
  into items
  from (
    select
      reports.created_at as sort_created_at,
      jsonb_build_object(
        'id', reports.id,
        'report_number', reports.report_number,
        'category', reports.category,
        'priority', reports.priority,
        'status', reports.status,
        'summary', reports.summary,
        'source', reports.source,
        'created_at', reports.created_at,
        'updated_at', reports.updated_at,
        'resolved_at', reports.resolved_at,
        'closed_at', reports.closed_at,
        'subject', case
          when reports.subject_user_id is not null then jsonb_build_object(
            'type', 'user',
            'id', subject_users.id,
            'label', coalesce(subject_users.display_name, 'Unnamed user')
          )
          when reports.subject_organization_id is not null then jsonb_build_object(
            'type', 'business',
            'id', subject_organizations.id,
            'label', subject_organizations.name
          )
          when reports.subject_location_id is not null then jsonb_build_object(
            'type', 'location',
            'id', subject_locations.id,
            'label', subject_locations.name
          )
          else null
        end,
        'assignee', case
          when assigned_memberships.id is null then null
          else jsonb_build_object(
            'membership_id', assigned_memberships.id,
            'user_id', assigned_users.id,
            'display_name', assigned_users.display_name,
            'role_slug', assigned_roles.slug,
            'status', assigned_memberships.status
          )
        end
      ) as item
    from public.platform_reports reports
    left join public.users subject_users
      on subject_users.id = reports.subject_user_id
    left join public.platform_admin_businesses_compat subject_organizations
      on subject_organizations.id = reports.subject_organization_id
    left join public.locations subject_locations
      on subject_locations.id = reports.subject_location_id
    left join public.platform_admin_memberships assigned_memberships
      on assigned_memberships.id = reports.assigned_membership_id
    left join public.users assigned_users
      on assigned_users.id = assigned_memberships.user_id
    left join public.platform_admin_roles assigned_roles
      on assigned_roles.id = assigned_memberships.role_id
    where reports.source not in ('user_post_report','automatic_post_scan') and reports.category <> 'post_content' and (clean_status is null or reports.status = clean_status)
      and (clean_priority is null or reports.priority = clean_priority)
      and (
        clean_assigned is null
        or (clean_assigned = 'me' and reports.assigned_membership_id = actor.actor_membership_id)
        or (clean_assigned = 'unassigned' and reports.assigned_membership_id is null)
      )
      and (
        clean_query is null
        or reports.id::text = clean_query
        or reports.report_number ilike '%' || clean_query || '%'
        or reports.summary ilike '%' || clean_query || '%'
        or reports.category ilike '%' || clean_query || '%'
        or subject_users.display_name ilike '%' || clean_query || '%'
        or subject_organizations.name ilike '%' || clean_query || '%'
        or subject_locations.name ilike '%' || clean_query || '%'
      )
    order by reports.created_at desc, reports.id
    limit page_size
    offset row_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'page', page_number,
    'page_size', page_size
  );
end;
$$;
create function public.notify_support_reply() returns trigger language plpgsql security definer set search_path=public as $$
declare r platform_reports;
begin
 select * into r from platform_reports where id=new.report_id;
 if new.sender='support' then
 if r.reporter_user_id is not null then
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key)
 values(r.reporter_user_id,'customer','support_reply','Support replied to your request',left(new.body,150),'/support/'||r.id,'support-reply:'||new.id);
 end if;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata)
 values(new.actor_user_id,'platform_admin.support_reply','platform_report',r.id,'Reply to support request',jsonb_build_object('message_id',new.id));
 end if;
 return new;
end;$$;
create trigger notify_support_reply after insert on support_case_messages for each row execute function notify_support_reply();
revoke all on function public.notify_support_reply() from public,anon,authenticated;
create function public.sync_guest_support_case() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and new.platform_report_id is not null then
 update platform_reports set status=case new.status when 'resolved' then 'resolved' when 'spam' then 'closed' when 'in_progress' then 'under_review' else 'new' end,updated_at=now() where id=new.platform_report_id and not (status='closed' and new.status='resolved') and not (status='action_required' and new.status='in_progress');
 end if;
 return new;
end;$$;
create trigger sync_guest_support_case after update on support_inbox_threads for each row execute function sync_guest_support_case();
revoke all on function public.sync_guest_support_case() from public,anon,authenticated;
create function public.get_guest_support_conversation(p_thread_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare r platform_reports;
begin
 select p.* into r from platform_reports p join support_inbox_threads t on t.platform_report_id=p.id where t.id=p_thread_id;
 if not found then raise exception 'Request unavailable.'; end if;
 return jsonb_build_object('id',r.id,'reference',r.report_number,'summary',r.summary,'category',r.category,'status',r.status,'resolution',r.resolution,'context','{}'::jsonb,'messages',
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'sender',sender,'body',body,'created_at',created_at) order by created_at,id),'[]') from support_case_messages where report_id=r.id), 'attachments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',object_path,'name',file_name)),'[]') from support_case_attachments where report_id=r.id),'admin_view',false);
end;$$;
create function public.send_guest_support_message(p_thread_id uuid,p_body text,p_reopen boolean default false) returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports;
begin
 select p.* into r from platform_reports p join support_inbox_threads t on t.platform_report_id=p.id where t.id=p_thread_id for update of p;
 if not found then raise exception 'Request unavailable.'; end if;
 if p_body is null or length(btrim(p_body)) not between 1 and 5000 then raise exception 'Enter a message (maximum 5,000 characters).'; end if;
 if r.status in ('closed','resolved') and not p_reopen then raise exception 'Reopen this request to continue.'; end if;
 if (select count(*) from support_case_messages where report_id=r.id and sender='user' and created_at>now()-interval '1 minute')>=5 then raise exception 'Please wait before sending another message.'; end if;
 insert into support_case_messages(report_id,sender,body) values(r.id,'user',btrim(p_body));
 update platform_reports set status='under_review',resolved_at=null,closed_at=null,updated_at=now() where id=r.id;
end;$$;
create function public.seed_guest_support_message() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into support_case_messages(report_id,sender,body) values(new.platform_report_id,'user',new.message);return new;
end;$$;
create trigger seed_guest_support_message after insert on support_inbox_threads for each row execute function seed_guest_support_message();
revoke all on function public.seed_guest_support_message() from public,anon,authenticated;
revoke all on function public.get_guest_support_conversation(uuid),public.send_guest_support_message(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.get_guest_support_conversation(uuid),public.send_guest_support_message(uuid,text,boolean) to service_role;
create function public.add_guest_support_attachment(p_thread_id uuid,p_path text,p_name text) returns void language plpgsql security definer set search_path=public as $$
declare r platform_reports;
begin
 select p.* into r from platform_reports p join support_inbox_threads t on t.platform_report_id=p.id where t.id=p_thread_id for update of p;
 if not found or p_path is null or p_path not like r.id::text||'/%' or p_name is null or length(p_name) not between 1 and 200 then raise exception 'Invalid attachment.'; end if;
 if (select count(*) from support_case_attachments where report_id=r.id)>=20 then raise exception 'Maximum 20 attachments per request.'; end if;
 insert into support_case_attachments(report_id,object_path,file_name) values(r.id,p_path,p_name);
end;$$;
revoke all on function public.add_guest_support_attachment(uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_guest_support_attachment(uuid,text,text) to service_role;
create function public.sync_support_case_inbox() returns trigger language plpgsql security definer set search_path=public as $$
declare mapped text;
begin
 if new.source='guest_support' and new.status is distinct from old.status then
 mapped:=case new.status when 'resolved' then 'resolved' when 'closed' then 'resolved' when 'new' then 'new' else 'in_progress' end;
 update support_inbox_threads set status=mapped where platform_report_id=new.id and status is distinct from mapped and not (new.status='closed' and status='spam');
 end if;return new;
end;$$;
create trigger sync_support_case_inbox after update on platform_reports for each row execute function sync_support_case_inbox();
revoke all on function public.sync_support_case_inbox() from public,anon,authenticated;
commit;
