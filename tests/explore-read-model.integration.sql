-- Run through supabase db query --linked --file. All mutations roll back.
BEGIN;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE target uuid; listing text; item uuid; before_count bigint; removed public.salon_directory_listings%ROWTYPE;
BEGIN
 SELECT d.salon_id,d.listing_id INTO target,listing FROM public.salon_directory_listings d
 JOIN public.salon_settings s ON s.salon_id=d.salon_id WHERE s.public_discovery_enabled LIMIT 1;
 IF target IS NULL THEN RAISE EXCEPTION 'Test requires a published directory fixture'; END IF;
 UPDATE public.salon_settings SET business_name='Explore integration fixture' WHERE salon_id=target;
 IF NOT EXISTS(SELECT 1 FROM public.explore_salon_documents WHERE salon_id=target AND salon_name_search='explore integration fixture') THEN RAISE EXCEPTION 'Rename sync failed'; END IF;
 UPDATE public.salon_directory_listings SET source_categories=ARRAY['Hair','Spa'] WHERE salon_id=target;
 IF NOT EXISTS(SELECT 1 FROM public.explore_salon_documents WHERE salon_id=target AND service_categories @> ARRAY['Hair','Spa']) THEN RAISE EXCEPTION 'Category sync failed'; END IF;
 UPDATE public.salon_settings SET public_discovery_enabled=false WHERE salon_id=target;
 IF EXISTS(SELECT 1 FROM public.explore_salon_documents WHERE salon_id=target) OR NOT EXISTS(SELECT 1 FROM public.salon_directory_suppressions WHERE listing_id=listing) THEN RAISE EXCEPTION 'Hide failed'; END IF;
 UPDATE public.salon_settings SET public_discovery_enabled=true WHERE salon_id=target;
 IF NOT EXISTS(SELECT 1 FROM public.explore_salon_documents WHERE salon_id=target) OR EXISTS(SELECT 1 FROM public.salon_directory_suppressions WHERE listing_id=listing) THEN RAISE EXCEPTION 'Restore failed'; END IF;
 UPDATE public.salon_settings SET business_name='Batch sync fixture' WHERE salon_id IN (SELECT salon_id FROM public.explore_salon_documents ORDER BY salon_id LIMIT 5);
 IF (SELECT count(*) FROM public.explore_salon_documents WHERE salon_name='Batch sync fixture')<>5 THEN RAISE EXCEPTION 'Batch sync failed'; END IF;
 SELECT id INTO item FROM public.services WHERE is_active LIMIT 1;
 IF item IS NOT NULL THEN
  SELECT active_service_count INTO before_count FROM public.explore_salon_documents WHERE salon_id=(SELECT salon_id FROM public.services WHERE id=item);
  UPDATE public.services SET is_active=false WHERE id=item;
  IF before_count IS NOT NULL AND (SELECT active_service_count FROM public.explore_salon_documents WHERE salon_id=(SELECT salon_id FROM public.services WHERE id=item))<>before_count-1 THEN RAISE EXCEPTION 'Service delete sync failed'; END IF;
 END IF;
 SELECT * INTO removed FROM public.salon_directory_listings WHERE salon_id=target;
 DELETE FROM public.salon_directory_listings WHERE salon_id=target;
 IF NOT EXISTS(SELECT 1 FROM public.salon_directory_suppressions WHERE listing_id=listing AND reason='removed') THEN RAISE EXCEPTION 'Removal suppression failed'; END IF;
 BEGIN
  INSERT INTO public.salon_directory_listings SELECT (removed).*;
  RAISE EXCEPTION 'Suppressed listing was reimported';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 DELETE FROM public.salon_settings WHERE salon_id=target;
 IF EXISTS(SELECT 1 FROM public.explore_salon_documents WHERE salon_id=target) THEN RAISE EXCEPTION 'Settings deletion sync failed'; END IF;
 IF has_table_privilege('anon','public.explore_salon_documents','SELECT') OR has_function_privilege('authenticated','public.refresh_explore_salon_documents(uuid[])','EXECUTE') THEN RAISE EXCEPTION 'Projection permissions too broad'; END IF;
 IF EXISTS(SELECT 1 FROM public.search_public_explore_salons(NULL,NULL,'WI',NULL,NULL,1,12) WHERE upper(state)<>'WI') THEN RAISE EXCEPTION 'State boundary failed'; END IF;
END $$;
ROLLBACK;
