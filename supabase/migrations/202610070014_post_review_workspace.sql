-- Operational workspace: permission-checked facts, related cases and audit history.
create function public.get_admin_post_review_workspace(p_origin text default 'user', p_case_id uuid default null, p_report_id uuid default null, p_offset int default 0, p_post text default '', p_author uuid default null, p_reporter uuid default null, p_status text default 'pending', p_query text default '', p_reason text default 'all', p_sort text default 'newest') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.post_safety_cases; item jsonb; media jsonb; result jsonb:='[]'; author uuid; salon uuid; post_visibility text; total bigint;
begin
 if not platform_admin_has_permission('admin.reports.read') then raise exception 'Permission denied.'; end if;
 if p_origin not in ('user','automatic') then raise exception 'Invalid queue.'; end if;
 select count(*) into total from post_safety_cases where origin=p_origin
    and (p_post='' or source_type||':'||source_id::text=p_post)
    and (p_author is null or author_user_id=p_author) and (p_reporter is null or reporter_user_id=p_reporter)
    and (p_status='all' or (p_status='resolved' and status<>'pending') or status=p_status)
    and (p_reason='all' or reason=p_reason)
    and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',id::text,platform_report_id::text,source_id::text,reason,content_snapshot->>'title',content_snapshot->>'caption',
      (select display_name from users where id=author_user_id),(select display_name from users where id=reporter_user_id))))>0);
 for c in select * from post_safety_cases where id in (
  select id from post_safety_cases where origin=p_origin
    and (p_post='' or source_type||':'||source_id::text=p_post)
    and (p_author is null or author_user_id=p_author) and (p_reporter is null or reporter_user_id=p_reporter)
    and (p_status='all' or (p_status='resolved' and status<>'pending') or status=p_status)
    and (p_reason='all' or reason=p_reason)
    and (p_query='' or position(lower(p_query) in lower(concat_ws(' ',id::text,platform_report_id::text,source_id::text,reason,content_snapshot->>'title',content_snapshot->>'caption',
      (select display_name from users where id=author_user_id),(select display_name from users where id=reporter_user_id))))>0)
  order by case when p_sort='oldest' then created_at end asc,case when p_sort<>'oldest' then created_at end desc,id
  limit 200 offset greatest(0,least(p_offset,100000))
 ) or id=p_case_id or (p_report_id is not null and platform_report_id=p_report_id)
 order by created_at desc loop
  execute format('select to_jsonb(p) from public.%I p where id=$1',post_safety_table(c.source_type)) into item using c.source_id;
  author:=coalesce(c.author_user_id,nullif(item->>'author_user_id','')::uuid,nullif(item->>'created_by_user_id','')::uuid);
  salon:=coalesce(nullif(item->>'salon_id','')::uuid,nullif(c.content_snapshot->>'salon_id','')::uuid);
  post_visibility:=case
   when item is null or item->>'deleted_at' is not null then 'deleted'
   when coalesce((item->>'safety_hold')::boolean,false) then 'held'
   when c.source_type='beauty_post' and (item->>'visibility'<>'public' or item->>'moderation_status'<>'visible') then 'private'
   when c.source_type<>'beauty_post' and item->>'status'<>'published' then coalesce(item->>'status','private')
   else 'public' end;
  if c.source_type='beauty_post' then
   select coalesce(jsonb_agg(jsonb_build_object('bucket','beauty-profile-media','path',m.object_path,'mime',to_jsonb(m)->>'mime_type') order by coalesce((to_jsonb(m)->>'display_order')::int,0)),'[]') into media from beauty_post_media m where m.post_id=c.source_id;
  else
   media:=case when coalesce(item->>'media_path',c.content_snapshot->>'media_path') is not null then jsonb_build_array(jsonb_build_object('bucket','salon-profile-media','path',coalesce(item->>'media_path',c.content_snapshot->>'media_path'))) else '[]'::jsonb end;
  end if;
  result:=result||jsonb_build_array((to_jsonb(c)-'guest_key'-'reporter_device_hash')||jsonb_build_object(
   'author_user_id',author,'author_name',(select coalesce(nullif(display_name,''),'Account') from users where id=author),
   'reporter_name',(select coalesce(nullif(display_name,''),'Account') from users where id=c.reporter_user_id),
   'author_status',(select status from users where id=author),'reporter_status',(select status from users where id=c.reporter_user_id),
   'author_created_at',(select created_at from users where id=author),
   'salon_name',(select name from locations where id=salon),
   'can_restrict_guest',c.reporter_user_id is null and c.reporter_device_hash is not null,
   'current_post',item,'media',media,'post_visibility',post_visibility,
   'hidden_for_reporter',case when c.origin<>'user' then false when c.reporter_user_id is not null then exists(select 1 from post_safety_hidden where user_id=c.reporter_user_id and source_type=c.source_type and source_id=c.source_id) else exists(select 1 from post_safety_guest_hidden where guest_key=c.guest_key and source_type=c.source_type and source_id=c.source_id) end,
   'related_post_count',(select count(*) from post_safety_cases r where r.origin='user' and r.source_type=c.source_type and r.source_id=c.source_id),
   'related_author_count',(select count(*) from post_safety_cases r where author is not null and r.author_user_id=author),
   'related_reporter_count',(select count(*) from post_safety_cases r where c.reporter_user_id is not null and r.reporter_user_id=c.reporter_user_id),
   'automatic_pending_count',(select count(*) from post_safety_cases r where r.origin='automatic' and r.status='pending' and r.source_type=c.source_type and r.source_id=c.source_id),
   'related_cases',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,origin,reason,status,created_at from post_safety_cases r where r.source_type=c.source_type and r.source_id=c.source_id order by created_at desc limit 30) r),
   'decisions',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from (select d.id,d.case_id,d.action,d.reason,d.created_at,u.display_name actor_name from post_safety_decisions d left join users u on u.id=d.actor_user_id where d.case_id in (select r.id from post_safety_cases r where r.source_type=c.source_type and r.source_id=c.source_id) order by d.created_at desc limit 50) d),
   'restrictions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select id,scope,mode,reason,expires_at,
    case when scope='account' and identifier=author::text then 'author' else 'reporter' end target
    from abuse_restrictions where revoked_at is null and expires_at>now() and
     ((scope='account' and identifier in (author::text,c.reporter_user_id::text)) or (scope='device' and identifier=c.reporter_device_hash)) order by created_at desc) r)
  ));
 end loop;
 return jsonb_build_object('cases',result,
  'user_count',(select count(*) from post_safety_cases where origin='user' and status='pending'),
  'automatic_count',(select count(*) from post_safety_cases where origin='automatic' and status='pending'),
  'total_count',total,
  'has_more',total>greatest(0,p_offset)+200);
end; $$;
revoke all on function public.get_admin_post_review_workspace(text,uuid,uuid,int,text,uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.get_admin_post_review_workspace(text,uuid,uuid,int,text,uuid,uuid,text,text,text,text) to authenticated;
