create index if not exists bookings_beauty_post_reference_count_idx
on public.bookings(source_reference_id)
where source_reference_type = 'beauty_post'
  and source_reference_id is not null;

create index if not exists beauty_posts_public_explore_idx
on public.beauty_posts(created_at desc, id desc)
where deleted_at is null
  and visibility = 'public'
  and moderation_status = 'visible';

create or replace function public.get_public_beauty_post_booking_counts(
  p_post_ids uuid[] default '{}'::uuid[]
)
returns table (
  post_id uuid,
  verified_booking_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_posts as (
    select distinct unnest(coalesce(p_post_ids, '{}'::uuid[])) as post_id
  ),
  eligible_posts as (
    select posts.id as post_id
    from requested_posts requested
    join public.beauty_posts posts on posts.id = requested.post_id
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    join public.beauty_post_verifications verifications
      on verifications.post_id = posts.id
     and verifications.state = 'verified'
    where posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and profiles.visibility = 'public'
  ),
  counted_bookings as (
    select
      bookings.source_reference_id as post_id,
      count(*)::integer as verified_booking_count
    from public.bookings bookings
    join eligible_posts eligible on eligible.post_id = bookings.source_reference_id
    where bookings.source_reference_type = 'beauty_post'
      and bookings.confirmation_status = 'confirmed'
      and bookings.status in ('confirmed', 'checked_in', 'in_service', 'completed')
    group by bookings.source_reference_id
  )
  select
    eligible_posts.post_id,
    coalesce(counted_bookings.verified_booking_count, 0) as verified_booking_count
  from eligible_posts
  left join counted_bookings on counted_bookings.post_id = eligible_posts.post_id
$$;

revoke all on function public.get_public_beauty_post_booking_counts(uuid[]) from public;
grant execute on function public.get_public_beauty_post_booking_counts(uuid[]) to anon, authenticated;

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

drop function if exists public.get_public_salon_profile_beauty_posts(uuid, integer);

create or replace function public.get_public_salon_profile_beauty_posts(
  target_salon_id uuid,
  p_limit integer default 6
)
returns table (
  publication_id uuid,
  post_id uuid,
  profile_id uuid,
  post_type text,
  caption text,
  created_at timestamptz,
  approved_at timestamptz,
  author_display_name text,
  author_avatar_url text,
  staff_id uuid,
  staff_name text,
  verification_state text,
  booking_enabled boolean,
  media jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    publications.id as publication_id,
    posts.id as post_id,
    posts.profile_id,
    posts.post_type,
    posts.caption,
    posts.created_at,
    publications.responded_at as approved_at,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    ) as author_display_name,
    users.avatar_url as author_avatar_url,
    staff.id as staff_id,
    staff.display_name as staff_name,
    verifications.state as verification_state,
    coalesce(booking_settings.booking_enabled, false)
      and coalesce(booking_settings.online_booking_visible, false)
      and coalesce(booking_settings.guest_booking_enabled, true) as booking_enabled,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', media.id,
            'role', media.role,
            'objectPath', media.object_path,
            'displayOrder', media.display_order,
            'width', media.width,
            'height', media.height,
            'mimeType', media.mime_type
          )
          order by media.display_order, media.created_at, media.id
        )
        from public.beauty_post_media media
        where media.post_id = posts.id
      ),
      '[]'::jsonb
    ) as media
  from public.beauty_post_salon_publications publications
  join public.beauty_posts posts on posts.id = publications.post_id
  join public.beauty_profiles profiles on profiles.id = posts.profile_id
  join public.users users on users.id = posts.author_user_id
  left join public.beauty_post_attributions attributions
    on attributions.post_id = posts.id
   and attributions.salon_id = publications.salon_id
  left join public.staff staff on staff.id = attributions.staff_id
  left join public.beauty_post_verifications verifications on verifications.post_id = posts.id
  left join public.booking_settings booking_settings on booking_settings.salon_id = publications.salon_id
  where publications.salon_id = target_salon_id
    and publications.status = 'approved'
    and public.salon_profile_public_salon_exists(target_salon_id)
    and posts.deleted_at is null
    and posts.visibility = 'public'
    and posts.moderation_status = 'visible'
    and posts.post_type = 'before_after'
    and profiles.visibility = 'public'
    and exists (
      select 1
      from public.beauty_post_media media
      where media.post_id = posts.id
    )
  order by publications.responded_at desc, posts.created_at desc, posts.id desc
  limit greatest(1, least(coalesce(p_limit, 6), 12))
$$;

revoke all on function public.get_public_salon_profile_beauty_posts(uuid, integer) from public;
grant execute on function public.get_public_salon_profile_beauty_posts(uuid, integer) to anon, authenticated;

drop function if exists public.get_public_content_booking_options(uuid[]);

