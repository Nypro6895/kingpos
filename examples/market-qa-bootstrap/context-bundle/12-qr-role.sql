-- This role has NOLOGIN. A later separately authorized provider setup may enable
-- its QA-only login via the provider's secure channel; no password is in SQL.
CREATE ROLE qr_menu_qa_runtime NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA qr_menu_private TO qr_menu_qa_runtime;
GRANT SELECT,INSERT,UPDATE ON qr_menu_private.qr_menu_state,qr_menu_private.qr_auth_sessions,qr_menu_private.qr_auth_limits,qr_menu_private.qr_mfa_pending TO qr_menu_qa_runtime;
-- Qualified table names mean no runtime search_path dependency.
-- No DELETE/TRUNCATE/DDL/Market/Auth/Storage/service-role grants.
