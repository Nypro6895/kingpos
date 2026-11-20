BEGIN;

-- Initial policy, changed with a migration after measuring user outcomes:
-- 90-day window, at least 3 distinct days in one city/state, >=70% of
-- observed region-days. An area is an activity hint, never a residence claim.
CREATE INDEX IF NOT EXISTS explore_activity_completed_booking_idx
ON public.bookings(customer_user_id, start_at DESC, id)
WHERE customer_user_id IS NOT NULL AND status = 'completed';
CREATE INDEX IF NOT EXISTS explore_activity_staff_workday_idx
ON public.staff_workdays(staff_id, check_in_at DESC, id)
WHERE check_in_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS explore_activity_legacy_staff_user_idx
ON public.staff(user_id)
WHERE account_user_id IS NULL AND is_active AND user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_explore_activity_region()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
SET jit = 'off'
AS $$
DECLARE
  actor_id uuid := public.current_public_user_id();
  policy_window CONSTANT interval := interval '90 days';
  policy_min_days CONSTANT integer := 3;
  policy_dominance CONSTANT numeric := 0.70;
  policy_source_cap CONSTANT integer := 512;
  result jsonb;
BEGIN
  IF actor_id IS NULL THEN
    RETURN jsonb_build_object('label','','source','none','confidence',0,
      'evidenceDays',0,'lastObservedAt',NULL);
  END IF;

  WITH booking_evidence AS MATERIALIZED (
    SELECT b.salon_id, b.start_at AS occurred_at, b.id AS booking_id, b.pos_ticket_id
    FROM public.bookings b
    WHERE b.customer_user_id = actor_id AND b.status = 'completed'
      AND b.customer_account_link_method IN
        ('authenticated_booking','guest_manage_claim','contact_verification_claim')
      AND b.start_at BETWEEN now() - policy_window AND now()
    ORDER BY b.start_at DESC, b.id LIMIT policy_source_cap + 1
  ), work_evidence AS MATERIALIZED (
    SELECT w.salon_id, w.check_in_at AS occurred_at
    FROM public.staff s JOIN public.staff_workdays w ON w.staff_id = s.id
    WHERE (s.account_user_id = actor_id OR (s.account_user_id IS NULL
        AND s.user_id = (SELECT u.auth_user_id FROM public.users u WHERE u.id = actor_id)))
      AND s.is_active
      AND w.salon_id = s.salon_id AND w.check_in_at IS NOT NULL
      AND w.check_in_at BETWEEN now() - policy_window AND now()
    ORDER BY w.check_in_at DESC, w.id LIMIT policy_source_cap + 1
  ), pos_evidence AS MATERIALIZED (
    SELECT t.salon_id, coalesce(t.closed_at,t.opened_at) AS occurred_at,
      t.id AS ticket_id, t.source_booking_id
    FROM public.customers c JOIN public.pos_tickets t ON t.customer_id = c.id
    WHERE c.customer_user_id = actor_id AND c.location_id = t.salon_id
      AND c.customer_account_claimed_at IS NOT NULL AND t.status = 'closed'
      AND coalesce(t.closed_at,t.opened_at) BETWEEN now() - policy_window AND now()
      AND EXISTS (
        SELECT 1 FROM public.customer_account_claims proof
        WHERE proof.customer_id = c.id AND proof.customer_user_id = actor_id
          AND proof.salon_id = c.location_id
          AND proof.claim_status IN ('linked','idempotent')
          AND proof.proof_type IN ('customer_claim_token','verified_phone_ownership')
      )
    ORDER BY coalesce(t.closed_at,t.opened_at) DESC, t.id LIMIT policy_source_cap + 1
  ), bounded AS (
    SELECT (SELECT count(*) FROM booking_evidence) <= policy_source_cap
      AND (SELECT count(*) FROM work_evidence) <= policy_source_cap
      AND (SELECT count(*) FROM pos_evidence) <= policy_source_cap AS valid
  ), evidence AS (
    SELECT salon_id, occurred_at FROM booking_evidence
    UNION ALL SELECT salon_id, occurred_at FROM work_evidence
    UNION ALL
    SELECT p.salon_id,p.occurred_at FROM pos_evidence p
    WHERE NOT EXISTS (
      SELECT 1 FROM booking_evidence b
      WHERE b.booking_id = p.source_booking_id OR b.pos_ticket_id = p.ticket_id
    )
  ), located AS (
    SELECT public.normalize_search_text(l.city) AS city_key,
      upper(btrim(l.state)) AS state_key,
      regexp_replace(btrim(l.city),'\s+',' ','g') AS city_label,e.occurred_at
    FROM evidence e JOIN public.locations l ON l.id = e.salon_id
    WHERE l.status = 'active' AND upper(coalesce(l.country,'US')) = 'US'
      AND nullif(btrim(l.city),'') IS NOT NULL AND btrim(l.state) ~ '^[A-Za-z]{2}$'
  ), region_days AS (
    -- UTC day dedup prevents duplicate booking/POS/work evidence inflating confidence.
    SELECT city_key,state_key,(occurred_at AT TIME ZONE 'UTC')::date AS observed_day,
      max(occurred_at) AS last_observed_at
    FROM located GROUP BY city_key,state_key,(occurred_at AT TIME ZONE 'UTC')::date
  ), ranked AS (
    SELECT city_key,state_key,count(*) AS days,max(last_observed_at) AS last_observed_at
    FROM region_days GROUP BY city_key,state_key
  ), candidates AS (
    SELECT r.*,r.days::numeric / nullif(sum(r.days) OVER (),0) AS confidence,
      dense_rank() OVER (ORDER BY r.days DESC) AS position
    FROM ranked r
  ), winner AS (
    SELECT c.* FROM candidates c CROSS JOIN bounded b
    WHERE b.valid AND c.position = 1 AND c.days >= policy_min_days
      AND c.confidence >= policy_dominance
      AND (SELECT count(*) FROM candidates WHERE position = 1) = 1
  )
  SELECT jsonb_build_object(
    'label',(SELECT city_label FROM located l WHERE l.city_key = w.city_key
      AND l.state_key = w.state_key ORDER BY occurred_at DESC,city_label LIMIT 1)
      || ', ' || w.state_key,
    'source','activity','confidence',round(w.confidence,4),
    'evidenceDays',w.days,'lastObservedAt',w.last_observed_at
  ) INTO result FROM winner w;

  RETURN coalesce(result,jsonb_build_object('label','','source','none','confidence',0,
    'evidenceDays',0,'lastObservedAt',NULL));
END;
$$;
REVOKE ALL ON FUNCTION public.get_explore_activity_region() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_explore_activity_region() TO authenticated;
COMMIT;
