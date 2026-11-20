-- Persist every report reason and guest hiding; reads use the signed browser identity.
create table public.post_safety_guest_hidden (
 guest_key uuid not null, source_type text not null, source_id uuid not null,
 created_at timestamptz not null default now(), primary key(guest_key,source_type,source_id)
);
alter table public.post_safety_guest_hidden enable row level security;
revoke all on public.post_safety_guest_hidden from anon,authenticated;
insert into public.post_safety_guest_hidden(guest_key,source_type,source_id)
select guest_key,source_type,source_id from public.post_safety_cases where origin='user' and guest_key is not null on conflict do nothing;

create or replace function public.post_safety_action_unchecked(p_type text,p_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public as $$
declare tbl text:=public.post_safety_table(p_type); item jsonb; uid uuid:=public.current_public_user_id(); owner boolean; feature boolean; reason text:=p_payload->>'reason'; guest uuid; case_id uuid; report_id uuid;
begin
 if tbl is null then raise exception 'Invalid post type.'; end if;
 execute format('select to_jsonb(p) from public.%I p where id=$1 for update',tbl) into item using p_id;
 if item is null then raise exception 'Post not found.'; end if;
 owner:=uid is not null and ((item->>'author_user_id')::uuid=uid or (item->>'created_by_user_id')::uuid=uid or (p_type<>'beauty_post' and public.user_can_manage_salon((item->>'salon_id')::uuid)));
 feature:=owner and not (item->>'safety_hold')::boolean and ((p_type in ('salon_profile_look','salon_profile_update') and item->>'media_path' is not null and item->>'status'='published') or (p_type='beauty_post' and exists(select 1 from beauty_post_media where post_id=p_id)));
 if p_action='permissions' then return jsonb_build_object('canManage',coalesce(owner,false),'canFeature',coalesce(feature,false)); end if;
 if p_action in ('report','hide') then
  if not coalesce(owner,false) and ((p_type='beauty_post' and (item->>'visibility'<>'public' or item->>'moderation_status'<>'visible' or item->>'deleted_at' is not null)) or (p_type<>'beauty_post' and item->>'status'<>'published')) then raise exception 'Post is unavailable.'; end if;
  if uid is not null then insert into public.post_safety_hidden values(uid,p_type,p_id,now()) on conflict do nothing; end if;
  if p_action='hide' then return '{"hidden":true}'::jsonb; end if;
  if reason not in ('minor_safety','harassment','self_harm','violence','restricted_items','sexual','scam','intellectual_property','unwanted') then raise exception 'Choose a report reason.'; end if;
  guest:=nullif(p_payload->>'guestId','')::uuid;
  if uid is null and guest is null then raise exception 'Report session is required.'; end if;
  if exists(select 1 from post_safety_cases where origin='user' and source_type=p_type and source_id=p_id and (reporter_user_id=uid or (uid is null and guest_key=guest))) then return '{"hidden":true}'::jsonb; end if;
  if (select count(*) from post_safety_cases where origin='user' and created_at>now()-interval '1 hour' and (reporter_user_id=uid or (uid is null and guest_key=guest)))>=10 then raise exception 'Too many reports. Please try again later.'; end if;
  insert into public.platform_reports(category,summary,description,source,reporter_user_id,subject_user_id,priority)
  values('post_content','Post report: '||reason,p_type||':'||p_id::text,'user_post_report',uid,(item->>'author_user_id')::uuid,case when reason in ('minor_safety','self_harm') then 'urgent' else 'normal' end) returning id into report_id;
  insert into public.post_safety_cases(source_type,source_id,origin,reason,content_snapshot,author_user_id,reporter_user_id,guest_key,platform_report_id)
  values(p_type,p_id,'user',reason,item,(item->>'author_user_id')::uuid,uid,case when uid is null then guest else null end,report_id);
  return '{"hidden":true}'::jsonb;
 end if;
 if not coalesce(owner,false) then raise exception 'You cannot manage this post.'; end if;
 if exists(select 1 from public.users where id=uid and status in ('suspended','deleted')) then raise exception 'Account is restricted.'; end if;
 if p_action='edit' then
  if length(coalesce(p_payload->>'caption',''))>2200 then raise exception 'Caption is too long.'; end if;
  execute format('update public.%I set caption=$1 where id=$2',tbl) using p_payload->>'caption',p_id;
 elsif p_action='archive' then
  if p_type='beauty_post' then update public.beauty_posts set visibility='self' where id=p_id;
  else execute format('update public.%I set status=''archived'' where id=$1',tbl) using p_id; end if;
 elsif p_action='delete' then
  if p_type='beauty_post' then update public.beauty_posts set deleted_at=now() where id=p_id;
  else execute format('delete from public.%I where id=$1',tbl) using p_id; end if;
 elsif p_action='feature' and feature and p_type='salon_profile_update' then
  update public.salon_settings set public_profile_cover_path=item->>'media_path' where salon_id=(item->>'salon_id')::uuid;
 elsif p_action='feature' and feature and p_type='salon_profile_look' then
  if (item->>'safety_hold')::boolean then raise exception 'Post is awaiting review.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(item->>'salon_id',7));
  if not (item->>'is_pinned')::boolean then update public.salon_profile_looks set is_pinned=false where salon_id=(item->>'salon_id')::uuid and id<>p_id and is_pinned; end if;
  update public.salon_profile_looks set is_pinned=not is_pinned where id=p_id;
 else raise exception 'Invalid post action.'; end if;
 return '{"ok":true}'::jsonb;
end; $$;
revoke all on function public.post_safety_action_unchecked(text,uuid,text,jsonb) from public,anon,authenticated;
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
 return result;
end; $$;
revoke all on function public.post_safety_action(text,uuid,text,jsonb) from public;
grant execute on function public.post_safety_action(text,uuid,text,jsonb) to anon,authenticated;
create function public.get_my_hidden_posts() returns table(source_type text,source_id uuid)
language plpgsql security definer set search_path=public as $$
declare uid uuid:=current_public_user_id(); ctx jsonb; guest uuid;
begin
 if uid is not null then
  return query select h.source_type,h.source_id from post_safety_hidden h where h.user_id=uid;
 else
  ctx:=abuse_signed_context();
  if ctx->>'device' is null then return; end if;
  guest:=substr(ctx->>'device',1,32)::uuid;
  return query select h.source_type,h.source_id from post_safety_guest_hidden h where h.guest_key=guest;
 end if;
end; $$;
revoke all on function public.get_my_hidden_posts() from public;
grant execute on function public.get_my_hidden_posts() to anon,authenticated;
