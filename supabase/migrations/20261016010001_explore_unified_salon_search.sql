-- One salon-owned search stream. Canonical source tables and the social feed's
-- media-only eligibility are retained. Historical rank inputs never cache media.
BEGIN;
SET LOCAL search_path=public,extensions;

CREATE TABLE public.explore_unified_search_clock(id boolean PRIMARY KEY DEFAULT true CHECK(id),revision bigint NOT NULL DEFAULT 0);
INSERT INTO public.explore_unified_search_clock DEFAULT VALUES;
CREATE TABLE public.explore_unified_salon_incarnations(salon_id uuid PRIMARY KEY REFERENCES public.explore_salon_documents(salon_id) ON DELETE CASCADE,source_token uuid NOT NULL DEFAULT gen_random_uuid());
CREATE TABLE public.explore_unified_content_incarnations(content_key text PRIMARY KEY,salon_id uuid NOT NULL,source_token uuid NOT NULL DEFAULT gen_random_uuid());
CREATE TABLE public.explore_unified_salon_history(
 salon_id uuid NOT NULL,valid_from bigint NOT NULL,valid_to bigint,retired_at timestamptz,source_token uuid NOT NULL,fingerprint text NOT NULL,
 salon_name_search text NOT NULL,service_search_text text NOT NULL,service_category_search_text text NOT NULL,
 state_code text,city_search text,postal_code text,latitude float8,longitude float8,
 profile_completeness integer NOT NULL,created_at timestamptz NOT NULL,public_discovery_published_at timestamptz,starting_price numeric,has_real_cover boolean NOT NULL,
 PRIMARY KEY(salon_id,valid_from)
);
CREATE UNIQUE INDEX explore_unified_salon_current_idx ON public.explore_unified_salon_history(salon_id) WHERE valid_to IS NULL;
CREATE INDEX explore_unified_salon_name_idx ON public.explore_unified_salon_history USING gin(salon_name_search extensions.gin_trgm_ops);
CREATE INDEX explore_unified_salon_prefix_idx ON public.explore_unified_salon_history(salon_name_search text_pattern_ops,salon_id);
CREATE INDEX explore_unified_salon_category_idx ON public.explore_unified_salon_history USING gin(service_category_search_text extensions.gin_trgm_ops);
CREATE INDEX explore_unified_salon_service_idx ON public.explore_unified_salon_history USING gin(service_search_text extensions.gin_trgm_ops);
CREATE INDEX explore_unified_salon_state_idx ON public.explore_unified_salon_history(state_code,salon_id);
CREATE INDEX explore_unified_salon_city_idx ON public.explore_unified_salon_history(city_search,state_code,salon_id);
CREATE INDEX explore_unified_salon_postal_idx ON public.explore_unified_salon_history((left(coalesce(postal_code,''),5)),salon_id);
CREATE INDEX explore_unified_salon_retired_idx ON public.explore_unified_salon_history(retired_at) WHERE retired_at IS NOT NULL;
CREATE TABLE public.explore_unified_content_history(
 content_key text NOT NULL,valid_from bigint NOT NULL,valid_to bigint,retired_at timestamptz,source_token uuid NOT NULL,fingerprint text NOT NULL,
 salon_id uuid NOT NULL,source_type text NOT NULL,content_id uuid NOT NULL,author_user_id uuid,published_at timestamptz NOT NULL,
 is_reference boolean NOT NULL,search_terms tsvector NOT NULL,has_real_media boolean NOT NULL,PRIMARY KEY(content_key,valid_from)
);
CREATE UNIQUE INDEX explore_unified_content_current_idx ON public.explore_unified_content_history(content_key) WHERE valid_to IS NULL;
CREATE INDEX explore_unified_content_terms_idx ON public.explore_unified_content_history USING gin(search_terms);
CREATE INDEX explore_unified_content_salon_idx ON public.explore_unified_content_history(salon_id,published_at DESC,content_key);
CREATE INDEX explore_unified_content_author_idx ON public.explore_unified_content_history(author_user_id,salon_id) WHERE valid_to IS NULL;
CREATE INDEX explore_unified_content_retired_idx ON public.explore_unified_content_history(retired_at) WHERE retired_at IS NOT NULL;
CREATE INDEX explore_unified_content_real_media_idx ON public.explore_unified_content_history(salon_id,valid_from,valid_to) WHERE has_real_media AND NOT is_reference;

CREATE FUNCTION public.explore_unified_owned_media_path(path text,salon uuid,kind text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(path IS NOT NULL AND path !~ '(^/|\\\\|://|//|(^|/)\.{1,2}(/|$))' AND (
  path ~ ('^'||salon::text||'/'||CASE kind WHEN 'look' THEN 'looks/[0-9a-fA-F-]{36}/[^/]+' WHEN 'update' THEN 'updates/[^/]+' WHEN 'cover' THEN 'profile/cover/[^/]+' ELSE 'INVALID' END||'[.]webp$')
  OR path ~ ('^[0-9a-fA-F-]{36}/'||salon::text||'/(identity|looks)/[^/].*')
 ),false)
$$;
CREATE FUNCTION public.explore_unified_has_real_cover(d public.explore_salon_documents) RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM salon_profile_media_assets m WHERE m.salon_id=d.salon_id AND m.object_path=d.cover_image_path AND m.bucket='salon-profile-media' AND m.purpose='cover' AND m.status='active' AND m.deleted_at IS NULL AND explore_unified_owned_media_path(m.object_path,d.salon_id,'cover'))
$$;

