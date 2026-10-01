create or replace function public.get_public_beauty_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_record record;
begin
  select
    profiles.id,
    profiles.bio,
    profiles.cover_media_path,
    profiles.visibility,
    profiles.created_at,
    profiles.updated_at,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    ) as display_name,
    users.avatar_url
  into profile_record
  from public.beauty_profiles profiles
  join public.users users on users.id = profiles.user_id
  where profiles.id = p_profile_id
    and profiles.visibility = 'public'
    and users.status = 'active';

  if profile_record.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', profile_record.id,
      'bio', profile_record.bio,
      'coverMediaPath', profile_record.cover_media_path,
      'visibility', profile_record.visibility,
      'createdAt', profile_record.created_at,
      'updatedAt', profile_record.updated_at,
      'displayName', profile_record.display_name,
      'avatarUrl', profile_record.avatar_url,
      'access', 'public'
    )
  );
end;
$$;

create or replace function public.resolve_beauty_profile_for_salon_customer(
  p_salon_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  customer_row public.customers%rowtype;
  profile_record record;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required');
  end if;

  if p_salon_id is null or p_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if not public.user_has_salon_permission(p_salon_id, array['customers.view']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select *
  into customer_row
  from public.customers
  where id = p_customer_id
    and location_id = p_salon_id
  limit 1;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if customer_row.customer_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'unlinked_customer');
  end if;

  select
    profiles.id,
    profiles.bio,
    profiles.cover_media_path,
    profiles.visibility,
    profiles.created_at,
    profiles.updated_at,
    coalesce(
      nullif(btrim(users.display_name), ''),
      nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
      'Reylumi customer'
    ) as display_name,
    users.avatar_url
  into profile_record
  from public.beauty_profiles profiles
  join public.users users on users.id = profiles.user_id
  where profiles.user_id = customer_row.customer_user_id
    and users.status = 'active'
  limit 1;

  if profile_record.id is null then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'profile', jsonb_build_object(
      'id', profile_record.id,
      'bio', profile_record.bio,
      'coverMediaPath', profile_record.cover_media_path,
      'visibility', profile_record.visibility,
      'createdAt', profile_record.created_at,
      'updatedAt', profile_record.updated_at,
      'displayName', profile_record.display_name,
      'avatarUrl', profile_record.avatar_url,
      'access', 'salon_customer'
    )
  );
end;
$$;

