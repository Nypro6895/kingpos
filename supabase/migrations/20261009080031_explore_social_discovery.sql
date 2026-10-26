-- Private bounded social discovery queues. Source data remains authoritative.
BEGIN;
SET LOCAL search_path=public,extensions;

CREATE TABLE public.explore_social_content_documents (
 content_key text PRIMARY KEY,
 source_type text NOT NULL CHECK(source_type IN ('salon_profile_look','salon_profile_update','beauty_post')),
 content_id uuid NOT NULL,
 salon_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
 profile_id uuid,
 published_at timestamptz NOT NULL,
 state_code text, city_search text, postal_code text,
 latitude double precision, longitude double precision,
 category_search text NOT NULL DEFAULT '', categories text[] NOT NULL DEFAULT '{}',
 starting_price numeric, bookable boolean NOT NULL DEFAULT false,
 UNIQUE(source_type,content_id)
);
CREATE INDEX explore_social_new_idx ON public.explore_social_content_documents(published_at DESC,content_key);
CREATE INDEX explore_social_state_new_idx ON public.explore_social_content_documents(state_code,published_at DESC,content_key);
CREATE INDEX explore_social_city_new_idx ON public.explore_social_content_documents(city_search,state_code,published_at DESC,content_key);
CREATE INDEX explore_social_postal_new_idx ON public.explore_social_content_documents((left(coalesce(postal_code,''),5)),published_at DESC,content_key);
CREATE INDEX explore_social_salon_new_idx ON public.explore_social_content_documents(salon_id,published_at DESC,content_key);
CREATE INDEX explore_social_profile_new_idx ON public.explore_social_content_documents(profile_id,published_at DESC,content_key);
CREATE INDEX explore_social_category_idx ON public.explore_social_content_documents USING gin(category_search extensions.gin_trgm_ops);
CREATE INDEX explore_social_categories_idx ON public.explore_social_content_documents USING gin(categories);
CREATE INDEX explore_social_earth_idx ON public.explore_social_content_documents USING gist(extensions.ll_to_earth(latitude,longitude))
 WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;
CREATE INDEX IF NOT EXISTS explore_social_attribution_salon_idx ON public.beauty_post_attributions(salon_id,post_id);
CREATE INDEX IF NOT EXISTS explore_social_looks_salon_idx ON public.salon_profile_looks(salon_id,id);
CREATE INDEX IF NOT EXISTS explore_social_updates_media_salon_idx ON public.salon_profile_updates(salon_id,id) WHERE nullif(media_path,'') IS NOT NULL;
CREATE INDEX IF NOT EXISTS explore_social_config_look_idx ON public.salon_profile_content_booking_configs(look_id,updated_at DESC,id DESC) WHERE look_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS explore_social_config_update_idx ON public.salon_profile_content_booking_configs(update_id,updated_at DESC,id DESC) WHERE update_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS explore_social_asset_path_idx ON public.salon_profile_media_assets(salon_id,object_path);
CREATE INDEX IF NOT EXISTS explore_social_salon_follows_idx ON public.salon_profile_follows(user_id,created_at DESC,salon_id);

CREATE VIEW public.explore_social_content_source WITH(security_invoker=true) AS
WITH salon_posts AS (
 SELECT 'salon_profile_look'::text AS source_type,p.id,p.salon_id,p.published_at,p.service_id,p.media_path,p.starting_price
 FROM public.salon_profile_looks p WHERE p.status='published' AND NOT p.safety_hold AND p.published_at IS NOT NULL AND nullif(p.media_path,'') IS NOT NULL
 UNION ALL
 SELECT 'salon_profile_update',p.id,p.salon_id,p.published_at,p.service_id,p.media_path,NULL::numeric
 FROM public.salon_profile_updates p WHERE p.status='published' AND NOT p.safety_hold AND p.published_at IS NOT NULL AND nullif(p.media_path,'') IS NOT NULL
)
SELECT p.source_type||':'||p.id AS content_key,p.source_type,p.id AS content_id,d.salon_id,NULL::uuid AS profile_id,
 p.published_at,d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,
 coalesce(public.normalize_search_text(CASE WHEN s.category IS NOT NULL THEN concat_ws(' ',s.category,s.name) ELSE array_to_string(d.service_categories,' ') END),'') AS category_search,
 CASE WHEN s.category IS NOT NULL THEN ARRAY[s.category] ELSE coalesce(d.service_categories,'{}') END AS categories,
 coalesce(primary_service.base_price,s.base_price,p.starting_price,d.starting_price) AS starting_price,
 coalesce(bs.booking_enabled,false) AND coalesce(bs.online_booking_visible,false) AND coalesce(bs.guest_booking_enabled,true)
 AND CASE WHEN cfg.id IS NOT NULL THEN cfg.booking_cta_enabled AND CASE WHEN cfg.primary_service_id IS NULL THEN EXISTS(SELECT 1 FROM services offered WHERE offered.salon_id=p.salon_id AND offered.is_active AND offered.online_booking_enabled) ELSE coalesce(primary_service.is_active,false) AND coalesce(primary_service.online_booking_enabled,false) END
 ELSE coalesce(s.is_active,false) AND coalesce(s.online_booking_enabled,false) END AS bookable
