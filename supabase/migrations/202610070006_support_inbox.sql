begin;

insert into public.platform_admin_permissions(code,name,description,category) values
 ('admin.inbox.read','Read support inbox','Read private customer support messages and contact details.','inbox'),
 ('admin.inbox.manage','Manage support inbox','Assign support messages, record notes and change their status.','inbox'),
 ('admin.inbox.reply','Reply to support messages','Send support email replies to the original customer email.','inbox')
on conflict(code) do nothing;
insert into public.platform_admin_role_permissions(role_id,permission_id)
select r.id,p.id from public.platform_admin_roles r cross join public.platform_admin_permissions p
where r.slug in ('platform_owner','operations_admin','support_agent') and p.code in ('admin.inbox.read','admin.inbox.manage','admin.inbox.reply')
on conflict do nothing;

create table public.support_inbox_threads (
 id uuid primary key,
 customer_name text not null check(length(customer_name) between 1 and 120),
 customer_email text not null check(length(customer_email) between 3 and 254),
 message text not null check(length(message) between 1 and 5000),
 network_hash text not null check(length(network_hash)=64),
 status text not null default 'new' check(status in ('new','in_progress','resolved','spam')),
 assigned_user_id uuid references public.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index support_inbox_status_idx on public.support_inbox_threads(status,created_at desc);
create index support_inbox_network_idx on public.support_inbox_threads(network_hash,created_at desc);
create index support_inbox_email_idx on public.support_inbox_threads(customer_email,created_at desc);

create table public.support_inbox_messages (
 id uuid primary key,
 thread_id uuid not null references public.support_inbox_threads(id),
 actor_user_id uuid not null references public.users(id),
 kind text not null check(kind in ('email_reply','note','manual_reply')),
 body text not null check(length(body) between 1 and 5000),
 subject text,
 recipient_email text,
 delivery_status text not null check(delivery_status in ('sending','sent','failed','unknown','recorded')),
 provider_message_id text,
 failure_reason text,
 created_at timestamptz not null default now(),
 sent_at timestamptz
);
create index support_inbox_messages_thread_idx on public.support_inbox_messages(thread_id,created_at);

create table public.platform_support_email_settings (
 id boolean primary key default true check(id),
 encrypted_config text not null,
 public_config jsonb not null check(jsonb_typeof(public_config)='object'),
 updated_at timestamptz not null default now(),
 updated_by uuid references public.users(id)
);

alter table public.support_inbox_threads enable row level security;
alter table public.support_inbox_messages enable row level security;
alter table public.platform_support_email_settings enable row level security;
revoke all on public.support_inbox_threads,public.support_inbox_messages,public.platform_support_email_settings from public,anon,authenticated;
grant select on public.platform_support_email_settings to service_role;

create function public.submit_support_contact(p_request_id uuid,p_name text,p_email text,p_message text,p_network_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare previous support_inbox_threads; clean_name text:=btrim(p_name); clean_email text:=lower(btrim(p_email)); clean_message text:=btrim(p_message);
begin
 if p_request_id is null or clean_name is null or length(clean_name) not between 1 and 120 or clean_email is null or length(clean_email)>254 or clean_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or clean_message is null or length(clean_message) not between 1 and 5000 or p_network_hash is null or p_network_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid contact message.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('support_contact_submission',0));
 select * into previous from support_inbox_threads where id=p_request_id;
 if found then
  if previous.customer_name<>clean_name or previous.customer_email<>clean_email or previous.message<>clean_message then raise exception 'Invalid request identifier.'; end if;
  return jsonb_build_object('reference',upper(left(p_request_id::text,8)));
 end if;
 if (select count(*) from support_inbox_threads where network_hash=p_network_hash and created_at>now()-interval '1 hour')>=5
 or (select count(*) from support_inbox_threads where customer_email=clean_email and created_at>now()-interval '1 hour')>=3
 or (select count(*) from support_inbox_threads where created_at>now()-interval '1 hour')>=200 then raise exception 'Too many support messages.'; end if;
 insert into support_inbox_threads(id,customer_name,customer_email,message,network_hash) values(p_request_id,clean_name,clean_email,clean_message,p_network_hash);
 return jsonb_build_object('reference',upper(left(p_request_id::text,8)));
end;$$;

create function public.list_platform_support_inbox(p_page integer default 1,p_page_size integer default 25,p_query text default null,p_status text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb; counts jsonb;
begin
 perform platform_admin_require_permission('admin.inbox.read');
 if p_page is null or p_page<1 or p_page>100000 or p_page_size is null or p_page_size not between 1 and 100 or coalesce(length(p_query),0)>100 or (p_status is not null and p_status not in ('new','in_progress','resolved','spam')) then raise exception 'Invalid inbox filter.'; end if;
 select jsonb_build_object('new',count(*) filter(where status='new'),'in_progress',count(*) filter(where status='in_progress'),'resolved',count(*) filter(where status='resolved'),'spam',count(*) filter(where status='spam')) into counts from support_inbox_threads;
 with filtered as (select t.id,t.customer_name,t.customer_email,left(t.message,180) as preview,t.status,t.created_at,t.updated_at,t.assigned_user_id,u.display_name as assignee,
   exists(select 1 from support_inbox_messages m where m.thread_id=t.id and m.kind='email_reply' and m.delivery_status in ('sending','unknown')) as needs_delivery_review
  from support_inbox_threads t left join users u on u.id=t.assigned_user_id
  where (p_status is null or t.status=p_status) and (nullif(btrim(p_query),'') is null or strpos(lower(t.customer_name||' '||t.customer_email||' '||t.message||' '||t.id::text),lower(btrim(p_query)))>0)),
 paged as (select * from filtered order by created_at desc,id limit p_page_size offset (p_page-1)*p_page_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from paged p),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'page_size',p_page_size,'counts',counts) into result;
 return result;
end;$$;

create function public.get_platform_support_thread(p_thread_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 perform platform_admin_require_permission('admin.inbox.read');
 select jsonb_build_object('thread',to_jsonb(t)-'network_hash','assignee',u.display_name,'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (select m.*,a.display_name as actor_name from support_inbox_messages m left join users a on a.id=m.actor_user_id where m.thread_id=t.id) x),'[]'::jsonb)) into result from support_inbox_threads t left join users u on u.id=t.assigned_user_id where t.id=p_thread_id;
 if result is null then raise exception 'Support message not found.'; end if;
 return result;
end;$$;

create function public.update_platform_support_thread(p_thread_id uuid,p_status text,p_assignment text default 'keep')
returns void language plpgsql security definer set search_path=public as $$
declare actor record; previous support_inbox_threads; next_assignee uuid;
begin
 select * into actor from platform_admin_require_permission('admin.inbox.manage');
 if p_status is null or p_status not in ('new','in_progress','resolved','spam') or p_assignment is null or p_assignment not in ('keep','me','unassign') then raise exception 'Invalid support status or assignment.'; end if;
 select * into previous from support_inbox_threads where id=p_thread_id for update;
 if not found then raise exception 'Support message not found.'; end if;
 next_assignee:=case p_assignment when 'me' then actor.actor_user_id when 'unassign' then null else previous.assigned_user_id end;
 update support_inbox_threads set status=p_status,assigned_user_id=next_assignee,updated_at=now() where id=p_thread_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,before_data,after_data)
 values(actor.actor_user_id,'support.thread.updated','support_inbox',p_thread_id,jsonb_build_object('status',previous.status,'assigned_user_id',previous.assigned_user_id),jsonb_build_object('status',p_status,'assigned_user_id',next_assignee));
end;$$;

create function public.record_platform_support_note(p_thread_id uuid,p_request_id uuid,p_body text,p_kind text default 'note')
returns void language plpgsql security definer set search_path=public as $$
declare actor record; previous support_inbox_messages;
begin
 select * into actor from platform_admin_require_permission('admin.inbox.manage');
 if p_request_id is null or p_body is null or length(btrim(p_body)) not between 1 and 5000 or p_kind is null or p_kind not in ('note','manual_reply') then raise exception 'Invalid support note.'; end if;
 perform 1 from support_inbox_threads where id=p_thread_id for update;
 if not found then raise exception 'Support message not found.'; end if;
 select * into previous from support_inbox_messages where id=p_request_id;
 if found then
  if previous.thread_id<>p_thread_id or previous.actor_user_id<>actor.actor_user_id or previous.body<>btrim(p_body) or previous.kind<>p_kind then raise exception 'Invalid request identifier.'; end if;
  return;
 end if;
 insert into support_inbox_messages(id,thread_id,actor_user_id,kind,body,delivery_status) values(p_request_id,p_thread_id,actor.actor_user_id,p_kind,btrim(p_body),'recorded');
 update support_inbox_threads set updated_at=now(),status=case when p_kind='manual_reply' and status='new' then 'in_progress' else status end where id=p_thread_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(actor.actor_user_id,'support.'||p_kind||'.recorded','support_inbox',p_thread_id,jsonb_build_object('message_id',p_request_id));
end;$$;

create function public.prepare_platform_support_reply(p_thread_id uuid,p_request_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor record; contact support_inbox_threads; previous support_inbox_messages;
begin
 select * into actor from platform_admin_require_permission('admin.inbox.reply');
 if p_request_id is null or p_body is null or length(btrim(p_body)) not between 1 and 5000 then raise exception 'Reply is required and must be at most 5000 characters.'; end if;
 select * into contact from support_inbox_threads where id=p_thread_id for update;
 if not found then raise exception 'Support message not found.'; end if;
 if contact.status='spam' then raise exception 'This message is marked as spam. Reopen it before replying.'; end if;
 select * into previous from support_inbox_messages where id=p_request_id;
 if found then
  if previous.thread_id<>p_thread_id or previous.actor_user_id<>actor.actor_user_id or previous.body<>btrim(p_body) or previous.kind<>'email_reply' then raise exception 'Invalid request identifier.'; end if;
  return jsonb_build_object('should_send',false,'status',previous.delivery_status,'id',previous.id);
 end if;
 if exists(select 1 from support_inbox_messages where thread_id=p_thread_id and kind='email_reply' and delivery_status in ('sending','unknown')) then raise exception 'This conversation has an unconfirmed email. Check delivery before sending another reply.'; end if;
 insert into support_inbox_messages(id,thread_id,actor_user_id,kind,body,subject,recipient_email,delivery_status)
 values(p_request_id,p_thread_id,actor.actor_user_id,'email_reply',btrim(p_body),'Reylumi support · '||upper(left(p_thread_id::text,8)),contact.customer_email,'sending') returning * into previous;
 update support_inbox_threads set updated_at=now() where id=p_thread_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(actor.actor_user_id,'support.email.prepared','support_inbox',p_thread_id,jsonb_build_object('message_id',p_request_id));
 return jsonb_build_object('should_send',true,'status','sending','id',previous.id,'to',contact.customer_email,'name',contact.customer_name,'subject',previous.subject,'body',previous.body);
end;$$;

-- The trusted server records provider outcomes even if the sender's admin access
-- was revoked while the provider request was in flight. No client can forge sent.
create function public.finish_support_reply(p_message_id uuid,p_actor_id uuid,p_status text,p_provider_id text default null,p_failure_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare message support_inbox_messages;
begin
 if p_status is null or p_status not in ('sent','failed','unknown') or coalesce(length(p_provider_id),0)>200 or coalesce(length(p_failure_reason),0)>500 then raise exception 'Invalid delivery outcome.'; end if;
 select * into message from support_inbox_messages where id=p_message_id and actor_user_id=p_actor_id and kind='email_reply' for update;
 if not found then raise exception 'Support reply not found.'; end if;
 if message.delivery_status<>'sending' then return; end if;
 update support_inbox_messages set delivery_status=p_status,provider_message_id=p_provider_id,failure_reason=p_failure_reason,sent_at=case when p_status='sent' then now() else null end where id=p_message_id;
 update support_inbox_threads set updated_at=now(),status=case when p_status='sent' and status in ('new','resolved') then 'in_progress' else status end where id=message.thread_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,metadata) values(p_actor_id,'support.email.'||p_status,'support_inbox',message.thread_id,jsonb_build_object('message_id',p_message_id,'provider_id',p_provider_id));
end;$$;

create function public.resolve_platform_support_delivery(p_message_id uuid,p_delivered boolean,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare actor record; message support_inbox_messages; reason text;
begin
 select * into actor from platform_admin_require_permission('admin.inbox.reply');
 reason:=platform_admin_normalize_reason(p_reason);
 if p_delivered is null then raise exception 'Delivery outcome is required.'; end if;
 select * into message from support_inbox_messages where id=p_message_id and kind='email_reply' for update;
 if not found then raise exception 'Support reply not found.'; end if;
 if message.delivery_status not in ('sending','unknown') then raise exception 'This reply already has a confirmed outcome.'; end if;
 if message.delivery_status='sending' and message.created_at>now()-interval '2 minutes' then raise exception 'This email is still being sent. Wait before reviewing delivery.'; end if;
 update support_inbox_messages set delivery_status=case when p_delivered then 'sent' else 'failed' end,sent_at=case when p_delivered then now() else null end,failure_reason=case when p_delivered then null else 'Delivery reviewed by an admin.' end where id=p_message_id;
 update support_inbox_threads set updated_at=now(),status=case when p_delivered and status in ('new','resolved') then 'in_progress' else status end where id=message.thread_id;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,target_id,reason,metadata) values(actor.actor_user_id,'support.email.delivery_reviewed','support_inbox',message.thread_id,reason,jsonb_build_object('message_id',p_message_id,'delivered',p_delivered));
end;$$;

create function public.save_platform_support_email_settings(p_actor uuid,p_encrypted text,p_public jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare previous jsonb;
begin
 if not exists(select 1 from platform_admin_memberships m join platform_admin_roles r on r.id=m.role_id join users u on u.id=m.user_id where m.user_id=p_actor and m.status='active' and r.slug='platform_owner' and u.status='active') then raise exception 'Platform owner access required.'; end if;
 if p_encrypted is null or length(p_encrypted) not between 40 and 5000 or p_public is null or jsonb_typeof(p_public)<>'object' or p_public - array['from','enabled','keyConfigured','domainVerified'] <> '{}'::jsonb then raise exception 'Invalid encrypted configuration.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('platform_support_email_settings',0));
 select public_config into previous from platform_support_email_settings where id;
 insert into platform_support_email_settings(id,encrypted_config,public_config,updated_by) values(true,p_encrypted,p_public,p_actor)
 on conflict(id) do update set encrypted_config=excluded.encrypted_config,public_config=excluded.public_config,updated_at=now(),updated_by=p_actor;
 insert into platform_admin_audit_logs(actor_user_id,action,target_type,before_data,after_data) values(p_actor,'support.email_settings.updated','system',previous,p_public);
end;$$;

revoke all on function public.submit_support_contact(uuid,text,text,text,text),public.finish_support_reply(uuid,uuid,text,text,text),public.save_platform_support_email_settings(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.submit_support_contact(uuid,text,text,text,text),public.finish_support_reply(uuid,uuid,text,text,text),public.save_platform_support_email_settings(uuid,text,jsonb) to service_role;
revoke all on function public.list_platform_support_inbox(integer,integer,text,text),public.get_platform_support_thread(uuid),public.update_platform_support_thread(uuid,text,text),public.record_platform_support_note(uuid,uuid,text,text),public.prepare_platform_support_reply(uuid,uuid,text),public.resolve_platform_support_delivery(uuid,boolean,text) from public,anon;
grant execute on function public.list_platform_support_inbox(integer,integer,text,text),public.get_platform_support_thread(uuid),public.update_platform_support_thread(uuid,text,text),public.record_platform_support_note(uuid,uuid,text,text),public.prepare_platform_support_reply(uuid,uuid,text),public.resolve_platform_support_delivery(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
