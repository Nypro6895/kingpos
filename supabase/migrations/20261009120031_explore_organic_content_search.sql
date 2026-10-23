-- Public post theme search. The private keyword projection contains only
-- currently public media documents and is rebuilt atomically on their edits.
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE TABLE public.explore_social_content_keywords (
 content_key text PRIMARY KEY REFERENCES public.explore_social_content_documents(content_key) ON DELETE CASCADE,
 search_terms tsvector NOT NULL,
 state_code text,city_search text,postal_code text,latitude double precision,longitude double precision,
 published_at timestamptz NOT NULL
);
CREATE INDEX explore_social_keyword_terms_idx ON public.explore_social_content_keywords USING gin(search_terms);
CREATE INDEX explore_social_keyword_new_idx ON public.explore_social_content_keywords(published_at DESC,content_key);
CREATE INDEX explore_social_keyword_state_idx ON public.explore_social_content_keywords(state_code,content_key);
CREATE INDEX explore_social_keyword_city_idx ON public.explore_social_content_keywords(city_search,state_code,content_key);
CREATE INDEX explore_social_keyword_postal_idx ON public.explore_social_content_keywords((left(coalesce(postal_code,''),5)),content_key);
CREATE INDEX explore_social_keyword_earth_idx ON public.explore_social_content_keywords USING gist(extensions.ll_to_earth(latitude,longitude))
 WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;
ALTER TABLE public.explore_social_content_keywords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_social_content_keywords FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.explore_social_content_keywords TO service_role;

