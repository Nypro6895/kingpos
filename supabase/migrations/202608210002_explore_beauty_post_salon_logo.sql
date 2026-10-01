drop function if exists public.get_public_explore_beauty_posts(
  uuid,
  timestamptz,
  integer,
  uuid,
  uuid
);

create or replace function public.get_public_explore_beauty_posts(
  p_cursor_post_id uuid default null,
  p_cursor_created_at timestamptz default null,
  p_page_size integer default 18,
  p_profile_id uuid default null,
  p_post_id uuid default null
)
returns table (
  post_id uuid,
  profile_id uuid,
  post_type text,
  caption_excerpt text,
  created_at timestamptz,
  author_display_name text,
  author_avatar_url text,
  media jsonb,
  salon_id uuid,
  salon_name text,
  salon_city text,
  salon_state text,
  salon_href text,
  salon_logo_path text,
  verification_state text,
  booking_enabled boolean,
  service_name text,
  service_category text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select least(24, greatest(1, coalesce(p_page_size, 18))) as page_size_value
  ),
  eligible_posts as (
    select
      posts.id as post_id,
      profiles.id as profile_id,
      posts.post_type,
      left(posts.caption, 180) as caption_excerpt,
      posts.created_at,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as author_display_name,
      users.avatar_url as author_avatar_url,
      attributions.salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), salons.name) as salon_name,
      coalesce(settings.city, salons.city) as salon_city,
      coalesce(settings.state, salons.state) as salon_state,
      settings.public_profile_logo_path as salon_logo_path,
      case
        when attributions.salon_id is not null
          and public.salon_profile_public_salon_exists(attributions.salon_id)
          then '/explore/salons/' || attributions.salon_id::text
        else null
      end as salon_href,
      verifications.state as verification_state,
      coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true) as booking_enabled
    from public.beauty_posts posts
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    join public.users users on users.id = posts.author_user_id
    left join public.beauty_post_attributions attributions
      on attributions.post_id = posts.id
    left join public.beauty_post_verifications verifications
      on verifications.post_id = posts.id
    left join public.locations salons on salons.id = attributions.salon_id
    left join public.salon_settings settings on settings.salon_id = attributions.salon_id
    left join public.booking_settings booking_settings on booking_settings.salon_id = attributions.salon_id
    where posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and profiles.visibility = 'public'
      and posts.created_at is not null
      and (p_profile_id is null or profiles.id = p_profile_id)
      and (p_post_id is null or posts.id = p_post_id)
      and exists (
        select 1
        from public.beauty_post_media post_media
        where post_media.post_id = posts.id
      )
      and (
        p_post_id is not null
        or p_cursor_created_at is null
        or posts.created_at < p_cursor_created_at
        or (
          posts.created_at = p_cursor_created_at
          and (p_cursor_post_id is null or posts.id < p_cursor_post_id)
        )
      )
    order by posts.created_at desc, posts.id desc
    limit (select page_size_value + 1 from normalized)
  )
  select
    eligible_posts.post_id,
    eligible_posts.profile_id,
    eligible_posts.post_type,
    eligible_posts.caption_excerpt,
    eligible_posts.created_at,
    eligible_posts.author_display_name,
    eligible_posts.author_avatar_url,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', post_media.id,
            'role', post_media.role,
            'objectPath', post_media.object_path,
            'displayOrder', post_media.display_order,
            'width', post_media.width,
            'height', post_media.height,
            'mimeType', post_media.mime_type
          )
          order by post_media.display_order, post_media.created_at, post_media.id
        )
        from public.beauty_post_media post_media
        where post_media.post_id = eligible_posts.post_id
      ),
      '[]'::jsonb
    ) as media,
    eligible_posts.salon_id,
    eligible_posts.salon_name,
    eligible_posts.salon_city,
    eligible_posts.salon_state,
    eligible_posts.salon_href,
    eligible_posts.salon_logo_path,
    eligible_posts.verification_state,
    eligible_posts.booking_enabled,
    null::text as service_name,
    null::text as service_category
  from eligible_posts
  order by eligible_posts.created_at desc, eligible_posts.post_id desc
$$;

revoke all on function public.get_public_explore_beauty_posts(
  uuid,
  timestamptz,
  integer,
  uuid,
  uuid
) from public;

grant execute on function public.get_public_explore_beauty_posts(
  uuid,
  timestamptz,
  integer,
  uuid,
  uuid
) to anon, authenticated;
