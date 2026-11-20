-- IDs stay strings on the wire to preserve bigint precision. Sort numerically in PostgreSQL.
begin;
create or replace function public.forum_read(p_input jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path=public as $$
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
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.id::bigint) from (
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
 else return coalesce((select jsonb_agg(to_jsonb(x) order by x.id::bigint desc) from (
 select a.id::text id,a.action,a.target_type,a.target_id,a.reason,a.details,a.created_at,coalesce(u.display_name,'Moderator') actor_name
 from public.forum_audit a left join public.users u on u.id=a.actor_id order by a.id desc limit 50) x),'[]'::jsonb); end if;
 end if;
 raise exception 'Unknown forum view.';
end $$;
revoke all on function public.forum_read(jsonb) from public,anon;
grant execute on function public.forum_read(jsonb) to authenticated;
commit;
