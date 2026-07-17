drop function if exists public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
);

create function public.get_public_explore_inspiration(
  p_cursor_published_at timestamptz default null,
  p_cursor_media_id uuid default null,
  p_page_size integer default 18
)
returns table (
  content_id uuid,
  content_type text,
  media_id uuid,
  salon_id uuid,
  salon_name text,
  salon_city text,
  salon_state text,
  salon_phone text,
  media_path text,
  image_width integer,
  image_height integer,
  aspect_ratio numeric,
  caption_excerpt text,
  service_name text,
  service_category text,
  published_at timestamptz,
  author_display_name text,
  author_is_anonymous boolean
)
language sql
stable
security definer
set search_path = public, storage
as $$
  with params as (
    select greatest(1, least(coalesce(p_page_size, 18), 24)) as page_size
  ),
  look_items as (
    select
      looks.id as content_id,
      'look'::text as content_type,
      coalesce(assets.id, looks.id) as media_id,
      looks.salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), locations.name) as salon_name,
      coalesce(nullif(btrim(settings.city), ''), locations.city) as salon_city,
      coalesce(nullif(btrim(settings.state), ''), locations.state) as salon_state,
      coalesce(nullif(btrim(settings.phone), ''), locations.phone) as salon_phone,
      looks.media_path,
      assets.width as image_width,
      assets.height as image_height,
      case
        when assets.width is not null and assets.height is not null and assets.height > 0
        then round((assets.width::numeric / assets.height::numeric), 4)
        else null::numeric
      end as aspect_ratio,
      nullif(
        left(
          btrim(coalesce(looks.caption, looks.emotional_description, '')),
          180
        ),
        ''
      ) as caption_excerpt,
      nullif(btrim(services.name), '') as service_name,
      nullif(btrim(services.category), '') as service_category,
      coalesce(looks.published_at, looks.created_at) as published_at,
      coalesce(
        author_staff.display_name,
        nullif(btrim(settings.business_name), ''),
        locations.name,
        'Salon team'
      ) as author_display_name,
      (author_staff.id is null) as author_is_anonymous
    from public.salon_profile_looks looks
    join public.locations locations
      on locations.id = looks.salon_id
      and locations.organization_id = looks.organization_id
      and locations.status = 'active'
    join public.salon_settings settings
      on settings.salon_id = looks.salon_id
      and settings.organization_id = looks.organization_id
    left join public.salon_profile_media_assets assets
      on assets.bucket = 'salon-profile-media'
      and assets.object_path = looks.media_path
      and assets.organization_id = looks.organization_id
      and assets.salon_id = looks.salon_id
      and assets.attached_entity_type = 'look'
      and assets.attached_entity_id = looks.id
      and assets.purpose = 'look'
    join storage.objects storage_objects
      on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
      and storage_objects.name = looks.media_path
    left join public.services services
      on services.id = looks.service_id
      and services.salon_id = looks.salon_id
      and services.organization_id = looks.organization_id
      and services.is_active = true
    left join public.staff author_staff
      on author_staff.id = looks.author_staff_id
      and author_staff.salon_id = looks.salon_id
      and public.staff_has_effective_public_profile(author_staff)
    where looks.status = 'published'
      and looks.media_path is not null
      and public.salon_profile_public_salon_exists(looks.salon_id)
      and (
        looks.media_path like looks.salon_id::text || '/looks/%'
        or (
          split_part(looks.media_path, '/', 2) = looks.salon_id::text
          and split_part(looks.media_path, '/', 3) = 'looks'
        )
      )
      and (
        assets.id is null
        or (
          assets.status = 'active'
          and assets.deleted_at is null
          and assets.quarantined_at is null
        )
      )
      and (
        coalesce(
          nullif(btrim(assets.mime_type), ''),
          nullif(btrim(storage_objects.metadata ->> 'mimetype'), '')
        ) in ('image/jpeg', 'image/png', 'image/webp')
        or lower(looks.media_path) like '%.jpg'
        or lower(looks.media_path) like '%.jpeg'
        or lower(looks.media_path) like '%.png'
        or lower(looks.media_path) like '%.webp'
      )
  ),
  update_items as (
    select
      updates.id as content_id,
      'update'::text as content_type,
      coalesce(assets.id, updates.id) as media_id,
      updates.salon_id,
      coalesce(nullif(btrim(settings.business_name), ''), locations.name) as salon_name,
      coalesce(nullif(btrim(settings.city), ''), locations.city) as salon_city,
      coalesce(nullif(btrim(settings.state), ''), locations.state) as salon_state,
      coalesce(nullif(btrim(settings.phone), ''), locations.phone) as salon_phone,
      updates.media_path,
      assets.width as image_width,
      assets.height as image_height,
      case
        when assets.width is not null and assets.height is not null and assets.height > 0
        then round((assets.width::numeric / assets.height::numeric), 4)
        else null::numeric
      end as aspect_ratio,
      nullif(
        left(
          btrim(coalesce(updates.caption, updates.summary, '')),
          180
        ),
        ''
      ) as caption_excerpt,
      nullif(btrim(services.name), '') as service_name,
      nullif(btrim(services.category), '') as service_category,
      coalesce(updates.published_at, updates.created_at) as published_at,
      coalesce(
        author_staff.display_name,
        nullif(btrim(settings.business_name), ''),
        locations.name,
        'Salon team'
      ) as author_display_name,
      (author_staff.id is null) as author_is_anonymous
    from public.salon_profile_updates updates
    join public.locations locations
      on locations.id = updates.salon_id
      and locations.organization_id = updates.organization_id
      and locations.status = 'active'
    join public.salon_settings settings
      on settings.salon_id = updates.salon_id
      and settings.organization_id = updates.organization_id
    left join public.salon_profile_media_assets assets
      on assets.bucket = 'salon-profile-media'
      and assets.object_path = updates.media_path
      and assets.organization_id = updates.organization_id
      and assets.salon_id = updates.salon_id
      and assets.attached_entity_type = 'update'
      and assets.attached_entity_id = updates.id
      and assets.purpose = 'update'
    join storage.objects storage_objects
      on storage_objects.bucket_id = coalesce(assets.bucket, 'salon-profile-media')
      and storage_objects.name = updates.media_path
    left join public.services services
      on services.id = updates.service_id
      and services.salon_id = updates.salon_id
      and services.organization_id = updates.organization_id
      and services.is_active = true
    left join public.staff author_staff
      on author_staff.id = updates.author_staff_id
      and author_staff.salon_id = updates.salon_id
      and public.staff_has_effective_public_profile(author_staff)
    where updates.status = 'published'
      and updates.media_path is not null
      and public.salon_profile_public_salon_exists(updates.salon_id)
      and updates.media_path like updates.salon_id::text || '/updates/%'
      and (
        assets.id is null
        or (
          assets.status = 'active'
          and assets.deleted_at is null
          and assets.quarantined_at is null
        )
      )
      and (
        coalesce(
          nullif(btrim(assets.mime_type), ''),
          nullif(btrim(storage_objects.metadata ->> 'mimetype'), '')
        ) in ('image/jpeg', 'image/png', 'image/webp')
        or lower(updates.media_path) like '%.jpg'
        or lower(updates.media_path) like '%.jpeg'
        or lower(updates.media_path) like '%.png'
        or lower(updates.media_path) like '%.webp'
      )
  ),
  combined as (
    select * from look_items
    union all
    select * from update_items
  ),
  deduped as (
    select distinct on (combined.media_id)
      combined.*
    from combined
    order by
      combined.media_id,
      combined.published_at desc,
      combined.content_id desc
  ),
  ranked as (
    select
      deduped.*,
      row_number() over (
        partition by deduped.salon_id
        order by deduped.published_at desc, deduped.media_id desc
      ) as salon_item_rank
    from deduped
  )
  select
    ranked.content_id,
    ranked.content_type,
    ranked.media_id,
    ranked.salon_id,
    ranked.salon_name,
    ranked.salon_city,
    ranked.salon_state,
    ranked.salon_phone,
    ranked.media_path,
    ranked.image_width,
    ranked.image_height,
    ranked.aspect_ratio,
    ranked.caption_excerpt,
    ranked.service_name,
    ranked.service_category,
    ranked.published_at,
    ranked.author_display_name,
    ranked.author_is_anonymous
  from ranked, params
  where (
      p_cursor_published_at is null
      or p_cursor_media_id is null
      or ranked.published_at < p_cursor_published_at
      or (
        ranked.published_at = p_cursor_published_at
        and ranked.media_id < p_cursor_media_id
      )
    )
    and (
      p_cursor_published_at is not null
      or ranked.salon_item_rank <= 3
    )
  order by
    ranked.published_at desc,
    ranked.media_id desc
  limit (select page_size + 1 from params);
$$;

comment on function public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
) is 'Public, cursor-paginated Explore inspiration feed from published salon profile looks and updates. Active media assets are enforced when present; legacy rows require a valid salon-scoped storage object.';

revoke all on function public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
) from public;

grant execute on function public.get_public_explore_inspiration(
  timestamptz,
  uuid,
  integer
) to anon, authenticated;
