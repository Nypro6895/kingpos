# Verified account sessions

This patch requires `20261119200000_verified_account_sessions.sql` before the
matching web server is activated. Missing schema is unavailable, never a grant.
It does not deploy itself or change the live provider from a local test.

The signed Supabase JWT's `session_id` and the matching `auth.sessions` row are
authoritative. The old device cookie is optional display metadata. Revoking a
bound device atomically records the event, revokes its database grant and removes
its provider session and refresh tokens. Existing access JWT signatures remain
cryptographically valid until expiry; PostgREST and restrictive RLS reject their
private access because that provider session no longer exists.

## Before applying the migration

- Capture the production source/schema baseline and complete the normal release
  gates. Inventory the effective PostgREST `db-pre-request`, `db-pre-config`,
  `db-config` and external/environment overrides. The migration preserves the
  existing database-configured pre-request hook and calls it under the original
  caller role. An external/pre-config hook that is invisible to the migration
  must be explicitly integrated and verified before publication; do not silently
  replace it. `db-config` must be enabled.
- Confirm the provider's `auth.sessions` and `auth.refresh_tokens.session_id`
  contract using the deployed provider version. No auth schema is modified.
- Count legacy ambiguity before applying. Old device IDs were unsigned and cannot
  securely identify the provider token for a past revocation. Existing provider
  sessions of users with any unbound revoked device history require a fresh
  credential login. Other live sessions are adopted without trusting that cookie.
  Report the affected count and preserve drafts; if the inventory effectively
  implies an unintended global sign-out, resolve that rollout decision first.
  No passwords, user drafts, or live provider sessions are deleted by migration.

Read-only aggregate inventory before migration (no user identities):

```sql
select count(*) as existing_provider_sessions,
  count(distinct s.user_id) as existing_provider_users,
  count(*) filter(where exists(
    select 1 from public.account_login_sessions a
    where a.auth_user_id=s.user_id and a.revoked_at is not null
  )) as sessions_needing_fresh_login,
  count(distinct s.user_id) filter(where exists(
    select 1 from public.account_login_sessions a
    where a.auth_user_id=s.user_id and a.revoked_at is not null
  )) as users_needing_fresh_login
from auth.sessions s;

select r.setdatabase,setting
from pg_db_role_setting r cross join lateral unnest(r.setconfig) setting
where r.setrole=(select oid from pg_roles where rolname='authenticator')
  and (setting like 'pgrst.db_pre_request=%'
    or setting like 'pgrst.db_pre_config=%'
    or setting like 'pgrst.db_config=%');
```

Only inspect the relevant `pgrst.db_pre_request`, `pgrst.db_pre_config`, and
`pgrst.db_config` values; do not export unrelated provider settings or secrets.

## Acceptance after migration, before public promotion

- Read back the database-specific authenticator setting, preserved prior hook,
  restrictive policies and provider configuration. Reload config/schema by the
  supported PostgREST channel and prove the effective hook runs using dedicated
  synthetic acceptance identities. A SQL setting alone is insufficient evidence.
- With two devices for one synthetic account, revoke A from B. A's still-valid
  JWT must fail an app route, direct table read, a SECURITY DEFINER RPC and private
  Storage read; A cannot refresh. B's JWT and refresh must still work.
- Remove/swap the tracking cookie: it must not restore A. Direct table insertion,
  rebinding, or clearing `revoked_at` must fail. An unrelated account cannot revoke
  either device. Fresh login after a legacy denial must work without erasing draft
  state or silently re-enrolling the denied session.
- Anonymous public assets and service maintenance retain their existing access.
  New row-secured tables introduced by later migrations must retain the restrictive
  session policy; the PostgREST guard also protects new REST endpoints.
- Exercise existing web and native cookie/Bearer entry, refresh, logout, MFA and
  password/recovery paths. Never use a User-Agent exemption. Browser cookie refresh
  credentials cannot be combined with a different asserted Bearer identity.

The restrictive policy uses a stable SELECT initplan per SQL statement. Request
validation sharing remains limited to the current read request; there is no
cross-request success cache or grace period for a known revocation.
Normal app admission uses the stable session-state RPC via GET, retaining the
existing bounded safe-read transport. Missing display bindings are enrolled only
for an explicit security/current-device operation, with a deadline and no retry.

Existing Realtime broadcast sockets/topics may already hold provider-side
authorization. The migration does not claim to immediately disconnect those
sockets or erase data already delivered to a device. Verify provider-specific
topic reauthorization/disconnect behavior separately before claiming that scope.
Public content, previously downloaded files and previously issued signed download
URLs also retain their existing delivery/expiry semantics.

## Local evidence

`tests/security-account-sessions.integration.test.mjs` checks scoped adoption,
revocation, direct RLS, immutability, isolation, and hook preservation in PGlite.
`tests/security-session-validation.test.mjs` checks both app auth paths, cookie
tampering and unavailable/rejected states. The opt-in
`tests/security-sessions.full-schema.test.mjs` replays the complete schema with
isolated real Auth, PostgREST and Storage providers. It sends no messages and
publishes no host ports; fixture cleanup removes only its own labeled containers.

Provider reference: [PostgREST configuration](https://docs.postgrest.org/en/stable/references/configuration.html#db-pre-request).
