begin;

-- Resolve the actor and its block edges once. The previous wrapper evaluated
-- current_public_user_id()/social_users_blocked() for every social post, even
-- for a guest or an account with no blocks. Keep the original signed-guest
-- hidden-post reader as the authority for explicit hides.
create index if not exists salon_profile_looks_hidden_author_idx
 on public.salon_profile_looks(author_user_id);
create index if not exists salon_profile_updates_hidden_author_idx
 on public.salon_profile_updates(author_user_id);

create or replace function public.get_my_hidden_posts()
returns table(source_type text,source_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=public.current_public_user_id();
begin
 if actor is null or not exists (
  select 1 from public.user_blocks b where b.blocker_user_id=actor or b.blocked_user_id=actor
 ) then
  return query
   select distinct h.source_type,h.source_id
   from public.get_my_hidden_posts_before_blocks() h;
  return;
 end if;

 return query
  with blocked_users as materialized (
   select b.blocked_user_id as id from public.user_blocks b
    where b.blocker_user_id=actor and b.blocked_user_id<>actor
   union
   select b.blocker_user_id from public.user_blocks b
    where b.blocked_user_id=actor and b.blocker_user_id<>actor
  )
  select h.source_type,h.source_id from public.get_my_hidden_posts_before_blocks() h
  union
  select 'beauty_post'::text,p.id from blocked_users b
   join public.beauty_posts p on p.author_user_id=b.id
  union
  select 'salon_profile_look'::text,p.id from blocked_users b
   join public.salon_profile_looks p on p.author_user_id=b.id
  union
  select 'salon_profile_update'::text,p.id from blocked_users b
   join public.salon_profile_updates p on p.author_user_id=b.id;
end $$;

revoke all on function public.get_my_hidden_posts() from public;
grant execute on function public.get_my_hidden_posts() to anon,authenticated;

commit;
