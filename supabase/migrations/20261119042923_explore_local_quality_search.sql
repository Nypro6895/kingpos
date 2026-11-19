-- Indexed relevance, newest and Closest lanes. Existing v3 cursors and ready
-- canonical Trust/Bookable sorts keep their shipped path. Source tables,
-- public permission checks and media remain canonical.
BEGIN;
SET LOCAL search_path=public,extensions;
-- Fail quickly if a live transaction owns a required DDL lock. Preparation is
-- a separate foreground phase; no canonical lock spans the directory backfill.
SET LOCAL lock_timeout='1s';

CREATE TABLE public.explore_local_quality_preparation(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false,scan_after uuid,
 scan_complete boolean NOT NULL DEFAULT false,activated_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.explore_local_quality_preparation(singleton) VALUES(true);
-- No foreign key: deleted salons must remain queued until their staged row is
-- removed. A fresh generation makes the preparation CAS safe against edits.
CREATE TABLE public.explore_local_quality_dirty(
 salon_id uuid PRIMARY KEY,generation uuid NOT NULL DEFAULT gen_random_uuid()
);
CREATE FUNCTION public.explore_local_quality_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT enabled FROM explore_local_quality_preparation WHERE singleton
$$;

CREATE FUNCTION public.explore_local_words(value text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(array_agg(DISTINCT word ORDER BY word),'{}') FROM unnest(regexp_split_to_array(coalesce(normalize_search_text(value),''),'\s+')) word WHERE word<>''
$$;
CREATE FUNCTION public.explore_local_stems(value text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT tsvector_to_array(to_tsvector('english',coalesce(value,'')))
$$;
-- A pair within the shipped one-edit token rule shares a full/one-deletion
-- signature, including adjacent transpositions. Keep generic words too: Naiks
-- may validly match Nails. Alphabetic query keys cannot match numeric-only
-- signatures; excluding those avoids indexing directory fixture numbers.
CREATE FUNCTION public.explore_local_name_signatures(value text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT ARRAY(SELECT DISTINCT signature FROM (
  SELECT CASE WHEN removed=0 THEN word ELSE left(word,removed-1)||substr(word,removed+1) END signature
  FROM unnest(regexp_split_to_array(coalesce(value,''),'\s+')) word
  CROSS JOIN LATERAL generate_series(0,length(word)) removed
  WHERE length(word) BETWEEN 3 AND 81
 ) candidates WHERE signature ~ '^[a-z]{2,80}$' ORDER BY signature)
$$;
-- Keep the original full-name trigram predicate inside procedural proof so it
-- cannot become the broad GIN driver ahead of the necessary signature probe.
CREATE FUNCTION public.explore_local_fuzzy_match(name text,query text) RETURNS boolean LANGUAGE plpgsql STABLE STRICT SET search_path=public,extensions AS $$
BEGIN
 IF NOT(name OPERATOR(extensions.%) query) THEN RETURN false;END IF;
 RETURN explore_unified_name_similarity(name,query)>0;
END $$;
CREATE FUNCTION public.explore_local_profile_terms(d public.explore_salon_documents) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT ARRAY(SELECT DISTINCT term FROM (
  SELECT unnest(explore_local_stems(explore_unified_profile_text(d))) AS term
  UNION ALL
  SELECT substr(digits,start_at,width) FROM (SELECT left(regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'),20) digits) phone
   CROSS JOIN LATERAL generate_series(7,length(digits)) width CROSS JOIN LATERAL generate_series(1,length(digits)-width+1) start_at
 ) tokens ORDER BY term)
$$;
CREATE FUNCTION public.explore_local_profile_match(d public.explore_salon_documents,query text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN query ~ '^[0-9 ()+.-]+$' AND length(regexp_replace(query,'[^0-9]','','g'))>=7
 THEN position(regexp_replace(query,'[^0-9]','','g') IN regexp_replace(coalesce(d.phone,''),'[^0-9]','','g'))>0
 ELSE explore_local_profile_terms(d) @> explore_local_stems(query) END
$$;

-- One narrow history row per changed salon, not one copy of its posts. Current
-- source tokens and original history revisions remain the identity authority.
CREATE TABLE public.explore_local_quality_documents(
 salon_id uuid NOT NULL,valid_from bigint NOT NULL,valid_to bigint,retired_at timestamptz,
 source_token uuid NOT NULL,fingerprint text NOT NULL,name_text text NOT NULL,
 service_terms text[] NOT NULL,profile_terms text[] NOT NULL,post_terms text[] NOT NULL,categories text[] NOT NULL,
 state_code text,city_search text,postal_code text,point extensions.earth,
 quality integer NOT NULL,latest_post float8 NOT NULL,activity_count integer NOT NULL,created_order float8 NOT NULL,geo_cell integer,
 quality_order float8 GENERATED ALWAYS AS(-quality::float8) STORED,post_order float8 GENERATED ALWAYS AS(-latest_post) STORED,
 PRIMARY KEY(salon_id,valid_from)
);
CREATE UNIQUE INDEX explore_local_quality_current ON public.explore_local_quality_documents(salon_id) WHERE valid_to IS NULL;

-- A token has a single posting per salon/lane/revision. All posts for a salon
-- share this small union; exact SAME-post and viewer/block proof is applied
-- before the lane LIMIT. Category-qualified probes avoid scanning other trades.
CREATE TABLE public.explore_local_quality_postings(
 salon_id uuid NOT NULL,valid_from bigint NOT NULL,valid_to bigint,
 lane smallint NOT NULL,probe text NOT NULL,state_code text,city_search text,postal_code text,
 quality integer NOT NULL,latest_post float8 NOT NULL,created_order float8 NOT NULL,geo_cell integer,
 quality_order float8 GENERATED ALWAYS AS(-quality::float8) STORED,post_order float8 GENERATED ALWAYS AS(-latest_post) STORED,
 PRIMARY KEY(salon_id,valid_from,lane,probe),
 FOREIGN KEY(salon_id,valid_from) REFERENCES public.explore_local_quality_documents(salon_id,valid_from) ON DELETE CASCADE
);

CREATE VIEW public.explore_local_quality_source WITH(security_invoker=true) AS
 SELECT h.salon_id,i.source_token,h.salon_name_search AS name_text,
 explore_local_stems(h.service_search_text) AS service_terms,
 explore_local_profile_terms(d) AS profile_terms,
 coalesce(posts.terms,'{}') AS post_terms,
 ARRAY(SELECT DISTINCT normalize_search_text(c) FROM unnest(coalesce(d.service_categories,'{}')) c WHERE nullif(normalize_search_text(c),'') IS NOT NULL) AS categories,
 h.state_code,h.city_search,left(coalesce(h.postal_code,''),5) AS postal_code,
 CASE WHEN h.latitude BETWEEN -90 AND 90 AND h.longitude BETWEEN -180 AND 180 THEN extensions.ll_to_earth(h.latitude,h.longitude) END AS point,
 greatest(0,least(100,coalesce(h.profile_completeness,0)))+2*coalesce(activity.n,0) AS quality,
 coalesce(activity.latest,0)::float8 AS latest_post,coalesce(activity.n,0) AS activity_count,-extract(epoch FROM h.created_at)::float8 AS created_order,
 CASE WHEN h.latitude BETWEEN -90 AND 90 AND h.longitude BETWEEN -180 AND 180 THEN least(719,greatest(0,floor((h.latitude+90)*4)::int))*1440+least(1439,greatest(0,floor((h.longitude+180)*4)::int)) END AS geo_cell
 FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
 JOIN explore_unified_salon_incarnations i ON i.salon_id=h.salon_id AND i.source_token=h.source_token
 LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT term ORDER BY term) AS terms FROM explore_unified_content_history p
  CROSS JOIN LATERAL unnest(tsvector_to_array(p.search_terms)) term
  WHERE p.salon_id=h.salon_id AND p.valid_to IS NULL AND NOT p.is_reference
 ) posts ON true
 LEFT JOIN LATERAL (
  SELECT count(*)::int n,max(extract(epoch FROM published_at)) AS latest FROM (
   SELECT p.published_at FROM explore_unified_content_history p
   WHERE p.salon_id=h.salon_id AND p.valid_to IS NULL AND NOT p.is_reference AND p.published_at<=now()
   ORDER BY p.published_at DESC,p.content_key LIMIT 5
  ) recent
 ) activity ON true
 WHERE h.valid_to IS NULL AND d.has_public_profile;

CREATE FUNCTION public.refresh_explore_local_quality(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE rev bigint;target uuid;src record;fp text;
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN;END IF;
 SELECT revision INTO rev FROM explore_unified_search_clock WHERE id;
 FOR target IN SELECT DISTINCT unnest(p_ids) LOOP
  SELECT * INTO src FROM explore_local_quality_source WHERE salon_id=target;
  IF FOUND THEN fp:=md5(to_jsonb(src)::text);ELSE fp:=NULL;END IF;
  IF EXISTS(SELECT 1 FROM explore_local_quality_documents WHERE salon_id=target AND valid_to IS NULL AND fingerprint=fp) THEN CONTINUE;END IF;
  -- Multiple canonical changes may share one revision/transaction. Replace only
  -- that unpublished same-revision row; retain every earlier session snapshot.
  DELETE FROM explore_local_quality_documents WHERE salon_id=target AND valid_from=rev;
  UPDATE explore_local_quality_documents SET valid_to=rev,retired_at=now() WHERE salon_id=target AND valid_to IS NULL;
  UPDATE explore_local_quality_postings SET valid_to=rev WHERE salon_id=target AND valid_to IS NULL;
  IF fp IS NULL THEN CONTINUE;END IF;
  INSERT INTO explore_local_quality_documents VALUES(src.salon_id,rev,NULL,NULL,src.source_token,fp,src.name_text,src.service_terms,src.profile_terms,src.post_terms,src.categories,src.state_code,src.city_search,src.postal_code,src.point,src.quality,src.latest_post,src.activity_count,src.created_order,src.geo_cell);
  INSERT INTO explore_local_quality_postings
  SELECT src.salon_id,rev,NULL,l.lane,category||E'\x1f'||token,src.state_code,src.city_search,src.postal_code,src.quality,src.latest_post,src.created_order,src.geo_cell
  FROM (VALUES(0::smallint,ARRAY['']::text[]),(2::smallint,src.service_terms),(3::smallint,src.post_terms)) l(lane,terms)
  CROSS JOIN LATERAL unnest(l.terms) token CROSS JOIN LATERAL unnest(ARRAY['']||src.categories) category
  ON CONFLICT DO NOTHING;
 END LOOP;
END $$;

CREATE FUNCTION public.explore_local_quality_sync_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[];
BEGIN
 -- Retired-history garbage collection does not change the current source and
 -- must neither aggregate unchanged salons nor enqueue unclocked dirty work.
 IF TG_OP='DELETE' THEN SELECT array_agg(DISTINCT salon_id) INTO ids FROM old_rows WHERE valid_to IS NULL;
 ELSIF TG_OP='INSERT' THEN SELECT array_agg(DISTINCT salon_id) INTO ids FROM new_rows WHERE valid_to IS NULL;
 ELSE SELECT array_agg(DISTINCT salon_id) INTO ids FROM (SELECT salon_id FROM old_rows WHERE valid_to IS NULL UNION SELECT salon_id FROM new_rows WHERE valid_to IS NULL) affected;END IF;
 IF coalesce(cardinality(ids),0)=0 THEN RETURN NULL;END IF;
 IF explore_local_quality_ready() THEN
  PERFORM refresh_explore_local_quality(ids);
 ELSE
  INSERT INTO explore_local_quality_dirty(salon_id,generation)
  SELECT target,gen_random_uuid() FROM unnest(coalesce(ids,'{}')) target
  ON CONFLICT(salon_id) DO UPDATE SET generation=excluded.generation;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER explore_local_quality_salon_insert AFTER INSERT ON public.explore_unified_salon_history REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_local_quality_sync_trigger();
CREATE TRIGGER explore_local_quality_salon_update AFTER UPDATE ON public.explore_unified_salon_history REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_local_quality_sync_trigger();
CREATE TRIGGER explore_local_quality_salon_delete AFTER DELETE ON public.explore_unified_salon_history REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_local_quality_sync_trigger();
CREATE TRIGGER explore_local_quality_content_insert AFTER INSERT ON public.explore_unified_content_history REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_local_quality_sync_trigger();
CREATE TRIGGER explore_local_quality_content_update AFTER UPDATE ON public.explore_unified_content_history REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_local_quality_sync_trigger();
CREATE TRIGGER explore_local_quality_content_delete AFTER DELETE ON public.explore_unified_content_history REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_local_quality_sync_trigger();

-- Build the empty derivative indexes now. The following migration exposes
-- bounded, resumable preparation RPCs; requests keep the shipped path while OFF.
CREATE INDEX explore_local_quality_name ON public.explore_local_quality_documents(name_text text_pattern_ops,salon_id);
CREATE INDEX explore_local_quality_name_trgm ON public.explore_local_quality_documents USING gin(name_text extensions.gin_trgm_ops);
CREATE INDEX explore_local_quality_name_signatures ON public.explore_local_quality_documents USING gin(public.explore_local_name_signatures(name_text));
CREATE INDEX explore_local_quality_name_compact ON public.explore_local_quality_documents((replace(name_text,' ','')) text_pattern_ops,salon_id);
CREATE INDEX explore_local_quality_point ON public.explore_local_quality_documents USING gist(point);
CREATE INDEX explore_local_quality_retired ON public.explore_local_quality_documents(retired_at) WHERE retired_at IS NOT NULL;
CREATE INDEX explore_local_name_quality_global ON public.explore_local_quality_documents(quality_order,post_order,salon_id);
CREATE INDEX explore_local_name_quality_state ON public.explore_local_quality_documents(state_code,quality_order,post_order,salon_id);
CREATE INDEX explore_local_name_quality_city ON public.explore_local_quality_documents(state_code,city_search,quality_order,post_order,salon_id);
CREATE INDEX explore_local_name_quality_city_any_state ON public.explore_local_quality_documents(city_search,quality_order,post_order,salon_id);
CREATE INDEX explore_local_name_quality_zip ON public.explore_local_quality_documents(postal_code,quality_order,post_order,salon_id);
CREATE INDEX explore_local_lane_global ON public.explore_local_quality_postings(lane,probe,quality_order,post_order,salon_id);
CREATE INDEX explore_local_lane_state ON public.explore_local_quality_postings(lane,probe,state_code,quality_order,post_order,salon_id);
CREATE INDEX explore_local_lane_city ON public.explore_local_quality_postings(lane,probe,state_code,city_search,quality_order,post_order,salon_id);
CREATE INDEX explore_local_lane_city_any_state ON public.explore_local_quality_postings(lane,probe,city_search,quality_order,post_order,salon_id);
CREATE INDEX explore_local_lane_zip ON public.explore_local_quality_postings(lane,probe,postal_code,quality_order,post_order,salon_id);
CREATE INDEX explore_local_profile_terms ON public.explore_local_quality_documents USING gin(profile_terms);
CREATE INDEX explore_local_service_terms ON public.explore_local_quality_documents USING gin(service_terms);
CREATE INDEX explore_local_post_terms ON public.explore_local_quality_documents USING gin(post_terms);
CREATE INDEX explore_local_newest_global ON public.explore_local_quality_documents(created_order,quality_order,post_order,salon_id);
CREATE INDEX explore_local_newest_state ON public.explore_local_quality_documents(state_code,created_order,quality_order,post_order,salon_id);
CREATE INDEX explore_local_newest_city ON public.explore_local_quality_documents(state_code,city_search,created_order,quality_order,post_order,salon_id);
CREATE INDEX explore_local_newest_city_any_state ON public.explore_local_quality_documents(city_search,created_order,quality_order,post_order,salon_id);
CREATE INDEX explore_local_newest_zip ON public.explore_local_quality_documents(postal_code,created_order,quality_order,post_order,salon_id);
-- Only the small browse lane needs category-qualified newest postings; do not
-- duplicate a second set of regional indexes for every service/content token.
CREATE INDEX explore_local_browse_newest_global ON public.explore_local_quality_postings(probe,created_order,quality_order,post_order,salon_id) WHERE lane=0;
CREATE INDEX explore_local_browse_newest_state ON public.explore_local_quality_postings(probe,state_code,created_order,quality_order,post_order,salon_id) WHERE lane=0;
CREATE INDEX explore_local_browse_newest_city ON public.explore_local_quality_postings(probe,state_code,city_search,created_order,quality_order,post_order,salon_id) WHERE lane=0;
CREATE INDEX explore_local_browse_newest_city_any_state ON public.explore_local_quality_postings(probe,city_search,created_order,quality_order,post_order,salon_id) WHERE lane=0;
CREATE INDEX explore_local_browse_newest_zip ON public.explore_local_quality_postings(probe,postal_code,created_order,quality_order,post_order,salon_id) WHERE lane=0;
CREATE INDEX explore_local_lane_cell ON public.explore_local_quality_postings(lane,probe,geo_cell,quality_order,post_order,salon_id) WHERE geo_cell IS NOT NULL;
CREATE INDEX explore_local_doc_cell ON public.explore_local_quality_documents(geo_cell,quality_order,post_order,salon_id) WHERE geo_cell IS NOT NULL;
CREATE INDEX explore_local_doc_cell_newest ON public.explore_local_quality_documents(geo_cell,created_order,quality_order,post_order,salon_id) WHERE geo_cell IS NOT NULL;
CREATE INDEX explore_local_browse_cell_newest ON public.explore_local_quality_postings(probe,geo_cell,created_order,quality_order,post_order,salon_id) WHERE lane=0 AND geo_cell IS NOT NULL;
CREATE INDEX explore_local_unknown_quality_global ON public.explore_local_quality_documents(quality_order,post_order,salon_id) WHERE point IS NULL;
CREATE INDEX explore_local_unknown_quality_state ON public.explore_local_quality_documents(state_code,quality_order,post_order,salon_id) WHERE point IS NULL;
CREATE INDEX explore_local_unknown_quality_city ON public.explore_local_quality_documents(state_code,city_search,quality_order,post_order,salon_id) WHERE point IS NULL;
CREATE INDEX explore_local_unknown_quality_city_any_state ON public.explore_local_quality_documents(city_search,quality_order,post_order,salon_id) WHERE point IS NULL;
CREATE INDEX explore_local_unknown_quality_zip ON public.explore_local_quality_documents(postal_code,quality_order,post_order,salon_id) WHERE point IS NULL;

ALTER TABLE public.explore_search_sessions ADD COLUMN local_quality_version integer NOT NULL DEFAULT 0,ADD COLUMN local_quality_fuzzy boolean;
CREATE FUNCTION public.explore_local_quality_session_trigger() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.unified_canonical IS NOT NULL AND explore_local_quality_ready() THEN NEW.local_quality_version:=1;END IF;RETURN NEW;END $$;
CREATE TRIGGER explore_local_quality_session BEFORE INSERT ON public.explore_search_sessions FOR EACH ROW EXECUTE FUNCTION public.explore_local_quality_session_trigger();

-- Keep the shipped current-source, incarnation, visibility, moderation, facet,
-- delivered-session and blocking checks. Tighten only new-session word proof.
ALTER FUNCTION public.explore_unified_candidate_live(public.explore_search_sessions,public.explore_search_session_candidates,public.explore_salon_documents) RENAME TO _explore_candidate_live_before_local_quality;
CREATE FUNCTION public.explore_unified_candidate_live(s public.explore_search_sessions,c public.explore_search_session_candidates,d public.explore_salon_documents) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE canon jsonb:=s.unified_canonical;terms tsquery:=plainto_tsquery('english',coalesce(canon->>'contentQuery',''));
BEGIN
 IF s.local_quality_version<>1 THEN RETURN _explore_candidate_live_before_local_quality(s,c,d);END IF;
 IF NOT EXISTS(SELECT 1 FROM explore_unified_salon_incarnations i WHERE i.salon_id=d.salon_id AND i.source_token::text=c.unified_payload->>'sourceToken') THEN RETURN false;END IF;
 IF d.created_at>s.created_at OR d.public_discovery_published_at>s.created_at OR NOT coalesce(d.has_public_profile,false) OR NOT salon_profile_public_salon_exists(d.salon_id) THEN RETURN false;END IF;
 IF s.category_text<>'' AND coalesce(d.service_category_search_text,'') NOT LIKE '%'||s.category_text||'%' THEN RETURN false;END IF;
 IF NOT explore_search_region_contains(c.eligibility_region,d) THEN RETURN false;END IF;
 IF NOT explore_unified_filter_salon(d,canon->'filters',s.user_id,s.created_at) THEN RETURN false;END IF;
 IF (canon->>'queryKind'='style' AND c.match_type<>'exact_name' OR (canon->'filters') ?| ARRAY['shape','length','color','finish','tone','season']) AND c.match_type<>'suggested' AND NOT EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.salon_id=d.salon_id AND p.valid_to IS NULL AND NOT p.is_reference AND p.published_at<=s.created_at AND p.search_terms@@CASE WHEN c.match_type='related_post' THEN explore_unified_facet_terms(canon->'filters') ELSE terms END AND NOT social_users_blocked(s.user_id,p.author_user_id)) THEN RETURN false;END IF;
 IF c.match_type IN ('exact_name','name_tokens') THEN RETURN explore_local_words(d.salon_name_search) @> explore_local_words(s.query_text);END IF;
 IF c.match_type='prefix_name' THEN RETURN CASE WHEN canon->>'queryKind'='name' THEN d.salon_name_search LIKE s.query_text||'%' ELSE explore_local_words(d.salon_name_search) @> explore_local_words(s.query_text) END;END IF;
 IF c.match_type='service' THEN RETURN explore_local_stems(d.service_search_text) @> explore_local_stems(coalesce(s.unified_canonical->>'contentQuery',s.query_text));END IF;
 IF c.match_type='profile' THEN RETURN explore_local_profile_match(d,coalesce(canon->>'contentQuery',s.query_text));END IF;
 IF c.match_type='fuzzy_name' THEN RETURN explore_unified_name_similarity(d.salon_name_search,s.query_text)>0;END IF;
 IF c.match_type IN ('post','reference_post','related_post') THEN RETURN EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.content_key=c.unified_payload->>'matchContentKey' AND p.source_token::text=c.unified_payload->>'matchContentSourceToken' AND p.salon_id=d.salon_id AND p.valid_to IS NULL AND p.is_reference=(c.match_type='reference_post') AND p.published_at<=s.created_at AND p.search_terms@@CASE WHEN c.match_type='related_post' THEN to_tsquery('english',replace(terms::text,' & ',' | ')) ELSE terms END AND NOT social_users_blocked(s.user_id,p.author_user_id));END IF;
 RETURN c.match_type IN ('nearby','suggested');
END $$;

ALTER FUNCTION public.explore_unified_pull_batch(uuid) RENAME TO _explore_pull_before_local_quality;
CREATE FUNCTION public.explore_local_has_post(revision bigint,at_time timestamptz,actor uuid,query text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE found_post boolean;BEGIN
 EXECUTE $probe$ SELECT EXISTS(
  SELECT 1 FROM explore_unified_content_history p
  JOIN LATERAL(SELECT current.* FROM explore_unified_content_history current
   WHERE current.content_key=p.content_key AND current.valid_to IS NULL OFFSET 0) live ON true
  WHERE p.valid_from<=$1 AND (p.valid_to IS NULL OR p.valid_to>$1) AND NOT p.is_reference AND p.published_at<=$2 AND live.published_at<=$2
   AND live.source_token=p.source_token AND live.salon_id=p.salon_id AND NOT live.is_reference
   AND p.search_terms@@plainto_tsquery('english',$4) AND live.search_terms@@plainto_tsquery('english',$4) AND NOT social_users_blocked($3,live.author_user_id) LIMIT 1
 ) $probe$ INTO found_post USING revision,at_time,actor,query;
 RETURN found_post;
END $$;
-- Merge complete lane results incrementally. Retaining the strongest64 unique
-- salons after every merge is exact and bounds memory across geographic cells.
CREATE FUNCTION public.explore_local_top_rows(p_rows jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(value ORDER BY key,id),'[]') FROM (
  SELECT value,ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(value->'order_key') x) key,(value->>'salon_id')::uuid id
  FROM (
   SELECT DISTINCT ON(value->>'salon_id') value FROM jsonb_array_elements(p_rows) value
   ORDER BY value->>'salon_id',ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(value->'order_key') x)
  ) unique_salons ORDER BY key,id LIMIT 64
 ) strongest
$$;
CREATE FUNCTION public.explore_unified_pull_batch(p_session uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit=off AS $$
DECLARE s explore_search_sessions;canon jsonb;region jsonb;scope_index integer;lane integer;tier integer;phase integer;area integer;added integer:=0;
 q text;cq text;kind text;terms text[];lane_terms text[];name_terms text[];probe text;cat text;predicate text;name_predicate text;match_type text;match_source text;content_proof text;source_join text;query_sql text;batch jsonb;r jsonb;all_rows jsonb:='[]';anchor float8[];anchor_id uuid;order_prefix float8[];label text;gps boolean;name_found boolean:=false;order_fields text;order_alias text;anchor_sql text;key_expression text;distance_expression text;prefix_length integer;cells integer[];cell integer;cell_sql text;latitude_delta float8;longitude_delta float8;point_group integer;point_sql text;scan_prefix text;scan_suffix text;limit_clause text;known_full boolean;group_anchor_sql text;possible boolean:=false;post_possible boolean;profile_needle text[];eligible_probe_sql text;eligible_probe_batch jsonb;nearest_source text;knn_chunk_sql text;raw_cursor float8;raw_chunk integer;raw_count integer;chunk_payload jsonb;lane_candidates jsonb;fuzzy_needle text;fuzzy_keys text[];fuzzy_condition text;
BEGIN
 SELECT * INTO STRICT s FROM explore_search_sessions WHERE id=p_session FOR UPDATE;
 IF s.local_quality_version<>1 THEN RETURN _explore_pull_before_local_quality(p_session);END IF;
 IF s.applied_sort IN ('trusted','bookable') THEN RETURN _explore_pull_before_local_quality(p_session);END IF;
 IF s.exhausted THEN RETURN 0;END IF;
 canon:=s.unified_canonical;q:=s.query_text;cq:=coalesce(canon->>'contentQuery','');kind:=canon->>'queryKind';cat:=s.category_text;
 terms:=explore_local_stems(cq);name_terms:=explore_local_words(q);
 SELECT token INTO fuzzy_needle FROM unnest(name_terms) token WHERE token ~ '^[a-z]{3,80}$' AND NOT(token=ANY(ARRAY['nail','nails','salon','salons','spa','spas','beauty','studio','studios','hair','haircut','haircuts','lash','lashes','brow','brows','barber','barbers','massage','massages','and','the','llc','inc'])) ORDER BY length(token) DESC,token LIMIT 1;
 fuzzy_keys:=explore_local_name_signatures(fuzzy_needle);
 fuzzy_condition:=CASE WHEN cardinality(fuzzy_keys)>0 THEN format('(replace(h.name_text,'' '','''') LIKE %L OR explore_local_name_signatures(h.name_text) && %L::text[])',fuzzy_needle||'%',fuzzy_keys::text) ELSE format('h.name_text OPERATOR(extensions.%%) %L',q) END;
 IF s.unified_anchor IS NOT NULL THEN SELECT array_agg(x::float8 ORDER BY n) INTO anchor FROM jsonb_array_elements_text(s.unified_anchor->'key') WITH ORDINALITY a(x,n);anchor_id:=(s.unified_anchor->>'id')::uuid;END IF;
 UPDATE explore_search_sessions SET ranking_basis='local_quality_indexed_lanes' WHERE id=s.id;
 IF s.unified_anchor IS NULL AND (q<>'' OR cq<>'') THEN
  -- A conservative indexed global no-hit guard avoids hundreds of tiny cell
  -- probes for an absent word. Positive evidence still passes every regional,
  -- current-source and public proof below; no category-only filler is invented.
  IF q<>'' THEN
   IF kind='style' THEN
    EXECUTE 'WITH probe AS MATERIALIZED(SELECT 1 FROM explore_local_quality_documents WHERE name_text=$1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)) SELECT EXISTS(SELECT 1 FROM probe)' INTO possible USING q,s.unified_revision;
   ELSE
    EXECUTE 'WITH probe AS MATERIALIZED(SELECT 1 FROM explore_local_quality_documents WHERE name_text LIKE $1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)) SELECT EXISTS(SELECT 1 FROM probe)' INTO possible USING CASE WHEN length(replace(q,' ',''))<3 THEN q||'%' ELSE '%'||explore_unified_selective_token(q)||'%' END,s.unified_revision;
    IF NOT possible AND kind='name' AND length(replace(q,' ',''))>=4 THEN
     EXECUTE format('WITH probe AS MATERIALIZED(SELECT 1 FROM explore_local_quality_documents WHERE %s AND explore_local_fuzzy_match(name_text,$1) AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)) SELECT EXISTS(SELECT 1 FROM probe)',replace(fuzzy_condition,'h.','')) INTO possible USING q,s.unified_revision;
    END IF;
   END IF;
  END IF;
  IF NOT possible AND kind<>'style' AND cardinality(terms)>0 THEN
   EXECUTE 'WITH probe AS MATERIALIZED(SELECT 1 FROM explore_local_quality_documents WHERE service_terms @> $1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)) SELECT EXISTS(SELECT 1 FROM probe)' INTO possible USING terms,s.unified_revision;
  END IF;
  IF NOT possible AND kind<>'style' AND cardinality(terms)>0 THEN
   profile_needle:=CASE WHEN cq ~ '^[0-9 ()+.-]+$' AND length(regexp_replace(cq,'[^0-9]','','g'))>=7 THEN ARRAY[regexp_replace(cq,'[^0-9]','','g')] ELSE terms END;
   EXECUTE 'WITH probe AS MATERIALIZED(SELECT 1 FROM explore_local_quality_documents WHERE profile_terms @> $1 AND valid_from<=$2 AND (valid_to IS NULL OR valid_to>$2)) SELECT EXISTS(SELECT 1 FROM probe)' INTO possible USING profile_needle,s.unified_revision;
  END IF;
  IF NOT possible AND cardinality(terms)>0 THEN post_possible:=explore_local_has_post(s.unified_revision,s.created_at,s.user_id,cq);possible:=post_possible;END IF;
  IF NOT possible THEN UPDATE explore_search_sessions SET exhausted=true WHERE id=s.id;RETURN 0;END IF;
 END IF;
 -- Each lane is ordered by the exact quality/UUID suffix used by the final
 -- merge. Taking its first64 eligible, unconsumed rows cannot hide a top64
 -- winner; eligibility and same-post proof precede that bound.
 FOR scope_index IN 0..2 LOOP
  region:=CASE scope_index WHEN 0 THEN s.region_plan->0 WHEN 1 THEN s.region_plan->1 ELSE '{"kind":"global","label":"Other areas"}'::jsonb END;
  IF region IS NULL OR scope_index=1 AND region->>'kind'='global' THEN CONTINUE;END IF;
  IF scope_index>0 AND s.region_plan->0->>'kind'='global' THEN CONTINUE;END IF;
  area:=scope_index;phase:=CASE WHEN scope_index=0 THEN 0 ELSE scope_index+1 END;
  label:=coalesce(region->>'label','Selected area');gps:=region->>'kind'='geo';
  cells:=ARRAY[NULL::int];
  IF gps AND s.applied_sort IN ('relevance','newest') THEN
   -- Conservative spherical bounds. Quarter-degree cells retain the exact
   -- quality/newest order while avoiding a sort of every point in a dense
   -- radius. A lane returns its top64 eligible rows PER cell, then merges.
   latitude_delta:=(region->>'radius')::float8/110000.0;
   IF abs((region->>'latitude')::float8)+latitude_delta<89 THEN
    longitude_delta:=latitude_delta/cos(radians(abs((region->>'latitude')::float8)+latitude_delta));
    IF abs((region->>'longitude')::float8)+longitude_delta<180 THEN
     SELECT array_agg(a*1440+b) INTO cells FROM generate_series(floor(((region->>'latitude')::float8-latitude_delta+90)*4)::int,floor(((region->>'latitude')::float8+latitude_delta+90)*4)::int) a
      CROSS JOIN generate_series(floor(((region->>'longitude')::float8-longitude_delta+180)*4)::int,floor(((region->>'longitude')::float8+longitude_delta+180)*4)::int) b;
     IF cardinality(cells)>144 THEN cells:=ARRAY[NULL::int];END IF;
    END IF;
   END IF;
  END IF;
  predicate:=CASE region->>'kind'
   WHEN 'state' THEN format('p.state_code=%L',region->>'state')
   WHEN 'city' THEN CASE WHEN region->>'state' IS NULL THEN format('p.city_search=%L',region->>'city') ELSE format('p.state_code=%L AND p.city_search=%L',region->>'state',region->>'city') END
   WHEN 'postal' THEN format('p.postal_code=%L',left(coalesce(region->>'postal',region->>'postalCode',region->>'zip',region->>'value',''),5))
   WHEN 'geo' THEN format('h.point <@ extensions.earth_box(extensions.ll_to_earth(%L,%L),%L) AND extensions.earth_distance(h.point,extensions.ll_to_earth(%L,%L))<=%L',region->>'latitude',region->>'longitude',region->>'radius',region->>'latitude',region->>'longitude',region->>'radius')
   WHEN 'address' THEN format('p.state_code=%L AND p.city_search=%L',region->>'state',region->>'city')
   ELSE 'true' END;
  -- Final live geographic proof uses the canonical shipped region predicates.
  predicate:=predicate||' AND '||explore_search_region_predicate(region);
  IF scope_index>0 THEN predicate:=predicate||' AND NOT ('||explore_search_region_predicate(s.region_plan->0)||')';END IF;
  IF scope_index=2 AND s.region_plan->1 IS NOT NULL AND s.region_plan->1->>'kind'<>'global' THEN predicate:=predicate||' AND NOT ('||explore_search_region_predicate(s.region_plan->1)||')';END IF;
  FOR lane IN 0..8 LOOP
   IF lane=7 THEN CONTINUE;END IF;
   IF lane=0 AND (q<>'' OR cq<>'') OR lane>0 AND q='' AND cq='' THEN CONTINUE;END IF;
   IF lane IN (4,5,6) AND kind='style' OR lane IN (1,4,5,6) AND q='' THEN CONTINUE;END IF;
   IF lane=4 AND kind<>'name' THEN CONTINUE;END IF;
   IF lane=2 AND kind='style' THEN CONTINUE;END IF;
   IF lane=5 AND length(replace(q,' ',''))<3 OR lane=6 AND length(replace(q,' ',''))<4 THEN CONTINUE;END IF;
   IF lane IN (2,3,8) AND cardinality(terms)=0 OR lane=8 AND kind='style' THEN CONTINUE;END IF;
   IF lane=3 THEN
    IF post_possible IS NULL THEN post_possible:=explore_local_has_post(s.unified_revision,s.created_at,s.user_id,cq);END IF;
    IF NOT post_possible THEN CONTINUE;END IF;
   END IF;
   IF lane=6 THEN
    IF kind<>'name' OR scope_index>0 THEN CONTINUE;END IF;
    IF s.local_quality_fuzzy IS NULL THEN s.local_quality_fuzzy:=NOT name_found;UPDATE explore_search_sessions SET local_quality_fuzzy=s.local_quality_fuzzy WHERE id=s.id;END IF;
    IF NOT s.local_quality_fuzzy THEN CONTINUE;END IF;
   END IF;
   lane_terms:=CASE WHEN lane=8 AND cq ~ '^[0-9 ()+.-]+$' AND length(regexp_replace(cq,'[^0-9]','','g'))>=7 THEN ARRAY[regexp_replace(cq,'[^0-9]','','g')] ELSE terms END;
   match_type:=CASE lane WHEN 0 THEN 'nearby' WHEN 1 THEN 'exact_name' WHEN 2 THEN 'service' WHEN 3 THEN 'post' WHEN 4 THEN 'prefix_name' WHEN 5 THEN 'name_tokens' WHEN 8 THEN 'profile' ELSE 'fuzzy_name' END;
   match_source:=CASE WHEN lane=0 THEN 'category' WHEN lane=2 THEN 'service' WHEN lane=3 THEN 'salon_post' WHEN lane=8 THEN 'profile' ELSE 'salon_name' END;
   tier:=CASE WHEN kind='name' THEN CASE lane WHEN 1 THEN 0 WHEN 4 THEN 1 WHEN 5 THEN 2 WHEN 6 THEN 3 WHEN 2 THEN 4 WHEN 3 THEN 5 WHEN 8 THEN 6 ELSE 7 END ELSE CASE lane WHEN 2 THEN 0 WHEN 3 THEN 1 WHEN 0 THEN 7 WHEN 8 THEN 3 ELSE 2 END END;
   content_proof:='LEFT JOIN LATERAL(SELECT NULL::text content_key,NULL::uuid source_token,NULL::text source_type) post ON true';
   IF lane=3 THEN content_proof:=$proof$ JOIN LATERAL(
    SELECT p.content_key,p.source_token,p.source_type FROM explore_unified_content_history p
    -- The current row is a keyed proof, never a second full salon-post scan.
    -- Under stale burst statistics an ordinary self-join can rescan every
    -- current post for each historical match before comparing content keys.
    JOIN LATERAL(SELECT current.* FROM explore_unified_content_history current
     WHERE current.content_key=p.content_key AND current.valid_to IS NULL OFFSET 0) live ON true
    WHERE p.salon_id=h.salon_id AND p.valid_from<=$1 AND (p.valid_to IS NULL OR p.valid_to>$1) AND p.published_at<=$2 AND live.published_at<=$2 AND NOT p.is_reference
     AND live.source_token=p.source_token AND live.salon_id=p.salon_id AND NOT live.is_reference
     AND p.search_terms@@plainto_tsquery('english',$4) AND live.search_terms@@plainto_tsquery('english',$4) AND NOT social_users_blocked($5,live.author_user_id)
    ORDER BY ts_rank_cd(p.search_terms,plainto_tsquery('english',$4)) DESC,p.published_at DESC,p.content_key LIMIT 1
   ) post ON true $proof$;END IF;
   IF lane IN (0,2,3) AND (s.applied_sort='relevance' OR s.applied_sort='newest' AND lane=0) THEN
    SELECT token INTO probe FROM unnest(CASE WHEN lane=0 THEN ARRAY[''] ELSE lane_terms END) token ORDER BY CASE WHEN token=ANY(ARRAY['nail','salon','spa','hair']) THEN 1 ELSE 0 END,length(token) DESC,token LIMIT 1;
    source_join:='explore_local_quality_postings p JOIN LATERAL(SELECT row.* FROM explore_local_quality_documents row WHERE row.salon_id=p.salon_id AND row.valid_from=p.valid_from OFFSET 0) h ON true';
    -- A geographic lane starts from indexed eligible points. Making postings
    -- the outer side here would walk global quality order for an empty/sparse
    -- radius; only local spatial candidates may enter its quality sort.
    IF gps AND cells[1] IS NULL THEN source_join:=format('explore_local_quality_documents h JOIN LATERAL(SELECT row.* FROM explore_local_quality_postings row WHERE row.salon_id=h.salon_id AND row.valid_from=h.valid_from AND row.lane=%s AND row.probe=%L OFFSET 0) p ON true',lane,cat||E'\x1f'||probe);END IF;
    order_fields:='p.quality_order,p.post_order,p.salon_id';order_alias:='p';
    name_predicate:=format('p.lane=%s AND p.probe=%L AND p.valid_from<=$1 AND (p.valid_to IS NULL OR p.valid_to>$1)',lane,cat||E'\x1f'||probe);
    IF lane=2 THEN name_predicate:=name_predicate||' AND h.service_terms @> $6 AND (h.valid_to IS NULL OR EXISTS(SELECT 1 FROM explore_local_quality_documents current_terms WHERE current_terms.salon_id=h.salon_id AND current_terms.valid_to IS NULL AND current_terms.source_token=h.source_token AND current_terms.service_terms @> $6 OFFSET 0))';END IF;
    IF lane=3 THEN name_predicate:=name_predicate||' AND h.post_terms @> $6';END IF;
   ELSE
    -- Name probes use the existing meaning (exact/prefix/whole words/typo),
    -- with an indexable selective probe rather than materializing all salons.
    source_join:='explore_local_quality_documents h CROSS JOIN LATERAL(SELECT h.state_code,h.city_search,h.postal_code) p';
    order_fields:='h.quality_order,h.post_order,h.salon_id';order_alias:='h';
    name_predicate:=CASE lane WHEN 0 THEN 'true'
     WHEN 2 THEN 'h.service_terms @> $6 AND (h.valid_to IS NULL OR EXISTS(SELECT 1 FROM explore_local_quality_documents current_terms WHERE current_terms.salon_id=h.salon_id AND current_terms.valid_to IS NULL AND current_terms.source_token=h.source_token AND current_terms.service_terms @> $6 OFFSET 0))'
     WHEN 3 THEN 'h.post_terms @> $6'
     WHEN 8 THEN 'h.profile_terms @> $6 AND (h.valid_to IS NULL OR EXISTS(SELECT 1 FROM explore_local_quality_documents current_terms WHERE current_terms.salon_id=h.salon_id AND current_terms.valid_to IS NULL AND current_terms.source_token=h.source_token AND current_terms.profile_terms @> $6 OFFSET 0))'
     WHEN 1 THEN 'h.name_text=$3 AND d.salon_name_search=$3'
     WHEN 4 THEN 'h.name_text LIKE $3||''%'' AND d.salon_name_search LIKE $3||''%'' AND h.name_text<>$3'
     WHEN 5 THEN format('h.name_text LIKE %L AND explore_local_words(h.name_text) @> $7 AND explore_local_words(d.salon_name_search) @> $7 AND h.name_text<>$3%s','%'||explore_unified_selective_token(q)||'%',CASE WHEN kind='name' THEN ' AND h.name_text NOT LIKE $3||''%''' ELSE '' END)
     ELSE fuzzy_condition||' AND explore_local_fuzzy_match(h.name_text,$3) AND explore_unified_name_similarity(d.salon_name_search,$3)>0' END;
   END IF;
   order_prefix:=ARRAY[area::float8,CASE WHEN scope_index=0 THEN 0 ELSE 1 END::float8,tier::float8];prefix_length:=3;
   key_expression:='$8||ARRAY[h.quality_order,h.post_order]';
   IF s.applied_sort='newest' THEN
    order_prefix:=order_prefix[1:2];prefix_length:=2;
    key_expression:=format('$8||ARRAY[h.created_order,%s::float8,h.quality_order,h.post_order]',tier);
    order_fields:=format('%s.created_order,%s.quality_order,%s.post_order,%s.salon_id',order_alias,order_alias,order_alias,order_alias);
   ELSIF s.applied_sort='closest' THEN
    order_prefix:=order_prefix[1:2];prefix_length:=2;
    distance_expression:='h.point OPERATOR(extensions.<->) extensions.ll_to_earth($14,$15)';
    key_expression:=format('$8||ARRAY[coalesce(%s,1e12),%s::float8,h.quality_order,h.post_order]',distance_expression,tier);
    order_fields:=distance_expression||' NULLS LAST,h.quality_order,h.post_order,h.salon_id';
   END IF;
   anchor_sql:='';
   IF anchor IS NOT NULL THEN
    IF order_prefix<anchor[1:prefix_length] THEN CONTINUE;END IF;
    IF order_prefix=anchor[1:prefix_length] THEN
     IF s.applied_sort='newest' THEN
      IF tier=anchor[4] THEN anchor_sql:=format(' AND ROW(%s.created_order,%s.quality_order,%s.post_order,%s.salon_id)>ROW(($11)[3],($11)[5],($11)[6],$12)',order_alias,order_alias,order_alias,order_alias);
      ELSE anchor_sql:=format(' AND %s.created_order%s($11)[3]',order_alias,CASE WHEN tier>anchor[4] THEN '>=' ELSE '>' END);END IF;
     ELSIF s.applied_sort='closest' THEN
      IF tier=anchor[4] THEN anchor_sql:=format(' AND ROW(coalesce(%s,1e12),h.quality_order,h.post_order,h.salon_id)>ROW(($11)[3],($11)[5],($11)[6],$12)',distance_expression);
      ELSE anchor_sql:=format(' AND coalesce(%s,1e12)%s($11)[3]',distance_expression,CASE WHEN tier>anchor[4] THEN '>=' ELSE '>' END);END IF;
     ELSE anchor_sql:=format(' AND ROW(%s.quality_order,%s.post_order,%s.salon_id)>ROW(($11)[4],($11)[5],$12)',order_alias,order_alias,order_alias);END IF;
    END IF;
   END IF;
   FOREACH cell IN ARRAY cells LOOP
   cell_sql:=CASE WHEN cell IS NULL THEN '' ELSE format(' AND %s.geo_cell=$16',order_alias) END;
   known_full:=false;
   FOR point_group IN 0..CASE WHEN s.applied_sort='closest' THEN 1 ELSE 0 END LOOP
   scan_prefix:='';scan_suffix:='';limit_clause:='LIMIT 64';point_sql:='';group_anchor_sql:=anchor_sql;
   IF s.applied_sort='closest' THEN
    IF point_group=0 THEN
     IF anchor IS NOT NULL AND order_prefix=anchor[1:2] AND anchor[3]>=1e12 THEN CONTINUE;END IF;
     point_sql:=' AND h.point IS NOT NULL';
     -- Distance is the explicit primary sort. Fetch every finite boundary tie
     -- after ALL eligibility proof, then choose quality/tier winners from it.
     -- A distance-only inner ORDER BY admits the GiST KNN path; extra quality
     -- keys there caused the planner to sort every point in a dense radius.
     scan_prefix:='SELECT * FROM (';scan_suffix:=') exact_distance_pool ORDER BY order_key,salon_id LIMIT 64';
     order_fields:=distance_expression||' NULLS LAST';limit_clause:='FETCH FIRST 64 ROWS WITH TIES';
    ELSE
     IF gps OR known_full THEN CONTINUE;END IF;
     -- NULL points form their own indexed quality lane, never one unlimited
     -- WITH TIES group. Their distance remains NULL and their rank is last.
     point_sql:=' AND h.point IS NULL';order_fields:='h.quality_order,h.post_order,h.salon_id';
     IF anchor IS NOT NULL AND order_prefix=anchor[1:2] AND anchor[3]>=1e12 THEN
      IF tier<anchor[4] THEN CONTINUE;
      ELSIF tier=anchor[4] THEN group_anchor_sql:=' AND ROW(h.quality_order,h.post_order,h.salon_id)>ROW(($11)[5],($11)[6],$12)';
      ELSE group_anchor_sql:='';END IF;
     END IF;
    END IF;
   END IF;
   query_sql:=format($query$
    SELECT coalesce(jsonb_agg(to_jsonb(hit) ORDER BY order_key,salon_id),'[]') FROM (
     %s
     SELECT h.salon_id,h.source_token,h.quality,h.latest_post,post.content_key,post.source_token content_source_token,post.source_type,
      %L::text match_type,%L::text match_source,%s tier,%s area,%s phase,%L::text label,
      %s AS order_key
     FROM %s JOIN LATERAL(SELECT live.* FROM explore_salon_documents live WHERE live.salon_id=h.salon_id OFFSET 0) d ON true %s
     WHERE %s AND h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1)
      AND %s AND d.has_public_profile AND d.created_at<=$2 AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=$2)
      AND EXISTS(SELECT 1 FROM explore_unified_salon_incarnations i WHERE i.salon_id=h.salon_id AND i.source_token=h.source_token OFFSET 0)
      AND salon_profile_public_salon_exists(d.salon_id)
      AND ($9='' OR coalesce(d.service_category_search_text,'') LIKE '%%'||$9||'%%')
      AND explore_unified_filter_salon(d,$10,$5,$2)
      AND (NOT ($10 ?| ARRAY['shape','length','color','finish','tone','season']) OR EXISTS(SELECT 1 FROM explore_unified_content_history facet WHERE facet.salon_id=h.salon_id AND facet.valid_to IS NULL AND NOT facet.is_reference AND facet.published_at<=$2 AND facet.search_terms@@plainto_tsquery('english',$4) AND NOT social_users_blocked($5,facet.author_user_id)))
      %s
      %s
      %s
      AND NOT EXISTS(SELECT 1 FROM explore_search_session_candidates c WHERE c.session_id=$13 AND c.salon_id=h.salon_id)
     ORDER BY %s %s
     %s
    ) hit
   $query$,scan_prefix,match_type,match_source,tier,area,phase,label,key_expression,source_join,content_proof,name_predicate,predicate,group_anchor_sql,cell_sql,point_sql,order_fields,limit_clause,scan_suffix);
   IF s.applied_sort='closest' AND point_group=0 THEN
    -- A LIMIT2049 probe is only a strategy test, never a result pre-cap. If
    -- complete (<=2048 actual eligible rows), sort that entire set. Otherwise
    -- stream raw bare-KNN pages and apply ALL eligibility before FETCH/ties.
    -- A real page LIMIT supplies fast-start index costing. Full distance ties
    -- are consumed before advancing; unusually large ties can still cost work.
    eligible_probe_sql:=replace(replace(replace(query_sql,scan_prefix,''),scan_suffix,''),'ORDER BY '||order_fields||' '||limit_clause,'LIMIT 2049');
    EXECUTE eligible_probe_sql INTO eligible_probe_batch USING s.unified_revision,s.created_at,q,cq,s.user_id,lane_terms,name_terms,order_prefix,cat,canon->'filters',anchor,anchor_id,s.id,s.rank_origin_latitude,s.rank_origin_longitude,cell;
    IF jsonb_array_length(eligible_probe_batch)<=2048 THEN
     SELECT coalesce(jsonb_agg(value ORDER BY key,id),'[]') INTO batch FROM (
      SELECT value,ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(value->'order_key') x) key,(value->>'salon_id')::uuid id
      FROM jsonb_array_elements(eligible_probe_batch) value ORDER BY key,id LIMIT 64
     ) complete_pool;
    ELSE
     -- Stream finite KNN pages, not an unbounded ordered subquery (the latter
     -- was costed as a full sequential scan/sort). A raw page is NOT a result
     -- cap: keep advancing until64 genuinely eligible rows or source exhaustion.
     -- Raw WITH TIES consumes the complete distance boundary before advancing;
     -- final keyword/public proof and quality/tier trimming remain downstream.
     nearest_source:='closest_raw raw JOIN LATERAL(SELECT row.*,raw.local_distance FROM explore_local_quality_documents row WHERE row.salon_id=raw.salon_id AND row.valid_from=raw.valid_from OFFSET 0) h ON true CROSS JOIN LATERAL(SELECT h.state_code,h.city_search,h.postal_code) p';
     query_sql:=replace(replace(query_sql,source_join,nearest_source),distance_expression,'h.local_distance');
     raw_cursor:=NULL;raw_chunk:=256;lane_candidates:='[]';
     LOOP
      knn_chunk_sql:=$driver$ WITH closest_raw AS MATERIALIZED(
       SELECT row.salon_id,row.valid_from,row.point OPERATOR(extensions.<->) extensions.ll_to_earth($14,$15) AS local_distance
       FROM explore_local_quality_documents row WHERE row.point IS NOT NULL AND row.valid_from<=$1 AND (row.valid_to IS NULL OR row.valid_to>$1)
        AND ($17 IS NULL OR row.point OPERATOR(extensions.<->) extensions.ll_to_earth($14,$15)>$17)
       ORDER BY local_distance FETCH FIRST ($18) ROWS WITH TIES
      ) SELECT jsonb_build_object('rows',($driver$||query_sql||$driver$),'rawCount',(SELECT count(*) FROM closest_raw),'rawMax',(SELECT max(local_distance) FROM closest_raw)) $driver$;
      EXECUTE knn_chunk_sql INTO chunk_payload USING s.unified_revision,s.created_at,q,cq,s.user_id,lane_terms,name_terms,order_prefix,cat,canon->'filters',anchor,anchor_id,s.id,s.rank_origin_latitude,s.rank_origin_longitude,cell,raw_cursor,raw_chunk;
      lane_candidates:=lane_candidates||(chunk_payload->'rows');raw_count:=(chunk_payload->>'rawCount')::int;
      EXIT WHEN jsonb_array_length(lane_candidates)>=64 OR raw_count<raw_chunk;
      raw_cursor:=(chunk_payload->>'rawMax')::float8;raw_chunk:=least(65536,raw_chunk*2);
     END LOOP;
     SELECT coalesce(jsonb_agg(value ORDER BY key,id),'[]') INTO batch FROM (
      SELECT value,ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(value->'order_key') x) key,(value->>'salon_id')::uuid id
      FROM jsonb_array_elements(lane_candidates) value ORDER BY key,id LIMIT 64
     ) streamed_pool;
    END IF;
   ELSE
    EXECUTE query_sql INTO batch USING s.unified_revision,s.created_at,q,cq,s.user_id,lane_terms,name_terms,order_prefix,cat,canon->'filters',anchor,anchor_id,s.id,s.rank_origin_latitude,s.rank_origin_longitude,cell;
   END IF;
   IF lane IN (1,4,5) AND jsonb_array_length(batch)>0 AND scope_index=0 THEN name_found:=true;END IF;
   all_rows:=explore_local_top_rows(all_rows||batch);
   IF s.applied_sort='closest' AND point_group=0 AND jsonb_array_length(batch)>=64 THEN known_full:=true;END IF;
   END LOOP;
   END LOOP;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'salon_id') FROM jsonb_array_elements(all_rows) value)>=64 THEN EXIT;END IF;
 END LOOP;
 -- Every lane/cell merge retains at most64 unique salons by the complete key.
 -- Duplicate IDs keep their strongest evidence; no pre-ranking UUID cap exists.
 FOR r IN SELECT value FROM (
  SELECT DISTINCT ON(value->>'salon_id') value FROM jsonb_array_elements(all_rows) value
  ORDER BY value->>'salon_id',ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(value->'order_key') x)
 ) unique_salons ORDER BY ARRAY(SELECT x::float8 FROM jsonb_array_elements_text(value->'order_key') x),(value->>'salon_id')::uuid LIMIT 64 LOOP
  INSERT INTO explore_search_session_candidates(session_id,ordinal,salon_id,search_scope,scope_label,eligibility_region,rank_score,distance_miles,match_type,unified_payload)
  VALUES(s.id,s.next_ordinal,(r->>'salon_id')::uuid,CASE r->>'area' WHEN '0' THEN 'A' WHEN '1' THEN 'B' ELSE 'C' END,r->>'label',CASE r->>'area' WHEN '0' THEN s.region_plan->0 WHEN '1' THEN s.region_plan->1 ELSE '{"kind":"global"}'::jsonb END,
   100-(r->>'tier')::int,NULL,r->>'match_type',jsonb_build_object('localQuality',true,'sourceToken',r->'source_token','tier',r->'tier','orderKey',r->'order_key','referencePhase',r->'phase','matchSource',CASE WHEN r->>'source_type'='beauty_post' THEN 'customer_post' ELSE r->>'match_source' END,
    'matchContentKey',r->'content_key','matchContentSourceToken',r->'content_source_token','recommendationReason',CASE r->>'area' WHEN '1' THEN 'matching_in_broader_area' WHEN '2' THEN 'matching_in_other_areas' END,'recommendationAreaLabel',CASE WHEN r->>'area'<>'0' THEN r->>'label' END));
  s.next_ordinal:=s.next_ordinal+1;added:=added+1;
  s.unified_anchor:=jsonb_build_object('key',r->'order_key','id',r->'salon_id');
 END LOOP;
 UPDATE explore_search_sessions SET next_ordinal=s.next_ordinal,unified_anchor=s.unified_anchor,exhausted=added<64 WHERE id=s.id;
 RETURN added;