CREATE FUNCTION public.refresh_explore_social_keywords(p_keys text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF coalesce(cardinality(p_keys),0)=0 THEN RETURN; END IF;
 INSERT INTO explore_social_content_keywords(content_key,search_terms,state_code,city_search,postal_code,latitude,longitude,published_at)
 SELECT d.content_key,
 setweight(to_tsvector('english',coalesce(l.title,u.title,'')),'A')||setweight(to_tsvector('english',coalesce(l.caption,u.caption,u.summary,p.caption,'')),'B'),
 d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,d.published_at
 FROM explore_social_content_documents d
 LEFT JOIN salon_profile_looks l ON d.source_type='salon_profile_look' AND l.id=d.content_id
 LEFT JOIN salon_profile_updates u ON d.source_type='salon_profile_update' AND u.id=d.content_id
 LEFT JOIN beauty_posts p ON d.source_type='beauty_post' AND p.id=d.content_id
 WHERE d.content_key=ANY(p_keys)
 ON CONFLICT(content_key) DO UPDATE SET search_terms=excluded.search_terms,state_code=excluded.state_code,
 city_search=excluded.city_search,postal_code=excluded.postal_code,latitude=excluded.latitude,longitude=excluded.longitude,published_at=excluded.published_at;
END $$;
CREATE FUNCTION public.sync_explore_social_keywords() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE keys text[];
BEGIN
 SELECT array_agg(content_key) INTO keys FROM keyword_new;
 PERFORM refresh_explore_social_keywords(keys); RETURN NULL;
END $$;
CREATE TRIGGER explore_social_keyword_insert AFTER INSERT ON public.explore_social_content_documents REFERENCING NEW TABLE AS keyword_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_social_keywords();
CREATE TRIGGER explore_social_keyword_update AFTER UPDATE ON public.explore_social_content_documents REFERENCING NEW TABLE AS keyword_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_social_keywords();
SELECT public.refresh_explore_social_keywords(array_agg(content_key)) FROM public.explore_social_content_documents;
ANALYZE public.explore_social_content_keywords;

-- Existing live page/cache eligibility uses this predicate, so edits that
-- remove the theme cannot reappear through an old session or restored cache.
CREATE OR REPLACE FUNCTION public.explore_social_filter_predicate(p_filters jsonb,p_region jsonb,p_directory boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE predicate text:=public.explore_search_region_predicate(p_region); category text:=public.normalize_search_text(coalesce(p_filters->>'category','')); price numeric; query text:=btrim(coalesce(p_filters->>'query',''));
BEGIN
 IF category NOT IN ('','all') THEN predicate:=predicate||format(' AND d.%I LIKE %L',CASE WHEN p_directory THEN 'service_category_search_text' ELSE 'category_search' END,'%'||category||'%'); END IF;
 IF p_filters->>'maxPrice' IS NOT NULL THEN price:=(p_filters->>'maxPrice')::numeric; predicate:=predicate||format(' AND d.starting_price<=%L::numeric',price); END IF;
 IF coalesce((p_filters->>'newOnly')::boolean,false) THEN predicate:=predicate||CASE WHEN p_directory THEN ' AND d.created_at>=now()-interval ''30 days''' ELSE ' AND d.published_at>=now()-interval ''30 days''' END; END IF;
 IF coalesce((p_filters->>'bookableOnly')::boolean,false) THEN predicate:=predicate||CASE WHEN p_directory THEN ' AND EXISTS(SELECT 1 FROM public.booking_settings bs WHERE bs.salon_id=d.salon_id AND bs.booking_enabled AND bs.online_booking_visible AND coalesce(bs.guest_booking_enabled,true)) AND EXISTS(SELECT 1 FROM public.services s WHERE s.salon_id=d.salon_id AND s.is_active AND s.online_booking_enabled)' ELSE ' AND d.bookable' END;
 END IF;
 IF coalesce((p_filters->>'trendingOnly')::boolean,false) THEN predicate:=predicate||CASE WHEN p_directory THEN ' AND false' ELSE ' AND EXISTS(SELECT 1 FROM public.explore_social_trending cached WHERE cached.content_key=d.content_key)' END; END IF;
 IF query<>'' THEN predicate:=predicate||CASE WHEN p_directory THEN ' AND false' ELSE format(' AND EXISTS(SELECT 1 FROM public.explore_social_content_keywords keywords WHERE keywords.content_key=d.content_key AND keywords.search_terms @@ plainto_tsquery(''english'',%L))',query) END; END IF;
 RETURN predicate;
END $$;

CREATE FUNCTION public.get_explore_social_keyword_matches(p_filters jsonb,p_region jsonb,p_scope text,p_as_of timestamptz,p_limit integer DEFAULT 256,p_since timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE query text:=btrim(coalesce(p_filters->>'query','')); predicate text; keyword_region text; result jsonb; ordered text:='';
BEGIN
 IF query='' OR numnode(plainto_tsquery('english',query))=0 THEN RETURN '[]'::jsonb; END IF;
 keyword_region:=public.explore_search_region_predicate(p_region)||format(' AND d.published_at<=%L::timestamptz',p_as_of);
 predicate:=public.explore_social_filter_predicate(p_filters-'query',p_region,false)||format(' AND d.published_at<=%L::timestamptz AND (d.salon_id IS NULL OR EXISTS(SELECT 1 FROM explore_salon_documents published_salon WHERE published_salon.salon_id=d.salon_id AND (published_salon.public_discovery_published_at IS NULL OR published_salon.public_discovery_published_at<=%L::timestamptz)))',p_as_of,p_as_of);
 IF p_since IS NOT NULL THEN keyword_region:=keyword_region||format(' AND d.published_at>%L::timestamptz',p_since); END IF;
 IF p_filters->>'intent'='latest' THEN ordered:=' ORDER BY k.published_at DESC,k.content_key'; END IF;
 -- Full compound keyword and region/public/filter eligibility come before the
 -- candidate cap. Index entries may grow with matches; ranking/hydration do not.
 EXECUTE 'WITH matched AS MATERIALIZED (
 SELECT k.content_key,k.search_terms FROM explore_social_content_keywords k
 JOIN explore_social_content_documents d USING(content_key)
 WHERE k.search_terms @@ plainto_tsquery(''english'',$1) AND '||replace(keyword_region,'d.','k.')||' AND '||predicate||ordered||'
 LIMIT least(384,greatest(1,$2))
 ) SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."matchScore" DESC,x."publishedAt" DESC,x."contentKey"),''[]'')
 FROM (SELECT d.content_key AS "contentKey",d.source_type AS "sourceType",d.content_id AS "contentId",d.salon_id AS "salonId",d.published_at AS "publishedAt",''new'' AS lane,$3 AS scope,
 ts_rank_cd(m.search_terms,plainto_tsquery(''english'',$1)) AS "matchScore"
 FROM matched m JOIN explore_social_content_documents d USING(content_key)) x' INTO result USING query,p_limit,p_scope;
 RETURN result;
