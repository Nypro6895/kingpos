-- Read-time compatibility for names accepted by Campaign creation and codes sent
-- by delivery. No stored geo, accounting, frequency or pacing values are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_campaign_geo_country(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
 SELECT CASE lower(trim(value))
  WHEN 'united states' THEN 'us' WHEN 'united states of america' THEN 'us'
  WHEN 'usa' THEN 'us' WHEN 'u.s' THEN 'us' WHEN 'u.s.' THEN 'us'
  WHEN 'u.sa' THEN 'us' WHEN 'u.sa.' THEN 'us' WHEN 'u.s.a' THEN 'us' WHEN 'u.s.a.' THEN 'us'
  WHEN 'canada' THEN 'ca' WHEN 'united kingdom' THEN 'gb' WHEN 'uk' THEN 'gb'
  ELSE nullif(lower(trim(value)),'') END
$$;

CREATE OR REPLACE FUNCTION public.owner_campaign_geo_state(country text,value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
 SELECT CASE WHEN public.owner_campaign_geo_country(country)='us' THEN
  coalesce((jsonb_build_object(
   'alabama','al','alaska','ak','arizona','az','arkansas','ar','california','ca',
   'colorado','co','connecticut','ct','delaware','de','florida','fl','georgia','ga',
   'hawaii','hi','idaho','id','illinois','il','indiana','in','iowa','ia',
   'kansas','ks','kentucky','ky','louisiana','la','maine','me','maryland','md',
   'massachusetts','ma','michigan','mi','minnesota','mn','mississippi','ms','missouri','mo',
   'montana','mt','nebraska','ne','nevada','nv','new hampshire','nh','new jersey','nj',
   'new mexico','nm','new york','ny','north carolina','nc','north dakota','nd','ohio','oh',
   'oklahoma','ok','oregon','or','pennsylvania','pa','rhode island','ri','south carolina','sc',
   'south dakota','sd','tennessee','tn','texas','tx','utah','ut','vermont','vt',
   'virginia','va','washington','wa','west virginia','wv','wisconsin','wi','wyoming','wy'
  ) || '{"district of columbia":"dc"}'::jsonb)->>lower(trim(value)),nullif(lower(trim(value)),''))
  ELSE nullif(lower(trim(value)),'') END
$$;

CREATE OR REPLACE FUNCTION public.owner_campaign_area_matches(c public.owner_campaigns,p_area jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
 SELECT coalesce(public.owner_campaign_geo_country(c.country)=public.owner_campaign_geo_country(p_area->>'country')
 AND CASE c.area
  WHEN 'country' THEN public.owner_campaign_geo_country(c.location)=public.owner_campaign_geo_country(p_area->>'country')
  WHEN 'state' THEN public.owner_campaign_geo_state(c.country,c.location)=public.owner_campaign_geo_state(p_area->>'country',p_area->>'state')
  WHEN 'city' THEN public.owner_campaign_geo_state(c.country,c.state)=public.owner_campaign_geo_state(p_area->>'country',p_area->>'state')
   AND lower(trim(c.location))=lower(trim(p_area->>'city'))
  WHEN 'zipcode' THEN public.owner_campaign_geo_state(c.country,c.state)=public.owner_campaign_geo_state(p_area->>'country',p_area->>'state')
   AND lower(trim(c.location))=lower(trim(p_area->>'zipcode'))
  WHEN 'neighborhood' THEN public.owner_campaign_geo_state(c.country,c.state)=public.owner_campaign_geo_state(p_area->>'country',p_area->>'state')
   AND lower(trim(c.city))=lower(trim(p_area->>'city')) AND lower(trim(c.location))=lower(trim(p_area->>'neighborhood'))
  ELSE false END,false)
$$;

REVOKE ALL ON FUNCTION public.owner_campaign_geo_country(text),public.owner_campaign_geo_state(text,text),public.owner_campaign_area_matches(public.owner_campaigns,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.owner_campaign_geo_country(text),public.owner_campaign_geo_state(text,text),public.owner_campaign_area_matches(public.owner_campaigns,jsonb) TO service_role;

-- Keep the current function definitions, including the wallet core's newer
-- snapshot/locking logic, SECURITY DEFINER, search_path and existing ACLs.
-- Refuse any unrecognized geo predicate instead of replacing newer logic.
DO $migration$
DECLARE
 signature text;
 definition text;
 original text;
 first_at integer;
 last_at integer;
 first_marker constant text := 'lower(trim(c.country))=lower(trim(p_area->>''country''))';
 last_marker constant text := 'lower(trim(c.location))=lower(trim(p_area->>''neighborhood'')))';
 replacement constant text := 'public.owner_campaign_area_matches(c,p_area)';
 expected constant text := $geo$lower(trim(c.country))=lower(trim(p_area->>'country')) and
  (c.area='country' and lower(trim(c.location))=lower(trim(p_area->>'country')) or
   c.area='state' and lower(trim(c.location))=lower(trim(p_area->>'state')) or
   c.area='city' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'city')) or
   c.area='zipcode' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.location))=lower(trim(p_area->>'zipcode')) or
   c.area='neighborhood' and lower(trim(c.state))=lower(trim(p_area->>'state')) and lower(trim(c.city))=lower(trim(p_area->>'city')) and lower(trim(c.location))=lower(trim(p_area->>'neighborhood')))$geo$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.owner_campaign_candidates(jsonb,text,uuid)',
  'public.owner_campaign_search_candidates(jsonb,text,uuid,text,text,text)',
  'public.owner_campaign_admit_without_wallet(uuid,text,text,jsonb,uuid,uuid)'
 ] LOOP
  definition := pg_get_functiondef(signature::regprocedure);
  first_at := strpos(definition,first_marker);
  IF first_at=0 AND (length(definition)-length(replace(definition,replacement,'')))/length(replacement)=1 THEN
   CONTINUE; -- Retry of this exact migration is harmless.
  END IF;
  IF first_at=0 OR (length(definition)-length(replace(definition,first_marker,'')))/length(first_marker)<>1 THEN
   RAISE EXCEPTION 'Campaign geo compatibility: unsupported predicate in %',signature;
  END IF;
  last_at := strpos(substr(definition,first_at),last_marker);
  IF last_at=0 THEN
   RAISE EXCEPTION 'Campaign geo compatibility: missing predicate boundary in %',signature;
  END IF;
  original := substr(definition,first_at,last_at-1+length(last_marker));
  IF regexp_replace(original,'\s','','g')<>regexp_replace(expected,'\s','','g') THEN
   RAISE EXCEPTION 'Campaign geo compatibility: changed predicate in %',signature;
  END IF;
  EXECUTE overlay(definition placing replacement from first_at for length(original));
 END LOOP;
END
$migration$;
COMMIT;
