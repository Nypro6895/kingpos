-- Two-letter US state filters must match the state, never a substring of a city or street.
begin;
CREATE OR REPLACE FUNCTION public.search_public_explore_salons(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_page integer DEFAULT 1, p_page_size integer DEFAULT 12)
 RETURNS TABLE(salon_id uuid, salon_name text, phone text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, latitude double precision, longitude double precision, description text, active_service_count bigint, service_categories text[], service_names text[], cover_image_path text, latest_media_created_at timestamp with time zone, featured_service_category text, featured_service_name text, starting_price numeric, profile_completeness integer, has_public_profile boolean, is_new boolean, distance_miles double precision, match_type text, match_tier integer, relevance_score double precision, result_group text, total_count bigint, group_total_count bigint, best_match_count bigint, nearby_count bigint, recommended_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with normalized as (
    select
      nullif(btrim(p_query), '') as raw_query,
      public.normalize_search_text(p_query) as query_text,
      case
        when public.normalize_search_text(p_query) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_query), '\s+')
      end as query_tokens,
      nullif(btrim(p_category), '') as raw_category,
      public.normalize_search_text(p_category) as category_text,
      case
        when public.normalize_search_text(p_category) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_category), '\s+')
      end as category_tokens,
      nullif(btrim(p_location), '') as raw_location,
      public.normalize_search_text(p_location) as location_text,
      case
        when public.normalize_search_text(p_location) is null then '{}'::text[]
        else regexp_split_to_array(public.normalize_search_text(p_location), '\s+')
      end as location_tokens,
      case when p_latitude between -90 and 90 then p_latitude else null end as latitude_value,
      case when p_longitude between -180 and 180 then p_longitude else null end as longitude_value,
      greatest(1, coalesce(p_page, 1)) as page_value,
      least(12, greatest(1, coalesce(p_page_size, 12))) as page_size_value
  ),
  active_services as (
    select
      services.salon_id,
      services.name,
      services.category,
      services.description,
      services.base_price,
      services.online_booking_enabled
    from public.services
    where services.is_active = true
  ),
  service_rollups_raw as (
    select
      active_services.salon_id,
      count(*)::bigint as active_service_count,
      array_agg(distinct active_services.category)
        filter (where nullif(active_services.category, '') is not null) as service_categories,
      array_agg(active_services.name order by active_services.name)
        filter (where nullif(active_services.name, '') is not null) as service_names_all,
      min(active_services.base_price) as starting_price,
      public.normalize_search_text(
        string_agg(
          concat_ws(
            ' ',
            active_services.name,
            active_services.category,
            active_services.description
          ),
          ' '
        )
      ) as service_search_text,
      public.normalize_search_text(string_agg(active_services.category, ' ')) as service_category_search_text
    from active_services
    group by active_services.salon_id
  ),
  service_rollups as (
    select
      service_rollups_raw.salon_id,
      service_rollups_raw.active_service_count,
      coalesce(service_rollups_raw.service_categories, '{}'::text[]) as service_categories,
      coalesce(service_rollups_raw.service_names_all[1:8], '{}'::text[]) as service_names,
      service_rollups_raw.starting_price,
      service_rollups_raw.service_search_text,
      service_rollups_raw.service_category_search_text
    from service_rollups_raw
  ),
  featured_services as (
    select salon_id, category, name
    from (
      select
        active_services.salon_id,
        active_services.category,
        active_services.name,
        row_number() over (
          partition by active_services.salon_id
          order by active_services.name
        ) as row_number
      from active_services
      where active_services.online_booking_enabled = true
    ) ranked
    where ranked.row_number = 1
  ),
  public_salons as (
    select
      salons.id as salon_id,
      coalesce(nullif(settings.business_name, ''), salons.name) as salon_name,
      coalesce(settings.phone, salons.phone) as phone,
      coalesce(settings.address_line1, salons.address_line1) as address_line1,
      coalesce(settings.address_line2, salons.address_line2) as address_line2,
      coalesce(settings.city, salons.city) as city,
      coalesce(settings.state, salons.state) as state,
      coalesce(settings.postal_code, salons.postal_code) as postal_code,
      coalesce(settings.country, salons.country) as country,
      salons.latitude,
      salons.longitude,
      settings.business_description as description,
      (
        case when settings.public_discovery_enabled then 20 else 0 end
        + case when nullif(settings.business_description, '') is not null then 20 else 0 end
        + case when nullif(settings.public_profile_cover_path, '') is not null then 20 else 0 end
        + case when coalesce(service_rollups.active_service_count, 0) > 0 then 20 else 0 end
        + case when coalesce(booking_settings.booking_enabled, false) then 20 else 0 end
      )::integer as profile_completeness,
      coalesce(service_rollups.active_service_count, 0)::bigint as active_service_count,
      coalesce(service_rollups.service_categories, directory.source_categories, '{}'::text[]) as service_categories,
      coalesce(service_rollups.service_names, '{}'::text[]) as service_names,
      coalesce(
        nullif(settings.public_profile_cover_path, ''),
        (
          select media.object_path
          from public.salon_profile_media_assets media
          where media.salon_id = salons.id
            and media.status = 'active'
            and media.deleted_at is null
            and media.purpose in ('cover', 'look', 'update')
          order by case when media.purpose = 'cover' then 0 else 1 end, media.created_at desc
          limit 1
        )
      ) as cover_image_path,
      (
        select max(media.created_at)
        from public.salon_profile_media_assets media
        where media.salon_id = salons.id
          and media.status = 'active'
          and media.deleted_at is null
      ) as latest_media_created_at,
      featured_services.category as featured_service_category,
      featured_services.name as featured_service_name,
      service_rollups.starting_price,
      true as has_public_profile,
      (salons.created_at >= now() - interval '30 days') as is_new,
      salons.created_at,
      salons.updated_at,
      public.normalize_search_text(coalesce(nullif(settings.business_name, ''), salons.name)) as salon_name_search,
      public.normalize_search_text(settings.business_description) as description_search,
      public.normalize_search_text(
        concat_ws(
          ' ',
          coalesce(nullif(settings.business_name, ''), salons.name),
          salons.name,
          settings.business_description,
          service_rollups.service_search_text,
          array_to_string(directory.source_categories, ' '),
          coalesce(settings.phone, salons.phone),
          coalesce(settings.address_line1, salons.address_line1),
          coalesce(settings.city, salons.city)
        )
      ) as search_document,
      public.normalize_search_text(
        concat_ws(
          ' ',
          coalesce(settings.city, salons.city),
          coalesce(settings.state, salons.state),
          coalesce(settings.postal_code, salons.postal_code),
          coalesce(settings.address_line1, salons.address_line1)
        )
      ) as location_search_text,
      service_rollups.service_search_text,
      service_rollups.service_category_search_text
    from public.locations salons
    cross join normalized
    join public.salon_settings settings on settings.salon_id = salons.id
    left join public.salon_directory_listings directory on directory.salon_id = salons.id
    left join public.booking_settings on booking_settings.salon_id = salons.id
    left join service_rollups on service_rollups.salon_id = salons.id
    left join featured_services on featured_services.salon_id = salons.id
    where salons.status = 'active'
      and settings.public_discovery_enabled = true
      and (
        upper(normalized.raw_location) <> all(array['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']::text[])
        or normalized.raw_location is null
        or upper(btrim(coalesce(settings.state, salons.state, ''))) = upper(normalized.raw_location)
      )
      and (
        normalized.category_text is null
        or coalesce(service_rollups.service_category_search_text, public.normalize_search_text(array_to_string(directory.source_categories, ' ')), '') like '%' || normalized.category_text || '%'
        or public.search_text_has_all_tokens(
          coalesce(service_rollups.service_category_search_text, public.normalize_search_text(array_to_string(directory.source_categories, ' ')), ''),
          normalized.category_tokens
        )
        or extensions.word_similarity(
          normalized.category_text,
          coalesce(service_rollups.service_category_search_text, public.normalize_search_text(array_to_string(directory.source_categories, ' ')), '')
        ) >= 0.82
      )
      and (
        normalized.location_text is null
        or coalesce(public.normalize_search_text(settings.city), public.normalize_search_text(salons.city), '') = normalized.location_text
        or coalesce(public.normalize_search_text(settings.postal_code), public.normalize_search_text(salons.postal_code), '') = normalized.location_text
        or public.normalize_search_text(
          concat_ws(
            ' ',
            coalesce(settings.city, salons.city),
            coalesce(settings.state, salons.state),
            coalesce(settings.postal_code, salons.postal_code),
            coalesce(settings.address_line1, salons.address_line1)
          )
        ) like '%' || normalized.location_text || '%'
        or public.search_text_has_all_tokens(
          public.normalize_search_text(
            concat_ws(
              ' ',
              coalesce(settings.city, salons.city),
              coalesce(settings.state, salons.state),
              coalesce(settings.postal_code, salons.postal_code),
              coalesce(settings.address_line1, salons.address_line1)
            )
          ),
          normalized.location_tokens
        )
      )
  ),
  scored_base as (
    select
      public_salons.*,
      case
        when normalized.latitude_value is not null
          and normalized.longitude_value is not null
          and public_salons.latitude is not null
          and public_salons.longitude is not null
          then 3958.8 * acos(least(1, greatest(-1,
            sin(radians(normalized.latitude_value)) * sin(radians(public_salons.latitude))
            + cos(radians(normalized.latitude_value)) * cos(radians(public_salons.latitude))
            * cos(radians(public_salons.longitude) - radians(normalized.longitude_value))
          )))
        else null
      end as distance_miles,
      greatest(
        case
          when normalized.query_text is not null
            and public_salons.salon_name_search = normalized.query_text
          then 140 else 0
        end,
        case
          when normalized.query_text is not null
            and public_salons.salon_name_search like normalized.query_text || '%'
          then 120 else 0
        end,
        case
          when normalized.query_text is not null
            and coalesce(public_salons.service_search_text, '') like normalized.query_text || '%'
          then 110 else 0
        end,
        case
          when normalized.query_text is not null
            and public_salons.salon_name_search like '%' || normalized.query_text || '%'
          then 100 else 0
        end,
        case
          when normalized.query_text is not null
            and coalesce(public_salons.service_search_text, '') like '%' || normalized.query_text || '%'
          then 90 else 0
        end,
        case
          when normalized.query_text is not null
            and public.search_text_has_all_tokens(
              coalesce(public_salons.search_document, ''),
              normalized.query_tokens
            )
          then 78 else 0
        end,
        case
          when normalized.query_text is not null
            and coalesce(public_salons.description_search, '') like '%' || normalized.query_text || '%'
          then 45 else 0
        end,
        case
          when normalized.query_text is not null
            and greatest(
              extensions.word_similarity(normalized.query_text, coalesce(public_salons.salon_name_search, '')),
              extensions.word_similarity(normalized.query_text, coalesce(public_salons.service_search_text, '')),
              extensions.similarity(normalized.query_text, coalesce(public_salons.salon_name_search, '')),
              extensions.similarity(normalized.query_text, coalesce(public_salons.service_search_text, ''))
            ) >= 0.42
          then 55 + 35 * greatest(
            extensions.word_similarity(normalized.query_text, coalesce(public_salons.salon_name_search, '')),
            extensions.word_similarity(normalized.query_text, coalesce(public_salons.service_search_text, '')),
            extensions.similarity(normalized.query_text, coalesce(public_salons.salon_name_search, '')),
            extensions.similarity(normalized.query_text, coalesce(public_salons.service_search_text, ''))
          ) else 0
        end
      )::double precision as text_relevance_score,
      case
        when normalized.category_text is not null then 35
        else 0
      end::double precision as category_relevance_score,
      case
        when normalized.location_text is not null then 15
        else 0
      end::double precision as location_relevance_score,
      normalized.query_text is not null or normalized.category_text is not null as has_best_match_filter,
      normalized.location_text is not null as has_location_filter,
      normalized.page_value,
      normalized.page_size_value
    from public_salons
    cross join normalized
  ),
  scored as (
    select
      scored_base.*,
      (
        (select query_text from normalized) is null
        or scored_base.text_relevance_score > 0
      ) as query_matches
    from scored_base
  ),
  grouped as (
    select
      scored.*,
      case
        when scored.has_best_match_filter and scored.query_matches then 'best_match'
        when scored.distance_miles is not null or scored.has_location_filter then 'nearby'
        else 'recommended'
      end as result_group,
      case
        when scored.has_best_match_filter and scored.query_matches then 'search'
        when scored.distance_miles is not null then 'distance'
        when scored.has_location_filter then 'area'
        else 'recommended'
      end as match_type,
      case
        when scored.has_best_match_filter and scored.query_matches then 1
        when scored.distance_miles is not null or scored.has_location_filter then 2
        else 3
      end as match_tier,
      (
        scored.text_relevance_score
        + scored.category_relevance_score
        + scored.location_relevance_score
        + scored.profile_completeness::double precision
        + case when scored.is_new then 8 else 0 end
        - coalesce(scored.distance_miles, 0) / 12
      ) as relevance_score
    from scored
  ),
  counted as (
    select
      grouped.*,
      count(*) over () as total_count,
      count(*) filter (where grouped.result_group = 'best_match') over () as best_match_count,
      count(*) filter (where grouped.result_group = 'nearby') over () as nearby_count,
      count(*) filter (where grouped.result_group = 'recommended') over () as recommended_count,
      count(*) over (partition by grouped.result_group) as group_total_count
    from grouped
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
    active_service_count,
    service_categories,
    service_names,
    cover_image_path,
    latest_media_created_at,
    featured_service_category,
    featured_service_name,
    starting_price,
    profile_completeness,
    has_public_profile,
    is_new,
    distance_miles,
    match_type,
    match_tier,
    relevance_score,
    result_group,
    total_count,
    group_total_count,
    best_match_count,
    nearby_count,
    recommended_count
  from counted
  order by
    match_tier,
    case when match_tier = 1 then text_relevance_score end desc,
    case when match_tier = 1 then relevance_score end desc,
    distance_miles nulls last,
    relevance_score desc,
    updated_at desc,
    salon_id
  limit (select page_size_value from normalized)
  offset (select (page_value - 1) * page_size_value from normalized)
$function$
;
commit;
