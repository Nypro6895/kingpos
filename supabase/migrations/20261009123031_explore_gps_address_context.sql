-- Use verified city/state addresses for eligibility and actual consented GPS for distance.
-- Preserve function identities, ACLs, existing null-GPS cursors and publication cutoff.
BEGIN;
SET LOCAL search_path=public,extensions;
-- Load pg_trgm so its user-settable custom GUC is registered in this SQL connection.
SELECT extensions.word_similarity('a','a');
CREATE OR REPLACE FUNCTION public.explore_search_region(p_location text,p_latitude double precision,p_longitude double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE label text:=btrim(coalesce(p_location,'')); normalized text:=coalesce(public.normalize_search_text(label),'');
  state_value text; city_value text; postal_value text; center_lat double precision; center_lon double precision;
  state_names constant jsonb:='{"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY"}'::jsonb;
  state_name text;
BEGIN
 IF label='' THEN
  IF p_latitude BETWEEN -90 AND 90 AND p_longitude BETWEEN -180 AND 180 THEN
   RETURN jsonb_build_object('kind','geo','latitude',p_latitude,'longitude',p_longitude,'radius',16093.44,'scope','A','label','Within 10 miles');
  END IF;
  RETURN jsonb_build_object('kind','global','scope','C','label','Matching salons across regions');
 END IF;
 state_value:=CASE WHEN upper(label)=ANY(public.explore_search_state_codes()) THEN upper(label) ELSE state_names->>normalized END;
 IF state_value IS NOT NULL THEN RETURN jsonb_build_object('kind','state','state',state_value,'latitude',CASE WHEN coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false) THEN p_latitude ELSE NULL END,'longitude',CASE WHEN coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false) THEN p_longitude ELSE NULL END,'scope','A','label',state_value); END IF;
 IF label~'^\d{5}(-\d{4})?$' THEN
  postal_value:=left(label,5);
  SELECT d.state_code INTO state_value FROM public.explore_salon_documents d WHERE left(coalesce(d.postal_code,''),5)=postal_value ORDER BY d.salon_id LIMIT 1;
  SELECT avg(x.latitude),avg(x.longitude) INTO center_lat,center_lon FROM (
   SELECT latitude,longitude FROM public.explore_salon_documents WHERE left(coalesce(postal_code,''),5)=postal_value AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 ORDER BY salon_id LIMIT 32
  ) x;
  RETURN jsonb_build_object('kind','postal','postal',postal_value,'state',state_value,'latitude',CASE WHEN coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false) THEN p_latitude ELSE center_lat END,'longitude',CASE WHEN coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false) THEN p_longitude ELSE center_lon END,'scope','A','label',postal_value);
 END IF;
 IF label~',\s*[A-Za-z]{2}$' OR label~'\s+[A-Za-z]{2}$' THEN
  state_value:=upper(substring(label FROM '([A-Za-z]{2})$'));
  IF NOT(state_value=ANY(public.explore_search_state_codes())) THEN state_value:=NULL; END IF;
  IF state_value IS NOT NULL THEN city_value:=public.normalize_search_text(regexp_replace(label,'[,\s]+[A-Za-z]{2}$','')); END IF;
 END IF;
 IF city_value IS NULL THEN
  SELECT key,value INTO state_name,state_value FROM jsonb_each_text(state_names)
  WHERE normalized LIKE '% '||key ORDER BY length(key) DESC LIMIT 1;
  IF state_name IS NOT NULL THEN city_value:=btrim(left(normalized,length(normalized)-length(state_name))); END IF;
 END IF;
 city_value:=coalesce(city_value,normalized);
 -- An ambiguous city without a state is kept as an exact city filter. Its
 -- first matching salon is never silently treated as the user's home region.
 IF state_value IS NOT NULL THEN
  SELECT avg(x.latitude),avg(x.longitude) INTO center_lat,center_lon FROM (
   SELECT latitude,longitude FROM public.explore_salon_documents WHERE city_search=city_value AND state_code=state_value AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 ORDER BY salon_id LIMIT 32
  ) x;
 END IF;
 RETURN jsonb_build_object('kind','city','city',city_value,'state',state_value,'latitude',CASE WHEN coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false) THEN p_latitude ELSE center_lat END,'longitude',CASE WHEN coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false) THEN p_longitude ELSE center_lon END,'scope','A','label',label);
