-- Compatibility for the home sidebar and older inspiration callers. The
-- legacy cursor orders by media UUID, so store that exact key before LIMIT.
-- Requires the public social content projection from 20261009080031.
BEGIN;
SET LOCAL search_path=public,extensions;
CREATE TABLE public.explore_home_inspiration_documents (
 content_key text PRIMARY KEY,content_id uuid NOT NULL,source_type text NOT NULL,
 salon_id uuid NOT NULL,media_id uuid NOT NULL,published_at timestamptz NOT NULL
);
CREATE INDEX explore_home_inspiration_cursor_idx ON public.explore_home_inspiration_documents(published_at DESC,media_id DESC,content_key DESC);
ALTER TABLE public.explore_home_inspiration_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_home_inspiration_documents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.explore_home_inspiration_documents TO service_role;

CREATE FUNCTION public.refresh_explore_home_inspiration(p_keys text[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF coalesce(cardinality(p_keys),0)=0 THEN RETURN; END IF;
 DELETE FROM explore_home_inspiration_documents WHERE content_key=ANY(p_keys);
 INSERT INTO explore_home_inspiration_documents(content_key,content_id,source_type,salon_id,media_id,published_at)
 SELECT d.content_key,d.content_id,d.source_type,d.salon_id,coalesce(m.id,p.id),d.published_at
 FROM explore_social_content_documents d
 JOIN LATERAL(
  SELECT id,media_path FROM salon_profile_looks WHERE id=d.content_id AND d.source_type='salon_profile_look'
  UNION ALL SELECT id,media_path FROM salon_profile_updates WHERE id=d.content_id AND d.source_type='salon_profile_update'
 ) p ON true
 LEFT JOIN LATERAL(SELECT id FROM salon_profile_media_assets WHERE salon_id=d.salon_id AND object_path=p.media_path AND status='active' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) m ON true
 WHERE d.content_key=ANY(p_keys) AND d.source_type IN ('salon_profile_look','salon_profile_update');
END $$;
CREATE FUNCTION public.sync_explore_home_inspiration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE keys text[];
BEGIN
 IF TG_OP='INSERT' THEN SELECT array_agg(content_key) INTO keys FROM inspiration_new;
 ELSIF TG_OP='DELETE' THEN SELECT array_agg(content_key) INTO keys FROM inspiration_old;
 ELSE SELECT array_agg(DISTINCT content_key) INTO keys FROM(SELECT content_key FROM inspiration_new UNION ALL SELECT content_key FROM inspiration_old) x; END IF;
 PERFORM refresh_explore_home_inspiration(keys); RETURN NULL;
END $$;
CREATE TRIGGER explore_home_inspiration_insert AFTER INSERT ON public.explore_social_content_documents REFERENCING NEW TABLE AS inspiration_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_home_inspiration();
CREATE TRIGGER explore_home_inspiration_update AFTER UPDATE ON public.explore_social_content_documents REFERENCING OLD TABLE AS inspiration_old NEW TABLE AS inspiration_new FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_home_inspiration();
CREATE TRIGGER explore_home_inspiration_delete AFTER DELETE ON public.explore_social_content_documents REFERENCING OLD TABLE AS inspiration_old FOR EACH STATEMENT EXECUTE FUNCTION public.sync_explore_home_inspiration();
REVOKE ALL ON FUNCTION public.refresh_explore_home_inspiration(text[]),public.sync_explore_home_inspiration() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_explore_home_inspiration(text[]) TO service_role;
-- This one-time projection build is not repeated by user requests. Avoid
-- aggregating every source key into one array for a large initial backfill.
INSERT INTO explore_home_inspiration_documents(content_key,content_id,source_type,salon_id,media_id,published_at)
SELECT d.content_key,d.content_id,d.source_type,d.salon_id,coalesce(m.id,p.id),d.published_at
FROM explore_social_content_documents d
JOIN LATERAL(
 SELECT id,media_path FROM salon_profile_looks WHERE id=d.content_id AND d.source_type='salon_profile_look'
 UNION ALL SELECT id,media_path FROM salon_profile_updates WHERE id=d.content_id AND d.source_type='salon_profile_update'
) p ON true
LEFT JOIN LATERAL(SELECT id FROM salon_profile_media_assets WHERE salon_id=d.salon_id AND object_path=p.media_path AND status='active' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) m ON true
WHERE d.source_type IN ('salon_profile_look','salon_profile_update');

CREATE OR REPLACE FUNCTION public.get_public_explore_inspiration(p_cursor_media_id uuid DEFAULT NULL,p_cursor_published_at timestamptz DEFAULT NULL,p_page_size integer DEFAULT 18)
RETURNS TABLE(media_id uuid,content_id uuid,content_type text,salon_id uuid,salon_name text,salon_city text,salon_state text,salon_phone text,media_path text,image_width integer,image_height integer,aspect_ratio numeric,caption_excerpt text,published_at timestamptz,author_display_name text,author_is_anonymous boolean,service_name text,service_category text,bookable_service_id uuid,booking_enabled boolean,booking_href text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET plan_cache_mode=force_custom_plan SET jit=off AS $$
#variable_conflict use_column
DECLARE predicate text:='i.published_at<=now()';
BEGIN
 IF p_cursor_published_at IS NOT NULL THEN
  IF p_cursor_media_id IS NULL THEN predicate:=predicate||format(' AND i.published_at<=%L::timestamptz',p_cursor_published_at);
  ELSE predicate:=predicate||format(' AND ROW(i.published_at,i.media_id)<ROW(%L::timestamptz,%L::uuid)',p_cursor_published_at,p_cursor_media_id); END IF;
 END IF;
 RETURN QUERY EXECUTE format($query$
  WITH selected AS MATERIALIZED (
   SELECT i.* FROM explore_home_inspiration_documents i WHERE %s ORDER BY i.published_at DESC,i.media_id DESC,i.content_key DESC LIMIT $1
  ), posts AS (
   SELECT c.*,p.media_path,left(coalesce(p.caption,p.title),180) AS caption_excerpt,p.author_display_name,p.author_user_id,p.author_presentation_role,p.service_id
   FROM selected c JOIN salon_profile_looks p ON p.id=c.content_id AND c.source_type='salon_profile_look'
   WHERE p.status='published' AND NOT p.safety_hold AND p.published_at=c.published_at
   UNION ALL
   SELECT c.*,p.media_path,left(coalesce(p.caption,p.summary,p.title),180),p.author_display_name,p.author_user_id,p.author_presentation_role,p.service_id
   FROM selected c JOIN salon_profile_updates p ON p.id=c.content_id AND c.source_type='salon_profile_update'
   WHERE p.status='published' AND NOT p.safety_hold AND p.published_at=c.published_at
  )
  SELECT p.media_id,p.content_id,CASE WHEN p.source_type='salon_profile_look' THEN 'look' ELSE 'update' END,
   p.salon_id,d.salon_name,d.city,d.state,d.phone,p.media_path,m.width,m.height,
   CASE WHEN m.width IS NOT NULL AND m.height>0 THEN m.width::numeric/m.height::numeric ELSE NULL END,
   p.caption_excerpt,p.published_at,CASE WHEN p.author_presentation_role='staff' AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.author_user_id AND u.status='deleted') THEN d.salon_name ELSE p.author_display_name END,false,
   coalesce(primary_service.name,s.name),coalesce(primary_service.category,s.category),
   CASE WHEN social.bookable THEN coalesce(primary_service.id,CASE WHEN s.is_active AND s.online_booking_enabled THEN s.id END) ELSE NULL END,
   social.bookable,CASE WHEN social.bookable THEN '/book/'||p.salon_id::text ELSE NULL END
  FROM posts p JOIN explore_social_content_documents social ON social.content_key=p.content_key AND social.published_at=p.published_at
  JOIN explore_salon_documents d ON d.salon_id=p.salon_id AND (d.public_discovery_published_at IS NULL OR d.public_discovery_published_at<=now())
  LEFT JOIN services s ON s.id=p.service_id AND s.salon_id=p.salon_id
  LEFT JOIN salon_profile_media_assets m ON m.id=p.media_id AND m.salon_id=p.salon_id AND m.object_path=p.media_path AND m.status='active' AND m.deleted_at IS NULL
  LEFT JOIN LATERAL(SELECT config.* FROM salon_profile_content_booking_configs config
   WHERE (config.look_id=p.content_id AND p.source_type='salon_profile_look') OR (config.update_id=p.content_id AND p.source_type='salon_profile_update')
   ORDER BY config.updated_at DESC,config.id DESC LIMIT 1) cfg ON true
  LEFT JOIN services primary_service ON primary_service.id=cfg.primary_service_id AND primary_service.salon_id=p.salon_id AND primary_service.is_active AND primary_service.online_booking_enabled
  WHERE NOT EXISTS(SELECT 1 FROM salon_profile_media_assets blocked WHERE blocked.salon_id=p.salon_id AND blocked.object_path=p.media_path AND (blocked.status<>'active' OR blocked.deleted_at IS NOT NULL))
  ORDER BY p.published_at DESC,p.media_id DESC,p.content_key DESC
 $query$,predicate) USING least(24,greatest(1,coalesce(p_page_size,18)))+1;
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_inspiration(uuid,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_inspiration(uuid,timestamptz,integer) TO anon,authenticated,service_role;
COMMIT;
