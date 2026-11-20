-- Narrow state documents before expensive fuzzy matching; retain custom service category behavior.
BEGIN;
CREATE OR REPLACE FUNCTION public.search_public_explore_salons_ranked(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_page integer DEFAULT 1, p_page_size integer DEFAULT 12)
 RETURNS TABLE(salon_id uuid, salon_name text, phone text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, latitude double precision, longitude double precision, description text, active_service_count bigint, service_categories text[], service_names text[], cover_image_path text, latest_media_created_at timestamp with time zone, featured_service_category text, featured_service_name text, starting_price numeric, profile_completeness integer, has_public_profile boolean, is_new boolean, distance_miles double precision, match_type text, match_tier integer, relevance_score double precision, result_group text, total_count bigint, group_total_count bigint, best_match_count bigint, nearby_count bigint, recommended_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET jit TO 'off'
AS $function$
  with normalized as materialized (
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
  eligible_documents AS MATERIALIZED (
    SELECT p.* FROM normalized n CROSS JOIN LATERAL (
      SELECT p.* FROM public.explore_salon_documents p
      WHERE p.state_code=upper(n.raw_location) AND CASE WHEN n.category_text IS NULL THEN true WHEN n.raw_category=ANY(ARRAY['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care']::text[]) AND p.service_categories <@ ARRAY['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care']::text[] THEN n.raw_category=ANY(p.service_categories) ELSE p.service_category_search_text LIKE '%'||n.category_text||'%' OR public.search_text_has_all_tokens(p.service_category_search_text,n.category_tokens) OR extensions.word_similarity(n.category_text,p.service_category_search_text)>=0.82 END OFFSET 0
    ) p WHERE upper(n.raw_location)=ANY(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'])
    UNION ALL
    SELECT p.* FROM normalized n CROSS JOIN LATERAL (
      SELECT p.* FROM public.explore_salon_documents p
      WHERE (n.location_text IS NULL OR p.city_search=n.location_text OR public.normalize_search_text(p.postal_code)=n.location_text OR p.location_search_text LIKE '%'||n.location_text||'%' OR public.search_text_has_all_tokens(p.location_search_text,n.location_tokens)) AND CASE WHEN n.category_text IS NULL THEN true WHEN n.raw_category=ANY(ARRAY['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care']::text[]) AND p.service_categories <@ ARRAY['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care']::text[] THEN n.raw_category=ANY(p.service_categories) ELSE p.service_category_search_text LIKE '%'||n.category_text||'%' OR public.search_text_has_all_tokens(p.service_category_search_text,n.category_tokens) OR extensions.word_similarity(n.category_text,p.service_category_search_text)>=0.82 END OFFSET 0
    ) p WHERE NOT coalesce(upper(n.raw_location)=ANY(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']),false)
  ),
  public_salons AS MATERIALIZED (
    SELECT p.*, (p.created_at >= now()-interval '30 days') AS is_new
    FROM eligible_documents p CROSS JOIN normalized n
  ),
  scored_base as materialized (
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
CREATE OR REPLACE FUNCTION public.search_public_explore_salons(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_page integer DEFAULT 1, p_page_size integer DEFAULT 12)
 RETURNS TABLE(salon_id uuid, salon_name text, phone text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, latitude double precision, longitude double precision, description text, active_service_count bigint, service_categories text[], service_names text[], cover_image_path text, latest_media_created_at timestamp with time zone, featured_service_category text, featured_service_name text, starting_price numeric, profile_completeness integer, has_public_profile boolean, is_new boolean, distance_miles double precision, match_type text, match_tier integer, relevance_score double precision, result_group text, total_count bigint, group_total_count bigint, best_match_count bigint, nearby_count bigint, recommended_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET jit TO 'off'
AS $function$
BEGIN
 IF nullif(btrim(p_query),'') IS NULL AND nullif(btrim(p_category),'') IS NULL AND nullif(btrim(p_location),'') IS NULL AND NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN
  RETURN QUERY
  WITH page AS (
   SELECT d.* FROM public.explore_salon_documents d
   ORDER BY d.profile_completeness DESC,d.updated_at DESC,d.salon_id
   LIMIT least(12,greatest(1,coalesce(p_page_size,12)))
   OFFSET (greatest(1,coalesce(p_page,1))::bigint-1)*least(12,greatest(1,coalesce(p_page_size,12)))
  ), totals AS (SELECT count(*) AS total FROM public.explore_salon_documents)
  SELECT p.salon_id,
p.salon_name,
p.phone,
p.address_line1,
p.address_line2,
p.city,
p.state,
p.postal_code,
p.country,
p.latitude,
p.longitude,
p.description,
p.active_service_count,
p.service_categories,
p.service_names,
p.cover_image_path,
p.latest_media_created_at,
p.featured_service_category,
p.featured_service_name,
p.starting_price,
p.profile_completeness,
p.has_public_profile,
(p.created_at >= now()-interval '30 days') AS is_new,
NULL::double precision AS distance_miles,
'recommended'::text AS match_type,
3 AS match_tier,
p.profile_completeness::double precision AS relevance_score,
'recommended'::text AS result_group,
c.total AS total_count,
c.total AS group_total_count,
0::bigint AS best_match_count,
0::bigint AS nearby_count,
c.total AS recommended_count FROM page p CROSS JOIN totals c
  ORDER BY p.profile_completeness DESC,p.updated_at DESC,p.salon_id;
 ELSIF nullif(btrim(p_query),'') IS NULL AND btrim(p_category)=ANY(ARRAY['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care']::text[]) AND upper(btrim(p_location))=ANY(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']) AND NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN
  RETURN QUERY
  WITH matching AS MATERIALIZED (
   SELECT d.salon_id,d.profile_completeness,d.created_at,d.updated_at,
    (d.profile_completeness+case when d.created_at >= now()-interval '30 days' then 8 else 0 end) AS sort_score
   FROM public.explore_salon_documents d
   WHERE d.state_code=upper(btrim(p_location)) AND CASE
    WHEN d.service_categories <@ ARRAY['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care']::text[] THEN btrim(p_category)=ANY(d.service_categories)
    ELSE d.service_category_search_text LIKE '%'||public.normalize_search_text(p_category)||'%' OR public.search_text_has_all_tokens(d.service_category_search_text,regexp_split_to_array(public.normalize_search_text(p_category),'\s+')) OR extensions.word_similarity(public.normalize_search_text(p_category),d.service_category_search_text)>=0.82 END
  ), page_ids AS (
   SELECT m.salon_id,m.sort_score,m.updated_at FROM matching m
   ORDER BY m.sort_score DESC,m.updated_at DESC,m.salon_id
   LIMIT least(12,greatest(1,coalesce(p_page_size,12)))
   OFFSET (greatest(1,coalesce(p_page,1))::bigint-1)*least(12,greatest(1,coalesce(p_page_size,12)))
  ), totals AS (SELECT count(*) AS total FROM matching)
  SELECT p.salon_id,
p.salon_name,
p.phone,
p.address_line1,
p.address_line2,
p.city,
p.state,
p.postal_code,
p.country,
p.latitude,
p.longitude,
p.description,
p.active_service_count,
p.service_categories,
p.service_names,
p.cover_image_path,
p.latest_media_created_at,
p.featured_service_category,
p.featured_service_name,
p.starting_price,
p.profile_completeness,
p.has_public_profile,
(p.created_at >= now()-interval '30 days') AS is_new,
NULL::double precision AS distance_miles,
'search'::text AS match_type,
1 AS match_tier,
(50+p.profile_completeness+case when p.created_at >= now()-interval '30 days' then 8 else 0 end)::double precision AS relevance_score,
'best_match'::text AS result_group,
c.total AS total_count,
c.total AS group_total_count,
c.total AS best_match_count,
0::bigint AS nearby_count,
0::bigint AS recommended_count FROM page_ids ids JOIN public.explore_salon_documents p ON p.salon_id=ids.salon_id CROSS JOIN totals c
  ORDER BY ids.sort_score DESC,ids.updated_at DESC,ids.salon_id;
 ELSE
  RETURN QUERY SELECT * FROM public.search_public_explore_salons_ranked(p_query,p_category,p_location,p_latitude,p_longitude,p_page,p_page_size);
 END IF;
END
$function$
;
COMMIT;
