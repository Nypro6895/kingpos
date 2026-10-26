BEGIN;
CREATE OR REPLACE FUNCTION public.get_public_explore_inspiration(p_cursor_media_id uuid DEFAULT NULL::uuid, p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_page_size integer DEFAULT 18)
 RETURNS TABLE(media_id uuid, content_id uuid, content_type text, salon_id uuid, salon_name text, salon_city text, salon_state text, salon_phone text, media_path text, image_width integer, image_height integer, aspect_ratio numeric, caption_excerpt text, published_at timestamp with time zone, author_display_name text, author_is_anonymous boolean, service_name text, service_category text, bookable_service_id uuid, booking_enabled boolean, booking_href text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with normalized as (
    select least(24, greatest(1, coalesce(p_page_size, 18))) as page_size_value
  ),
  content_rows as (
    select
      coalesce(media.id, looks.id) as media_id,
      looks.id as content_id,
      'look'::text as content_type,
      looks.salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.city, salons.city) as salon_city,
      coalesce(settings.state, salons.state) as salon_state,
      coalesce(settings.phone, salons.phone) as salon_phone,
      looks.media_path,
      media.width as image_width,
      media.height as image_height,
      case when media.width is not null and media.height is not null and media.height > 0 then media.width::numeric / media.height::numeric else null end as aspect_ratio,
      left(coalesce(looks.caption, looks.title), 180) as caption_excerpt,
      looks.published_at,
      looks.author_display_name,
      false as author_is_anonymous,
      services.name as service_name,
      services.category as service_category,
      case when services.is_active and services.online_booking_enabled then services.id else null end as bookable_service_id,
      coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true)
        and services.is_active
        and services.online_booking_enabled as booking_enabled,
      case
        when coalesce(booking_settings.booking_enabled, false)
          and coalesce(booking_settings.online_booking_visible, false)
          and coalesce(booking_settings.guest_booking_enabled, true)
          and services.is_active
          and services.online_booking_enabled
          then '/book/' || looks.salon_id::text
        else null
      end as booking_href
    from public.salon_profile_looks looks
    join public.locations salons on salons.id = looks.salon_id
    join public.salon_settings settings on settings.salon_id = looks.salon_id
    left join public.services on services.id = looks.service_id
    left join public.booking_settings on booking_settings.salon_id = looks.salon_id
    left join public.salon_profile_media_assets media
      on media.salon_id = looks.salon_id
      and media.object_path = looks.media_path
      and media.status = 'active'
      and media.deleted_at is null
    where looks.status = 'published'
      and looks.published_at is not null
      and looks.media_path is not null and nullif(looks.media_path, '') is not null
      and salons.status = 'active'
      and settings.public_discovery_enabled = true
    union all
    select
      coalesce(media.id, updates.id) as media_id,
      updates.id as content_id,
      'update'::text as content_type,
      updates.salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.city, salons.city) as salon_city,
      coalesce(settings.state, salons.state) as salon_state,
      coalesce(settings.phone, salons.phone) as salon_phone,
      updates.media_path,
      media.width as image_width,
      media.height as image_height,
      case when media.width is not null and media.height is not null and media.height > 0 then media.width::numeric / media.height::numeric else null end as aspect_ratio,
      left(coalesce(updates.caption, updates.summary, updates.title), 180) as caption_excerpt,
      updates.published_at,
      updates.author_display_name,
      false as author_is_anonymous,
      services.name as service_name,
      services.category as service_category,
      case when services.is_active and services.online_booking_enabled then services.id else null end as bookable_service_id,
      coalesce(booking_settings.booking_enabled, false)
        and coalesce(booking_settings.online_booking_visible, false)
        and coalesce(booking_settings.guest_booking_enabled, true)
        and services.is_active
        and services.online_booking_enabled as booking_enabled,
      case
        when coalesce(booking_settings.booking_enabled, false)
          and coalesce(booking_settings.online_booking_visible, false)
          and coalesce(booking_settings.guest_booking_enabled, true)
          and services.is_active
          and services.online_booking_enabled
          then '/book/' || updates.salon_id::text
        else null
      end as booking_href
    from public.salon_profile_updates updates
    join public.locations salons on salons.id = updates.salon_id
    join public.salon_settings settings on settings.salon_id = updates.salon_id
    left join public.services on services.id = updates.service_id
    left join public.booking_settings on booking_settings.salon_id = updates.salon_id
    left join public.salon_profile_media_assets media
      on media.salon_id = updates.salon_id
      and media.object_path = updates.media_path
      and media.status = 'active'
      and media.deleted_at is null
    where updates.status = 'published'
      and updates.published_at is not null
      and updates.media_path is not null and nullif(updates.media_path, '') is not null
      and salons.status = 'active'
      and settings.public_discovery_enabled = true
  )
  select
    media_id,
    content_id,
    content_type,
    salon_id,
    salon_name,
    salon_city,
    salon_state,
    salon_phone,
    media_path,
    image_width,
    image_height,
    aspect_ratio,
    caption_excerpt,
    published_at,
    author_display_name,
    author_is_anonymous,
    service_name,
    service_category,
    bookable_service_id,
    booking_enabled,
    booking_href
  from content_rows
  where p_cursor_published_at is null
    or published_at < p_cursor_published_at
    or (
      published_at = p_cursor_published_at
      and (p_cursor_media_id is null or media_id < p_cursor_media_id)
    )
  order by published_at desc, media_id desc
  limit (select page_size_value + 1 from normalized)
