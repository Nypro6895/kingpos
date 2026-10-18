-- Bound content anti-joins to the affected salons before comparing history.
-- Preserve revision ordering, incarnations, fingerprints and atomic rollback.
CREATE OR REPLACE FUNCTION public.refresh_explore_unified_search(p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
 SET plan_cache_mode TO 'force_custom_plan'
 SET jit TO 'off'
AS $function$
DECLARE revision_value bigint;
BEGIN
 IF coalesce(cardinality(p_ids),0)=0 THEN RETURN;END IF;
 -- Only availability (not media URLs/revisions) affects reference ordering.
 -- Counters, ordinary logins and same-availability media edits take no clock lock.
 IF NOT EXISTS(SELECT 1 FROM explore_salon_documents d LEFT JOIN explore_unified_salon_history h ON h.salon_id=d.salon_id AND h.valid_to IS NULL WHERE d.salon_id=ANY(p_ids) AND (h.salon_id IS NULL OR h.fingerprint IS DISTINCT FROM explore_unified_salon_fingerprint(d)))
 AND NOT EXISTS(SELECT 1 FROM explore_unified_salon_history h WHERE h.salon_id=ANY(p_ids) AND h.valid_to IS NULL AND NOT EXISTS(SELECT 1 FROM explore_salon_documents d WHERE d.salon_id=h.salon_id))
 AND NOT EXISTS(SELECT 1 FROM explore_unified_content_source c LEFT JOIN explore_unified_content_history h ON h.content_key=c.content_key AND h.valid_to IS NULL WHERE c.salon_id=ANY(p_ids) AND (h.content_key IS NULL OR h.fingerprint IS DISTINCT FROM md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text)))
 AND NOT EXISTS(WITH scoped_content AS MATERIALIZED (SELECT * FROM public.explore_unified_content_source WHERE salon_id=ANY(p_ids)) SELECT 1 FROM explore_unified_content_history h WHERE h.salon_id=ANY(p_ids) AND h.valid_to IS NULL AND NOT EXISTS(SELECT 1 FROM scoped_content c WHERE c.content_key=h.content_key AND c.salon_id=h.salon_id)) THEN RETURN;END IF;
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
 WITH scoped_content AS MATERIALIZED (SELECT * FROM public.explore_unified_content_source WHERE salon_id=ANY(p_ids)) DELETE FROM explore_unified_content_incarnations i WHERE i.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM scoped_content c WHERE c.content_key=i.content_key AND c.salon_id=i.salon_id);
 INSERT INTO explore_unified_content_incarnations(content_key,salon_id) SELECT content_key,salon_id FROM explore_unified_content_source WHERE salon_id=ANY(p_ids) ON CONFLICT DO NOTHING;
 WITH scoped_content AS MATERIALIZED (SELECT * FROM public.explore_unified_content_source WHERE salon_id=ANY(p_ids)) UPDATE explore_unified_content_history h SET valid_to=revision_value,retired_at=clock_timestamp()
 WHERE h.valid_to IS NULL AND h.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM scoped_content c JOIN explore_unified_content_incarnations i USING(content_key,salon_id)
  WHERE c.content_key=h.content_key AND i.source_token=h.source_token AND md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text)=h.fingerprint);
 INSERT INTO explore_unified_content_history
 SELECT c.content_key,revision_value,NULL,NULL,i.source_token,md5(jsonb_build_array(c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media)::text),
 c.salon_id,c.source_type,c.content_id,c.author_user_id,c.published_at,c.is_reference,c.search_terms,c.has_real_media
 FROM explore_unified_content_source c JOIN explore_unified_content_incarnations i USING(content_key,salon_id)
 WHERE c.salon_id=ANY(p_ids) AND NOT EXISTS(SELECT 1 FROM explore_unified_content_history h WHERE h.content_key=c.content_key AND h.valid_to IS NULL);
END $function$
;
