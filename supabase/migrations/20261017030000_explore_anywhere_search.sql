-- Equivalent all-token probes and narrow intermediate rows for Anywhere/ZIP
-- search. No rank/cursor/eligibility/media rules or fuzzy candidate sets change.
BEGIN;
SET LOCAL search_path=public,extensions;

CREATE OR REPLACE FUNCTION public.explore_unified_selective_token(p_query text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce((SELECT token FROM unnest(regexp_split_to_array(coalesce(p_query,''),'\s+')) WITH ORDINALITY words(token,n)
  ORDER BY CASE WHEN token=ANY(ARRAY['nail','nails','salon','salons','spa','spas','beauty','studio','studios','hair','haircut','haircuts','lash','lashes','brow','brows','barber','barbers','massage','massages','and','the','llc','inc']) OR length(token)<3 THEN 1 ELSE 0 END,length(token) DESC,n LIMIT 1),'')
$$;
REVOKE ALL ON FUNCTION public.explore_unified_selective_token(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.explore_unified_selective_token(text) TO service_role;


CREATE OR REPLACE FUNCTION public.explore_unified_pull_batch(p_session uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit=off AS $$
DECLARE s explore_search_sessions;canon jsonb;region jsonb;broader_region jsonb;eligibility text;local_predicate text;broader_predicate text;anchor_key float8[];anchor_id uuid;batch jsonb;r jsonb;added integer:=0;name_fragment text;service_fragment text;phase integer;candidate_region jsonb;candidate_label text;
BEGIN
 SELECT * INTO STRICT s FROM explore_search_sessions WHERE id=p_session FOR UPDATE;
 IF s.unified_address_priority_version=1 THEN RETURN _explore_unified_pull_before_address(p_session);END IF;
 IF s.exhausted THEN RETURN 0;END IF;canon:=s.unified_canonical;region:=s.region_plan->0;broader_region:=s.region_plan->1;
 local_predicate:='('||replace(explore_search_region_predicate(region),'d.','h.')||') AND ('||explore_search_region_predicate(region)||')';
 broader_predicate:=CASE WHEN broader_region->>'kind'='global' OR broader_region IS NULL THEN 'false' ELSE '('||replace(explore_search_region_predicate(broader_region),'d.','h.')||') AND ('||explore_search_region_predicate(broader_region)||')' END;
 -- Distance is already required for final ordering. Compute it once per frozen
 -- salon, and reuse it for both radii. A moved live pin still uses the current
 -- region predicate; equality is the only permission to reuse historic geometry.
 IF region->>'kind'='geo' AND ROW((region->>'latitude')::float8,(region->>'longitude')::float8) IS NOT DISTINCT FROM ROW(s.rank_origin_latitude,s.rank_origin_longitude) THEN
  local_predicate:=format('(geo.distance_meters<=%L::float8) AND (CASE WHEN ROW(h.latitude,h.longitude) IS NOT DISTINCT FROM ROW(d.latitude,d.longitude) THEN true ELSE (%s) END)',region->>'radius',explore_search_region_predicate(region));
 END IF;
 IF broader_region->>'kind'='geo' AND ROW((broader_region->>'latitude')::float8,(broader_region->>'longitude')::float8) IS NOT DISTINCT FROM ROW(s.rank_origin_latitude,s.rank_origin_longitude) THEN
  broader_predicate:=format('(geo.distance_meters<=%L::float8) AND (CASE WHEN ROW(h.latitude,h.longitude) IS NOT DISTINCT FROM ROW(d.latitude,d.longitude) THEN true ELSE (%s) END)',broader_region->>'radius',explore_search_region_predicate(broader_region));
 END IF;
 eligibility:='true';
 IF s.category_text<>'' THEN eligibility:=eligibility||format(' AND h.service_category_search_text LIKE %L AND d.service_category_search_text LIKE %L','%'||s.category_text||'%','%'||s.category_text||'%');END IF;
 IF s.unified_anchor IS NOT NULL THEN SELECT array_agg(x::float8 ORDER BY n) INTO anchor_key FROM jsonb_array_elements_text(s.unified_anchor->'key') WITH ORDINALITY a(x,n);anchor_id:=(s.unified_anchor->>'id')::uuid;END IF;
 SELECT '%'||token||'%' INTO name_fragment FROM unnest(regexp_split_to_array(s.query_text,'\s+')) token ORDER BY length(token) DESC LIMIT 1;
 -- Exact all-token evidence must contain every query token. Prefer a distinctive
 -- token for its indexed probe; the original fuzzy-name probe remains intact.
 IF canon->>'queryKind'<>'name' THEN name_fragment:='%'||explore_unified_selective_token(s.query_text)||'%';END IF;
 service_fragment:='%'||explore_unified_selective_token(coalesce(canon->>'contentQuery',''))||'%';
 EXECUTE format($sql$
 WITH salon_distances AS MATERIALIZED (
  SELECT h.salon_id,CASE WHEN h.latitude BETWEEN -90 AND 90 AND h.longitude BETWEEN -180 AND 180 THEN extensions.earth_distance(extensions.ll_to_earth($7,$8),extensions.ll_to_earth(h.latitude,h.longitude)) END AS distance_meters
  FROM explore_unified_salon_history h WHERE $7 IS NOT NULL AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1)
 ), name_matches AS MATERIALIZED (
  SELECT h.salon_id,CASE WHEN h.salon_name_search=$3 AND d.salon_name_search=$3 THEN 0 WHEN h.salon_name_search LIKE $3||'%%' AND d.salon_name_search LIKE $3||'%%' THEN 1
   WHEN explore_unified_all_tokens(h.salon_name_search,$3) AND explore_unified_all_tokens(d.salon_name_search,$3) THEN 2 ELSE 3 END AS tier
  FROM explore_unified_salon_history h
  -- Revalidate only the frozen name candidates by canonical primary key. The
  -- barrier prevents an unrelated full live-table scan of procedural name proof.
  JOIN LATERAL (SELECT live_name.salon_name_search FROM explore_salon_documents live_name WHERE live_name.salon_id=h.salon_id OFFSET 0) d ON true
  WHERE $3<>'' AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1)
   AND (h.salon_name_search LIKE $17 OR ($9='name' AND h.salon_name_search OPERATOR(extensions.%%) $3))
   AND ((explore_unified_all_tokens(h.salon_name_search,$3) AND explore_unified_all_tokens(d.salon_name_search,$3))
    OR ($9='name' AND explore_unified_name_similarity(h.salon_name_search,$3)>0 AND explore_unified_name_similarity(d.salon_name_search,$3)>0))
 ), service_matches AS MATERIALIZED (
  SELECT h.salon_id FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
  WHERE $4<>'' AND $9<>'style' AND NOT $10 AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1)
   AND h.service_search_text LIKE $18 AND explore_unified_all_tokens(h.service_search_text,$4) AND explore_unified_all_tokens(d.service_search_text,$4)
 ), profile_matches AS MATERIALIZED (
  SELECT h.salon_id FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
  WHERE $4<>'' AND $9<>'style' AND NOT $10 AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1)
   AND (h.profile_search_text LIKE $18 OR (length(regexp_replace($4,'[^0-9]','','g'))>=7 AND h.phone_search_digits LIKE '%%'||regexp_replace($4,'[^0-9]','','g')||'%%'))
   AND explore_unified_profile_match(h.profile_search_text,h.phone_search_digits,$4)
   AND explore_unified_profile_match(explore_unified_profile_text(d),regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),$4)
 ), content_matches AS MATERIALIZED (
  SELECT DISTINCT ON(h.salon_id) h.salon_id,h.content_key,h.source_token AS content_source_token,h.source_type,h.is_reference,ts_rank_cd(h.search_terms,plainto_tsquery('english',$4))::float8 AS content_score
  FROM explore_unified_content_history h JOIN explore_unified_content_history live ON live.content_key=h.content_key AND live.valid_to IS NULL AND live.source_token=h.source_token AND live.salon_id=h.salon_id AND live.is_reference=h.is_reference
  WHERE $4<>'' AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1) AND h.published_at<=$2 AND live.published_at<=$2
   AND h.search_terms@@plainto_tsquery('english',$4) AND live.search_terms@@plainto_tsquery('english',$4) AND NOT social_users_blocked($5,live.author_user_id)
   AND (NOT $10 OR NOT h.is_reference)
  ORDER BY h.salon_id,h.is_reference,content_score DESC,h.published_at DESC,h.content_key
 ), related_matches AS MATERIALIZED (
  SELECT DISTINCT ON(h.salon_id) h.salon_id,h.content_key,h.source_token AS content_source_token,h.source_type,ts_rank_cd(h.search_terms,to_tsquery('english',replace(plainto_tsquery('english',$4)::text,' & ',' | ')))::float8 AS content_score
  FROM explore_unified_content_history h JOIN explore_unified_content_history live ON live.content_key=h.content_key AND live.valid_to IS NULL AND live.source_token=h.source_token AND live.salon_id=h.salon_id
  WHERE $9='style' AND $4<>'' AND NOT h.is_reference AND NOT live.is_reference AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1) AND h.published_at<=$2 AND live.published_at<=$2
   AND h.search_terms@@to_tsquery('english',replace(plainto_tsquery('english',$4)::text,' & ',' | ')) AND live.search_terms@@to_tsquery('english',replace(plainto_tsquery('english',$4)::text,' & ',' | '))
   AND (NOT $10 OR (h.search_terms@@explore_unified_facet_terms($6) AND live.search_terms@@explore_unified_facet_terms($6))) AND NOT social_users_blocked($5,live.author_user_id)
  ORDER BY h.salon_id,content_score DESC,h.published_at DESC,h.content_key
 ), real_media_salons AS MATERIALIZED (
  SELECT DISTINCT p.salon_id FROM explore_unified_content_history p
  WHERE p.has_real_media AND NOT p.is_reference AND p.valid_from<=$1 AND (p.valid_to IS NULL OR p.valid_to>$1) AND p.published_at<=$2
   AND NOT social_users_blocked($5,p.author_user_id)
   AND (p.source_type<>'beauty_post' OR $4='' OR ($9<>'style' AND NOT $10)
    OR (p.search_terms@@CASE WHEN $9='style' THEN to_tsquery('english',replace(plainto_tsquery('english',$4)::text,' & ',' | ')) ELSE plainto_tsquery('english',$4) END
     AND (NOT $10 OR p.search_terms@@explore_unified_facet_terms($6))))
 ), eligible AS MATERIALIZED (
  -- Carry only fields consumed by ranking/candidate insertion. Long profile and
  -- address text remain in their evidence predicates, not three materializations.
  SELECT h.salon_id,h.source_token,h.created_at,h.profile_completeness,coalesce(m.content_key,rel.content_key) AS content_key,coalesce(m.content_source_token,rel.content_source_token) AS content_source_token,coalesce(m.source_type,rel.source_type) AS source_type,m.is_reference,coalesce(m.content_score,rel.content_score) AS content_score,
   CASE WHEN $10 AND m.content_key IS NULL THEN CASE WHEN rel.salon_id IS NOT NULL THEN 8 ELSE 9 END
    WHEN n.salon_id IS NOT NULL THEN n.tier
    WHEN m.content_key IS NOT NULL THEN CASE WHEN m.is_reference THEN 6 ELSE 4 END
    WHEN v.salon_id IS NOT NULL THEN 5
    WHEN profile_match.salon_id IS NOT NULL THEN 10
    WHEN rel.salon_id IS NOT NULL THEN 8
    WHEN $3='' AND $4='' THEN 7 ELSE 9 END AS tier,
   CASE WHEN %s THEN 0 WHEN %s THEN 1 ELSE 2 END AS area_tier,
   (h.has_real_cover OR photo.salon_id IS NOT NULL) AS snapshot_real_media,
   ($19<>'' AND h.service_category_search_text LIKE '%%'||$19||'%%' AND d.service_category_search_text LIKE '%%'||$19||'%%') AS related_category,
   geo.distance_meters/1609.344 AS distance,coalesce(rank.trust_score,0) AS canonical_trust,coalesce(rank.bookable,false) AS canonical_bookable
  FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
  LEFT JOIN content_matches m ON m.salon_id=h.salon_id
  LEFT JOIN related_matches rel ON rel.salon_id=h.salon_id
  LEFT JOIN name_matches n ON n.salon_id=h.salon_id
  LEFT JOIN service_matches v ON v.salon_id=h.salon_id
  LEFT JOIN profile_matches profile_match ON profile_match.salon_id=h.salon_id
  LEFT JOIN LATERAL(SELECT r.trust_score,r.bookable FROM explore_search_rank_history r JOIN explore_search_rank_groups g ON g.group_id=r.group_id
   WHERE $21 IS NOT NULL AND r.salon_id=h.salon_id AND g.group_key=explore_rank_scope_key('{"kind":"global"}',$13) AND r.valid_from<=$21 AND (r.valid_to IS NULL OR r.valid_to>$21) LIMIT 1) rank ON true
  LEFT JOIN real_media_salons photo ON photo.salon_id=h.salon_id
  LEFT JOIN salon_distances geo ON geo.salon_id=h.salon_id
  -- UUID and source-token are correlated identity proof, not independent filters.
  -- Keep that exact proof as a keyed existence check so its selectivity cannot
  -- make the planner estimate one salon and repeatedly rescan every match CTE.
  WHERE EXISTS(SELECT 1 FROM explore_unified_salon_incarnations incarnation WHERE incarnation.salon_id=h.salon_id AND incarnation.source_token=h.source_token OFFSET 0)
   AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1) AND h.created_at<=$2 AND (h.public_discovery_published_at IS NULL OR h.public_discovery_published_at<=$2)
   AND d.created_at<=$2 AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=$2) AND d.has_public_profile
   AND %s AND (($6-ARRAY['shape','length','color','finish','tone','season'])='{}'::jsonb OR explore_unified_filter_salon(d,$6,$5,$2))
   AND (($19<>'' AND h.service_category_search_text LIKE '%%'||$19||'%%') OR ($3='' AND $4='') OR n.salon_id IS NOT NULL OR m.content_key IS NOT NULL OR rel.salon_id IS NOT NULL OR v.salon_id IS NOT NULL OR profile_match.salon_id IS NOT NULL)
 ), phased AS MATERIALIZED (
  SELECT e.*,CASE WHEN (($20<>'fixed' AND NOT $11) OR area_tier=0) AND (tier<6 OR tier IN (7,10)) THEN 0
   WHEN area_tier=0 THEN 1 WHEN area_tier=1 AND (tier<6 OR tier=10) THEN 2 WHEN area_tier=1 THEN 3 WHEN tier<6 OR tier=10 THEN 4 ELSE 5 END AS reference_phase
  FROM eligible e WHERE tier<9 OR tier=10 OR related_category
 ), ranked AS MATERIALIZED (
  SELECT e.*,ARRAY[
   CASE WHEN $11 THEN area_tier ELSE 0 END::float8,
   CASE WHEN reference_phase=0 THEN 0 ELSE 1 END::float8,
   CASE WHEN reference_phase=0 THEN 0 WHEN tier<=5 OR tier=10 THEN 1 WHEN tier=8 THEN 2 WHEN snapshot_real_media THEN 3 ELSE 4 END::float8,
   CASE WHEN $12='bookable' THEN -canonical_bookable::int ELSE 0 END::float8,
   CASE WHEN $12 IN ('trusted','bookable') THEN -canonical_trust ELSE 0 END,
   CASE WHEN $12='newest' THEN -extract(epoch FROM created_at)::float8 WHEN $12='closest' THEN 0 ELSE CASE WHEN tier=10 THEN 5.5 ELSE tier::float8 END END,
   CASE WHEN $12='relevance' THEN -coalesce(content_score,0) ELSE 0 END,
   CASE WHEN $12='relevance' AND NOT snapshot_real_media THEN 1 ELSE 0 END::float8,
   CASE WHEN $11 OR $12='closest' THEN coalesce(distance,1e12) ELSE 0 END,
   reference_phase::float8,area_tier::float8,coalesce(distance,1e12),-profile_completeness::float8] AS order_key
  FROM phased e
 ) SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY order_key,salon_id),'[]') FROM (
  SELECT * FROM ranked WHERE ($14 IS NULL OR ROW(order_key,salon_id)>ROW($14,$15))
   AND NOT EXISTS(SELECT 1 FROM explore_search_session_candidates c WHERE c.session_id=$16 AND c.salon_id=ranked.salon_id)
  ORDER BY order_key,salon_id LIMIT 64
 ) page
 $sql$,local_predicate,broader_predicate,eligibility) INTO batch USING s.unified_revision,s.created_at,s.query_text,coalesce(canon->>'contentQuery',''),s.user_id,canon->'filters',
 s.rank_origin_latitude,s.rank_origin_longitude,canon->>'queryKind',(canon->'filters') ?| ARRAY['shape','length','color','finish','tone','season'],coalesce((canon->>'locationPriority')::boolean,false),s.applied_sort,s.category_text,anchor_key,anchor_id,s.id,name_fragment,service_fragment,coalesce(s.unified_reference_category,''),s.scope_policy,s.rank_version;
 FOR r IN SELECT value FROM jsonb_array_elements(batch) LOOP
  phase:=(r->>'reference_phase')::int;
  candidate_region:=CASE WHEN phase=0 AND s.scope_policy='expandable' AND NOT coalesce((canon->>'locationPriority')::boolean,false) THEN jsonb_build_object('kind','global') WHEN phase IN (0,1) THEN region WHEN phase IN (2,3) THEN broader_region ELSE jsonb_build_object('kind','global') END;
  candidate_label:=CASE WHEN phase IN (0,1) THEN coalesce(region->>'label','Selected area') WHEN phase IN (2,3) THEN coalesce(broader_region->>'label','Broader area') ELSE 'Other areas' END;
  INSERT INTO explore_search_session_candidates(session_id,ordinal,salon_id,search_scope,scope_label,eligibility_region,rank_score,distance_miles,match_type,unified_payload)
  VALUES(s.id,s.next_ordinal,(r->>'salon_id')::uuid,CASE r->>'area_tier' WHEN '0' THEN 'A' WHEN '1' THEN 'B' ELSE 'C' END,
   candidate_label,candidate_region,
   100-(r->>'tier')::int,(r->>'distance')::float8,
   CASE (r->>'tier')::int WHEN 0 THEN 'exact_name' WHEN 1 THEN 'prefix_name' WHEN 2 THEN 'name_tokens' WHEN 3 THEN 'fuzzy_name' WHEN 4 THEN 'post' WHEN 6 THEN 'reference_post' WHEN 5 THEN 'service' WHEN 10 THEN 'profile' WHEN 7 THEN 'nearby' WHEN 8 THEN 'related_post' ELSE 'suggested' END,
   jsonb_build_object('sourceToken',r->'source_token','tier',r->'tier','orderKey',r->'order_key','referencePhase',phase,'snapshotRealMedia',r->'snapshot_real_media','recommendationAreaLabel',CASE WHEN phase>0 THEN candidate_label END,
    'recommendationReason',CASE phase WHEN 1 THEN 'related_in_area' WHEN 2 THEN 'matching_in_broader_area' WHEN 3 THEN 'related_in_broader_area' WHEN 4 THEN 'matching_in_other_areas' WHEN 5 THEN 'related_in_other_areas' END,
    'matchContentKey',r->'content_key','matchContentSourceToken',r->'content_source_token','matchSource',CASE WHEN (r->>'tier')::int<=3 THEN 'salon_name' WHEN (r->>'tier')::int IN (4,8) THEN CASE WHEN r->>'source_type'='beauty_post' THEN 'customer_post' ELSE 'salon_post' END WHEN (r->>'tier')::int=6 THEN 'reference_post' WHEN (r->>'tier')::int=5 THEN 'service' WHEN (r->>'tier')::int=10 THEN 'profile' WHEN (r->>'tier')::int=7 THEN 'category' ELSE 'suggested' END))
  ON CONFLICT(session_id,salon_id) DO NOTHING;
  s.next_ordinal:=s.next_ordinal+1;added:=added+1;
 END LOOP;
 UPDATE explore_search_sessions SET next_ordinal=s.next_ordinal,exhausted=jsonb_array_length(batch)<64,
  unified_anchor=CASE WHEN jsonb_array_length(batch)>0 THEN jsonb_build_object('key',batch->-1->'order_key','id',batch->-1->'salon_id') ELSE unified_anchor END WHERE id=s.id;
 RETURN added;
