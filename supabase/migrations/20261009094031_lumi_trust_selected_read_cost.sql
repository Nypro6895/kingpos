-- Keep LUMI v2 evidence unchanged; avoid enumerating timezone rules on each read.
BEGIN;
CREATE TABLE public.lumi_trust_time_zone_names(name text PRIMARY KEY);
ALTER TABLE public.lumi_trust_time_zone_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lumi_trust_time_zone_names FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lumi_trust_time_zone_names TO service_role;
CREATE FUNCTION public.refresh_lumi_trust_time_zone_names() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 TRUNCATE public.lumi_trust_time_zone_names;
 INSERT INTO public.lumi_trust_time_zone_names SELECT name FROM pg_timezone_names;
END $$;
REVOKE ALL ON FUNCTION public.refresh_lumi_trust_time_zone_names() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_lumi_trust_time_zone_names() TO service_role;
COMMENT ON TABLE public.lumi_trust_time_zone_names IS
 'Exact PostgreSQL timezone-name catalog, not customer evidence. Refresh through the private RPC after a database tzdata update.';
SELECT public.refresh_lumi_trust_time_zone_names();

CREATE INDEX IF NOT EXISTS pos_tickets_lumi_selected_closed_idx
 ON public.pos_tickets(salon_id,closed_at,customer_id) INCLUDE(id)
 WHERE status='closed' AND closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_ticket_items_lumi_positive_idx
 ON public.pos_ticket_items(pos_ticket_id,salon_id) WHERE line_total>0;