FROM salon_posts p JOIN public.explore_salon_documents d ON d.salon_id=p.salon_id
LEFT JOIN public.services s ON s.id=p.service_id AND s.salon_id=p.salon_id
LEFT JOIN public.booking_settings bs ON bs.salon_id=p.salon_id
LEFT JOIN LATERAL(SELECT config.* FROM public.salon_profile_content_booking_configs config WHERE (config.look_id=p.id AND p.source_type='salon_profile_look') OR (config.update_id=p.id AND p.source_type='salon_profile_update') ORDER BY config.updated_at DESC,config.id DESC LIMIT 1) cfg ON true
LEFT JOIN public.services primary_service ON primary_service.id=cfg.primary_service_id AND primary_service.salon_id=p.salon_id
WHERE NOT EXISTS(SELECT 1 FROM public.salon_profile_media_assets m WHERE m.salon_id=p.salon_id AND m.object_path=p.media_path AND (m.status<>'active' OR m.deleted_at IS NOT NULL))
UNION ALL
SELECT 'beauty_post:'||p.id,'beauty_post',p.id,d.salon_id,p.profile_id,p.created_at,
 d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,
 coalesce(d.service_category_search_text,''),coalesce(d.service_categories,'{}'::text[]),d.starting_price,
 coalesce(v.state='verified',false) AND coalesce(bs.booking_enabled,false) AND coalesce(bs.online_booking_visible,false) AND coalesce(bs.guest_booking_enabled,true) AND d.salon_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM services offered WHERE offered.salon_id=d.salon_id AND offered.is_active AND offered.online_booking_enabled)
FROM public.beauty_posts p JOIN public.beauty_profiles profile ON profile.id=p.profile_id AND profile.visibility='public'
JOIN public.users u ON u.id=p.author_user_id AND u.status<>'deleted'
LEFT JOIN public.beauty_post_attributions a ON a.post_id=p.id
LEFT JOIN public.explore_salon_documents d ON d.salon_id=a.salon_id
LEFT JOIN public.beauty_post_verifications v ON v.post_id=p.id
LEFT JOIN public.booking_settings bs ON bs.salon_id=d.salon_id
WHERE p.deleted_at IS NULL AND NOT p.safety_hold AND p.visibility='public' AND p.moderation_status='visible'
 AND EXISTS(SELECT 1 FROM public.beauty_post_media m WHERE m.post_id=p.id);