create or replace function public.get_public_content_booking_options(target_salon_ids uuid[] default null)
returns table (
  content_id uuid,
  source_type text,
  content_type text,
  salon_id uuid,
  title text,
  caption text,
  media_path text,
  media_bucket text,
  credited_staff_id uuid,
  credited_staff_name text,
  booking_cta_enabled boolean,
  booking_enabled boolean,
  booking_href text,
  booking_note text,
  cta_label text,
  readiness_state text,
  readiness_message text,
  primary_service_id uuid,
  primary_service_name text,
  primary_service_base_price numeric,
  primary_service_duration_minutes integer,
  add_ons jsonb,
  additional_services jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with profile_content as (
    select
      coalesce(configs.look_id, configs.update_id) as content_id,
      configs.source_type,
      case when configs.source_type = 'salon_profile_update' then 'update' else 'look' end as content_type,
      configs.salon_id,
      coalesce(looks.title, updates.title) as title,
      coalesce(looks.caption, updates.caption) as caption,
      coalesce(looks.media_path, updates.media_path) as media_path,
      'salon-profile-media'::text as media_bucket,
      configs.credited_staff_id,
      staff.display_name as credited_staff_name,
      configs.booking_cta_enabled,
      booking_settings.booking_enabled,
      case when configs.booking_cta_enabled then '/booking/' || configs.salon_id::text else null end as booking_href,
      configs.booking_note,
      configs.cta_label,
      case when configs.primary_service_id is null then 'inspiration_only' else 'service_ready' end as readiness_state,
      'Choose services and a professional.' as readiness_message,
      services.id as primary_service_id,
      services.name as primary_service_name,
      services.base_price as primary_service_base_price,
      services.duration_minutes as primary_service_duration_minutes,
      '[]'::jsonb as add_ons,
      '[]'::jsonb as additional_services
    from public.salon_profile_content_booking_configs configs
    left join public.salon_profile_looks looks on looks.id = configs.look_id
    left join public.salon_profile_updates updates on updates.id = configs.update_id
    left join public.staff staff on staff.id = configs.credited_staff_id
    left join public.services services on services.id = configs.primary_service_id
    left join public.booking_settings on booking_settings.salon_id = configs.salon_id
    where (target_salon_ids is null or configs.salon_id = any(target_salon_ids))
      and public.salon_profile_public_salon_exists(configs.salon_id)
      and (
        (configs.look_id is not null and looks.status = 'published')
        or (configs.update_id is not null and updates.status = 'published')
      )
  ),
  beauty_content as (
    select
      posts.id as content_id,
      'beauty_post'::text as source_type,
      'beauty_post'::text as content_type,
      attributions.salon_id,
      case
        when posts.post_type = 'before_after' then 'Verified Beauty transformation'
        else 'Verified Beauty post'
      end as title,
      posts.caption,
      media.object_path as media_path,
      'beauty-profile-media'::text as media_bucket,
      attributions.staff_id as credited_staff_id,
      staff.display_name as credited_staff_name,
      true as booking_cta_enabled,
      coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true) as booking_enabled,
      case
        when coalesce(booking_settings.booking_enabled, false)
          and coalesce(booking_settings.online_booking_visible, false)
          and coalesce(booking_settings.guest_booking_enabled, true)
          then '/book/' || attributions.salon_id::text || '?inspiration=' || posts.id::text || '&source=public_profile'
        else null
      end as booking_href,
      null::text as booking_note,
      'Book this transformation'::text as cta_label,
      'inspiration_only'::text as readiness_state,
      'Choose services and a professional. We will keep this transformation attached.'::text as readiness_message,
      null::uuid as primary_service_id,
      null::text as primary_service_name,
      null::numeric as primary_service_base_price,
      null::integer as primary_service_duration_minutes,
      '[]'::jsonb as add_ons,
      '[]'::jsonb as additional_services
    from public.beauty_posts posts
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    join public.beauty_post_attributions attributions on attributions.post_id = posts.id
    join public.beauty_post_verifications verifications
      on verifications.post_id = posts.id
     and verifications.state = 'verified'
    left join public.staff staff on staff.id = attributions.staff_id
    left join public.booking_settings booking_settings on booking_settings.salon_id = attributions.salon_id
    left join lateral (
      select post_media.object_path
      from public.beauty_post_media post_media
      where post_media.post_id = posts.id
      order by
        case post_media.role when 'after' then 0 when 'image' then 1 else 2 end,
        post_media.display_order,
        post_media.created_at,
        post_media.id
      limit 1
    ) media on true
    where (target_salon_ids is null or attributions.salon_id = any(target_salon_ids))
      and public.salon_profile_public_salon_exists(attributions.salon_id)
      and posts.deleted_at is null
      and posts.visibility = 'public'
      and posts.moderation_status = 'visible'
      and profiles.visibility = 'public'
      and media.object_path is not null
  )
  select * from profile_content
  union all
  select * from beauty_content
$$;

revoke all on function public.get_public_content_booking_options(uuid[]) from public;
grant execute on function public.get_public_content_booking_options(uuid[]) to anon, authenticated;
