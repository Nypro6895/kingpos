-- Execute only after the real search migrations in an isolated test database.
-- Existing public source triggers remove hidden/deleted shops from this read model.
CREATE TABLE public.explore_guard_test_pull_calls(session_id uuid);
DO $$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.explore_search_pull_batch(uuid)'::regprocedure) INTO body;
 EXECUTE replace(body,'FUNCTION public.explore_search_pull_batch(', 'FUNCTION public.explore_guard_test_original_pull(');
END $$;
CREATE OR REPLACE FUNCTION public.explore_search_pull_batch(p_session_id uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,extensions AS $$
BEGIN
 INSERT INTO public.explore_guard_test_pull_calls VALUES(p_session_id);
 RETURN public.explore_guard_test_original_pull(p_session_id);
END $$;
INSERT INTO public.explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state,state_code,
 service_category_search_text,search_document,service_categories,created_at,public_discovery_published_at,profile_completeness,has_public_profile)
SELECT ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Nail Salon '||n,'nail salon '||n,
 'Madison','madison','WI','WI','nails','nail salon '||n||' nails manicure full set',ARRAY['Nails'],now()-interval '1 day',now()-interval '1 day',50,true
FROM generate_series(1,40)n;
INSERT INTO public.explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state,state_code,
 service_category_search_text,search_document,service_categories,created_at,public_discovery_published_at,profile_completeness,has_public_profile)
VALUES
 ('20000000-0000-4000-8000-000000000001','King Nails','king nails','Miami','miami','FL','FL','nails','king nails manicure',ARRAY['Nails'],now()-interval '1 day',now()-interval '1 day',50,true),
 ('20000000-0000-4000-8000-000000000002','Prismatic Hair Studio','prismatic hair studio','Seattle','seattle','WA','WA','hair','prismatic hair studio haircut',ARRAY['Hair'],now()-interval '1 day',now()-interval '1 day',50,true),
 ('20000000-0000-4000-8000-000000000003','Legacy Pearl Studio','legacy pearl studio','Seattle','seattle','WA','WA','nails','legacy pearl studio nails manicure',ARRAY['Nails'],now()-interval '1 day',NULL,50,true),
 ('20000000-0000-4000-8000-000000000004','Future Crystal Studio','future crystal studio','Seattle','seattle','WA','WA','nails','future crystal studio nails',ARRAY['Nails'],now()-interval '1 year',now()+interval '1 day',50,true),
 ('20000000-0000-4000-8000-000000000005','Hidden Violet Studio','hidden violet studio','Seattle','seattle','WA','WA','nails','hidden violet studio nails',ARRAY['Nails'],now()-interval '1 day',now()-interval '1 day',50,true),
 ('20000000-0000-4000-8000-000000000006','Deleted Amber Studio','deleted amber studio','Seattle','seattle','WA','WA','nails','deleted amber studio nails',ARRAY['Nails'],now()-interval '1 day',now()-interval '1 day',50,true);
-- Equivalent read-model mutations made by the existing visibility/delete triggers.
DELETE FROM public.explore_salon_documents WHERE salon_id IN ('20000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000006');
INSERT INTO public.explore_salon_documents(salon_id,salon_name,salon_name_search,city,city_search,state,state_code,
 service_category_search_text,search_document,service_categories,created_at,public_discovery_published_at,profile_completeness,has_public_profile)
SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Prismatic Nail Studio '||n,'prismatic nail studio '||n,
 'Seattle','seattle','WA','WA','nails','prismatic nail studio '||n||' nails manicure',ARRAY['Nails'],now()-interval '1 day',now()-interval '1 day',50,true
FROM generate_series(1,30)n;
ANALYZE public.explore_salon_documents;
