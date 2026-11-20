-- Optional READ-ONLY security contract. Not an upgrade or cloud executor.
DO $$ BEGIN
 IF current_setting('reylumi.qa_security_bootstrap',true) IS DISTINCT FROM 'read-only-contract-reviewed' THEN
  RAISE EXCEPTION 'Explicit read-only security contract marker required';
 END IF;
 IF to_regclass('qa_bootstrap.marker') IS NULL THEN
  RAISE EXCEPTION 'Fresh synthetic Market contract foundation required';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM qa_bootstrap.marker WHERE scope='synthetic-market-contract-only') THEN
  RAISE EXCEPTION 'Fresh synthetic Market contract foundation required';
 END IF;
 IF EXISTS(SELECT 1 FROM public.users WHERE auth_user_id IS NOT NULL) OR
    EXISTS(SELECT 1 FROM auth.users) OR
    (SELECT count(*) FROM public.users)<>4 OR
    EXISTS(SELECT 1 FROM public.users WHERE (id,email,display_name,status) NOT IN (
      ('10000000-0000-4000-8000-000000000001'::uuid,'owner@qa.example.invalid','Synthetic salon Owner','active'),
      ('10000000-0000-4000-8000-000000000002'::uuid,'developer@qa.example.invalid','Synthetic developer','active'),
      ('10000000-0000-4000-8000-000000000003'::uuid,'reviewer@qa.example.invalid','Synthetic reviewer','active'),
      ('10000000-0000-4000-8000-000000000004'::uuid,'other@qa.example.invalid','Synthetic other salon Owner','active'))) OR
    (SELECT count(*) FROM public.accounts)<>2 OR
    EXISTS(SELECT 1 FROM public.accounts WHERE (id,name,status) NOT IN (
      ('20000000-0000-4000-8000-000000000001'::uuid,'Synthetic QA salon account A','active'),
      ('20000000-0000-4000-8000-000000000002'::uuid,'Synthetic QA salon account B','active'))) OR
    (SELECT count(*) FROM public.locations)<>2 OR
    EXISTS(SELECT 1 FROM public.locations WHERE (id,account_id,name,status) NOT IN (
      ('40000000-0000-4000-8000-000000000001'::uuid,'20000000-0000-4000-8000-000000000001'::uuid,'Synthetic QA salon A','active'),
      ('40000000-0000-4000-8000-000000000002'::uuid,'20000000-0000-4000-8000-000000000002'::uuid,'Synthetic QA salon B','active'))) OR
    (SELECT count(*) FROM public.roles)<>2 OR
    EXISTS(SELECT 1 FROM public.roles WHERE (id,account_id,code) NOT IN (
      ('30000000-0000-4000-8000-000000000001'::uuid,'20000000-0000-4000-8000-000000000001'::uuid,'OWNER'),
      ('30000000-0000-4000-8000-000000000002'::uuid,'20000000-0000-4000-8000-000000000002'::uuid,'OWNER'))) OR
    (SELECT count(*) FROM public.account_memberships)<>2 OR
    EXISTS(SELECT 1 FROM public.account_memberships WHERE (account_id,user_id,role_id,status) NOT IN (
      ('20000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'active'),
      ('20000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000004'::uuid,'30000000-0000-4000-8000-000000000002'::uuid,'active'))) OR
    EXISTS(SELECT 1 FROM public.salon_profile_media_assets) OR
    EXISTS(SELECT 1 FROM qa_bootstrap.financial_admins) OR
    (SELECT count(*) FROM market_platform.settings)<>1 OR
    EXISTS(SELECT 1 FROM market_platform.settings WHERE enabled OR commerce_test_enabled OR commission_bps IS NOT NULL) OR
    EXISTS(SELECT 1 FROM market_platform.installations) OR
    EXISTS(SELECT 1 FROM market_platform.organizations) THEN
  RAISE EXCEPTION 'Security contract requires untouched synthetic fixture data and disabled features';
 END IF;
 IF to_regclass('qa_bootstrap.security_read_contract') IS NOT NULL OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f') AND c.relname NOT IN
       ('users','accounts','roles','account_memberships','locations','salon_profile_media_assets')) OR
    to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
  RAISE EXCEPTION 'Security contract refuses reapply, pre-existing helpers or unrelated application data';
 END IF;
END $$;
