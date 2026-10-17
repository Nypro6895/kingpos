-- Address-first salon search; additive to the unified search revision.
-- No source addresses/pins/media are changed. Existing v3 cursor order is retained.
BEGIN;
SET LOCAL search_path=public,extensions;

CREATE FUNCTION public.explore_normalize_address(p_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(string_agg(CASE word
  WHEN 'street' THEN 'st' WHEN 'avenue' THEN 'ave' WHEN 'road' THEN 'rd' WHEN 'boulevard' THEN 'blvd'
  WHEN 'drive' THEN 'dr' WHEN 'lane' THEN 'ln' WHEN 'court' THEN 'ct' WHEN 'circle' THEN 'cir'
  WHEN 'parkway' THEN 'pkwy' WHEN 'highway' THEN 'hwy' WHEN 'place' THEN 'pl' WHEN 'terrace' THEN 'ter'
  WHEN 'square' THEN 'sq' WHEN 'trail' THEN 'trl' WHEN 'north' THEN 'n' WHEN 'south' THEN 's'
  WHEN 'east' THEN 'e' WHEN 'west' THEN 'w' WHEN 'suite' THEN NULL WHEN 'ste' THEN NULL WHEN 'unit' THEN NULL
  ELSE word END,' ' ORDER BY n),'') FROM unnest(regexp_split_to_array(coalesce(normalize_search_text(p_value),''),'\s+')) WITH ORDINALITY tokens(word,n)
$$;
CREATE FUNCTION public.explore_unified_address_query(p_value text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE normalized text:=coalesce(normalize_search_text(p_value),'');state_name text;state_code text;suffix text;
BEGIN
 IF cardinality(regexp_split_to_array(normalized,'\s+'))>=4 THEN
  SELECT key,value,substring(normalized FROM '( [0-9]{5}( [0-9]{4})?)$') INTO state_name,state_code,suffix
  FROM jsonb_each_text('{"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY"}'::jsonb)
  WHERE regexp_replace(normalized,' [0-9]{5}( [0-9]{4})?$','') LIKE '% '||key ORDER BY length(key) DESC LIMIT 1;
  IF state_name IS NOT NULL THEN normalized:=regexp_replace(normalized,' '||state_name||'( [0-9]{5}( [0-9]{4})?)?$',' '||lower(state_code)||coalesce(suffix,''));END IF;
 END IF;
 RETURN explore_normalize_address(normalized);
END $$;
CREATE FUNCTION public.explore_unified_address_tokens(street text,unit text,city text,state text,zip text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT regexp_split_to_array(explore_normalize_address(concat_ws(' ',street,unit,city,state,zip)),'\s+')
$$;
CREATE INDEX explore_document_address_tokens_idx ON public.explore_salon_documents USING gin(public.explore_unified_address_tokens(address_line1,address_line2,city,state_code,postal_code));
CREATE INDEX explore_document_address_house_idx ON public.explore_salon_documents((split_part(public.explore_normalize_address(address_line1),' ',1)),salon_id);

CREATE FUNCTION public.get_public_explore_address_area(p_address text,p_preferred_state text DEFAULT NULL,p_limit integer DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE key text:=explore_unified_address_query(p_address);tokens text[];result_limit int:=least(8,greatest(1,coalesce(p_limit,8)));hits jsonb;areas jsonb;more boolean;
BEGIN
 IF length(coalesce(p_address,''))>160 THEN RAISE EXCEPTION 'Address text exceeds limits' USING ERRCODE='22023';END IF;
 tokens:=regexp_split_to_array(key,'\s+');
 IF key !~ '^([0-9]+[a-z]?|[nsew][0-9]+[nsew][0-9]+) ' OR cardinality(tokens)<2 OR cardinality(tokens)>24 THEN RETURN jsonb_build_object('version',1,'areaCandidates','[]'::jsonb,'moreAreaCandidates',false);END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(hit)),'[]') INTO hits FROM (
  SELECT d.city,d.city_search,d.state_code FROM explore_salon_documents d
  WHERE split_part(explore_normalize_address(d.address_line1),' ',1)=tokens[1]
   AND explore_unified_address_tokens(d.address_line1,d.address_line2,d.city,d.state_code,d.postal_code) @> tokens
   AND nullif(d.city_search,'') IS NOT NULL AND nullif(d.state_code,'') IS NOT NULL
   AND d.has_public_profile AND d.created_at<=now() AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now())
   AND salon_profile_public_salon_exists(d.salon_id)
  ORDER BY d.salon_id LIMIT 512
 ) hit;
 SELECT coalesce(jsonb_agg(jsonb_build_object('kind','city','city',city,'stateCode',state_code,'label',city||', '||state_code)
  ORDER BY (state_code=upper(btrim(coalesce(p_preferred_state,'')))) DESC,city_search,state_code),'[]') INTO areas
 FROM (SELECT min(value->>'city') city,value->>'city_search' city_search,value->>'state_code' state_code FROM jsonb_array_elements(hits) GROUP BY 2,3) unique_areas;
 more:=jsonb_array_length(areas)>result_limit OR jsonb_array_length(hits)=512;
 RETURN jsonb_build_object('version',1,'areaCandidates',(SELECT coalesce(jsonb_agg(value ORDER BY n),'[]') FROM jsonb_array_elements(areas) WITH ORDINALITY a(value,n) WHERE n<=result_limit),'moreAreaCandidates',more);
END $$;

-- These wrappers leave all pre-existing region kinds and old sessions unchanged.
ALTER FUNCTION public.explore_search_region_predicate(jsonb) RENAME TO _explore_search_region_predicate_before_address;
CREATE FUNCTION public.explore_search_region_predicate(p_region jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
BEGIN
 IF p_region->>'kind'='address' THEN RETURN format('coalesce((d.city_search=%L AND d.state_code=%L AND split_part(public.explore_normalize_address(d.address_line1),'' '',1)=%L AND public.explore_unified_address_tokens(d.address_line1,d.address_line2,d.city,d.state_code,d.postal_code) @> %L::text[]),false)',p_region->>'city',p_region->>'state',p_region->>'house',ARRAY(SELECT jsonb_array_elements_text(p_region->'tokens')));END IF;
 RETURN _explore_search_region_predicate_before_address(p_region);
END $$;
ALTER FUNCTION public.explore_search_region_contains(jsonb,public.explore_salon_documents) RENAME TO _explore_search_region_contains_before_address;
CREATE FUNCTION public.explore_search_region_contains(p_region jsonb,p_document public.explore_salon_documents) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
BEGIN
 IF p_region->>'kind'='address' THEN RETURN coalesce(p_document.city_search=p_region->>'city' AND p_document.state_code=p_region->>'state'
  AND split_part(explore_normalize_address(p_document.address_line1),' ',1)=p_region->>'house'
  AND explore_unified_address_tokens(p_document.address_line1,p_document.address_line2,p_document.city,p_document.state_code,p_document.postal_code) @> ARRAY(SELECT jsonb_array_elements_text(p_region->'tokens')),false);END IF;
 RETURN _explore_search_region_contains_before_address(p_region,p_document);
END $$;
CREATE FUNCTION public.explore_unified_address_region(p_location text,p_latitude float8,p_longitude float8) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE label text:=btrim(coalesce(p_location,''));lookup jsonb;area jsonb;key text;
BEGIN
 -- Postal codes are regions; only house-number-plus-street input enters this lookup.
 IF label ~* '^([0-9]+[a-z]?|[nsew][0-9]+[nsew][0-9]+)\s+\S' THEN
  lookup:=get_public_explore_address_area(label);
  IF jsonb_array_length(lookup->'areaCandidates')<>1 OR coalesce((lookup->>'moreAreaCandidates')::boolean,false) THEN RAISE EXCEPTION 'Choose a unique public address area' USING ERRCODE='22023';END IF;
  area:=lookup->'areaCandidates'->0;key:=explore_unified_address_query(label);
  RETURN jsonb_build_object('kind','address','city',normalize_search_text(area->>'city'),'state',area->>'stateCode','tokens',regexp_split_to_array(key,'\s+'),'house',split_part(key,' ',1),'scope','A','label',label,'cityLabel',area->>'label','latitude',p_latitude,'longitude',p_longitude);
 END IF;
 RETURN explore_search_region(label,p_latitude,p_longitude);
END $$;

ALTER TABLE public.explore_unified_salon_history ADD COLUMN profile_search_text text NOT NULL DEFAULT '',ADD COLUMN phone_search_digits text NOT NULL DEFAULT '',ADD COLUMN address_line1 text,ADD COLUMN address_line2 text,ADD COLUMN city text;
CREATE INDEX explore_unified_profile_terms_idx ON public.explore_unified_salon_history USING gin(profile_search_text extensions.gin_trgm_ops);
CREATE INDEX explore_unified_phone_terms_idx ON public.explore_unified_salon_history USING gin(phone_search_digits extensions.gin_trgm_ops);
CREATE INDEX explore_unified_address_tokens_idx ON public.explore_unified_salon_history USING gin(public.explore_unified_address_tokens(address_line1,address_line2,city,state_code,postal_code));
ALTER TABLE public.explore_search_sessions ADD COLUMN unified_address_priority_version integer NOT NULL DEFAULT 1;
CREATE FUNCTION public.explore_unified_profile_text(d public.explore_salon_documents) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(normalize_search_text(concat_ws(' ',d.search_document,d.description,d.phone,d.address_line1,d.address_line2,d.city,d.state,d.postal_code)),'')
$$;
CREATE OR REPLACE FUNCTION public.explore_unified_salon_fingerprint(d public.explore_salon_documents) RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT md5(jsonb_build_array(d.salon_name_search,d.service_search_text,d.service_category_search_text,d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,d.profile_completeness,d.created_at,d.public_discovery_published_at,d.starting_price,explore_unified_has_real_cover(d),explore_unified_profile_text(d),d.phone,d.address_line1,d.address_line2,d.city)::text)
$$;


CREATE OR REPLACE FUNCTION public.refresh_explore_unified_search(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE revision_value bigint;
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN;END IF;
 -- Only availability (not media URLs/revisions) affects reference ordering.
 -- Counters, ordinary logins and same-availability media edits take no clock lock.
 IF NOT EXISTS(SELECT 1 FROM explore_salon_documents d LEFT JOIN explore_unified_salon_history h ON h.salon_id=d.salon_id AND h.valid_to IS NULL WHERE d.salon_id=ANY(p_ids) AND (h.salon_id IS NULL OR h.fingerprint IS DISTINCT FROM explore_unified_salon_fingerprint(d)))
 AND NOT EXISTS(SELECT 1 FROM explore_unified_salon_history h WHERE h.salon_id=ANY(p_ids) AND h.valid_to IS NULL AND NOT EXISTS(SELECT 1 FROM explore_salon_documents d WHERE d.salon_id=h.salon_id))
 AND NOT EXISTS(SELECT 1 FROM explore_unified_content_source c LEFT JOIN explore_unified_content_history h ON h.content_key=c.content_key AND h.valid_to IS NULL WHERE c.salon_id=ANY(p_ids) AND (h.content_key IS NULL OR h.fingerprint IS DISTINCT FROM md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text)))
 AND NOT EXISTS(SELECT 1 FROM explore_unified_content_history h WHERE h.salon_id=ANY(p_ids) AND h.valid_to IS NULL AND NOT EXISTS(SELECT 1 FROM explore_unified_content_source c WHERE c.content_key=h.content_key AND c.salon_id=h.salon_id)) THEN RETURN;END IF;
 -- This lock orders commits, so a session sees one complete rank revision.
 UPDATE explore_unified_search_clock SET revision=revision+1 WHERE id RETURNING revision INTO revision_value;
 INSERT INTO explore_unified_salon_incarnations(salon_id) SELECT salon_id FROM explore_salon_documents WHERE salon_id=ANY(p_ids) ON CONFLICT DO NOTHING;
 UPDATE explore_unified_salon_history h SET valid_to=revision_value,retired_at=clock_timestamp()
 WHERE h.valid_to IS NULL AND h.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM explore_salon_documents d JOIN explore_unified_salon_incarnations i USING(salon_id)
  WHERE d.salon_id=h.salon_id AND i.source_token=h.source_token AND explore_unified_salon_fingerprint(d)=h.fingerprint);
 INSERT INTO explore_unified_salon_history
 SELECT d.salon_id,revision_value,NULL,NULL,i.source_token,explore_unified_salon_fingerprint(d),coalesce(d.salon_name_search,''),coalesce(d.service_search_text,''),coalesce(d.service_category_search_text,''),
 d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,coalesce(d.profile_completeness,0),d.created_at,d.public_discovery_published_at,d.starting_price,explore_unified_has_real_cover(d),explore_unified_profile_text(d),regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),d.address_line1,d.address_line2,d.city
 FROM explore_salon_documents d JOIN explore_unified_salon_incarnations i USING(salon_id)
 WHERE d.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM explore_unified_salon_history h WHERE h.salon_id=d.salon_id AND h.valid_to IS NULL);
 DELETE FROM explore_unified_content_incarnations i WHERE i.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM explore_unified_content_source c WHERE c.content_key=i.content_key AND c.salon_id=i.salon_id);
 INSERT INTO explore_unified_content_incarnations(content_key,salon_id) SELECT content_key,salon_id FROM explore_unified_content_source WHERE salon_id=ANY(p_ids) ON CONFLICT DO NOTHING;
 UPDATE explore_unified_content_history h SET valid_to=revision_value,retired_at=clock_timestamp()
 WHERE h.valid_to IS NULL AND h.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM explore_unified_content_source c JOIN explore_unified_content_incarnations i USING(content_key,salon_id)
  WHERE c.content_key=h.content_key AND i.source_token=h.source_token AND md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text)=h.fingerprint);
 INSERT INTO explore_unified_content_history
 SELECT c.content_key,revision_value,NULL,NULL,i.source_token,md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text),
 c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media
 FROM explore_unified_content_source c JOIN explore_unified_content_incarnations i USING(content_key,salon_id)
 WHERE c.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM explore_unified_content_history h WHERE h.content_key=c.content_key AND h.valid_to IS NULL);
