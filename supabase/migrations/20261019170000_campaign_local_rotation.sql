-- Rotate only eligible campaigns using already admitted views. No pricing or admission changes.
CREATE OR REPLACE FUNCTION public.owner_campaign_candidates(p_area jsonb, p_visitor text, p_viewer uuid DEFAULT NULL::uuid)
 RETURNS SETOF owner_campaigns
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 with eligible as (
 select c.*,seen.last_seen,
 row_number() over(partition by c.salon_id order by seen.last_seen asc nulls first,c.starts_at,c.created_at,c.id) salon_rank
 from public.owner_campaigns c
 left join lateral (select max(e.created_at) last_seen from public.owner_campaign_events e where e.campaign_id=c.id and e.visitor_hash=p_visitor and e.kind='view') seen on true
 where c.status='running' and c.starts_at<=now() and c.ends_at>now() and c.payment_reference is not null and c.approved_at is not null
 and c.views<c.credit_view_limit and c.spent_cents<c.total_price_cents
 and public.owner_campaign_post(c.source_type,c.source_id,c.salon_id) is not null
 and coalesce(public.lifecycle_user_is_salon_owner(c.salon_id,c.owner_id,false),false)
 and (p_viewer is null or not public.lifecycle_user_is_salon_owner(c.salon_id,p_viewer,true))
 and lower(trim(c.country))=lower(trim(p_area->>'country'))
 and (c.area='country' and lower(trim(c.location))=lower(trim(p_area->>'country'))
 or c.area='state' and lower(trim(c.location))=lower(trim(p_area->>'state'))
 or c.area='city' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'city'))
 or c.area='zipcode' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'zipcode'))
 or c.area='neighborhood' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.city))=lower(trim(p_area->>'city')) and lower(trim(c.location))=lower(trim(p_area->>'neighborhood')))
 and (select count(*) from public.owner_campaign_events e where e.campaign_id=c.id and e.day=(now() at time zone 'America/Chicago')::date and e.kind='view') < least(c.daily_views,greatest(1,ceil(extract(epoch from now()-greatest(c.starts_at,date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago'))/86400*c.daily_views)::integer))
 and (select count(*) from public.owner_campaign_events e where e.campaign_id=c.id and e.visitor_hash=p_visitor and e.day=(now() at time zone 'America/Chicago')::date and e.kind='view') < (c.settings_snapshot->>'dailyFrequency')::integer
 ) select (select c from public.owner_campaigns c where c.id=e.id) from eligible e where salon_rank=1
 order by e.last_seen asc nulls first,e.starts_at,e.created_at,e.id limit 6;
$function$
