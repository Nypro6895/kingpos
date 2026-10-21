-- Preserve credit policy and wallet/campaign lock order. Only future limit
-- ledger references gain attribution; historical rows cannot be backfilled safely.
BEGIN;
DO $migration$
DECLARE
 definition text;
 old_reference constant text := $old$'limit:'||gen_random_uuid()$old$;
 new_reference constant text := $new$'limit:'||p_campaign||':'||gen_random_uuid()$new$;
BEGIN
 definition := pg_get_functiondef('public.campaign_set_credit_limit(uuid,uuid,uuid,integer,boolean)'::regprocedure);
 IF strpos(definition,old_reference)=0 AND
  (length(definition)-length(replace(definition,new_reference,'')))/length(new_reference)=1 THEN
  RETURN; -- Retry of the exact migration is harmless.
 END IF;
 IF (length(definition)-length(replace(definition,old_reference,'')))/length(old_reference)<>1
  OR strpos(definition,new_reference)>0 THEN
  RAISE EXCEPTION 'Campaign accounting: unsupported limit ledger reference';
 END IF;
 EXECUTE replace(definition,old_reference,new_reference);
END
$migration$;

CREATE INDEX IF NOT EXISTS campaign_credit_release_salon_time
 ON public.campaign_credit_ledger(salon_id,created_at) WHERE kind='release';

-- STABLE functions use the calling statement's snapshot. This inspection never
-- closes a period, renews a campaign, issues a ticket or changes wallet/ledger data.
CREATE OR REPLACE FUNCTION public.campaign_owner_accounting(p_id uuid,p_salon uuid,p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.lifecycle_user_is_salon_owner(p_salon,p_owner,false),false) THEN
  RAISE EXCEPTION 'Campaign preview is unavailable.';
 END IF;
 SELECT jsonb_build_object(
  'campaign',to_jsonb(c),
  'returns',jsonb_build_object(
   'total',CASE WHEN s.reason IS NULL THEN l.closure+l.limit_return ELSE NULL END,
   'known',l.closure+l.limit_return,'closure',l.closure,'limit',l.limit_return,
   'complete',s.reason IS NULL,'reason',s.reason),
  'checkedAt',statement_timestamp()) INTO result
 FROM (
  SELECT id,salon_id,source_type,source_id,title,status,area,location,country,state,city,
   starts_at,ends_at,views,spent_cents,total_price_cents,reserved_credits,released_credits,created_at,
   -- The additive pause migration follows this one; expose only its named keys.
   to_jsonb(source)->'owner_paused_at' AS owner_paused_at,
   to_jsonb(source)->'pause_episode_id' AS pause_episode_id,
   to_jsonb(source)->'pause_origin' AS pause_origin
  FROM public.owner_campaigns source WHERE id=p_id AND salon_id=p_salon
 ) c
 CROSS JOIN LATERAL (
  SELECT
   coalesce(sum(credits) FILTER(WHERE closure AND credits>0),0) AS closure,
   coalesce(sum(credits) FILTER(WHERE limit_return AND credits>0),0) AS limit_return,
   coalesce(bool_or((closure OR limit_return) AND (credits IS NULL OR credits<=0)),false) AS invalid,
   coalesce(bool_or(legacy AND credits>0 AND created_at>=c.created_at),false) AS legacy
  FROM (
   SELECT credits,created_at,
    reference LIKE 'release:'||c.id::text||':%' AS closure,
    reference LIKE 'limit:'||c.id::text||':%' AS limit_return,
    reference ~* '^limit:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AS legacy
   FROM public.campaign_credit_ledger WHERE salon_id=c.salon_id AND kind='release'
  ) entries
 ) l
 CROSS JOIN LATERAL (
  SELECT CASE
   WHEN l.invalid OR c.released_credits IS NULL OR c.released_credits<0
    OR l.closure<>c.released_credits THEN 'ledger_mismatch'
   WHEN l.legacy THEN 'legacy_unattributed_refunds'
   ELSE NULL END AS reason
 ) s;
 IF result IS NULL THEN RAISE EXCEPTION 'Campaign preview is unavailable.'; END IF;
 RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.campaign_owner_accounting(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_owner_accounting(uuid,uuid,uuid) TO service_role;
COMMIT;