CREATE INDEX IF NOT EXISTS staff_lumi_account_user_idx
 ON public.staff(salon_id,account_user_id) WHERE account_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS staff_lumi_user_idx
 ON public.staff(salon_id,user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS booking_lines_public_identity_service_idx
 ON public.booking_lines(service_id,salon_id,booking_id)
 WHERE line_type='service' AND line_status<>'cancelled';
CREATE INDEX IF NOT EXISTS services_public_online_name_idx
 ON public.services(salon_id,name,id) WHERE is_active AND online_booking_enabled;

CREATE OR REPLACE FUNCTION public.get_public_lumi_trust_signals(target_salon_ids uuid[])
RETURNS TABLE(salon_id uuid,rule_version text,feedback_days integer,return_days integer,cohort_days integer,as_of timestamptz,
 verified_visit_count bigint,unique_visitor_count bigint,feedback_customer_count bigint,good_feedback_count bigint,
 issue_feedback_count bigint,eligible_return_customer_count bigint,returning_customer_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public SET jit=off AS $$
 WITH policy AS MATERIALIZED (
  SELECT public.lumi_trust_evidence_policy() AS value,now() AS at
 ), visible_salons AS MATERIALIZED (
  SELECT l.id,l.account_id,coalesce(tz.name,'UTC') AS zone
  FROM public.locations l
  LEFT JOIN public.salon_settings settings ON settings.salon_id=l.id
  LEFT JOIN public.lumi_trust_time_zone_names tz ON tz.name=settings.operating_timezone_iana
  WHERE l.id=ANY(target_salon_ids) AND public.salon_profile_public_salon_exists(l.id)
 ), valid_tickets AS MATERIALIZED (
  SELECT t.id,t.salon_id,t.customer_id,c.customer_user_id AS person_id,t.closed_at,
   (t.closed_at AT TIME ZONE s.zone)::date AS visit_day
  FROM visible_salons s JOIN public.pos_tickets t ON t.salon_id=s.id
  JOIN public.customers c ON c.id=t.customer_id AND c.location_id=t.salon_id CROSS JOIN policy p
  WHERE t.status='closed' AND t.closed_at IS NOT NULL AND t.closed_at<=p.at AND c.customer_user_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.pos_ticket_items i WHERE i.pos_ticket_id=t.id AND i.salon_id=t.salon_id AND i.line_total>0)
   AND NOT EXISTS(SELECT 1 FROM public.salon_memberships m WHERE m.salon_id=s.id AND m.user_id=c.customer_user_id)
   AND NOT EXISTS(SELECT 1 FROM public.account_memberships m WHERE m.account_id=s.account_id AND m.user_id=c.customer_user_id)
   AND NOT EXISTS(SELECT 1 FROM public.staff st WHERE st.salon_id=s.id AND st.account_user_id=c.customer_user_id)
   AND NOT EXISTS(SELECT 1 FROM public.staff st WHERE st.salon_id=s.id AND st.user_id=c.customer_user_id)
 ), visits AS MATERIALIZED (
  -- Lifetime visits remain lifetime; no cap or scoring-window truncation.
  SELECT salon_id,person_id,visit_day,min(closed_at) AS occurred_at
  FROM valid_tickets GROUP BY salon_id,person_id,visit_day
 ), visit_totals AS (
  SELECT v.salon_id,count(*) AS total,count(DISTINCT v.person_id) FILTER(WHERE
   v.occurred_at>=p.at-make_interval(days=>(p.value->>'feedbackDays')::int)) AS visitors
  FROM visits v CROSS JOIN policy p GROUP BY v.salon_id
 ), latest_feedback AS (
  SELECT DISTINCT ON(t.salon_id,t.person_id) t.salon_id,t.person_id,e.feedback_state
  FROM valid_tickets t JOIN public.customer_visit_experiences e ON e.ticket_id=t.id AND e.salon_id=t.salon_id
   AND e.author_user_id=t.person_id AND e.customer_id=t.customer_id CROSS JOIN policy p
  WHERE t.closed_at>=p.at-make_interval(days=>(p.value->>'feedbackDays')::int)
   AND e.created_at<=p.at AND e.feedback_state IN ('good','issue')
  ORDER BY t.salon_id,t.person_id,t.closed_at DESC,e.created_at DESC,e.id DESC
 ), feedback_totals AS (
  SELECT salon_id,count(*) AS total,count(*) FILTER(WHERE feedback_state='good') AS good,
   count(*) FILTER(WHERE feedback_state='issue') AS issues FROM latest_feedback GROUP BY salon_id
 ), cohort_visits AS MATERIALIZED (
  -- Only the 270-day cohort is joined for returns. Lifetime counts above remain unchanged.
  SELECT v.*
  FROM visits v CROSS JOIN policy p WHERE v.occurred_at>=p.at-make_interval(days=>
   (p.value->>'cohortDays')::int+(p.value->>'returnDays')::int)
 ), anchors AS (
  SELECT v.salon_id,v.person_id,min(v.occurred_at) AS anchor_at
  FROM cohort_visits v CROSS JOIN policy p
  WHERE v.occurred_at<=p.at-make_interval(days=>(p.value->>'returnDays')::int)
  GROUP BY v.salon_id,v.person_id
 ), return_totals AS (
  -- One anchor per person makes this an equality join over recent visits, rather than
  -- a correlated scan of the entire materialized lifetime visits relation per anchor.
  -- Retain the exact local-day predicate even across unusual timezone transitions.
  SELECT a.salon_id,count(DISTINCT a.person_id) AS eligible,
   count(DISTINCT a.person_id) FILTER(WHERE next_visit.person_id IS NOT NULL) AS returning
  FROM anchors a JOIN visible_salons s ON s.id=a.salon_id CROSS JOIN policy p
  LEFT JOIN cohort_visits next_visit ON next_visit.salon_id=a.salon_id AND next_visit.person_id=a.person_id
   AND next_visit.occurred_at>a.anchor_at AND next_visit.visit_day>(a.anchor_at AT TIME ZONE s.zone)::date
   AND next_visit.occurred_at<=a.anchor_at+make_interval(days=>(p.value->>'returnDays')::int)
  GROUP BY a.salon_id
 )
 SELECT s.id,p.value->>'version',(p.value->>'feedbackDays')::int,(p.value->>'returnDays')::int,
  (p.value->>'cohortDays')::int,p.at,coalesce(v.total,0),coalesce(v.visitors,0),coalesce(f.total,0),
  coalesce(f.good,0),coalesce(f.issues,0),coalesce(r.eligible,0),coalesce(r.returning,0)
 FROM visible_salons s CROSS JOIN policy p LEFT JOIN visit_totals v ON v.salon_id=s.id
 LEFT JOIN feedback_totals f ON f.salon_id=s.id LEFT JOIN return_totals r ON r.salon_id=s.id;
$$;
REVOKE ALL ON FUNCTION public.get_public_lumi_trust_signals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_lumi_trust_signals(uuid[]) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.get_public_lumi_trust_signals(uuid[]) IS
 'LUMI v2 evidence unchanged: indexed exact timezone catalog, selected-salon ticket indexes and recent-cohort equality join for returns. Lifetime evidence still reads selected history.';
NOTIFY pgrst,'reload schema';
COMMIT;
