-- Optional reviewed step AFTER approved provider provisioning; not in apply.psql.
-- No Auth users/passwords/keys are created. Session JSON contains nonsecret IDs.
DO $$ DECLARE bindings jsonb; BEGIN
 IF current_setting('reylumi.qa_bootstrap',true) IS DISTINCT FROM 'synthetic-only-reviewed'
 OR current_setting('reylumi.qa_context_bootstrap',true) IS DISTINCT FROM 'canonical-context-reviewed'
 OR NOT EXISTS(SELECT 1 FROM qa_bootstrap.marker WHERE id AND scope='synthetic-canonical-context') THEN
  RAISE EXCEPTION 'Reviewed canonical-context QA target required';
 END IF;
 bindings:=nullif(current_setting('reylumi.qa_auth_bindings',true),'')::jsonb;
 IF bindings IS NULL OR jsonb_typeof(bindings)<>'array' THEN RAISE EXCEPTION 'Explicit four approved Auth bindings required'; END IF;
 IF jsonb_array_length(bindings)<>4 OR (SELECT count(DISTINCT value->>'profileId') FROM jsonb_array_elements(bindings))<>4 OR
    (SELECT count(DISTINCT value->>'authId') FROM jsonb_array_elements(bindings))<>4 OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(bindings) b WHERE (SELECT count(*) FROM jsonb_object_keys(b))<>2 OR
      NOT(b ? 'profileId' AND b ? 'authId') OR (b->>'profileId')::uuid NOT IN
      ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004')) THEN
  RAISE EXCEPTION 'Four distinct exact profile/Auth pairs required';
 END IF;
 IF (SELECT count(*) FROM public.users)<>4 OR (SELECT count(*) FROM auth.users)<>4 OR
    (SELECT count(*) FROM jsonb_array_elements(bindings) b JOIN public.users p ON p.id=(b->>'profileId')::uuid
      JOIN auth.users a ON a.id=(b->>'authId')::uuid AND a.email=p.email WHERE p.email LIKE '%@qa.example.invalid' AND p.status='active' AND a.email_confirmed_at IS NOT NULL)<>4 THEN
  RAISE EXCEPTION 'Confirmed exact synthetic Auth mapping is incomplete';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(bindings) b JOIN public.users p ON p.id=(b->>'profileId')::uuid WHERE p.auth_user_id IS NOT NULL AND p.auth_user_id<>(b->>'authId')::uuid) THEN
  RAISE EXCEPTION 'Existing Auth identity cannot be reassigned';
 END IF;
 UPDATE public.users p SET auth_user_id=(b->>'authId')::uuid FROM jsonb_array_elements(bindings) b WHERE p.id=(b->>'profileId')::uuid AND p.auth_user_id IS NULL;
END $$;