END $$;

CREATE FUNCTION public.get_explore_social_keyword_pool(p_actor_key text,p_filters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE cfg explore_social_feed_config; region jsonb; at_time timestamptz:=clock_timestamp(); fresh jsonb:='[]'; recent jsonb:='[]'; expanded jsonb:='[]'; trending jsonb:='[]'; personal jsonb:='[]'; seen jsonb:='[]'; actor_user uuid; cats text[]:='{}'; follows uuid[]:='{}'; profiles uuid[]:='{}'; scope text;
BEGIN
 IF p_actor_key !~ '^(user:[0-9a-fA-F-]{36}|guest:[0-9a-fA-F]{64})$' THEN RAISE EXCEPTION 'Invalid feed actor'; END IF;
 SELECT * INTO cfg FROM explore_social_feed_config WHERE id;
 region:=public.explore_search_region(p_filters->>'location',(p_filters->>'latitude')::float8,(p_filters->>'longitude')::float8);
 scope:=CASE WHEN region->>'kind'='global' THEN 'wider' ELSE 'local' END;
 fresh:=get_explore_social_keyword_matches(p_filters,region,scope,at_time,256);
 IF coalesce(p_filters->>'intent','discover')<>'latest' THEN
  -- Guarantee that refreshing after the new-post watermark can expose the new
  -- matching post, even when an older relevance sample already fills the cap.
  recent:=get_explore_social_keyword_matches(p_filters||'{"intent":"latest"}',region,scope,at_time,12);
  SELECT coalesce(jsonb_agg(e ORDER BY priority,CASE WHEN priority=0 THEN (e->>'publishedAt')::timestamptz END DESC,CASE WHEN priority=1 THEN (e->>'matchScore')::numeric END DESC,(e->>'publishedAt')::timestamptz DESC,e->>'contentKey'),'[]') INTO fresh
  FROM(SELECT DISTINCT ON(e->>'contentKey') e,priority FROM(
   SELECT e,0 AS priority FROM jsonb_array_elements(recent) e
   UNION ALL SELECT e,1 FROM jsonb_array_elements(fresh) e
  ) candidates ORDER BY e->>'contentKey',priority) deduplicated;
 END IF;
 IF region->>'kind'<>'global' AND NOT coalesce((p_filters->>'strictLocation')::boolean,false) THEN
  expanded:=get_explore_social_keyword_matches(p_filters,jsonb_build_object('kind','global','exclude_region',region),'wider',at_time,128);
  SELECT coalesce(jsonb_agg(e||jsonb_build_object('lane','expanded')),'[]') INTO expanded FROM jsonb_array_elements(expanded) e;
 END IF;
 SELECT coalesce(jsonb_agg(e||jsonb_build_object('lane','trending','score',t.score) ORDER BY t.score DESC),'[]') INTO trending
 FROM (SELECT e FROM jsonb_array_elements(fresh||expanded) e JOIN explore_social_trending t ON t.content_key=e->>'contentKey' ORDER BY t.score DESC LIMIT 96) matched
 JOIN explore_social_trending t ON t.content_key=e->>'contentKey';
 IF cfg.personalization_enabled AND left(p_actor_key,5)='user:' THEN
  actor_user:=substring(p_actor_key FROM 6)::uuid; cats:=explore_social_interest_categories(actor_user);
  SELECT coalesce(array_agg(salon_id),'{}') INTO follows FROM(SELECT salon_id FROM salon_profile_follows WHERE user_id=actor_user ORDER BY created_at DESC LIMIT 100) f;
  SELECT coalesce(array_agg(profile_id),'{}') INTO profiles FROM(SELECT profile_id FROM beauty_profile_follows WHERE user_id=actor_user ORDER BY created_at DESC LIMIT 100) f;
  SELECT coalesce(jsonb_agg(e||jsonb_build_object('lane','personal')),'[]') INTO personal FROM (
   SELECT e FROM jsonb_array_elements(fresh) e JOIN explore_social_content_documents d ON d.content_key=e->>'contentKey'
   WHERE d.salon_id=ANY(follows) OR d.profile_id=ANY(profiles) OR d.categories&&cats LIMIT 96
  ) matched;
 END IF;
 SELECT coalesce(jsonb_agg(content_key),'[]') INTO seen FROM(SELECT DISTINCT content_key FROM(SELECT content_key FROM explore_social_actor_events WHERE actor_key=p_actor_key AND kind='meaningful_view' AND occurred_at>=now()-make_interval(hours=>cfg.seen_hours) ORDER BY occurred_at DESC LIMIT 2000) latest_events) e;
 IF coalesce((p_filters->>'trendingOnly')::boolean,false) THEN fresh:='[]';personal:='[]';expanded:='[]'; END IF;
 RETURN jsonb_build_object('asOf',at_time,'region',region,'seed',gen_random_uuid(),'weights',cfg.weights,'seenKeys',seen,
 'personalizationEnabled',cfg.personalization_enabled,'lanes',jsonb_build_object('trending',trending,'new',fresh,'personal',personal,'expanded',expanded));
END $$;

REVOKE ALL ON FUNCTION public.refresh_explore_social_keywords(text[]),public.sync_explore_social_keywords(),public.get_explore_social_keyword_matches(jsonb,jsonb,text,timestamptz,integer,timestamptz),public.get_explore_social_keyword_pool(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_explore_social_keywords(text[]),public.sync_explore_social_keywords(),public.get_explore_social_keyword_matches(jsonb,jsonb,text,timestamptz,integer,timestamptz),public.get_explore_social_keyword_pool(text,jsonb) TO service_role;
-- Existing candidate/update bodies are appended below with only the keyword
-- routing branches changed. Existing publication and session guards remain.

CREATE OR REPLACE FUNCTION public.get_explore_social_candidate_pool(p_actor_key text,p_filters jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit='off' AS $$
DECLARE cfg explore_social_feed_config; region jsonb; predicate text; broader jsonb; seed text:=gen_random_uuid()::text;
 as_of timestamptz:=clock_timestamp(); fresh jsonb:='[]'; trending jsonb:='[]'; personal jsonb:='[]'; expanded jsonb:='[]'; directory jsonb:='[]'; local_directory jsonb:='[]'; seen jsonb:='[]'; cats text[]:='{}'; followed uuid[]:='{}'; profiles uuid[]:='{}'; actor_user_id uuid; is_global boolean; pivot uuid:=gen_random_uuid();
BEGIN
 IF nullif(btrim(coalesce(p_filters->>'query','')),'') IS NOT NULL THEN RETURN get_explore_social_keyword_pool(p_actor_key,p_filters); END IF;
 IF p_actor_key !~ '^(user:[0-9a-fA-F-]{36}|guest:[0-9a-fA-F]{64})$' THEN RAISE EXCEPTION 'Invalid feed actor'; END IF;
 SELECT * INTO cfg FROM explore_social_feed_config WHERE id;
 region:=public.explore_search_region(p_filters->>'location',(p_filters->>'latitude')::float8,(p_filters->>'longitude')::float8);
 is_global:=region->>'kind'='global'; broader:=jsonb_build_object('kind','global');
 predicate:=public.explore_social_filter_predicate(p_filters,region,false)||format(' AND d.published_at<=%L::timestamptz AND (d.salon_id IS NULL OR EXISTS(SELECT 1 FROM explore_salon_documents published_salon WHERE published_salon.salon_id=d.salon_id AND (published_salon.public_discovery_published_at IS NULL OR published_salon.public_discovery_published_at<=%L::timestamptz)))',as_of,as_of);
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT d.content_key AS "contentKey",d.source_type AS "sourceType",d.content_id AS "contentId",d.salon_id AS "salonId",d.published_at AS "publishedAt",''new'' AS lane,'||quote_literal(CASE WHEN is_global THEN 'wider' ELSE 'local' END)||' AS scope FROM explore_social_content_documents d WHERE '||predicate||' ORDER BY d.published_at DESC,d.content_key LIMIT 96) x' INTO fresh;
 -- Trend scores are precomputed; this request never aggregates engagement.
 EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT d.content_key AS "contentKey",c.source_type AS "sourceType",c.content_id AS "contentId",c.salon_id AS "salonId",c.published_at AS "publishedAt",d.score,''trending'' AS lane,'||quote_literal(CASE WHEN is_global THEN 'wider' ELSE 'local' END)||' AS scope FROM explore_social_trending d JOIN explore_social_content_documents c USING(content_key) WHERE '||replace(replace(replace(replace(predicate,'d.starting_price','c.starting_price'),'d.published_at','c.published_at'),'d.bookable','c.bookable'),'d.salon_id','c.salon_id')||' ORDER BY d.score DESC,d.content_key LIMIT 96) x' INTO trending;
 IF cfg.personalization_enabled AND left(p_actor_key,5)='user:' THEN
  actor_user_id:=substring(p_actor_key FROM 6)::uuid;
  SELECT public.explore_social_interest_categories(actor_user_id) INTO cats;
  SELECT coalesce(array_agg(salon_id),'{}') INTO followed FROM (SELECT salon_id FROM salon_profile_follows f WHERE f.user_id=actor_user_id ORDER BY created_at DESC LIMIT 100) f;
  SELECT coalesce(array_agg(profile_id),'{}') INTO profiles FROM (SELECT profile_id FROM beauty_profile_follows f WHERE f.user_id=actor_user_id ORDER BY created_at DESC LIMIT 100) f;
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT d.content_key AS "contentKey",d.source_type AS "sourceType",d.content_id AS "contentId",d.salon_id AS "salonId",d.published_at AS "publishedAt",''personal'' AS lane,'||quote_literal(CASE WHEN is_global THEN 'wider' ELSE 'local' END)||' AS scope FROM explore_social_content_documents d WHERE '||predicate||format(' AND (d.salon_id=ANY(%L::uuid[]) OR d.profile_id=ANY(%L::uuid[]) OR d.categories&&%L::text[])',followed,profiles,coalesce(cats,'{}'))||' ORDER BY d.published_at DESC,d.content_key LIMIT 96) x' INTO personal;
 END IF;
 IF NOT coalesce((p_filters->>'strictLocation')::boolean,false) AND NOT is_global THEN
  predicate:=public.explore_social_filter_predicate(p_filters,broader,false)||' AND NOT(coalesce(('||public.explore_search_region_predicate(region)||'),false))'||format(' AND d.published_at<=%L::timestamptz AND (d.salon_id IS NULL OR EXISTS(SELECT 1 FROM explore_salon_documents published_salon WHERE published_salon.salon_id=d.salon_id AND (published_salon.public_discovery_published_at IS NULL OR published_salon.public_discovery_published_at<=%L::timestamptz)))',as_of,as_of);
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT d.content_key AS "contentKey",d.source_type AS "sourceType",d.content_id AS "contentId",d.salon_id AS "salonId",d.published_at AS "publishedAt",''expanded'' AS lane,''wider'' AS scope FROM explore_social_content_documents d WHERE '||predicate||' ORDER BY d.published_at DESC,d.content_key LIMIT 64) x' INTO expanded;
 END IF;
 IF NOT is_global THEN
  predicate:=public.explore_social_filter_predicate(p_filters,region,true)||format(' AND d.created_at<=%L::timestamptz',as_of);
  -- Indexed UUID retrieval bounds the pool before seed-based ordering.
  predicate:=predicate||format(' AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=%L::timestamptz)',as_of);
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM ((SELECT ''directory:''||d.salon_id AS "contentKey",''directory'' AS "sourceType",d.salon_id AS "contentId",d.salon_id AS "salonId",NULL::timestamptz AS "publishedAt",''expanded'' AS lane,''local'' AS scope FROM explore_salon_documents d WHERE '||predicate||format(' AND d.salon_id>=%L::uuid',pivot)||' ORDER BY d.salon_id LIMIT 64) UNION ALL (SELECT ''directory:''||d.salon_id AS "contentKey",''directory'' AS "sourceType",d.salon_id AS "contentId",d.salon_id AS "salonId",NULL::timestamptz AS "publishedAt",''expanded'' AS lane,''local'' AS scope FROM explore_salon_documents d WHERE '||predicate||format(' AND d.salon_id<%L::uuid',pivot)||' ORDER BY d.salon_id LIMIT 64)) x' INTO local_directory;
 END IF;
 IF is_global OR NOT coalesce((p_filters->>'strictLocation')::boolean,false) THEN
  predicate:=public.explore_social_filter_predicate(p_filters,broader,true)||format(' AND d.created_at<=%L::timestamptz AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=%L::timestamptz)',as_of,as_of);
  IF NOT is_global THEN predicate:=predicate||' AND NOT(coalesce(('||public.explore_search_region_predicate(region)||'),false))'; END IF;
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT ''directory:''||d.salon_id AS "contentKey",''directory'' AS "sourceType",d.salon_id AS "contentId",d.salon_id AS "salonId",NULL::timestamptz AS "publishedAt",''expanded'' AS lane,''wider'' AS scope FROM (SELECT state_code FROM explore_social_directory_pool GROUP BY state_code ORDER BY md5(state_code||'||quote_literal(seed)||') LIMIT 12) states JOIN explore_social_directory_pool pool USING(state_code) JOIN explore_salon_documents d USING(salon_id) WHERE '||predicate||' ORDER BY md5(d.salon_id::text||'||quote_literal(seed)||') LIMIT 128) x' INTO directory;
 END IF;
 SELECT coalesce(jsonb_agg(content_key),'[]') INTO seen FROM (SELECT DISTINCT content_key FROM (SELECT content_key FROM explore_social_actor_events WHERE actor_key=p_actor_key AND kind='meaningful_view' AND occurred_at>=now()-make_interval(hours=>cfg.seen_hours) ORDER BY occurred_at DESC LIMIT 2000) latest_events) e;
 IF coalesce((p_filters->>'trendingOnly')::boolean,false) THEN fresh:='[]'; personal:='[]'; expanded:='[]'; local_directory:='[]'; directory:='[]'; END IF;
 RETURN jsonb_build_object('asOf',as_of,'region',region,'seed',seed,'weights',cfg.weights,'seenKeys',seen,'personalizationEnabled',cfg.personalization_enabled,
  'lanes',jsonb_build_object('trending',trending,'new',fresh,'personal',personal,'expanded',expanded||local_directory||directory));
