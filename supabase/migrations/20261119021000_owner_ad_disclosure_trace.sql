-- Generate disclosure selectors from the CURRENT authoritative selector bodies.
-- Eligibility, salon dedupe, rotation, pacing, geo/search branches and limit are
-- preserved verbatim. Candidate + viewer trace are read by one SQL statement.
DO $migration$
DECLARE
  item record;
  body text;
  anchor constant text := ') select (select c from public.owner_campaigns c where c.id=e.id) from eligible e where salon_rank=1';
  projection text;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('owner_campaign_candidates(jsonb,text,uuid)', 'owner_campaign_disclosure_candidates', 'p_area jsonb,p_visitor text,p_viewer uuid', false),
    ('owner_campaign_search_candidates(jsonb,text,uuid,text,text,text)', 'owner_campaign_search_disclosure_candidates', 'p_area jsonb,p_visitor text,p_viewer uuid,p_terms text,p_kind text,p_category text', true)
  ) AS v(signature,name,args,is_search) LOOP
    SELECT p.prosrc INTO body FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
      WHERE p.oid=to_regprocedure('public.'||item.signature) AND l.lanname='sql'
      AND p.prorettype='public.owner_campaigns'::regtype AND p.proretset;
    IF body IS NULL OR (length(body)-length(replace(body,anchor,'')))/length(anchor)<>1
      OR position('order by e.last_seen asc nulls first,e.starts_at,e.created_at,e.id limit 6' in body)=0
      OR position('seen.last_seen' in body)=0 OR position('owner_campaign_events' in body)=0
      OR position('maxAdsPerDay' in body)=0 OR position('dailyFrequency' in body)=0
      OR item.is_search AND position('owner_campaign_matches_search(c,p_terms,p_kind,p_category)' in body)=0
    THEN RAISE EXCEPTION 'Authoritative owner selector changed; review disclosure trace projection before applying'; END IF;
    projection := $projection$) select jsonb_build_object(
      'campaign',(select to_jsonb(c) from public.owner_campaigns c where c.id=e.id),
      'trace',jsonb_build_object(
        'selectedAt',now(),'lastSeenAt',e.last_seen,'areaMatchedLevel',e.area,
        'viewerAdsToday',(select count(*) from public.owner_campaign_events v where v.visitor_hash=p_visitor and v.day=(now() at time zone 'America/Chicago')::date and v.kind='view'),
        'viewerCampaignViewsToday',(select count(*) from public.owner_campaign_events v where v.campaign_id=e.id and v.visitor_hash=p_visitor and v.day=(now() at time zone 'America/Chicago')::date and v.kind='view'),
        'maxAdsPerDay',coalesce((e.settings_snapshot->>'maxAdsPerDay')::integer,6),
        'dailyFrequency',(e.settings_snapshot->>'dailyFrequency')::integer,
        'selectionRuleCodes',jsonb_build_array('selected_area','active_schedule','approved_public_source','active_advertiser','exclude_own_salon','campaign_availability','daily_pacing','viewer_daily_cap','viewer_campaign_frequency','one_per_salon','least_recently_seen','start_created_id_order',SEARCH_CODE)
      )) from eligible e where salon_rank=1$projection$;
    projection := replace(projection,'SEARCH_CODE',quote_literal(CASE WHEN item.is_search THEN 'search_relevance' ELSE 'no_search' END));
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS SETOF jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO public AS %L', item.name,item.args,replace(body,anchor,projection));
  END LOOP;
END $migration$;

CREATE FUNCTION public.select_owner_ad_disclosures(p_area jsonb,p_visitor text,p_viewer uuid,p_terms text DEFAULT NULL,p_kind text DEFAULT NULL,p_category text DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
 IF p_terms IS NULL THEN
   RETURN QUERY SELECT * FROM public.owner_campaign_disclosure_candidates(p_area,p_visitor,p_viewer);
 ELSE
   RETURN QUERY SELECT * FROM public.owner_campaign_search_disclosure_candidates(p_area,p_visitor,p_viewer,p_terms,p_kind,p_category);
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.owner_campaign_disclosure_candidates(jsonb,text,uuid),public.owner_campaign_search_disclosure_candidates(jsonb,text,uuid,text,text,text),public.select_owner_ad_disclosures(jsonb,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_campaign_disclosure_candidates(jsonb,text,uuid),public.owner_campaign_search_disclosure_candidates(jsonb,text,uuid,text,text,text),public.select_owner_ad_disclosures(jsonb,text,uuid,text,text,text) TO service_role;