create or replace function public.list_beauty_timeline_for_salon_customer(
  p_salon_id uuid,
  p_customer_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_post_id uuid default null,
  p_page_size integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := public.current_public_user_id();
  clean_page_size integer := greatest(1, least(coalesce(p_page_size, 12), 24));
  customer_row public.customers%rowtype;
  profile_row public.beauty_profiles%rowtype;
  fetched_ids uuid[];
  page_ids uuid[];
  fetched_count integer := 0;
  cursor_created_at timestamptz;
  cursor_post_id uuid;
  items jsonb := '[]'::jsonb;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'items', '[]'::jsonb);
  end if;

  if p_salon_id is null or p_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'items', '[]'::jsonb);
  end if;

  if not public.user_has_salon_permission(p_salon_id, array['customers.view']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'items', '[]'::jsonb);
  end if;

  select *
  into customer_row
  from public.customers
  where id = p_customer_id
    and location_id = p_salon_id
  limit 1;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'items', '[]'::jsonb);
  end if;

  if customer_row.customer_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'unlinked_customer', 'items', '[]'::jsonb);
  end if;

  select profiles.*
  into profile_row
  from public.beauty_profiles profiles
  join public.users users on users.id = profiles.user_id
  where profiles.user_id = customer_row.customer_user_id
    and users.status = 'active'
  limit 1;

  if profile_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'profile_not_found', 'items', '[]'::jsonb);
  end if;

  if p_cursor_created_at is not null and p_cursor_post_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_cursor', 'items', '[]'::jsonb);
  end if;

  select coalesce(array_agg(id order by created_at desc, id desc), array[]::uuid[])
  into fetched_ids
  from (
    select posts.id, posts.created_at
    from public.beauty_posts posts
    where posts.profile_id = profile_row.id
      and posts.deleted_at is null
      and posts.moderation_status = 'visible'
      and posts.visibility = 'public'
      and (
        p_cursor_created_at is null
        or posts.created_at < p_cursor_created_at
        or (
          posts.created_at = p_cursor_created_at
          and posts.id < p_cursor_post_id
        )
      )
    order by posts.created_at desc, posts.id desc
    limit clean_page_size + 1
  ) ordered_posts;

  fetched_count := coalesce(array_length(fetched_ids, 1), 0);

  if fetched_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'items', '[]'::jsonb,
      'hasMore', false,
      'nextCursor', null
    );
  end if;

  page_ids := fetched_ids[1:clean_page_size];

  with page_posts as (
    select
      posts.id,
      posts.profile_id,
      posts.post_type,
      posts.caption,
      posts.visibility,
      posts.created_at,
      posts.updated_at,
      posts.edited_at,
      profiles.id as author_profile_id,
      coalesce(
        nullif(btrim(users.display_name), ''),
        nullif(btrim(concat_ws(' ', users.first_name, users.last_name)), ''),
        'Reylumi customer'
      ) as author_display_name,
      users.avatar_url as author_avatar_url
    from public.beauty_posts posts
    join public.beauty_profiles profiles on profiles.id = posts.profile_id
    join public.users users on users.id = posts.author_user_id
    where posts.id = any(coalesce(page_ids, array[]::uuid[]))
  ),
  media_by_post as (
    select
      media.post_id,
      jsonb_agg(
        jsonb_build_object(
          'id', media.id,
          'role', media.role,
          'bucket', media.bucket,
          'objectPath', media.object_path,
          'displayOrder', media.display_order,
          'width', media.width,
          'height', media.height,
          'mimeType', media.mime_type
        )
        order by media.display_order, media.created_at, media.id
      ) as media
    from public.beauty_post_media media
    join page_posts on page_posts.id = media.post_id
    group by media.post_id
  ),
  attribution_by_post as (
    select
      attributions.post_id,
      jsonb_build_object(
        'salonId', salons.id,
        'salonName', coalesce(nullif(btrim(settings.business_name), ''), salons.name),
        'staffId', staff.id,
        'staffName', staff.display_name,
        'source', attributions.source
      ) as attribution
    from public.beauty_post_attributions attributions
    join page_posts on page_posts.id = attributions.post_id
    join public.locations salons on salons.id = attributions.salon_id
    left join public.salon_settings settings on settings.salon_id = salons.id
    left join public.staff staff on staff.id = attributions.staff_id
  ),
  verification_by_post as (
    select
      verifications.post_id,
      jsonb_build_object(
        'state', verifications.state,
        'method', verifications.method,
        'verifiedAt', verifications.verified_at
      ) as verification
    from public.beauty_post_verifications verifications
    join page_posts on page_posts.id = verifications.post_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page_posts.id,
        'profileId', page_posts.profile_id,
        'type', page_posts.post_type,
        'caption', page_posts.caption,
        'visibility', page_posts.visibility,
        'createdAt', page_posts.created_at,
        'updatedAt', page_posts.updated_at,
        'editedAt', page_posts.edited_at,
        'author', jsonb_build_object(
          'profileId', page_posts.author_profile_id,
          'displayName', page_posts.author_display_name,
          'avatarUrl', page_posts.author_avatar_url
        ),
        'media', coalesce(media_by_post.media, '[]'::jsonb),
        'attribution', attribution_by_post.attribution,
        'verification', verification_by_post.verification,
        'reward', null
      )
      order by page_posts.created_at desc, page_posts.id desc
    ),
    '[]'::jsonb
  )
  into items
  from page_posts
  left join media_by_post on media_by_post.post_id = page_posts.id
  left join attribution_by_post on attribution_by_post.post_id = page_posts.id
  left join verification_by_post on verification_by_post.post_id = page_posts.id;

  if fetched_count > clean_page_size then
    select posts.created_at, posts.id
    into cursor_created_at, cursor_post_id
    from public.beauty_posts posts
    where posts.id = page_ids[clean_page_size]
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'items', items,
    'hasMore', fetched_count > clean_page_size,
    'nextCursor', case
      when fetched_count > clean_page_size and cursor_created_at is not null
      then jsonb_build_object('createdAt', cursor_created_at, 'postId', cursor_post_id)
      else null
    end
  );
end;
$$;

revoke all on function public.get_public_beauty_profile(uuid) from public;
grant execute on function public.get_public_beauty_profile(uuid) to anon, authenticated;

revoke all on function public.resolve_beauty_profile_for_salon_customer(uuid, uuid) from public;
grant execute on function public.resolve_beauty_profile_for_salon_customer(uuid, uuid) to authenticated;

revoke all on function public.list_beauty_timeline_for_salon_customer(uuid, uuid, timestamptz, uuid, integer) from public;
grant execute on function public.list_beauty_timeline_for_salon_customer(uuid, uuid, timestamptz, uuid, integer) to authenticated;