$function$
;
CREATE OR REPLACE FUNCTION public.get_public_explore_home_salons(p_recommended_limit integer DEFAULT 6, p_new_limit integer DEFAULT 6)
 RETURNS TABLE(salon_id uuid, salon_name text, phone text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, latitude double precision, longitude double precision, description text, public_discovery_published_at timestamp with time zone, profile_completeness integer, active_service_count bigint, service_categories text[], service_names text[], section text, home_rank bigint, is_new boolean, created_at timestamp with time zone, updated_at timestamp with time zone, cover_image_path text, latest_media_created_at timestamp with time zone, featured_service_category text, featured_service_name text, has_public_profile boolean, starting_price numeric)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan AS $function$
#variable_conflict use_column
DECLARE saved_location text; saved_location_tokens text[]; saved_categories text[];
BEGIN
 SELECT coalesce((SELECT location_label FROM public.explore_user_preferences WHERE user_id=public.current_public_user_id()),'') INTO saved_location;
 saved_location_tokens:=regexp_split_to_array(public.normalize_search_text(saved_location),'\s+');
 saved_categories:=public.explore_preferred_categories();
 IF cardinality(saved_categories)=0 THEN RETURN QUERY   with public_salons as NOT MATERIALIZED (SELECT p.*, (p.created_at >= now()-interval '30 days') AS is_new FROM public.explore_salon_documents p WHERE saved_location='' OR CASE WHEN saved_location~'^[A-Za-z]{2}$' THEN p.state_code=upper(saved_location) ELSE public.search_text_has_all_tokens(p.location_search_text,saved_location_tokens) END
  ),
  recommended as (
    select public_salons.*, 'recommended'::text as section, row_number() over (
      order by public_discovery_published_at desc nulls last, profile_completeness desc, updated_at desc
    ) as home_rank
    from public_salons
    order by public_discovery_published_at desc nulls last, profile_completeness desc, updated_at desc
    limit greatest(0, coalesce(p_recommended_limit, 6))
  ),
  new_salons as (
    select public_salons.*, 'new'::text as section, row_number() over (
      order by created_at desc, updated_at desc
    ) as home_rank
    from public_salons
    order by created_at desc, updated_at desc
    limit greatest(0, coalesce(p_new_limit, 6))
  )
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    public_discovery_published_at,
    profile_completeness,
    active_service_count,
    service_categories,
    service_names,
    section,
    home_rank,
    is_new,
    created_at,
    updated_at,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    has_public_profile,
    starting_price
  from recommended
  union all
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    public_discovery_published_at,
    profile_completeness,
    active_service_count,
    service_categories,
    service_names,
    section,
    home_rank,
    is_new,
    created_at,
    updated_at,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    has_public_profile,
    starting_price
  from new_salons
;
 ELSE RETURN QUERY   with public_salons as NOT MATERIALIZED (SELECT p.*, (p.created_at >= now()-interval '30 days') AS is_new FROM public.explore_salon_documents p WHERE saved_location='' OR CASE WHEN saved_location~'^[A-Za-z]{2}$' THEN p.state_code=upper(saved_location) ELSE public.search_text_has_all_tokens(p.location_search_text,saved_location_tokens) END
  ),
  recommended as (
    select public_salons.*, 'recommended'::text as section, row_number() over (
      order by (service_categories && saved_categories) desc, public_discovery_published_at desc nulls last, profile_completeness desc, updated_at desc
    ) as home_rank
    from public_salons
    order by (service_categories && saved_categories) desc, public_discovery_published_at desc nulls last, profile_completeness desc, updated_at desc
    limit greatest(0, coalesce(p_recommended_limit, 6))
  ),
  new_salons as (
    select public_salons.*, 'new'::text as section, row_number() over (
      order by created_at desc, updated_at desc
    ) as home_rank
    from public_salons
    order by created_at desc, updated_at desc
    limit greatest(0, coalesce(p_new_limit, 6))
  )
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    public_discovery_published_at,
    profile_completeness,
    active_service_count,
    service_categories,
    service_names,
    section,
    home_rank,
    is_new,
    created_at,
    updated_at,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    has_public_profile,
    starting_price
  from recommended
  union all
  select
    salon_id,
    salon_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    latitude,
    longitude,
    description,
    public_discovery_published_at,
    profile_completeness,
    active_service_count,
    service_categories,
    service_names,
    section,
    home_rank,
    is_new,
    created_at,
    updated_at,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    has_public_profile,
    starting_price
  from new_salons
;
 END IF;
END $function$;
COMMIT;
