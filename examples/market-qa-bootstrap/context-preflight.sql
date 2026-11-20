-- Fresh disposable synthetic context contract only. No connection/executor.
DO $$ BEGIN
 IF current_setting('reylumi.qa_context_bootstrap',true) IS DISTINCT FROM 'canonical-context-reviewed' THEN
  RAISE EXCEPTION 'Explicit canonical-context QA marker required';
 END IF;
 IF current_setting('reylumi.qa_bootstrap',true) IS DISTINCT FROM 'synthetic-only-reviewed' THEN
  RAISE EXCEPTION 'Explicit synthetic QA marker required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f')) OR
    to_regnamespace('qa_bootstrap') IS NOT NULL OR to_regnamespace('market_platform') IS NOT NULL OR
    to_regnamespace('market_private') IS NOT NULL OR to_regnamespace('qr_menu_private') IS NOT NULL OR
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qr_menu_qa_runtime') OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')) OR
    to_regprocedure('public.current_public_user_id()') IS NOT NULL OR to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
  RAISE EXCEPTION 'Context QA bootstrap requires empty application DB; reapply is refused';
 END IF;
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('auth.role()') IS NULL THEN
  RAISE EXCEPTION 'Provider-managed Auth uid/role prerequisites required';
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users) THEN RAISE EXCEPTION 'Context QA bootstrap refuses existing Auth users'; END IF;
END $$;
