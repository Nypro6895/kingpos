-- Phase4. Apply only after private interest and diversity regression gates pass.
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE INDEX IF NOT EXISTS explore_social_account_interest_idx ON public.account_post_saves(user_id,created_at DESC,source_type,source_id);
CREATE INDEX IF NOT EXISTS explore_social_look_interest_idx ON public.salon_profile_look_saves(user_id,created_at DESC,look_id);
CREATE FUNCTION public.explore_social_interest_categories(p_user_id uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH saved AS MATERIALIZED (
  SELECT content_key,max(created_at) AS created_at FROM (
   (SELECT source_type||':'||source_id AS content_key,created_at FROM account_post_saves WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 50)
   UNION ALL (SELECT 'salon_profile_look:'||look_id,created_at FROM salon_profile_look_saves WHERE user_id=p_user_id ORDER BY created_at DESC LIMIT 50)
  ) recent GROUP BY content_key ORDER BY max(created_at) DESC LIMIT 50
 ), choices AS (
  SELECT category,0 AS priority FROM explore_user_preferences p,unnest(p.categories) category WHERE p.user_id=p_user_id
  UNION ALL SELECT category,1 FROM saved JOIN explore_social_content_documents d USING(content_key),unnest(d.categories) category
 ), limited AS (
  SELECT category,min(priority) AS priority FROM choices WHERE nullif(btrim(category),'') IS NOT NULL GROUP BY category ORDER BY min(priority),category LIMIT 20
 ) SELECT coalesce(array_agg(category ORDER BY priority,category),'{}') FROM limited
$$;
REVOKE ALL ON FUNCTION public.explore_social_interest_categories(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.explore_social_interest_categories(uuid) TO service_role;
-- The full replacement below is generated from the reviewed Phase3 function;
-- only the personal interest lookup and the global personal scope label differ.

CREATE OR REPLACE FUNCTION public.get_explore_social_candidate_pool(p_actor_key text,p_filters jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan SET jit='off' AS $$
DECLARE cfg explore_social_feed_config; region jsonb; predicate text; broader jsonb; seed text:=gen_random_uuid()::text;
 as_of timestamptz:=clock_timestamp(); fresh jsonb:='[]'; trending jsonb:='[]'; personal jsonb:='[]'; expanded jsonb:='[]'; directory jsonb:='[]'; local_directory jsonb:='[]'; seen jsonb:='[]'; cats text[]:='{}'; followed uuid[]:='{}'; profiles uuid[]:='{}'; actor_user_id uuid; is_global boolean; pivot uuid:=gen_random_uuid();
BEGIN
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
UPDATE public.explore_social_feed_config SET personalization_enabled=true WHERE id;
NOTIFY pgrst,'reload schema';
COMMIT;
