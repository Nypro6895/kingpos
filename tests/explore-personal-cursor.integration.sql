BEGIN;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE first_page jsonb; next_page jsonb; token jsonb; all_ids text[]:='{}'; id text; auth_id uuid; target uuid; preferred jsonb; i integer;
BEGIN
 first_page:=public.search_public_explore_cursor(p_location=>'WI',p_category=>'Nails');
 IF jsonb_array_length(first_page->'rows')=0 THEN RAISE EXCEPTION 'Missing initial results'; END IF;
 FOR i IN 1..5 LOOP
  FOR id IN SELECT x->>'salon_id' FROM jsonb_array_elements(first_page->'rows') x LOOP
   IF id=ANY(all_ids) THEN RAISE EXCEPTION 'Repeated cursor result'; END IF;
   all_ids:=array_append(all_ids,id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') x WHERE x->>'state'<>'WI') THEN RAISE EXCEPTION 'Cross-state result'; END IF;
  token:=first_page->'cursor';
  first_page:=public.search_public_explore_cursor(p_location=>'WI',p_category=>'Nails',p_cursor=>token);
 END LOOP;
 BEGIN
  PERFORM public.search_public_explore_cursor(p_location=>'IL',p_category=>'Nails',p_cursor=>token);
  RAISE EXCEPTION 'Changed filters accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.search_public_explore_cursor(p_location=>'WI',p_category=>'Nails',p_cursor=>jsonb_set(token,'{stamp}',to_jsonb(now()-interval '1 hour')));
  RAISE EXCEPTION 'Expired cursor accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Removing the previous anchor does not invalidate its value-based cursor.
 target:=(token->>'id')::uuid;
 UPDATE public.salon_settings SET public_discovery_enabled=false WHERE salon_id=target;
 next_page:=public.search_public_explore_cursor(p_location=>'WI',p_category=>'Nails',p_cursor=>token);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(next_page->'rows') x WHERE x->>'salon_id'=target::text) THEN RAISE EXCEPTION 'Hidden result returned'; END IF;
 SELECT auth_user_id INTO auth_id FROM public.users WHERE auth_user_id IS NOT NULL LIMIT 1;
 IF auth_id IS NOT NULL THEN
  PERFORM set_config('request.jwt.claim.sub',auth_id::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',auth_id,'role','authenticated')::text,true);
  PERFORM public.remember_my_explore_preference('Milwaukee, WI','Nails');
  preferred:=public.get_my_explore_preferences();
  IF preferred->>'location'<>'Milwaukee, WI' OR NOT (preferred->'categories' ? 'Nails') THEN RAISE EXCEPTION 'Preference not saved'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.get_public_explore_home_salons()) OR EXISTS(SELECT 1 FROM public.get_public_explore_home_salons() h JOIN public.explore_salon_documents d ON d.salon_id=h.salon_id WHERE NOT public.search_text_has_all_tokens(d.location_search_text,ARRAY['milwaukee','wi'])) THEN RAISE EXCEPTION 'Personal home location not respected'; END IF;
  PERFORM public.remember_my_explore_preference('WI',NULL);
  IF EXISTS(SELECT 1 FROM public.get_public_explore_home_salons() WHERE state<>'WI') THEN RAISE EXCEPTION 'Home state escaped'; END IF;
  first_page:=public.search_public_explore_cursor(p_location=>'WI');
  IF first_page->'cursor'->>'viewer'='guest' THEN RAISE EXCEPTION 'Preference viewer not scoped'; END IF;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  IF public.get_my_explore_preferences()->>'location'<>'' THEN RAISE EXCEPTION 'Guest sees account location'; END IF;
 END IF;
END $$;
ROLLBACK;
