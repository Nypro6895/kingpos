-- Keyword relevance is applied before salon dedupe/rotation/limit. Geo and accounting policies are unchanged.
CREATE OR REPLACE FUNCTION public.owner_campaign_matches_search(c public.owner_campaigns,p_terms text,p_kind text,p_category text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT coalesce(
  CASE WHEN coalesce(trim(p_terms),'')='' AND coalesce(trim(p_category),'')='' THEN true
  ELSE EXISTS (
   SELECT 1 FROM public.explore_salon_documents d WHERE d.salon_id=c.salon_id
   AND (coalesce(trim(p_category),'')='' OR to_tsvector('english',coalesce(d.service_category_search_text,'')) @@ plainto_tsquery('english',p_category))
   AND (coalesce(trim(p_terms),'')='' OR CASE p_kind
    WHEN 'name' THEN to_tsvector('simple',coalesce(d.salon_name_search,'')) @@ plainto_tsquery('simple',p_terms)
    WHEN 'service' THEN to_tsvector('english',coalesce(d.service_search_text,'')) @@ plainto_tsquery('english',p_terms)
    WHEN 'style' THEN CASE WHEN c.source_type='custom' THEN
      to_tsvector('english',concat_ws(' ',public.owner_campaign_post(c.source_type,c.source_id,c.salon_id)->>'title',public.owner_campaign_post(c.source_type,c.source_id,c.salon_id)->>'caption')) @@ plainto_tsquery('english',p_terms)
     ELSE EXISTS (SELECT 1 FROM public.explore_unified_content_source p WHERE p.salon_id=c.salon_id AND p.source_type=c.source_type AND p.content_id=c.source_id AND NOT p.is_reference AND p.search_terms @@ plainto_tsquery('english',p_terms)) END
    ELSE false END)
  ) END,false)
$$;
CREATE OR REPLACE FUNCTION public.owner_campaign_search_candidates(p_area jsonb, p_visitor text, p_viewer uuid, p_terms text, p_kind text, p_category text)
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
 where public.owner_campaign_matches_search(c,p_terms,p_kind,p_category)
 and c.status='running' and c.starts_at<=now() and c.ends_at>now() and c.payment_reference is not null and c.approved_at is not null
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
 and (select count(*) from public.owner_campaign_events e where e.visitor_hash=p_visitor and e.day=(now() at time zone 'America/Chicago')::date and e.kind='view') < coalesce((c.settings_snapshot->>'maxAdsPerDay')::integer,6)
 and (select count(*) from public.owner_campaign_events e where e.campaign_id=c.id and e.visitor_hash=p_visitor and e.day=(now() at time zone 'America/Chicago')::date and e.kind='view') < (c.settings_snapshot->>'dailyFrequency')::integer
 ) select (select c from public.owner_campaigns c where c.id=e.id) from eligible e where salon_rank=1
 order by e.last_seen asc nulls first,e.starts_at,e.created_at,e.id limit 6;
$function$;

REVOKE ALL ON FUNCTION public.owner_campaign_matches_search(public.owner_campaigns,text,text,text),public.owner_campaign_search_candidates(jsonb,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_campaign_matches_search(public.owner_campaigns,text,text,text),public.owner_campaign_search_candidates(jsonb,text,uuid,text,text,text) TO service_role;
