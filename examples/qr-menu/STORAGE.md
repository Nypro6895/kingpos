# Durable QR backend setup and recovery

Hosted TOTP MFA uses a separate encrypted pending table with revision fencing.
See MFA.md and the review-only mfa-storage-upgrade.sql for existing private
three-table installations. App-session/grant encryption contexts are distinct;
pending AAL1 data cannot become a full session by copying a row.

## Backend integration contract

`server.mjs` remains the real HTTP/QR implementation. Import it from your hosting
entrypoint; do not deploy the demo CLI with in-memory state. Hosted origins and
NODE_ENV=production refuse startup without the branded PostgreSQL adapter,
secure cookies and an authenticated `ownerIdentity(req)` function.

```js
import { createQrMenuApp } from './server.mjs';
import { createPostgresStore } from './postgres-store.mjs';

// Inject an existing restricted SQL pool and keys from YOUR backend secret
// manager. No database URI, key or provider account is provisioned here.
export function createHostedServer({ pool, encryptionKeys, activeKeyId,
  api, clientId, clientSecret, publicOrigin, authenticatedOwnerId }) {
  const store = createPostgresStore({
    query: (sql, parameters) => pool.query(sql, parameters),
    keys: encryptionKeys, activeKeyId,
    binding: { api, clientId, publicOrigin },
  });
  return createQrMenuApp({ api, clientId, clientSecret, publicOrigin,
    store, secureCookie: true, ownerIdentity: authenticatedOwnerId });
}
```

The driver must implement a PostgreSQL `query(sql, parameters)` returning
`{ rows }` with committed single-statement operations, using the primary writer
(no lagging replica or transaction wrapper spanning unrelated requests). Configure
TLS, connection/query/statement/lock timeouts and a bounded pool at the host.
Apply `storage.sql` manually to the plugin-owned database through your normal
reviewed migration process. Runtime never creates tables or modifies Reylumi's
schema. Use a backend role restricted to SELECT/INSERT/UPDATE on this table;
prevent all public/browser access. No `pg` connection or cloud service is
silently created by this example.

`ownerIdentity` must verify YOUR app's signed-in session on every connect,
callback and manage request and return a stable opaque subject, or reject/return
null. Never return a URL/header-provided user ID without authenticating it. It
must not redirect, write the response or create a new user. Reylumi OAuth grants
salon API access; it does not supply SSO or ownership of your hosting account.
Public menu/QR/media requests do not need an app login. Hosted cookies use
`__Host-qr_owner; Secure; HttpOnly; SameSite=Lax; Path=/`, with no Domain attribute.
Do not log callback query strings, request headers, cookies or provider bodies at
the proxy, runtime, SQL driver or error collector. Preserve the approved HTTPS
origin and `/connect` path; a changed origin needs a newly reviewed manifest.

## Encryption and isolation

The host injects a key ring of 32-byte Buffers and an active key ID. There is no
fallback/generated key, env-file writer or plaintext persistence. AES-256-GCM
uses a fresh 96-bit nonce, authentication tag and additional authenticated data
binding the exact API origin, app ID, public origin and SQL revision. The entire
session/PKCE/grant/routing snapshot, including installation, salon and version,
is encrypted; only the hashed context ID, revision, lease UUID/expiry and key ID
are visible to SQL. Key material never enters SQL, HTML, URLs, QR or artifacts.

Keep old key IDs available during rotation: the next successful request reads
with the previous key and rewrites with the active key. Remove an old key only
after proving no active snapshots/backups still require it. Missing/wrong keys,
a tampered envelope/revision, missing schema/SQL failures or wrong app/origin
fail closed. Back up encrypted data and keys separately and verify restoration.
A database snapshot rollback can reintroduce old rotating credentials: after a
restore, clear active sessions/grants through a reviewed reconnect process;
do not blindly resume OAuth refresh from an old backup.

## Concurrency and interrupted requests

Public menu/QR/image requests read a committed encrypted snapshot without taking
the writer lease or rewriting the state. Each response still fetches current
scoped data from Market; no stale data cache bypasses unpublish or revoke.
The primary database is required; a lagging replica is not supported.