END $$;
CREATE OR REPLACE FUNCTION public.get_explore_social_feed_updates(p_actor_key text,p_filters jsonb,p_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan AS $$
DECLARE s explore_social_feed_sessions; newest timestamptz; predicate text;
BEGIN
 SELECT * INTO s FROM explore_social_feed_sessions WHERE id=(p_cursor->>'session')::uuid AND actor_key=p_actor_key AND expires_at>now();
 IF s.id IS NULL OR s.filter_hash<>md5(p_filters::text) THEN RAISE EXCEPTION 'Feed session expired or filters changed' USING ERRCODE='22023'; END IF;
 IF nullif(btrim(coalesce(s.filters->>'query','')),'') IS NOT NULL THEN
  SELECT max((e->>'publishedAt')::timestamptz) INTO newest FROM jsonb_array_elements(get_explore_social_keyword_matches(s.filters,s.region,CASE WHEN s.region->>'kind'='global' THEN 'wider' ELSE 'local' END,now(),1,s.as_of)) e;
  RETURN jsonb_build_object('hasNewPosts',coalesce(newest>s.as_of,false),'newestPublishedAt',newest);
 END IF;
 predicate:=public.explore_social_filter_predicate(s.filters,s.region,false)||' AND d.published_at<=now() AND (d.salon_id IS NULL OR EXISTS(SELECT 1 FROM explore_salon_documents published_salon WHERE published_salon.salon_id=d.salon_id AND (published_salon.public_discovery_published_at IS NULL OR published_salon.public_discovery_published_at<=now())))';
 EXECUTE 'SELECT d.published_at FROM explore_social_content_documents d WHERE '||predicate||' ORDER BY d.published_at DESC,d.content_key LIMIT 1' INTO newest;
 RETURN jsonb_build_object('hasNewPosts',coalesce(newest>s.as_of,false),'newestPublishedAt',newest);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
