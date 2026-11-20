-- Include the public salon name alongside every public post's title and body.
-- Existing regional, publication, moderation and full-query matching still apply.
BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_explore_social_keywords(p_keys text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF coalesce(cardinality(p_keys),0)=0 THEN RETURN; END IF;
 INSERT INTO explore_social_content_keywords(content_key,search_terms,state_code,city_search,postal_code,latitude,longitude,published_at)
 SELECT d.content_key,
 setweight(to_tsvector('english',coalesce(l.title,u.title,'')),'A')
 ||setweight(to_tsvector('english',coalesce(s.salon_name,'')),'A')
 ||setweight(to_tsvector('english',concat_ws(' ',l.caption,u.caption,u.summary,p.caption)),'B'),
 d.state_code,d.city_search,d.postal_code,d.latitude,d.longitude,d.published_at
 FROM explore_social_content_documents d
 LEFT JOIN salon_profile_looks l ON d.source_type='salon_profile_look' AND l.id=d.content_id
 LEFT JOIN salon_profile_updates u ON d.source_type='salon_profile_update' AND u.id=d.content_id
 LEFT JOIN beauty_posts p ON d.source_type='beauty_post' AND p.id=d.content_id
 LEFT JOIN explore_salon_documents s ON s.salon_id=d.salon_id
 WHERE d.content_key=ANY(p_keys)
 ON CONFLICT(content_key) DO UPDATE SET search_terms=excluded.search_terms,state_code=excluded.state_code,
 city_search=excluded.city_search,postal_code=excluded.postal_code,latitude=excluded.latitude,longitude=excluded.longitude,published_at=excluded.published_at;
END $$;

-- Refresh name terms even when an import edits only the salon read model.
-- Skip unrelated read-model updates (ranking, availability, etc.).
CREATE FUNCTION public.sync_explore_social_keyword_salon_names() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[]; keys text[];
BEGIN
 IF TG_OP='UPDATE' THEN
  SELECT array_agg(n.salon_id) INTO ids FROM keyword_salons_new n
  JOIN keyword_salons_old o USING(salon_id) WHERE n.salon_name IS DISTINCT FROM o.salon_name;
 ELSE
  SELECT array_agg(salon_id) INTO ids FROM keyword_salons_new;
 END IF;
 IF coalesce(cardinality(ids),0)=0 THEN RETURN NULL; END IF;
 SELECT array_agg(content_key) INTO keys FROM explore_social_content_documents WHERE salon_id=ANY(ids);
 PERFORM public.refresh_explore_social_keywords(keys);
 RETURN NULL;
END $$;

CREATE TRIGGER explore_social_keyword_salon_insert AFTER INSERT ON public.explore_salon_documents
 REFERENCING NEW TABLE AS keyword_salons_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_social_keyword_salon_names();
CREATE TRIGGER explore_social_keyword_salon_update AFTER UPDATE ON public.explore_salon_documents
 REFERENCING OLD TABLE AS keyword_salons_old NEW TABLE AS keyword_salons_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_social_keyword_salon_names();

REVOKE ALL ON FUNCTION public.sync_explore_social_keyword_salon_names() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_explore_social_keyword_salon_names() TO service_role;

DO $$
DECLARE keys text[]; after_key text:='';
BEGIN
 LOOP
  SELECT array_agg(content_key ORDER BY content_key) INTO keys FROM (
   SELECT content_key FROM public.explore_social_content_documents WHERE content_key>after_key ORDER BY content_key LIMIT 500
  ) batch;
  EXIT WHEN coalesce(cardinality(keys),0)=0;
  PERFORM public.refresh_explore_social_keywords(keys);
  after_key:=keys[cardinality(keys)];
 END LOOP;
END $$;
ANALYZE public.explore_social_content_keywords;
COMMIT;
