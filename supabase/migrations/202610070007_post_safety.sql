-- Post safety: user reports never change global visibility. Automatic holds do.
create table public.post_safety_keywords (
 id uuid primary key default gen_random_uuid(), phrase text not null unique,
 category text not null check(category in ('violence','sexual','harassment','scam','minor_safety')),
 enabled boolean not null default true,
 check(length(btrim(phrase)) between 3 and 100)
);
insert into public.post_safety_keywords(phrase,category) values
 ('sexual','sexual'),('porn','sexual'),('pornography','sexual'),('nude','sexual'),
 ('violence','violence'),('violent','violence'),('kill you','violence'),
 ('khiêu dâm','sexual'),('bạo lực','violence');

create table public.post_safety_cases (
 id uuid primary key default gen_random_uuid(),
 source_type text not null check(source_type in ('beauty_post','salon_profile_look','salon_profile_update')),
 source_id uuid not null,
 origin text not null check(origin in ('user','automatic')),
 reason text not null,
 matched_keywords text[] not null default '{}',
 content_snapshot jsonb not null,
 author_user_id uuid references public.users(id) on delete set null,
 reporter_user_id uuid references public.users(id) on delete set null,
 guest_key uuid,
 platform_report_id uuid references public.platform_reports(id),
 status text not null default 'pending' check(status in ('pending','allowed','deleted','blocked','dismissed')),
 resolution text, reviewed_by uuid references public.users(id), reviewed_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index post_safety_pending_automatic on public.post_safety_cases(source_type,source_id) where origin='automatic' and status='pending';
create index post_safety_queue on public.post_safety_cases(origin,status,created_at desc);
create table public.post_safety_hidden (
 user_id uuid not null references public.users(id) on delete cascade,
 source_type text not null, source_id uuid not null, created_at timestamptz not null default now(),
 primary key(user_id,source_type,source_id)
);
create table public.post_safety_decisions (
 id uuid primary key default gen_random_uuid(), case_id uuid not null references public.post_safety_cases(id),
 actor_user_id uuid references public.users(id), action text not null, reason text not null,
 created_at timestamptz not null default now()
);
alter table public.beauty_posts add column safety_hold boolean not null default false;
alter table public.salon_profile_looks add column safety_hold boolean not null default false;
alter table public.salon_profile_updates add column safety_hold boolean not null default false;

alter table public.post_safety_keywords enable row level security;
alter table public.post_safety_cases enable row level security;
alter table public.post_safety_hidden enable row level security;
alter table public.post_safety_decisions enable row level security;
create policy safety_keywords_admin on public.post_safety_keywords for select to authenticated using(public.platform_admin_has_permission('admin.reports.read'));
create policy safety_cases_admin on public.post_safety_cases for select to authenticated using(public.platform_admin_has_permission('admin.reports.read'));
create policy safety_hidden_owner on public.post_safety_hidden for select to authenticated using(user_id=public.current_public_user_id());
create policy safety_decisions_admin on public.post_safety_decisions for select to authenticated using(public.platform_admin_has_permission('admin.reports.read'));
grant select on public.post_safety_keywords,public.post_safety_cases,public.post_safety_hidden,public.post_safety_decisions to authenticated;

create function public.post_safety_table(p_type text) returns text
language plpgsql immutable set search_path=public as $$
begin
 return case p_type when 'beauty_post' then 'beauty_posts' when 'salon_profile_look' then 'salon_profile_looks' when 'salon_profile_update' then 'salon_profile_updates' else null end;
end; $$;

create function public.post_safety_scan() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); old_data jsonb; content text; matches text[]; kind text; original_state text;
begin
 if tg_op='UPDATE' then
  old_data:=to_jsonb(old);
  if row_data->>'caption' is not distinct from old_data->>'caption' and row_data->>'title' is not distinct from old_data->>'title' then
   -- Authors cannot bypass an existing hold by changing publication flags.
   if old.safety_hold and not public.platform_admin_has_permission('admin.reports.update') then
    new.safety_hold:=true;
    if tg_table_name='beauty_posts' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
    else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
   end if;
   return new;
  end if;
 end if;
 content:=lower(coalesce(row_data->>'title','')||' '||coalesce(row_data->>'caption',''));
 select array_agg(phrase) into matches from public.post_safety_keywords
 where enabled and strpos(content,lower(phrase))>0;
 if matches is null then
  -- An edit never releases a hold; an administrator must approve it.
  if tg_op='UPDATE' and old.safety_hold then
   new.safety_hold:=true;
   if tg_table_name='beauty_posts' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
   else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
  end if;
  return new;
 end if;
 kind:=case tg_table_name when 'beauty_posts' then 'beauty_post' when 'salon_profile_looks' then 'salon_profile_look' else 'salon_profile_update' end;
 original_state:=case when tg_table_name='beauty_posts' then row_data->>'visibility' else row_data->>'status' end;
 new.safety_hold:=true;
 if tg_table_name='beauty_posts' then new:=jsonb_populate_record(new,jsonb_build_object('visibility','self'));
 else new:=jsonb_populate_record(new,jsonb_build_object('status','draft')); end if;
 insert into public.post_safety_cases(source_type,source_id,origin,reason,matched_keywords,content_snapshot,author_user_id)
 values(kind,new.id,'automatic','Keyword match',matches,row_data,(row_data->>'author_user_id')::uuid)
 on conflict(source_type,source_id) where origin='automatic' and status='pending'
 do update set matched_keywords=excluded.matched_keywords,
 content_snapshot=excluded.content_snapshot || jsonb_build_object(
 'visibility',post_safety_cases.content_snapshot->>'visibility','status',post_safety_cases.content_snapshot->>'status');
 return new;
