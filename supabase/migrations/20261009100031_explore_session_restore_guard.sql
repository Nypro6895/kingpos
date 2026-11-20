-- A missing actor-bound session is different from a valid session whose
-- current items are all hidden/deleted. Restore callers preserve the fresh
-- page when validation rejects an unavailable session.
BEGIN;
CREATE OR REPLACE FUNCTION public.validate_explore_social_feed_items(p_actor_key text,p_cursor jsonb,p_keys text[]) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s explore_social_feed_sessions; result text[];
BEGIN
 IF coalesce(cardinality(p_keys),0)>120 THEN RAISE EXCEPTION 'Too many cached items'; END IF;
 SELECT * INTO s FROM explore_social_feed_sessions WHERE id=(p_cursor->>'session')::uuid AND actor_key=p_actor_key AND expires_at>now();
 IF s.id IS NULL THEN RAISE EXCEPTION 'Feed session expired or unavailable' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(x.key),'{}') INTO result FROM unnest(p_keys) x(key)
 WHERE x.key=ANY(s.delivered_keys) AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.queue) WITH ORDINALITY e WHERE e.value->>'contentKey'=x.key
 AND public.explore_social_live_eligible(x.key,s.filters,s.region,e.value->>'scope',s.as_of));
 RETURN result;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
