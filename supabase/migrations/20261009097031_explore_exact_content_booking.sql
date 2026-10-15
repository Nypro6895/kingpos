-- Exact content selection is inside both source branches. The older salon-wide
-- RPC keeps its schema but supplies only the most recent 100 eligible posts;
-- callers with a known post must use the exact RPC, including older posts.
BEGIN;
CREATE INDEX IF NOT EXISTS explore_social_content_id_seek_idx ON public.explore_social_content_documents(content_id,source_type);
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public._explore_core_get_public_content_booking_options(uuid[])'::regprocedure) INTO definition;
 IF position('where (target_salon_ids is null or configs.salon_id = any(target_salon_ids))' IN definition)=0
 OR position('where (target_salon_ids is null or attributions.salon_id = any(target_salon_ids))' IN definition)=0 THEN
  RAISE EXCEPTION 'The installed booking core differs from the audited source predicates';
 END IF;
 definition:=regexp_replace(definition,'CREATE OR REPLACE FUNCTION public\._explore_core_get_public_content_booking_options\([^)]*\)',
  'CREATE FUNCTION public._explore_core_selected_content_booking_options(target_salon_ids uuid[], target_content_ids uuid[])');
 -- Config identities are not unique by post. Match the existing feed/profile
 -- latest-config rule and bound duplicate history before joining services.
 definition:=replace(definition,'from public.salon_profile_content_booking_configs configs',
  'from (SELECT chosen.* FROM unnest(target_content_ids) selected(content_id)
   CROSS JOIN LATERAL(SELECT candidate.* FROM (
    (SELECT config.* FROM public.salon_profile_content_booking_configs config WHERE config.look_id=selected.content_id AND config.salon_id=ANY(target_salon_ids) AND config.source_type=''salon_profile_look'' ORDER BY config.updated_at DESC,config.id DESC LIMIT 1)
    UNION ALL
    (SELECT config.* FROM public.salon_profile_content_booking_configs config WHERE config.update_id=selected.content_id AND config.salon_id=ANY(target_salon_ids) AND config.source_type=''salon_profile_update'' ORDER BY config.updated_at DESC,config.id DESC LIMIT 1)
   ) candidate ORDER BY candidate.updated_at DESC,candidate.id DESC LIMIT 1) chosen
  ) configs');
 definition:=replace(definition,'where (target_salon_ids is null or configs.salon_id = any(target_salon_ids))',
  'where configs.salon_id = any(target_salon_ids) AND (configs.look_id = any(target_content_ids) OR configs.update_id = any(target_content_ids))
   AND ((configs.look_id IS NOT NULL AND NOT looks.safety_hold AND looks.published_at<=now()) OR (configs.update_id IS NOT NULL AND NOT updates.safety_hold AND updates.published_at<=now()))
   AND NOT EXISTS(SELECT 1 FROM salon_profile_media_assets blocked WHERE blocked.salon_id=configs.salon_id AND blocked.object_path=coalesce(looks.media_path,updates.media_path) AND (blocked.status<>''active'' OR blocked.deleted_at IS NOT NULL))');
 definition:=replace(definition,'where (target_salon_ids is null or attributions.salon_id = any(target_salon_ids))',
  'where attributions.salon_id = any(target_salon_ids) AND posts.id = any(target_content_ids) AND NOT posts.safety_hold AND posts.created_at<=now()
   AND EXISTS(SELECT 1 FROM users author WHERE author.id=posts.author_user_id AND author.status<>''deleted'')');
 EXECUTE definition;
 REVOKE ALL ON FUNCTION public._explore_core_selected_content_booking_options(uuid[],uuid[]) FROM PUBLIC,anon,authenticated,service_role;
END $migration$;

CREATE FUNCTION public.get_public_explore_content_booking_options(target_salon_ids uuid[],target_content_ids uuid[])
RETURNS TABLE(content_id uuid,source_type text,content_type text,salon_id uuid,title text,caption text,media_path text,media_bucket text,credited_staff_id uuid,credited_staff_name text,booking_cta_enabled boolean,booking_enabled boolean,booking_href text,booking_note text,cta_label text,readiness_state text,readiness_message text,primary_service_id uuid,primary_service_name text,primary_service_base_price numeric,primary_service_duration_minutes integer,add_ons jsonb,additional_services jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE salons uuid[]; content_ids uuid[];
BEGIN
 salons:=public.explore_canonical_salon_ids(target_salon_ids);
 IF coalesce(cardinality(target_content_ids),0)>100 THEN RAISE EXCEPTION 'At most 100 content identities may be requested' USING ERRCODE='22023'; END IF;
 IF coalesce(cardinality(salons),0)=0 OR coalesce(cardinality(target_content_ids),0)=0 THEN RETURN; END IF;
 SELECT coalesce(array_agg(DISTINCT d.content_id),'{}') INTO content_ids
 FROM(SELECT DISTINCT id FROM unnest(target_content_ids) id WHERE id IS NOT NULL) selected
 JOIN explore_social_content_documents d ON d.content_id=selected.id
 WHERE d.salon_id=ANY(salons) AND d.published_at<=now();
 IF cardinality(content_ids)=0 THEN RETURN; END IF;
 RETURN QUERY
 SELECT r.content_id,r.source_type,r.content_type,r.salon_id,r.title,r.caption,r.media_path,r.media_bucket,
  CASE WHEN credited.id IS NOT NULL THEN r.credited_staff_id ELSE NULL END,
  CASE WHEN credited.id IS NOT NULL THEN r.credited_staff_name ELSE NULL END,
  r.booking_cta_enabled,availability.enabled,
  CASE WHEN availability.enabled THEN r.booking_href ELSE NULL END,
  r.booking_note,r.cta_label,CASE WHEN r.primary_service_id IS NOT NULL AND primary_service.id IS NULL THEN 'inspiration_only' ELSE r.readiness_state END,r.readiness_message,
  primary_service.id,CASE WHEN primary_service.id IS NOT NULL THEN r.primary_service_name ELSE NULL END,
  CASE WHEN primary_service.id IS NOT NULL THEN r.primary_service_base_price ELSE NULL END,
  CASE WHEN primary_service.id IS NOT NULL THEN r.primary_service_duration_minutes ELSE NULL END,r.add_ons,r.additional_services
 FROM public._explore_core_selected_content_booking_options(salons,content_ids) r
 JOIN explore_social_content_documents live ON live.content_id=r.content_id AND live.source_type=r.source_type AND live.salon_id=r.salon_id AND live.published_at<=now()
 LEFT JOIN services primary_service ON primary_service.id=r.primary_service_id AND primary_service.salon_id=r.salon_id AND primary_service.is_active AND primary_service.online_booking_enabled
 LEFT JOIN booking_settings current_booking ON current_booking.salon_id=r.salon_id
 CROSS JOIN LATERAL(SELECT r.booking_enabled IS TRUE AND live.bookable AND current_booking.booking_enabled IS TRUE
  AND current_booking.online_booking_visible IS TRUE AND coalesce(current_booking.guest_booking_enabled,true)
  AND (r.primary_service_id IS NULL OR primary_service.id IS NOT NULL)
  AND EXISTS(SELECT 1 FROM services offered WHERE offered.salon_id=r.salon_id AND offered.is_active AND offered.online_booking_enabled) AS enabled) availability
 LEFT JOIN staff credited ON credited.id=r.credited_staff_id AND credited.salon_id=r.salon_id AND credited.is_active
  AND NOT EXISTS(SELECT 1 FROM users author WHERE author.status='deleted' AND (author.id=credited.account_user_id OR author.auth_user_id=credited.user_id));
END $$;
REVOKE ALL ON FUNCTION public.get_public_explore_content_booking_options(uuid[],uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_content_booking_options(uuid[],uuid[]) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_public_content_booking_options(target_salon_ids uuid[] DEFAULT NULL)
RETURNS TABLE(content_id uuid,source_type text,content_type text,salon_id uuid,title text,caption text,media_path text,media_bucket text,credited_staff_id uuid,credited_staff_name text,booking_cta_enabled boolean,booking_enabled boolean,booking_href text,booking_note text,cta_label text,readiness_state text,readiness_message text,primary_service_id uuid,primary_service_name text,primary_service_base_price numeric,primary_service_duration_minutes integer,add_ons jsonb,additional_services jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public SET plan_cache_mode=force_custom_plan SET jit=off AS $$
DECLARE salons uuid[]; content_ids uuid[];
BEGIN
 salons:=public.explore_canonical_salon_ids(target_salon_ids);
 IF coalesce(cardinality(salons),0)=0 THEN RETURN; END IF;
 -- Each indexed salon branch produces <=100 IDs. Even a 100-salon batch has
 -- a bounded metadata pool before the final latest 100 selection/hydration.
 SELECT coalesce(array_agg(recent.content_id),'{}') INTO content_ids FROM (
  SELECT candidate.content_id,candidate.published_at,candidate.content_key
  FROM unnest(salons) selected(salon_id)
  CROSS JOIN LATERAL(SELECT d.content_id,d.published_at,d.content_key FROM explore_social_content_documents d
   WHERE d.salon_id=selected.salon_id AND d.published_at<=now() ORDER BY d.published_at DESC,d.content_key LIMIT 100) candidate
  ORDER BY candidate.published_at DESC,candidate.content_key LIMIT 100
 ) recent;
 RETURN QUERY SELECT * FROM public.get_public_explore_content_booking_options(salons,content_ids);
END $$;
COMMENT ON FUNCTION public.get_public_content_booking_options(uuid[]) IS 'Initial public inspiration options: latest 100 eligible posts in selected salons; pass known post IDs to get_public_explore_content_booking_options, including older recipes.';
REVOKE ALL ON FUNCTION public.get_public_content_booking_options(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_content_booking_options(uuid[]) TO anon,authenticated,service_role;
COMMIT;
