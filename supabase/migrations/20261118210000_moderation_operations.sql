-- Honor a held parent's visibility independently of its publication flags.
-- Blocking through a post must not become an author lookup for private content.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.beauty_public_post_exists(target_post_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(
  select 1 from public.beauty_posts p join public.beauty_profiles b on b.id=p.profile_id
  where p.id=target_post_id and p.deleted_at is null and p.visibility='public'
   and p.moderation_status='visible' and not p.safety_hold and b.visibility='public'
 );
$$;
revoke all on function public.beauty_public_post_exists(uuid) from public;
grant execute on function public.beauty_public_post_exists(uuid) to anon,authenticated;

create or replace function public.post_comment_target_is_public(
 p_look_id uuid,p_update_id uuid,p_beauty_post_id uuid,p_salon_id uuid default null
)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select case
 when p_look_id is not null then exists(
  select 1 from public.salon_profile_looks p where p.id=p_look_id
   and (p_salon_id is null or p.salon_id=p_salon_id)
   and p.status='published' and not p.safety_hold
   and not public.social_users_blocked(public.current_public_user_id(),p.author_user_id)
   and public.salon_profile_public_salon_exists(p.salon_id)
 )
 when p_update_id is not null then exists(
  select 1 from public.salon_profile_updates p where p.id=p_update_id
   and (p_salon_id is null or p.salon_id=p_salon_id)
   and p.status='published' and not p.safety_hold
   and not public.social_users_blocked(public.current_public_user_id(),p.author_user_id)
   and public.salon_profile_public_salon_exists(p.salon_id)
 )
 when p_beauty_post_id is not null then
  public.beauty_public_post_exists(p_beauty_post_id)
   and not public.social_users_blocked(public.current_public_user_id(),public.social_post_author('beauty_post',p_beauty_post_id))
 else false end;
$$;
revoke all on function public.post_comment_target_is_public(uuid,uuid,uuid,uuid) from public;
grant execute on function public.post_comment_target_is_public(uuid,uuid,uuid,uuid) to anon,authenticated;

create or replace function public.post_user_block(p_type text,p_id uuid,p_block boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.current_public_user_id(); author uuid; available boolean:=false; own_block boolean:=false;
begin
 if p_type is null or p_type not in ('beauty_post','salon_profile_look','salon_profile_update')
  or p_id is null or p_block is null then raise exception 'Invalid block request.' using errcode='22023';end if;
 -- No anonymous/inactive existence probe. The write retains the existing
 -- set_user_block authority and business/financial permissions are untouched.
 if actor is null or not exists(select 1 from public.users where id=actor and status='active') then
  if p_block then raise exception 'Sign in with an active account.' using errcode='42501';end if;
  return jsonb_build_object('canBlock',false,'blocked',false);
 end if;

 if p_type='beauty_post' then
  select p.author_user_id,
   p.deleted_at is null and p.visibility='public' and p.moderation_status='visible'
    and not p.safety_hold and b.visibility='public'
  into author,available from public.beauty_posts p join public.beauty_profiles b on b.id=p.profile_id where p.id=p_id;
 elsif p_type='salon_profile_look' then
  select p.author_user_id,p.status='published' and not p.safety_hold and public.salon_profile_public_salon_exists(p.salon_id)
  into author,available from public.salon_profile_looks p where p.id=p_id;
 else
  select p.author_user_id,p.status='published' and not p.safety_hold and public.salon_profile_public_salon_exists(p.salon_id)
  into author,available from public.salon_profile_updates p where p.id=p_id;
 end if;
 if author is not null then
  select exists(select 1 from public.user_blocks where blocker_user_id=actor and blocked_user_id=author) into own_block;
 end if;
 -- A public post becomes personally invisible after a successful block. Permit
 -- that same actor's retry while publication remains public, never a retry via
 -- a private/held/deleted post or a different person's reverse block.
 if author is null or not coalesce(available,false)
  or (public.social_users_blocked(actor,author) and not own_block) then
  if p_block then raise exception 'Post is unavailable.' using errcode='42501';end if;
  return jsonb_build_object('canBlock',false,'blocked',false);
 end if;
 if p_block then perform public.set_user_block(author,true);own_block:=true;end if;
 return jsonb_build_object('canBlock',actor<>author,'blocked',own_block);
end;
$$;
revoke all on function public.post_user_block(text,uuid,boolean) from public;
grant execute on function public.post_user_block(text,uuid,boolean) to anon,authenticated;
notify pgrst,'reload schema';
commit;