END $$;

SELECT public.refresh_explore_unified_search(array_agg(salon_id)) FROM public.explore_salon_documents;

CREATE FUNCTION public.explore_unified_profile_match(profile text,phone text,query text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT explore_unified_all_tokens(profile,query) OR (query ~ '^[0-9 ()+.-]+$' AND length(regexp_replace(query,'[^0-9]','','g'))>=7 AND position(regexp_replace(query,'[^0-9]','','g') IN phone)>0)
$$;

CREATE OR REPLACE FUNCTION public.explore_unified_candidate_live(s public.explore_search_sessions,c public.explore_search_session_candidates,d public.explore_salon_documents) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE canon jsonb:=s.unified_canonical; terms tsquery:=plainto_tsquery('english',coalesce(canon->>'contentQuery',''));kind text:=c.match_type;has_facets boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM explore_unified_salon_incarnations i WHERE i.salon_id=d.salon_id AND i.source_token::text=c.unified_payload->>'sourceToken') THEN RETURN false;END IF;
 IF d.created_at>s.created_at OR d.public_discovery_published_at>s.created_at OR NOT coalesce(d.has_public_profile,false) OR NOT salon_profile_public_salon_exists(d.salon_id) THEN RETURN false;END IF;
 IF s.category_text<>'' AND coalesce(d.service_category_search_text,'') NOT LIKE '%'||s.category_text||'%' THEN RETURN false;END IF;
 IF (s.scope_policy='fixed' OR coalesce((canon->>'locationPriority')::boolean,false) OR coalesce((c.unified_payload->>'referencePhase')::int,0)>0) AND NOT explore_search_region_contains(c.eligibility_region,d) THEN RETURN false;END IF;
 IF kind='suggested' AND coalesce(s.unified_reference_category,'')<>'' AND coalesce(d.service_category_search_text,'') NOT LIKE '%'||s.unified_reference_category||'%' THEN RETURN false;END IF;
 IF NOT explore_unified_filter_salon(d,canon->'filters',s.user_id,s.created_at) THEN RETURN false;END IF;
 has_facets:=(canon->'filters') ?| ARRAY['shape','length','color','finish','tone','season'];
 IF has_facets AND kind<>'suggested' AND NOT EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.salon_id=d.salon_id AND p.valid_to IS NULL AND NOT p.is_reference AND p.search_terms@@CASE WHEN kind='related_post' THEN explore_unified_facet_terms(canon->'filters') ELSE terms END AND NOT social_users_blocked(s.user_id,p.author_user_id)) THEN RETURN false;END IF;
 IF kind IN ('exact_name','prefix_name','name_tokens') THEN RETURN explore_unified_all_tokens(d.salon_name_search,s.query_text);END IF;
 IF kind='fuzzy_name' THEN RETURN explore_unified_name_similarity(d.salon_name_search,s.query_text)>0;END IF;
 IF kind='profile' THEN RETURN explore_unified_profile_match(explore_unified_profile_text(d),regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),coalesce(canon->>'contentQuery',s.query_text));END IF;
 IF kind='service' THEN RETURN explore_unified_all_tokens(d.service_search_text,coalesce(canon->>'contentQuery',s.query_text));END IF;
 IF kind IN ('post','reference_post') THEN RETURN EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.content_key=c.unified_payload->>'matchContentKey' AND p.source_token::text=c.unified_payload->>'matchContentSourceToken' AND p.salon_id=d.salon_id AND p.valid_to IS NULL AND p.is_reference=(kind='reference_post') AND p.search_terms@@terms AND NOT social_users_blocked(s.user_id,p.author_user_id));END IF;
 IF kind='related_post' THEN RETURN EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.content_key=c.unified_payload->>'matchContentKey' AND p.source_token::text=c.unified_payload->>'matchContentSourceToken' AND p.salon_id=d.salon_id AND p.valid_to IS NULL AND NOT p.is_reference AND p.search_terms@@to_tsquery('english',replace(terms::text,' & ',' | ')) AND (NOT has_facets OR p.search_terms@@explore_unified_facet_terms(canon->'filters')) AND NOT social_users_blocked(s.user_id,p.author_user_id));END IF;
 RETURN kind IN ('nearby','suggested');
