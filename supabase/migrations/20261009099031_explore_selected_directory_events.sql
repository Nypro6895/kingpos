-- Keep event admission, actor delivery and daily dedup semantics unchanged.
-- Compare the selected UUID to the projection PK instead of serializing every
-- directory key while validating each bounded event batch.
BEGIN;
CREATE OR REPLACE FUNCTION public.record_explore_social_events(p_actor_key text,p_cursor jsonb,p_events jsonb) RETURNS integer
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
  AND (EXISTS(SELECT 1 FROM explore_social_content_documents d WHERE d.content_key=e->>'contentKey') OR EXISTS(SELECT 1 FROM explore_salon_documents d WHERE d.salon_id=CASE WHEN (e->>'contentKey') ~ '^directory:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN substring(e->>'contentKey' FROM 11)::uuid END))
 ), inserted AS (
  INSERT INTO explore_social_actor_events(actor_key,content_key,event_day,kind)
  SELECT p_actor_key,content_key,(now() AT TIME ZONE 'UTC')::date,kind FROM eligible ON CONFLICT DO NOTHING RETURNING content_key,event_day,kind
 ), counters AS (
  INSERT INTO explore_social_daily_engagement(content_key,event_day,kind,amount)
  SELECT content_key,event_day,kind,1 FROM inserted ON CONFLICT(content_key,event_day,kind) DO UPDATE SET amount=explore_social_daily_engagement.amount+1 RETURNING 1
 ) SELECT count(*) INTO amount FROM counters;
 RETURN amount;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
