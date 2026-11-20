-- Optional reviewed upgrade for an existing private QR store. No cloud executor.
-- No Auth account, factor, password, key or session is created.
BEGIN;
DO $$ BEGIN
 IF to_regclass('qr_menu_private.qr_auth_sessions') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='qr_menu_qa_runtime') THEN
  RAISE EXCEPTION 'Reviewed existing private QR storage/runtime role required';
 END IF;
END $$;
CREATE TABLE qr_menu_private.qr_mfa_pending (
 context_id text NOT NULL CHECK(length(context_id)=64),
 cookie_hash text NOT NULL CHECK(length(cookie_hash)=64),
 revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0),
 phase text NOT NULL DEFAULT 'ready' CHECK(phase IN('ready','busy','consumed','canceled')),
 envelope jsonb,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 challenges integer NOT NULL DEFAULT 0 CHECK(challenges BETWEEN 0 AND 5),
 PRIMARY KEY(context_id,cookie_hash),
 CHECK((phase IN('ready','busy') AND envelope IS NOT NULL) OR (phase IN('consumed','canceled') AND envelope IS NULL))
);
REVOKE ALL ON qr_menu_private.qr_mfa_pending FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON qr_menu_private.qr_mfa_pending TO qr_menu_qa_runtime;
COMMIT;
