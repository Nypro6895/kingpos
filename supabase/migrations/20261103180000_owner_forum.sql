-- Owner community. No service-role reads: access and every mutation are checked in PostgreSQL.
begin;
insert into public.platform_admin_permissions(code,name,category) values
 ('admin.forum.moderate','Moderate owner forum','forum'),
 ('admin.forum.manage','Manage forum sections','forum') on conflict(code) do nothing;
insert into public.platform_admin_role_permissions(role_id,permission_id)
select r.id,p.id from public.platform_admin_roles r cross join public.platform_admin_permissions p
where (r.slug in ('platform_owner','operations_admin') and p.code in ('admin.forum.moderate','admin.forum.manage'))
or (r.slug='moderator' and p.code='admin.forum.moderate') on conflict do nothing;

create table public.forum_sections (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 80),
 description text not null default '' check(length(description)<=400), position integer not null default 0,
 archived boolean not null default false, created_at timestamptz not null default now()
);
create unique index forum_section_name on public.forum_sections(lower(name));
insert into public.forum_sections(name,description,position) values
 ('Salon operations','Daily operations, workflow and owner experience.',0),
 ('Team & hiring','Hiring, training and team management.',1),
 ('Marketing','Customer loyalty and growing your salon.',2),
 ('Reylumi Q&A','Questions and ideas about Reylumi.',3),
 ('Owner lounge','Conversations with fellow salon owners.',4);
