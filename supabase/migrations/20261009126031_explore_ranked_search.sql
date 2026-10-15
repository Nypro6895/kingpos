-- Canonical ranking is prepared off the request path. Existing source data is retained.
BEGIN;
SET LOCAL search_path=public,extensions;
SELECT extensions.word_similarity('a','a');
CREATE TABLE public.explore_search_rank_clock(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),revision bigint NOT NULL DEFAULT 0,as_of timestamptz NOT NULL DEFAULT now());
INSERT INTO public.explore_search_rank_clock DEFAULT VALUES;
CREATE TABLE public.explore_search_rank_sources(salon_id uuid PRIMARY KEY,source_token uuid NOT NULL DEFAULT gen_random_uuid(),fingerprint text NOT NULL,group_keys text[] NOT NULL,has_point boolean NOT NULL,ready boolean NOT NULL DEFAULT false,computed_at timestamptz,refresh_after timestamptz);
CREATE TABLE public.explore_search_rank_groups(group_key text PRIMARY KEY,group_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,total_count bigint NOT NULL DEFAULT 0 CHECK(total_count>=0),point_count bigint NOT NULL DEFAULT 0 CHECK(point_count>=0 AND point_count<=total_count),ready_count bigint NOT NULL DEFAULT 0 CHECK(ready_count>=0 AND ready_count<=total_count));
CREATE TABLE public.explore_search_rank_jobs(salon_id uuid PRIMARY KEY,generation bigint NOT NULL DEFAULT 1,enqueued_at timestamptz NOT NULL DEFAULT now(),next_attempt_at timestamptz NOT NULL DEFAULT now(),lease uuid,leased_at timestamptz,attempts integer NOT NULL DEFAULT 0);
CREATE INDEX explore_rank_jobs_claim_idx ON public.explore_search_rank_jobs(next_attempt_at,enqueued_at,salon_id);
CREATE INDEX explore_rank_sources_refresh_idx ON public.explore_search_rank_sources(refresh_after,salon_id) WHERE ready AND refresh_after IS NOT NULL;
CREATE TABLE public.explore_search_rank_history(group_id bigint NOT NULL,salon_id uuid NOT NULL,valid_from bigint NOT NULL,valid_to bigint,retired_at timestamptz,source_token uuid NOT NULL,trust_score double precision NOT NULL CHECK(trust_score BETWEEN 0 AND 1),trust_order double precision GENERATED ALWAYS AS (-trust_score) STORED,bookable boolean NOT NULL,bookable_order double precision GENERATED ALWAYS AS (-(CASE WHEN bookable THEN 2 ELSE 0 END+trust_score)) STORED,point extensions.cube,latitude double precision,longitude double precision,computed_at timestamptz NOT NULL,refresh_after timestamptz,rule_version text NOT NULL,PRIMARY KEY(group_id,salon_id,valid_from));
CREATE INDEX explore_rank_trusted_seek_idx ON public.explore_search_rank_history(group_id,trust_order,salon_id,valid_from);
CREATE INDEX explore_rank_bookable_seek_idx ON public.explore_search_rank_history(group_id,bookable_order,salon_id,valid_from);
CREATE INDEX explore_rank_point_seek_idx ON public.explore_search_rank_history USING gist(point) WHERE point IS NOT NULL;
CREATE INDEX explore_rank_unlocated_seek_idx ON public.explore_search_rank_history(group_id,salon_id,valid_from) WHERE point IS NULL;
CREATE INDEX explore_rank_current_salon_idx ON public.explore_search_rank_history(salon_id) WHERE valid_to IS NULL;
CREATE INDEX explore_rank_freshness_idx ON public.explore_search_rank_history(group_id,refresh_after) WHERE valid_to IS NULL AND refresh_after IS NOT NULL;
CREATE INDEX explore_rank_retired_idx ON public.explore_search_rank_history(retired_at) WHERE retired_at IS NOT NULL;
ALTER TABLE public.explore_search_sessions ADD COLUMN rank_version bigint,ADD COLUMN rank_as_of timestamptz,ADD COLUMN rank_origin_latitude double precision,ADD COLUMN rank_origin_longitude double precision,ADD COLUMN supported_sorts text[] NOT NULL DEFAULT ARRAY['relevance','newest'],ADD COLUMN sort_fallback_reason text,ADD COLUMN ranking_basis text NOT NULL DEFAULT 'candidate_pool';

