-- The earlier15 context fragments are part of the same fresh transaction.
DO $$ BEGIN
 IF current_setting('reylumi.qa_login_bootstrap',true) IS DISTINCT FROM 'canonical-login-gate-reviewed' THEN
  RAISE EXCEPTION 'Explicit canonical login-gate QA marker required';
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users) OR EXISTS(SELECT 1 FROM public.users WHERE auth_user_id IS NOT NULL) OR
    EXISTS(SELECT 1 FROM market_platform.settings WHERE enabled OR commerce_test_enabled OR commission_bps IS NOT NULL) THEN
  RAISE EXCEPTION 'Fresh unbound context and disabled feature/finance required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'abuse_%') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'abuse_%') THEN
  RAISE EXCEPTION 'Existing abuse objects refused; no replacement or policy overwrite';
 END IF;
END $$;
