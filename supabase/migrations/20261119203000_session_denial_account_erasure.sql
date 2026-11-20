-- A denial remains authoritative while its Auth account exists. Once Auth
-- hard-deletes that account, its provider sessions are gone and the denial's
-- account-linked identifiers no longer need to outlive that account.
-- Validate existing rows; an orphan must fail this migration, never be purged
-- silently or accepted with an unvalidated constraint.
begin;

alter table reylumi_security.denied_legacy_sessions
  add constraint denied_legacy_sessions_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

commit;