Credential/session changes still serialize for one app/origin with one atomic
SQL lease (60 seconds). A public request that needs token refresh retries under
that writer lease; it never refreshes from an unlocked snapshot. While a known
refresh is in progress the affected menu is temporarily unavailable (503), rather
than being permanently disconnected. An expired/abandoned uncertain refresh
requires reconnect. The claim and every write check lease owner, expiry and
revision. Busy writers receive 503; there is no unbounded queue. Different
app/origin contexts are isolated. SQL leases use database time; session expiry
uses that time plus monotonic elapsed request time. Write responses, cookies and
redirects are buffered until the final fenced write succeeds. Public reads do not
write cookies or persist session cleanup. Snapshot decryption remains bounded to
4 MiB; this does not claim unlimited capacity or hosted load acceptance.
A stale worker cannot overwrite a newer worker or flush success after losing its
lease. Lease expiry is recovery, not permission to repeat an external write.

Before authorization-code exchange, the callback removes its state and PKCE
verifier and commits that consumption. Wrong/expired state, wrong authenticated
principal, changed connection generation or replay makes no token exchange.
A newly connected generation invalidates earlier manage sessions and pending
callbacks for that installation. The public menu ID remains stable.

Before rotating a refresh token, the backend commits an uncertainty marker and
a fresh request UUID/retry key in encrypted state. The platform accepts the same
exact client/old-refresh/request/retry-key tuple for at most 120 seconds and
returns the original encrypted token pair; the QR backend retries for at most
90 seconds. It does not issue another pair. The retry key is never stored in
plaintext on the platform. Current client generation, installation, grants,
publication authority and sandbox epoch still apply; revoke never becomes grace.
A lost provider response or final SQL acknowledgement can therefore recover
across instances/restarts using the same attempt. Legacy uncertainty without a
receipt, a definite denial, or an expired retry window requires Owner reconnect.
The stable public menu ID is retained. Each public read still calls current
Market APIs; no stale salon-data cache is introduced. Apply the Market refresh
receipt migration before using this reference; there is no legacy retry fallback.

For busy requests: wait, then retry the read. For reconnect-required requests:
Owner selects the current salon in Market and opens the installed approved app
again. No token copy/paste is involved. Missing configuration/key/database must
be repaired by the developer before reconnecting. Revoke/uninstall continues
to deny API access, including saved public QR URLs.

## Verification and remaining host acceptance

From the Reylumi source checkout:
`node --test tests/qr-menu-durable.test.mjs tests/qr-menu-example.test.mjs tests/qr-menu-sandbox.test.mjs`.
Tests use synthetic API responses, ephemeral PGlite PostgreSQL SQL, independent
adapter/HTTP instances and a disk fixture closed/reopened with the test key kept
only in memory. They exercise encryption, tamper/key/binding failures, atomic
lease contention/fencing, replay, expiry, principal/salon/version isolation,
refresh loss and restart. The disk fixture is a TEST database, not a production
file-store adapter. PGlite serializes SQL execution; this does not establish
real PostgreSQL multi-connection, failover, load or serverless acceptance.

Before any release, separately validate actual managed PostgreSQL durability and
permissions, connection-pool behavior under competing processes, runtime lifetime,
HTTPS/cookies/redirects, your app authentication, secret-manager/key rotation,
restore/reconnect runbook, publication/revoke, provider sandbox and load limits.
No hosting, keys, resources, payments or production changes have been created.

References: PostgreSQL row locking
https://www.postgresql.org/docs/current/explicit-locking.html
and Node authenticated encryption APIs https://nodejs.org/api/crypto.html.

## Serverless/private-schema follow-up

The sample now includes `api/index.mjs`, `serverless.mjs`, verified QA app login
and qualified `qr_menu_private` storage. See `HOSTED.md` for exact QA config,
per-request pool disposal, Auth session expiry/revoke and still-unverified hosted
acceptance. `storage.sql` is a fresh private-schema artifact, not an automatic
copy of an older public store. No hosted state migration has been performed.
