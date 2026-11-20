-- Optional SECOND step, not part of apply.psql. No Auth accounts are created.
-- Only run after separately authorized official QA Auth provisioning and review
-- of the four exact Auth user UUIDs in qa-targets.json.
DO $$ BEGIN
 IF current_setting('reylumi.qa_bootstrap',true) IS DISTINCT FROM 'synthetic-only-reviewed'
 OR NOT EXISTS(SELECT 1 FROM qa_bootstrap.marker WHERE id AND scope='synthetic-market-contract-only') THEN RAISE EXCEPTION 'Reviewed synthetic QA target required';END IF;
 IF (SELECT count(*) FROM public.users)<>4 OR (SELECT count(*) FROM auth.users)<>4 THEN RAISE EXCEPTION 'Expected exactly four approved QA profiles and Auth users';END IF;
 IF (SELECT count(*) FROM public.users p JOIN auth.users a ON a.email=p.email WHERE a.email_confirmed_at IS NOT NULL AND p.email LIKE '%@qa.example.invalid')<>4 THEN RAISE EXCEPTION 'Approved confirmed synthetic QA Auth mapping is incomplete';END IF;
 IF EXISTS(SELECT 1 FROM public.users p JOIN auth.users a ON a.email=p.email WHERE p.auth_user_id IS NOT NULL AND p.auth_user_id<>a.id) THEN RAISE EXCEPTION 'Existing Auth identity cannot be reassigned';END IF;
 UPDATE public.users p SET auth_user_id=a.id FROM auth.users a WHERE a.email=p.email AND p.auth_user_id IS NULL;
END $$;