create table public.forum_topics (
 id uuid primary key default gen_random_uuid(), author_id uuid references public.users(id) on delete set null,
 section_id uuid not null references public.forum_sections(id), title text not null check(length(btrim(title)) between 5 and 180),
 body text not null check(length(btrim(body)) between 1 and 20000), state text check(state is null or state ~ '^[A-Z]{2}$'),
 pinned boolean not null default false, locked boolean not null default false,
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 search_vector tsvector generated always as (to_tsvector('simple', title || ' ' || body)) stored
);
create index forum_feed on public.forum_topics(created_at desc,id desc) where deleted_at is null;
create index forum_section_feed on public.forum_topics(section_id,created_at desc,id desc) where deleted_at is null;
create index forum_state_feed on public.forum_topics(state,created_at desc,id desc) where deleted_at is null;
create index forum_search on public.forum_topics using gin(search_vector);
create index forum_author on public.forum_topics(author_id,created_at desc);
create table public.forum_replies (
 id uuid primary key default gen_random_uuid(), topic_id uuid not null references public.forum_topics(id),
 author_id uuid references public.users(id) on delete set null,
 body text not null check(length(btrim(body)) between 1 and 10000),
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index forum_reply_page on public.forum_replies(topic_id,created_at,id) where deleted_at is null;
create table public.forum_chat (
 id bigint generated always as identity primary key, author_id uuid references public.users(id) on delete set null,
 body text not null check(length(btrim(body)) between 1 and 2000), deleted_at timestamptz,
 created_at timestamptz not null default now()
);
create index forum_chat_visible on public.forum_chat(id desc) where deleted_at is null;
create table public.forum_bookmarks (
 user_id uuid not null references public.users(id) on delete cascade, topic_id uuid not null references public.forum_topics(id),
 created_at timestamptz not null default now(), primary key(user_id,topic_id)
);
create table public.forum_restrictions (
 user_id uuid primary key references public.users(id) on delete cascade,
 scope text not null check(scope in ('all','posting','chat')), reason text not null check(length(btrim(reason)) between 3 and 1000),
 expires_at timestamptz, actor_id uuid references public.users(id), updated_at timestamptz not null default now()
);
create table public.forum_reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid references public.users(id) on delete set null,
 target_type text not null check(target_type in ('topic','reply','chat')), target_id text not null,
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 resolved_at timestamptz, resolved_by uuid references public.users(id), created_at timestamptz not null default now()
);
create unique index forum_report_once on public.forum_reports(reporter_id,target_type,target_id) where resolved_at is null;
create index forum_report_queue on public.forum_reports(created_at desc) where resolved_at is null;
create table public.forum_audit (
 id bigint generated always as identity primary key, actor_id uuid references public.users(id), action text not null,
 target_type text not null, target_id text not null, reason text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table public.forum_rate_limits (
 user_id uuid not null references public.users(id) on delete cascade, kind text not null,
 last_at timestamptz not null default now(), primary key(user_id,kind)
);
-- Tables cannot be read or mutated through PostgREST. RPCs are the sole boundary.
do $$ declare t text; begin
 foreach t in array array['forum_sections','forum_topics','forum_replies','forum_chat','forum_bookmarks','forum_restrictions','forum_reports','forum_audit','forum_rate_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function public.forum_actor() returns uuid language plpgsql stable security definer set search_path=public as $$
declare v uuid:=public.current_public_user_id(); begin
 if v is null or not exists(select 1 from public.users where id=v and status='active') then
 raise exception 'Sign in with an active account.' using errcode='42501'; end if;
 if not (public.platform_admin_has_permission('admin.forum.moderate') or public.platform_admin_has_permission('admin.forum.manage')
 or exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id where m.user_id=v and m.status='active' and upper(r.code)='OWNER')) then
 raise exception 'This forum is for salon owners.' using errcode='42501'; end if;
 return v;
end $$;
revoke all on function public.forum_actor() from public,anon,authenticated;

create function public.forum_check_write(p_user uuid,p_kind text) returns void language plpgsql security definer set search_path=public as $$
declare last_time timestamptz; wait_seconds integer:=case p_kind when 'topic' then 20 when 'report' then 10 else 2 end; begin
 -- Serialize writes and bans for an account. Revocation cannot race a write past its check.
 perform pg_advisory_xact_lock(hashtextextended('forum:user:'||p_user::text,0));
 if exists(select 1 from public.forum_restrictions where user_id=p_user and (expires_at is null or expires_at>now())
 and (scope='all' or (scope='posting' and p_kind in ('topic','reply')) or (scope='chat' and p_kind='chat'))) then
 raise exception 'Your forum participation is restricted. Contact platform support.' using errcode='42501'; end if;
 select last_at into last_time from public.forum_rate_limits where user_id=p_user and kind=p_kind;
 if last_time>clock_timestamp()-make_interval(secs=>wait_seconds) then raise exception 'Please wait before sending again.' using errcode='P0001'; end if;
 insert into public.forum_rate_limits(user_id,kind,last_at) values(p_user,p_kind,clock_timestamp())
 on conflict(user_id,kind) do update set last_at=excluded.last_at;
end $$;
revoke all on function public.forum_check_write(uuid,text) from public,anon,authenticated;

create function public.forum_read(p_input jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_user uuid:=public.forum_actor(); mode text:=coalesce(p_input->>'mode','feed');
 v_mod boolean:=public.platform_admin_has_permission('admin.forum.moderate'); v_manage boolean:=public.platform_admin_has_permission('admin.forum.manage');
 result jsonb; v_topic uuid; v_before timestamptz; v_after timestamptz; v_cursor uuid; begin
 if mode='context' then
 return jsonb_build_object('user_id',v_user,'can_moderate',v_mod,'can_manage',v_manage,
 'display_name',(select coalesce(nullif(display_name,''),'Owner') from public.users where id=v_user),
 'restriction',(select to_jsonb(x)-'actor_id' from public.forum_restrictions x where user_id=v_user and (expires_at is null or expires_at>now())),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.forum_sections s where not archived or v_manage),'[]'::jsonb));
 elsif mode in ('feed','saved','mine','removed') then
 if mode='removed' and not v_mod then raise exception 'Moderator permission required.' using errcode='42501'; end if;
 v_before:=nullif(p_input->>'before','')::timestamptz; v_cursor:=nullif(p_input->>'cursor_id','')::uuid;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.pinned desc,x.created_at desc,x.id desc),'[]') into result from (
 select t.id,t.author_id,t.section_id,t.title,t.state,t.pinned,t.locked,t.deleted_at,t.created_at,t.updated_at,
 coalesce(nullif(u.display_name,''),'Owner') author_name,
 (select count(*) from public.forum_replies r where r.topic_id=t.id and r.deleted_at is null) reply_count,
 exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user) bookmarked
 from public.forum_topics t left join public.users u on u.id=t.author_id
 where ((mode='removed' and t.deleted_at is not null) or (mode<>'removed' and t.deleted_at is null))
 and (mode<>'saved' or exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user))
 and (mode<>'mine' or t.author_id=v_user)
 and (nullif(p_input->>'section','') is null or t.section_id=(p_input->>'section')::uuid)
 and (nullif(p_input->>'state','') is null or t.state=p_input->>'state')
 and (nullif(btrim(left(p_input->>'q',150)),'') is null or t.search_vector @@ websearch_to_tsquery('simple',left(p_input->>'q',150)))
 and (coalesce(p_input->>'unanswered','false')<>'true' or not exists(select 1 from public.forum_replies r where r.topic_id=t.id and r.deleted_at is null))
 and (v_before is null or (t.pinned,t.created_at,t.id)<(coalesce((p_input->>'before_pinned')::boolean,false),v_before,coalesce(v_cursor,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by t.pinned desc,t.created_at desc,t.id desc limit 21) x;
 return result;
 elsif mode='topic' then
 v_topic:=(p_input->>'id')::uuid;
 select to_jsonb(x) into result from (select t.id,t.author_id,t.section_id,t.title,t.body,t.state,t.pinned,t.locked,t.deleted_at,t.created_at,t.updated_at,coalesce(nullif(u.display_name,''),'Owner') author_name,
 exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user) bookmarked
 from public.forum_topics t left join public.users u on u.id=t.author_id where t.id=v_topic and (t.deleted_at is null or v_mod)) x;
 if result is null then raise exception 'Topic not found.' using errcode='P0002'; end if;
 v_after:=nullif(p_input->>'after','')::timestamptz; v_cursor:=nullif(p_input->>'cursor_id','')::uuid;
 return jsonb_build_object('topic',result,'replies',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select r.*,coalesce(nullif(u.display_name,''),'Owner') author_name from public.forum_replies r left join public.users u on u.id=r.author_id
 where r.topic_id=v_topic and (r.deleted_at is null or v_mod)
 and (v_after is null or (r.created_at,r.id)>(v_after,coalesce(v_cursor,'00000000-0000-0000-0000-000000000000'::uuid)))
 order by r.created_at,r.id limit 31) x),'[]'::jsonb));
 elsif mode='chat' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from (
 select c.id::text id,c.author_id,c.body,c.created_at,coalesce(nullif(u.display_name,''),'Owner') author_name
 from public.forum_chat c left join public.users u on u.id=c.author_id
 where c.deleted_at is null and (nullif(p_input->>'before_id','') is null or c.id<(p_input->>'before_id')::bigint)
 and (nullif(p_input->>'after_id','') is null or c.id>(p_input->>'after_id')::bigint)
 order by c.id desc limit 41) x),'[]'::jsonb);
 elsif mode in ('reports','restrictions','audit') then
 if not v_mod then raise exception 'Moderator permission required.' using errcode='42501'; end if;
 if mode='reports' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
 select a.*, coalesce(u.display_name,'Owner') reporter_name,
 case a.target_type when 'topic' then (select author_id from public.forum_topics where id::text=a.target_id)
 when 'reply' then (select author_id from public.forum_replies where id::text=a.target_id)
 else (select author_id from public.forum_chat where id::text=a.target_id) end author_id,
 case a.target_type when 'topic' then a.target_id when 'reply' then (select topic_id::text from public.forum_replies where id::text=a.target_id) else null end topic_id,
 case a.target_type when 'topic' then (select left(title||E'\n'||body,1200) from public.forum_topics where id::text=a.target_id)
 when 'reply' then (select left(body,1200) from public.forum_replies where id::text=a.target_id)
 else (select body from public.forum_chat where id::text=a.target_id) end preview
 from public.forum_reports a left join public.users u on u.id=a.reporter_id where a.resolved_at is null order by a.created_at desc limit 50) x),'[]'::jsonb);
 elsif mode='restrictions' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from (
 select a.*,coalesce(u.display_name,'Owner') display_name from public.forum_restrictions a left join public.users u on u.id=a.user_id
 where a.expires_at is null or a.expires_at>now() order by a.updated_at desc limit 50) x),'[]'::jsonb);
 else return coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (
 select a.id::text id,a.action,a.target_type,a.target_id,a.reason,a.details,a.created_at,coalesce(u.display_name,'Moderator') actor_name
 from public.forum_audit a left join public.users u on u.id=a.actor_id order by a.id desc limit 50) x),'[]'::jsonb); end if;
 end if;
 raise exception 'Unknown forum view.';
