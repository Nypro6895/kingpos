-- Keep legacy home callers, but rank only a bounded regional sample. Popular
-- category totals are computed on a schedule rather than on each page request.
BEGIN;
SET LOCAL search_path=public,extensions;

CREATE INDEX IF NOT EXISTS explore_document_global_new_seek_idx
 ON public.explore_salon_documents(created_at DESC,salon_id);

CREATE OR REPLACE FUNCTION public.get_public_explore_home_salons(p_recommended_limit integer DEFAULT 6,p_new_limit integer DEFAULT 6)
RETURNS TABLE(salon_id uuid,salon_name text,phone text,address_line1 text,address_line2 text,city text,state text,postal_code text,country text,latitude double precision,longitude double precision,description text,public_discovery_published_at timestamptz,profile_completeness integer,active_service_count bigint,service_categories text[],service_names text[],section text,home_rank bigint,is_new boolean,created_at timestamptz,updated_at timestamptz,cover_image_path text,latest_media_created_at timestamptz,featured_service_category text,featured_service_name text,has_public_profile boolean,starting_price numeric)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
#variable_conflict use_column
DECLARE saved_location text; saved_categories text[]; activity jsonb; region jsonb; predicate text;
 viewer uuid:=public.current_public_user_id(); pivot uuid; pool_ids uuid[]; first_size integer;
 recommended_size integer:=least(20,greatest(0,coalesce(p_recommended_limit,6)));
 new_size integer:=least(20,greatest(0,coalesce(p_new_limit,6)));