END $$;

-- The shipped outer RPC inferred a fallback category by scoring a global
-- name/service set before LIMIT1. New lanes return actual evidence and do not
-- use category-only filler, so new sessions must not pay that discarded work.
-- Keep the original outer OID/body for already-created cursors.
ALTER FUNCTION public.search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[]) RENAME TO _explore_search_before_local_quality;
DO $outer$ DECLARE definition text;start_at integer;end_at integer;BEGIN
 SELECT pg_get_functiondef('public._explore_search_before_local_quality(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[])'::regprocedure) INTO definition;
 start_at:=strpos(definition,'  reference_category:=cat;');end_at:=strpos(definition,'  UPDATE explore_search_sessions SET unified_reference_category=');
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Unexpected outer search implementation; inspect the release baseline before integration';END IF;
 definition:=left(definition,start_at-1)||'  reference_category:=cat;'||chr(10)||substr(definition,end_at);
 definition:=replace(definition,'public._explore_search_before_local_quality(','public._explore_search_local_quality(');
 EXECUTE definition;
END $outer$;
CREATE FUNCTION public.search_public_explore_session(
 p_query text DEFAULT NULL,p_category text DEFAULT NULL,p_location text DEFAULT NULL,p_latitude float8 DEFAULT NULL,p_longitude float8 DEFAULT NULL,
 p_sort text DEFAULT 'relevance',p_limit integer DEFAULT 12,p_cursor jsonb DEFAULT NULL,p_scope_policy text DEFAULT 'fixed',p_intent text DEFAULT 'search',
 p_content_query text DEFAULT NULL,p_query_kind text DEFAULT NULL,p_location_priority boolean DEFAULT false,p_filters jsonb DEFAULT '{}',p_hydrate_ids uuid[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit=off AS $$
DECLARE version integer;
BEGIN
 IF p_cursor IS NULL AND NOT explore_local_quality_ready() THEN
  RETURN _explore_search_before_local_quality(p_query,p_category,p_location,p_latitude,p_longitude,p_sort,p_limit,p_cursor,p_scope_policy,p_intent,p_content_query,p_query_kind,p_location_priority,p_filters,p_hydrate_ids);
 END IF;
 IF p_cursor IS NOT NULL THEN
  SELECT local_quality_version INTO version FROM explore_search_sessions WHERE id=CASE WHEN p_cursor->>'session' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN (p_cursor->>'session')::uuid END
   AND viewer_key=coalesce(current_public_user_id()::text,'guest');
  IF coalesce(version,0)=0 THEN RETURN _explore_search_before_local_quality(p_query,p_category,p_location,p_latitude,p_longitude,p_sort,p_limit,p_cursor,p_scope_policy,p_intent,p_content_query,p_query_kind,p_location_priority,p_filters,p_hydrate_ids);END IF;
 END IF;
 RETURN _explore_search_local_quality(p_query,p_category,p_location,p_latitude,p_longitude,p_sort,p_limit,p_cursor,p_scope_policy,p_intent,p_content_query,p_query_kind,p_location_priority,p_filters,p_hydrate_ids);
END $$;
REVOKE ALL ON FUNCTION public.search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[]) TO anon,authenticated,service_role;

-- Existing session cleanup owns history TTL; no new scheduler or expiry worker.
ALTER FUNCTION public.cleanup_explore_search_sessions(integer) RENAME TO _explore_cleanup_before_local_quality;
CREATE FUNCTION public.cleanup_explore_search_sessions(p_limit integer DEFAULT 5000) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;BEGIN n:=_explore_cleanup_before_local_quality(p_limit);
 IF explore_local_quality_ready() THEN
  DELETE FROM explore_local_quality_documents WHERE (salon_id,valid_from) IN(SELECT salon_id,valid_from FROM explore_local_quality_documents WHERE retired_at<now()-interval '35 minutes' ORDER BY retired_at LIMIT least(10000,greatest(1,p_limit)));
 END IF;
 RETURN n;END $$;
ALTER TABLE public.explore_local_quality_preparation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explore_local_quality_dirty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explore_local_quality_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explore_local_quality_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_local_quality_preparation,public.explore_local_quality_dirty,public.explore_local_quality_documents,public.explore_local_quality_postings,public.explore_local_quality_source FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.explore_local_quality_preparation,public.explore_local_quality_dirty,public.explore_local_quality_documents,public.explore_local_quality_postings TO service_role;
DO $$ DECLARE r record;BEGIN FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'explore_local_%' OR p.proname IN ('refresh_explore_local_quality','explore_unified_pull_batch','explore_unified_candidate_live','cleanup_explore_search_sessions','_explore_candidate_live_before_local_quality','_explore_pull_before_local_quality','_explore_search_before_local_quality','_explore_search_local_quality','_explore_cleanup_before_local_quality')) LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);END LOOP;END $$;
ANALYZE public.explore_local_quality_documents;
ANALYZE public.explore_local_quality_postings;
NOTIFY pgrst,'reload schema';
COMMIT;