CREATE FUNCTION public.refresh_explore_social_content(p_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN; END IF;
 DELETE FROM public.explore_social_content_documents WHERE content_id=ANY(p_ids);
 INSERT INTO public.explore_social_content_documents SELECT * FROM public.explore_social_content_source WHERE content_id=ANY(p_ids)
 ON CONFLICT(content_key) DO UPDATE SET salon_id=excluded.salon_id,profile_id=excluded.profile_id,published_at=excluded.published_at,
 state_code=excluded.state_code,city_search=excluded.city_search,postal_code=excluded.postal_code,latitude=excluded.latitude,longitude=excluded.longitude,
 category_search=excluded.category_search,categories=excluded.categories,starting_price=excluded.starting_price,bookable=excluded.bookable;
 -- Keep cached trend geography/category in sync; scores remain scheduled.
 DELETE FROM explore_social_trending t WHERE NOT EXISTS(SELECT 1 FROM explore_social_content_documents d WHERE d.content_key=t.content_key)
 AND t.content_key IN(SELECT source_type||':'||id FROM (SELECT 'salon_profile_look' AS source_type,id FROM unnest(p_ids) id UNION ALL SELECT 'salon_profile_update',id FROM unnest(p_ids) id UNION ALL SELECT 'beauty_post',id FROM unnest(p_ids) id) keys);
 UPDATE explore_social_trending t SET state_code=d.state_code,city_search=d.city_search,postal_code=d.postal_code,latitude=d.latitude,longitude=d.longitude,category_search=d.category_search
 FROM explore_social_content_documents d WHERE d.content_id=ANY(p_ids) AND t.content_key=d.content_key;
END $$;
CREATE FUNCTION public.sync_explore_social_sources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE ids uuid[]; field_name text;
BEGIN
 field_name:=CASE WHEN TG_TABLE_NAME IN ('beauty_post_media','beauty_post_attributions','beauty_post_verifications') THEN 'post_id' ELSE 'id' END;
 IF TG_OP='INSERT' THEN EXECUTE format('SELECT array_agg(DISTINCT %I) FROM social_new',field_name) INTO ids;
 ELSIF TG_OP='DELETE' THEN EXECUTE format('SELECT array_agg(DISTINCT %I) FROM social_old',field_name) INTO ids;
 ELSE EXECUTE format('SELECT array_agg(DISTINCT id) FROM (SELECT %I AS id FROM social_new UNION SELECT %I FROM social_old) x',field_name,field_name) INTO ids; END IF;
 PERFORM public.refresh_explore_social_content(ids); RETURN NULL;
END $$;
CREATE FUNCTION public.sync_explore_social_salons() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE ids uuid[]; content_ids uuid[]; field_name text;
BEGIN
 field_name:=CASE WHEN TG_TABLE_NAME='locations' THEN 'id' ELSE 'salon_id' END;
 IF TG_OP='INSERT' THEN EXECUTE format('SELECT array_agg(DISTINCT %I) FROM social_new',field_name) INTO ids;
 ELSIF TG_OP='DELETE' THEN EXECUTE format('SELECT array_agg(DISTINCT %I) FROM social_old',field_name) INTO ids;
 ELSE EXECUTE format('SELECT array_agg(DISTINCT id) FROM (SELECT %I AS id FROM social_new UNION SELECT %I FROM social_old) x',field_name,field_name) INTO ids; END IF;
 SELECT array_agg(DISTINCT id) INTO content_ids FROM (
  SELECT id FROM salon_profile_looks WHERE salon_id=ANY(ids)
  UNION SELECT id FROM salon_profile_updates WHERE salon_id=ANY(ids) AND nullif(media_path,'') IS NOT NULL
  UNION SELECT post_id FROM beauty_post_attributions WHERE salon_id=ANY(ids)
  UNION SELECT content_id FROM explore_social_content_documents WHERE salon_id=ANY(ids)
 ) x;
 PERFORM public.refresh_explore_social_content(content_ids); RETURN NULL;
END $$;
CREATE FUNCTION public.sync_explore_social_profiles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE ids uuid[]; post_ids uuid[];
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(id) INTO ids FROM social_new;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(id) INTO ids FROM social_old;
 ELSE SELECT array_agg(id) INTO ids FROM(SELECT id FROM social_new UNION SELECT id FROM social_old) x; END IF;
 SELECT array_agg(id) INTO post_ids FROM beauty_posts WHERE deleted_at IS NULL AND CASE WHEN TG_TABLE_NAME='users' THEN author_user_id=ANY(ids) ELSE profile_id=ANY(ids) END;
 PERFORM public.refresh_explore_social_content(post_ids); RETURN NULL;
END $$;
DO $$ DECLARE t text; fn text; BEGIN
 FOREACH t IN ARRAY ARRAY['salon_profile_looks','salon_profile_updates','beauty_posts','beauty_post_media','beauty_post_attributions','beauty_post_verifications','locations','salon_settings','services','booking_settings','salon_profile_media_assets','salon_profile_content_booking_configs','salon_directory_listings','beauty_profiles','users'] LOOP
  fn:=CASE WHEN t IN ('beauty_profiles','users') THEN 'sync_explore_social_profiles'
   WHEN t IN ('locations','salon_settings','services','booking_settings','salon_profile_media_assets','salon_profile_content_booking_configs','salon_directory_listings') THEN 'sync_explore_social_salons' ELSE 'sync_explore_social_sources' END;
  EXECUTE format('CREATE TRIGGER explore_z_social_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS social_new FOR EACH STATEMENT EXECUTE FUNCTION public.%I()',t,fn);
  EXECUTE format('CREATE TRIGGER explore_z_social_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS social_old NEW TABLE AS social_new FOR EACH STATEMENT EXECUTE FUNCTION public.%I()',t,fn);
  EXECUTE format('CREATE TRIGGER explore_z_social_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS social_old FOR EACH STATEMENT EXECUTE FUNCTION public.%I()',t,fn);
 END LOOP;
END $$;
INSERT INTO public.explore_social_content_documents SELECT * FROM public.explore_social_content_source;

CREATE TABLE public.explore_social_feed_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 weights jsonb NOT NULL DEFAULT '{"trending":0.35,"new":0.30,"personal":0.20,"expanded":0.15}',
 personalization_enabled boolean NOT NULL DEFAULT false,
 session_minutes integer NOT NULL DEFAULT 30 CHECK(session_minutes BETWEEN 5 AND 60),
 seen_hours integer NOT NULL DEFAULT 168 CHECK(seen_hours BETWEEN 1 AND 720)
);
INSERT INTO public.explore_social_feed_config(id) VALUES(true);
CREATE TABLE public.explore_social_actor_events (
 actor_key text NOT NULL,content_key text NOT NULL,event_day date NOT NULL,kind text NOT NULL CHECK(kind IN ('meaningful_view','profile_view','share')),
 occurred_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_key,content_key,event_day,kind)
);
CREATE INDEX explore_social_seen_idx ON public.explore_social_actor_events(actor_key,occurred_at DESC,content_key) WHERE kind='meaningful_view';
CREATE INDEX explore_social_event_cleanup_idx ON public.explore_social_actor_events(occurred_at);
CREATE TABLE public.explore_social_daily_engagement (
 content_key text NOT NULL,event_day date NOT NULL,kind text NOT NULL,amount bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(content_key,event_day,kind)
);
CREATE INDEX explore_social_daily_window_idx ON public.explore_social_daily_engagement(event_day,content_key);
CREATE TABLE public.explore_social_trending (
 content_key text PRIMARY KEY,state_code text,city_search text,postal_code text,latitude double precision,longitude double precision,
 category_search text NOT NULL,score double precision NOT NULL CHECK(score>0),refreshed_at timestamptz NOT NULL
);
CREATE INDEX explore_social_trend_state_idx ON public.explore_social_trending(state_code,score DESC,content_key);
CREATE INDEX explore_social_trend_city_idx ON public.explore_social_trending(city_search,state_code,score DESC,content_key);
CREATE INDEX explore_social_trend_global_idx ON public.explore_social_trending(score DESC,content_key);
CREATE INDEX explore_social_trend_earth_idx ON public.explore_social_trending USING gist(extensions.ll_to_earth(latitude,longitude))
 WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;
CREATE TABLE public.explore_social_directory_pool (
 state_code text NOT NULL,salon_id uuid NOT NULL,refreshed_at timestamptz NOT NULL,
 PRIMARY KEY(state_code,salon_id)
);
CREATE TABLE public.explore_social_feed_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_key text NOT NULL,filter_hash text NOT NULL,filters jsonb NOT NULL,region jsonb NOT NULL,
 as_of timestamptz NOT NULL,expires_at timestamptz NOT NULL,queue jsonb NOT NULL CHECK(jsonb_array_length(queue)<=384),
 delivered_until integer NOT NULL DEFAULT 0,delivered_keys text[] NOT NULL DEFAULT '{}',newest_published_at timestamptz
);
CREATE INDEX explore_social_session_expiry_idx ON public.explore_social_feed_sessions(expires_at,id);

CREATE INDEX IF NOT EXISTS explore_social_save_window_idx ON public.salon_profile_look_saves(created_at,look_id);
CREATE INDEX IF NOT EXISTS explore_social_account_save_window_idx ON public.account_post_saves(created_at,source_type,source_id);
CREATE INDEX IF NOT EXISTS explore_social_comment_window_idx ON public.salon_profile_comments(created_at) WHERE status='published';
CREATE INDEX IF NOT EXISTS explore_social_booking_window_idx ON public.bookings(created_at,source_reference_type,source_reference_id)
 WHERE confirmation_status='confirmed' AND status IN ('confirmed','checked_in','in_service','completed');