-- Includes text-only announcements. A reference introduction remains a reference
-- even after a claim; it never becomes evidence of the owner's photographed work.
CREATE VIEW public.explore_unified_content_source WITH(security_invoker=true) AS
SELECT 'salon_profile_look:'||p.id AS content_key,'salon_profile_look'::text AS source_type,p.id AS content_id,p.salon_id,p.author_user_id,p.published_at,
 false AS is_reference,p.title,coalesce(p.caption,'') AS caption,p.media_path,
 setweight(to_tsvector('english',coalesce(p.title,'')),'A')||setweight(to_tsvector('english',coalesce(p.caption,'')),'B') AS search_terms,
 EXISTS(SELECT 1 FROM public.salon_profile_media_assets m WHERE m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.bucket='salon-profile-media' AND m.purpose='look' AND m.status='active' AND m.deleted_at IS NULL AND public.explore_unified_owned_media_path(m.object_path,p.salon_id,'look')) AS has_real_media
FROM public.salon_profile_looks p JOIN public.explore_salon_documents d USING(salon_id)
WHERE p.status='published' AND NOT p.safety_hold AND p.published_at IS NOT NULL
UNION ALL
SELECT 'salon_profile_update:'||p.id,'salon_profile_update',p.id,p.salon_id,p.author_user_id,p.published_at,
 EXISTS(SELECT 1 FROM public.salon_directory_listings l WHERE l.salon_id=p.salon_id AND l.reference_post_id=p.id),p.title,concat_ws(' ',p.caption,p.summary),p.media_path,
 setweight(to_tsvector('english',coalesce(p.title,'')),'A')||setweight(to_tsvector('english',concat_ws(' ',p.caption,p.summary)),'B'),
 NOT EXISTS(SELECT 1 FROM public.salon_directory_listings l WHERE l.salon_id=p.salon_id AND l.reference_post_id=p.id) AND EXISTS(SELECT 1 FROM public.salon_profile_media_assets m WHERE m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.bucket='salon-profile-media' AND m.purpose='update' AND m.status='active' AND m.deleted_at IS NULL AND public.explore_unified_owned_media_path(m.object_path,p.salon_id,'update'))
FROM public.salon_profile_updates p JOIN public.explore_salon_documents d USING(salon_id)
WHERE p.status='published' AND NOT p.safety_hold AND p.published_at IS NOT NULL
UNION ALL
SELECT 'beauty_post:'||p.id,'beauty_post',p.id,a.salon_id,p.author_user_id,p.created_at,false,NULL::text,coalesce(p.caption,''),NULL::text,
 setweight(to_tsvector('english',coalesce(p.caption,'')),'B'),
 EXISTS(SELECT 1 FROM public.beauty_post_media m WHERE m.post_id=p.id AND m.bucket='beauty-profile-media' AND m.role IN ('image','before','after') AND m.object_path ~ ('^'||p.author_user_id::text||'/beauty/'||m.role||'/[^/\\\\]+[.]webp$'))
