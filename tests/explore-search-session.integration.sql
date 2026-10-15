-- Run against an isolated fixture schema. All fixtures and sessions roll back.
BEGIN;
INSERT INTO public.users(id) VALUES('10000000-0000-0000-0000-000000000001');
INSERT INTO public.explore_salon_documents(salon_id,salon_name,city,state,postal_code,country,latitude,longitude,profile_completeness,active_service_count,service_categories,service_names,created_at,updated_at,salon_name_search,search_document,service_category_search_text,state_code,city_search,has_public_profile)
SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'Nail place local '||i,'Madison','WI','53703','US',43.0731,-89.4012,20+(i%5)*20,1,ARRAY['Nails'],ARRAY['Manicure'],now()-interval '1 day',now(),
 'nail place local '||i,'nail place local manicure nails madison wi','nails','WI','madison',true FROM generate_series(1,620) i;
INSERT INTO public.explore_salon_documents(salon_id,salon_name,city,state,postal_code,country,latitude,longitude,profile_completeness,active_service_count,service_categories,service_names,created_at,updated_at,salon_name_search,search_document,service_category_search_text,state_code,city_search,has_public_profile)
VALUES
 ('00000000-0000-0000-0001-000000000001','Nail place','Miami','FL','33101','US',25.7617,-80.1918,20,1,ARRAY['Nails'],ARRAY['Manicure'],now()-interval '2 days',now(),'nail place','nail place nails manicure miami fl','nails','FL','miami',true),
 ('00000000-0000-0000-0001-000000000002','Nail place nearby','Baraboo','WI','53913','US',43.6,-89.4012,40,1,ARRAY['Nails'],ARRAY['Manicure'],now()-interval '2 days',now(),'nail place nearby','nail place nearby nails manicure baraboo wi','nails','WI','baraboo',true),
 ('00000000-0000-0000-0001-000000000003','Nail place wider','Milwaukee','WI','53202','US',43.0389,-87.9065,60,1,ARRAY['Nails'],ARRAY['Manicure'],now()-interval '2 days',now(),'nail place wider','nail place wider nails manicure milwaukee wi','nails','WI','milwaukee',true),
 ('00000000-0000-0000-0001-000000000004','Nail place unmapped','Madison','WI','53703','US',NULL,NULL,40,1,ARRAY['Nails'],ARRAY['Manicure'],now()-interval '2 days',now(),'nail place unmapped','nail place unmapped nails manicure madison wi','nails','WI','madison',true),
 ('00000000-0000-0000-0001-000000000005','Hair on Madison Avenue','Sun Prairie','WI','53590','US',43.18,-89.21,100,1,ARRAY['Hair'],ARRAY['Haircut'],now()-interval '2 days',now(),'hair on madison avenue','hair on madison avenue haircut sun prairie wi','hair','WI','sun prairie',true),
 ('00000000-0000-0000-0001-000000000006','King Nails','Madison','WI','53703','US',43.0731,-89.4012,60,1,ARRAY['Nails'],ARRAY['Manicure'],now()-interval '2 days',now(),'king nails','king nails nails manicure madison wi','nails','WI','madison',true);
INSERT INTO public.explore_salon_documents SELECT ('00000000-0000-0000-0001-000000000007')::uuid,'King Studio',phone,address_line1,address_line2,city,state,postal_code,country,latitude,longitude,description,public_discovery_published_at,20,active_service_count,service_categories,service_names,created_at,updated_at,cover_image_path,latest_media_created_at,featured_service_category,'Manicure',has_public_profile,starting_price,'king studio',description_search,'king studio nails manicure',location_search_text,service_search_text,service_category_search_text,state_code,city_search FROM public.explore_salon_documents WHERE salon_id='00000000-0000-0000-0001-000000000006';
UPDATE public.explore_salon_documents SET featured_service_name='Manicure' WHERE salon_id='00000000-0000-0000-0001-000000000006';
INSERT INTO public.booking_settings(salon_id,booking_enabled,online_booking_visible,guest_booking_enabled) VALUES
 ('00000000-0000-0000-0001-000000000006',true,false,true),
 ('00000000-0000-0000-0001-000000000007',true,true,true);
ANALYZE public.explore_salon_documents;
DO $$
DECLARE first_page jsonb; next_page jsonb; token jsonb; partial_token jsonb; repeated jsonb; item jsonb;
 seen text[]:='{}'; current_id text; scope text; found_b boolean:=false; found_c boolean:=false; page_number integer:=0; removed uuid; sid uuid; removed_sessions integer; republished uuid; late_publication uuid:='00000000-0000-0000-0003-000000000001'; bitmap_setting text;
