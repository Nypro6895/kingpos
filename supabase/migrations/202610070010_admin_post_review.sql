-- Admin post review: content previews and separate content/account decisions.
alter table public.post_safety_cases add column reporter_device_hash text;
update public.post_safety_cases set author_user_id=coalesce(nullif(content_snapshot->>'author_user_id','')::uuid,nullif(content_snapshot->>'created_by_user_id','')::uuid) where author_user_id is null;
create or replace function public.post_safety_action(p_type text,p_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare ctx jsonb; guest uuid; result jsonb;
begin
 if p_action in ('report','hide') then
  if p_action='report' then ctx:=abuse_guard_actor('report'); else ctx:=abuse_signed_context(); end if;
  if ctx->>'device' is not null then
   guest:=substr(ctx->>'device',1,32)::uuid;
   p_payload:=p_payload||jsonb_build_object('guestId',guest::text);
  end if;
 end if;
 result:=post_safety_action_unchecked(p_type,p_id,p_action,p_payload);
 if p_action in ('report','hide') and guest is not null and current_public_user_id() is null then
  insert into post_safety_guest_hidden(guest_key,source_type,source_id) values(guest,p_type,p_id) on conflict do nothing;
 end if;
 if p_action='report' and ctx->>'device' is not null and current_public_user_id() is null then
  update post_safety_cases set reporter_device_hash=ctx->>'device' where origin='user' and source_type=p_type and source_id=p_id and guest_key=guest;
 end if;
 return result;
end; $$;

alter function public.admin_review_post_safety(uuid,text,text) rename to admin_review_post_safety_content;
revoke all on function public.admin_review_post_safety_content(uuid,text,text) from public,anon,authenticated;
create function public.admin_review_post_safety(p_case_id uuid,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.post_safety_cases; target uuid; result jsonb;
begin
 if not platform_admin_has_permission('admin.reports.update') then raise exception 'Permission denied.'; end if;
 if length(btrim(p_reason))<3 then raise exception 'A review reason is required.'; end if;
 select * into c from post_safety_cases where id=p_case_id for update;
 if not found or c.status<>'pending' then raise exception 'Case is no longer pending.'; end if;
 if p_action in ('suspend_author','suspend_reporter') then
  target:=case when p_action='suspend_author' then c.author_user_id else c.reporter_user_id end;
  if target is not null then
   perform admin_set_user_access(target,p_reason,true);
  elsif p_action='suspend_reporter' and c.reporter_device_hash is not null then
   perform admin_abuse_restriction('device',c.reporter_device_hash,'deny',24,p_reason);
  else raise exception 'This account or guest device is unavailable.';
  end if;
  insert into post_safety_decisions(case_id,actor_user_id,action,reason) values(c.id,current_public_user_id(),p_action,p_reason);
  return jsonb_build_object('ok',true);
 end if;
 if p_action='keep_public' and c.origin='user' then
  if c.reporter_user_id is not null then insert into post_safety_hidden values(c.reporter_user_id,c.source_type,c.source_id,now()) on conflict do nothing;
  elsif c.guest_key is not null then insert into post_safety_guest_hidden(guest_key,source_type,source_id) values(c.guest_key,c.source_type,c.source_id) on conflict do nothing; end if;
 end if;
 if p_action='keep_public' then
  if c.origin='automatic' then p_action:='allow'; else p_action:='dismiss'; end if;
 end if;
 return admin_review_post_safety_content(p_case_id,p_action,p_reason);
end; $$;
revoke all on function public.admin_review_post_safety(uuid,text,text) from public,anon;
grant execute on function public.admin_review_post_safety(uuid,text,text) to authenticated;

create function public.get_admin_post_safety_cases(p_origin text default 'user',p_report_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare c public.post_safety_cases; item jsonb; media jsonb; result jsonb:='[]'; author uuid;
begin
 if not platform_admin_has_permission('admin.reports.read') then raise exception 'Permission denied.'; end if;
 for c in select * from post_safety_cases where
  (p_report_id is not null and platform_report_id=p_report_id) or
  (p_report_id is null and origin=p_origin and status='pending') order by created_at desc limit 100 loop
  execute format('select to_jsonb(p) from public.%I p where id=$1',post_safety_table(c.source_type)) into item using c.source_id;
  author:=coalesce(c.author_user_id,nullif(item->>'author_user_id','')::uuid,nullif(item->>'created_by_user_id','')::uuid);
  if c.source_type='beauty_post' then
   select coalesce(jsonb_agg(jsonb_build_object('bucket','beauty-profile-media','path',m.object_path,'mime',to_jsonb(m)->>'mime_type') order by coalesce((to_jsonb(m)->>'display_order')::int,0)),'[]') into media from beauty_post_media m where m.post_id=c.source_id;
  else
   media:=case when coalesce(item->>'media_path',c.content_snapshot->>'media_path') is not null then jsonb_build_array(jsonb_build_object('bucket','salon-profile-media','path',coalesce(item->>'media_path',c.content_snapshot->>'media_path'))) else '[]'::jsonb end;
  end if;
  result:=result||jsonb_build_array((to_jsonb(c)-'guest_key'-'reporter_device_hash')||jsonb_build_object(
    'author_user_id',author,'author_name',(select coalesce(nullif(display_name,''),'Account') from users where id=author),
    'reporter_name',(select coalesce(nullif(display_name,''),'Account') from users where id=c.reporter_user_id),
    'can_restrict_guest',c.reporter_user_id is null and c.reporter_device_hash is not null,
    'current_post',item,'media',media));
 end loop;
 return result;
end; $$;
revoke all on function public.get_admin_post_safety_cases(text,uuid) from public,anon;
grant execute on function public.get_admin_post_safety_cases(text,uuid) to authenticated;
