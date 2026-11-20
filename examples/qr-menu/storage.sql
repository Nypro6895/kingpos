-- Plugin-owned PostgreSQL database only. Never apply to Reylumi production.
-- The hosting backend supplies a restricted role with SELECT/INSERT/UPDATE on
-- this table; no public/browser access, no automatic DDL at runtime.
CREATE SCHEMA qr_menu_private;
REVOKE ALL ON SCHEMA qr_menu_private FROM PUBLIC;
CREATE TABLE qr_menu_private.qr_menu_state (
  context_id text PRIMARY KEY CHECK (length(context_id) = 64),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  envelope jsonb,
  lease_owner uuid,
  lease_until timestamptz
);

CREATE TABLE qr_menu_private.qr_auth_sessions (
  context_id text NOT NULL CHECK (length(context_id)=64),
  cookie_hash text NOT NULL CHECK (length(cookie_hash)=64),
  envelope jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (context_id,cookie_hash)
);
REVOKE ALL ON ALL TABLES IN SCHEMA qr_menu_private FROM PUBLIC;
CREATE TABLE qr_menu_private.qr_auth_limits (
 context_id text PRIMARY KEY CHECK(length(context_id)=64),
 window_start timestamptz NOT NULL,
 attempts integer NOT NULL CHECK(attempts between 1 and 20)
);
REVOKE ALL ON qr_menu_private.qr_auth_limits FROM PUBLIC;
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
