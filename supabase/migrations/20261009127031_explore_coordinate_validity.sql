-- Preserve original pins; exclude obsolete pins from distance and refresh only proven automatic pins.
BEGIN;
SET LOCAL search_path=public,extensions;
ALTER TABLE public.locations ADD COLUMN geocoding_pin_origin text
 CHECK(geocoding_pin_origin IN ('auto_census','auto_maptiler','owner_confirmed'));
COMMENT ON COLUMN public.locations.geocoding_pin_origin IS 'Nullable legacy provenance. Owner-confirmed pins are never overwritten by automatic maintenance.';
ALTER TABLE public.directory_geocode_jobs ADD COLUMN source_pin jsonb;

CREATE FUNCTION public.explore_location_address_signature(l public.locations,s public.salon_settings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_array(
  lower(nullif(regexp_replace(btrim(coalesce(s.address_line1,l.address_line1)),'\s+',' ','g'),'')),
  lower(nullif(regexp_replace(btrim(coalesce(s.address_line2,l.address_line2)),'\s+',' ','g'),'')),
  lower(nullif(regexp_replace(btrim(coalesce(s.city,l.city)),'\s+',' ','g'),'')),
  lower(nullif(regexp_replace(btrim(coalesce(s.state,l.state)),'\s+',' ','g'),'')),
  lower(nullif(regexp_replace(btrim(coalesce(s.postal_code,l.postal_code)),'\s+',' ','g'),'')),
  lower(coalesce(nullif(btrim(coalesce(s.country,l.country)),''),'US')))
$$;
CREATE FUNCTION public.explore_location_address_fingerprint(l public.locations,s public.salon_settings) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 WITH a AS (SELECT
  nullif(regexp_replace(btrim(coalesce(s.address_line1,l.address_line1)),'\s+',' ','g'),'') street,
  nullif(regexp_replace(btrim(coalesce(s.address_line2,l.address_line2)),'\s+',' ','g'),'') unit,
  nullif(regexp_replace(btrim(coalesce(s.city,l.city)),'\s+',' ','g'),'') city,
  upper(nullif(regexp_replace(btrim(coalesce(s.state,l.state)),'\s+',' ','g'),'')) state,
  upper(nullif(regexp_replace(btrim(coalesce(s.postal_code,l.postal_code)),'\s+',' ','g'),'')) zip,
  upper(coalesce(nullif(btrim(coalesce(s.country,l.country)),''),'US')) country)
 SELECT CASE WHEN street IS NOT NULL AND city IS NOT NULL AND state IS NOT NULL AND zip IS NOT NULL
  THEN lower(concat_ws('|',street,unit,city,state,zip,country)) ELSE NULL END FROM a
$$;
CREATE FUNCTION public.explore_salon_coordinates_valid(l public.locations,s public.salon_settings) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=public,pg_catalog AS $$
 SELECT coalesce(l.latitude BETWEEN -90 AND 90 AND l.longitude BETWEEN -180 AND 180
  AND NOT(l.latitude=0 AND l.longitude=0)
  AND coalesce(l.geocoding_status,'') NOT IN ('stale','address_required','pending','failed')
  AND (l.geocoding_address_fingerprint IS NULL OR
   (public.explore_location_address_fingerprint(l,s) IS NOT NULL AND l.geocoding_address_fingerprint=public.explore_location_address_fingerprint(l,s))),false)
$$;
CREATE FUNCTION public.location_geocoding_pin_snapshot(l public.locations) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('latitude',l.latitude,'longitude',l.longitude,'fingerprint',l.geocoding_address_fingerprint,
  'provider',l.geocoding_provider,'placeId',l.geocoding_place_id,'origin',l.geocoding_pin_origin,'geocodedAt',l.geocoded_at)
$$;
CREATE FUNCTION public.location_geocoding_pin_matches(l public.locations,p_pin jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_catalog AS $$
BEGIN
 IF jsonb_typeof(p_pin) IS DISTINCT FROM 'object' OR octet_length(p_pin::text)>2000 THEN RETURN false; END IF;
 RETURN (public.location_geocoding_pin_snapshot(l)-'geocodedAt')=(p_pin-'geocodedAt')
  AND l.geocoded_at IS NOT DISTINCT FROM (p_pin->>'geocodedAt')::timestamptz;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.explore_location_address_signature(public.locations,public.salon_settings),public.explore_location_address_fingerprint(public.locations,public.salon_settings),
 public.explore_salon_coordinates_valid(public.locations,public.salon_settings),public.location_geocoding_pin_snapshot(public.locations),
 public.location_geocoding_pin_matches(public.locations,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.explore_location_address_signature(public.locations,public.salon_settings),public.explore_location_address_fingerprint(public.locations,public.salon_settings),
 public.explore_salon_coordinates_valid(public.locations,public.salon_settings),public.location_geocoding_pin_snapshot(public.locations),
 public.location_geocoding_pin_matches(public.locations,jsonb) TO service_role;

-- Patch only the coordinate expressions of the existing canonical view, preserving every output column.
DO $$ DECLARE definition text:=pg_get_viewdef('public.explore_document_source'::regclass,true); BEGIN
 IF (SELECT count(*) FROM regexp_matches(definition,'\msalons\.latitude\M','g'))<>1
  OR (SELECT count(*) FROM regexp_matches(definition,'\msalons\.longitude\M','g'))<>1 THEN
  RAISE EXCEPTION 'Explore source coordinate contract changed; review before migrating';
 END IF;
 definition:=replace(definition,'salons.latitude','CASE WHEN public.explore_salon_coordinates_valid(salons,settings) THEN salons.latitude ELSE NULL::double precision END AS latitude');
 definition:=replace(definition,'salons.longitude','CASE WHEN public.explore_salon_coordinates_valid(salons,settings) THEN salons.longitude ELSE NULL::double precision END AS longitude');
 EXECUTE 'CREATE OR REPLACE VIEW public.explore_document_source WITH(security_invoker=true) AS '||definition;
END $$;

-- Address changes invalidate use of the pin, without deleting its original values or provenance.
CREATE FUNCTION public.mark_explore_pin_address_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE l public.locations; s public.salon_settings; old_signature jsonb; new_signature jsonb;new_fp text; BEGIN
 IF TG_TABLE_NAME='salon_settings' THEN
  SELECT * INTO l FROM public.locations WHERE id=NEW.salon_id;
  old_signature:=public.explore_location_address_signature(l,OLD);new_signature:=public.explore_location_address_signature(l,NEW);
  new_fp:=public.explore_location_address_fingerprint(l,NEW);
  IF old_signature IS DISTINCT FROM new_signature THEN
   UPDATE public.locations SET geocoding_status=CASE WHEN new_fp IS NULL THEN 'address_required' ELSE 'stale' END,
    geocoding_error_code=CASE WHEN new_fp IS NULL THEN 'address_required' ELSE NULL END
   WHERE id=NEW.salon_id AND (latitude IS NOT NULL OR longitude IS NOT NULL)
    AND (geocoding_status IS DISTINCT FROM CASE WHEN new_fp IS NULL THEN 'address_required' ELSE 'stale' END);
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO s FROM public.salon_settings WHERE salon_id=NEW.id;
 old_signature:=public.explore_location_address_signature(OLD,s);new_signature:=public.explore_location_address_signature(NEW,s);
 new_fp:=public.explore_location_address_fingerprint(NEW,s);
 IF old_signature IS DISTINCT FROM new_signature AND (NEW.latitude IS NOT NULL OR NEW.longitude IS NOT NULL) THEN
  NEW.geocoding_status:=CASE WHEN new_fp IS NULL THEN 'address_required' ELSE 'stale' END;
  NEW.geocoding_error_code:=CASE WHEN new_fp IS NULL THEN 'address_required' ELSE NULL END;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.mark_explore_pin_address_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER coordinate_address_change BEFORE UPDATE OF address_line1,address_line2,city,state,postal_code,country ON public.locations
 FOR EACH ROW EXECUTE FUNCTION public.mark_explore_pin_address_change();
CREATE TRIGGER coordinate_address_change AFTER INSERT OR UPDATE OF address_line1,address_line2,city,state,postal_code,country ON public.salon_settings
 FOR EACH ROW EXECUTE FUNCTION public.mark_explore_pin_address_change();

-- A prior Census maintenance result must still describe the exact source pin before automatic replacement.
CREATE FUNCTION public.directory_geocode_auto_pin_replaceable(l public.locations,p_current_fingerprint text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 SELECT coalesce((l.geocoding_pin_origin IS NULL OR l.geocoding_pin_origin='auto_census') AND l.geocoding_provider='us_census'
  AND l.latitude BETWEEN -90 AND 90 AND l.longitude BETWEEN -180 AND 180
  AND l.geocoding_address_fingerprint IS NOT NULL AND p_current_fingerprint IS NOT NULL
  AND (l.geocoding_address_fingerprint<>p_current_fingerprint OR l.geocoding_status IN ('stale','address_required','failed'))
  AND EXISTS(SELECT 1 FROM public.directory_geocode_jobs j WHERE j.salon_id=l.id AND j.status='succeeded'
   AND j.fingerprint=l.geocoding_address_fingerprint AND j.match_metadata->>'provider'='us_census'
   AND j.match_metadata->>'accuracy'='address_range_interpolated'
   AND jsonb_typeof(j.match_metadata->'latitude')='number' AND jsonb_typeof(j.match_metadata->'longitude')='number'
   AND (j.match_metadata->>'latitude')::float8=l.latitude AND (j.match_metadata->>'longitude')::float8=l.longitude),false)
$$;
REVOKE ALL ON FUNCTION public.directory_geocode_auto_pin_replaceable(public.locations,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directory_geocode_auto_pin_replaceable(public.locations,text) TO service_role;
CREATE INDEX directory_geocode_stale_auto_id_idx ON public.locations(id)
 WHERE status='active' AND geocoding_provider='us_census' AND geocoding_status IN ('stale','address_required','failed')
  AND latitude IS NOT NULL AND longitude IS NOT NULL AND geocoding_pin_origin IS DISTINCT FROM 'owner_confirmed';

CREATE OR REPLACE FUNCTION public.directory_geocode_address_snapshot(p_salon_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH source AS (SELECT l,s,d.listing_id,public.explore_location_address_fingerprint(l,s) fingerprint
  FROM public.locations l JOIN public.accounts a ON a.id=l.account_id AND a.status='active'
  JOIN public.salon_settings s ON s.salon_id=l.id AND s.public_discovery_enabled
   AND (s.public_discovery_published_at IS NULL OR s.public_discovery_published_at<=now())
  JOIN public.salon_directory_listings d ON d.salon_id=l.id AND d.claim_state='unclaimed'
  WHERE l.id=p_salon_id AND l.status='active' AND l.geocoding_pin_origin IS DISTINCT FROM 'owner_confirmed'
   AND coalesce(l.geocoding_status,'')<>'pending'
   AND NOT EXISTS(SELECT 1 FROM public.salon_directory_suppressions x WHERE x.listing_id=d.listing_id
    OR x.identity_key=public.directory_import_identity(l.state,l.city,l.phone,l.address_line1))), eligible AS (
  SELECT * FROM source WHERE fingerprint IS NOT NULL AND length(fingerprint)<=600
   AND (((l).latitude IS NULL AND (l).longitude IS NULL) OR public.directory_geocode_auto_pin_replaceable(l,fingerprint)))
 SELECT jsonb_build_object('salonId',(l).id,'listingId',listing_id,'fingerprint',fingerprint,
  'mode',CASE WHEN (l).latitude IS NULL AND (l).longitude IS NULL THEN 'missing' ELSE 'refresh_auto' END,
  'sourcePin',public.location_geocoding_pin_snapshot(l),'address',jsonb_build_object(
   'addressLine1',nullif(regexp_replace(btrim(coalesce((s).address_line1,(l).address_line1)),'\s+',' ','g'),''),
   'addressLine2',nullif(regexp_replace(btrim(coalesce((s).address_line2,(l).address_line2)),'\s+',' ','g'),''),
   'city',nullif(regexp_replace(btrim(coalesce((s).city,(l).city)),'\s+',' ','g'),''),
   'state',upper(btrim(coalesce((s).state,(l).state))),
   'postalCode',upper(btrim(coalesce((s).postal_code,(l).postal_code))),
   'country',upper(coalesce(nullif(btrim(coalesce((s).country,(l).country)),''),'US'))))
 FROM eligible WHERE upper(btrim(coalesce((s).state,(l).state)))~'^[A-Z]{2}$'
  AND btrim(coalesce((s).postal_code,(l).postal_code))~'^\d{5}(-\d{4})?$'
  AND upper(coalesce(nullif(btrim(coalesce((s).country,(l).country)),''),'US'))='US'
$$;
CREATE OR REPLACE FUNCTION public.get_directory_geocode_candidates(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 5,p_scan_limit integer DEFAULT 256) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH bounds AS(SELECT least(256,greatest(1,coalesce(p_scan_limit,256))) n), raw AS MATERIALIZED(
  SELECT id FROM (
   (SELECT id FROM public.locations WHERE status='active' AND latitude IS NULL AND longitude IS NULL
     AND id>coalesce(p_after,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY id LIMIT (SELECT n+1 FROM bounds))
   UNION ALL
   (SELECT id FROM public.locations WHERE status='active' AND geocoding_provider='us_census'
     AND geocoding_status IN ('stale','address_required','failed') AND latitude IS NOT NULL AND longitude IS NOT NULL
     AND geocoding_pin_origin IS DISTINCT FROM 'owner_confirmed'
     AND id>coalesce(p_after,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY id LIMIT (SELECT n+1 FROM bounds))
  ) u ORDER BY id LIMIT (SELECT n+1 FROM bounds)), page AS MATERIALIZED(
  SELECT id FROM raw ORDER BY id LIMIT (SELECT n FROM bounds)), snapshots AS MATERIALIZED(
  SELECT id,public.directory_geocode_address_snapshot(id) item FROM page), eligible AS MATERIALIZED(
  SELECT id,item FROM snapshots WHERE item IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.directory_geocode_jobs j
   WHERE j.salon_id=snapshots.id AND j.fingerprint=item->>'fingerprint' AND (j.status='rejected'
    OR (j.status='succeeded' AND item->>'mode'<>'refresh_auto') OR (j.attempts>=3 AND j.status NOT IN ('succeeded','stale'))
    OR (j.status='leased' AND j.lease_until>now()) OR (j.status='retry' AND j.next_attempt_at>now())))), selected AS MATERIALIZED(
  SELECT id,item FROM eligible ORDER BY id LIMIT least(5,greatest(1,coalesce(p_limit,5)))), cursor_value AS(
  SELECT coalesce((SELECT id FROM selected ORDER BY id DESC LIMIT 1),(SELECT id FROM page ORDER BY id DESC LIMIT 1)) next_id)
 SELECT jsonb_build_object('candidates',coalesce((SELECT jsonb_agg(item ORDER BY id) FROM selected),'[]'::jsonb),
  'nextAfter',(SELECT next_id FROM cursor_value),'scanned',(SELECT count(*) FROM page),
  'hasMore',coalesce((SELECT id FROM raw ORDER BY id DESC LIMIT 1)>(SELECT next_id FROM cursor_value),false))
$$;
CREATE OR REPLACE FUNCTION public.claim_directory_geocode_job(p_salon_id uuid,p_fingerprint text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE snapshot jsonb;token uuid:=gen_random_uuid();BEGIN
 PERFORM a.id FROM public.accounts a JOIN public.locations l ON l.account_id=a.id WHERE l.id=p_salon_id FOR UPDATE OF a NOWAIT;
 PERFORM id FROM public.locations WHERE id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_directory_listings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 snapshot:=public.directory_geocode_address_snapshot(p_salon_id);
 IF snapshot IS NULL OR snapshot->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RETURN NULL;END IF;
 INSERT INTO public.directory_geocode_jobs(salon_id,fingerprint,status,lease_token,lease_until,source_pin)
 VALUES(p_salon_id,p_fingerprint,'leased',token,now()+interval '2 minutes',snapshot->'sourcePin')
 ON CONFLICT(salon_id,fingerprint) DO UPDATE SET status='leased',attempts=CASE WHEN directory_geocode_jobs.status IN ('succeeded','stale') THEN 1 ELSE directory_geocode_jobs.attempts+1 END,
  lease_token=token,lease_until=now()+interval '2 minutes',next_attempt_at=NULL,updated_at=now(),source_pin=excluded.source_pin
 WHERE directory_geocode_jobs.status='stale' OR (directory_geocode_jobs.status='succeeded' AND snapshot->>'mode'='refresh_auto')
  OR (directory_geocode_jobs.attempts<3 AND ((directory_geocode_jobs.status='retry' AND directory_geocode_jobs.next_attempt_at<=now())
  OR (directory_geocode_jobs.status='leased' AND directory_geocode_jobs.lease_until<=now())));
 IF NOT FOUND THEN RETURN NULL;END IF;RETURN token;
EXCEPTION WHEN lock_not_available THEN RETURN NULL;END $$;
CREATE OR REPLACE FUNCTION public.finish_directory_geocode_job(p_salon_id uuid,p_fingerprint text,p_lease_token uuid,p_match jsonb DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.directory_geocode_jobs%ROWTYPE;snapshot jsonb;l public.locations;lat float8;lon float8;final_status text;BEGIN
 PERFORM a.id FROM public.accounts a JOIN public.locations x ON x.account_id=a.id WHERE x.id=p_salon_id FOR UPDATE OF a NOWAIT;
 SELECT * INTO l FROM public.locations WHERE id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_directory_listings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 SELECT * INTO job FROM public.directory_geocode_jobs WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint FOR UPDATE NOWAIT;
 IF NOT FOUND OR job.status<>'leased' OR job.lease_token IS DISTINCT FROM p_lease_token OR job.lease_until<=now() THEN RETURN 'lease_lost';END IF;
 snapshot:=public.directory_geocode_address_snapshot(p_salon_id);
 -- Existing pre-migration leases may finish only when their original source still has no coordinates.
 IF snapshot IS NULL OR snapshot->>'fingerprint' IS DISTINCT FROM p_fingerprint
  OR (job.source_pin IS NOT NULL AND NOT public.location_geocoding_pin_matches(l,job.source_pin))
  OR (job.source_pin IS NULL AND (l.latitude IS NOT NULL OR l.longitude IS NOT NULL)) THEN
  UPDATE public.directory_geocode_jobs SET status='stale',reason='source_changed',lease_token=NULL,lease_until=NULL,updated_at=now()
   WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint;RETURN 'stale';END IF;
 IF p_match IS NULL THEN
  final_status:=CASE WHEN p_reason IN ('timeout','network','rate_limited','unavailable') AND job.attempts<3 THEN 'retry' ELSE 'rejected' END;
  UPDATE public.directory_geocode_jobs SET status=final_status,reason=left(coalesce(p_reason,'no_match'),80),lease_token=NULL,lease_until=NULL,
   next_attempt_at=CASE WHEN final_status='retry' THEN now()+CASE WHEN job.attempts=1 THEN interval '15 minutes' ELSE interval '1 hour' END END,updated_at=now()
   WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint;RETURN final_status;END IF;
 IF jsonb_typeof(p_match->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(p_match->'longitude') IS DISTINCT FROM 'number'
  OR p_match->>'fingerprint' IS DISTINCT FROM p_fingerprint OR p_match->>'provider' IS DISTINCT FROM 'us_census'
  OR p_match->>'accuracy' IS DISTINCT FROM 'address_range_interpolated'
  OR coalesce(p_match->>'tigerLineId','')!~'^\d{1,20}$' OR coalesce(p_match->>'side','') NOT IN ('L','R')
  OR length(coalesce(p_match->>'matchedAddress','')) NOT BETWEEN 1 AND 400 THEN RETURN 'invalid_match';END IF;
 lat:=(p_match->>'latitude')::float8;lon:=(p_match->>'longitude')::float8;
 IF NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180) OR (lat=0 AND lon=0) THEN RETURN 'invalid_match';END IF;
 UPDATE public.locations SET latitude=lat,longitude=lon,geocoded_at=now(),geocoding_provider='us_census',geocoding_pin_origin='auto_census',
  geocoding_status='mapped',geocoding_address_fingerprint=p_fingerprint,geocoding_error_code=NULL,
  geocoding_place_id='tiger:'||(p_match->>'tigerLineId')||':'||(p_match->>'side')
 WHERE id=p_salon_id AND geocoding_pin_origin IS DISTINCT FROM 'owner_confirmed'
  AND public.directory_geocode_address_snapshot(id)->>'fingerprint'=p_fingerprint
  AND (CASE WHEN job.source_pin IS NULL THEN latitude IS NULL AND longitude IS NULL
   ELSE public.location_geocoding_pin_matches(locations,job.source_pin) END);
 IF NOT FOUND THEN RETURN 'stale';END IF;
 UPDATE public.directory_geocode_jobs SET status='succeeded',match_metadata=p_match,reason=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
  WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint;RETURN 'succeeded';
EXCEPTION WHEN lock_not_available THEN RETURN 'source_busy';END $$;

-- Owner refresh uses the same source-address and original-pin CAS; status transitions keep old metadata intact.
CREATE FUNCTION public.set_current_salon_geocoding_state(p_salon_id uuid,p_fingerprint text,p_prior_pin jsonb,p_values jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE l public.locations;s public.salon_settings;phase text:=p_values->>'status';lat float8;lon float8;BEGIN
 IF public.current_public_user_id() IS NULL OR NOT public.user_has_salon_permission(p_salon_id,ARRAY['salon_settings.manage']) THEN
  RAISE EXCEPTION 'Salon map location permission required' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR octet_length(p_values::text)>3000
  OR phase IS NULL OR phase NOT IN ('pending','failed','provider_unavailable','address_required','stale','mapped') THEN RETURN 'invalid_match';END IF;
 PERFORM a.id FROM public.accounts a JOIN public.locations x ON x.account_id=a.id WHERE x.id=p_salon_id AND a.status='active' FOR UPDATE OF a NOWAIT;
 IF NOT FOUND THEN RETURN 'stale';END IF;
 SELECT * INTO l FROM public.locations WHERE id=p_salon_id AND status='active' FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RETURN 'stale';END IF;
 SELECT * INTO s FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 IF NOT FOUND OR public.explore_location_address_fingerprint(l,s) IS DISTINCT FROM p_fingerprint
  OR NOT public.location_geocoding_pin_matches(l,p_prior_pin) THEN RETURN 'stale';END IF;
 IF l.geocoding_pin_origin='owner_confirmed' THEN RETURN 'owner_pin_preserved';END IF;
 IF phase='mapped' THEN
  IF jsonb_typeof(p_values->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(p_values->'longitude') IS DISTINCT FROM 'number'
   OR p_values->>'provider' IS DISTINCT FROM 'maptiler' OR p_fingerprint IS NULL THEN RETURN 'invalid_match';END IF;
  lat:=(p_values->>'latitude')::float8;lon:=(p_values->>'longitude')::float8;
  IF NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180) OR (lat=0 AND lon=0) THEN RETURN 'invalid_match';END IF;
  UPDATE public.locations SET latitude=lat,longitude=lon,geocoding_address_fingerprint=p_fingerprint,geocoding_status='mapped',
   geocoding_provider='maptiler',geocoding_pin_origin='auto_maptiler',geocoding_place_id=left(p_values->>'placeId',300),
   geocoded_at=now(),geocoding_error_code=NULL WHERE id=l.id;RETURN 'succeeded';
 END IF;
 UPDATE public.locations SET geocoding_status=phase,geocoding_error_code=left(p_values->>'errorCode',80) WHERE id=l.id;
 RETURN 'updated';
EXCEPTION WHEN lock_not_available THEN RETURN 'source_busy';END $$;
REVOKE ALL ON FUNCTION public.set_current_salon_geocoding_state(uuid,text,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_current_salon_geocoding_state(uuid,text,jsonb,jsonb) TO authenticated;

-- Only a caller-supplied point may establish distance. Text city/ZIP never invent a center from salon pins.
CREATE OR REPLACE FUNCTION public.explore_search_region(p_location text,p_latitude double precision,p_longitude double precision)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE label text:=btrim(coalesce(p_location,''));normalized text:=coalesce(public.normalize_search_text(label),'');
 state_value text;city_value text;postal_value text;state_name text;
 state_names constant jsonb:='{"alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO","connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA","hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH","oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY"}'::jsonb;
BEGIN
 IF NOT(coalesce(p_latitude BETWEEN -90 AND 90,false) AND coalesce(p_longitude BETWEEN -180 AND 180,false)) THEN p_latitude:=NULL;p_longitude:=NULL;END IF;
 IF label='' THEN
  IF p_latitude IS NOT NULL THEN RETURN jsonb_build_object('kind','geo','latitude',p_latitude,'longitude',p_longitude,'radius',16093.44,'scope','A','label','Within 10 miles');END IF;
  RETURN jsonb_build_object('kind','global','scope','C','label','Matching salons across regions');END IF;
 state_value:=CASE WHEN upper(label)=ANY(public.explore_search_state_codes()) THEN upper(label) ELSE state_names->>normalized END;
 IF state_value IS NOT NULL THEN RETURN jsonb_build_object('kind','state','state',state_value,'latitude',p_latitude,'longitude',p_longitude,'scope','A','label',state_value);END IF;
 IF label~'^\d{5}(-\d{4})?$' THEN
  postal_value:=left(label,5);
  SELECT d.state_code INTO state_value FROM public.explore_salon_documents d WHERE left(coalesce(d.postal_code,''),5)=postal_value ORDER BY d.salon_id LIMIT 1;
  RETURN jsonb_build_object('kind','postal','postal',postal_value,'state',state_value,'latitude',p_latitude,'longitude',p_longitude,'scope','A','label',postal_value);END IF;
 IF label~',\s*[A-Za-z]{2}$' OR label~'\s+[A-Za-z]{2}$' THEN
  state_value:=upper(substring(label FROM '([A-Za-z]{2})$'));
  IF NOT(state_value=ANY(public.explore_search_state_codes())) THEN state_value:=NULL;END IF;
  IF state_value IS NOT NULL THEN city_value:=public.normalize_search_text(regexp_replace(label,'[,\s]+[A-Za-z]{2}$',''));END IF;
 END IF;
 IF city_value IS NULL THEN
  SELECT key,value INTO state_name,state_value FROM jsonb_each_text(state_names)
   WHERE normalized LIKE '% '||key ORDER BY length(key) DESC LIMIT 1;
  IF state_name IS NOT NULL THEN city_value:=btrim(left(normalized,length(normalized)-length(state_name)));END IF;
 END IF;
 RETURN jsonb_build_object('kind','city','city',coalesce(city_value,normalized),'state',state_value,
  'latitude',p_latitude,'longitude',p_longitude,'scope','A','label',label);
END $$;

-- Repair pre-existing proven automatic mismatches so the indexed maintenance path can revisit them.
-- Skip an in-flight owner lookup; never alter owner/legacy pin values or their original fingerprint.
UPDATE public.locations l SET geocoding_status='stale',geocoding_error_code=NULL FROM public.salon_settings s
 WHERE s.salon_id=l.id AND l.status='active' AND coalesce(l.geocoding_status,'') NOT IN ('pending','stale','address_required','failed')
  AND public.directory_geocode_auto_pin_replaceable(l,public.explore_location_address_fingerprint(l,s));

-- Rebuild only projected pins whose validity changed; original location pins and address values are untouched.
DO $$ DECLARE ids uuid[];after_id uuid:='00000000-0000-0000-0000-000000000000';BEGIN LOOP
 SELECT array_agg(x.salon_id ORDER BY x.salon_id) INTO ids FROM(
  SELECT d.salon_id FROM public.explore_salon_documents d JOIN public.locations l ON l.id=d.salon_id
   JOIN public.salon_settings s ON s.salon_id=l.id
  WHERE d.salon_id>after_id AND ROW(d.latitude,d.longitude) IS DISTINCT FROM ROW(
   CASE WHEN public.explore_salon_coordinates_valid(l,s) THEN l.latitude ELSE NULL::float8 END,
   CASE WHEN public.explore_salon_coordinates_valid(l,s) THEN l.longitude ELSE NULL::float8 END)
  ORDER BY d.salon_id LIMIT 256) x;
 EXIT WHEN ids IS NULL;after_id:=ids[array_length(ids,1)];PERFORM public.refresh_explore_salon_documents(ids);
 END LOOP;END $$;
COMMIT;
