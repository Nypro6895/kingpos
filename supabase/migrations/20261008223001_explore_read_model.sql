-- Explore read model v1: atomic source synchronization, public-only projection.
BEGIN;
SET LOCAL statement_timeout = '90s';
LOCK TABLE public.locations, public.salon_settings, public.services, public.booking_settings, public.salon_profile_media_assets, public.salon_directory_listings IN SHARE ROW EXCLUSIVE MODE;
CREATE INDEX IF NOT EXISTS explore_active_services_idx ON public.services(salon_id, name) WHERE is_active;
CREATE INDEX IF NOT EXISTS explore_media_object_idx ON public.salon_profile_media_assets(salon_id, object_path) WHERE status='active' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS explore_updates_published_idx ON public.salon_profile_updates(published_at DESC, id DESC) WHERE status='published' AND media_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS explore_looks_published_idx ON public.salon_profile_looks(published_at DESC, id DESC) WHERE status='published' AND media_path IS NOT NULL;
CREATE VIEW public.explore_document_source WITH (security_invoker=true) AS
WITH base AS (
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
      settings.public_discovery_published_at,
      (
        case when settings.public_discovery_enabled then 20 else 0 end
        + case when nullif(settings.business_description, '') is not null then 20 else 0 end
        + case when nullif(settings.public_profile_cover_path, '') is not null then 20 else 0 end
        + case when exists (select 1 from public.services where services.salon_id = salons.id and services.is_active = true) then 20 else 0 end
        + case when coalesce(booking_settings.booking_enabled, false) then 20 else 0 end
      )::integer as profile_completeness,
      (select count(*) from public.services where services.salon_id = salons.id and services.is_active = true) as active_service_count,
      coalesce(nullif(array(
        select distinct services.category
        from public.services
        where services.salon_id = salons.id
          and services.is_active = true
          and nullif(services.category, '') is not null
        order by services.category
      ), '{}'::text[]), directory.source_categories, '{}'::text[]) as service_categories,
      coalesce(array(
        select services.name
        from public.services
        where services.salon_id = salons.id
          and services.is_active = true
        order by services.name
        limit 8
      ), '{}'::text[]) as service_names,
      salons.created_at,
      salons.updated_at,
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
      featured_service.category as featured_service_category,
      featured_service.name as featured_service_name,
      true as has_public_profile,
      (select min(services.base_price) from public.services where services.salon_id = salons.id and services.is_active = true) as starting_price
    from public.locations salons
    join public.salon_settings settings on settings.salon_id = salons.id
    left join public.salon_directory_listings directory on directory.salon_id = salons.id
    left join public.booking_settings on booking_settings.salon_id = salons.id
    left join lateral (
      select services.category, services.name
      from public.services
      where services.salon_id = salons.id
        and services.is_active = true
        and services.online_booking_enabled = true
      order by services.name
      limit 1
    ) featured_service on true
    where salons.status = 'active'
      and settings.public_discovery_enabled = true

)
SELECT b.*,
 public.normalize_search_text(b.salon_name) AS salon_name_search,
 public.normalize_search_text(b.description) AS description_search,
 public.normalize_search_text(concat_ws(' ',b.salon_name,b.description,s.service_search_text,array_to_string(b.service_categories,' '),b.phone,b.address_line1,b.city)) AS search_document,
 public.normalize_search_text(concat_ws(' ',b.city,b.state,b.postal_code,b.address_line1)) AS location_search_text,
 s.service_search_text,
 public.normalize_search_text(array_to_string(b.service_categories,' ')) AS service_category_search_text,
 upper(btrim(b.state)) AS state_code,
 public.normalize_search_text(b.city) AS city_search