FROM public.beauty_posts p JOIN public.beauty_profiles profile ON profile.id=p.profile_id AND profile.visibility='public'
JOIN public.users u ON u.id=p.author_user_id AND u.status<>'deleted'
JOIN public.beauty_post_attributions a ON a.post_id=p.id JOIN public.explore_salon_documents d ON d.salon_id=a.salon_id
WHERE p.deleted_at IS NULL AND NOT p.safety_hold AND p.visibility='public' AND p.moderation_status='visible';
REVOKE ALL ON public.explore_unified_content_source FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.explore_unified_salon_fingerprint(d public.explore_salon_documents) RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT md5(jsonb_build_array(d.salon_name_search,d.service_search_text,d.service_category_search_text,d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,d.profile_completeness,d.created_at,d.public_discovery_published_at,d.starting_price,explore_unified_has_real_cover(d))::text)
$$;
CREATE FUNCTION public.refresh_explore_unified_search(p_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
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
 d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,coalesce(d.profile_completeness,0),d.created_at,d.public_discovery_published_at,d.starting_price,explore_unified_has_real_cover(d)
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

CREATE FUNCTION public.sync_explore_unified_search() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[];source_ids uuid[];field_name text;source_sql text;
BEGIN
 field_name:=CASE WHEN TG_TABLE_NAME IN ('beauty_posts','beauty_profiles','users') THEN 'id' WHEN TG_TABLE_NAME='beauty_post_media' THEN 'post_id' ELSE 'salon_id' END;
 source_sql:=CASE WHEN TG_OP='INSERT' THEN 'SELECT '||field_name||' AS id FROM unified_new'
  WHEN TG_OP='DELETE' THEN 'SELECT '||field_name||' AS id FROM unified_old'
  ELSE 'SELECT '||field_name||' AS id FROM unified_new UNION SELECT '||field_name||' AS id FROM unified_old' END;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='users' THEN source_sql:='SELECT n.id FROM unified_new n JOIN unified_old o USING(id) WHERE n.status IS DISTINCT FROM o.status';END IF;
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='beauty_profiles' THEN source_sql:='SELECT n.id FROM unified_new n JOIN unified_old o USING(id) WHERE n.visibility IS DISTINCT FROM o.visibility';END IF;
 EXECUTE 'SELECT array_agg(DISTINCT id) FROM ('||source_sql||') x' INTO source_ids;
 IF TG_TABLE_NAME IN ('beauty_posts','beauty_post_media') THEN SELECT array_agg(DISTINCT salon_id) INTO ids FROM (SELECT salon_id FROM beauty_post_attributions WHERE post_id=ANY(source_ids) UNION SELECT salon_id FROM explore_unified_content_history WHERE source_type='beauty_post' AND content_id=ANY(source_ids) AND valid_to IS NULL) x;
 ELSIF TG_TABLE_NAME='beauty_profiles' THEN SELECT array_agg(DISTINCT a.salon_id) INTO ids FROM beauty_posts p JOIN beauty_post_attributions a ON a.post_id=p.id WHERE p.profile_id=ANY(source_ids);
 ELSIF TG_TABLE_NAME='users' THEN SELECT array_agg(DISTINCT salon_id) INTO ids FROM (SELECT a.salon_id FROM beauty_posts p JOIN beauty_post_attributions a ON a.post_id=p.id WHERE p.author_user_id=ANY(source_ids) UNION SELECT salon_id FROM explore_unified_content_history WHERE author_user_id=ANY(source_ids) AND valid_to IS NULL) x;
 ELSE ids:=source_ids;END IF;
 PERFORM refresh_explore_unified_search(ids);RETURN NULL;
END $$;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['explore_salon_documents','salon_profile_looks','salon_profile_updates','salon_directory_listings','salon_profile_media_assets','beauty_posts','beauty_post_attributions','beauty_post_media','beauty_profiles','users'] LOOP
  EXECUTE format('CREATE TRIGGER explore_unified_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS unified_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_unified_search()',t);
  EXECUTE format('CREATE TRIGGER explore_unified_update AFTER UPDATE ON public.%I REFERENCING NEW TABLE AS unified_new OLD TABLE AS unified_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_unified_search()',t);
  EXECUTE format('CREATE TRIGGER explore_unified_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS unified_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_unified_search()',t);
 END LOOP;
END $$;
SELECT public.refresh_explore_unified_search(array_agg(salon_id)) FROM public.explore_salon_documents;
-- Bulk-build the spatial index after backfill rather than repeatedly splitting
-- GiST pages while importing the existing directory inside this migration.
CREATE INDEX explore_unified_salon_geo_idx ON public.explore_unified_salon_history USING gist(extensions.ll_to_earth(latitude,longitude)) WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180;

ALTER TABLE public.explore_search_sessions ADD COLUMN unified_canonical jsonb,ADD COLUMN unified_revision bigint,ADD COLUMN unified_anchor jsonb,ADD COLUMN unified_reference_category text;
ALTER TABLE public.explore_search_session_candidates ADD COLUMN unified_payload jsonb,ADD COLUMN unified_delivered boolean NOT NULL DEFAULT false;

CREATE FUNCTION public.explore_unified_all_tokens(p_text text,p_query text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT coalesce(p_query,'')<>'' AND NOT EXISTS(SELECT 1 FROM unnest(regexp_split_to_array(p_query,'\s+')) token WHERE position(token IN coalesce(p_text,''))=0)
$$;
-- A common service word must not erase the distinctive part of a salon name.
-- Allow one insertion/deletion/substitution or adjacent transposition per token;
-- keep the indexed trigram probe and score the best name extent so a legal or
-- service suffix does not penalize an otherwise complete distinctive-token match.
CREATE FUNCTION public.explore_unified_name_token_near(a text,b text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public AS $$
DECLARE la integer:=length(a);lb integer:=length(b);i integer;first_difference integer:=0;second_difference integer:=0;longer text;shorter text;
BEGIN
 IF a=b THEN RETURN true;END IF;
 IF least(la,lb)<3 OR abs(la-lb)>1 THEN RETURN false;END IF;
 IF la=lb THEN
  FOR i IN 1..la LOOP
   IF substr(a,i,1)<>substr(b,i,1) THEN
    IF first_difference=0 THEN first_difference:=i;ELSIF second_difference=0 THEN second_difference:=i;ELSE RETURN false;END IF;
   END IF;
  END LOOP;
  RETURN second_difference=0 OR (second_difference=first_difference+1 AND substr(a,first_difference,1)=substr(b,second_difference,1) AND substr(a,second_difference,1)=substr(b,first_difference,1));
 END IF;
 longer:=CASE WHEN la>lb THEN a ELSE b END;shorter:=CASE WHEN la>lb THEN b ELSE a END;
 FOR i IN 1..least(la,lb) LOOP
  IF substr(longer,i,1)<>substr(shorter,i,1) THEN RETURN substr(longer,i+1)=substr(shorter,i);END IF;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION public.explore_unified_name_similarity(p_name text,p_query text) RETURNS float8 LANGUAGE plpgsql IMMUTABLE SET search_path=public,extensions AS $$
DECLARE query_tokens text[];name_tokens text[];q text;n text;compact_name text;covered boolean;score float8;
BEGIN
 IF p_name IS NULL OR p_query IS NULL OR length(p_query)<4 OR length(p_query)>80 THEN RETURN 0;END IF;
 query_tokens:=regexp_split_to_array(p_query,'\s+');IF cardinality(query_tokens)>8 THEN RETURN 0;END IF;
 name_tokens:=regexp_split_to_array(p_name,'\s+');compact_name:=replace(p_name,' ','');
 -- This procedural rejection is deliberately before either trigram score. SQL
 -- AND expressions can be reordered and otherwise score thousands of generic
 -- service names which lack the query's distinctive token.
 FOREACH q IN ARRAY query_tokens LOOP
  IF q=ANY(ARRAY['nail','nails','salon','salons','spa','spas','beauty','studio','studios','and','the','llc','inc']) OR left(compact_name,length(q))=q OR q=ANY(name_tokens) THEN CONTINUE;END IF;
  covered:=false;
  FOREACH n IN ARRAY name_tokens LOOP
   IF explore_unified_name_token_near(n,q) THEN covered:=true;EXIT;END IF;
  END LOOP;
  IF NOT covered THEN RETURN 0;END IF;
 END LOOP;
 score:=greatest(extensions.similarity(p_name,p_query),extensions.word_similarity(p_query,p_name));
 RETURN CASE WHEN score>=0.45 THEN score ELSE 0::float8 END;
END $$;
CREATE FUNCTION public.explore_unified_facet_terms(f jsonb) RETURNS tsquery LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT plainto_tsquery('english',coalesce(string_agg(value,' ' ORDER BY key),'')) FROM jsonb_each_text(f) WHERE key IN ('shape','length','color','finish','tone','season')
$$;
CREATE FUNCTION public.explore_unified_filter_salon(d public.explore_salon_documents,f jsonb,actor uuid,at_time timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT (f->>'maxPrice' IS NULL OR d.starting_price<=(f->>'maxPrice')::numeric)
 AND (NOT coalesce((f->>'newOnly')::boolean,false) OR d.created_at>=at_time-interval '30 days')
 AND (NOT coalesce((f->>'bookableOnly')::boolean,false) OR EXISTS(SELECT 1 FROM booking_settings b WHERE b.salon_id=d.salon_id AND b.booking_enabled AND b.online_booking_visible AND coalesce(b.guest_booking_enabled,true)) AND EXISTS(SELECT 1 FROM services s WHERE s.salon_id=d.salon_id AND s.is_active AND s.online_booking_enabled))
 AND (NOT coalesce((f->>'trendingOnly')::boolean,false) OR EXISTS(SELECT 1 FROM explore_unified_content_history c JOIN explore_social_trending t USING(content_key) WHERE c.salon_id=d.salon_id AND c.valid_to IS NULL AND NOT c.is_reference AND NOT social_users_blocked(actor,c.author_user_id)))
$$;

CREATE FUNCTION public.explore_unified_candidate_live(s public.explore_search_sessions,c public.explore_search_session_candidates,d public.explore_salon_documents) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
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
 IF kind='service' THEN RETURN explore_unified_all_tokens(d.service_search_text,coalesce(canon->>'contentQuery',s.query_text));END IF;
 IF kind IN ('post','reference_post') THEN RETURN EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.content_key=c.unified_payload->>'matchContentKey' AND p.source_token::text=c.unified_payload->>'matchContentSourceToken' AND p.salon_id=d.salon_id AND p.valid_to IS NULL AND p.is_reference=(kind='reference_post') AND p.search_terms@@terms AND NOT social_users_blocked(s.user_id,p.author_user_id));END IF;
 IF kind='related_post' THEN RETURN EXISTS(SELECT 1 FROM explore_unified_content_history p WHERE p.content_key=c.unified_payload->>'matchContentKey' AND p.source_token::text=c.unified_payload->>'matchContentSourceToken' AND p.salon_id=d.salon_id AND p.valid_to IS NULL AND NOT p.is_reference AND p.search_terms@@to_tsquery('english',replace(terms::text,' & ',' | ')) AND (NOT has_facets OR p.search_terms@@explore_unified_facet_terms(canon->'filters')) AND NOT social_users_blocked(s.user_id,p.author_user_id));END IF;
 RETURN kind IN ('nearby','suggested');
END $$;

-- Rank the full eligible scope BEFORE LIMIT, with one content winner per salon.
-- The frozen history revision makes the keyset stable through post/profile edits.
CREATE FUNCTION public.explore_unified_pull_batch(p_session uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET jit=off AS $$
DECLARE s explore_search_sessions;canon jsonb;region jsonb;broader_region jsonb;eligibility text;local_predicate text;broader_predicate text;anchor_key float8[];anchor_id uuid;batch jsonb;r jsonb;added integer:=0;name_fragment text;service_fragment text;phase integer;candidate_region jsonb;candidate_label text;
BEGIN
 SELECT * INTO STRICT s FROM explore_search_sessions WHERE id=p_session FOR UPDATE;
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
    WHEN rel.salon_id IS NOT NULL THEN 8
    WHEN $3='' AND $4='' THEN 7 ELSE 9 END AS tier,
   CASE WHEN %s THEN 0 WHEN %s THEN 1 ELSE 2 END AS area_tier,
   (h.has_real_cover OR photo.salon_id IS NOT NULL) AS snapshot_real_media,
   ($19<>'' AND h.service_category_search_text LIKE '%%'||$19||'%%' AND d.service_category_search_text LIKE '%%'||$19||'%%') AS related_category,
   geo.distance_meters/1609.344 AS distance
  FROM explore_unified_salon_history h JOIN explore_salon_documents d USING(salon_id)
  JOIN explore_unified_salon_incarnations incarnation ON incarnation.salon_id=h.salon_id AND incarnation.source_token=h.source_token
  LEFT JOIN content_matches m ON m.salon_id=h.salon_id
  LEFT JOIN related_matches rel ON rel.salon_id=h.salon_id
  LEFT JOIN name_matches n ON n.salon_id=h.salon_id
  LEFT JOIN service_matches v ON v.salon_id=h.salon_id
  LEFT JOIN real_media_salons photo ON photo.salon_id=h.salon_id
  LEFT JOIN salon_distances geo ON geo.salon_id=h.salon_id
  WHERE h.valid_from<=$1 AND (h.valid_to IS NULL OR h.valid_to>$1) AND h.created_at<=$2 AND (h.public_discovery_published_at IS NULL OR h.public_discovery_published_at<=$2)
   AND d.created_at<=$2 AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=$2) AND d.has_public_profile
   AND %s AND (($6-ARRAY['shape','length','color','finish','tone','season'])='{}'::jsonb OR explore_unified_filter_salon(d,$6,$5,$2))
   AND (($19<>'' AND h.service_category_search_text LIKE '%%'||$19||'%%') OR ($3='' AND $4='') OR n.salon_id IS NOT NULL OR m.content_key IS NOT NULL OR rel.salon_id IS NOT NULL OR v.salon_id IS NOT NULL)
 ), phased AS MATERIALIZED (
  SELECT e.*,CASE WHEN (($20<>'fixed' AND NOT $11) OR area_tier=0) AND (tier<6 OR tier=7) THEN 0
   WHEN area_tier=0 THEN 1 WHEN area_tier=1 AND tier<6 THEN 2 WHEN area_tier=1 THEN 3 WHEN tier<6 THEN 4 ELSE 5 END AS reference_phase
  FROM eligible e WHERE tier<9 OR related_category
 ), ranked AS MATERIALIZED (
  SELECT e.*,ARRAY[CASE WHEN reference_phase=0 THEN 0 ELSE 1 END::float8,
   CASE WHEN reference_phase>0 AND $11 THEN area_tier ELSE 0 END::float8,
   CASE WHEN reference_phase=0 THEN 0 WHEN tier<=4 THEN 1 WHEN tier=8 THEN 2 WHEN snapshot_real_media THEN 3 ELSE 4 END::float8,
   CASE WHEN reference_phase>0 AND tier<=4 THEN tier ELSE 0 END::float8,
   reference_phase::float8,
   CASE WHEN $11 OR $12='closest' THEN area_tier ELSE 0 END::float8,
   CASE WHEN $11 OR $12='closest' THEN coalesce(distance,1e12) ELSE 0 END,
   CASE WHEN $12='newest' THEN -extract(epoch FROM created_at)::float8 ELSE tier::float8 END,
   CASE WHEN $12='newest' THEN tier::float8 ELSE -coalesce(content_score,0) END,
   CASE WHEN $11 OR $12='closest' THEN 0 ELSE area_tier END::float8,
   CASE WHEN $11 OR $12='closest' THEN 0 ELSE coalesce(distance,1e12) END,
   -profile_completeness::float8] AS order_key
  FROM phased e
 ) SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY order_key,salon_id),'[]') FROM (
  SELECT * FROM ranked WHERE ($14 IS NULL OR ROW(order_key,salon_id)>ROW($14,$15))
   AND NOT EXISTS(SELECT 1 FROM explore_search_session_candidates c WHERE c.session_id=$16 AND c.salon_id=ranked.salon_id)
  ORDER BY order_key,salon_id LIMIT 64
 ) page
 $sql$,local_predicate,broader_predicate,eligibility) INTO batch USING s.unified_revision,s.created_at,s.query_text,coalesce(canon->>'contentQuery',''),s.user_id,canon->'filters',
 s.rank_origin_latitude,s.rank_origin_longitude,canon->>'queryKind',(canon->'filters') ?| ARRAY['shape','length','color','finish','tone','season'],coalesce((canon->>'locationPriority')::boolean,false),s.applied_sort,s.category_text,anchor_key,anchor_id,s.id,name_fragment,service_fragment,coalesce(s.unified_reference_category,''),s.scope_policy;
 FOR r IN SELECT value FROM jsonb_array_elements(batch) LOOP
  phase:=(r->>'reference_phase')::int;
  candidate_region:=CASE WHEN phase=0 AND s.scope_policy='expandable' AND NOT coalesce((canon->>'locationPriority')::boolean,false) THEN jsonb_build_object('kind','global') WHEN phase IN (0,1) THEN region WHEN phase IN (2,3) THEN broader_region ELSE jsonb_build_object('kind','global') END;
  candidate_label:=CASE WHEN phase IN (0,1) THEN coalesce(region->>'label','Selected area') WHEN phase IN (2,3) THEN coalesce(broader_region->>'label','Broader area') ELSE 'Other areas' END;
  INSERT INTO explore_search_session_candidates(session_id,ordinal,salon_id,search_scope,scope_label,eligibility_region,rank_score,distance_miles,match_type,unified_payload)
  VALUES(s.id,s.next_ordinal,(r->>'salon_id')::uuid,CASE r->>'area_tier' WHEN '0' THEN 'A' WHEN '1' THEN 'B' ELSE 'C' END,
   candidate_label,candidate_region,
   100-(r->>'tier')::int,(r->>'distance')::float8,
   CASE (r->>'tier')::int WHEN 0 THEN 'exact_name' WHEN 1 THEN 'prefix_name' WHEN 2 THEN 'name_tokens' WHEN 3 THEN 'fuzzy_name' WHEN 4 THEN 'post' WHEN 6 THEN 'reference_post' WHEN 5 THEN 'service' WHEN 7 THEN 'nearby' WHEN 8 THEN 'related_post' ELSE 'suggested' END,
   jsonb_build_object('sourceToken',r->'source_token','tier',r->'tier','orderKey',r->'order_key','referencePhase',phase,'snapshotRealMedia',r->'snapshot_real_media','recommendationAreaLabel',CASE WHEN phase>0 THEN candidate_label END,
    'recommendationReason',CASE phase WHEN 1 THEN 'related_in_area' WHEN 2 THEN 'matching_in_broader_area' WHEN 3 THEN 'related_in_broader_area' WHEN 4 THEN 'matching_in_other_areas' WHEN 5 THEN 'related_in_other_areas' END,
    'matchContentKey',r->'content_key','matchContentSourceToken',r->'content_source_token','matchSource',CASE WHEN (r->>'tier')::int<=3 THEN 'salon_name' WHEN (r->>'tier')::int IN (4,8) THEN CASE WHEN r->>'source_type'='beauty_post' THEN 'customer_post' ELSE 'salon_post' END WHEN (r->>'tier')::int=6 THEN 'reference_post' WHEN (r->>'tier')::int=5 THEN 'service' WHEN (r->>'tier')::int=7 THEN 'category' ELSE 'suggested' END))
  ON CONFLICT(session_id,salon_id) DO NOTHING;
  s.next_ordinal:=s.next_ordinal+1;added:=added+1;
 END LOOP;
 UPDATE explore_search_sessions SET next_ordinal=s.next_ordinal,exhausted=jsonb_array_length(batch)<64,
  unified_anchor=CASE WHEN jsonb_array_length(batch)>0 THEN jsonb_build_object('key',batch->-1->'order_key','id',batch->-1->'salon_id') ELSE unified_anchor END WHERE id=s.id;
 RETURN added;