end $$;

create function public.forum_write(p_input jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=public.forum_actor(); op text:=p_input->>'op'; kind text:=p_input->>'kind';
 target text:=p_input->>'id'; reason text:=btrim(p_input->>'reason'); v_id uuid; v_author uuid; v_body text:=btrim(p_input->>'body');
 v_mod boolean:=public.platform_admin_has_permission('admin.forum.moderate'); v_manage boolean:=public.platform_admin_has_permission('admin.forum.manage');
 v_topic public.forum_topics%rowtype; v_section public.forum_sections%rowtype; v_chat bigint; v_expiry timestamptz; v_scope text;
 begin
 if op in ('topic','reply','chat','report','edit_topic','remove_own') then perform public.forum_check_write(v_user,case when op='edit_topic' then 'topic' when op='remove_own' then 'reply' else op end); end if;
 if op='topic' then
 perform 1 from public.forum_sections where id=(p_input->>'section')::uuid and not archived for share;
 if not found then raise exception 'Choose an active section.'; end if;
 if nullif(p_input->>'state','') is not null and p_input->>'state' not in
 ('AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY') then raise exception 'Choose a valid state.'; end if;
 insert into public.forum_topics(author_id,section_id,title,body,state) values(v_user,(p_input->>'section')::uuid,btrim(p_input->>'title'),v_body,nullif(p_input->>'state','')) returning id into v_id;
 return jsonb_build_object('id',v_id);
 elsif op='edit_topic' then
 select * into v_topic from public.forum_topics where id=target::uuid for update;
 if v_topic.id is null or v_topic.author_id is distinct from v_user or v_topic.deleted_at is not null or v_topic.locked then raise exception 'Only the author can edit an open topic.' using errcode='42501'; end if;
 update public.forum_topics set title=btrim(p_input->>'title'),body=v_body,updated_at=now() where id=v_topic.id;
 elsif op='remove_own' then
 if kind='topic' then
 update public.forum_topics set deleted_at=now(),updated_at=now() where id=target::uuid and author_id=v_user and deleted_at is null;
 elsif kind='reply' then
 update public.forum_replies set deleted_at=now(),updated_at=now() where id=target::uuid and author_id=v_user and deleted_at is null;
 else raise exception 'Invalid content type.'; end if;
 if not found then raise exception 'Only the author can delete this content.' using errcode='42501'; end if;
 insert into public.forum_audit(actor_id,action,target_type,target_id,reason) values(v_user,'delete',kind,target,'Author removed own content');
 elsif op='reply' then
 select * into v_topic from public.forum_topics where id=target::uuid for update;
 if v_topic.id is null or v_topic.deleted_at is not null then raise exception 'Topic not found.'; end if;
 if v_topic.locked then raise exception 'This discussion is locked.'; end if;
 insert into public.forum_replies(topic_id,author_id,body) values(v_topic.id,v_user,v_body) returning id into v_id;
 return jsonb_build_object('id',v_id);
 elsif op='chat' then
 insert into public.forum_chat(author_id,body) values(v_user,v_body) returning id into v_chat;
 return jsonb_build_object('id',v_chat::text);
 elsif op='bookmark' then
 if not exists(select 1 from public.forum_topics where id=target::uuid and deleted_at is null) then raise exception 'Topic not found.'; end if;
 if (p_input->>'enabled')::boolean then insert into public.forum_bookmarks(user_id,topic_id) values(v_user,target::uuid) on conflict do nothing;
 else delete from public.forum_bookmarks where user_id=v_user and topic_id=target::uuid; end if;
 elsif op='report' then
 if kind='chat' then target:=(target::bigint)::text; else target:=(target::uuid)::text; end if;
 if not ((kind='topic' and exists(select 1 from public.forum_topics where id::text=target and deleted_at is null))
 or (kind='reply' and exists(select 1 from public.forum_replies r join public.forum_topics t on t.id=r.topic_id where r.id::text=target and r.deleted_at is null and t.deleted_at is null))
 or (kind='chat' and exists(select 1 from public.forum_chat where id::text=target and deleted_at is null))) then raise exception 'Content not found.'; end if;
 insert into public.forum_reports(reporter_id,target_type,target_id,reason) values(v_user,kind,target,reason) on conflict do nothing;
 elsif op in ('delete','restore','lock','unlock','pin','unpin','move','restrict','unrestrict','resolve','section_save','section_move') then
 if op like 'section_%' then
 if not v_manage then raise exception 'Forum manager permission required.' using errcode='42501'; end if;
 elsif not v_mod then raise exception 'Moderator permission required.' using errcode='42501'; end if;
 if reason is null or length(reason) not between 3 and 1000 then raise exception 'A reason of 3–1000 characters is required.'; end if;
 if op in ('restrict','unrestrict') then
 v_id:=target::uuid;
 perform pg_advisory_xact_lock(hashtextextended('forum:user:'||v_id::text,0));
 if not exists(select 1 from public.users where id=v_id) then raise exception 'Account not found.'; end if;
 if op='restrict' then
 if v_id=v_user or exists(select 1 from public.platform_admin_memberships where user_id=v_id and status='active') then raise exception 'Platform team accounts cannot be restricted here.'; end if;
 v_scope:=coalesce(p_input->>'scope','all');
 if nullif(p_input->>'days','') is not null then
 if (p_input->>'days')::int not between 1 and 365 then raise exception 'Duration must be 1–365 days.'; end if;
 v_expiry:=now()+make_interval(days=>(p_input->>'days')::int); end if;
 insert into public.forum_restrictions(user_id,scope,reason,expires_at,actor_id) values(v_id,v_scope,reason,v_expiry,v_user)
 on conflict(user_id) do update set scope=excluded.scope,reason=excluded.reason,expires_at=excluded.expires_at,actor_id=v_user,updated_at=now();
 else delete from public.forum_restrictions where user_id=v_id; end if;
 elsif op='resolve' then
 update public.forum_reports set resolved_at=now(),resolved_by=v_user where id=target::uuid and resolved_at is null;
 if not found then raise exception 'Open report not found.'; end if;
 elsif op='section_save' then
 perform pg_advisory_xact_lock(hashtextextended('forum:sections',0));
 if nullif(target,'') is null then
 insert into public.forum_sections(name,description,position) values(btrim(p_input->>'name'),coalesce(p_input->>'description',''),coalesce((select max(position)+1 from public.forum_sections),0)) returning id into v_id; target:=v_id::text;
 else update public.forum_sections set name=btrim(p_input->>'name'),description=coalesce(p_input->>'description',''),archived=coalesce((p_input->>'archived')::boolean,false) where id=target::uuid;
 if not found then raise exception 'Section not found.'; end if; end if;
 elsif op='section_move' then
 perform pg_advisory_xact_lock(hashtextextended('forum:sections',0));
 if p_input->>'direction' not in ('up','down') then raise exception 'Invalid direction.'; end if;
 -- Normalize positions then swap neighbors atomically; ties never produce unstable order.
 with ranked as(select id,(row_number() over(order by position,id)-1)::integer pos from public.forum_sections)
 update public.forum_sections s set position=r.pos from ranked r where s.id=r.id;
 select * into v_section from public.forum_sections where id=target::uuid;
 if v_section.id is null then raise exception 'Section not found.'; end if;
 v_chat:=v_section.position+case p_input->>'direction' when 'up' then -1 else 1 end;
 if exists(select 1 from public.forum_sections where position=v_chat) then
 update public.forum_sections set position=case when id=v_section.id then v_chat else v_section.position end where id=v_section.id or position=v_chat; end if;
 elsif kind='topic' then
 select * into v_topic from public.forum_topics where id=target::uuid for update;
 if v_topic.id is null then raise exception 'Topic not found.'; end if;
 if op='move' then
 perform 1 from public.forum_sections where id=(p_input->>'section')::uuid and not archived for share;
 if not found then raise exception 'Choose an active section.'; end if; end if;
 update public.forum_topics set deleted_at=case when op='delete' then now() when op='restore' then null else deleted_at end,
 locked=case when op='lock' then true when op='unlock' then false else locked end,
 pinned=case when op='pin' then true when op='unpin' then false else pinned end,
 section_id=case when op='move' then (p_input->>'section')::uuid else section_id end,updated_at=now() where id=v_topic.id;
 elsif kind='reply' and op in ('delete','restore') then
 update public.forum_replies set deleted_at=case when op='delete' then now() else null end,updated_at=now() where id=target::uuid;
 if not found then raise exception 'Reply not found.'; end if;
 elsif kind='chat' and op in ('delete','restore') then
 update public.forum_chat set deleted_at=case when op='delete' then now() else null end where id=target::bigint;
 if not found then raise exception 'Message not found.'; end if;
 else raise exception 'Invalid moderation action.'; end if;
 insert into public.forum_audit(actor_id,action,target_type,target_id,reason,details)
 values(v_user,op,coalesce(kind,case when op like 'section_%' then 'section' when op in ('restrict','unrestrict') then 'user' else 'report' end),target,reason,
 p_input-'body'-'reason'-'op');
 else raise exception 'Unknown forum action.'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.forum_read(jsonb),public.forum_write(jsonb) from public,anon;
grant execute on function public.forum_read(jsonb),public.forum_write(jsonb) to authenticated;
commit;
