# Session denial retention and account erasure

`20261119203000_session_denial_account_erasure.sql` adds one validated foreign
key from the private denial table's `auth_user_id` to `auth.users(id)` with
`ON DELETE CASCADE`. It changes no grants, session-admission function, business
calculation, UI, or provider configuration. The 452 inherited migrations remain
unchanged.

Denials remain while the Auth account exists, including during the earlier
personal-content erasure phase. Actual Auth hard deletion removes only that
account's denial rows. An old JWT still fails because its authoritative provider
session no longer exists. This avoids keeping account-linked denial identifiers
after completed Auth erasure without weakening an active revocation.

The migration validates all existing references. Orphan rows cause a transaction
failure; it neither silently deletes them nor accepts an unvalidated constraint.
Resolve an unexpected production orphan explicitly before release.

The opt-in test `tests/session-denial-account-erasure.full-schema.test.mjs`
starts a new isolated real Auth/PostgREST/Storage fixture on a byte-identical 452
baseline, seeds two synthetic accounts and real revocations, then applies 453.
It checks validation rollback, existing-row preservation, unchanged private ACLs,
actual Auth API hard deletion and scoped cascading cleanup, continued rejection
of revoked/deleted JWTs on a private table/Storage/definer RPC/enrollment,
orphan-insert denial, and the other account's access and refresh. The fixture
uses cached images, no network egress or published host ports, and cleans only
its own labeled containers. No production or physical-device acceptance is
implied. Run it explicitly with `RUN_ISOLATED_SUPABASE=1` and record the receipt.

The local run passed all 12 assertions with no skips; its acceptance and owned
container cleanup receipts are under the coordinator's separate
`artifacts/combined-release-20261119-next/session-denial-erasure-r1/run-r1/`.

The combined production plan must include all 25 selected migrations against the
authenticated production baseline, with a fresh 453-source rehearsal and provider
hook/session acceptance. Earlier 22/24-migration evidence remains bounded to its
original inputs and cannot stand in for that final rehearsal.
