-- Maintenance-only missing-coordinate enrichment. No provider calls in SQL or Explore.
BEGIN;
CREATE TABLE public.directory_geocode_jobs (
 salon_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
 fingerprint text NOT NULL CHECK(length(fingerprint) BETWEEN 1 AND 600),
 status text NOT NULL CHECK(status IN ('leased','succeeded','rejected','retry','stale')),
 attempts integer NOT NULL DEFAULT 1 CHECK(attempts BETWEEN 1 AND 3),
 lease_token uuid, lease_until timestamptz, next_attempt_at timestamptz,
 reason text, match_metadata jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(salon_id,fingerprint)
);
ALTER TABLE public.directory_geocode_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.directory_geocode_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.directory_geocode_jobs TO service_role;
CREATE INDEX directory_geocode_missing_id_idx ON public.locations(id)
 WHERE status='active' AND latitude IS NULL AND longitude IS NULL;

CREATE FUNCTION public.directory_geocode_address_snapshot(p_salon_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH address AS (
  SELECT l.id,l.phone,l.address_line1 AS raw_street,l.city AS raw_city,l.state AS raw_state,
   d.listing_id,
   nullif(regexp_replace(btrim(coalesce(s.address_line1,l.address_line1)), '\s+', ' ', 'g'),'') AS street,
   nullif(regexp_replace(btrim(coalesce(s.address_line2,l.address_line2)), '\s+', ' ', 'g'),'') AS unit,
   nullif(regexp_replace(btrim(coalesce(s.city,l.city)), '\s+', ' ', 'g'),'') AS city,
   upper(nullif(regexp_replace(btrim(coalesce(s.state,l.state)), '\s+', ' ', 'g'),'')) AS state,
   upper(nullif(regexp_replace(btrim(coalesce(s.postal_code,l.postal_code)), '\s+', ' ', 'g'),'')) AS zip,
   upper(coalesce(nullif(btrim(coalesce(s.country,l.country)),''),'US')) AS country
  FROM public.locations l JOIN public.accounts a ON a.id=l.account_id AND a.status='active'
   JOIN public.salon_settings s ON s.salon_id=l.id AND s.public_discovery_enabled
    AND (s.public_discovery_published_at IS NULL OR s.public_discovery_published_at<=now())
   JOIN public.salon_directory_listings d ON d.salon_id=l.id AND d.claim_state='unclaimed'
  WHERE l.id=p_salon_id AND l.status='active' AND l.latitude IS NULL AND l.longitude IS NULL
   AND NOT EXISTS(SELECT 1 FROM public.salon_directory_suppressions x WHERE x.listing_id=d.listing_id
    OR x.identity_key=public.directory_import_identity(l.state,l.city,l.phone,l.address_line1))
 ), normalized AS (
  SELECT *,lower(concat_ws('|',street,unit,city,state,zip,country)) AS fingerprint FROM address
 )
 SELECT jsonb_build_object('salonId',id,'listingId',listing_id,'fingerprint',fingerprint,
  'address',jsonb_build_object('addressLine1',street,'addressLine2',unit,'city',city,'state',state,'postalCode',zip,'country',country))
 FROM normalized WHERE street IS NOT NULL AND city IS NOT NULL AND state ~ '^[A-Z]{2}$'
  AND zip ~ '^\d{5}(-\d{4})?$' AND country='US' AND length(fingerprint)<=600
$$;

CREATE FUNCTION public.get_directory_geocode_candidates(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 5,p_scan_limit integer DEFAULT 256) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_catalog AS $$
 WITH raw AS MATERIALIZED (
  SELECT l.id FROM public.locations l WHERE l.status='active' AND l.latitude IS NULL AND l.longitude IS NULL
   AND l.id>coalesce(p_after,'00000000-0000-0000-0000-000000000000'::uuid) ORDER BY l.id LIMIT least(256,greatest(1,coalesce(p_scan_limit,256)))+1
 ), page AS MATERIALIZED (
  SELECT id FROM raw ORDER BY id LIMIT least(256,greatest(1,coalesce(p_scan_limit,256)))
 ), snapshots AS MATERIALIZED (
  SELECT id,public.directory_geocode_address_snapshot(id) AS item FROM page
 ), eligible AS MATERIALIZED (
  SELECT id,item FROM snapshots WHERE item IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.directory_geocode_jobs j WHERE j.salon_id=snapshots.id
    AND j.fingerprint=item->>'fingerprint' AND (j.status IN ('succeeded','rejected','stale') OR j.attempts>=3
      OR (j.status='leased' AND j.lease_until>now()) OR (j.status='retry' AND j.next_attempt_at>now()))
  )
 ), selected AS MATERIALIZED (
  SELECT id,item FROM eligible ORDER BY id LIMIT least(5,greatest(1,coalesce(p_limit,5)))
 ), cursor_value AS (
  SELECT coalesce((SELECT id FROM selected ORDER BY id DESC LIMIT 1),(SELECT id FROM page ORDER BY id DESC LIMIT 1)) AS next_id
 ) SELECT jsonb_build_object('candidates',coalesce((SELECT jsonb_agg(item ORDER BY id) FROM selected),'[]'::jsonb),
  'nextAfter',(SELECT next_id FROM cursor_value),'scanned',(SELECT count(*) FROM page),
  'hasMore',coalesce((SELECT id FROM raw ORDER BY id DESC LIMIT 1)>(SELECT next_id FROM cursor_value),false))
