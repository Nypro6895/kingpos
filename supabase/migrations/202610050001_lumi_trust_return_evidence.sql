begin;

-- Only aggregate evidence is public. Customer identities never leave this RPC.
create or replace function public.lumi_trust_evidence_policy()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object('version', 'lumi-trust-v2', 'feedbackDays', 180,
    'returnDays', 90, 'cohortDays', 180);
$$;
revoke all on function public.lumi_trust_evidence_policy() from public, anon, authenticated;

create index if not exists pos_tickets_lumi_evidence_idx
  on public.pos_tickets(salon_id, customer_id, closed_at)
  where status = 'closed' and closed_at is not null;

create or replace function public.get_public_lumi_trust_signals(target_salon_ids uuid[])
returns table (
  salon_id uuid, rule_version text, feedback_days integer, return_days integer,
  cohort_days integer, as_of timestamptz, verified_visit_count bigint,
  unique_visitor_count bigint, feedback_customer_count bigint,
  good_feedback_count bigint, issue_feedback_count bigint,
  eligible_return_customer_count bigint, returning_customer_count bigint
)
language sql stable security definer set search_path = public as $$
  with policy as (
    select public.lumi_trust_evidence_policy() as value, now() as at
  ), visible_salons as (
    select l.id, l.account_id, coalesce(tz.name, 'UTC') as zone
    from public.locations l
    left join public.salon_settings settings on settings.salon_id = l.id
    left join pg_timezone_names tz on tz.name = settings.operating_timezone_iana
    where l.id = any(target_salon_ids)
      and public.salon_profile_public_salon_exists(l.id)
  ), valid_tickets as (
    select t.id, t.salon_id, t.customer_id, c.customer_user_id as person_id, t.closed_at,
      (t.closed_at at time zone s.zone)::date as visit_day
    from visible_salons s
    join public.pos_tickets t on t.salon_id = s.id
    join public.customers c on c.id = t.customer_id and c.location_id = t.salon_id
    cross join policy p
    where t.status = 'closed' and t.closed_at is not null and t.closed_at <= p.at
      and c.customer_user_id is not null
      -- Free corrections/empty tickets are not positive return evidence.
      and exists (select 1 from public.pos_ticket_items i
        where i.pos_ticket_id = t.id and i.salon_id = t.salon_id and i.line_total > 0)
      and not exists (select 1 from public.salon_memberships m
        where m.salon_id = s.id and m.user_id = c.customer_user_id)
      and not exists (select 1 from public.account_memberships m
        where m.account_id = s.account_id and m.user_id = c.customer_user_id)
      and not exists (select 1 from public.staff st where st.salon_id = s.id
        and (st.account_user_id = c.customer_user_id or st.user_id = c.customer_user_id))
  ), visits as (
    -- Splitting a visit into multiple tickets cannot increase visit/return counts.
    select salon_id, person_id, visit_day, min(closed_at) as occurred_at
    from valid_tickets group by salon_id, person_id, visit_day
  ), visit_totals as (
    select v.salon_id, count(*) as total,
      count(distinct v.person_id) filter (where v.occurred_at >=
        p.at - make_interval(days => (p.value->>'feedbackDays')::int)) as visitors
    from visits v cross join policy p group by v.salon_id
  ), latest_feedback as (
    -- One latest eligible feedback per independent customer in the scoring window.
    -- issue_status is intentionally ignored: resolving an issue does not erase it.
    select distinct on (t.salon_id, t.person_id)
      t.salon_id, t.person_id, e.feedback_state
    from valid_tickets t
    join public.customer_visit_experiences e on e.ticket_id = t.id
      and e.salon_id = t.salon_id and e.author_user_id = t.person_id
      and e.customer_id = t.customer_id
    cross join policy p
    where t.closed_at >= p.at - make_interval(days => (p.value->>'feedbackDays')::int)
      and e.created_at <= p.at and e.feedback_state in ('good', 'issue')
    order by t.salon_id, t.person_id, t.closed_at desc, e.created_at desc, e.id desc
  ), feedback_totals as (
    select salon_id, count(*) as total,
      count(*) filter (where feedback_state = 'good') as good,
      count(*) filter (where feedback_state = 'issue') as issues
    from latest_feedback group by salon_id
  ), anchors as (
    -- Fully matured cohort only: yesterday's customers are not failed returns.
    select v.salon_id, v.person_id, min(v.occurred_at) as anchor_at
    from visits v cross join policy p
    where v.occurred_at >= p.at - make_interval(days =>
      (p.value->>'cohortDays')::int + (p.value->>'returnDays')::int)
      and v.occurred_at <= p.at - make_interval(days => (p.value->>'returnDays')::int)
    group by v.salon_id, v.person_id
  ), return_totals as (
    select a.salon_id, count(*) as eligible,
      count(*) filter (where exists (select 1 from visits next_visit
        where next_visit.salon_id = a.salon_id and next_visit.person_id = a.person_id
          and next_visit.occurred_at > a.anchor_at
          and next_visit.visit_day > (a.anchor_at at time zone s.zone)::date
          and next_visit.occurred_at <= a.anchor_at +
            make_interval(days => (p.value->>'returnDays')::int))) as returning
    from anchors a join visible_salons s on s.id = a.salon_id cross join policy p
    group by a.salon_id
  )
  select s.id, p.value->>'version', (p.value->>'feedbackDays')::int,
    (p.value->>'returnDays')::int, (p.value->>'cohortDays')::int, p.at,
    coalesce(v.total, 0), coalesce(v.visitors, 0), coalesce(f.total, 0),
    coalesce(f.good, 0), coalesce(f.issues, 0), coalesce(r.eligible, 0), coalesce(r.returning, 0)
  from visible_salons s cross join policy p
  left join visit_totals v on v.salon_id = s.id
  left join feedback_totals f on f.salon_id = s.id
  left join return_totals r on r.salon_id = s.id;
$$;

revoke all on function public.get_public_lumi_trust_signals(uuid[]) from public;
grant execute on function public.get_public_lumi_trust_signals(uuid[]) to anon, authenticated, service_role;
comment on function public.get_public_lumi_trust_signals(uuid[]) is
  'LUMI v2: independent customer feedback and matured return cohorts; no rating or volume quality bonus. See docs/lumi-trust-rules.md.';
notify pgrst, 'reload schema';
commit;