CREATE INDEX IF NOT EXISTS explore_social_inspiration_booking_idx ON public.booking_inspirations(booking_id,source_content_id) WHERE source_content_id IS NOT NULL;

CREATE FUNCTION public.refresh_explore_social_pools() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit='off' AS $$
DECLARE state_value text; pivot uuid;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('explore-social-pool-refresh',0)) THEN RETURN; END IF;
 DELETE FROM explore_social_trending;
 INSERT INTO explore_social_trending
 WITH signals AS (
  SELECT content_key,count(*)::double precision*4 AS score FROM (
   SELECT 'salon_profile_look:'||look_id AS content_key,user_id FROM salon_profile_look_saves WHERE created_at>=now()-interval '7 days'
   UNION SELECT source_type||':'||source_id,user_id FROM account_post_saves WHERE created_at>=now()-interval '7 days'
  ) saves GROUP BY content_key
  UNION ALL SELECT CASE WHEN look_id IS NOT NULL THEN 'salon_profile_look:'||look_id WHEN update_id IS NOT NULL THEN 'salon_profile_update:'||update_id ELSE 'beauty_post:'||beauty_post_id END,count(DISTINCT author_user_id)::double precision*3 FROM salon_profile_comments WHERE status='published' AND created_at>=now()-interval '7 days' GROUP BY look_id,update_id,beauty_post_id
  UNION ALL SELECT content_key,sum(amount)::double precision*CASE kind WHEN 'meaningful_view' THEN .25 WHEN 'profile_view' THEN .75 ELSE 2 END FROM explore_social_daily_engagement WHERE event_day>=(now() AT TIME ZONE 'UTC')::date-7 GROUP BY content_key,kind
  UNION ALL SELECT content_key,count(DISTINCT customer_user_id)::double precision*8 FROM (
   SELECT source_reference_type||':'||source_reference_id AS content_key,customer_user_id FROM bookings WHERE source_reference_id IS NOT NULL AND source_reference_type IN ('salon_profile_look','salon_profile_update','beauty_post') AND confirmation_status='confirmed' AND status IN ('confirmed','checked_in','in_service','completed') AND created_at>=now()-interval '7 days'
   UNION SELECT i.source_type||':'||i.source_content_id,b.customer_user_id FROM booking_inspirations i JOIN bookings b ON b.id=i.booking_id WHERE i.source_content_id IS NOT NULL AND i.source_type IN ('salon_profile_look','salon_profile_update','beauty_post') AND b.confirmation_status='confirmed' AND b.status IN ('confirmed','checked_in','in_service','completed') AND b.created_at>=now()-interval '7 days'
  ) confirmed_visits GROUP BY content_key
 ), totals AS(SELECT content_key,sum(score) AS score FROM signals GROUP BY content_key)
 SELECT d.content_key,d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,d.category_search,
 ln(1+t.score)/power(1+greatest(0,extract(epoch FROM now()-d.published_at)/86400)/3,1.2),now()
 FROM totals t JOIN explore_social_content_documents d USING(content_key) WHERE t.score>0;
 DELETE FROM explore_social_directory_pool;
 FOREACH state_value IN ARRAY public.explore_search_state_codes() LOOP
  pivot:=gen_random_uuid();
  INSERT INTO explore_social_directory_pool
  SELECT state_value,x.salon_id,now() FROM (
   (SELECT salon_id FROM explore_salon_documents WHERE state_code=state_value AND salon_id>=pivot ORDER BY salon_id LIMIT 48)
   UNION ALL (SELECT salon_id FROM explore_salon_documents WHERE state_code=state_value AND salon_id<pivot ORDER BY salon_id LIMIT 48)
  ) x ON CONFLICT DO NOTHING;
 END LOOP;
END $$;

CREATE FUNCTION public.explore_social_filter_predicate(p_filters jsonb,p_region jsonb,p_directory boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE predicate text:=public.explore_search_region_predicate(p_region); category text:=public.normalize_search_text(coalesce(p_filters->>'category','')); price numeric;
BEGIN
 IF category NOT IN ('','all') THEN predicate:=predicate||format(' AND d.%I LIKE %L',CASE WHEN p_directory THEN 'service_category_search_text' ELSE 'category_search' END,'%'||category||'%'); END IF;
 IF p_filters->>'maxPrice' IS NOT NULL THEN price:=(p_filters->>'maxPrice')::numeric; predicate:=predicate||format(' AND d.starting_price<=%L::numeric',price); END IF;
 IF coalesce((p_filters->>'newOnly')::boolean,false) THEN predicate:=predicate||CASE WHEN p_directory THEN ' AND d.created_at>=now()-interval ''30 days''' ELSE ' AND d.published_at>=now()-interval ''30 days''' END; END IF;
 IF coalesce((p_filters->>'bookableOnly')::boolean,false) THEN
  predicate:=predicate||CASE WHEN p_directory THEN ' AND EXISTS(SELECT 1 FROM public.booking_settings bs WHERE bs.salon_id=d.salon_id AND bs.booking_enabled AND bs.online_booking_visible AND coalesce(bs.guest_booking_enabled,true)) AND EXISTS(SELECT 1 FROM public.services s WHERE s.salon_id=d.salon_id AND s.is_active AND s.online_booking_enabled)' ELSE ' AND d.bookable' END;
 END IF;
 IF coalesce((p_filters->>'trendingOnly')::boolean,false) THEN predicate:=predicate||CASE WHEN p_directory THEN ' AND false' ELSE ' AND EXISTS(SELECT 1 FROM public.explore_social_trending cached WHERE cached.content_key=d.content_key)' END; END IF;
 RETURN predicate;
END $$;

CREATE FUNCTION public.get_explore_social_candidate_pool(p_actor_key text,p_filters jsonb DEFAULT '{}') RETURNS jsonb
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
  SELECT coalesce(categories,'{}') INTO cats FROM explore_user_preferences pref WHERE pref.user_id=actor_user_id;
  SELECT coalesce(array_agg(salon_id),'{}') INTO followed FROM (SELECT salon_id FROM salon_profile_follows f WHERE f.user_id=actor_user_id ORDER BY created_at DESC LIMIT 100) f;
  SELECT coalesce(array_agg(profile_id),'{}') INTO profiles FROM (SELECT profile_id FROM beauty_profile_follows f WHERE f.user_id=actor_user_id ORDER BY created_at DESC LIMIT 100) f;
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(x)),''[]'') FROM (SELECT d.content_key AS "contentKey",d.source_type AS "sourceType",d.content_id AS "contentId",d.salon_id AS "salonId",d.published_at AS "publishedAt",''personal'' AS lane,''local'' AS scope FROM explore_social_content_documents d WHERE '||predicate||format(' AND (d.salon_id=ANY(%L::uuid[]) OR d.profile_id=ANY(%L::uuid[]) OR d.categories&&%L::text[])',followed,profiles,coalesce(cats,'{}'))||' ORDER BY d.published_at DESC,d.content_key LIMIT 96) x' INTO personal;
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

