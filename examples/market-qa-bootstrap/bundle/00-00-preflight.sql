-- Review artifact only. Requires a NEW empty QA project and explicit operator
-- choice. Never run on Reylumi production or an existing app database.
DO $$ BEGIN
 IF current_setting('reylumi.qa_bootstrap',true) IS DISTINCT FROM 'synthetic-only-reviewed' THEN
  RAISE EXCEPTION 'Explicit reviewed synthetic QA bootstrap marker required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','v','m','f')) OR to_regnamespace('qa_bootstrap') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qr_menu_qa_runtime')
 OR to_regclass('public.users') IS NOT NULL OR to_regclass('public.locations') IS NOT NULL
    OR to_regnamespace('market_platform') IS NOT NULL OR to_regnamespace('qr_menu_private') IS NOT NULL THEN
  RAISE EXCEPTION 'QA bootstrap requires an empty application database';
 END IF;
 IF to_regclass('auth.users') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
  RAISE EXCEPTION 'Provider-managed Auth prerequisites are missing';
 END IF;
END $$;