$$;

CREATE FUNCTION public.claim_directory_geocode_job(p_salon_id uuid,p_fingerprint text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE snapshot jsonb; token uuid := gen_random_uuid();
BEGIN
 -- Account -> location -> directory -> settings -> job matches owner/claim serialization.
 PERFORM a.id FROM public.accounts a JOIN public.locations l ON l.account_id=a.id WHERE l.id=p_salon_id FOR UPDATE OF a;
 PERFORM id FROM public.locations WHERE id=p_salon_id FOR UPDATE;
 PERFORM salon_id FROM public.salon_directory_listings WHERE salon_id=p_salon_id FOR UPDATE;
 PERFORM salon_id FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE;
 snapshot:=public.directory_geocode_address_snapshot(p_salon_id);
 IF snapshot IS NULL OR snapshot->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN RETURN NULL; END IF;
 INSERT INTO public.directory_geocode_jobs(salon_id,fingerprint,status,lease_token,lease_until)
 VALUES(p_salon_id,p_fingerprint,'leased',token,now()+interval '2 minutes')
 ON CONFLICT(salon_id,fingerprint) DO UPDATE SET status='leased',attempts=directory_geocode_jobs.attempts+1,
  lease_token=token,lease_until=now()+interval '2 minutes',next_attempt_at=NULL,reason=NULL,updated_at=now()
 WHERE directory_geocode_jobs.attempts<3 AND ((directory_geocode_jobs.status='retry' AND directory_geocode_jobs.next_attempt_at<=now())
  OR (directory_geocode_jobs.status='leased' AND directory_geocode_jobs.lease_until<=now()));
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN token;
END $$;

CREATE FUNCTION public.finish_directory_geocode_job(p_salon_id uuid,p_fingerprint text,p_lease_token uuid,p_match jsonb DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.directory_geocode_jobs%ROWTYPE; snapshot jsonb; lat float8; lon float8; final_status text;
BEGIN
 PERFORM a.id FROM public.accounts a JOIN public.locations l ON l.account_id=a.id WHERE l.id=p_salon_id FOR UPDATE OF a;
 PERFORM id FROM public.locations WHERE id=p_salon_id FOR UPDATE;
 PERFORM salon_id FROM public.salon_directory_listings WHERE salon_id=p_salon_id FOR UPDATE;
 PERFORM salon_id FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE;
 SELECT * INTO job FROM public.directory_geocode_jobs WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint FOR UPDATE;
 IF NOT FOUND OR job.status<>'leased' OR job.lease_token IS DISTINCT FROM p_lease_token OR job.lease_until<=now() THEN RETURN 'lease_lost'; END IF;
 snapshot:=public.directory_geocode_address_snapshot(p_salon_id);
 IF snapshot IS NULL OR snapshot->>'fingerprint' IS DISTINCT FROM p_fingerprint THEN
  UPDATE public.directory_geocode_jobs SET status='stale',reason='source_changed',lease_token=NULL,lease_until=NULL,updated_at=now()
   WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint;
  RETURN 'stale';
 END IF;
 IF p_match IS NULL THEN
  final_status:=CASE WHEN p_reason IN ('timeout','network','rate_limited','unavailable') AND job.attempts<3 THEN 'retry' ELSE 'rejected' END;
  UPDATE public.directory_geocode_jobs SET status=final_status,reason=left(coalesce(p_reason,'no_match'),80),lease_token=NULL,lease_until=NULL,
   next_attempt_at=CASE WHEN final_status='retry' THEN now()+CASE WHEN job.attempts=1 THEN interval '15 minutes' ELSE interval '1 hour' END END,updated_at=now()
   WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint;
  RETURN final_status;
 END IF;
 IF jsonb_typeof(p_match->'latitude') IS DISTINCT FROM 'number' OR jsonb_typeof(p_match->'longitude') IS DISTINCT FROM 'number'
  OR p_match->>'fingerprint' IS DISTINCT FROM p_fingerprint OR p_match->>'provider' IS DISTINCT FROM 'us_census'
  OR p_match->>'accuracy' IS DISTINCT FROM 'address_range_interpolated'
  OR coalesce(p_match->>'tigerLineId','')!~'^\d{1,20}$' OR coalesce(p_match->>'side','') NOT IN ('L','R')
  OR length(coalesce(p_match->>'matchedAddress','')) NOT BETWEEN 1 AND 400 THEN RETURN 'invalid_match'; END IF;
 lat:=(p_match->>'latitude')::float8; lon:=(p_match->>'longitude')::float8;
 IF NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180) OR (lat=0 AND lon=0) THEN RETURN 'invalid_match'; END IF;
 -- Recheck at the actual write. Existing projection triggers propagate only accepted current rows.
 UPDATE public.locations SET latitude=lat,longitude=lon,geocoded_at=now(),geocoding_provider='us_census',
  geocoding_status='mapped',geocoding_address_fingerprint=p_fingerprint,geocoding_error_code=NULL,
  geocoding_place_id='tiger:'||(p_match->>'tigerLineId')||':'||(p_match->>'side')
 WHERE id=p_salon_id AND latitude IS NULL AND longitude IS NULL
  AND public.directory_geocode_address_snapshot(id)->>'fingerprint'=p_fingerprint;
 IF NOT FOUND THEN RETURN 'stale'; END IF;
 UPDATE public.directory_geocode_jobs SET status='succeeded',match_metadata=p_match,reason=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
  WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint;
 RETURN 'succeeded';
END $$;
REVOKE ALL ON FUNCTION public.directory_geocode_address_snapshot(uuid),public.get_directory_geocode_candidates(uuid,integer,integer),
 public.claim_directory_geocode_job(uuid,text),public.finish_directory_geocode_job(uuid,text,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.directory_geocode_address_snapshot(uuid),public.get_directory_geocode_candidates(uuid,integer,integer),
 public.claim_directory_geocode_job(uuid,text),public.finish_directory_geocode_job(uuid,text,uuid,jsonb,text) TO service_role;
COMMENT ON TABLE public.directory_geocode_jobs IS 'Bounded Census maintenance attempts for public unclaimed addresses. Coordinates are address-range interpolation, never a verified owner pin. No per-search calls.';
COMMIT;
