create or replace function public.get_account_post_save_counts(
  p_targets jsonb default '[]'::jsonb
)
returns table (
  source_type text,
  source_id uuid,
  save_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with raw_targets as (
    select
      nullif(btrim(target ->> 'source_type'), '') as source_type,
      nullif(btrim(target ->> 'source_id'), '') as source_id_text
    from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) target
  ),
  targets as (
    select distinct
      raw_targets.source_type,
      raw_targets.source_id_text::uuid as source_id
    from raw_targets
    where raw_targets.source_type in (
        'beauty_post',
        'salon_profile_look',
        'salon_profile_update'
      )
      and raw_targets.source_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  look_counts as (
    select
      'salon_profile_look'::text as source_type,
      looks.id as source_id,
      count(saves.id)::bigint as save_count
    from targets
    join public.salon_profile_looks looks on looks.id = targets.source_id
    left join public.salon_profile_look_saves saves on saves.look_id = looks.id
    where targets.source_type = 'salon_profile_look'
      and looks.status = 'published'
      and looks.media_path is not null
      and public.salon_profile_public_salon_exists(looks.salon_id)
    group by looks.id
  ),
  update_counts as (
    select
      'salon_profile_update'::text as source_type,
      updates.id as source_id,
      count(saves.id)::bigint as save_count
    from targets
    join public.salon_profile_updates updates on updates.id = targets.source_id
    left join public.account_post_saves saves
      on saves.source_type = 'salon_profile_update'
      and saves.source_id = updates.id
    where targets.source_type = 'salon_profile_update'
      and updates.status = 'published'
      and updates.media_path is not null
      and public.salon_profile_public_salon_exists(updates.salon_id)
    group by updates.id
  ),
  beauty_counts as (
    select
      'beauty_post'::text as source_type,
      posts.id as source_id,
      count(saves.id)::bigint as save_count
    from targets
    join public.beauty_posts posts on posts.id = targets.source_id
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    left join public.account_post_saves saves
      on saves.source_type = 'beauty_post'
      and saves.source_id = posts.id
    where targets.source_type = 'beauty_post'
      and posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and (
        profiles.visibility = 'public'
        or posts.author_user_id = public.current_public_user_id()
      )
      and exists (
        select 1
        from public.beauty_post_media media
        where media.post_id = posts.id
      )
    group by posts.id
  ),
  counts as (
    select * from look_counts
    union all
    select * from update_counts
    union all
    select * from beauty_counts
  )
  select
    targets.source_type,
    targets.source_id,
    coalesce(counts.save_count, 0)::bigint as save_count
  from targets
  left join counts
    on counts.source_type = targets.source_type
    and counts.source_id = targets.source_id
$$;

revoke all on function public.get_account_post_save_counts(jsonb) from public;
grant execute on function public.get_account_post_save_counts(jsonb) to anon, authenticated;