CREATE FUNCTION public.explore_rank_category_keys(d public.explore_salon_documents) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT ARRAY['']::text[]||ARRAY(SELECT c FROM unnest(ARRAY['nails','hair','lashes','barber','spa','brows','makeup','skin','skincare','massage','waxing','tattoo']) c WHERE coalesce(d.service_category_search_text,'') LIKE '%'||c||'%')
$$;
CREATE FUNCTION public.explore_rank_scope_key(r jsonb,c text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE r->>'kind' WHEN 'state' THEN jsonb_build_array('state',r->>'state',c)::text WHEN 'city' THEN jsonb_build_array('city',r->>'city',nullif(r->>'state',''),c)::text WHEN 'postal' THEN jsonb_build_array('postal',r->>'postal',c)::text WHEN 'other' THEN jsonb_build_array('other',c)::text ELSE jsonb_build_array('global',c)::text END
$$;
CREATE FUNCTION public.explore_rank_document_group_keys(d public.explore_salon_documents) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
 SELECT ARRAY(SELECT DISTINCT public.explore_rank_scope_key(r,c) FROM unnest(public.explore_rank_category_keys(d)) c CROSS JOIN LATERAL (
  SELECT jsonb_build_object('kind','global') r UNION ALL SELECT jsonb_build_object('kind',CASE WHEN d.state_code=ANY(public.explore_search_state_codes()) THEN 'state' ELSE 'other' END,'state',d.state_code)
  UNION ALL SELECT jsonb_build_object('kind','city','city',d.city_search) WHERE nullif(d.city_search,'') IS NOT NULL
  UNION ALL SELECT jsonb_build_object('kind','city','city',d.city_search,'state',d.state_code) WHERE nullif(d.city_search,'') IS NOT NULL AND nullif(d.state_code,'') IS NOT NULL
  UNION ALL SELECT jsonb_build_object('kind','postal','postal',left(d.postal_code,5)) WHERE left(d.postal_code,5)~'^[0-9]{5}$'
 ) x ORDER BY 1)
$$;
CREATE FUNCTION public.explore_rank_document_fingerprint(d public.explore_salon_documents) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT md5(to_jsonb(d)::text) $$;

-- These counts are maintained on writes, never counted across source data on searches.
INSERT INTO public.explore_search_rank_sources(salon_id,fingerprint,group_keys,has_point) SELECT d.salon_id,public.explore_rank_document_fingerprint(d),public.explore_rank_document_group_keys(d),coalesce(d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180,false) FROM public.explore_salon_documents d;
INSERT INTO public.explore_search_rank_groups(group_key,total_count,point_count) SELECT k,count(*),count(*) FILTER(WHERE has_point) FROM public.explore_search_rank_sources s CROSS JOIN LATERAL unnest(s.group_keys) k GROUP BY k;
INSERT INTO public.explore_search_rank_jobs(salon_id) SELECT salon_id FROM public.explore_search_rank_sources;

CREATE FUNCTION public.explore_rank_enqueue(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(126031,1);
 UPDATE public.explore_search_rank_groups g SET ready_count=g.ready_count-x.n FROM (SELECT k,count(*) n FROM public.explore_search_rank_sources s CROSS JOIN LATERAL unnest(s.group_keys) k WHERE s.salon_id=ANY(p_ids) AND s.ready GROUP BY k) x WHERE g.group_key=x.k;
 UPDATE public.explore_search_rank_sources SET ready=false WHERE salon_id=ANY(p_ids) AND ready;
 INSERT INTO public.explore_search_rank_jobs(salon_id) SELECT DISTINCT x FROM unnest(p_ids) x WHERE x IS NOT NULL
 ON CONFLICT(salon_id) DO UPDATE SET generation=explore_search_rank_jobs.generation+1,next_attempt_at=now();
END $$;

CREATE FUNCTION public.get_explore_rank_refresh_policy(p_ids uuid[]) RETURNS TABLE(salon_id uuid,may_skip_decay boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF cardinality(p_ids)>100 THEN RAISE EXCEPTION 'Invalid rank batch' USING ERRCODE='22023';END IF;
 IF to_regclass('public.pos_tickets') IS NULL THEN RETURN QUERY SELECT x,false FROM unnest(p_ids) x;RETURN;END IF;
 -- Canonical zero counts alone do not exclude a future-dated closed ticket.
 RETURN QUERY EXECUTE 'SELECT x,NOT EXISTS(SELECT 1 FROM public.pos_tickets t WHERE t.salon_id=x AND t.status=''closed'' LIMIT 1) FROM unnest($1::uuid[]) x' USING p_ids;
END $$;
CREATE FUNCTION public.explore_rank_sync_documents(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(126031,1);
 UPDATE public.explore_search_rank_groups g SET total_count=g.total_count-x.total,point_count=g.point_count-x.points,ready_count=g.ready_count-x.ready FROM (
  SELECT k,count(*) total,count(*) FILTER(WHERE has_point) points,count(*) FILTER(WHERE ready) ready FROM public.explore_search_rank_sources s CROSS JOIN LATERAL unnest(s.group_keys) k WHERE salon_id=ANY(p_ids) GROUP BY k
 ) x WHERE g.group_key=x.k;
 DELETE FROM public.explore_search_rank_sources WHERE salon_id=ANY(p_ids);
 INSERT INTO public.explore_search_rank_sources(salon_id,fingerprint,group_keys,has_point) SELECT d.salon_id,public.explore_rank_document_fingerprint(d),public.explore_rank_document_group_keys(d),coalesce(d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180,false) FROM public.explore_salon_documents d WHERE d.salon_id=ANY(p_ids);
 INSERT INTO public.explore_search_rank_groups(group_key,total_count,point_count) SELECT k,count(*),count(*) FILTER(WHERE has_point) FROM public.explore_search_rank_sources s CROSS JOIN LATERAL unnest(s.group_keys) k WHERE salon_id=ANY(p_ids) GROUP BY k
 ON CONFLICT(group_key) DO UPDATE SET total_count=explore_search_rank_groups.total_count+excluded.total_count,point_count=explore_search_rank_groups.point_count+excluded.point_count;
 PERFORM public.explore_rank_enqueue(p_ids);
END $$;
CREATE FUNCTION public.explore_rank_projection_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM public.explore_rank_sync_documents(ARRAY(SELECT salon_id FROM new_rows));RETURN NULL;END $$;
CREATE FUNCTION public.explore_rank_projection_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM public.explore_rank_sync_documents(ARRAY(SELECT salon_id FROM old_rows));RETURN NULL;END $$;
CREATE FUNCTION public.explore_rank_projection_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN PERFORM public.explore_rank_sync_documents(ARRAY(SELECT salon_id FROM new_rows UNION SELECT salon_id FROM old_rows));RETURN NULL;END $$;
CREATE TRIGGER explore_rank_documents_insert AFTER INSERT ON public.explore_salon_documents REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_rank_projection_insert();
CREATE TRIGGER explore_rank_documents_delete AFTER DELETE ON public.explore_salon_documents REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_rank_projection_delete();
CREATE TRIGGER explore_rank_documents_update AFTER UPDATE ON public.explore_salon_documents REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_rank_projection_update();

CREATE FUNCTION public.explore_rank_evidence_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE ids uuid[];BEGIN
 IF TG_TABLE_NAME='customers' THEN SELECT array_agg(DISTINCT location_id) INTO ids FROM new_rows;
 ELSIF TG_TABLE_NAME='account_memberships' THEN SELECT array_agg(DISTINCT l.id) INTO ids FROM public.locations l JOIN new_rows x ON x.account_id=l.account_id JOIN public.explore_search_rank_sources s ON s.salon_id=l.id WHERE s.refresh_after IS NOT NULL;
 ELSE SELECT array_agg(DISTINCT salon_id) INTO ids FROM new_rows;END IF;
 PERFORM public.explore_rank_enqueue(ids);RETURN NULL;END $$;
CREATE FUNCTION public.explore_rank_evidence_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE ids uuid[];BEGIN
 IF TG_TABLE_NAME='customers' THEN SELECT array_agg(DISTINCT location_id) INTO ids FROM old_rows;
 ELSIF TG_TABLE_NAME='account_memberships' THEN SELECT array_agg(DISTINCT l.id) INTO ids FROM public.locations l JOIN old_rows x ON x.account_id=l.account_id JOIN public.explore_search_rank_sources s ON s.salon_id=l.id WHERE s.refresh_after IS NOT NULL;
 ELSE SELECT array_agg(DISTINCT salon_id) INTO ids FROM old_rows;END IF;
 PERFORM public.explore_rank_enqueue(ids);RETURN NULL;END $$;
CREATE FUNCTION public.explore_rank_evidence_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE ids uuid[];BEGIN
 IF TG_TABLE_NAME='customers' THEN SELECT array_agg(DISTINCT location_id) INTO ids FROM (SELECT location_id FROM new_rows UNION SELECT location_id FROM old_rows) x;
 ELSIF TG_TABLE_NAME='account_memberships' THEN SELECT array_agg(DISTINCT l.id) INTO ids FROM public.locations l JOIN (SELECT account_id FROM new_rows UNION SELECT account_id FROM old_rows) x ON x.account_id=l.account_id JOIN public.explore_search_rank_sources s ON s.salon_id=l.id WHERE s.refresh_after IS NOT NULL;
 ELSE SELECT array_agg(DISTINCT salon_id) INTO ids FROM (SELECT salon_id FROM new_rows UNION SELECT salon_id FROM old_rows) x;END IF;
 PERFORM public.explore_rank_enqueue(ids);RETURN NULL;END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['pos_tickets','pos_ticket_items','customer_visit_experiences','staff','salon_memberships','customers','account_memberships'] LOOP
 IF to_regclass('public.'||t) IS NOT NULL THEN
  EXECUTE format('CREATE TRIGGER explore_rank_evidence_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_rank_evidence_insert()',t);
  EXECUTE format('CREATE TRIGGER explore_rank_evidence_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_rank_evidence_delete()',t);
  EXECUTE format('CREATE TRIGGER explore_rank_evidence_update AFTER UPDATE ON public.%I REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.explore_rank_evidence_update()',t);
 END IF;END LOOP;END $$;

CREATE FUNCTION public.claim_explore_search_rank_jobs(p_limit integer DEFAULT 50) RETURNS TABLE(salon_id uuid,generation bigint,fingerprint text,lease uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN QUERY WITH selected AS MATERIALIZED (
  SELECT j.salon_id FROM public.explore_search_rank_jobs j WHERE j.next_attempt_at<=now() AND (j.lease IS NULL OR j.leased_at<now()-interval '5 minutes') ORDER BY j.next_attempt_at,j.enqueued_at,j.salon_id LIMIT least(100,greatest(1,p_limit)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.explore_search_rank_jobs j SET lease=gen_random_uuid(),leased_at=now(),attempts=j.attempts+1 FROM selected x WHERE j.salon_id=x.salon_id RETURNING j.*
 ) SELECT j.salon_id,j.generation,s.fingerprint,j.lease FROM claimed j LEFT JOIN public.explore_search_rank_sources s ON s.salon_id=j.salon_id;
END $$;
CREATE FUNCTION public.fail_explore_search_rank_jobs(p_jobs jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF jsonb_typeof(p_jobs)<>'array' OR jsonb_array_length(p_jobs)>100 THEN RAISE EXCEPTION 'Invalid rank batch' USING ERRCODE='22023';END IF;
 UPDATE public.explore_search_rank_jobs j SET lease=NULL,leased_at=NULL,next_attempt_at=now()+interval '1 minute' FROM jsonb_to_recordset(p_jobs) x(salon_id uuid,lease uuid) WHERE j.salon_id=x.salon_id AND j.lease=x.lease;
END $$;
CREATE FUNCTION public.publish_explore_search_rank_jobs(p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE accepted jsonb;rev bigint;item jsonb;g record;d public.explore_salon_documents;is_ready boolean;source_id uuid;source_key uuid;refresh_at timestamptz;published integer:=0;
BEGIN
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>100 THEN RAISE EXCEPTION 'Invalid rank batch' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'salon_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate rank job' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(126031,1);
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO accepted FROM jsonb_array_elements(p_rows) x JOIN public.explore_search_rank_jobs j ON j.salon_id=(x->>'salon_id')::uuid AND j.generation=(x->>'generation')::bigint AND j.lease=(x->>'lease')::uuid LEFT JOIN public.explore_search_rank_sources s ON s.salon_id=j.salon_id
 WHERE (s.salon_id IS NULL AND x->>'fingerprint' IS NULL) OR (s.fingerprint=x->>'fingerprint' AND x->>'rule_version'='lumi-trust-v2' AND (x->>'trust_score')::float8 BETWEEN 0 AND 1 AND (x->>'evidence_as_of')::timestamptz BETWEEN now()-interval '1 day' AND now()+interval '5 minutes');
 IF jsonb_array_length(accepted)>0 THEN
  UPDATE public.explore_search_rank_clock SET revision=revision+1,as_of=now() RETURNING revision INTO rev;
  FOR item IN SELECT value FROM jsonb_array_elements(accepted) LOOP
   source_id:=(item->>'salon_id')::uuid;
   UPDATE public.explore_search_rank_history SET valid_to=rev,retired_at=now() WHERE salon_id=source_id AND valid_to IS NULL;
   SELECT * INTO d FROM public.explore_salon_documents WHERE salon_id=source_id;
   IF FOUND THEN
    SELECT ready,source_token INTO is_ready,source_key FROM public.explore_search_rank_sources WHERE salon_id=source_id;
    refresh_at:=CASE WHEN coalesce((item->>'empty_evidence')::boolean,false) AND (SELECT may_skip_decay FROM public.get_explore_rank_refresh_policy(ARRAY[source_id])) THEN NULL ELSE (item->>'evidence_as_of')::timestamptz+interval '6 hours' END;
    FOR g IN SELECT group_id,group_key FROM public.explore_search_rank_groups WHERE group_key=ANY(public.explore_rank_document_group_keys(d)) LOOP
     INSERT INTO public.explore_search_rank_history(group_id,salon_id,valid_from,source_token,trust_score,bookable,point,latitude,longitude,computed_at,refresh_after,rule_version)
     VALUES(g.group_id,source_id,rev,source_key,(item->>'trust_score')::float8,coalesce((item->>'bookable')::boolean,false) AND EXISTS(SELECT 1 FROM public.booking_settings b JOIN public.services v ON v.salon_id=b.salon_id AND v.id=(item->>'bookable_service_id')::uuid WHERE b.salon_id=source_id AND b.booking_enabled AND b.online_booking_visible AND coalesce(b.guest_booking_enabled,true) AND v.is_active AND v.online_booking_enabled),
      CASE WHEN d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 THEN extensions.cube(ARRAY[extensions.cube_ll_coord(extensions.ll_to_earth(d.latitude,d.longitude),1),extensions.cube_ll_coord(extensions.ll_to_earth(d.latitude,d.longitude),2),extensions.cube_ll_coord(extensions.ll_to_earth(d.latitude,d.longitude),3),g.group_id::float8]) ELSE NULL END,d.latitude,d.longitude,(item->>'evidence_as_of')::timestamptz,refresh_at,item->>'rule_version');
     IF NOT is_ready THEN UPDATE public.explore_search_rank_groups SET ready_count=ready_count+1 WHERE group_id=g.group_id;END IF;
    END LOOP;
    UPDATE public.explore_search_rank_sources SET ready=true,computed_at=(item->>'evidence_as_of')::timestamptz,refresh_after=refresh_at WHERE salon_id=source_id;
   END IF;
   DELETE FROM public.explore_search_rank_jobs WHERE salon_id=source_id AND generation=(item->>'generation')::bigint AND lease=(item->>'lease')::uuid;
   published:=published+1;
  END LOOP;
 END IF;
 -- Release a superseded lease without deleting its newer work generation.
 UPDATE public.explore_search_rank_jobs j SET lease=NULL,leased_at=NULL,next_attempt_at=now() FROM jsonb_array_elements(p_rows) x WHERE j.salon_id=(x->>'salon_id')::uuid AND j.lease=(x->>'lease')::uuid;
 DELETE FROM public.explore_search_rank_history WHERE (group_id,salon_id,valid_from) IN (SELECT group_id,salon_id,valid_from FROM public.explore_search_rank_history WHERE retired_at<now()-interval '35 minutes' ORDER BY retired_at LIMIT 2000);
 RETURN jsonb_build_object('published',published,'rankVersion',rev,'hasMore',EXISTS(SELECT 1 FROM public.explore_search_rank_jobs WHERE next_attempt_at<=now() LIMIT 1));
END $$;
CREATE FUNCTION public.refresh_explore_search_rank_due(p_limit integer DEFAULT 100) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[];BEGIN
 SELECT array_agg(salon_id) INTO ids FROM (SELECT s.salon_id FROM public.explore_search_rank_sources s WHERE s.ready AND s.refresh_after<=now() AND NOT EXISTS(SELECT 1 FROM public.explore_search_rank_jobs j WHERE j.salon_id=s.salon_id) ORDER BY s.refresh_after,s.salon_id LIMIT least(1000,greatest(1,p_limit))) x;
 PERFORM public.explore_rank_enqueue(ids);RETURN coalesce(cardinality(ids),0);
END $$;

CREATE FUNCTION public.explore_search_configure_rank_session(p_session uuid,p_lat float8,p_lng float8) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.explore_search_sessions;region jsonb;covered boolean:=true;stale boolean:=false;address_rank boolean:=true;known_cat boolean;gps boolean;any_point boolean:=false;sorts text[]:=ARRAY['relevance','newest'];why text;
BEGIN
 SELECT * INTO STRICT s FROM public.explore_search_sessions WHERE id=p_session;
 gps:=coalesce(p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180,false);
 known_cat:=s.category_text=ANY(ARRAY['','nails','hair','lashes','barber','spa','brows','makeup','skin','skincare','massage','waxing','tattoo']);
 FOR region IN SELECT value FROM jsonb_array_elements(s.region_plan) LOOP
  IF region->>'kind'='exact' THEN CONTINUE;END IF;
  IF region->>'kind'='geo' THEN address_rank:=false;END IF;
  IF EXISTS(SELECT 1 FROM public.explore_search_rank_groups g WHERE g.group_key=public.explore_rank_scope_key(region,s.category_text) AND g.ready_count<g.total_count) THEN covered:=false;END IF;
  IF EXISTS(SELECT 1 FROM public.explore_search_rank_groups g JOIN public.explore_search_rank_history h ON h.group_id=g.group_id WHERE g.group_key=public.explore_rank_scope_key(region,s.category_text) AND h.valid_to IS NULL AND h.refresh_after<=now() LIMIT 1) THEN stale:=true;END IF;
  IF EXISTS(SELECT 1 FROM public.explore_search_rank_groups g WHERE g.group_key=public.explore_rank_scope_key(region,s.category_text) AND g.point_count>0) THEN any_point:=true;END IF;
 END LOOP;
 IF s.query_text='' AND known_cat AND covered AND NOT stale THEN
  IF address_rank THEN sorts:=sorts||ARRAY['trusted','bookable'];END IF;
  IF gps AND any_point THEN sorts:=sorts||ARRAY['closest'];END IF;
 END IF;
 IF NOT(s.requested_sort=ANY(sorts)) THEN
  why:=CASE WHEN s.requested_sort='closest' AND NOT gps THEN 'location_required' WHEN s.query_text<>'' THEN 'keyword_ranking_not_supported' WHEN NOT known_cat THEN 'category_ranking_not_supported' WHEN NOT covered THEN 'ranking_warming' WHEN stale THEN 'ranking_stale' WHEN s.requested_sort='closest' AND NOT any_point THEN 'coordinates_unavailable' ELSE 'radius_ranking_not_supported' END;
 END IF;
 UPDATE public.explore_search_sessions SET supported_sorts=sorts,applied_sort=CASE WHEN requested_sort=ANY(sorts) THEN requested_sort ELSE 'relevance' END,sort_fallback_reason=why,
  rank_version=CASE WHEN requested_sort=ANY(ARRAY['trusted','bookable','closest']) AND requested_sort=ANY(sorts) THEN (SELECT revision FROM public.explore_search_rank_clock) END,
  rank_as_of=CASE WHEN requested_sort=ANY(ARRAY['trusted','bookable','closest']) AND requested_sort=ANY(sorts) THEN (SELECT as_of FROM public.explore_search_rank_clock) END,
  rank_origin_latitude=CASE WHEN gps THEN p_lat END,rank_origin_longitude=CASE WHEN gps THEN p_lng END,
  ranking_basis=CASE WHEN requested_sort=ANY(ARRAY['trusted','bookable','closest']) AND requested_sort=ANY(sorts) THEN 'indexed_scope' ELSE 'candidate_pool' END WHERE id=p_session;
END $$;

-- Private derived aggregates, leases and immutable history are never exposed directly.
DO $$ DECLARE t text;f record;BEGIN
 FOREACH t IN ARRAY ARRAY['explore_search_rank_clock','explore_search_rank_sources','explore_search_rank_groups','explore_search_rank_jobs','explore_search_rank_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'explore_rank_%' OR p.proname=ANY(ARRAY['claim_explore_search_rank_jobs','fail_explore_search_rank_jobs','publish_explore_search_rank_jobs','refresh_explore_search_rank_due','get_explore_rank_refresh_policy','explore_search_configure_rank_session'])) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;

CREATE FUNCTION public._explore_search_pull_unranked_batch(p_session_id uuid) RETURNS integer
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
ALTER TABLE public.explore_search_session_candidates ADD COLUMN rank_source_token uuid;
CREATE OR REPLACE FUNCTION public.explore_search_pull_batch(p_session_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE s public.explore_search_sessions;region jsonb;g bigint;sort_expression text;center extensions.earth;target extensions.cube;box extensions.cube;earth_box extensions.cube;batch jsonb;candidate jsonb;last_raw jsonb;predicate text;inserted integer:=0;affected integer;old_bitmap text;anchor_sql text:='';radius float8;unlocated boolean:=false;d public.explore_salon_documents;
BEGIN
 SELECT * INTO STRICT s FROM public.explore_search_sessions WHERE id=p_session_id FOR UPDATE;
 IF s.rank_version IS NULL OR s.applied_sort NOT IN ('trusted','bookable','closest') THEN RETURN public._explore_search_pull_unranked_batch(p_session_id);END IF;
 IF s.exhausted THEN RETURN 0;END IF;
 region:=s.region_plan->s.region_index;
 IF region IS NULL THEN UPDATE public.explore_search_sessions SET exhausted=true WHERE id=s.id;RETURN 0;END IF;
 SELECT group_id INTO g FROM public.explore_search_rank_groups WHERE group_key=public.explore_rank_scope_key(region,s.category_text) AND total_count>0;
 IF g IS NULL THEN UPDATE public.explore_search_sessions SET region_index=region_index+1,region_anchor=NULL,exhausted=region_index+1>=jsonb_array_length(region_plan) WHERE id=s.id;RETURN 0;END IF;
 sort_expression:=CASE WHEN s.applied_sort='bookable' THEN 'h.bookable_order' ELSE 'h.trust_order' END;
 unlocated:=s.applied_sort='closest' AND coalesce(s.region_anchor->>'phase'='unlocated',false);
 IF s.applied_sort='closest' AND NOT unlocated THEN
  center:=extensions.ll_to_earth(s.rank_origin_latitude,s.rank_origin_longitude);
  target:=extensions.cube(ARRAY[extensions.cube_ll_coord(center,1),extensions.cube_ll_coord(center,2),extensions.cube_ll_coord(center,3),g::float8]);
  IF region->>'kind'='geo' THEN
   radius:=(region->>'radius')::float8;earth_box:=extensions.earth_box(center,radius);
   box:=extensions.cube(ARRAY[extensions.cube_ll_coord(earth_box,1),extensions.cube_ll_coord(earth_box,2),extensions.cube_ll_coord(earth_box,3),g::float8],ARRAY[extensions.cube_ur_coord(earth_box,1),extensions.cube_ur_coord(earth_box,2),extensions.cube_ur_coord(earth_box,3),g::float8]);
  ELSE
   box:=extensions.cube(ARRAY[-extensions.earth(),-extensions.earth(),-extensions.earth(),g::float8],ARRAY[extensions.earth(),extensions.earth(),extensions.earth(),g::float8]);
  END IF;
  sort_expression:='h.point OPERATOR(extensions.<->) $3';
 END IF;
 IF unlocated THEN sort_expression:='0::float8';END IF;
 IF s.region_anchor->>'id' IS NOT NULL THEN
  IF unlocated THEN anchor_sql:=format(' AND h.salon_id>%L::uuid',s.region_anchor->>'id');ELSE anchor_sql:=format(' AND ROW(%s,h.salon_id)>ROW(%L::float8,%L::uuid)',sort_expression,s.region_anchor->>'value',s.region_anchor->>'id');END IF;
 END IF;
 -- The OFFSET barrier keeps this as indexed per-candidate live-token probing,
 -- instead of a planner-chosen all-scope hash join followed by a global sort.
 -- Tombstone backlogs therefore do not consume 64 empty application batches.
 predicate:='h.group_id=$1 AND h.valid_from<=$2 AND (h.valid_to IS NULL OR h.valid_to>$2) AND EXISTS(SELECT 1 FROM public.explore_search_rank_sources source WHERE source.salon_id=h.salon_id AND source.source_token=h.source_token OFFSET 0)';
 IF unlocated THEN predicate:=predicate||' AND h.point IS NULL';
 ELSIF s.applied_sort='closest' THEN predicate:=predicate||' AND h.point IS NOT NULL AND $4 OPERATOR(extensions.@>) h.point';
  IF region->>'kind'='geo' THEN predicate:=predicate||format(' AND extensions.earth_distance(extensions.ll_to_earth(%L::float8,%L::float8),extensions.ll_to_earth(h.latitude,h.longitude))<=%L::float8',s.rank_origin_latitude,s.rank_origin_longitude,radius);END IF;
  old_bitmap:=current_setting('enable_bitmapscan');PERFORM set_config('enable_bitmapscan','off',true);
 END IF;
 BEGIN
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY raw_sort,salon_id),''[]''::jsonb) FROM (SELECT h.salon_id,h.source_token,h.trust_score,h.latitude,h.longitude,%s AS raw_sort FROM public.explore_search_rank_history h WHERE %s %s ORDER BY %s LIMIT 256) x',sort_expression,predicate,anchor_sql,CASE WHEN unlocated THEN 'h.salon_id' ELSE sort_expression||',h.salon_id' END) INTO batch USING g,s.rank_version,target,box;
  IF old_bitmap IS NOT NULL THEN PERFORM set_config('enable_bitmapscan',old_bitmap,true);END IF;
 EXCEPTION WHEN OTHERS THEN IF old_bitmap IS NOT NULL THEN PERFORM set_config('enable_bitmapscan',old_bitmap,true);END IF;RAISE;END;
 FOR candidate IN SELECT value FROM jsonb_array_elements(batch) LOOP
  SELECT doc.* INTO d FROM public.explore_salon_documents doc JOIN public.explore_search_rank_sources source ON source.salon_id=doc.salon_id AND source.source_token=(candidate->>'source_token')::uuid WHERE doc.salon_id=(candidate->>'salon_id')::uuid;
  IF NOT FOUND OR d.created_at>s.created_at OR (d.public_discovery_published_at IS NOT NULL AND d.public_discovery_published_at>s.created_at) OR NOT public.explore_search_live_match(d,region,s.query_text,s.use_fuzzy,s.category_text,false) THEN CONTINUE;END IF;
  INSERT INTO public.explore_search_session_candidates(session_id,ordinal,salon_id,search_scope,scope_label,eligibility_region,rank_score,distance_miles,match_type,rank_source_token)
  VALUES(s.id,s.next_ordinal,d.salon_id,region->>'scope',region->>'label',region,(candidate->>'trust_score')::float8,CASE WHEN s.rank_origin_latitude IS NOT NULL AND (candidate->>'latitude')::float8 BETWEEN -90 AND 90 AND (candidate->>'longitude')::float8 BETWEEN -180 AND 180 THEN extensions.earth_distance(extensions.ll_to_earth(s.rank_origin_latitude,s.rank_origin_longitude),extensions.ll_to_earth((candidate->>'latitude')::float8,(candidate->>'longitude')::float8))/1609.344 END,CASE WHEN s.applied_sort='closest' THEN 'distance' ELSE 'recommended' END,(candidate->>'source_token')::uuid)
  ON CONFLICT(session_id,salon_id) DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected>0 THEN s.next_ordinal:=s.next_ordinal+1;inserted:=inserted+1;END IF;
 END LOOP;
 last_raw:=batch->-1;
 IF jsonb_array_length(batch)<256 THEN
  IF s.applied_sort='closest' AND NOT unlocated AND region->>'kind'<>'geo' THEN s.region_anchor:=jsonb_build_object('phase','unlocated');ELSE s.region_index:=s.region_index+1;s.region_anchor:=NULL;END IF;
 ELSE s.region_anchor:=jsonb_build_object('value',last_raw->>'raw_sort','id',last_raw->>'salon_id','phase',CASE WHEN unlocated THEN 'unlocated' ELSE 'located' END);END IF;
 UPDATE public.explore_search_sessions SET next_ordinal=s.next_ordinal,region_index=s.region_index,region_anchor=s.region_anchor,exhausted=s.region_index>=jsonb_array_length(s.region_plan) WHERE id=s.id;
 RETURN inserted;
END $$;
REVOKE ALL ON FUNCTION public._explore_search_pull_unranked_batch(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.explore_search_pull_batch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._explore_search_pull_unranked_batch(uuid),public.explore_search_pull_batch(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.search_public_explore_session(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision, p_sort text DEFAULT 'relevance'::text, p_limit integer DEFAULT 12, p_cursor jsonb DEFAULT NULL::jsonb, p_scope_policy text DEFAULT 'fixed'::text, p_intent text DEFAULT 'search'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
 SET jit TO 'off'
 SET "pg_trgm.word_similarity_threshold" TO '0.65'
AS $function$
DECLARE q text:=coalesce(public.normalize_search_text(p_query),''); cat text:=coalesce(public.normalize_search_text(p_category),'');
 location_value text:=coalesce(public.normalize_search_text(p_location),''); requested_sort text:=lower(coalesce(nullif(p_sort,''),'relevance')); applied_sort text;
 policy text:=coalesce(p_scope_policy,'fixed'); intent_value text:=coalesce(p_intent,'search'); page_limit integer:=least(20,greatest(1,coalesce(p_limit,12)));
 viewer text:=coalesce(public.current_public_user_id()::text,'guest'); signature_value text; s public.explore_search_sessions%ROWTYPE; search_session_id uuid;
 after_ordinal bigint:=0; region jsonb; plan jsonb:='[]'::jsonb; wider_region jsonb; excluded jsonb; state_value text; states text[];
 exact_exists boolean; fuzzy_exists boolean; text_predicate text; predicate text; batch jsonb; page_rows jsonb; next_token jsonb; last_ordinal bigint; more boolean; attempts integer:=0; last_scope jsonb; initial_region jsonb;
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
  -- A globally absent fuzzy name cannot occur in any A/B/C region. Avoid
  -- repeating that same negative name-index probe in every state. A positive
  -- probe keeps the existing regional plan, ordering and cursor behavior.
  IF q<>'' AND length(q)>=3 AND NOT exact_exists THEN
   text_predicate:=public.explore_search_text_predicate(q,true);
   IF cat<>'' THEN text_predicate:=text_predicate||format(' AND d.service_category_search_text LIKE %L','%'||cat||'%'); END IF;
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.explore_salon_documents d WHERE d.created_at<=now() AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now()) AND %s LIMIT 1)',text_predicate) INTO fuzzy_exists;
   IF NOT fuzzy_exists THEN plan:='[]'::jsonb; END IF;
  END IF;
  INSERT INTO public.explore_search_sessions(id,user_id,viewer_key,signature,query_text,category_text,requested_sort,applied_sort,scope_policy,intent,preferred_categories,use_fuzzy,region_plan,exhausted)
  VALUES(search_session_id,public.current_public_user_id(),viewer,signature_value,q,cat,requested_sort,applied_sort,policy,intent_value,public.explore_preferred_categories(),q<>'' AND length(q)>=3 AND NOT exact_exists,plan,jsonb_array_length(plan)=0);
  PERFORM public.explore_search_configure_rank_session(search_session_id,p_latitude,p_longitude);
  SELECT * INTO s FROM public.explore_search_sessions WHERE id=search_session_id FOR UPDATE;
 END IF;
 LOOP
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY ordinal),'[]'::jsonb) INTO batch FROM (
   SELECT c.* FROM public.explore_search_session_candidates c JOIN public.explore_salon_documents d ON d.salon_id=c.salon_id
   WHERE c.session_id=search_session_id AND c.ordinal>after_ordinal
    AND d.created_at<=s.created_at AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=s.created_at)
    AND (c.rank_source_token IS NULL OR EXISTS(SELECT 1 FROM public.explore_search_rank_sources source WHERE source.salon_id=c.salon_id AND source.source_token=c.rank_source_token))
    AND public.explore_search_live_match(d,c.eligibility_region,s.query_text,s.use_fuzzy,s.category_text,c.search_scope='exact')
   ORDER BY c.ordinal LIMIT page_limit+1
  ) x;
  EXIT WHEN jsonb_array_length(batch)>page_limit OR s.exhausted;
  PERFORM public.explore_search_pull_batch(search_session_id);
  DELETE FROM public.explore_search_session_candidates c WHERE c.session_id=search_session_id
   AND NOT EXISTS(SELECT 1 FROM public.explore_salon_documents d WHERE d.salon_id=c.salon_id
    AND d.created_at<=s.created_at AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=s.created_at)
    AND (c.rank_source_token IS NULL OR EXISTS(SELECT 1 FROM public.explore_search_rank_sources source WHERE source.salon_id=c.salon_id AND source.source_token=c.rank_source_token))
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
    AND (c.rank_source_token IS NULL OR EXISTS(SELECT 1 FROM public.explore_search_rank_sources source WHERE source.salon_id=c.salon_id AND source.source_token=c.rank_source_token))
  AND public.explore_search_live_match(d,c.eligibility_region,s.query_text,s.use_fuzzy,s.category_text,c.search_scope='exact');
 more:=jsonb_array_length(batch)>page_limit;
 last_ordinal:=coalesce((page_rows->-1->'pagination_cursor'->>'after')::bigint,after_ordinal);
 next_token:=CASE WHEN more THEN jsonb_build_object('version',2,'session',search_session_id,'after',last_ordinal) ELSE NULL END;
 last_scope:=jsonb_build_object('policy',s.scope_policy,'stage',coalesce(page_rows->-1->>'search_scope','A'),'label',coalesce(page_rows->-1->>'scope_label',''),'expanded',initial_region IS NOT NULL AND coalesce(page_rows->-1->>'search_scope','A') IN ('B','C'));
 RETURN jsonb_build_object('rows',page_rows,'hasMore',more,'nextCursor',next_token,'cursor',next_token,'scope',last_scope,'countKind','loaded','totalCount',s.next_ordinal-1,'requestedSort',s.requested_sort,'appliedSort',s.applied_sort,'fuzzy',s.use_fuzzy,'supportedSorts',to_jsonb(s.supported_sorts),'sortFallbackReason',s.sort_fallback_reason,'rankVersion',s.rank_version,'rankAsOf',s.rank_as_of,'rankingBasis',s.ranking_basis);
END $function$;
COMMENT ON TABLE public.explore_search_rank_history IS 'Immutable canonical aggregate revisions; historical versions are retained beyond 30-minute search TTL. No customer evidence is stored.';
NOTIFY pgrst,'reload schema';
COMMIT;