END $$;

-- Current public source and positive, same-salon asset ownership are checked on
-- every page/replay/hydration. No old cover path or feed queue can authorize media.
CREATE FUNCTION public.hydrate_explore_unified_search(p_session uuid,p_ids uuid[]) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object(
  'pagination_cursor',jsonb_build_object('version',3,'session',s.id,'after',c.ordinal),
  'search_scope',c.search_scope,'scope_label',c.scope_label,'distance_miles',CASE WHEN s.rank_origin_latitude IS NOT NULL AND d.latitude BETWEEN -90 AND 90 AND d.longitude BETWEEN -180 AND 180 THEN extensions.earth_distance(extensions.ll_to_earth(s.rank_origin_latitude,s.rank_origin_longitude),extensions.ll_to_earth(d.latitude,d.longitude))/1609.344 END,
  'match_tier',(c.unified_payload->>'tier')::int,'match_type',c.match_type,'match_source',c.unified_payload->>'matchSource','is_reference_match',(c.unified_payload->>'referencePhase')::int>0,
  'is_primary_match',(c.unified_payload->>'referencePhase')::int=0,'recommendation_reason',c.unified_payload->>'recommendationReason','recommendation_area_label',c.unified_payload->>'recommendationAreaLabel',
  'result_group',CASE WHEN (c.unified_payload->>'referencePhase')::int>0 THEN 'reference' WHEN c.match_type='nearby' THEN 'nearby' ELSE 'best_match' END,'relevance_score',c.rank_score,'is_new',d.created_at>=s.created_at-interval '30 days',
  'selected_content_key',media.content_key,'selected_content_id',media.content_id,'selected_content_type',media.source_type,
  'selected_media_path',coalesce(media.media_path,cover.object_path),'selected_media_bucket',CASE WHEN media.media_path IS NOT NULL THEN media.bucket WHEN cover.object_path IS NOT NULL THEN 'salon-profile-media' END,
  'selected_media_salon_id',CASE WHEN coalesce(media.media_path,cover.object_path) IS NOT NULL THEN d.salon_id END,
  'selected_media_author_user_id',media.author_user_id,'selected_media_role',media.role,
  'selected_content_title',media.title,'selected_content_caption',left(media.caption,500),'matched_content_key',c.unified_payload->>'matchContentKey',
  'valid_cover_image_path',cover.object_path,'valid_cover_salon_id',CASE WHEN cover.object_path IS NOT NULL THEN d.salon_id END,
  'image_provenance',CASE WHEN media.media_path IS NOT NULL THEN CASE WHEN media.source_type='beauty_post' THEN 'customer_post' ELSE 'salon_post' END WHEN cover.object_path IS NOT NULL THEN 'salon_cover' ELSE 'suggested' END,
  'media_revision',md5(jsonb_build_array(media.content_key,media.media_path,media.asset_id,cover.object_path,cover.id)::text),
  'claim_state',listing.claim_state,'reference_post_id',listing.reference_post_id
 ) ORDER BY c.ordinal),'[]')
 FROM explore_search_sessions s JOIN explore_search_session_candidates c ON c.session_id=s.id JOIN explore_salon_documents d ON d.salon_id=c.salon_id
 LEFT JOIN salon_directory_listings listing ON listing.salon_id=d.salon_id
 LEFT JOIN LATERAL (
  SELECT p.content_key,p.content_id,p.source_type,p.title,p.caption,m.object_path AS media_path,m.id AS asset_id,m.bucket,m.role,p.author_user_id
  FROM explore_unified_content_source p JOIN LATERAL (
   SELECT a.id,a.object_path,a.bucket,NULL::text AS role,0 AS display_order FROM salon_profile_media_assets a
   WHERE p.source_type IN ('salon_profile_look','salon_profile_update') AND a.salon_id=p.salon_id AND a.object_path=p.media_path AND a.bucket='salon-profile-media' AND a.status='active' AND a.deleted_at IS NULL
    AND a.purpose=CASE p.source_type WHEN 'salon_profile_look' THEN 'look' ELSE 'update' END AND explore_unified_owned_media_path(a.object_path,p.salon_id,a.purpose)
   UNION ALL
   SELECT a.id,a.object_path,a.bucket,a.role,a.display_order FROM beauty_post_media a
   WHERE p.source_type='beauty_post' AND a.post_id=p.content_id AND a.bucket='beauty-profile-media' AND a.role IN ('image','before','after')
    AND a.object_path ~ ('^'||p.author_user_id::text||'/beauty/'||a.role||'/[^/\\\\]+[.]webp$')
  ) m ON true
  WHERE p.salon_id=d.salon_id AND NOT p.is_reference AND p.published_at<=now()
   AND NOT social_users_blocked(s.user_id,p.author_user_id)
   AND (p.source_type<>'beauty_post' OR coalesce(s.unified_canonical->>'contentQuery','')='' OR (s.unified_canonical->>'queryKind'<>'style' AND NOT ((s.unified_canonical->'filters') ?| ARRAY['shape','length','color','finish','tone','season']))
    OR (p.search_terms@@CASE WHEN s.unified_canonical->>'queryKind'='style' THEN to_tsquery('english',replace(plainto_tsquery('english',s.unified_canonical->>'contentQuery')::text,' & ',' | ')) ELSE plainto_tsquery('english',s.unified_canonical->>'contentQuery') END
     AND (NOT ((s.unified_canonical->'filters') ?| ARRAY['shape','length','color','finish','tone','season']) OR p.search_terms@@explore_unified_facet_terms(s.unified_canonical->'filters'))))
  ORDER BY CASE WHEN p.content_key=c.unified_payload->>'matchContentKey' THEN 0 WHEN p.search_terms@@plainto_tsquery('english',s.unified_canonical->>'contentQuery') THEN 1 ELSE 2 END,CASE WHEN p.source_type='beauty_post' THEN 1 ELSE 0 END,p.published_at DESC,p.content_key,m.display_order,m.id LIMIT 1
 ) media ON true
 LEFT JOIN LATERAL (SELECT m.id,m.object_path FROM salon_profile_media_assets m WHERE m.salon_id=d.salon_id AND m.object_path=d.cover_image_path AND m.bucket='salon-profile-media' AND m.purpose='cover' AND m.status='active' AND m.deleted_at IS NULL AND explore_unified_owned_media_path(m.object_path,d.salon_id,'cover') ORDER BY m.id LIMIT 1) cover ON true
 WHERE s.id=p_session AND c.salon_id=ANY(p_ids) AND explore_unified_candidate_live(s,c,d)
