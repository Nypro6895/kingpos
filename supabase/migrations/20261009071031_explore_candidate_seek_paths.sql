-- Bound filtered and geographic candidates before ranking; preserve KNN ties.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT extensions.word_similarity('a','a');
CREATE OR REPLACE FUNCTION public.explore_search_pull_batch(p_session_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off SET pg_trgm.word_similarity_threshold='0.65' AS $$
DECLARE s public.explore_search_sessions%ROWTYPE; region jsonb; predicate text; text_predicate text; raw_order text; raw_sort text;
 prior_bitmap_setting text; scoped_knn boolean:=false; probe_ids uuid[]; candidate_source text:='public.explore_salon_documents'; anchor_value double precision; anchor_id uuid; center text; distance_expression text:='NULL::float8'; batch jsonb; candidate jsonb; inserted integer:=0; affected integer; raw_last jsonb;
BEGIN
 SELECT * INTO STRICT s FROM public.explore_search_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.exhausted THEN RETURN 0; END IF;
 region:=s.region_plan->s.region_index;
 IF region IS NULL THEN UPDATE public.explore_search_sessions SET exhausted=true WHERE id=s.id; RETURN 0; END IF;
 predicate:=CASE WHEN region->>'kind'='exact' THEN public.explore_search_region_predicate(coalesce(region->'restrict_region','{}'::jsonb))||format(' AND d.salon_name_search=%L',s.query_text) ELSE public.explore_search_region_predicate(region) END;
 text_predicate:=public.explore_search_text_predicate(s.query_text,s.use_fuzzy);
 IF region->>'kind'='exact' THEN text_predicate:='true'; END IF;
 predicate:='('||predicate||') AND ('||text_predicate||')';
 IF s.query_text<>'' AND region->>'kind'<>'exact' THEN predicate:=predicate||format(' AND d.salon_name_search IS DISTINCT FROM %L',s.query_text); END IF;
 IF s.category_text<>'' THEN predicate:=predicate||format(' AND d.service_category_search_text LIKE %L','%'||s.category_text||'%'); END IF;
 IF region->>'latitude' IS NOT NULL AND region->>'longitude' IS NOT NULL THEN
  center:=format('extensions.ll_to_earth(%L::float8,%L::float8)',region->>'latitude',region->>'longitude');
  distance_expression:=format('CASE WHEN d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 THEN extensions.earth_distance(%s,extensions.ll_to_earth(d.latitude,d.longitude))/1609.344 ELSE NULL END',center);
 END IF;
 raw_order:='d.profile_completeness DESC,d.salon_id'; raw_sort:='-d.profile_completeness::float8';
 IF s.query_text<>'' OR s.category_text<>'' THEN
  -- Eligibility first; UUID seek avoids scanning a high-quality but unrelated
  -- category population before finding the bounded candidate pool.
  raw_order:='d.salon_id'; raw_sort:='0::float8';
 END IF;
 IF s.applied_sort='newest' THEN raw_order:='d.created_at DESC,d.salon_id'; raw_sort:='-extract(epoch FROM d.created_at)::float8';
 ELSIF center IS NOT NULL AND (s.applied_sort='closest' OR region->>'kind'='geo') THEN
  raw_sort:=format('CASE WHEN d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 THEN extensions.ll_to_earth(d.latitude,d.longitude) OPERATOR(extensions.<->) %s ELSE 1e12::float8 END',center);
  IF region->>'kind'='geo' THEN
   -- Select the nearest bounded pool for geographic requests, then apply
   -- the requested relevance/bookability ordering within that pool.
   -- The eligible geographic region already excludes invalid coordinates.
   raw_sort:=format('extensions.ll_to_earth(d.latitude,d.longitude) OPERATOR(extensions.<->) %s',center);
  END IF;
  raw_order:=raw_sort||',d.salon_id';
 END IF;
 IF region->>'kind'='exact' THEN raw_order:='d.salon_id'; raw_sort:='0::float8'; END IF;
 IF s.region_anchor IS NOT NULL THEN
  anchor_value:=(s.region_anchor->>'value')::float8; anchor_id:=(s.region_anchor->>'id')::uuid;
  IF raw_sort='0::float8' THEN
   -- A constant first column in ROW(0,id)>ROW(0,anchor) is only a Filter,
   -- not an index boundary. Express UUID-only continuation directly.
   predicate:=predicate||format(' AND d.salon_id>%L::uuid',anchor_id);
  ELSE
   predicate:=predicate||format(' AND ROW(%s,d.salon_id)>ROW(%L::float8,%L::uuid)',raw_sort,anchor_value,anchor_id);
  END IF;
 END IF;
 scoped_knn:=s.applied_sort<>'newest' AND region->>'kind'='geo';
 IF scoped_knn AND (s.query_text<>'' OR s.category_text<>'') THEN
  -- A sparse or empty indexed filter must not force KNN to walk every point
  -- in a dense radius. This capped hit probe is never an exact global COUNT.
  EXECUTE format($probe$
   SELECT coalesce(array_agg(x.salon_id),ARRAY[]::uuid[]) FROM (
    SELECT d.salon_id FROM public.explore_salon_documents d
    WHERE d.created_at<=$1 AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=$1) AND %s LIMIT 257
   ) x
  $probe$,predicate) INTO probe_ids USING s.created_at;
  IF cardinality(probe_ids)<=256 THEN
   candidate_source:='small_source'; scoped_knn:=false;
  END IF;
 END IF;
 IF scoped_knn THEN
  prior_bitmap_setting:=current_setting('enable_bitmapscan');
  PERFORM set_config('enable_bitmapscan','off',true);
 END IF;
 BEGIN
 EXECUTE format($query$
  WITH small_source AS MATERIALIZED (
   SELECT d.salon_id,d.salon_name_search,d.profile_completeness,d.created_at,d.public_discovery_published_at,
    d.service_categories,d.featured_service_name,d.active_service_count,d.latitude,d.longitude,
    d.search_document,d.service_category_search_text,d.state_code,d.city_search,d.postal_code
   FROM public.explore_salon_documents d WHERE d.salon_id=ANY($5)
  ), raw_pool AS MATERIALIZED (
   SELECT d.salon_id,d.salon_name_search,d.profile_completeness,d.created_at,d.service_categories,d.featured_service_name,d.active_service_count,%s AS raw_sort,%s AS distance_miles
   FROM %s d WHERE d.created_at<=$1 AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=$1) AND %s ORDER BY %s LIMIT 256
  ), ranked AS (
   SELECT r.*,coalesce(b.booking_enabled,false) AND coalesce(b.online_booking_visible,false) AND coalesce(b.guest_booking_enabled,true)
    AND r.featured_service_name IS NOT NULL AND r.active_service_count>0 AS is_bookable,
    (CASE WHEN $2<>'' AND r.salon_name_search=$2 THEN 1000 WHEN $2<>'' AND r.salon_name_search LIKE $2||'%%' THEN 800 WHEN $2<>'' THEN 600 ELSE 0 END
     +r.profile_completeness+CASE WHEN r.service_categories&&$3 THEN 20 ELSE 0 END)::float8 AS rank_score
   FROM raw_pool r LEFT JOIN public.booking_settings b ON b.salon_id=r.salon_id
  ) SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY
   CASE WHEN $4='bookable' THEN is_bookable END DESC NULLS LAST,
   CASE WHEN $4='newest' THEN created_at END DESC NULLS LAST,
   CASE WHEN $4='closest' THEN distance_miles END ASC NULLS LAST,
   rank_score DESC,distance_miles ASC NULLS LAST,salon_id),'[]'::jsonb) FROM ranked r
 $query$,raw_sort,distance_expression,candidate_source,predicate,raw_order) INTO batch USING s.created_at,s.query_text,s.preferred_categories,s.applied_sort,probe_ids;
 IF scoped_knn THEN PERFORM set_config('enable_bitmapscan',prior_bitmap_setting,true); END IF;
 EXCEPTION WHEN OTHERS THEN
  IF scoped_knn THEN PERFORM set_config('enable_bitmapscan',prior_bitmap_setting,true); END IF;
  RAISE;
 END;
 FOR candidate IN SELECT value FROM jsonb_array_elements(batch) LOOP
  INSERT INTO public.explore_search_session_candidates(session_id,ordinal,salon_id,search_scope,scope_label,eligibility_region,rank_score,distance_miles,match_type)
  VALUES(s.id,s.next_ordinal,(candidate->>'salon_id')::uuid,region->>'scope',region->>'label',CASE WHEN region->>'kind'='exact' THEN coalesce(region->'restrict_region','{}'::jsonb) ELSE region END,(candidate->>'rank_score')::float8,(candidate->>'distance_miles')::float8,
   CASE WHEN s.use_fuzzy THEN 'fuzzy' WHEN s.query_text<>'' THEN 'search' WHEN candidate->>'distance_miles' IS NOT NULL THEN 'distance' ELSE 'recommended' END)
  ON CONFLICT(session_id,salon_id) DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected>0 THEN s.next_ordinal:=s.next_ordinal+1; inserted:=inserted+1; END IF;
 END LOOP;
 SELECT value INTO raw_last FROM jsonb_array_elements(batch) ORDER BY (value->>'raw_sort')::float8 DESC,(value->>'salon_id')::uuid DESC LIMIT 1;
 IF jsonb_array_length(batch)<256 THEN
  s.region_index:=s.region_index+1; s.region_anchor:=NULL;
 ELSE s.region_anchor:=jsonb_build_object('value',(raw_last->>'raw_sort')::float8,'id',raw_last->>'salon_id'); END IF;
 UPDATE public.explore_search_sessions SET next_ordinal=s.next_ordinal,region_index=s.region_index,region_anchor=s.region_anchor,
 exhausted=s.region_index>=jsonb_array_length(s.region_plan) WHERE id=s.id;
 RETURN inserted;
END $$;

COMMIT;
