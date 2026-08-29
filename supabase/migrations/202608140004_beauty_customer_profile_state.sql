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
    return jsonb_build_object('ok', false, 'code', 'not_found', 'state', 'forbidden');
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'public',
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
  profile_state text;
begin
  if actor_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'state', 'forbidden');
  end if;

  if p_salon_id is null or p_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'state', 'unavailable');
  end if;

  if not public.user_has_salon_permission(p_salon_id, array['customers.view']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'state', 'forbidden');
  end if;

  select *
  into customer_row
  from public.customers
  where id = p_customer_id
    and location_id = p_salon_id
  limit 1;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'state', 'forbidden');
  end if;

  if customer_row.customer_user_id is null then
    return jsonb_build_object('ok', true, 'state', 'unlinked', 'profile', null);
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
    return jsonb_build_object('ok', true, 'state', 'profile_not_created', 'profile', null);
  end if;

  profile_state := case
    when profile_record.visibility = 'public' then 'public'
    else 'private'
  end;

  return jsonb_build_object(
    'ok', true,
    'state', profile_state,
    'profile', jsonb_build_object(
      'id', profile_record.id,
      'bio', case when profile_state = 'public' then profile_record.bio else null end,
      'coverMediaPath', case when profile_state = 'public' then profile_record.cover_media_path else null end,
      'visibility', profile_record.visibility,
      'createdAt', profile_record.created_at,
      'updatedAt', profile_record.updated_at,
      'displayName', profile_record.display_name,
      'avatarUrl', profile_record.avatar_url,
      'access', case when profile_state = 'public' then 'public' else 'salon_customer' end
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
    return jsonb_build_object('ok', false, 'code', 'sign_in_required', 'state', 'forbidden', 'items', '[]'::jsonb);
  end if;

  if p_salon_id is null or p_customer_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input', 'state', 'unavailable', 'items', '[]'::jsonb);
  end if;

  if not public.user_has_salon_permission(p_salon_id, array['customers.view']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'forbidden', 'state', 'forbidden', 'items', '[]'::jsonb);
  end if;

  select *
  into customer_row
  from public.customers
  where id = p_customer_id
    and location_id = p_salon_id
  limit 1;

  if customer_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'state', 'forbidden', 'items', '[]'::jsonb);
  end if;

  if customer_row.customer_user_id is null then
    return jsonb_build_object('ok', true, 'state', 'unlinked', 'items', '[]'::jsonb, 'hasMore', false, 'nextCursor', null);
  end if;

  select profiles.*
  into profile_row
  from public.beauty_profiles profiles
  join public.users users on users.id = profiles.user_id
  where profiles.user_id = customer_row.customer_user_id
    and users.status = 'active'
  limit 1;

  if profile_row.id is null then
    return jsonb_build_object('ok', true, 'state', 'profile_not_created', 'items', '[]'::jsonb, 'hasMore', false, 'nextCursor', null);
  end if;

  if profile_row.visibility <> 'public' then
    return jsonb_build_object('ok', false, 'code', 'private_profile', 'state', 'private', 'items', '[]'::jsonb);
  end if;

  if p_cursor_created_at is not null and p_cursor_post_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_cursor', 'state', 'unavailable', 'items', '[]'::jsonb);
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
      'state', 'public',
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
      posts.salon_id,
      posts.booking_id,
      posts.ticket_id,
      posts.created_at,
      posts.updated_at,
      locations.name as salon_name,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', media.id,
            'role', media.role,
            'path', media.storage_path,
            'width', media.width,
            'height', media.height,
            'displayOrder', media.display_order
          )
          order by media.display_order, media.created_at, media.id
        ) filter (where media.id is not null),
        '[]'::jsonb
      ) as media_items
    from public.beauty_posts posts
    left join public.locations locations on locations.id = posts.salon_id
    left join public.beauty_post_media media on media.post_id = posts.id
    where posts.id = any(page_ids)
    group by posts.id, locations.name
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', page_posts.id,
        'profileId', page_posts.profile_id,
        'type', page_posts.post_type,
        'caption', page_posts.caption,
        'visibility', page_posts.visibility,
        'salonId', page_posts.salon_id,
        'bookingId', page_posts.booking_id,
        'ticketId', page_posts.ticket_id,
        'createdAt', page_posts.created_at,
        'updatedAt', page_posts.updated_at,
        'attribution', case
          when page_posts.salon_id is not null
          then jsonb_build_object('salonId', page_posts.salon_id, 'salonName', page_posts.salon_name)
          else null
        end,
        'media', page_posts.media_items
      )
      order by page_posts.created_at desc, page_posts.id desc
    ),
    '[]'::jsonb
  )
  into items
  from page_posts;

  if fetched_count > clean_page_size then
    select posts.created_at, posts.id
    into cursor_created_at, cursor_post_id
    from public.beauty_posts posts
    where posts.id = page_ids[clean_page_size]
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'public',
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