FROM base b
LEFT JOIN LATERAL (SELECT public.normalize_search_text(string_agg(concat_ws(' ',name,category,description),' ')) AS service_search_text FROM public.services WHERE salon_id=b.salon_id AND is_active) s ON true;
REVOKE ALL ON public.explore_document_source FROM PUBLIC, anon, authenticated;
CREATE TABLE public.explore_salon_documents AS SELECT * FROM public.explore_document_source WITH NO DATA;
ALTER TABLE public.explore_salon_documents ADD PRIMARY KEY(salon_id);
ALTER TABLE public.explore_salon_documents ADD CONSTRAINT explore_document_location_fk FOREIGN KEY(salon_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE public.explore_salon_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_salon_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.explore_salon_documents, public.explore_document_source TO service_role;
INSERT INTO public.explore_salon_documents SELECT * FROM public.explore_document_source;
CREATE INDEX explore_document_state_idx ON public.explore_salon_documents(state_code,profile_completeness DESC,salon_id);
CREATE INDEX explore_document_city_idx ON public.explore_salon_documents(city_search,state_code,salon_id);
CREATE INDEX explore_document_category_idx ON public.explore_salon_documents USING gin(service_categories);
CREATE INDEX explore_document_name_idx ON public.explore_salon_documents USING gin(salon_name_search extensions.gin_trgm_ops);
CREATE INDEX explore_document_search_idx ON public.explore_salon_documents USING gin(search_document extensions.gin_trgm_ops);
CREATE INDEX explore_document_location_idx ON public.explore_salon_documents USING gin(location_search_text extensions.gin_trgm_ops);
CREATE INDEX explore_document_home_idx ON public.explore_salon_documents(public_discovery_published_at DESC NULLS LAST,profile_completeness DESC,updated_at DESC,salon_id);
CREATE INDEX explore_document_new_idx ON public.explore_salon_documents(created_at DESC,updated_at DESC,salon_id);
CREATE INDEX explore_document_coordinates_idx ON public.explore_salon_documents(latitude,longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE FUNCTION public.refresh_explore_salon_documents(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN; END IF;
 -- Serialize writes for each location before rebuilding; consistent order avoids deadlocks.
 PERFORM id FROM public.locations WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 DELETE FROM public.explore_salon_documents WHERE salon_id=ANY(p_ids);
 INSERT INTO public.explore_salon_documents SELECT * FROM public.explore_document_source WHERE salon_id=ANY(p_ids);
END $$;
REVOKE ALL ON FUNCTION public.refresh_explore_salon_documents(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_explore_salon_documents(uuid[]) TO service_role;
CREATE FUNCTION public.sync_explore_salon_documents() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE ids uuid[];
BEGIN
 IF TG_TABLE_NAME='locations' THEN
  IF TG_OP='INSERT' THEN SELECT array_agg(id ORDER BY id) INTO ids FROM explore_new;
  ELSIF TG_OP='DELETE' THEN SELECT array_agg(id ORDER BY id) INTO ids FROM explore_old;
  ELSE SELECT array_agg(id ORDER BY id) INTO ids FROM (SELECT id FROM explore_new UNION SELECT id FROM explore_old) x; END IF;
 ELSE
  IF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT salon_id ORDER BY salon_id) INTO ids FROM explore_new;
  ELSIF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT salon_id ORDER BY salon_id) INTO ids FROM explore_old;
  ELSE SELECT array_agg(salon_id ORDER BY salon_id) INTO ids FROM (SELECT salon_id FROM explore_new UNION SELECT salon_id FROM explore_old) x; END IF;
 END IF;
 PERFORM public.refresh_explore_salon_documents(ids);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sync_explore_salon_documents() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER explore_document_insert AFTER INSERT ON public.locations REFERENCING NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_update AFTER UPDATE ON public.locations REFERENCING OLD TABLE AS explore_old NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_delete AFTER DELETE ON public.locations REFERENCING OLD TABLE AS explore_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_insert AFTER INSERT ON public.salon_settings REFERENCING NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_update AFTER UPDATE ON public.salon_settings REFERENCING OLD TABLE AS explore_old NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_delete AFTER DELETE ON public.salon_settings REFERENCING OLD TABLE AS explore_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_insert AFTER INSERT ON public.services REFERENCING NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_update AFTER UPDATE ON public.services REFERENCING OLD TABLE AS explore_old NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_delete AFTER DELETE ON public.services REFERENCING OLD TABLE AS explore_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_insert AFTER INSERT ON public.booking_settings REFERENCING NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_update AFTER UPDATE ON public.booking_settings REFERENCING OLD TABLE AS explore_old NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_delete AFTER DELETE ON public.booking_settings REFERENCING OLD TABLE AS explore_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_insert AFTER INSERT ON public.salon_profile_media_assets REFERENCING NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_update AFTER UPDATE ON public.salon_profile_media_assets REFERENCING OLD TABLE AS explore_old NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_delete AFTER DELETE ON public.salon_profile_media_assets REFERENCING OLD TABLE AS explore_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_insert AFTER INSERT ON public.salon_directory_listings REFERENCING NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_update AFTER UPDATE ON public.salon_directory_listings REFERENCING OLD TABLE AS explore_old NEW TABLE AS explore_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE TRIGGER explore_document_delete AFTER DELETE ON public.salon_directory_listings REFERENCING OLD TABLE AS explore_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_salon_documents();
CREATE OR REPLACE FUNCTION public.get_public_explore_home_salons(p_recommended_limit integer DEFAULT 6, p_new_limit integer DEFAULT 6)
 RETURNS TABLE(salon_id uuid, salon_name text, phone text, address_line1 text, address_line2 text, city text, state text, postal_code text, country text, latitude double precision, longitude double precision, description text, public_discovery_published_at timestamp with time zone, profile_completeness integer, active_service_count bigint, service_categories text[], service_names text[], section text, home_rank bigint, is_new boolean, created_at timestamp with time zone, updated_at timestamp with time zone, cover_image_path text, latest_media_created_at timestamp with time zone, featured_service_category text, featured_service_name text, has_public_profile boolean, starting_price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  with public_salons as NOT MATERIALIZED (SELECT p.*, (p.created_at >= now()-interval '30 days') AS is_new FROM public.explore_salon_documents p
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
$function$
;
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
  public_salons AS MATERIALIZED (
 SELECT p.*, (p.created_at >= now()-interval '30 days') AS is_new
 FROM public.explore_salon_documents p CROSS JOIN normalized n
 WHERE (n.category_text IS NULL OR p.service_category_search_text LIKE '%'||n.category_text||'%' OR public.search_text_has_all_tokens(p.service_category_search_text,n.category_tokens) OR extensions.word_similarity(n.category_text,p.service_category_search_text)>=0.82)
 AND CASE WHEN upper(n.raw_location)=ANY(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']) THEN p.state_code=upper(n.raw_location)
 ELSE (n.location_text IS NULL OR p.city_search=n.location_text OR public.normalize_search_text(p.postal_code)=n.location_text OR p.location_search_text LIKE '%'||n.location_text||'%' OR public.search_text_has_all_tokens(p.location_search_text,n.location_tokens)) END
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
ANALYZE public.explore_salon_documents;
COMMENT ON TABLE public.explore_salon_documents IS 'Rebuildable public Explore projection v1. Sources remain authoritative. Statement triggers synchronize all writes atomically; no owner permissions are granted.';
COMMIT;