END $$;
CREATE OR REPLACE FUNCTION public.search_public_explore_session(
 p_query text DEFAULT NULL,p_category text DEFAULT NULL,p_location text DEFAULT NULL,
 p_latitude double precision DEFAULT NULL,p_longitude double precision DEFAULT NULL,
 p_sort text DEFAULT 'relevance',p_limit integer DEFAULT 12,p_cursor jsonb DEFAULT NULL,
 p_scope_policy text DEFAULT 'fixed',p_intent text DEFAULT 'search'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off SET pg_trgm.word_similarity_threshold='0.65' AS $$
DECLARE q text:=coalesce(public.normalize_search_text(p_query),''); cat text:=coalesce(public.normalize_search_text(p_category),'');
 location_value text:=coalesce(public.normalize_search_text(p_location),''); requested_sort text:=lower(coalesce(nullif(p_sort,''),'relevance')); applied_sort text;
 policy text:=coalesce(p_scope_policy,'fixed'); intent_value text:=coalesce(p_intent,'search'); page_limit integer:=least(20,greatest(1,coalesce(p_limit,12)));
 viewer text:=coalesce(public.current_public_user_id()::text,'guest'); signature_value text; s public.explore_search_sessions%ROWTYPE; search_session_id uuid;
 after_ordinal bigint:=0; region jsonb; plan jsonb:='[]'::jsonb; wider_region jsonb; excluded jsonb; state_value text; states text[];
 exact_exists boolean; text_predicate text; predicate text; batch jsonb; page_rows jsonb; next_token jsonb; last_ordinal bigint; more boolean; attempts integer:=0; last_scope jsonb; initial_region jsonb;
BEGIN
 IF length(coalesce(p_query,''))>160 OR length(coalesce(p_category,''))>80 OR length(coalesce(p_location,''))>160 OR cardinality(regexp_split_to_array(q,'\s+'))>16 OR length(intent_value)>40 THEN RAISE EXCEPTION 'Search input exceeds limits' USING ERRCODE='22023'; END IF;
 IF cat='all' THEN cat:=''; END IF;
 IF requested_sort='distance' THEN requested_sort:='closest'; ELSIF requested_sort='new' THEN requested_sort:='newest'; END IF;
 IF requested_sort NOT IN ('relevance','trusted','bookable','closest','newest') OR policy NOT IN ('fixed','expandable') THEN RAISE EXCEPTION 'Invalid search option' USING ERRCODE='22023'; END IF;
 applied_sort:=CASE WHEN requested_sort='trusted' THEN 'relevance' ELSE requested_sort END;
 -- Verified address region and actual GPS can coexist. The application clears GPS when an explicit manual/query area wins.
 IF NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN p_latitude:=NULL;p_longitude:=NULL; END IF;
 signature_value:=md5(jsonb_build_array(q,cat,location_value,p_latitude,p_longitude,requested_sort,policy,intent_value)::text);
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR octet_length(p_cursor::text)>512 OR p_cursor->>'version'<>'2' THEN RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023'; END IF;
  BEGIN search_session_id:=(p_cursor->>'session')::uuid; after_ordinal:=(p_cursor->>'after')::bigint;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023'; END;
  SELECT * INTO s FROM public.explore_search_sessions WHERE id=search_session_id FOR UPDATE;
  IF NOT FOUND OR s.expires_at<=now() OR s.viewer_key<>viewer OR s.signature<>signature_value OR after_ordinal IS NULL OR after_ordinal<s.replay_floor OR after_ordinal>=s.next_ordinal THEN RAISE EXCEPTION 'Search changed or expired; refresh results' USING ERRCODE='22023'; END IF;
  -- Retain a bounded replay window for retries and partially consumed batches.
  -- Forward scrolling remains reachable through each region's seek anchor.
  DELETE FROM public.explore_search_session_candidates WHERE session_id=search_session_id AND ordinal<=greatest(0,after_ordinal-256);
  UPDATE public.explore_search_sessions SET replay_floor=greatest(replay_floor,after_ordinal-256) WHERE id=search_session_id;
 ELSE
  search_session_id:=gen_random_uuid(); region:=public.explore_search_region(p_location,p_latitude,p_longitude);
  IF q<>'' THEN
   plan:=plan||jsonb_build_array(jsonb_build_object('kind','exact','scope','exact','label','Exact name match','latitude',region->'latitude','longitude',region->'longitude','restrict_region',CASE WHEN policy='fixed' THEN region ELSE '{}'::jsonb END));
  END IF;
  IF region->>'kind'<>'global' THEN plan:=plan||jsonb_build_array(region); END IF;
  IF policy='expandable' AND region->>'kind'<>'global' THEN
   excluded:=region;
   IF region->>'latitude' IS NOT NULL AND region->>'longitude' IS NOT NULL THEN
    wider_region:=jsonb_build_object('kind','geo','latitude',region->'latitude','longitude',region->'longitude','radius',80467.2,'scope','B','label','More matching salons within 50 miles','exclude_region',region);
    plan:=plan||jsonb_build_array(wider_region);
    -- City/ZIP boundaries can include unmapped salons or mapped outliers.
    -- Exclude both A and the full wider circle from subsequent groups.
    excluded:=jsonb_build_object('kind','union','left',region,'right',jsonb_build_object('kind','geo','latitude',region->'latitude','longitude',region->'longitude','radius',80467.2));
   END IF;
  END IF;
  IF region->>'kind'='global' OR policy='expandable' THEN
   SELECT array_agg(x ORDER BY CASE WHEN x=region->>'state' THEN 0 ELSE 1 END,md5(search_session_id::text||x)) INTO states FROM unnest(public.explore_search_state_codes()) x;
   FOREACH state_value IN ARRAY states LOOP
    wider_region:=jsonb_build_object('kind','state','state',state_value,'scope','C','label','Matching salons in '||state_value);
    IF excluded IS NOT NULL THEN wider_region:=wider_region||jsonb_build_object('exclude_region',excluded); END IF;
    plan:=plan||jsonb_build_array(wider_region);
   END LOOP;
   wider_region:=jsonb_build_object('kind','other','scope','C','label','Matching salons in other areas');
   IF excluded IS NOT NULL THEN wider_region:=wider_region||jsonb_build_object('exclude_region',excluded); END IF;
   plan:=plan||jsonb_build_array(wider_region);
  END IF;
  -- Fuzzy names are a fallback only when the full eligible indexed scope has
  -- no all-token matches. No unrelated recommendations pad a keyword search.
  text_predicate:=public.explore_search_text_predicate(q,false);
  predicate:=CASE WHEN policy='fixed' THEN public.explore_search_region_predicate(region) ELSE 'true' END;
  IF cat<>'' THEN predicate:=predicate||format(' AND d.service_category_search_text LIKE %L','%'||cat||'%'); END IF;
  IF q<>'' THEN EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.explore_salon_documents d WHERE %s AND %s LIMIT 1)',predicate,text_predicate) INTO exact_exists; ELSE exact_exists:=true; END IF;
  INSERT INTO public.explore_search_sessions(id,user_id,viewer_key,signature,query_text,category_text,requested_sort,applied_sort,scope_policy,intent,preferred_categories,use_fuzzy,region_plan)
  VALUES(search_session_id,public.current_public_user_id(),viewer,signature_value,q,cat,requested_sort,applied_sort,policy,intent_value,public.explore_preferred_categories(),q<>'' AND length(q)>=3 AND NOT exact_exists,plan);
  SELECT * INTO s FROM public.explore_search_sessions WHERE id=search_session_id FOR UPDATE;
 END IF;
 LOOP
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY ordinal),'[]'::jsonb) INTO batch FROM (
   SELECT c.* FROM public.explore_search_session_candidates c JOIN public.explore_salon_documents d ON d.salon_id=c.salon_id
   WHERE c.session_id=search_session_id AND c.ordinal>after_ordinal
    AND d.created_at<=s.created_at AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=s.created_at)
    AND public.explore_search_live_match(d,c.eligibility_region,s.query_text,s.use_fuzzy,s.category_text,c.search_scope='exact')
   ORDER BY c.ordinal LIMIT page_limit+1
  ) x;
  EXIT WHEN jsonb_array_length(batch)>page_limit OR s.exhausted;
  PERFORM public.explore_search_pull_batch(search_session_id);
  DELETE FROM public.explore_search_session_candidates c WHERE c.session_id=search_session_id
   AND NOT EXISTS(SELECT 1 FROM public.explore_salon_documents d WHERE d.salon_id=c.salon_id
    AND d.created_at<=s.created_at AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=s.created_at)
    AND public.explore_search_live_match(d,c.eligibility_region,s.query_text,s.use_fuzzy,s.category_text,c.search_scope='exact'));
  SELECT * INTO s FROM public.explore_search_sessions WHERE id=search_session_id;
  attempts:=attempts+1;
  -- There are at most 55 initial groups. Normally one bounded pool suffices.
  -- Sparse empty groups are cheap indexed probes and cannot loop forever.
  IF attempts>64 THEN RAISE EXCEPTION 'Search region progress exceeded limit' USING ERRCODE='54000'; END IF;
 END LOOP;
 SELECT value INTO initial_region FROM jsonb_array_elements(s.region_plan) WHERE value->>'scope'='A' LIMIT 1;
 SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object(
  'pagination_cursor',jsonb_build_object('version',2,'session',search_session_id,'after',c.ordinal),
  'search_scope',c.search_scope,'scope_label',CASE WHEN c.search_scope='exact' AND initial_region IS NOT NULL AND NOT public.explore_search_region_contains(initial_region,d) THEN 'Exact name match outside your area' ELSE c.scope_label END,
  'outside_area',c.search_scope='exact' AND initial_region IS NOT NULL AND NOT public.explore_search_region_contains(initial_region,d),'distance_miles',c.distance_miles,
  'relevance_score',c.rank_score,'match_type',c.match_type,'match_tier',CASE WHEN c.search_scope='exact' THEN 0 WHEN q<>'' THEN 1 WHEN c.search_scope IN ('A','B') THEN 2 ELSE 3 END,
  'result_group',CASE WHEN q<>'' OR cat<>'' THEN 'best_match' WHEN c.search_scope IN ('A','B') THEN 'nearby' ELSE 'recommended' END,
  'is_new',d.created_at>=now()-interval '30 days',
  'total_count',s.next_ordinal-1,'group_total_count',0,'best_match_count',CASE WHEN q<>'' OR cat<>'' THEN s.next_ordinal-1 ELSE 0 END,
  'nearby_count',CASE WHEN q='' AND cat='' AND c.search_scope IN ('A','B') THEN s.next_ordinal-1 ELSE 0 END,
  'recommended_count',CASE WHEN q='' AND cat='' AND c.search_scope NOT IN ('A','B') THEN s.next_ordinal-1 ELSE 0 END
 ) ORDER BY c.ordinal),'[]'::jsonb) INTO page_rows
 FROM (SELECT value FROM jsonb_array_elements(batch) WITH ORDINALITY AS e(value,n) WHERE n<=page_limit) b
 JOIN public.explore_search_session_candidates c ON c.session_id=search_session_id AND c.ordinal=(b.value->>'ordinal')::bigint
 JOIN public.explore_salon_documents d ON d.salon_id=c.salon_id
  AND d.created_at<=s.created_at AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=s.created_at)
  AND public.explore_search_live_match(d,c.eligibility_region,s.query_text,s.use_fuzzy,s.category_text,c.search_scope='exact');
 more:=jsonb_array_length(batch)>page_limit;
 last_ordinal:=coalesce((page_rows->-1->'pagination_cursor'->>'after')::bigint,after_ordinal);
 next_token:=CASE WHEN more THEN jsonb_build_object('version',2,'session',search_session_id,'after',last_ordinal) ELSE NULL END;
 last_scope:=jsonb_build_object('policy',s.scope_policy,'stage',coalesce(page_rows->-1->>'search_scope','A'),'label',coalesce(page_rows->-1->>'scope_label',''),'expanded',initial_region IS NOT NULL AND coalesce(page_rows->-1->>'search_scope','A') IN ('B','C'));
 RETURN jsonb_build_object('rows',page_rows,'hasMore',more,'nextCursor',next_token,'cursor',next_token,'scope',last_scope,'countKind','loaded','totalCount',s.next_ordinal-1,'requestedSort',s.requested_sort,'appliedSort',s.applied_sort,'fuzzy',s.use_fuzzy);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
