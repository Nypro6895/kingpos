begin;

create table public.user_blocks (
 blocker_user_id uuid not null references public.users(id) on delete cascade,
 blocked_user_id uuid not null references public.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key (blocker_user_id, blocked_user_id),
 check (blocker_user_id <> blocked_user_id)
);
create index user_blocks_reverse_idx on public.user_blocks(blocked_user_id,blocker_user_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon,authenticated;

-- Private pair predicate; clients cannot probe another person's block list.
create function public.social_users_blocked(a uuid,b uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select a is not null and b is not null and a<>b and exists (
  select 1 from user_blocks where (blocker_user_id=a and blocked_user_id=b) or (blocker_user_id=b and blocked_user_id=a)
 )
$$;
revoke all on function public.social_users_blocked(uuid,uuid) from public,anon,authenticated;

create function public.social_user_is_blocked(other_user uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select social_users_blocked(current_public_user_id(),other_user)
$$;
revoke all on function public.social_user_is_blocked(uuid) from public;
grant execute on function public.social_user_is_blocked(uuid) to anon,authenticated;

create function public.social_post_author(p_type text,p_id uuid) returns uuid
language sql stable security definer set search_path=public as $$
 select author_user_id from beauty_posts where p_type='beauty_post' and id=p_id
 union all select author_user_id from salon_profile_looks where p_type='salon_profile_look' and id=p_id
 union all select author_user_id from salon_profile_updates where p_type='salon_profile_update' and id=p_id
$$;
revoke all on function public.social_post_author(text,uuid) from public,anon,authenticated;

create function public.set_user_block(p_user_id uuid,p_blocked boolean) returns void
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id();
begin
 if actor is null or not exists(select 1 from users where id=actor and status='active') then raise exception 'Sign in with an active account.'; end if;
 if p_blocked is null or p_user_id is null or actor=p_user_id then raise exception 'Invalid block request.'; end if;
 if p_blocked then
  if not exists(select 1 from users where id=p_user_id and status<>'deleted') then raise exception 'This account is unavailable.'; end if;
  insert into user_blocks(blocker_user_id,blocked_user_id) values(actor,p_user_id) on conflict do nothing;
  delete from beauty_profile_follows f using beauty_profiles p where f.profile_id=p.id
   and ((f.user_id=actor and p.user_id=p_user_id) or (f.user_id=p_user_id and p.user_id=actor));
  delete from app_notifications n using salon_profile_comments c
   where n.event_key='post_comment_created:'||c.id::text||':'||n.recipient_user_id::text
   and ((n.recipient_user_id=actor and c.author_user_id=p_user_id) or (n.recipient_user_id=p_user_id and c.author_user_id=actor));
 else
  delete from user_blocks where blocker_user_id=actor and blocked_user_id=p_user_id;
 end if;
end $$;
revoke all on function public.set_user_block(uuid,boolean) from public,anon;
grant execute on function public.set_user_block(uuid,boolean) to authenticated;

create function public.post_user_block(p_type text,p_id uuid,p_block boolean default false) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=current_public_user_id(); author uuid:=social_post_author(p_type,p_id);
begin
 if p_block then perform set_user_block(author,true); end if;
 return jsonb_build_object('canBlock',actor is not null and author is not null and actor<>author,
  'blocked',exists(select 1 from user_blocks where blocker_user_id=actor and blocked_user_id=author));
end $$;
revoke all on function public.post_user_block(text,uuid,boolean) from public;
grant execute on function public.post_user_block(text,uuid,boolean) to anon,authenticated;

create function public.get_my_blocked_users() returns table(user_id uuid,display_name text,created_at timestamptz)
language sql stable security definer set search_path=public as $$
 select b.blocked_user_id,coalesce(nullif(u.display_name,''),'Reylumi user'),b.created_at
 from user_blocks b join users u on u.id=b.blocked_user_id
 where b.blocker_user_id=current_public_user_id() order by b.created_at desc
$$;
revoke all on function public.get_my_blocked_users() from public,anon;
grant execute on function public.get_my_blocked_users() to authenticated;

-- Restrictive policies supplement (never broaden) existing ownership/public policies.
do $$ declare t text; begin
 foreach t in array array['beauty_posts','salon_profile_looks','salon_profile_updates','salon_profile_comments','salon_profile_reviews','salon_profile_review_replies'] loop
  execute format('create policy social_block_visibility on public.%I as restrictive for select to authenticated using (not public.social_user_is_blocked(author_user_id))',t);
 end loop;
end $$;
create policy social_block_visibility on public.beauty_profiles as restrictive for select to authenticated using(not public.social_user_is_blocked(user_id));
create policy social_block_media on public.beauty_post_media as restrictive for select to authenticated
 using(exists(select 1 from beauty_posts p where p.id=post_id));

-- Definer RPCs bypass RLS, so preserve their exact deployed implementations behind
-- private wrappers. The named entry points retain their arguments, grants and shape.
-- Replies have a different author from the review. Filter inside their lateral
-- query; filtering only the parent author would still expose a blocked reply.
do $$ declare d text; needle text; begin
 d:=pg_get_functiondef('public.get_public_salon_profile_reviews(uuid)'::regprocedure);
 needle:='where review_id = reviews.id';
 if strpos(d,needle)=0 then raise exception 'Review replies changed; review block visibility.'; end if;
 execute replace(d,needle,needle||' and not public.social_users_blocked(public.current_public_user_id(),salon_profile_review_replies.author_user_id)');
 d:=pg_get_functiondef('public.get_public_salon_profile_experiences(uuid)'::regprocedure);
 foreach needle in array array['where experiences.salon_id = target_salon_id','where reviews.salon_id = target_salon_id','where review_replies.review_id = reviews.id'] loop
  if strpos(d,needle)=0 then raise exception 'Experience visibility changed; review block visibility.'; end if;
 end loop;
 d:=replace(d,'where experiences.salon_id = target_salon_id','where experiences.salon_id = target_salon_id and not public.social_users_blocked(public.current_public_user_id(),experiences.author_user_id)');
 d:=replace(d,'where reviews.salon_id = target_salon_id','where reviews.salon_id = target_salon_id and not public.social_users_blocked(public.current_public_user_id(),reviews.author_user_id)');
 d:=replace(d,'where review_replies.review_id = reviews.id','where review_replies.review_id = reviews.id and not public.social_users_blocked(public.current_public_user_id(),review_replies.author_user_id)');
 execute d;
end $$;
do $$
declare f record; old_name text; args text; predicate text;
begin
 for f in select p.oid,p.proname,pg_get_function_arguments(p.oid) declaration,
  pg_get_function_identity_arguments(p.oid) identity_args,pg_get_function_result(p.oid) result_type,
  p.proargnames[1:p.pronargs] names
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in (
   'get_public_salon_profile_looks','get_public_salon_profile_updates','get_public_salon_profile_reviews',
   'get_public_salon_profile_comments','get_public_salon_profile_beauty_posts','get_public_salon_profile_experiences')
 loop
  old_name:=f.proname||'_before_blocks';
  select string_agg(quote_ident(x),',') into args from unnest(f.names) x;
  predicate:=case when f.proname='get_public_salon_profile_beauty_posts' then
   'not public.social_users_blocked(public.current_public_user_id(),public.social_post_author(''beauty_post'',r.post_id))'
   else 'not public.social_users_blocked(public.current_public_user_id(),r.author_user_id)' end;
  execute format('alter function public.%I(%s) rename to %I',f.proname,f.identity_args,old_name);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',old_name,f.identity_args);
  execute format('create function public.%I(%s) returns %s language sql stable security definer set search_path=public as %L',
   f.proname,f.declaration,f.result_type,format('select r.* from public.%I(%s) r where %s',old_name,args,predicate));
  execute format('revoke all on function public.%I(%s) from public',f.proname,f.identity_args);
  execute format('grant execute on function public.%I(%s) to anon,authenticated',f.proname,f.identity_args);
 end loop;
end $$;

alter function public.get_public_beauty_profile(uuid) rename to get_public_beauty_profile_before_blocks;
revoke all on function public.get_public_beauty_profile_before_blocks(uuid) from public,anon,authenticated;
create function public.get_public_beauty_profile(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if exists(select 1 from beauty_profiles p where p.id=p_profile_id and social_users_blocked(current_public_user_id(),p.user_id)) then
  return jsonb_build_object('ok',false,'code','not_found','state','forbidden');
 end if;
 return get_public_beauty_profile_before_blocks(p_profile_id);
end $$;
revoke all on function public.get_public_beauty_profile(uuid) from public;
grant execute on function public.get_public_beauty_profile(uuid) to anon,authenticated;

alter function public.list_beauty_timeline(uuid,timestamptz,uuid,integer) rename to list_beauty_timeline_before_blocks;
revoke all on function public.list_beauty_timeline_before_blocks(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
create function public.list_beauty_timeline(p_profile_id uuid,p_cursor_created_at timestamptz default null,p_cursor_post_id uuid default null,p_page_size integer default 12) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if exists(select 1 from beauty_profiles p where p.id=p_profile_id and social_users_blocked(current_public_user_id(),p.user_id)) then
  return jsonb_build_object('ok',false,'code','not_found','items','[]'::jsonb,'hasMore',false,'nextCursor',null);
 end if;
 return list_beauty_timeline_before_blocks(p_profile_id,p_cursor_created_at,p_cursor_post_id,p_page_size);
end $$;
revoke all on function public.list_beauty_timeline(uuid,timestamptz,uuid,integer) from public;
grant execute on function public.list_beauty_timeline(uuid,timestamptz,uuid,integer) to anon,authenticated;

-- Explore uses a service-only RPC with a server-derived actor. Filter after the
-- optimized selected-item hydration, including items from already-open sessions.
alter function public.hydrate_explore_social_feed_items(text,jsonb,text[]) rename to hydrate_explore_social_feed_items_before_blocks;
revoke all on function public.hydrate_explore_social_feed_items_before_blocks(text,jsonb,text[]) from public,anon,authenticated,service_role;
create function public.hydrate_explore_social_feed_items(p_actor_key text,p_cursor jsonb,p_keys text[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid; items jsonb;
begin
 items:=hydrate_explore_social_feed_items_before_blocks(p_actor_key,p_cursor,p_keys);
 if left(p_actor_key,5)='user:' then actor:=substring(p_actor_key from 6)::uuid; end if;
 return coalesce((select jsonb_agg(e.item order by e.ord) from jsonb_array_elements(items) with ordinality e(item,ord)
  where not social_users_blocked(actor,social_post_author(e.item->>'sourceType',(e.item->>'contentId')::uuid))),'[]'::jsonb);
end $$;
revoke all on function public.hydrate_explore_social_feed_items(text,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.hydrate_explore_social_feed_items(text,jsonb,text[]) to service_role;

alter function public.get_my_hidden_posts() rename to get_my_hidden_posts_before_blocks;
revoke all on function public.get_my_hidden_posts_before_blocks() from public,anon,authenticated;
create function public.get_my_hidden_posts() returns table(source_type text,source_id uuid)
language sql stable security definer set search_path=public as $$
 select * from get_my_hidden_posts_before_blocks()
 union select 'beauty_post',id from beauty_posts where social_users_blocked(current_public_user_id(),author_user_id)
 union select 'salon_profile_look',id from salon_profile_looks where social_users_blocked(current_public_user_id(),author_user_id)
 union select 'salon_profile_update',id from salon_profile_updates where social_users_blocked(current_public_user_id(),author_user_id)
$$;
revoke all on function public.get_my_hidden_posts() from public;
grant execute on function public.get_my_hidden_posts() to anon,authenticated;

-- Triggers also protect direct writes and SECURITY DEFINER interaction RPCs.
create function public.enforce_social_user_blocks() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor uuid; other_user uuid; parent_user uuid;
begin
 if tg_table_name='beauty_profile_follows' then
  actor:=new.user_id; select user_id into other_user from beauty_profiles where id=new.profile_id;
 elsif tg_table_name='salon_profile_review_replies' then
  actor:=new.author_user_id;
  if new.moderation_status<>'visible' then return new; end if;
  select author_user_id into other_user from salon_profile_reviews where id=new.review_id;
 elsif tg_table_name='salon_profile_comments' then
  actor:=new.author_user_id;
  if new.status not in ('published','visible','reported') then return new; end if;
  other_user:=social_post_author(case when new.look_id is not null then 'salon_profile_look' when new.update_id is not null then 'salon_profile_update' else 'beauty_post' end,coalesce(new.look_id,new.update_id,new.beauty_post_id));
  select author_user_id into parent_user from salon_profile_comments where id=new.parent_comment_id;
 else
  actor:=new.user_id;
  if tg_table_name='account_post_saves' then other_user:=social_post_author(new.source_type,new.source_id);
  else other_user:=social_post_author('salon_profile_look',new.look_id); end if;
 end if;
 if social_users_blocked(actor,other_user) or social_users_blocked(actor,parent_user) then raise exception 'This interaction is unavailable.'; end if;
 return new;
end $$;
revoke all on function public.enforce_social_user_blocks() from public,anon,authenticated;
create trigger enforce_social_user_blocks before insert or update on public.beauty_profile_follows for each row execute function public.enforce_social_user_blocks();
create trigger enforce_social_user_blocks before insert or update on public.salon_profile_comments for each row execute function public.enforce_social_user_blocks();
create trigger enforce_social_user_blocks before insert or update on public.salon_profile_review_replies for each row execute function public.enforce_social_user_blocks();
create trigger enforce_social_user_blocks before insert or update on public.account_post_saves for each row execute function public.enforce_social_user_blocks();
create trigger enforce_social_user_blocks before insert or update on public.salon_profile_look_saves for each row execute function public.enforce_social_user_blocks();

create function public.filter_blocked_social_notification() returns trigger
language plpgsql security definer set search_path=public as $$
declare actor uuid;
begin
 if new.event_key like 'post_comment_created:%' then
  select author_user_id into actor from salon_profile_comments where id::text=split_part(new.event_key,':',2);
  if social_users_blocked(new.recipient_user_id,actor) then return null; end if;
 end if;
 return new;
end $$;
revoke all on function public.filter_blocked_social_notification() from public,anon,authenticated;
create trigger filter_blocked_social_notification before insert on public.app_notifications for each row execute function public.filter_blocked_social_notification();


-- Filter before counting and paginating comment roots.
create or replace function public.count_public_post_comments(
  p_target_type text,
  p_target_id uuid
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with target_comments as (
    select comments.id, comments.parent_comment_id, comments.root_comment_id
    from public.salon_profile_comments comments
    where comments.status in ('published', 'visible')
      and not public.social_users_blocked(public.current_public_user_id(),comments.author_user_id)
      and (
        (
          p_target_type = 'salon_profile_look'
          and comments.look_id = p_target_id
          and public.post_comment_target_is_public(comments.look_id, null, null, comments.salon_id)
        )
        or (
          p_target_type = 'salon_profile_update'
          and comments.update_id = p_target_id
          and public.post_comment_target_is_public(null, comments.update_id, null, comments.salon_id)
        )
        or (
          p_target_type = 'beauty_post'
          and comments.beauty_post_id = p_target_id
          and public.post_comment_target_is_public(null, null, comments.beauty_post_id, comments.salon_id)
        )
      )
  ),
  visible_roots as (
    select target_comments.id
    from target_comments
    where target_comments.parent_comment_id is null
  )
  select count(*)::bigint
  from target_comments
  where target_comments.parent_comment_id is null
    or coalesce(target_comments.root_comment_id, target_comments.parent_comment_id) in (
      select visible_roots.id
      from visible_roots
    )
$$;
create or replace function public.get_public_post_comments(
  p_target_type text,
  p_target_id uuid,
  p_offset integer default 0,
  p_limit integer default 12
)
returns table (
  id uuid,
  salon_id uuid,
  look_id uuid,
  update_id uuid,
  beauty_post_id uuid,
  parent_comment_id uuid,
  root_comment_id uuid,
  reply_depth integer,
  author_user_id uuid,
  author_display_name text,
  body text,
  is_salon_reply boolean,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  total_count bigint,
  root_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  clean_offset integer := greatest(0, coalesce(p_offset, 0));
  clean_limit integer := greatest(1, least(coalesce(p_limit, 12), 24));
begin
  return query
  with target_comments as (
    select comments.*
    from public.salon_profile_comments comments
    where comments.status in ('published', 'visible')
      and not public.social_users_blocked(public.current_public_user_id(),comments.author_user_id)
      and (
        (
          p_target_type = 'salon_profile_look'
          and comments.look_id = p_target_id
          and public.post_comment_target_is_public(comments.look_id, null, null, comments.salon_id)
        )
        or (
          p_target_type = 'salon_profile_update'
          and comments.update_id = p_target_id
          and public.post_comment_target_is_public(null, comments.update_id, null, comments.salon_id)
        )
        or (
          p_target_type = 'beauty_post'
          and comments.beauty_post_id = p_target_id
          and public.post_comment_target_is_public(null, null, comments.beauty_post_id, comments.salon_id)
        )
      )
  ),
  visible_roots as (
    select target_comments.*
    from target_comments
    where target_comments.parent_comment_id is null
  ),
  paged_roots as (
    select visible_roots.*
    from visible_roots
    order by visible_roots.created_at desc, visible_roots.id desc
    offset clean_offset
    limit clean_limit
  ),
  result_rows as (
    select
      paged_roots.*,
      paged_roots.created_at as root_created_at,
      paged_roots.id as root_sort_id,
      0 as thread_sort
    from paged_roots

    union all

    select
      replies.*,
      paged_roots.created_at as root_created_at,
      paged_roots.id as root_sort_id,
      1 as thread_sort
    from target_comments replies
    join paged_roots
      on coalesce(replies.root_comment_id, replies.parent_comment_id) = paged_roots.id
    where replies.id <> paged_roots.id
  ),
  totals as (
    select
      (
        select count(*)::bigint
        from target_comments counted_comments
        where counted_comments.parent_comment_id is null
          or coalesce(counted_comments.root_comment_id, counted_comments.parent_comment_id) in (
            select visible_roots.id
            from visible_roots
          )
      ) as total_count,
      (select count(*)::bigint from visible_roots) as root_count
  )
  select
    result_rows.id,
    result_rows.salon_id,
    result_rows.look_id,
    result_rows.update_id,
    result_rows.beauty_post_id,
    result_rows.parent_comment_id,
    result_rows.root_comment_id,
    result_rows.reply_depth,
    result_rows.author_user_id,
    coalesce(nullif(btrim(result_rows.author_display_name), ''), 'Reylumi customer') as author_display_name,
    result_rows.body,
    result_rows.is_salon_reply,
    result_rows.created_at,
    result_rows.updated_at,
    result_rows.edited_at,
    totals.total_count,
    totals.root_count
  from result_rows
  cross join totals
  order by
    result_rows.root_created_at desc,
    result_rows.root_sort_id desc,
    result_rows.thread_sort asc,
    result_rows.created_at asc,
    result_rows.id asc;
end;
$$;
create or replace function public.post_comment_target_is_public(
  p_look_id uuid,
  p_update_id uuid,
  p_beauty_post_id uuid,
  p_salon_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_look_id is not null then exists (
      select 1
      from public.salon_profile_looks looks
      where looks.id = p_look_id
        and (p_salon_id is null or looks.salon_id = p_salon_id)
        and looks.status = 'published'
        and not public.social_users_blocked(public.current_public_user_id(),looks.author_user_id)
        and public.salon_profile_public_salon_exists(looks.salon_id)
    )
    when p_update_id is not null then exists (
      select 1
      from public.salon_profile_updates updates
      where updates.id = p_update_id
        and (p_salon_id is null or updates.salon_id = p_salon_id)
        and updates.status = 'published'
        and not public.social_users_blocked(public.current_public_user_id(),updates.author_user_id)
        and public.salon_profile_public_salon_exists(updates.salon_id)
    )
    when p_beauty_post_id is not null then public.beauty_public_post_exists(p_beauty_post_id) and not public.social_users_blocked(public.current_public_user_id(),public.social_post_author('beauty_post',p_beauty_post_id))
    else false
  end
$$;


do $patch$ declare d text; needle text:='if profile_row.id is null then'; begin
 d:=pg_get_functiondef('public.list_beauty_timeline_for_salon_customer(uuid,uuid,timestamptz,uuid,integer)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Customer timeline changed; review block visibility before applying'; end if;
 execute replace(d,needle,'if profile_row.id is null or public.social_users_blocked(actor_user_id,profile_row.user_id) then');
end $patch$;

notify pgrst,'reload schema';
commit;
