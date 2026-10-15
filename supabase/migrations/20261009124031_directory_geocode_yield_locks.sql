-- Yield to current owner, claim, or publication edits without blocking.
-- Preserve the original lease and attempt when finish yields; never retry provider calls here.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_directory_geocode_job(p_salon_id uuid,p_fingerprint text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE snapshot jsonb; token uuid := gen_random_uuid();
BEGIN
 -- Account -> location -> directory -> settings -> job matches owner/claim serialization.
 PERFORM a.id FROM public.accounts a JOIN public.locations l ON l.account_id=a.id WHERE l.id=p_salon_id FOR UPDATE OF a NOWAIT;
 PERFORM id FROM public.locations WHERE id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_directory_listings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
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
EXCEPTION WHEN lock_not_available THEN
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.finish_directory_geocode_job(p_salon_id uuid,p_fingerprint text,p_lease_token uuid,p_match jsonb DEFAULT NULL,p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE job public.directory_geocode_jobs%ROWTYPE; snapshot jsonb; lat float8; lon float8; final_status text;
BEGIN
 PERFORM a.id FROM public.accounts a JOIN public.locations l ON l.account_id=a.id WHERE l.id=p_salon_id FOR UPDATE OF a NOWAIT;
 PERFORM id FROM public.locations WHERE id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_directory_listings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 PERFORM salon_id FROM public.salon_settings WHERE salon_id=p_salon_id FOR UPDATE NOWAIT;
 SELECT * INTO job FROM public.directory_geocode_jobs WHERE salon_id=p_salon_id AND fingerprint=p_fingerprint FOR UPDATE NOWAIT;
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
EXCEPTION WHEN lock_not_available THEN
 RETURN 'source_busy';
END $$;
COMMIT;

