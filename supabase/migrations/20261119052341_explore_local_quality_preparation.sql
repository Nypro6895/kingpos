-- Foreground, bounded and resumable preparation for the default-OFF local index.
-- Applying this migration neither backfills the directory nor activates search.
BEGIN;
SET LOCAL search_path=public,extensions;
SET LOCAL lock_timeout='1s';

ALTER TABLE public.explore_local_quality_preparation ADD COLUMN analyzed_at timestamptz;

CREATE FUNCTION public.get_explore_local_quality_preparation() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'ready',s.enabled,'done',s.scan_complete AND NOT q.pending,'busy',false,
  'scanned',0,'processed',0,'stale',0,'pending',q.pending,'scanComplete',s.scan_complete
 ) FROM explore_local_quality_preparation s
 CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM explore_local_quality_dirty) AS pending) q
 WHERE s.singleton
$$;

CREATE FUNCTION public.prepare_explore_local_quality_batch(p_limit integer DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET lock_timeout='100ms' AS $$
DECLARE
 s explore_local_quality_preparation%ROWTYPE;
 ids uuid[]:='{}';generations uuid[]:='{}';target uuid;
 scanned integer:=0;processed integer:=0;stale integer:=0;cursor_id uuid;complete boolean;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN
  RAISE EXCEPTION 'Preparation limit must be between 1 and 100' USING ERRCODE='22023';
 END IF;
 -- Only operators lock this singleton. Canonical triggers read readiness and
 -- append dirty generations without waiting for a preparation batch.
 SELECT * INTO STRICT s FROM explore_local_quality_preparation WHERE singleton FOR UPDATE NOWAIT;
 IF s.enabled THEN RETURN get_explore_local_quality_preparation();END IF;
 IF s.activated_at IS NOT NULL THEN
  RAISE EXCEPTION 'Rebuilding an activated snapshot requires a separately reviewed version' USING ERRCODE='55000';
 END IF;
 cursor_id:=s.scan_after;complete:=s.scan_complete;
 IF NOT complete THEN
  IF s.scan_after IS NULL THEN
   SELECT coalesce(array_agg(d.salon_id ORDER BY d.salon_id),'{}') INTO ids
   FROM (SELECT salon_id FROM explore_salon_documents ORDER BY salon_id LIMIT p_limit) d;
  ELSE
   SELECT coalesce(array_agg(d.salon_id ORDER BY d.salon_id),'{}') INTO ids
   FROM (SELECT salon_id FROM explore_salon_documents WHERE salon_id>s.scan_after ORDER BY salon_id LIMIT p_limit) d;
  END IF;
  scanned:=cardinality(ids);
  IF scanned>0 THEN cursor_id:=ids[scanned];END IF;
  complete:=scanned<p_limit;
 END IF;
 -- Fill remaining capacity with queued changes, including new/deleted records
 -- behind the initial UUID cursor. Never lock a dirty row before aggregation.
 SELECT ids||coalesce(array_agg(q.salon_id ORDER BY q.salon_id),'{}') INTO ids
 FROM (SELECT salon_id FROM explore_local_quality_dirty WHERE NOT(salon_id=ANY(ids)) ORDER BY salon_id LIMIT p_limit-scanned) q;
 SELECT coalesce(array_agg(q.generation ORDER BY selected.ordinality),'{}') INTO generations
 FROM unnest(ids) WITH ORDINALITY selected(salon_id,ordinality)
 LEFT JOIN explore_local_quality_dirty q USING(salon_id);
 -- All expensive reads and all posting/index writes happen while readiness is
 -- OFF and without the canonical revision lock. A source edit changes that
 -- salon's generation; unrelated traffic cannot starve preparation.
 FOREACH target IN ARRAY ids LOOP
  PERFORM refresh_explore_local_quality(ARRAY[target]);processed:=processed+1;
 END LOOP;
 -- One final bounded CAS after ALL heavy work. Early deletes would retain dirty
 -- row locks while later salons aggregate, blocking writers holding the clock.
 DELETE FROM explore_local_quality_dirty q USING unnest(ids,generations) expected(salon_id,generation)
 WHERE q.salon_id=expected.salon_id AND expected.generation IS NOT NULL AND q.generation=expected.generation;
 SELECT count(*)::int INTO stale FROM unnest(ids,generations) expected(salon_id,generation)
 JOIN explore_local_quality_dirty q USING(salon_id);
 UPDATE explore_local_quality_preparation SET scan_after=cursor_id,scan_complete=complete,updated_at=clock_timestamp() WHERE singleton;
 RETURN get_explore_local_quality_preparation()||jsonb_build_object('scanned',scanned,'processed',processed,'stale',stale);
EXCEPTION WHEN lock_not_available THEN
 -- The subtransaction rolls back projection/cursor/CAS changes before this
 -- response. The foreground operator backs off and safely resumes.
 RETURN get_explore_local_quality_preparation()||jsonb_build_object('busy',true);
END $$;

CREATE FUNCTION public.activate_explore_local_quality() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions SET lock_timeout='100ms' AS $$
DECLARE s explore_local_quality_preparation%ROWTYPE;
BEGIN
 SELECT * INTO STRICT s FROM explore_local_quality_preparation WHERE singleton FOR UPDATE NOWAIT;
 IF s.enabled THEN RETURN get_explore_local_quality_preparation();END IF;
 IF NOT s.scan_complete OR EXISTS(SELECT 1 FROM explore_local_quality_dirty) THEN
  RETURN get_explore_local_quality_preparation()||jsonb_build_object('reason','preparation_incomplete');
 END IF;
 -- Every access path must be present and valid. This checks catalog metadata,
 -- never scans the prepared directory or canonical posts inside the clock lock.
 IF EXISTS(
  SELECT 1 FROM unnest(ARRAY[
   'explore_local_quality_documents_pkey','explore_local_quality_postings_pkey','explore_local_quality_current',
   'explore_local_quality_name','explore_local_quality_name_trgm','explore_local_quality_name_signatures','explore_local_quality_name_compact','explore_local_quality_point','explore_local_quality_retired',
   'explore_local_name_quality_global','explore_local_name_quality_state','explore_local_name_quality_city','explore_local_name_quality_city_any_state','explore_local_name_quality_zip',
   'explore_local_lane_global','explore_local_lane_state','explore_local_lane_city','explore_local_lane_city_any_state','explore_local_lane_zip',
   'explore_local_profile_terms','explore_local_service_terms','explore_local_post_terms',
   'explore_local_newest_global','explore_local_newest_state','explore_local_newest_city','explore_local_newest_city_any_state','explore_local_newest_zip',
   'explore_local_browse_newest_global','explore_local_browse_newest_state','explore_local_browse_newest_city','explore_local_browse_newest_city_any_state','explore_local_browse_newest_zip',
   'explore_local_lane_cell','explore_local_doc_cell','explore_local_doc_cell_newest','explore_local_browse_cell_newest',
   'explore_local_unknown_quality_global','explore_local_unknown_quality_state','explore_local_unknown_quality_city','explore_local_unknown_quality_city_any_state','explore_local_unknown_quality_zip'
  ]) needed(name)
  LEFT JOIN pg_class i ON i.relnamespace='public'::regnamespace AND i.relname=needed.name
  LEFT JOIN pg_index p ON p.indexrelid=i.oid
  WHERE NOT coalesce(p.indisvalid AND p.indisready,false)
 ) THEN RETURN get_explore_local_quality_preparation()||jsonb_build_object('reason','indexes_not_ready');END IF;
 -- Empty-table statistics from schema installation do not describe a prepared
 -- directory. Collect real planner statistics once, outside the canonical clock
 -- and dirty-row locks, before any v1 search can become visible. Small queued
 -- edits after this sample do not force repeated full analyses on every retry.
 IF s.analyzed_at IS NULL THEN
  ANALYZE public.explore_local_quality_documents;
  ANALYZE public.explore_local_quality_postings;
  UPDATE explore_local_quality_preparation SET analyzed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton;
 END IF;
 -- Brief publication boundary: wait for preceding canonical source writes,
 -- then recheck the queue. Incrementing the clock also makes a pre-activation
 -- repeatable-read writer serialize instead of enqueueing from stale readiness.
 -- The inner subtransaction preserves the completed statistics sample/marker
 -- when NOWAIT finds a live writer and the operator needs to retry.
 BEGIN
  PERFORM 1 FROM explore_unified_search_clock WHERE id FOR UPDATE NOWAIT;
  IF EXISTS(SELECT 1 FROM explore_local_quality_dirty) THEN
   RETURN get_explore_local_quality_preparation()||jsonb_build_object('reason','preparation_incomplete');
  END IF;
  UPDATE explore_unified_search_clock SET revision=revision+1 WHERE id;
  UPDATE explore_local_quality_preparation SET enabled=true,activated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE singleton;
 EXCEPTION WHEN lock_not_available THEN
  RETURN get_explore_local_quality_preparation()||jsonb_build_object('busy',true);
 END;
 RETURN get_explore_local_quality_preparation();
EXCEPTION WHEN lock_not_available THEN
 RETURN get_explore_local_quality_preparation()||jsonb_build_object('busy',true);
END $$;

REVOKE ALL ON FUNCTION public.get_explore_local_quality_preparation(),public.prepare_explore_local_quality_batch(integer),public.activate_explore_local_quality() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_explore_local_quality_preparation(),public.prepare_explore_local_quality_batch(integer),public.activate_explore_local_quality() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