$$;

-- Renaming preserves old in-flight v2 sessions without a PostgREST overload.
ALTER FUNCTION public.search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text) RENAME TO _explore_search_session_v2;
REVOKE ALL ON FUNCTION public._explore_search_session_v2(text,text,text,float8,float8,text,integer,jsonb,text,text) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.search_public_explore_session(
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
 canon:=jsonb_build_object('query',q,'contentQuery',cq,'queryKind',kind,'locationPriority',coalesce(p_location_priority,false),'filters',f,'location',btrim(coalesce(p_location,'')),'category',coalesce(p_category,''),'latitude',p_latitude,'longitude',p_longitude,'scopePolicy',p_scope_policy,'intent',coalesce(p_intent,'search'));
 sig:=md5(jsonb_build_array(canon,p_sort,coalesce(p_intent,'search'))::text);
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR octet_length(p_cursor::text)>512 OR p_cursor->>'version'<>'3' THEN RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023';END IF;
  BEGIN sid:=(p_cursor->>'session')::uuid;after_value:=(p_cursor->>'after')::bigint;EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Invalid search cursor' USING ERRCODE='22023';END;
  SELECT * INTO s FROM explore_search_sessions WHERE id=sid FOR UPDATE;
  IF s.id IS NULL OR s.expires_at<=now() OR s.viewer_key<>viewer OR s.signature<>sig OR s.unified_canonical IS NULL OR after_value IS NULL OR after_value<0 OR after_value>=s.next_ordinal THEN RAISE EXCEPTION 'Search changed or expired; refresh results' USING ERRCODE='22023';END IF;
 ELSE
  IF p_hydrate_ids IS NOT NULL THEN RAISE EXCEPTION 'Hydration requires a search session' USING ERRCODE='22023';END IF;
  sid:=gen_random_uuid();region:=explore_search_region(p_location,p_latitude,p_longitude);
  broader_region:=CASE WHEN region->>'kind'='geo' THEN jsonb_build_object('kind','geo','latitude',p_latitude,'longitude',p_longitude,'radius',80467.2,'scope','B','label','Within 50 miles')
   WHEN region->>'state' IS NOT NULL THEN jsonb_build_object('kind','state','state',region->>'state','scope','B','label',region->>'state') ELSE jsonb_build_object('kind','global','scope','C','label','Other areas') END;
  INSERT INTO explore_search_sessions(id,user_id,viewer_key,signature,query_text,category_text,requested_sort,applied_sort,scope_policy,intent,region_plan,unified_canonical,unified_revision,rank_origin_latitude,rank_origin_longitude,supported_sorts,sort_fallback_reason,ranking_basis)
  VALUES(sid,current_public_user_id(),viewer,sig,q,cat,p_sort,CASE WHEN p_sort IN ('trusted','bookable') OR p_sort='closest' AND p_latitude IS NULL THEN 'relevance' ELSE p_sort END,p_scope_policy,coalesce(p_intent,'search'),jsonb_build_array(region,broader_region),canon,(SELECT revision FROM explore_unified_search_clock WHERE id),p_latitude,p_longitude,
   CASE WHEN p_latitude IS NOT NULL THEN ARRAY['relevance','closest','newest'] ELSE ARRAY['relevance','newest'] END,CASE WHEN p_sort IN ('trusted','bookable') THEN 'unified_sort_not_supported' WHEN p_sort='closest' AND p_latitude IS NULL THEN 'location_required' END,'unified_indexed_scope');
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

-- Existing scheduled cleanup also retires semantic history after every possible
-- session using it has expired. No canonical source records are deleted.
ALTER FUNCTION public.cleanup_explore_search_sessions(integer) RENAME TO _explore_cleanup_search_sessions_v2;
CREATE FUNCTION public.cleanup_explore_search_sessions(p_limit integer DEFAULT 5000) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE removed integer;BEGIN
 removed:=_explore_cleanup_search_sessions_v2(p_limit);
 DELETE FROM explore_unified_salon_history WHERE (salon_id,valid_from) IN(SELECT salon_id,valid_from FROM explore_unified_salon_history WHERE retired_at<now()-interval '35 minutes' ORDER BY retired_at LIMIT least(10000,greatest(1,p_limit)));
 DELETE FROM explore_unified_content_history WHERE (content_key,valid_from) IN(SELECT content_key,valid_from FROM explore_unified_content_history WHERE retired_at<now()-interval '35 minutes' ORDER BY retired_at LIMIT least(10000,greatest(1,p_limit)));
 RETURN removed;END $$;
DO $$ DECLARE t text;r record;BEGIN
 FOREACH t IN ARRAY ARRAY['explore_unified_search_clock','explore_unified_salon_incarnations','explore_unified_content_incarnations','explore_unified_salon_history','explore_unified_content_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'explore_unified_%' OR p.proname IN ('refresh_explore_unified_search','sync_explore_unified_search','hydrate_explore_unified_search','cleanup_explore_search_sessions','_explore_cleanup_search_sessions_v2')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_public_explore_session(text,text,text,float8,float8,text,integer,jsonb,text,text,text,text,boolean,jsonb,uuid[]) TO anon,authenticated,service_role;
ANALYZE public.explore_unified_salon_history;
ANALYZE public.explore_unified_content_history;
NOTIFY pgrst,'reload schema';
COMMIT;
