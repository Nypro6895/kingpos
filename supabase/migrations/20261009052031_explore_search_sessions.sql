-- Bounded regional retrieval and a private, expiring search queue.
-- Source tables and existing search RPCs are deliberately retained.
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE EXTENSION IF NOT EXISTS cube WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS earthdistance WITH SCHEMA extensions;
-- Load pg_trgm before applying its reserved per-function configuration.
SELECT extensions.word_similarity('a','a');

CREATE INDEX IF NOT EXISTS explore_document_exact_name_seek_idx
  ON public.explore_salon_documents(salon_name_search,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_name_prefix_seek_idx
  ON public.explore_salon_documents(salon_name_search text_pattern_ops,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_state_id_seek_idx
  ON public.explore_salon_documents(state_code,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_city_id_seek_idx
  ON public.explore_salon_documents(city_search,state_code,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_city_quality_seek_idx
  ON public.explore_salon_documents(city_search,state_code,profile_completeness DESC,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_postal_id_seek_idx
  ON public.explore_salon_documents((left(coalesce(postal_code,''),5)),salon_id);
CREATE INDEX IF NOT EXISTS explore_document_postal_quality_seek_idx
  ON public.explore_salon_documents((left(coalesce(postal_code,''),5)),profile_completeness DESC,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_state_new_seek_idx
  ON public.explore_salon_documents(state_code,created_at DESC,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_city_new_seek_idx
  ON public.explore_salon_documents(city_search,state_code,created_at DESC,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_postal_new_seek_idx
  ON public.explore_salon_documents((left(coalesce(postal_code,''),5)),created_at DESC,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_state_category_new_seek_idx
  ON public.explore_salon_documents(state_code,service_category_search_text,created_at DESC,salon_id);
CREATE INDEX IF NOT EXISTS explore_document_category_text_idx
  ON public.explore_salon_documents USING gin(service_category_search_text extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS explore_document_earth_idx
  ON public.explore_salon_documents USING gist(extensions.ll_to_earth(latitude,longitude))
  WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;

CREATE TABLE public.explore_search_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  viewer_key text NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
  query_text text NOT NULL,
  category_text text NOT NULL,
  requested_sort text NOT NULL,
  applied_sort text NOT NULL,
  scope_policy text NOT NULL CHECK(scope_policy IN ('fixed','expandable')),
  intent text NOT NULL,
  preferred_categories text[] NOT NULL DEFAULT '{}',
  use_fuzzy boolean NOT NULL DEFAULT false,
  region_plan jsonb NOT NULL,
  region_index integer NOT NULL DEFAULT 0,
  region_anchor jsonb,
  next_ordinal bigint NOT NULL DEFAULT 1,
  replay_floor bigint NOT NULL DEFAULT 0,
  exhausted boolean NOT NULL DEFAULT false
);
CREATE INDEX explore_search_session_expiry_idx ON public.explore_search_sessions(expires_at,id);
CREATE TABLE public.explore_search_session_candidates (
  session_id uuid NOT NULL REFERENCES public.explore_search_sessions(id) ON DELETE CASCADE,
  ordinal bigint NOT NULL,
  salon_id uuid NOT NULL,
  search_scope text NOT NULL,
  scope_label text NOT NULL,
  eligibility_region jsonb NOT NULL,
  rank_score double precision NOT NULL,
  distance_miles double precision,
  match_type text NOT NULL,
  PRIMARY KEY(session_id,ordinal),
  UNIQUE(session_id,salon_id)
);
ALTER TABLE public.explore_search_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explore_search_session_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_search_sessions,public.explore_search_session_candidates FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.explore_search_sessions,public.explore_search_session_candidates TO service_role;

CREATE FUNCTION public.explore_search_state_codes() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']::text[]
$$;

CREATE FUNCTION public.explore_search_region(p_location text,p_latitude double precision,p_longitude double precision)
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
 IF state_value IS NOT NULL THEN RETURN jsonb_build_object('kind','state','state',state_value,'scope','A','label',state_value); END IF;
 IF label~'^\d{5}(-\d{4})?$' THEN
  postal_value:=left(label,5);
  SELECT d.state_code INTO state_value FROM public.explore_salon_documents d WHERE left(coalesce(d.postal_code,''),5)=postal_value ORDER BY d.salon_id LIMIT 1;
  SELECT avg(x.latitude),avg(x.longitude) INTO center_lat,center_lon FROM (
   SELECT latitude,longitude FROM public.explore_salon_documents WHERE left(coalesce(postal_code,''),5)=postal_value AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180 ORDER BY salon_id LIMIT 32
  ) x;
  RETURN jsonb_build_object('kind','postal','postal',postal_value,'state',state_value,'latitude',center_lat,'longitude',center_lon,'scope','A','label',postal_value);
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
 RETURN jsonb_build_object('kind','city','city',city_value,'state',state_value,'latitude',center_lat,'longitude',center_lon,'scope','A','label',label);
END $$;

CREATE FUNCTION public.explore_search_region_predicate(p_region jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE predicate text:='true'; center text; lat double precision; lon double precision; radius double precision;
BEGIN
 CASE p_region->>'kind'
 WHEN 'state' THEN predicate:=format('d.state_code=%L',p_region->>'state');
 WHEN 'city' THEN
  predicate:=format('d.city_search=%L',p_region->>'city');
  IF nullif(p_region->>'state','') IS NOT NULL THEN predicate:=predicate||format(' AND d.state_code=%L',p_region->>'state'); END IF;
 WHEN 'postal' THEN predicate:=format('left(coalesce(d.postal_code,'''') ,5)=%L',p_region->>'postal');
 WHEN 'geo' THEN
  lat:=(p_region->>'latitude')::double precision; lon:=(p_region->>'longitude')::double precision; radius:=(p_region->>'radius')::double precision;
  center:=format('extensions.ll_to_earth(%L::float8,%L::float8)',lat,lon);
  predicate:=format('d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 AND extensions.earth_box(%s,%L::float8) OPERATOR(extensions.@>) extensions.ll_to_earth(d.latitude,d.longitude) AND extensions.earth_distance(%s,extensions.ll_to_earth(d.latitude,d.longitude))<=%L::float8',center,radius,center,radius);
 WHEN 'other' THEN predicate:=format('(d.state_code IS NULL OR NOT(d.state_code=ANY(%L::text[])))',public.explore_search_state_codes());
 WHEN 'union' THEN predicate:='('||public.explore_search_region_predicate(p_region->'left')||') OR ('||public.explore_search_region_predicate(p_region->'right')||')';
 ELSE predicate:='true';
 END CASE;
 IF p_region ? 'exclude_region' THEN predicate:='('||predicate||') AND NOT('||public.explore_search_region_predicate(p_region->'exclude_region')||')'; END IF;
 RETURN 'coalesce(('||predicate||'),false)';
END $$;

CREATE FUNCTION public.explore_search_region_contains(p_region jsonb,p_document public.explore_salon_documents) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE matched boolean:=true;
BEGIN
 CASE p_region->>'kind'
 WHEN 'state' THEN matched:=p_document.state_code=p_region->>'state';
 WHEN 'city' THEN matched:=p_document.city_search=p_region->>'city' AND (p_region->>'state' IS NULL OR p_document.state_code=p_region->>'state');
 WHEN 'postal' THEN matched:=left(coalesce(p_document.postal_code,''),5)=p_region->>'postal';
 WHEN 'geo' THEN matched:=p_document.latitude BETWEEN -90 AND 90 AND p_document.longitude BETWEEN -180 AND 180 AND extensions.earth_distance(extensions.ll_to_earth((p_region->>'latitude')::float8,(p_region->>'longitude')::float8),extensions.ll_to_earth(p_document.latitude,p_document.longitude))<=(p_region->>'radius')::float8;
 WHEN 'other' THEN matched:=p_document.state_code IS NULL OR NOT(p_document.state_code=ANY(public.explore_search_state_codes()));
 WHEN 'union' THEN matched:=public.explore_search_region_contains(p_region->'left',p_document) OR public.explore_search_region_contains(p_region->'right',p_document);
 ELSE matched:=true;
 END CASE;
 IF p_region ? 'exclude_region' THEN matched:=coalesce(matched,false) AND NOT(public.explore_search_region_contains(p_region->'exclude_region',p_document)); END IF;
 RETURN coalesce(matched,false);
END $$;

CREATE FUNCTION public.explore_search_live_match(p_document public.explore_salon_documents,p_region jsonb,p_query text,p_fuzzy boolean,p_category text,p_exact boolean) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions SET pg_trgm.word_similarity_threshold='0.65' AS $$
DECLARE token text;
BEGIN
 IF NOT public.explore_search_region_contains(p_region,p_document) OR (p_category<>'' AND NOT(coalesce(p_document.service_category_search_text,'') LIKE '%'||p_category||'%')) THEN RETURN false; END IF;
 IF p_exact THEN RETURN p_document.salon_name_search=p_query; END IF;
 IF p_query='' THEN RETURN true; END IF;
 IF p_fuzzy THEN RETURN coalesce(p_document.salon_name_search OPERATOR(extensions.%>) p_query,false); END IF;
 IF length(p_query)<3 THEN RETURN coalesce(p_document.salon_name_search LIKE p_query||'%',false); END IF;
 FOR token IN SELECT unnest(regexp_split_to_array(p_query,'\s+')) LOOP
  IF NOT(coalesce(p_document.search_document,'') LIKE '%'||token||'%') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE FUNCTION public.explore_search_text_predicate(p_query text,p_fuzzy boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE predicate text; token text;
BEGIN
 IF coalesce(p_query,'')='' THEN RETURN 'true'; END IF;
 IF p_fuzzy THEN RETURN format('d.salon_name_search OPERATOR(extensions.%%>) %L',p_query); END IF;
 IF length(p_query)<3 THEN RETURN format('d.salon_name_search LIKE %L',p_query||'%'); END IF;
 predicate:='';
 FOR token IN SELECT unnest(regexp_split_to_array(p_query,'\s+')) LOOP
  IF predicate<>'' THEN predicate:=predicate||' AND '; END IF;
  predicate:=predicate||format('d.search_document LIKE %L','%'||token||'%');
 END LOOP;
 RETURN '('||predicate||')';
END $$;

CREATE FUNCTION public.explore_search_pull_batch(p_session_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off SET pg_trgm.word_similarity_threshold='0.65' AS $$
DECLARE s public.explore_search_sessions%ROWTYPE; region jsonb; predicate text; text_predicate text; raw_order text; raw_sort text;
 anchor_value double precision; anchor_id uuid; center text; distance_expression text:='NULL::float8'; batch jsonb; candidate jsonb; inserted integer:=0; affected integer; raw_last jsonb;
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
 IF s.applied_sort='newest' THEN raw_order:='d.created_at DESC,d.salon_id'; raw_sort:='-extract(epoch FROM d.created_at)::float8';
 ELSIF s.applied_sort='closest' AND center IS NOT NULL THEN
  raw_sort:=format('CASE WHEN d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 THEN extensions.ll_to_earth(d.latitude,d.longitude) OPERATOR(extensions.<->) %s ELSE 1e12::float8 END',center);
  IF region->>'kind'='geo' THEN
   -- Do not wrap the indexed KNN expression in CASE in an already valid
   -- geographic region: that would force sorting every nearby match.
   raw_sort:=format('extensions.ll_to_earth(d.latitude,d.longitude) OPERATOR(extensions.<->) %s',center);
  END IF;
  raw_order:=raw_sort||',d.salon_id';
 END IF;
 IF region->>'kind'='exact' THEN raw_order:='d.salon_id'; raw_sort:='0::float8'; END IF;
 IF s.region_anchor IS NOT NULL THEN
  anchor_value:=(s.region_anchor->>'value')::float8; anchor_id:=(s.region_anchor->>'id')::uuid;
  predicate:=predicate||format(' AND ROW(%s,d.salon_id)>ROW(%L::float8,%L::uuid)',raw_sort,anchor_value,anchor_id);
 END IF;
 EXECUTE format($query$
  WITH raw_pool AS MATERIALIZED (
   SELECT d.salon_id,d.salon_name_search,d.profile_completeness,d.created_at,d.service_categories,d.featured_service_name,d.active_service_count,%s AS raw_sort,%s AS distance_miles
   FROM public.explore_salon_documents d WHERE d.created_at<=$1 AND %s ORDER BY %s LIMIT 256
  ), ranked AS (
   SELECT r.*,coalesce(b.booking_enabled,false) AND r.featured_service_name IS NOT NULL AND r.active_service_count>0 AS is_bookable,
    (CASE WHEN $2<>'' AND r.salon_name_search=$2 THEN 1000 WHEN $2<>'' AND r.salon_name_search LIKE $2||'%%' THEN 800 WHEN $2<>'' THEN 600 ELSE 0 END
     +r.profile_completeness+CASE WHEN r.service_categories&&$3 THEN 20 ELSE 0 END)::float8 AS rank_score
   FROM raw_pool r LEFT JOIN public.booking_settings b ON b.salon_id=r.salon_id
  ) SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY
   CASE WHEN $4='bookable' THEN is_bookable END DESC NULLS LAST,
   CASE WHEN $4='newest' THEN created_at END DESC NULLS LAST,
   CASE WHEN $4='closest' THEN distance_miles END ASC NULLS LAST,
   rank_score DESC,distance_miles ASC NULLS LAST,salon_id),'[]'::jsonb) FROM ranked r
 $query$,raw_sort,distance_expression,predicate,raw_order) INTO batch USING s.created_at,s.query_text,s.preferred_categories,s.applied_sort;
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

CREATE FUNCTION public.search_public_explore_session(
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
 IF nullif(btrim(p_location),'') IS NOT NULL THEN p_latitude:=NULL;p_longitude:=NULL; END IF;
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
    AND public.explore_search_live_match(d,c.eligibility_region,s.query_text,s.use_fuzzy,s.category_text,c.search_scope='exact')
   ORDER BY c.ordinal LIMIT page_limit+1
  ) x;
  EXIT WHEN jsonb_array_length(batch)>page_limit OR s.exhausted;
  PERFORM public.explore_search_pull_batch(search_session_id);
  DELETE FROM public.explore_search_session_candidates c WHERE c.session_id=search_session_id
   AND NOT EXISTS(SELECT 1 FROM public.explore_salon_documents d WHERE d.salon_id=c.salon_id
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
 JOIN public.explore_salon_documents d ON d.salon_id=c.salon_id;
 more:=jsonb_array_length(batch)>page_limit;
 last_ordinal:=coalesce((page_rows->-1->'pagination_cursor'->>'after')::bigint,after_ordinal);
 next_token:=CASE WHEN more THEN jsonb_build_object('version',2,'session',search_session_id,'after',last_ordinal) ELSE NULL END;
 last_scope:=jsonb_build_object('policy',s.scope_policy,'stage',coalesce(page_rows->-1->>'search_scope','A'),'label',coalesce(page_rows->-1->>'scope_label',''),'expanded',initial_region IS NOT NULL AND coalesce(page_rows->-1->>'search_scope','A') IN ('B','C'));
 RETURN jsonb_build_object('rows',page_rows,'hasMore',more,'nextCursor',next_token,'cursor',next_token,'scope',last_scope,'countKind','loaded','totalCount',s.next_ordinal-1,'requestedSort',s.requested_sort,'appliedSort',s.applied_sort,'fuzzy',s.use_fuzzy);
END $$;

CREATE FUNCTION public.cleanup_explore_search_sessions(p_limit integer DEFAULT 5000) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM public.explore_search_sessions WHERE id IN (
  SELECT id FROM public.explore_search_sessions WHERE expires_at<=now() ORDER BY expires_at,id LIMIT least(10000,greatest(1,coalesce(p_limit,5000))) FOR UPDATE SKIP LOCKED
 );
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;

REVOKE ALL ON FUNCTION public.explore_search_state_codes(),public.explore_search_region(text,double precision,double precision),public.explore_search_region_predicate(jsonb),public.explore_search_region_contains(jsonb,public.explore_salon_documents),public.explore_search_live_match(public.explore_salon_documents,jsonb,text,boolean,text,boolean),public.explore_search_text_predicate(text,boolean),public.explore_search_pull_batch(uuid),public.cleanup_explore_search_sessions(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text) TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_explore_search_sessions(integer) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.schedule('kingpos-explore-search-cleanup','* * * * *','SELECT public.cleanup_explore_search_sessions(5000)');
 END IF;
END $$;
COMMIT;