end; $$;
create trigger post_safety_scan before insert or update on public.beauty_posts for each row execute function public.post_safety_scan();
create trigger post_safety_scan before insert or update on public.salon_profile_looks for each row execute function public.post_safety_scan();
create trigger post_safety_scan before insert or update on public.salon_profile_updates for each row execute function public.post_safety_scan();

create function public.post_safety_action(p_type text,p_id uuid,p_action text,p_payload jsonb default '{}') returns jsonb
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
  if reason not in ('minor_safety','harassment','self_harm','violence','restricted_items','sexual','scam','intellectual_property') then raise exception 'Choose a report reason.'; end if;
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
revoke all on function public.post_safety_table(text),public.post_safety_scan(),public.post_safety_action(text,uuid,text,jsonb) from public;
grant execute on function public.post_safety_action(text,uuid,text,jsonb) to anon,authenticated;

create function public.admin_review_post_safety(p_case_id uuid,p_action text,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare c public.post_safety_cases; tbl text; uid uuid:=public.current_public_user_id(); current_post jsonb;
begin
 if not public.platform_admin_has_permission('admin.reports.update') then raise exception 'Permission denied.'; end if;
 if length(btrim(p_reason))<3 then raise exception 'A review reason is required.'; end if;
 select * into c from public.post_safety_cases where id=p_case_id for update;
 if not found or c.status<>'pending' then raise exception 'Case is no longer pending.'; end if;
 tbl:=public.post_safety_table(c.source_type);
 if p_action='allow' and c.origin='automatic' then
  execute format('select to_jsonb(p) from public.%I p where id=$1 for update',tbl) into current_post using c.source_id;
  if current_post is null or current_post->>'deleted_at' is not null then raise exception 'The post has been deleted and cannot be allowed.'; end if;
  if c.source_type='beauty_post' then update public.beauty_posts set safety_hold=false,visibility=coalesce(c.content_snapshot->>'visibility','public') where id=c.source_id and deleted_at is null;
  else execute format('update public.%I set safety_hold=false,status=$1 where id=$2',tbl) using coalesce(c.content_snapshot->>'status','published'),c.source_id; end if;
 elsif p_action in ('delete','block') then
  if p_action='block' then
   if c.author_user_id is null then raise exception 'Author account is unavailable.'; end if;
   perform public.admin_set_user_access(c.author_user_id,p_reason,true);
  end if;
  if c.source_type='beauty_post' then update public.beauty_posts set safety_hold=false,deleted_at=now() where id=c.source_id;
  else execute format('delete from public.%I where id=$1',tbl) using c.source_id; end if;
 elsif p_action<>'dismiss' or c.origin='automatic' then raise exception 'Invalid review action.'; end if;
 update public.post_safety_cases set status=case p_action when 'allow' then 'allowed' when 'delete' then 'deleted' when 'block' then 'blocked' else 'dismissed' end,resolution=p_reason,reviewed_by=uid,reviewed_at=now() where id=p_case_id;
 if p_action in ('delete','block') then
  update public.post_safety_cases set status=case when p_action='block' then 'blocked' else 'deleted' end,resolution=p_reason,reviewed_by=uid,reviewed_at=now()
  where source_type=c.source_type and source_id=c.source_id and status='pending';
  update public.platform_reports set status='resolved',resolution=p_reason,resolved_by_user_id=uid,resolved_at=now()
  where id in (select platform_report_id from post_safety_cases where source_type=c.source_type and source_id=c.source_id and status in ('deleted','blocked'));
 end if;
 insert into public.post_safety_decisions(case_id,actor_user_id,action,reason) values(p_case_id,uid,p_action,p_reason);
 if c.platform_report_id is not null then update public.platform_reports set status='resolved',resolution=p_reason,resolved_by_user_id=uid,resolved_at=now() where id=c.platform_report_id; end if;
 return '{"ok":true}'::jsonb;
end; $$;
revoke all on function public.admin_review_post_safety(uuid,text,text) from public;
grant execute on function public.admin_review_post_safety(uuid,text,text) to authenticated;

create function public.admin_post_safety_keyword(p_phrase text,p_category text,p_enabled boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.platform_admin_has_permission('admin.reports.update') then raise exception 'Permission denied.'; end if;
 insert into public.post_safety_keywords(phrase,category,enabled) values(lower(btrim(p_phrase)),p_category,p_enabled)
 on conflict(phrase) do update set category=excluded.category,enabled=excluded.enabled;
end; $$;
revoke all on function public.admin_post_safety_keyword(text,text,boolean) from public;
grant execute on function public.admin_post_safety_keyword(text,text,boolean) to authenticated;

-- Private held salon posts remain available to their author and salon managers.
create function public.get_my_held_salon_posts(p_salon_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
 'looks',coalesce((select jsonb_agg(to_jsonb(p)) from salon_profile_looks p where p.salon_id=p_salon_id and p.safety_hold and (p.author_user_id=current_public_user_id() or p.created_by_user_id=current_public_user_id() or user_can_manage_salon(p_salon_id))),'[]'::jsonb),
 'updates',coalesce((select jsonb_agg(to_jsonb(p)) from salon_profile_updates p where p.salon_id=p_salon_id and p.safety_hold and (p.author_user_id=current_public_user_id() or p.created_by_user_id=current_public_user_id() or user_can_manage_salon(p_salon_id))),'[]'::jsonb)
 );
$$;
revoke all on function public.get_my_held_salon_posts(uuid) from public;
grant execute on function public.get_my_held_salon_posts(uuid) to authenticated;

create function public.get_post_safety_queue(p_origin text) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.platform_admin_has_permission('admin.reports.read') then raise exception 'Permission denied.'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('media',
 case when c.source_type='beauty_post' then coalesce((select jsonb_agg(jsonb_build_object('bucket','beauty-profile-media','path',m.object_path)) from beauty_post_media m where m.post_id=c.source_id),'[]'::jsonb)
 when c.content_snapshot->>'media_path' is not null then jsonb_build_array(jsonb_build_object('bucket','salon-profile-media','path',c.content_snapshot->>'media_path'))
 else '[]'::jsonb end)), '[]'::jsonb)
 from (select * from post_safety_cases where origin=p_origin and status='pending' order by created_at desc limit 100) c);
end; $$;
revoke all on function public.get_post_safety_queue(text) from public;
grant execute on function public.get_post_safety_queue(text) to authenticated;
