-- Keep cursor security/expiry/preferences and payload; materialize narrow identities for state/category browsing.
BEGIN;
CREATE OR REPLACE FUNCTION public.search_public_explore_cursor(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_page_size integer DEFAULT 12, p_cursor jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
 SET jit TO 'off'
AS $function$
DECLARE query_normalized text:=public.normalize_search_text(p_query); category_normalized text:=public.normalize_search_text(p_category); location_tokens text[]:=regexp_split_to_array(public.normalize_search_text(p_location),'\s+'); query_tokens text[]:=regexp_split_to_array(public.normalize_search_text(p_query),'\s+'); prefs text[]; stamp timestamptz; signature text; uid text:=coalesce(public.current_public_user_id()::text,'guest'); result jsonb;
BEGIN
 signature:=md5(jsonb_build_array(nullif(btrim(p_query),''),nullif(btrim(p_category),''),nullif(btrim(p_location),''),p_latitude,p_longitude)::text);
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR octet_length(p_cursor::text)>4096 OR p_cursor->>'signature' IS DISTINCT FROM signature OR p_cursor->>'viewer' IS DISTINCT FROM uid THEN RAISE EXCEPTION 'Search changed; restart pagination' USING ERRCODE='22023'; END IF;
  stamp:=(p_cursor->>'stamp')::timestamptz;
  IF stamp IS NULL OR stamp>now() OR stamp<now()-interval '30 minutes' THEN RAISE EXCEPTION 'Search expired; refresh results' USING ERRCODE='22023'; END IF;
  SELECT coalesce(array_agg(value),'{}') INTO prefs FROM jsonb_array_elements_text(p_cursor->'preferences');
 ELSE stamp:=now(); prefs:=public.explore_preferred_categories(); END IF;
 IF nullif(btrim(p_query),'') IS NULL AND nullif(btrim(p_category),'') IS NULL AND nullif(btrim(p_location),'') IS NULL AND cardinality(prefs)=0 AND NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN
 WITH page AS MATERIALIZED (
 SELECT d.* FROM public.explore_salon_documents d WHERE d.created_at<=stamp
 AND (p_cursor IS NULL OR d.profile_completeness< (p_cursor->>'rank')::double precision OR (d.profile_completeness=(p_cursor->>'rank')::double precision AND d.salon_id>(p_cursor->>'id')::uuid))
 ORDER BY d.profile_completeness DESC,d.salon_id LIMIT least(24,greatest(1,coalesce(p_page_size,12)))+1
 ), visible AS MATERIALIZED (SELECT * FROM page ORDER BY profile_completeness DESC,salon_id LIMIT least(24,greatest(1,coalesce(p_page_size,12)))),
 counts AS (SELECT coalesce((p_cursor->>'total')::bigint,(SELECT count(*) FROM public.explore_salon_documents WHERE created_at<=stamp)) AS total),
 last_row AS (SELECT * FROM visible ORDER BY profile_completeness,salon_id DESC LIMIT 1)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('pagination_cursor',jsonb_build_object('rank',profile_completeness,'distance',0,'id',salon_id,'stamp',stamp,'signature',signature,'viewer',uid,'preferences',prefs,'total',total),'is_new',created_at>=now()-interval '30 days','distance_miles',NULL,'match_type','recommended','match_tier',3,'result_group','recommended','relevance_score',profile_completeness,'total_count',total,'group_total_count',total,'best_match_count',0,'nearby_count',0,'recommended_count',total) ORDER BY profile_completeness DESC,salon_id) FROM visible v CROSS JOIN counts),'[]'::jsonb),
 'hasMore',(SELECT count(*) FROM page)>least(24,greatest(1,coalesce(p_page_size,12))),
 'cursor',(SELECT jsonb_build_object('rank',profile_completeness,'distance',0,'id',salon_id,'stamp',stamp,'signature',signature,'viewer',uid,'preferences',prefs,'total',total) FROM last_row CROSS JOIN counts)) INTO result;
 RETURN result;
 END IF;
 IF nullif(btrim(p_query),'') IS NULL AND nullif(btrim(p_category),'') IS NOT NULL AND lower(p_category)<>'all' AND btrim(p_location)~'^[A-Za-z]{2}$' AND NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN
 WITH matching AS MATERIALIZED (
  SELECT d.salon_id,d.profile_completeness::double precision AS rank_score,(d.latitude IS NOT NULL AND d.longitude IS NOT NULL) AS located
  FROM public.explore_salon_documents d
  WHERE d.created_at<=stamp AND d.state_code=upper(btrim(p_location)) AND d.service_category_search_text LIKE '%'||category_normalized||'%'
 ), page_ids AS MATERIALIZED (
  SELECT * FROM matching m WHERE p_cursor IS NULL OR ROW(-m.rank_score,0::double precision,m.salon_id)>ROW(-(p_cursor->>'rank')::double precision,(p_cursor->>'distance')::double precision,(p_cursor->>'id')::uuid)
  ORDER BY m.rank_score DESC,m.salon_id LIMIT least(24,greatest(1,coalesce(p_page_size,12)))+1
 ), page AS MATERIALIZED (
  SELECT d.*,ids.rank_score,NULL::double precision AS distance_value,0::double precision AS distance_order
  FROM page_ids ids JOIN public.explore_salon_documents d ON d.salon_id=ids.salon_id
 ), visible AS MATERIALIZED (
  SELECT * FROM page ORDER BY rank_score DESC,distance_order,salon_id LIMIT least(24,greatest(1,coalesce(p_page_size,12)))
 ), counts AS (
  SELECT coalesce((p_cursor->>'total')::bigint,(SELECT count(*) FROM matching)) AS total,coalesce((p_cursor->>'located')::bigint,(SELECT count(*) FROM matching WHERE located)) AS located
 ), last_row AS (SELECT * FROM visible ORDER BY rank_score,distance_order DESC,salon_id DESC LIMIT 1)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('pagination_cursor',jsonb_build_object('rank',rank_score,'distance',distance_order,'id',salon_id,'stamp',stamp,'signature',signature,'viewer',uid,'preferences',prefs,'total',c.total,'located',c.located),'is_new',v.created_at>=now()-interval '30 days','distance_miles',distance_value,'match_type',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 'search' WHEN distance_value IS NOT NULL THEN 'distance' ELSE 'recommended' END,'match_tier',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 1 WHEN distance_value IS NOT NULL OR nullif(btrim(p_location),'') IS NOT NULL THEN 2 ELSE 3 END,'result_group',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 'best_match' WHEN distance_value IS NOT NULL OR nullif(btrim(p_location),'') IS NOT NULL THEN 'nearby' ELSE 'recommended' END,'relevance_score',rank_score,'total_count',c.total,'group_total_count',c.total,'best_match_count',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN c.total ELSE 0 END,'nearby_count',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 0 WHEN nullif(btrim(p_location),'') IS NOT NULL THEN c.total WHEN p_latitude IS NOT NULL THEN c.located ELSE 0 END,'recommended_count',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL OR nullif(btrim(p_location),'') IS NOT NULL THEN 0 WHEN p_latitude IS NOT NULL THEN c.total-c.located ELSE c.total END) ORDER BY rank_score DESC,distance_order,salon_id) FROM visible v CROSS JOIN counts c),'[]'::jsonb),
 'hasMore',(SELECT count(*) FROM page)>least(24,greatest(1,coalesce(p_page_size,12))),
 'cursor',(SELECT jsonb_build_object('rank',rank_score,'distance',distance_order,'id',salon_id,'stamp',stamp,'signature',signature,'viewer',uid,'preferences',prefs,'total',(SELECT total FROM counts),'located',(SELECT located FROM counts)) FROM last_row)) INTO result;
 RETURN result;
 END IF;
 WITH eligible AS NOT MATERIALIZED (
  SELECT d.* FROM public.explore_salon_documents d
  WHERE d.created_at<=stamp
  AND (nullif(btrim(p_category),'') IS NULL OR lower(p_category)='all' OR d.service_category_search_text LIKE '%'||category_normalized||'%')
  AND (nullif(btrim(p_location),'') IS NULL OR CASE WHEN btrim(p_location)~'^[A-Za-z]{2}$' THEN d.state_code=upper(btrim(p_location)) ELSE public.search_text_has_all_tokens(d.location_search_text,location_tokens) END)
  AND (nullif(btrim(p_query),'') IS NULL OR d.search_document LIKE '%'||query_normalized||'%' OR public.search_text_has_all_tokens(d.search_document,query_tokens) OR extensions.word_similarity(query_normalized,d.salon_name_search)>=0.65)
 ), scored AS NOT MATERIALIZED (
  SELECT d.*,
  (CASE WHEN nullif(btrim(p_query),'') IS NULL AND p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180 THEN -d.profile_completeness WHEN nullif(btrim(p_query),'') IS NULL THEN 0 WHEN d.salon_name_search=query_normalized THEN 1000 WHEN d.salon_name_search LIKE query_normalized||'%' THEN 800 ELSE 600 END + CASE WHEN nullif(btrim(p_category),'') IS NULL AND d.service_categories&&prefs AND NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN 40 ELSE 0 END + d.profile_completeness)::double precision AS rank_score,
  CASE WHEN p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180 AND d.latitude IS NOT NULL AND d.longitude IS NOT NULL THEN 3958.8*acos(least(1,greatest(-1,sin(radians(p_latitude))*sin(radians(d.latitude))+cos(radians(p_latitude))*cos(radians(d.latitude))*cos(radians(d.longitude)-radians(p_longitude))))) ELSE NULL END AS distance_value
  FROM eligible d
 ), ordered AS NOT MATERIALIZED (
  SELECT s.*,CASE WHEN p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180 THEN coalesce(distance_value,1e12) ELSE 0 END AS distance_order FROM scored s
 ), page AS MATERIALIZED (
  SELECT * FROM ordered WHERE p_cursor IS NULL OR ROW(-rank_score,distance_order,salon_id)>ROW(-(p_cursor->>'rank')::double precision,(p_cursor->>'distance')::double precision,(p_cursor->>'id')::uuid)
  ORDER BY rank_score DESC,distance_order,salon_id LIMIT least(24,greatest(1,coalesce(p_page_size,12)))+1
 ), visible AS MATERIALIZED (
  SELECT * FROM page ORDER BY rank_score DESC,distance_order,salon_id LIMIT least(24,greatest(1,coalesce(p_page_size,12)))
 ), counts AS (SELECT coalesce((p_cursor->>'total')::bigint,(SELECT count(*) FROM eligible)) AS total,coalesce((p_cursor->>'located')::bigint,(SELECT count(*) FROM eligible WHERE latitude IS NOT NULL AND longitude IS NOT NULL)) AS located), last_row AS (SELECT * FROM visible ORDER BY rank_score,distance_order DESC,salon_id DESC LIMIT 1)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('pagination_cursor',jsonb_build_object('rank',rank_score,'distance',distance_order,'id',salon_id,'stamp',stamp,'signature',signature,'viewer',uid,'preferences',prefs,'total',c.total,'located',c.located),'is_new',v.created_at>=now()-interval '30 days','distance_miles',distance_value,'match_type',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 'search' WHEN distance_value IS NOT NULL THEN 'distance' ELSE 'recommended' END,'match_tier',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 1 WHEN distance_value IS NOT NULL OR nullif(btrim(p_location),'') IS NOT NULL THEN 2 ELSE 3 END,'result_group',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 'best_match' WHEN distance_value IS NOT NULL OR nullif(btrim(p_location),'') IS NOT NULL THEN 'nearby' ELSE 'recommended' END,'relevance_score',rank_score,'total_count',c.total,'group_total_count',c.total,'best_match_count',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN c.total ELSE 0 END,'nearby_count',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL THEN 0 WHEN nullif(btrim(p_location),'') IS NOT NULL THEN c.total WHEN p_latitude IS NOT NULL THEN c.located ELSE 0 END,'recommended_count',CASE WHEN nullif(btrim(p_query),'') IS NOT NULL OR nullif(btrim(p_location),'') IS NOT NULL THEN 0 WHEN p_latitude IS NOT NULL THEN c.total-c.located ELSE c.total END) ORDER BY rank_score DESC,distance_order,salon_id) FROM visible v CROSS JOIN counts c),'[]'::jsonb),
 'hasMore',(SELECT count(*) FROM page)>least(24,greatest(1,coalesce(p_page_size,12))),
 'cursor',(SELECT jsonb_build_object('rank',rank_score,'distance',distance_order,'id',salon_id,'stamp',stamp,'signature',signature,'viewer',uid,'preferences',prefs,'total',(SELECT total FROM counts),'located',(SELECT located FROM counts)) FROM last_row)) INTO result;
 RETURN result;
END $function$
;
COMMIT;
