-- Additive forum follows, existing notification center integration and actual account avatars.
begin;
create table public.forum_subscriptions (
 user_id uuid not null references public.users(id) on delete cascade,
 topic_id uuid not null references public.forum_topics(id) on delete cascade,
 enabled boolean, last_read_at timestamptz, updated_at timestamptz not null default now(), primary key(user_id,topic_id)
);
create index forum_subscriptions_topic on public.forum_subscriptions(topic_id,user_id) where enabled;
alter table public.forum_subscriptions enable row level security;
revoke all on public.forum_subscriptions from public,anon,authenticated;
create index forum_participation on public.forum_replies(author_id,topic_id) where deleted_at is null;
create function public.forum_is_following(p_user uuid,p_topic uuid) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select enabled from public.forum_subscriptions where user_id=p_user and topic_id=p_topic),
 coalesce((select author_id=p_user from public.forum_topics where id=p_topic),false) or exists(select 1 from public.forum_replies where topic_id=p_topic and author_id=p_user and deleted_at is null));
$$;
revoke all on function public.forum_is_following(uuid,uuid) from public,anon,authenticated;
create or replace function public.forum_read(p_input jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_user uuid:=public.forum_actor(); mode text:=coalesce(p_input->>'mode','feed');
 v_mod boolean:=public.platform_admin_has_permission('admin.forum.moderate'); v_manage boolean:=public.platform_admin_has_permission('admin.forum.manage');
 result jsonb; v_topic uuid; v_before timestamptz; v_after timestamptz; v_cursor uuid; begin
 if mode='context' then
 return jsonb_build_object('user_id',v_user,'can_moderate',v_mod,'can_manage',v_manage,
 'display_name',(select coalesce(nullif(display_name,''),'Owner') from public.users where id=v_user),
 'restriction',(select to_jsonb(x)-'actor_id' from public.forum_restrictions x where user_id=v_user and (expires_at is null or expires_at>now())),
 'sections',coalesce((select jsonb_agg(to_jsonb(s) order by position,id) from public.forum_sections s where not archived or v_manage),'[]'::jsonb));
 elsif mode in ('feed','saved','following','mine','removed') then
 if mode='removed' and not v_mod then raise exception 'Moderator permission required.' using errcode='42501'; end if;
 v_before:=nullif(p_input->>'before','')::timestamptz; v_cursor:=nullif(p_input->>'cursor_id','')::uuid;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.pinned desc,x.created_at desc,x.id desc),'[]') into result from (
 select t.id,t.author_id,t.section_id,t.title,left(t.body,240) body,t.state,t.pinned,t.locked,t.deleted_at,t.created_at,t.updated_at,
 coalesce(nullif(u.display_name,''),p.display_name,'Owner') author_name, nullif(to_jsonb(u)->>'avatar_url','') author_avatar,
 (select count(*) from public.forum_replies r where r.topic_id=t.id and r.deleted_at is null) reply_count,
 exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user) bookmarked, public.forum_is_following(v_user,t.id) following, (select count(*) from public.forum_replies ur where ur.topic_id=t.id and ur.deleted_at is null and ur.author_id is distinct from v_user and ur.created_at>coalesce((select last_read_at from public.forum_subscriptions where user_id=v_user and topic_id=t.id),t.created_at)) unread_replies
 from public.forum_topics t left join public.users u on u.id=t.author_id left join public.forum_seed_personas p on p.id=t.seed_persona_id
 where ((mode='removed' and t.deleted_at is not null) or (mode<>'removed' and t.deleted_at is null))
 and (mode<>'saved' or exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user))
 and (mode<>'mine' or t.author_id=v_user)
 and (mode<>'following' or public.forum_is_following(v_user,t.id))
 and (nullif(p_input->>'exclude_id','') is null or t.id<>(p_input->>'exclude_id')::uuid)
 and (nullif(p_input->>'section','') is null or t.section_id=(p_input->>'section')::uuid)
 and (nullif(p_input->>'state','') is null or t.state=p_input->>'state')
 and (nullif(btrim(left(p_input->>'q',150)),'') is null or t.search_vector @@ websearch_to_tsquery('simple',left(p_input->>'q',150)))
 and (coalesce(p_input->>'unanswered','false')<>'true' or not exists(select 1 from public.forum_replies r where r.topic_id=t.id and r.deleted_at is null))
 and (v_before is null or (t.pinned,t.created_at,t.id)<(coalesce((p_input->>'before_pinned')::boolean,false),v_before,coalesce(v_cursor,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by t.pinned desc,t.created_at desc,t.id desc limit 21) x;
 return result;
 elsif mode='topic' then
 v_topic:=(p_input->>'id')::uuid;
 select to_jsonb(x) into result from (select t.id,t.author_id,t.section_id,t.title,t.body,t.state,t.pinned,t.locked,t.deleted_at,t.created_at,t.updated_at,coalesce(nullif(u.display_name,''),p.display_name,'Owner') author_name, nullif(to_jsonb(u)->>'avatar_url','') author_avatar,
 exists(select 1 from public.forum_bookmarks b where b.topic_id=t.id and b.user_id=v_user) bookmarked, public.forum_is_following(v_user,t.id) following, (select count(*) from public.forum_replies ur where ur.topic_id=t.id and ur.deleted_at is null and ur.author_id is distinct from v_user and ur.created_at>coalesce((select last_read_at from public.forum_subscriptions where user_id=v_user and topic_id=t.id),t.created_at)) unread_replies
 from public.forum_topics t left join public.users u on u.id=t.author_id left join public.forum_seed_personas p on p.id=t.seed_persona_id where t.id=v_topic and (t.deleted_at is null or v_mod)) x;
 if result is null then raise exception 'Topic not found.' using errcode='P0002'; end if;
 v_after:=nullif(p_input->>'after','')::timestamptz; v_cursor:=nullif(p_input->>'cursor_id','')::uuid;
 if v_after is null and nullif(p_input->>'reply_id','') is not null then
 select created_at,id into v_after,v_cursor from public.forum_replies where id=(p_input->>'reply_id')::uuid and topic_id=v_topic and (deleted_at is null or v_mod);
 end if;
 return jsonb_build_object('topic',result,'replies',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select r.*,coalesce(nullif(u.display_name,''),p.display_name,'Owner') author_name, nullif(to_jsonb(u)->>'avatar_url','') author_avatar from public.forum_replies r left join public.users u on u.id=r.author_id left join public.forum_seed_personas p on p.id=r.seed_persona_id
 where r.topic_id=v_topic and (r.deleted_at is null or v_mod)
 and (v_after is null or (r.created_at,r.id)>(v_after,coalesce(v_cursor,'00000000-0000-0000-0000-000000000000'::uuid)) or (nullif(p_input->>'after','') is null and r.id=nullif(p_input->>'reply_id','')::uuid))
 order by r.created_at,r.id limit 31) x),'[]'::jsonb));
 elsif mode='chat' then
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.id::bigint) from (
 select c.id::text id,c.author_id,c.body,c.created_at,nullif(to_jsonb(u)->>'avatar_url','') author_avatar,coalesce(nullif(u.display_name,''),'Owner') author_name
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
 else return coalesce((select jsonb_agg(to_jsonb(x) order by x.id::bigint desc) from (
 select a.id::text id,a.action,a.target_type,a.target_id,a.reason,a.details,a.created_at,coalesce(u.display_name,'Moderator') actor_name
 from public.forum_audit a left join public.users u on u.id=a.actor_id order by a.id desc limit 50) x),'[]'::jsonb); end if;
 end if;
 raise exception 'Unknown forum view.';
end $$;

-- Extend the CURRENT writer in place, retaining moderation/revocation and numeric section ordering fixes.
do $patch$ declare definition text; marker text:='if op=''topic'' then'; begin
 definition:=pg_get_functiondef('public.forum_write(jsonb)'::regprocedure);
 if position(marker in definition)=0 then raise exception 'Forum writer changed; rebase follow branch before applying.';end if;
 definition:=replace(definition,marker,$branch$if op in ('follow','seen') then
 if not exists(select 1 from public.forum_topics where id=target::uuid and deleted_at is null) then raise exception 'Topic not found.';end if;
 perform pg_advisory_xact_lock(hashtextextended('forum:follow:'||v_user::text||':'||target,0));
 if op='follow' then
 if not (p_input ? 'enabled') or jsonb_typeof(p_input->'enabled')<>'boolean' then raise exception 'Choose a valid follow preference.';end if;
 insert into public.forum_subscriptions(user_id,topic_id,enabled) values(v_user,target::uuid,(p_input->>'enabled')::boolean)
 on conflict(user_id,topic_id) do update set enabled=excluded.enabled,updated_at=now();
 else insert into public.forum_subscriptions(user_id,topic_id,last_read_at) values(v_user,target::uuid,now())
 on conflict(user_id,topic_id) do update set last_read_at=greatest(public.forum_subscriptions.last_read_at,excluded.last_read_at),updated_at=now();end if;
 elsif op='topic' then$branch$);
 execute definition;
end $patch$;
alter table public.notification_preferences drop constraint notification_preferences_category_check;
alter table public.notification_preferences add constraint notification_preferences_category_check check(category in ('booking','reminders','receipts','check_in','comments','team','likes','following','marketing','forum'));
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('public.notification_category(text)'::regprocedure);
 if position('select case when' in definition)=0 then raise exception 'Notification category changed; rebase category mapping.';end if;
 execute replace(definition,'select case when','select case when p_type like ''forum_%'' then ''forum'' when');
end $patch$;
alter table public.app_notifications add column forum_topic_id uuid references public.forum_topics(id) on delete set null;
create unique index forum_unread_notification on public.app_notifications(recipient_user_id,forum_topic_id) where notification_type='forum_reply' and read_at is null;
create function public.forum_notify_reply() returns trigger language plpgsql security definer set search_path=public as $$
declare topic public.forum_topics;begin
 if new.author_id is null or new.deleted_at is not null then return new;end if;
 select * into topic from public.forum_topics where id=new.topic_id;
 if topic.deleted_at is not null then return new;end if;
 insert into public.app_notifications(recipient_user_id,recipient_kind,notification_type,title,body,href,event_key,forum_topic_id)
 select recipient.id,'owner_manager','forum_reply',coalesce(nullif(author.display_name,''),'Owner')||' đã trả lời một chủ đề bạn theo dõi',left(topic.title,180),
 '/forum?topic='||topic.id||'&reply='||new.id,'forum-reply:'||new.id,topic.id
 from (select topic.author_id id union select author_id from public.forum_replies where topic_id=topic.id and deleted_at is null union select user_id from public.forum_subscriptions where topic_id=topic.id and enabled) candidates
 join public.users recipient on recipient.id=candidates.id and recipient.status='active'
 join public.users author on author.id=new.author_id
 where recipient.id<>new.author_id and public.forum_is_following(recipient.id,topic.id)
 and public.notification_delivery_enabled(recipient.id,'forum_reply','owner_manager')
 and (exists(select 1 from public.salon_memberships m join public.roles r on r.id=m.role_id where m.user_id=recipient.id and m.status='active' and upper(r.code)='OWNER')
 or exists(select 1 from public.platform_admin_memberships m join public.platform_admin_role_permissions rp on rp.role_id=m.role_id join public.platform_admin_permissions p on p.id=rp.permission_id where m.user_id=recipient.id and m.status='active' and p.code in ('admin.forum.moderate','admin.forum.manage')))
 on conflict(recipient_user_id,forum_topic_id) where notification_type='forum_reply' and read_at is null
 do update set title=excluded.title,body=excluded.body,href=excluded.href,event_key=excluded.event_key,created_at=excluded.created_at;
 return new;
end $$;
revoke all on function public.forum_notify_reply() from public,anon,authenticated;
create trigger forum_reply_notification after insert on public.forum_replies for each row execute function public.forum_notify_reply();
revoke all on function public.forum_read(jsonb) from public,anon;
grant execute on function public.forum_read(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
