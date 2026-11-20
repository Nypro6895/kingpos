-- Keep the bounded private ranking worker running independently of browser traffic.
-- Credentials are supplied through the service-only setup RPC and encrypted in Vault.
BEGIN;
CREATE TABLE public.explore_search_rank_scheduler (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 last_requested_at timestamptz,last_request_id bigint
);
INSERT INTO public.explore_search_rank_scheduler DEFAULT VALUES;
ALTER TABLE public.explore_search_rank_scheduler ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.explore_search_rank_scheduler FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON public.explore_search_rank_scheduler TO service_role;
CREATE FUNCTION public.wake_explore_search_rank_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE state public.explore_search_rank_scheduler;token text;request_id bigint;BEGIN
 SELECT * INTO state FROM public.explore_search_rank_scheduler WHERE singleton FOR UPDATE SKIP LOCKED;
 IF NOT FOUND OR NOT state.enabled OR state.last_requested_at>now()-interval '55 seconds' THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.explore_search_rank_jobs WHERE next_attempt_at<=now()
  AND(lease IS NULL OR leased_at<now()-interval '5 minutes') LIMIT 1)
  AND NOT EXISTS(SELECT 1 FROM public.explore_search_rank_sources WHERE ready AND refresh_after<=now() LIMIT 1) THEN RETURN NULL;END IF;
 SELECT decrypted_secret INTO token FROM vault.decrypted_secrets WHERE name='explore-search-ranking';
 IF token IS NULL OR length(token)<20 THEN RETURN NULL;END IF;
 request_id:=net.http_post(url:='https://reylumi.com/api/internal/explore-ranking',
  headers:=jsonb_build_object('Authorization','Bearer '||token,'Content-Type','application/json'),
  body:='{}'::jsonb,timeout_milliseconds:=55000);
 UPDATE public.explore_search_rank_scheduler SET last_requested_at=now(),last_request_id=request_id WHERE singleton;
 RETURN request_id;
END $$;
CREATE FUNCTION public.configure_explore_search_rank_scheduler(p_secret text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE secret_id uuid;job_id bigint;BEGIN
 IF p_secret IS NULL OR length(p_secret) NOT BETWEEN 20 AND 1000 THEN RAISE EXCEPTION 'Invalid scheduler credential' USING ERRCODE='22023';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') OR NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  RAISE EXCEPTION 'Ranking scheduler extensions are unavailable';END IF;
 SELECT id INTO secret_id FROM vault.secrets WHERE name='explore-search-ranking';
 IF secret_id IS NULL THEN PERFORM vault.create_secret(p_secret,'explore-search-ranking','Private Explore ranking worker credential');
 ELSE PERFORM vault.update_secret(secret_id,p_secret,'explore-search-ranking','Private Explore ranking worker credential');END IF;
 UPDATE public.explore_search_rank_scheduler SET enabled=true WHERE singleton;
 job_id:=cron.schedule('kingpos-explore-ranking','* * * * *','SELECT public.wake_explore_search_rank_worker();');
 RETURN jsonb_build_object('configured',true,'jobId',job_id);
END $$;
REVOKE ALL ON FUNCTION public.wake_explore_search_rank_worker(),public.configure_explore_search_rank_scheduler(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.configure_explore_search_rank_scheduler(text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