END $$;


CREATE OR REPLACE FUNCTION public.search_public_explore_session(
 p_query text DEFAULT NULL,p_category text DEFAULT NULL,p_location text DEFAULT NULL,p_latitude float8 DEFAULT NULL,p_longitude float8 DEFAULT NULL,
 p_sort text DEFAULT 'relevance',p_limit integer DEFAULT 12,p_cursor jsonb DEFAULT NULL,p_scope_policy text DEFAULT 'fixed',p_intent text DEFAULT 'search',
 p_content_query text DEFAULT NULL,p_query_kind text DEFAULT NULL,p_location_priority boolean DEFAULT false,p_filters jsonb DEFAULT '{}',p_hydrate_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit=off AS $$
DECLARE q text:=coalesce(normalize_search_text(p_query),'');cq text:=coalesce(normalize_search_text(coalesce(p_content_query,p_query)),'');cat text:=coalesce(normalize_search_text(p_category),'');
 kind text:=coalesce(p_query_kind,'service');f jsonb:=coalesce(p_filters,'{}');canon jsonb;sig text;viewer text:=coalesce(current_public_user_id()::text,'guest');
 s explore_search_sessions;sid uuid;after_value bigint:=0;page_limit integer:=least(20,greatest(1,coalesce(p_limit,12)));ids uuid[];rows jsonb;more boolean;last_ordinal bigint;session_cursor jsonb;key text;value jsonb;region jsonb;broader_region jsonb;reference_category text;name_fragment text;service_fragment text;attempts integer:=0;
BEGIN
 p_sort:=coalesce(p_sort,'relevance');p_scope_policy:=coalesce(p_scope_policy,'fixed');p_intent:=coalesce(p_intent,'search');
 IF p_cursor->>'version'='2' OR (p_cursor IS NULL AND p_query_kind IS NULL AND p_content_query IS NULL AND f='{}' AND NOT coalesce(p_location_priority,false) AND p_hydrate_ids IS NULL) THEN
  RETURN _explore_search_session_v2(p_query,p_category,p_location,p_latitude,p_longitude,p_sort,p_limit,p_cursor,p_scope_policy,p_intent);
 END IF;
 IF length(coalesce(p_query,''))>160 OR length(coalesce(p_content_query,''))>320 OR length(coalesce(p_category,''))>80 OR length(coalesce(p_location,''))>160 OR octet_length(f::text)>2048 OR jsonb_typeof(f)<>'object' THEN RAISE EXCEPTION 'Invalid search input' USING ERRCODE='22023';END IF;
 IF kind NOT IN ('name','style','service') OR p_scope_policy NOT IN ('fixed','expandable') OR p_intent NOT IN ('search','discover','latest') OR p_sort NOT IN ('relevance','closest','newest','trusted','bookable') THEN RAISE EXCEPTION 'Invalid search option' USING ERRCODE='22023';END IF;
 FOR key,value IN SELECT * FROM jsonb_each(f) LOOP
  IF key IN ('shape','length','color','finish','tone','season') THEN
   IF jsonb_typeof(value)<>'string' OR length(value#>>'{}')>40 OR normalize_search_text(value#>>'{}') IS NULL THEN RAISE EXCEPTION 'Invalid content filter' USING ERRCODE='22023';END IF;
   f:=jsonb_set(f,ARRAY[key],to_jsonb(normalize_search_text(value#>>'{}')));
   IF NOT explore_unified_all_tokens(cq,normalize_search_text(value#>>'{}')) THEN cq:=btrim(cq||' '||normalize_search_text(value#>>'{}'));END IF;
  ELSIF key='maxPrice' THEN IF jsonb_typeof(value)<>'number' OR (value#>>'{}')::numeric NOT BETWEEN 0 AND 100000 THEN RAISE EXCEPTION 'Invalid price filter' USING ERRCODE='22023';END IF;
  ELSIF key IN ('bookableOnly','newOnly','trendingOnly') THEN IF jsonb_typeof(value)<>'boolean' THEN RAISE EXCEPTION 'Invalid search filter' USING ERRCODE='22023';END IF;
  ELSE RAISE EXCEPTION 'Unsupported search filter' USING ERRCODE='22023';END IF;
 END LOOP;
 IF cat='all' THEN cat:='';END IF;
 IF NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN p_latitude:=NULL;p_longitude:=NULL;END IF;
 IF p_cursor IS NULL OR EXISTS(SELECT 1 FROM explore_search_sessions old_session WHERE old_session.id=CASE WHEN p_cursor->>'session' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (p_cursor->>'session')::uuid END AND old_session.viewer_key=viewer AND old_session.unified_address_priority_version>=2) THEN p_location_priority:=coalesce(p_location_priority,false) OR nullif(btrim(coalesce(p_location,'')),'') IS NOT NULL OR p_latitude IS NOT NULL;END IF;
 canon:=jsonb_build_object('query',q,'contentQuery',cq,'queryKind',kind,'locationPriority',coalesce(p_location_priority,false),'filters',f,'location',btrim(coalesce(p_location,'')),'category',coalesce(p_category,''),'latitude',p_latitude,'longitude',p_longitude,'scopePolicy',p_scope_policy,'intent',coalesce(p_intent,'search'));
 sig:=md5(jsonb_build_array(canon,p_sort,coalesce(p_intent,'search'))::text);
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR octet_length(p_cursor::text)>512 OR p_cursor->>'version'<>'3' THEN RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023';END IF;
  BEGIN sid:=(p_cursor->>'session')::uuid;after_value:=(p_cursor->>'after')::bigint;EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023';END;
  SELECT * INTO s FROM explore_search_sessions WHERE id=sid FOR UPDATE;
  IF s.id IS NULL OR s.expires_at<=now() OR s.viewer_key<>viewer OR s.signature<>sig OR s.unified_canonical IS NULL OR after_value IS NULL OR after_value<0 OR after_value>=s.next_ordinal THEN RAISE EXCEPTION 'Search changed or expired; refresh results' USING ERRCODE='22023';END IF;
 ELSE
  IF p_hydrate_ids IS NOT NULL THEN RAISE EXCEPTION 'Hydration requires a search session' USING ERRCODE='22023';END IF;
  sid:=gen_random_uuid();region:=explore_unified_address_region(p_location,p_latitude,p_longitude);
  broader_region:=CASE WHEN region->>'kind'='address' THEN jsonb_build_object('kind','city','city',region->>'city','state',region->>'state','scope','B','label',region->>'cityLabel') WHEN region->>'kind'='geo' THEN jsonb_build_object('kind','geo','latitude',p_latitude,'longitude',p_longitude,'radius',80467.2,'scope','B','label','Within 50 miles')
   WHEN region->>'state' IS NOT NULL THEN jsonb_build_object('kind','state','state',region->>'state','scope','B','label',region->>'state') ELSE jsonb_build_object('kind','global','scope','C','label','Other areas') END;
  INSERT INTO explore_search_sessions(id,user_id,viewer_key,signature,query_text,category_text,requested_sort,applied_sort,scope_policy,intent,region_plan,unified_canonical,unified_revision,rank_origin_latitude,rank_origin_longitude,supported_sorts,sort_fallback_reason,ranking_basis,unified_address_priority_version)
  VALUES(sid,current_public_user_id(),viewer,sig,q,cat,p_sort,CASE WHEN p_sort IN ('trusted','bookable') OR p_sort='closest' AND p_latitude IS NULL THEN 'relevance' ELSE p_sort END,p_scope_policy,coalesce(p_intent,'search'),jsonb_build_array(region,broader_region),canon,(SELECT revision FROM explore_unified_search_clock WHERE id),p_latitude,p_longitude,
   CASE WHEN p_latitude IS NOT NULL THEN ARRAY['relevance','closest','newest'] ELSE ARRAY['relevance','newest'] END,CASE WHEN p_sort IN ('trusted','bookable') THEN 'unified_sort_not_supported' WHEN p_sort='closest' AND p_latitude IS NULL THEN 'location_required' END,'unified_indexed_scope',2);
  PERFORM explore_unified_configure_sorts(sid);
  SELECT * INTO s FROM explore_search_sessions WHERE id=sid;
  reference_category:=cat;
  IF reference_category='' AND q<>'' THEN
   SELECT '%'||token||'%' INTO name_fragment FROM unnest(regexp_split_to_array(q,'\s+')) token ORDER BY length(token) DESC LIMIT 1;
   service_fragment:='%'||explore_unified_selective_token(cq)||'%';
   -- The original first category tier is historic name=q. Probe that indexed
   -- tier first, retaining EVERY live/public/match qualifier and its UUID tie.
   -- A renamed live row still must pass the original exact/fuzzy/service proof.
   SELECT h.service_category_search_text INTO reference_category FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
   WHERE h.salon_name_search=q AND h.valid_from<=s.unified_revision AND (h.valid_to IS NULL OR h.valid_to>s.unified_revision) AND h.service_category_search_text<>''
    AND d.has_public_profile AND h.created_at<=s.created_at AND (h.public_discovery_published_at IS NULL OR h.public_discovery_published_at<=s.created_at)
    AND ((h.salon_name_search LIKE name_fragment AND explore_unified_all_tokens(h.salon_name_search,q) AND explore_unified_all_tokens(d.salon_name_search,q))
     OR (kind='name' AND h.salon_name_search OPERATOR(extensions.%) q AND explore_unified_name_similarity(h.salon_name_search,q)>0 AND explore_unified_name_similarity(d.salon_name_search,q)>0)
     OR (kind='service' AND h.service_search_text LIKE service_fragment AND explore_unified_all_tokens(h.service_search_text,cq) AND explore_unified_all_tokens(d.service_search_text,cq)))
    AND salon_profile_public_salon_exists(d.salon_id)
   ORDER BY h.salon_id LIMIT 1;
   IF reference_category IS NULL THEN
   SELECT h.service_category_search_text INTO reference_category FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
   WHERE h.valid_from<=s.unified_revision AND (h.valid_to IS NULL OR h.valid_to>s.unified_revision) AND h.service_category_search_text<>''
    AND d.has_public_profile AND h.created_at<=s.created_at AND (h.public_discovery_published_at IS NULL OR h.public_discovery_published_at<=s.created_at)
    AND ((h.salon_name_search LIKE name_fragment AND explore_unified_all_tokens(h.salon_name_search,q) AND explore_unified_all_tokens(d.salon_name_search,q))
     OR (kind='name' AND h.salon_name_search OPERATOR(extensions.%) q AND explore_unified_name_similarity(h.salon_name_search,q)>0 AND explore_unified_name_similarity(d.salon_name_search,q)>0)
     OR (kind='service' AND h.service_search_text LIKE service_fragment AND explore_unified_all_tokens(h.service_search_text,cq) AND explore_unified_all_tokens(d.service_search_text,cq)))
    AND salon_profile_public_salon_exists(d.salon_id)
   ORDER BY CASE WHEN h.salon_name_search=q THEN 0 WHEN h.salon_name_search LIKE q||'%' THEN 1 WHEN explore_unified_all_tokens(h.salon_name_search,q) THEN 2 ELSE 3 END,h.salon_id LIMIT 1;
   END IF;
  END IF;
  -- A recognized service noun can still offer labelled category references when
  -- an unfamiliar style phrase has no public name/service match. This affects
  -- recommendations only: keep canonical intent/category and primary proof as
  -- supplied. Proven row/category inference above always wins; mixed industries
  -- must not be resolved by guessing one category.
  IF coalesce(reference_category,'')='' AND regexp_split_to_array(btrim(q||' '||cq),'\s+') && ARRAY['nail','nails']
   AND NOT(regexp_split_to_array(btrim(q||' '||cq),'\s+') && ARRAY['hair','haircut','haircuts','lash','lashes','eyelash','eyelashes','barber','barbers','spa','spas','brow','brows','eyebrow','eyebrows','makeup','skin','skincare','facial','facials','massage','massages','wax','waxing','tattoo','tattoos']) THEN
   reference_category:='nails';
  END IF;
  UPDATE explore_search_sessions SET unified_reference_category=coalesce(reference_category,'') WHERE id=sid RETURNING * INTO s;
 END IF;
 IF p_hydrate_ids IS NOT NULL THEN
  IF cardinality(p_hydrate_ids)>100 OR EXISTS(SELECT 1 FROM unnest(p_hydrate_ids) i WHERE i IS NULL OR NOT EXISTS(SELECT 1 FROM explore_search_session_candidates c WHERE c.session_id=s.id AND c.salon_id=i AND c.unified_delivered)) THEN RAISE EXCEPTION 'Invalid search hydration membership' USING ERRCODE='22023';END IF;
  rows:=hydrate_explore_unified_search(s.id,p_hydrate_ids);
  RETURN jsonb_build_object('searchVersion',3,'canonical',s.unified_canonical,'recommendationCategory',nullif(s.unified_reference_category,''),'rows',rows,'sessionCursor',p_cursor,'hasMore',false,'nextCursor',NULL,'countKind','loaded','totalCount',jsonb_array_length(rows),'primaryCount',(SELECT count(*) FROM jsonb_array_elements(rows) r WHERE (r->>'is_primary_match')::boolean),'referenceCount',(SELECT count(*) FROM jsonb_array_elements(rows) r WHERE NOT (r->>'is_primary_match')::boolean),'appliedSort',s.applied_sort,'supportedSorts',s.supported_sorts,'sortFallbackReason',s.sort_fallback_reason,'rankAsOf',s.created_at,'rankingBasis',s.ranking_basis,'hydrated',true);
 END IF;
 LOOP
  SELECT array_agg(salon_id ORDER BY ordinal) INTO ids FROM (
   SELECT c.salon_id,c.ordinal FROM explore_search_session_candidates c JOIN explore_salon_documents d USING(salon_id)
   WHERE c.session_id=s.id AND c.ordinal>after_value AND explore_unified_candidate_live(s,c,d) ORDER BY c.ordinal LIMIT page_limit+1
  ) eligible;
  EXIT WHEN coalesce(cardinality(ids),0)>page_limit OR s.exhausted;
  PERFORM explore_unified_pull_batch(s.id);SELECT * INTO s FROM explore_search_sessions WHERE id=sid;
  attempts:=attempts+1;IF attempts>2048 THEN RAISE EXCEPTION 'Search progress exceeded limit' USING ERRCODE='54000';END IF;
 END LOOP;
 more:=coalesce(cardinality(ids),0)>page_limit;ids:=coalesce(ids[1:page_limit],'{}');
 rows:=hydrate_explore_unified_search(s.id,ids);
 UPDATE explore_search_session_candidates SET unified_delivered=true WHERE session_id=s.id AND salon_id IN(SELECT (r->>'salon_id')::uuid FROM jsonb_array_elements(rows) r);
 SELECT coalesce(max(ordinal),after_value) INTO last_ordinal FROM explore_search_session_candidates WHERE session_id=s.id AND salon_id=ANY(ids);
 session_cursor:=jsonb_build_object('version',3,'session',s.id,'after',last_ordinal);
 RETURN jsonb_build_object('searchVersion',3,'canonical',s.unified_canonical,'recommendationCategory',nullif(s.unified_reference_category,''),'rows',rows,'sessionCursor',session_cursor,'hasMore',more,'nextCursor',CASE WHEN more THEN session_cursor END,'cursor',CASE WHEN more THEN session_cursor END,
  'primaryCount',(SELECT count(*) FROM jsonb_array_elements(rows) r WHERE (r->>'is_primary_match')::boolean),'referenceCount',(SELECT count(*) FROM jsonb_array_elements(rows) r WHERE NOT (r->>'is_primary_match')::boolean),
  'scope',jsonb_build_object('policy',s.scope_policy,'stage',coalesce(s.region_plan->0->>'scope','A'),'label',coalesce(s.region_plan->0->>'label',''),'expanded',false),
  'countKind','loaded','totalCount',s.next_ordinal-1,'requestedSort',s.requested_sort,'appliedSort',s.applied_sort,'supportedSorts',s.supported_sorts,'sortFallbackReason',s.sort_fallback_reason,'rankVersion',s.unified_revision,'rankAsOf',s.created_at,'rankingBasis',s.ranking_basis);
END $$;


NOTIFY pgrst,'reload schema';
COMMIT;