BEGIN
 SELECT coalesce((SELECT location_label FROM public.explore_user_preferences WHERE user_id=viewer),'') INTO saved_location;
 IF viewer IS NOT NULL THEN
  activity:=public.get_explore_activity_region();
  IF activity->>'source'='activity' AND coalesce((activity->>'confidence')::numeric,0)>=0.70
   AND coalesce((activity->>'evidenceDays')::integer,0)>=3 AND nullif(btrim(activity->>'label'),'') IS NOT NULL THEN
   saved_location:=btrim(activity->>'label');
  END IF;
 END IF;
 saved_categories:=coalesce(public.explore_preferred_categories(),'{}');
 region:=public.explore_search_region(saved_location,NULL,NULL);
 predicate:=public.explore_search_region_predicate(region);
 predicate:='('||predicate||') AND d.created_at<=now() AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now())';
 -- A guest refresh gets a new sample; signed-in samples are stable for a day.
 -- Both seek branches use existing regional UUID indexes, without sorting all
 -- matching documents by personal preferences or profile completeness.
 pivot:=CASE WHEN viewer IS NULL THEN gen_random_uuid() ELSE md5(viewer::text||(now() AT TIME ZONE 'UTC')::date::text)::uuid END;
 IF recommended_size>0 THEN
  EXECUTE 'SELECT coalesce(array_agg(salon_id),''{}''::uuid[]) FROM (SELECT d.salon_id FROM explore_salon_documents d WHERE '||predicate||' AND d.salon_id>=$1 ORDER BY d.salon_id LIMIT 256) x' INTO pool_ids USING pivot;
  first_size:=cardinality(pool_ids);
  IF first_size<256 THEN
   EXECUTE 'SELECT $3||coalesce(array_agg(salon_id),''{}''::uuid[]) FROM (SELECT d.salon_id FROM explore_salon_documents d WHERE '||predicate||' AND d.salon_id<$1 ORDER BY d.salon_id LIMIT $2) x' INTO pool_ids USING pivot,256-first_size,pool_ids;
  END IF;
 ELSE pool_ids:='{}'; END IF;
 RETURN QUERY EXECUTE format($query$
  WITH recommended_pool AS MATERIALIZED (
   SELECT d.salon_id,d.service_categories,d.public_discovery_published_at,d.profile_completeness,d.updated_at
   FROM unnest($1::uuid[]) candidate(salon_id) JOIN explore_salon_documents d USING(salon_id)
  ), recommended AS MATERIALIZED (
   SELECT salon_id,'recommended'::text AS section,
    row_number() OVER(ORDER BY (coalesce(service_categories,'{}')&&$2::text[]) DESC,public_discovery_published_at DESC NULLS LAST,profile_completeness DESC,updated_at DESC NULLS LAST,salon_id) AS home_rank
   FROM recommended_pool
   ORDER BY (coalesce(service_categories,'{}')&&$2::text[]) DESC,public_discovery_published_at DESC NULLS LAST,profile_completeness DESC,updated_at DESC NULLS LAST,salon_id LIMIT $3
  ), latest_pool AS MATERIALIZED (
   SELECT d.salon_id,d.created_at FROM explore_salon_documents d WHERE %s ORDER BY d.created_at DESC,d.salon_id LIMIT $4
  ), latest AS (
   SELECT salon_id,'new'::text AS section,row_number() OVER(ORDER BY created_at DESC,salon_id) AS home_rank FROM latest_pool
  ), selected AS(SELECT * FROM recommended UNION ALL SELECT * FROM latest)
  SELECT d.salon_id,d.salon_name,d.phone,d.address_line1,d.address_line2,d.city,d.state,d.postal_code,d.country,d.latitude,d.longitude,d.description,
   d.public_discovery_published_at,d.profile_completeness,d.active_service_count,d.service_categories,d.service_names,s.section,s.home_rank,d.created_at>=now()-interval '30 days',
   d.created_at,d.updated_at,d.cover_image_path,d.latest_media_created_at,d.featured_service_category,d.featured_service_name,d.has_public_profile,d.starting_price
  FROM selected s JOIN explore_salon_documents d USING(salon_id) WHERE %s ORDER BY s.section,s.home_rank
 $query$,predicate,predicate) USING pool_ids,saved_categories,recommended_size,new_size;
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_home_salons(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_home_salons(integer,integer) TO anon,authenticated,service_role;

CREATE TABLE public.explore_popular_service_cache (
 category text PRIMARY KEY,salon_count bigint NOT NULL CHECK(salon_count>0),active_service_count bigint NOT NULL CHECK(active_service_count>0),computed_at timestamptz NOT NULL
);
CREATE INDEX explore_popular_service_rank_idx ON public.explore_popular_service_cache(salon_count DESC,active_service_count DESC,category);
ALTER TABLE public.explore_popular_service_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_popular_service_cache FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.explore_popular_service_cache TO service_role;
CREATE FUNCTION public.refresh_explore_popular_service_cache() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET jit=off AS $$
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('explore-popular-service-refresh',0)) THEN RETURN; END IF;
 -- This aggregation is background work. The transaction swaps the cache
 -- atomically, so readers never see a half-refreshed category list.
 DELETE FROM explore_popular_service_cache;
 INSERT INTO explore_popular_service_cache(category,salon_count,active_service_count,computed_at)
 SELECT s.category,count(DISTINCT s.salon_id),count(*),now()
 FROM services s JOIN locations salons ON salons.id=s.salon_id JOIN salon_settings settings ON settings.salon_id=salons.id
 WHERE salons.status='active' AND settings.public_discovery_enabled AND s.is_active AND s.online_booking_enabled AND nullif(s.category,'') IS NOT NULL
 GROUP BY s.category;
END $$;
REVOKE ALL ON FUNCTION public.refresh_explore_popular_service_cache() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_explore_popular_service_cache() TO service_role;
CREATE OR REPLACE FUNCTION public.get_public_explore_popular_services(p_limit integer DEFAULT 8)
RETURNS TABLE(category text,salon_count bigint,active_service_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT category,salon_count,active_service_count FROM explore_popular_service_cache
 ORDER BY salon_count DESC,active_service_count DESC,category LIMIT least(32,greatest(0,coalesce(p_limit,8)))
$$;
REVOKE ALL ON FUNCTION public.get_public_explore_popular_services(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_popular_services(integer) TO anon,authenticated,service_role;
SELECT public.refresh_explore_popular_service_cache();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.schedule('kingpos-explore-popular-services','*/10 * * * *','SELECT public.refresh_explore_popular_service_cache()');
 END IF;
END $$;
COMMIT;
