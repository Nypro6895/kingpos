BEGIN;
SET LOCAL statement_timeout='30s';
DO $$
DECLARE first_page jsonb; next_page jsonb; item jsonb;
BEGIN
 first_page:=public.search_public_explore_cursor(p_query=>'Nail place');
 IF jsonb_array_length(first_page->'rows')=0 OR (first_page->'cursor'->>'fuzzy')::boolean THEN RAISE EXCEPTION 'Exact results missing'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(first_page->'rows') LOOP
 IF NOT EXISTS(SELECT 1 FROM public.explore_salon_documents WHERE salon_id=(item->>'salon_id')::uuid AND public.search_text_has_all_tokens(search_document,ARRAY['nail','place'])) THEN RAISE EXCEPTION 'Unrelated exact search result'; END IF;
 END LOOP;
 next_page:=public.search_public_explore_cursor(p_query=>'Nail place',p_cursor=>first_page->'cursor');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') a JOIN jsonb_array_elements(next_page->'rows') b ON a->>'salon_id'=b->>'salon_id') THEN RAISE EXCEPTION 'Repeated text result'; END IF;
 first_page:=public.search_public_explore_cursor(p_query=>'Nail place',p_category=>'Nails',p_location=>'WI');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') x WHERE x->>'state'<>'WI') THEN RAISE EXCEPTION 'Text search escaped state'; END IF;
 first_page:=public.search_public_explore_cursor(p_query=>'zzzzzzzzzz');
 IF jsonb_array_length(first_page->'rows')<>0 OR (first_page->>'hasMore')::boolean THEN RAISE EXCEPTION 'Empty search invalid'; END IF;
 BEGIN PERFORM public.search_public_explore_cursor(p_query=>repeat('x',161));RAISE EXCEPTION 'Input limit missing';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $$;
ROLLBACK;
