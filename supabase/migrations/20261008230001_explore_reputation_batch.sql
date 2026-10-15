-- Preserve the canonical public profile reputation while avoiding one HTTP call per card.
BEGIN;
CREATE FUNCTION public.get_public_explore_reputation_summaries(target_salon_ids uuid[])
RETURNS TABLE(salon_id uuid,reputation jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT ids.id,to_jsonb(r)
 FROM (SELECT DISTINCT id FROM unnest(target_salon_ids) AS ids(id) WHERE id IS NOT NULL ORDER BY id LIMIT 100) ids
 CROSS JOIN LATERAL public.get_public_salon_profile_reputation_summary(ids.id) r;
$$;
REVOKE ALL ON FUNCTION public.get_public_explore_reputation_summaries(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_explore_reputation_summaries(uuid[]) TO anon,authenticated,service_role;
COMMIT;
