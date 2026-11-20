-- Images attached before the safety pipeline may still belong to private or
-- hidden posts. Making their parent public must not grandfather those files.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.guard_beauty_image_publication_transition()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare
 profile_ids uuid[];
 post_ids uuid[];
 profile_row record;
 target_public boolean:=null;
begin
 if tg_table_name='beauty_profiles' then
  if new.visibility<>'public' then return new;end if;
  if tg_op='UPDATE' then
   if old.visibility='public' and new.id=old.id then return new;end if;
   profile_ids:=array[old.id,new.id];
  else
   profile_ids:=array[new.id];
  end if;
  -- A waited-on post can commit without changing the profile row version.
  -- RR/serializable snapshots could therefore miss that newly visible post,
  -- even when this scan appears empty. Do not weaken the caller's isolation.
  if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Making posts public requires a READ COMMITTED transaction. Retry this change.' using errcode='40001';
  end if;
  -- UPDATE already owns this profile row. Never lock its posts here: a post
  -- writer owns its post first, then takes the profile SHARE fence below.
  -- Reading after that fence orders either writer before the other without
  -- introducing the inverse profile -> post row-lock order.
  if exists(
   select 1 from public.beauty_posts p join public.beauty_post_media m on m.post_id=p.id
   where p.profile_id=any(profile_ids) and p.deleted_at is null
    and p.visibility='public' and p.moderation_status='visible' and not p.safety_hold
    and not public.public_post_image_is_approved(m.bucket,m.object_path,m.role,p.author_user_id,null)
  ) then
   raise exception 'These photos need a safety check before you can make them public. Re-upload them and agree to the photo safety check.' using errcode='42501';
  end if;
 else
  if new.deleted_at is not null or new.visibility<>'public'
   or new.moderation_status<>'visible' or new.safety_hold then return new;end if;
  if tg_op='UPDATE' then
   if old.deleted_at is null and old.visibility='public'
    and old.moderation_status='visible' and not old.safety_hold
    and new.profile_id=old.profile_id and new.author_user_id=old.author_user_id
    and new.id=old.id then return new;end if;
   profile_ids:=array[old.profile_id,new.profile_id];
   post_ids:=array[old.id,new.id];
  else
   profile_ids:=array[new.profile_id];
   post_ids:=array[new.id];
  end if;
  if current_setting('transaction_isolation')<>'read committed' then
   raise exception 'Making posts public requires a READ COMMITTED transaction. Retry this change.' using errcode='40001';
  end if;
  -- SHARE conflicts with profile visibility UPDATE (KEY SHARE does not).
  -- Lock both parents in UUID order, then use the returned current row after
  -- any READ COMMITTED wait. A missing/in-flight parent cannot fail open and
  -- later become visible merely because the foreign-key check waits for it.
  for profile_row in
   select b.id,b.visibility from public.beauty_profiles b
   where b.id=any(profile_ids) order by b.id for share
  loop
   if profile_row.id=new.profile_id then target_public:=profile_row.visibility='public';end if;
  end loop;
  if target_public is null then
   raise exception 'Beauty profile is unavailable. Refresh and try again.' using errcode='42501';
  end if;
  if not target_public then return new;end if;
  -- OLD IDs matter before a foreign-key cascade or identity change. Do not
  -- inspect only NEW.id while the attached media still references OLD.id.
  if exists(
   select 1 from public.beauty_post_media m where m.post_id=any(post_ids)
    and not public.public_post_image_is_approved(m.bucket,m.object_path,m.role,new.author_user_id,null)
  ) then
   raise exception 'These photos need a safety check before you can make them public. Re-upload them and agree to the photo safety check.' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_beauty_image_publication_transition() from public,anon,authenticated,service_role;

-- Run after existing abuse/phone/safety transforms so this checks the row's
-- resulting publication flags without changing their authority or decisions.
create trigger zy_beauty_image_publication_transition before insert or update on public.beauty_profiles
 for each row execute function public.guard_beauty_image_publication_transition();
create trigger zy_beauty_image_publication_transition before insert or update on public.beauty_posts
 for each row execute function public.guard_beauty_image_publication_transition();
commit;
