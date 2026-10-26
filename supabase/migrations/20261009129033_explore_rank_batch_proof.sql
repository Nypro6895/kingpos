-- Reuse bounded batch proof and current registered groups during ranking publication.
BEGIN;
CREATE OR REPLACE FUNCTION public.publish_explore_search_rank_jobs(p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE accepted jsonb;rev bigint;item jsonb;g record;d public.explore_salon_documents;is_ready boolean;source_id uuid;source_key uuid;source_groups text[];no_decay_ids uuid[];refresh_at timestamptz;published integer:=0;
BEGIN
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>100 THEN RAISE EXCEPTION 'Invalid rank batch' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'salon_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate rank job' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(126031,1);
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO accepted FROM jsonb_array_elements(p_rows) x JOIN public.explore_search_rank_jobs j ON j.salon_id=(x->>'salon_id')::uuid AND j.generation=(x->>'generation')::bigint AND j.lease=(x->>'lease')::uuid LEFT JOIN public.explore_search_rank_sources s ON s.salon_id=j.salon_id
 WHERE (s.salon_id IS NULL AND x->>'fingerprint' IS NULL) OR (s.fingerprint=x->>'fingerprint' AND x->>'rule_version'='lumi-trust-v2' AND (x->>'trust_score')::float8 BETWEEN 0 AND 1 AND (x->>'evidence_as_of')::timestamptz BETWEEN now()-interval '1 day' AND now()+interval '5 minutes');
 IF jsonb_array_length(accepted)>0 THEN
  -- The existing lock prevents a source/evidence mutation from committing
  -- between this bounded raw-ticket proof and publication.
  SELECT array_agg(policy.salon_id) INTO no_decay_ids
  FROM public.get_explore_rank_refresh_policy(ARRAY(
   SELECT (value->>'salon_id')::uuid FROM jsonb_array_elements(accepted)
   WHERE value->>'fingerprint' IS NOT NULL AND coalesce((value->>'empty_evidence')::boolean,false)
  )) policy WHERE policy.may_skip_decay;
  UPDATE public.explore_search_rank_clock SET revision=revision+1,as_of=now() WHERE singleton=true RETURNING revision INTO rev;
  FOR item IN SELECT value FROM jsonb_array_elements(accepted) LOOP
   source_id:=(item->>'salon_id')::uuid;
   UPDATE public.explore_search_rank_history SET valid_to=rev,retired_at=now() WHERE salon_id=source_id AND valid_to IS NULL;
   SELECT * INTO d FROM public.explore_salon_documents WHERE salon_id=source_id;
   IF FOUND THEN
    SELECT ready,source_token,group_keys INTO is_ready,source_key,source_groups FROM public.explore_search_rank_sources WHERE salon_id=source_id;
    refresh_at:=CASE WHEN coalesce((item->>'empty_evidence')::boolean,false) AND coalesce(source_id=ANY(no_decay_ids),false) THEN NULL ELSE (item->>'evidence_as_of')::timestamptz+interval '6 hours' END;
    FOR g IN SELECT group_id,group_key FROM public.explore_search_rank_groups WHERE group_key=ANY(source_groups) LOOP
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
NOTIFY pgrst,'reload schema';
COMMIT;