BEGIN
 first_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'expandable');
 IF first_page->'rows'->0->>'salon_name'<>'Nail place' OR first_page->'rows'->0->>'search_scope'<>'exact' THEN RAISE EXCEPTION 'Global exact name must appear before local A'; END IF;
 IF NOT(first_page->'rows'->0->>'outside_area')::boolean OR first_page->'rows'->0->>'scope_label'<>'Exact name match outside your area' THEN RAISE EXCEPTION 'Outside exact match not labeled'; END IF;
 IF first_page->>'countKind'<>'loaded' OR NOT(first_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Count/continuation contract invalid'; END IF;
 token:=first_page->'nextCursor';
 repeated:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'expandable',p_cursor=>token);
 next_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'expandable',p_cursor=>token);
 IF repeated->'rows' IS DISTINCT FROM next_page->'rows' THEN RAISE EXCEPTION 'Repeated cursor changed stable queue'; END IF;
 partial_token:=first_page->'rows'->4->'pagination_cursor';
 next_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'expandable',p_cursor=>partial_token);
 IF next_page->'rows'->0->>'salon_id' IS DISTINCT FROM first_page->'rows'->5->>'salon_id' THEN RAISE EXCEPTION 'Per-row cursor skipped unconsumed rows'; END IF;
 next_page:=first_page;
 LOOP
  page_number:=page_number+1;
  FOR item IN SELECT value FROM jsonb_array_elements(next_page->'rows') LOOP
   current_id:=item->>'salon_id'; scope:=item->>'search_scope';
   IF current_id=ANY(seen) THEN RAISE EXCEPTION 'Repeated salon between pools/scopes'; END IF;
   seen:=array_append(seen,current_id);
   IF NOT(item->>'search_document' LIKE '%nail%' AND item->>'search_document' LIKE '%place%') THEN RAISE EXCEPTION 'Unrelated keyword result'; END IF;
   IF scope='B' THEN found_b:=true; END IF;
   IF scope='C' THEN found_c:=true; END IF;
  END LOOP;
  EXIT WHEN NOT(next_page->>'hasMore')::boolean;
  IF page_number>100 THEN RAISE EXCEPTION 'Pagination did not terminate'; END IF;
  next_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'expandable',p_cursor=>next_page->'nextCursor');
 END LOOP;
 IF cardinality(seen)<>624 OR NOT found_b OR NOT found_c THEN RAISE EXCEPTION 'Bounded pools lost results: %, B %, C %',cardinality(seen),found_b,found_c; END IF;
 -- More than one candidate pool has exactly the same coordinates. KNN must
 -- preserve the UUID tie-break and restore its scoped planner setting.
 bitmap_setting:=current_setting('enable_bitmapscan');
 PERFORM set_config('enable_bitmapscan','on',true);
 first_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'closest',p_limit=>20,p_scope_policy=>'expandable');
 seen:='{}'; page_number:=0; next_page:=first_page;
 LOOP
  IF current_setting('enable_bitmapscan')<>'on' THEN RAISE EXCEPTION 'Closest leaked bitmap planner setting'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(next_page->'rows') LOOP
   current_id:=item->>'salon_id';
   IF current_id=ANY(seen) THEN RAISE EXCEPTION 'Closest repeated a tied candidate'; END IF;
   seen:=array_append(seen,current_id);
  END LOOP;
  EXIT WHEN NOT(next_page->>'hasMore')::boolean;
  page_number:=page_number+1;
  IF page_number>100 THEN RAISE EXCEPTION 'Closest pagination did not terminate'; END IF;
  next_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'closest',p_limit=>20,p_scope_policy=>'expandable',p_cursor=>next_page->'nextCursor');
 END LOOP;
 IF cardinality(seen)<>624 THEN RAISE EXCEPTION 'Closest lost tied candidates across pools: %',cardinality(seen); END IF;
 PERFORM set_config('enable_bitmapscan','off',true);
 PERFORM public.search_public_explore_session(p_query=>'nail',p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'closest',p_scope_policy=>'fixed');
 IF current_setting('enable_bitmapscan')<>'off' THEN RAISE EXCEPTION 'Closest did not retain caller bitmap setting'; END IF;
 PERFORM set_config('enable_bitmapscan','on',true);
 PERFORM public.search_public_explore_session(p_query=>'nail',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'relevance',p_scope_policy=>'fixed');
 PERFORM public.search_public_explore_session(p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'bookable',p_scope_policy=>'fixed');
 IF current_setting('enable_bitmapscan')<>'on' THEN RAISE EXCEPTION 'Geographic relevance/bookable leaked planner setting'; END IF;
 next_page:=public.search_public_explore_session(p_query=>'quasarneverpresent',p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'closest',p_scope_policy=>'fixed');
 IF jsonb_array_length(next_page->'rows')<>0 OR (next_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Empty geographic text did not terminate'; END IF;
 next_page:=public.search_public_explore_session(p_category=>'Lashes',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'fixed');
 IF jsonb_array_length(next_page->'rows')<>0 OR (next_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Empty geographic category did not terminate'; END IF;
 next_page:=public.search_public_explore_session(p_query=>'king',p_category=>'Nails',p_latitude=>43.0731,p_longitude=>-89.4012,p_sort=>'relevance',p_scope_policy=>'fixed');
 IF jsonb_array_length(next_page->'rows')<>2 OR (next_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Small geographic candidate pool lost eligible rows'; END IF;
 PERFORM set_config('enable_bitmapscan',bitmap_setting,true);
 first_page:=public.search_public_explore_session(p_query=>'Nail place',p_category=>'Nails',p_location=>'Madison, WI',p_scope_policy=>'fixed');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') x WHERE x->>'city'<>'Madison' OR x->>'state'<>'WI') THEN RAISE EXCEPTION 'Fixed location expanded'; END IF;
 next_page:=public.search_public_explore_session(p_query=>'Hair',p_location=>'Madison, WI',p_scope_policy=>'fixed');
 IF jsonb_array_length(next_page->'rows')<>0 OR (next_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Street address was treated as city or empty state failed'; END IF;
 first_page:=public.search_public_explore_session(p_query=>'King Nails',p_location=>'WI',p_scope_policy=>'fixed');
 IF first_page->'rows'->0->>'salon_name'<>'King Nails' THEN RAISE EXCEPTION 'King Nails missing'; END IF;
 first_page:=public.search_public_explore_session(p_query=>'King',p_location=>'WI',p_sort=>'bookable');
 IF first_page->'rows'->0->>'salon_name'<>'King Studio' THEN RAISE EXCEPTION 'Hidden online booking incorrectly prioritized'; END IF;
 first_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'53703',p_scope_policy=>'fixed');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') x WHERE x->>'postal_code'<>'53703') THEN RAISE EXCEPTION 'ZIP boundary escaped'; END IF;
 token:=first_page->'nextCursor'; sid:=(token->>'session')::uuid;
 SELECT salon_id INTO removed FROM public.explore_search_session_candidates WHERE session_id=sid AND ordinal>(token->>'after')::bigint ORDER BY ordinal LIMIT 1;
 DELETE FROM public.explore_salon_documents WHERE salon_id=removed;
 next_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'53703',p_scope_policy=>'fixed',p_cursor=>token);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(next_page->'rows') x WHERE x->>'salon_id'=removed::text) THEN RAISE EXCEPTION 'Hidden/deleted queued result resurfaced'; END IF;
 INSERT INTO public.explore_salon_documents SELECT ('00000000-0000-0000-0002-000000000001')::uuid,'Nail new',phone,address_line1,address_line2,city,state,postal_code,country,latitude,longitude,description,public_discovery_published_at,profile_completeness,active_service_count,service_categories,service_names,now()+interval '1 second',updated_at,cover_image_path,latest_media_created_at,featured_service_category,featured_service_name,has_public_profile,starting_price,'nail new',description_search,'nail new nails',location_search_text,service_search_text,service_category_search_text,state_code,city_search FROM public.explore_salon_documents ORDER BY salon_id LIMIT 1;
 next_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'53703',p_scope_policy=>'fixed',p_cursor=>token);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(next_page->'rows') x WHERE x->>'salon_id'='00000000-0000-0000-0002-000000000001') THEN RAISE EXCEPTION 'New upload entered existing session'; END IF;
 BEGIN PERFORM public.search_public_explore_session(p_query=>'hair',p_location=>'53703',p_cursor=>token); RAISE EXCEPTION 'Changed filters accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.search_public_explore_session(p_query=>'nail',p_location=>'53703',p_sort=>'closest',p_cursor=>token); RAISE EXCEPTION 'Changed sort accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.search_public_explore_session(p_cursor=>'{}'::jsonb); RAISE EXCEPTION 'Malformed cursor accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM set_config('test.viewer','10000000-0000-0000-0000-000000000001',true);
 BEGIN PERFORM public.search_public_explore_session(p_query=>'nail',p_location=>'53703',p_cursor=>token); RAISE EXCEPTION 'Different viewer accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM set_config('test.viewer','',true);
 UPDATE public.explore_search_sessions SET expires_at=now()-interval '1 second' WHERE id=sid;
 BEGIN PERFORM public.search_public_explore_session(p_query=>'nail',p_location=>'53703',p_cursor=>token); RAISE EXCEPTION 'Expired session accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 removed_sessions:=public.cleanup_explore_search_sessions(1);
 IF removed_sessions<>1 OR EXISTS(SELECT 1 FROM public.explore_search_session_candidates WHERE session_id=sid) THEN RAISE EXCEPTION 'Expiry cleanup failed'; END IF;
 IF has_table_privilege('anon','public.explore_search_sessions','SELECT') OR has_table_privilege('authenticated','public.explore_search_session_candidates','SELECT') OR has_function_privilege('anon','public.explore_search_pull_batch(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Private session access leaked'; END IF;
 IF position('count(' IN lower(pg_get_functiondef('public.search_public_explore_session(text,text,text,double precision,double precision,text,integer,jsonb,text,text)'::regprocedure)))>0 THEN RAISE EXCEPTION 'Global COUNT introduced'; END IF;
 first_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'WI',p_sort=>'trusted',p_limit=>99);
 IF jsonb_array_length(first_page->'rows')>20 OR first_page->>'appliedSort'<>'relevance' THEN RAISE EXCEPTION 'Limit or unsupported trust transparency failed'; END IF;
 -- A newly published profile can have a long-existing location creation date.
 -- Advance the fixture's publication relative to its session without depending
 -- on wall-clock sleeps or PostgreSQL's transaction-constant now().
 first_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'WI',p_limit=>20);
 token:=first_page->'nextCursor'; sid:=(token->>'session')::uuid;
 UPDATE public.explore_search_sessions SET created_at=now()-interval '1 minute' WHERE id=sid;
 SELECT salon_id INTO republished FROM public.explore_search_session_candidates WHERE session_id=sid AND ordinal>(token->>'after')::bigint ORDER BY ordinal LIMIT 1;
 UPDATE public.explore_salon_documents SET public_discovery_published_at=now()-interval '30 seconds' WHERE salon_id=republished;
 INSERT INTO public.explore_salon_documents SELECT late_publication,'Nail private publication',phone,address_line1,address_line2,city,state,postal_code,country,latitude,longitude,description,now()-interval '30 seconds',0,active_service_count,service_categories,service_names,now()-interval '1 year',updated_at,cover_image_path,latest_media_created_at,featured_service_category,featured_service_name,has_public_profile,starting_price,'nail private publication',description_search,'nail private publication nails',location_search_text,service_search_text,service_category_search_text,state_code,city_search FROM public.explore_salon_documents WHERE state_code='WI' ORDER BY salon_id LIMIT 1;
 page_number:=0;
 LOOP
  next_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'WI',p_limit=>20,p_cursor=>token);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(next_page->'rows') x WHERE x->>'salon_id' IN (late_publication::text,republished::text)) THEN RAISE EXCEPTION 'Post-session publication entered queued/live candidates'; END IF;
  page_number:=page_number+1;
  EXIT WHEN NOT(next_page->>'hasMore')::boolean;
  IF page_number>100 THEN RAISE EXCEPTION 'Publication continuation did not finish'; END IF;
  token:=next_page->'nextCursor';
 END LOOP;
 next_page:=public.search_public_explore_session(p_query=>'Nail private publication',p_location=>'WI');
 IF next_page->'rows'->0->>'salon_id'<>late_publication::text THEN RAISE EXCEPTION 'Fresh session did not include new publication'; END IF;
 -- The current imported directory has no usable coordinates. GPS cannot
 -- manufacture a nearby match or distance from a city/state address.
 UPDATE public.explore_salon_documents SET latitude=NULL,longitude=NULL;
 next_page:=public.search_public_explore_session(p_query=>'nail',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'fixed');
 IF jsonb_array_length(next_page->'rows')<>0 OR (next_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Fixed GPS fabricated an unmapped nearby result'; END IF;
 next_page:=public.search_public_explore_session(p_query=>'nail',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'expandable');
 IF jsonb_array_length(next_page->'rows')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(next_page->'rows') x WHERE x->>'search_scope'<>'C' OR x->>'distance_miles' IS NOT NULL) THEN RAISE EXCEPTION 'Unmapped GPS fallback must label wider results without distances'; END IF;
 next_page:=public.search_public_explore_session(p_query=>'nail',p_location=>'WI',p_latitude=>43.0731,p_longitude=>-89.4012,p_scope_policy=>'fixed');
 IF jsonb_array_length(next_page->'rows')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(next_page->'rows') x WHERE x->>'state'<>'WI' OR x->>'search_scope'<>'A' OR x->>'distance_miles' IS NOT NULL) THEN RAISE EXCEPTION 'Manual structured region must work without mapped coordinates'; END IF;
END $$;
ROLLBACK;