END $$;

-- Read only existing canonical trust aggregates. No inferred trust or booking scores.
CREATE FUNCTION public.explore_unified_configure_sorts(p_session uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s explore_search_sessions;g explore_search_rank_groups;sorts text[]:=ARRAY['relevance','newest'];why text;covered boolean;stale boolean;known boolean;
BEGIN
 SELECT * INTO STRICT s FROM explore_search_sessions WHERE id=p_session;
 IF s.rank_origin_latitude IS NOT NULL THEN sorts:=sorts||ARRAY['closest'];END IF;
 known:=s.category_text=ANY(ARRAY['','nails','hair','lashes','barber','spa','brows','makeup','skin','skincare','massage','waxing','tattoo']);
 SELECT * INTO g FROM explore_search_rank_groups WHERE group_key=explore_rank_scope_key('{"kind":"global"}',s.category_text);
 covered:=g.group_id IS NOT NULL AND g.ready_count=g.total_count;
 SELECT EXISTS(SELECT 1 FROM explore_search_rank_history h WHERE h.group_id=g.group_id AND h.valid_to IS NULL AND h.refresh_after<=now()) INTO stale;
 IF s.query_text='' AND coalesce(s.unified_canonical->>'contentQuery','')='' AND known AND covered AND NOT stale THEN sorts:=sorts||ARRAY['trusted','bookable'];END IF;
 IF NOT(s.requested_sort=ANY(sorts)) THEN why:=CASE WHEN s.requested_sort='closest' THEN 'location_required' WHEN s.query_text<>'' OR coalesce(s.unified_canonical->>'contentQuery','')<>'' THEN 'keyword_ranking_not_supported' WHEN NOT known THEN 'category_ranking_not_supported' WHEN NOT covered THEN 'ranking_warming' WHEN stale THEN 'ranking_stale' END;END IF;
 UPDATE explore_search_sessions SET supported_sorts=sorts,applied_sort=CASE WHEN requested_sort=ANY(sorts) THEN requested_sort ELSE 'relevance' END,sort_fallback_reason=why,
  rank_version=CASE WHEN requested_sort=ANY(ARRAY['trusted','bookable']) AND requested_sort=ANY(sorts) THEN (SELECT revision FROM explore_search_rank_clock WHERE singleton) END,
  rank_as_of=CASE WHEN requested_sort=ANY(ARRAY['trusted','bookable']) AND requested_sort=ANY(sorts) THEN (SELECT as_of FROM explore_search_rank_clock WHERE singleton) END WHERE id=p_session;
END $$;
ALTER FUNCTION public.explore_unified_pull_batch(uuid) RENAME TO _explore_unified_pull_before_address;

CREATE FUNCTION public.explore_unified_pull_batch(p_session uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit=off AS $$
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
 SELECT '%'||token||'%' INTO service_fragment FROM unnest(regexp_split_to_array(coalesce(canon->>'contentQuery',''),'\s+')) token ORDER BY length(token) DESC LIMIT 1;
 EXECUTE format($sql$
 WITH salon_distances AS MATERIALIZED (
  SELECT h.salon_id,CASE WHEN h.latitude BETWEEN -90 AND 90 AND h.longitude BETWEEN -180 AND 180 THEN extensions.earth_distance(extensions.ll_to_earth($7,$8),extensions.ll_to_earth(h.latitude,h.longitude)) END AS distance_meters
  FROM explore_unified_salon_history h WHERE $7 IS NOT NULL AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1)
 ), name_matches AS MATERIALIZED (
  SELECT h.salon_id,CASE WHEN h.salon_name_search=$3 AND d.salon_name_search=$3 THEN 0 WHEN h.salon_name_search LIKE $3||'%%' AND d.salon_name_search LIKE $3||'%%' THEN 1
   WHEN explore_unified_all_tokens(h.salon_name_search,$3) AND explore_unified_all_tokens(d.salon_name_search,$3) THEN 2 ELSE 3 END AS tier
  FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
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
  SELECT h.*,coalesce(m.content_key,rel.content_key) AS content_key,coalesce(m.content_source_token,rel.content_source_token) AS content_source_token,coalesce(m.source_type,rel.source_type) AS source_type,m.is_reference,coalesce(m.content_score,rel.content_score) AS content_score,
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
  JOIN explore_unified_salon_incarnations incarnation ON incarnation.salon_id=h.salon_id AND incarnation.source_token=h.source_token
  LEFT JOIN content_matches m ON m.salon_id=h.salon_id
  LEFT JOIN related_matches rel ON rel.salon_id=h.salon_id
  LEFT JOIN name_matches n ON n.salon_id=h.salon_id
  LEFT JOIN service_matches v ON v.salon_id=h.salon_id
  LEFT JOIN profile_matches profile_match ON profile_match.salon_id=h.salon_id
  LEFT JOIN LATERAL(SELECT r.trust_score,r.bookable FROM explore_search_rank_history r JOIN explore_search_rank_groups g ON g.group_id=r.group_id
   WHERE $21 IS NOT NULL AND r.salon_id=h.salon_id AND g.group_key=explore_rank_scope_key('{"kind":"global"}',$13) AND r.valid_from<=$21 AND (r.valid_to IS NULL OR r.valid_to>$21) LIMIT 1) rank ON true
  LEFT JOIN real_media_salons photo ON photo.salon_id=h.salon_id
  LEFT JOIN salon_distances geo ON geo.salon_id=h.salon_id
  WHERE h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1) AND h.created_at<=$2 AND (h.public_discovery_published_at IS NULL OR h.public_discovery_published_at<=$2)
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
   SELECT '%'||token||'%' INTO service_fragment FROM unnest(regexp_split_to_array(cq,'\s+')) token ORDER BY length(token) DESC LIMIT 1;
   SELECT h.service_category_search_text INTO reference_category FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
   WHERE h.valid_from<=s.unified_revision AND (h.valid_to IS NULL OR h.valid_to>s.unified_revision) AND h.service_category_search_text<>''
    AND d.has_public_profile AND h.created_at<=s.created_at AND (h.public_discovery_published_at IS NULL OR h.public_discovery_published_at<=s.created_at)
    AND ((h.salon_name_search LIKE name_fragment AND explore_unified_all_tokens(h.salon_name_search,q) AND explore_unified_all_tokens(d.salon_name_search,q))
     OR (kind='name' AND h.salon_name_search OPERATOR(extensions.%) q AND explore_unified_name_similarity(h.salon_name_search,q)>0 AND explore_unified_name_similarity(d.salon_name_search,q)>0)
     OR (kind='service' AND h.service_search_text LIKE service_fragment AND explore_unified_all_tokens(h.service_search_text,cq) AND explore_unified_all_tokens(d.service_search_text,cq)))
    AND salon_profile_public_salon_exists(d.salon_id)
   ORDER BY CASE WHEN h.salon_name_search=q THEN 0 WHEN h.salon_name_search LIKE q||'%' THEN 1 WHEN explore_unified_all_tokens(h.salon_name_search,q) THEN 2 ELSE 3 END,h.salon_id LIMIT 1;
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

-- Preserve the prior public/private execution boundary for helpers and RPCs.
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND
  (proname LIKE 'explore_unified_%' OR proname IN ('explore_normalize_address','refresh_explore_unified_search','_explore_unified_pull_before_address','_explore_search_region_predicate_before_address','_explore_search_region_contains_before_address','explore_search_region_predicate','explore_search_region_contains')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_address_area(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_address_area(text,text,integer) TO anon,authenticated,service_role;
ANALYZE public.explore_unified_salon_history;
NOTIFY pgrst,'reload schema';
COMMIT;