CREATE FUNCTION public.explore_social_live_eligible(p_key text,p_filters jsonb,p_region jsonb,p_scope text,p_as_of timestamptz) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE predicate text; eligible boolean; directory boolean:=p_key LIKE 'directory:%'; region jsonb;
BEGIN
 region:=CASE WHEN p_scope='local' THEN p_region ELSE '{"kind":"global"}'::jsonb END;
 predicate:=public.explore_social_filter_predicate(p_filters,region,directory);
 IF p_scope='wider' AND p_region->>'kind'<>'global' THEN predicate:=predicate||' AND NOT(coalesce(('||public.explore_search_region_predicate(p_region)||'),false))'; END IF;
 IF directory THEN
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM explore_salon_documents d WHERE d.salon_id=$1 AND d.created_at<=$2 AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=$2) AND '||predicate||')' INTO eligible USING substring(p_key FROM 11)::uuid,p_as_of;
 ELSE
  EXECUTE 'SELECT EXISTS(SELECT 1 FROM explore_social_content_documents d WHERE d.content_key=$1 AND d.published_at<=$2 AND (d.salon_id IS NULL OR EXISTS(SELECT 1 FROM explore_salon_documents published_salon WHERE published_salon.salon_id=d.salon_id AND (published_salon.public_discovery_published_at IS NULL OR published_salon.public_discovery_published_at<=$2))) AND '||predicate||')' INTO eligible USING p_key,p_as_of;
 END IF;
 RETURN eligible;
END $$;

CREATE FUNCTION public.create_explore_social_feed_session(p_actor_key text,p_filters jsonb,p_as_of timestamptz,p_region jsonb,p_queue jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result explore_social_feed_sessions; cfg explore_social_feed_config;
BEGIN
 IF p_actor_key !~ '^(user:[0-9a-fA-F-]{36}|guest:[0-9a-fA-F]{64})$' OR jsonb_typeof(p_queue)<>'array' OR jsonb_array_length(p_queue)>384 OR p_as_of>now()+interval '1 minute' OR p_as_of<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Invalid feed session'; END IF;
 SELECT * INTO cfg FROM explore_social_feed_config WHERE id;
 INSERT INTO explore_social_feed_sessions(actor_key,filter_hash,filters,region,as_of,expires_at,queue,newest_published_at)
 VALUES(p_actor_key,md5(p_filters::text),p_filters,p_region,p_as_of,now()+make_interval(mins=>cfg.session_minutes),p_queue,
 (SELECT max((x->>'publishedAt')::timestamptz) FROM jsonb_array_elements(p_queue) x)) RETURNING * INTO result;
 RETURN jsonb_build_object('id',result.id,'asOf',result.as_of,'newestPublishedAt',result.newest_published_at);
END $$;

CREATE FUNCTION public.get_explore_social_feed_page(p_actor_key text,p_filters jsonb,p_cursor jsonb,p_limit integer DEFAULT 12) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE s explore_social_feed_sessions; after_value integer:=coalesce((p_cursor->>'after')::integer,0); page_keys jsonb; last_ordinal integer; has_more boolean; cursor_value jsonb;
BEGIN
 SELECT * INTO s FROM explore_social_feed_sessions WHERE id=(p_cursor->>'session')::uuid AND actor_key=p_actor_key AND expires_at>now() FOR UPDATE;
 IF s.id IS NULL OR p_cursor->>'version' IS DISTINCT FROM '1' OR s.filter_hash<>md5(p_filters::text) OR after_value<0 OR after_value>jsonb_array_length(s.queue) OR after_value>s.delivered_until THEN RAISE EXCEPTION 'Feed session expired or filters changed' USING ERRCODE='22023'; END IF;
 WITH candidates AS (
  SELECT e.value||jsonb_build_object('ordinal',e.ordinality) AS row,e.ordinality
  FROM jsonb_array_elements(s.queue) WITH ORDINALITY e
  WHERE e.ordinality>after_value AND public.explore_social_live_eligible(e.value->>'contentKey',s.filters,s.region,e.value->>'scope',s.as_of)
  ORDER BY e.ordinality LIMIT least(20,greatest(1,p_limit))+1
 ), visible AS(SELECT * FROM candidates ORDER BY ordinality LIMIT least(20,greatest(1,p_limit)))
 SELECT coalesce((SELECT jsonb_agg(row ORDER BY ordinality) FROM visible),'[]'),(SELECT max(ordinality) FROM visible),
 (SELECT count(*) FROM candidates)>least(20,greatest(1,p_limit)) INTO page_keys,last_ordinal,has_more;
 last_ordinal:=coalesce(last_ordinal,jsonb_array_length(s.queue));
 UPDATE explore_social_feed_sessions SET delivered_until=greatest(delivered_until,last_ordinal),
 delivered_keys=ARRAY(SELECT DISTINCT key FROM unnest(s.delivered_keys||ARRAY(SELECT e->>'contentKey' FROM jsonb_array_elements(page_keys) e)) key)
 WHERE id=s.id;
 cursor_value:=jsonb_build_object('version',1,'session',s.id,'after',last_ordinal);
 RETURN jsonb_build_object('keys',page_keys,'hasMore',has_more,'cursor',cursor_value,'asOf',s.as_of,'newestPublishedAt',s.newest_published_at);
END $$;

CREATE FUNCTION public.get_explore_social_feed_updates(p_actor_key text,p_filters jsonb,p_cursor jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions SET plan_cache_mode=force_custom_plan AS $$
DECLARE s explore_social_feed_sessions; newest timestamptz; predicate text;
BEGIN
 SELECT * INTO s FROM explore_social_feed_sessions WHERE id=(p_cursor->>'session')::uuid AND actor_key=p_actor_key AND expires_at>now();
 IF s.id IS NULL OR s.filter_hash<>md5(p_filters::text) THEN RAISE EXCEPTION 'Feed session expired or filters changed' USING ERRCODE='22023'; END IF;
 predicate:=public.explore_social_filter_predicate(s.filters,s.region,false)||' AND d.published_at<=now() AND (d.salon_id IS NULL OR EXISTS(SELECT 1 FROM explore_salon_documents published_salon WHERE published_salon.salon_id=d.salon_id AND (published_salon.public_discovery_published_at IS NULL OR published_salon.public_discovery_published_at<=now())))';
 EXECUTE 'SELECT d.published_at FROM explore_social_content_documents d WHERE '||predicate||' ORDER BY d.published_at DESC,d.content_key LIMIT 1' INTO newest;
 RETURN jsonb_build_object('hasNewPosts',coalesce(newest>s.as_of,false),'newestPublishedAt',newest);
END $$;

CREATE FUNCTION public.validate_explore_social_feed_items(p_actor_key text,p_cursor jsonb,p_keys text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s explore_social_feed_sessions; result text[];
BEGIN
 IF coalesce(cardinality(p_keys),0)>120 THEN RAISE EXCEPTION 'Too many cached items'; END IF;
 SELECT * INTO s FROM explore_social_feed_sessions WHERE id=(p_cursor->>'session')::uuid AND actor_key=p_actor_key AND expires_at>now();
 IF s.id IS NULL THEN RETURN '{}'::text[]; END IF;
 SELECT coalesce(array_agg(x.key),'{}') INTO result FROM unnest(p_keys) x(key)
 WHERE x.key=ANY(s.delivered_keys) AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.queue) WITH ORDINALITY e WHERE e.value->>'contentKey'=x.key
 AND public.explore_social_live_eligible(x.key,s.filters,s.region,e.value->>'scope',s.as_of));
 RETURN result;
END $$;

CREATE FUNCTION public.record_explore_social_events(p_actor_key text,p_cursor jsonb,p_events jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s explore_social_feed_sessions; amount integer:=0;
BEGIN
 IF jsonb_typeof(p_events)<>'array' OR jsonb_array_length(p_events)>20 THEN RAISE EXCEPTION 'Too many discovery events'; END IF;
 SELECT * INTO s FROM explore_social_feed_sessions WHERE id=(p_cursor->>'session')::uuid AND actor_key=p_actor_key AND expires_at>now();
 IF s.id IS NULL THEN RETURN 0; END IF;
 WITH eligible AS (
  SELECT DISTINCT e->>'contentKey' AS content_key,e->>'kind' AS kind FROM jsonb_array_elements(p_events) e
  WHERE e->>'kind' IN ('meaningful_view','profile_view','share')
  AND (e->>'kind'<>'meaningful_view' OR (CASE WHEN jsonb_typeof(e->'elapsedMs')='number' AND jsonb_typeof(e->'ratio')='number' THEN (e->>'elapsedMs')::numeric>=2000 AND (e->>'ratio')::numeric BETWEEN .5 AND 1 ELSE false END))
  AND e->>'contentKey'=ANY(s.delivered_keys)
  AND (EXISTS(SELECT 1 FROM explore_social_content_documents d WHERE d.content_key=e->>'contentKey') OR EXISTS(SELECT 1 FROM explore_salon_documents d WHERE 'directory:'||d.salon_id=e->>'contentKey'))
 ), inserted AS (
  INSERT INTO explore_social_actor_events(actor_key,content_key,event_day,kind)
  SELECT p_actor_key,content_key,(now() AT TIME ZONE 'UTC')::date,kind FROM eligible ON CONFLICT DO NOTHING RETURNING content_key,event_day,kind
 ), counters AS (
  INSERT INTO explore_social_daily_engagement(content_key,event_day,kind,amount)
  SELECT content_key,event_day,kind,1 FROM inserted ON CONFLICT(content_key,event_day,kind) DO UPDATE SET amount=explore_social_daily_engagement.amount+1 RETURNING 1
 ) SELECT count(*) INTO amount FROM counters;
 RETURN amount;
END $$;

CREATE FUNCTION public.cleanup_explore_social_feed(p_limit integer DEFAULT 5000) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE amount integer;
BEGIN
 WITH removed AS(DELETE FROM explore_social_feed_sessions WHERE id IN(SELECT id FROM explore_social_feed_sessions WHERE expires_at<now() ORDER BY expires_at LIMIT least(10000,greatest(1,p_limit))) RETURNING 1) SELECT count(*) INTO amount FROM removed;
 DELETE FROM explore_social_actor_events WHERE ctid IN(SELECT ctid FROM explore_social_actor_events WHERE occurred_at<now()-interval '30 days' ORDER BY occurred_at LIMIT least(10000,greatest(1,p_limit)));
 DELETE FROM explore_social_daily_engagement WHERE event_day<(now() AT TIME ZONE 'UTC')::date-30;
 RETURN amount;
END $$;

-- Hydration is restricted to the selected keys already delivered by this actor's
-- queue. No global post/profile scan and no private source row is returned.
CREATE FUNCTION public.hydrate_explore_social_feed_items(p_actor_key text,p_cursor jsonb,p_keys text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE allowed text[]; actor_user_id uuid; result jsonb;
BEGIN
 IF coalesce(cardinality(p_keys),0)>20 THEN RAISE EXCEPTION 'Too many selected items'; END IF;
 allowed:=public.validate_explore_social_feed_items(p_actor_key,p_cursor,p_keys);
 IF left(p_actor_key,5)='user:' THEN actor_user_id:=substring(p_actor_key FROM 6)::uuid; END IF;
 WITH selected AS (
  SELECT x.key,x.ordinality,d.source_type,d.content_id,d.salon_id,d.profile_id,d.published_at,d.bookable
  FROM unnest(allowed) WITH ORDINALITY x(key,ordinality)
  LEFT JOIN explore_social_content_documents d ON d.content_key=x.key
 ), posts AS (
  SELECT s.*,jsonb_build_object('id',p.id,'title',p.title,'caption',left(p.caption,500),'authorName',p.author_display_name,
   'authorRole',CASE WHEN p.author_presentation_role='staff' AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.author_user_id AND u.status='deleted') THEN 'salon' ELSE p.author_presentation_role END,
   'authorStaffId',p.author_staff_id,'serviceName',service.name,'serviceCategory',service.category,'postType','regular') AS post,
   jsonb_build_array(jsonb_build_object('id',coalesce(m.id,p.id),'objectPath',p.media_path,'bucket','salon-profile-media','role','image','width',m.width,'height',m.height)) AS media,
   p.service_id,p.duration_minutes,p.starting_price
  FROM selected s JOIN salon_profile_looks p ON s.source_type='salon_profile_look' AND p.id=s.content_id
  LEFT JOIN services service ON service.id=p.service_id AND service.salon_id=p.salon_id
  LEFT JOIN salon_profile_media_assets m ON m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.status='active' AND m.deleted_at IS NULL
  UNION ALL
  SELECT s.*,jsonb_build_object('id',p.id,'title',p.title,'caption',left(coalesce(p.caption,p.summary),500),'authorName',p.author_display_name,
   'authorRole',CASE WHEN p.author_presentation_role='staff' AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.author_user_id AND u.status='deleted') THEN 'salon' ELSE p.author_presentation_role END,
   'authorStaffId',p.author_staff_id,'serviceName',service.name,'serviceCategory',service.category,'postType','regular'),
   jsonb_build_array(jsonb_build_object('id',coalesce(m.id,p.id),'objectPath',p.media_path,'bucket','salon-profile-media','role','image','width',m.width,'height',m.height)),
   p.service_id,NULL::integer,NULL::numeric
  FROM selected s JOIN salon_profile_updates p ON s.source_type='salon_profile_update' AND p.id=s.content_id
  LEFT JOIN services service ON service.id=p.service_id AND service.salon_id=p.salon_id
  LEFT JOIN salon_profile_media_assets m ON m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.status='active' AND m.deleted_at IS NULL
  UNION ALL
  SELECT s.*,jsonb_build_object('id',p.id,'caption',left(p.caption,500),'postType',p.post_type,
   'authorName',coalesce(nullif(btrim(u.display_name),''),nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),'Reylumi customer'),
   'avatarUrl',u.avatar_url,'verificationState',v.state),
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'objectPath',m.object_path,'bucket',m.bucket,'role',m.role,'width',m.width,'height',m.height) ORDER BY m.display_order,m.created_at,m.id) FROM beauty_post_media m WHERE m.post_id=p.id),'[]'),
   NULL::uuid,NULL::integer,NULL::numeric
  FROM selected s JOIN beauty_posts p ON s.source_type='beauty_post' AND p.id=s.content_id
  JOIN users u ON u.id=p.author_user_id
  LEFT JOIN beauty_post_verifications v ON v.post_id=p.id
 ), rows AS (
  SELECT p.key,p.ordinality,p.source_type,p.content_id,p.salon_id,p.profile_id,p.published_at,
   jsonb_build_object('candidate',(SELECT e FROM explore_social_feed_sessions fs,jsonb_array_elements(fs.queue) e WHERE fs.id=(p_cursor->>'session')::uuid AND fs.actor_key=p_actor_key AND e->>'contentKey'=p.key LIMIT 1),
    'contentKey',p.key,'sourceType',p.source_type,'contentId',p.content_id,'profileId',p.profile_id,'publishedAt',p.published_at,
    'document',to_jsonb(d),'logoImagePath',settings.public_profile_logo_path,'post',p.post,'media',p.media,
    'booking',CASE WHEN p.source_type='beauty_post' THEN NULL ELSE jsonb_build_object(
      'content_id',p.content_id,'source_type',p.source_type,'content_type',CASE WHEN p.source_type='salon_profile_update' THEN 'update' ELSE 'look' END,
      'salon_id',p.salon_id,'title',p.post->>'title','caption',p.post->>'caption','media_path',p.media->0->>'objectPath','media_bucket','salon-profile-media',
      'credited_staff_id',cfg.credited_staff_id,'credited_staff_name',credited.display_name,
      'booking_cta_enabled',CASE WHEN cfg.id IS NULL THEN p.bookable ELSE cfg.booking_cta_enabled END,'booking_enabled',p.bookable,
      'booking_href',CASE WHEN p.bookable THEN '/book/'||p.salon_id||'?inspiration='||p.content_id||'&source=public_profile' ELSE NULL END,
      'booking_note',cfg.booking_note,'cta_label',coalesce(cfg.cta_label,'Book this look'),
      'readiness_state',CASE WHEN coalesce(cfg.primary_service_id,p.service_id) IS NULL THEN 'inspiration_only' ELSE 'service_ready' END,
      'readiness_message','Choose services and a professional.','primary_service_id',primary_service.id,
      'primary_service_name',primary_service.name,'primary_service_base_price',coalesce(primary_service.base_price,p.starting_price),
      'primary_service_duration_minutes',coalesce(primary_service.duration_minutes,p.duration_minutes),'add_ons','[]'::jsonb,'additional_services','[]'::jsonb) END,
    'bookable',p.bookable,
    'commentCount',(SELECT count(*) FROM salon_profile_comments c WHERE c.status='published' AND ((p.source_type='salon_profile_look' AND c.look_id=p.content_id) OR (p.source_type='salon_profile_update' AND c.update_id=p.content_id) OR (p.source_type='beauty_post' AND c.beauty_post_id=p.content_id))),
    'saved',actor_user_id IS NOT NULL AND (EXISTS(SELECT 1 FROM account_post_saves a WHERE a.user_id=actor_user_id AND a.source_type=p.source_type AND a.source_id=p.content_id) OR (p.source_type='salon_profile_look' AND EXISTS(SELECT 1 FROM salon_profile_look_saves a WHERE a.user_id=actor_user_id AND a.look_id=p.content_id))),
    'bookingCount',CASE WHEN p.source_type='beauty_post' AND p.post->>'verificationState'='verified' THEN (SELECT count(*) FROM bookings b WHERE b.source_reference_type='beauty_post' AND b.source_reference_id=p.content_id AND b.confirmation_status='confirmed' AND b.status IN ('confirmed','checked_in','in_service','completed')) ELSE 0 END) AS value
  FROM posts p LEFT JOIN explore_salon_documents d ON d.salon_id=p.salon_id
  LEFT JOIN salon_settings settings ON settings.salon_id=d.salon_id
  LEFT JOIN LATERAL(SELECT config.* FROM salon_profile_content_booking_configs config WHERE (config.look_id=p.content_id AND p.source_type='salon_profile_look') OR (config.update_id=p.content_id AND p.source_type='salon_profile_update') ORDER BY config.updated_at DESC,config.id DESC LIMIT 1) cfg ON true
  LEFT JOIN services primary_service ON primary_service.id=CASE WHEN cfg.id IS NULL THEN p.service_id ELSE cfg.primary_service_id END AND primary_service.salon_id=p.salon_id
  LEFT JOIN staff credited ON credited.id=cfg.credited_staff_id
  UNION ALL
  SELECT s.key,s.ordinality,'directory',d.salon_id,d.salon_id,NULL::uuid,NULL::timestamptz,
   jsonb_build_object('candidate',(SELECT e FROM explore_social_feed_sessions fs,jsonb_array_elements(fs.queue) e WHERE fs.id=(p_cursor->>'session')::uuid AND fs.actor_key=p_actor_key AND e->>'contentKey'=s.key LIMIT 1),
    'contentKey',s.key,'sourceType','directory','contentId',d.salon_id,'document',to_jsonb(d),'logoImagePath',settings.public_profile_logo_path)
  FROM selected s JOIN explore_salon_documents d ON s.key='directory:'||d.salon_id
  LEFT JOIN salon_settings settings ON settings.salon_id=d.salon_id
 ) SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO result FROM rows;
 RETURN result;
END $$;

DO $$ DECLARE t text; r record; BEGIN
 FOREACH t IN ARRAY ARRAY['explore_social_content_documents','explore_social_feed_config','explore_social_actor_events','explore_social_daily_engagement','explore_social_trending','explore_social_directory_pool','explore_social_feed_sessions'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
 REVOKE ALL ON public.explore_social_content_source FROM PUBLIC,anon,authenticated;
 GRANT SELECT ON public.explore_social_content_source TO service_role;
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('refresh_explore_social_content','sync_explore_social_sources','sync_explore_social_salons','sync_explore_social_profiles','refresh_explore_social_pools','explore_social_filter_predicate','get_explore_social_candidate_pool','create_explore_social_feed_session','get_explore_social_feed_page','get_explore_social_feed_updates','validate_explore_social_feed_items','record_explore_social_events','cleanup_explore_social_feed','hydrate_explore_social_feed_items','explore_social_live_eligible') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='kingpos-explore-trends') THEN PERFORM cron.schedule('kingpos-explore-trends','*/10 * * * *','select public.refresh_explore_social_pools();'); END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobname='kingpos-explore-feed-cleanup') THEN PERFORM cron.schedule('kingpos-explore-feed-cleanup','* * * * *','select public.cleanup_explore_social_feed(5000);'); END IF;
 END IF;
END $$;
SELECT public.refresh_explore_social_pools();
NOTIFY pgrst,'reload schema';
COMMIT;
