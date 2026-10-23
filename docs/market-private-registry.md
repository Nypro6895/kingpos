# Private Market metadata review

This slice is isolated from the existing Market catalog and billing. It adds a private developer workflow at `/developers/market` and a separate reviewer workflow at `/market-review`. It does not publish apps, install anything, grant capabilities, launch executable content, issue runtime tokens, or change payments/native behavior.

## Access and deployment boundary

The application flag `MARKET_PRIVATE_REGISTRY_ENABLED` defaults off. Every database RPC also checks `market_private.settings.enabled`, which the additive migration initializes to false. A flag alone does not grant access: an active publisher owner or independently allowlisted reviewer must also be an active existing public user. Pending-deletion, inactive, suspended and deleted users are denied. No public provisioning or permission-grant RPC exists. The migration creates no publisher/reviewer grants, and no production configuration is changed by tests.

The reviewer allowlist is independent from platform administration. Reviewers gain no financial permissions; platform-owner status alone grants no registry access. Publishers cannot review their own apps. User identity is resolved from the authenticated database session, never a submitted publisher/user ID. The web layer creates a fresh authenticated client for each request; it never uses service-role access.

The `market_private` schema and its tables/helpers are inaccessible to public, anonymous and authenticated direct queries. Only six authenticated RPCs expose bounded workflow operations. The selected access pattern combines explicit grants, RLS with no direct policies, fixed function search paths and authorization inside each security-definer RPC.

## Lifecycle and integrity

Draft save creates a server UUID and generated `external-<UUID>` registry key. Client-chosen slugs, first-party identity and publisher assignment are not accepted. Existing first-party IDs/handlers are never mapped from these records. Each subsequent save checks the expected draft revision and increments it.

Submission freezes the saved revision. A pending submission prevents editing; a publisher may withdraw it. Review accepts the exact submission ID, expected revision and hash. A decision and its append-only event commit atomically. Conflicting decisions fail; an exact replay returns the existing outcome. Rejected, withdrawn or metadata-approved details can be revised through another save, preserving prior submissions. Approval means `metadata_approved`, never published/installable.

Deterministic registry conflicts use `PT409`, which PostgREST returns as HTTP 409. They do not use PostgreSQL's retryable serialization-failure code `40001`: PostgREST 14.5 can retry that code indefinitely. The web layer also handles genuine database serialization failures safely. This change applies only to the new registry; existing billing RPC behavior is preserved. See [PostgREST custom errors](https://docs.postgrest.org/en/v14/references/errors.html#raise-errors-with-http-status-codes) and [the upstream retry issue](https://github.com/PostgREST/postgrest/issues/3673).

The strict manifest admits exactly `manifestSchemaVersion: 1`, `appVersion`, `displayName`, `description` and `requestedCapabilities: []`. No URL, image, HTML execution or remote fetch is supported. Strings are normalized to NFC and bounded; versions use SemVer syntax with a 64-character maximum. App names are limited to 100 Unicode code points and descriptions to 2,000. The database independently validates every manifest; client validation provides early feedback only.

Canonicalization identifier `reylumi-manifest-pg-jsonb-v1` means: validate admitted fields, trim specified Unicode whitespace, NFC-normalize string values, serialize the resulting JSONB using PostgreSQL `jsonb::text`, then SHA-256 its UTF-8 bytes. The exact canonical text and hash are retained with the submission. This is not an RFC8785/SDK serializer, and client hashes are never accepted. The hash covers metadata only; it is not executable-code approval.

Descriptions and review reasons render as escaped React text. Controlled form fields retain unsaved content after failed actions. Submitted content is read-only, with explicit revision history and review differences. These new routes are outside both existing offline HTML allowlists; no broader offline/native policy was modified.

## Account erasure

Two additive triggers on `public.users` handle the existing status-to-deleted transition and physical deletion without modifying the erasure cron. They operate only on new registry records: publisher ownership/name, draft content, submitted manifest/canonical text and review reasons are scrubbed. Access is revoked. Minimal IDs, hashes, times and outcomes remain for review integrity; no contact fields or raw manifest are copied into events. Foreign keys use SET NULL for user deletion.

Submitted records/outcomes/events reject ordinary updates/deletes. A narrowly limited nested-trigger path permits erasure tombstones and FK nulling. The tests exercise erasure through actual user transitions as well as direct attempts to forge an immutable-record update. When a reviewer is erased, an active publisher sees a neutral reason-removal message while the decision remains in history.

## Local verification

Use the existing installed dependency versions; no new package is needed. The working baseline is commit `2638cb272d3a13d872f9ea0bebbf2f0fba85ed2d`, with no dirty-root product overlays. Test-only legacy fixtures were copied with recorded hashes to verify unchanged Market behavior.

Run:

```text
node --test tests/market-registry-boundary.test.mjs
node --test tests/market-registry.integration.test.mjs
node --test tests/market-registry-ui.test.mjs
node --test tests/isolated-supabase-fixture.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build --webpack
node scripts/build-offline-assets.mjs
```

Boundary tests bundle the real validator/DAL/actions with only auth/cache framework boundaries replaced. SQL tests execute the new migration with real roles and identity mapping in PGlite, alongside existing financial migration fixtures. Browser tests use the real components and synthetic persistence, with external requests blocked. These layers do not individually establish real Supabase/Next end-to-end authentication.

The opt-in `tests/market-registry.fullstack.test.mjs` uses the existing isolated Supabase helper to replay the complete migration directory, create throwaway local accounts, test direct PostgREST and concurrent reviews, then remove only owned test containers. It requires the local Docker engine and already cached images. It uses no published host ports, external network or production credentials. Enable it only for an explicitly intended local test run with `RUN_MARKET_REGISTRY_FULLSTACK=1`.

For this Market run, the fixture explicitly normalizes CRLF to LF in SQL input and inserts a statement separator before its transaction wrapper commits. It records each original file hash, executed source hash and complete submitted-script hash; repository migrations remain unchanged. This accommodates existing function-definition patch guards and an existing file whose final statement ends at EOF. The fixture's default mode retains raw line endings and its original two-field migration receipt entries. Mocked regression tests cover both modes and failed-start cleanup.

Each temporary container has a verified memory and CPU limit: PostgreSQL 512 MiB, Auth 128 MiB, Storage 192 MiB and PostgREST 128 MiB; each has one CPU and no extra swap allocation. These are container limits, not host or Docker settings. Cleanup verifies task ownership, no persistent mounts or published ports, removes only the named test containers, and confirms previously running container IDs remain running. A successful test requires successful cleanup and no test-container OOM kill.

After the production build, `RUN_MARKET_REGISTRY_ROUTES=1 node --test tests/market-registry-routes.test.mjs` starts local Next processes with a sanitized environment. It checks both runtime flag values, signed-out responses, absence of editing fields, and private/no-store headers. It does not simulate a signed-in Next session.

Validation on 2026-10-22 passed 60 unchanged legacy tests, 30 new boundary/SQL tests, the browser workflow test, all three built-route checks, and 14 mocked fixture regression tests. After the user opened Docker, full-stack run 4 passed all 287 migrations and real GoTrue/PostgREST save/reload, review, authorization and erasure checks. Two review transactions were simultaneously observed waiting on the app row; they returned one success and one HTTP 409, leaving exactly one decision and one review event. Retrying the winner returned the same outcome. Cleanup removed four owned temporary containers, reported no OOM or cleanup errors, and preserved all 11 previously running container identities.

The preceding failed attempts remain recorded: the first two exposed SQL input line-ending/framing issues in the test loader; the third applied every migration but exposed the registry's inappropriate use of retryable `40001` for a terminal business conflict. Run 4 tested the corrected `PT409` behavior without editing any existing migration or billing module. Scoped ESLint, TypeScript and the production/offline-asset build passed after the conflict fix. The first build attempt encountered a local generated-directory EPERM error; the approved build retry outside the sandbox passed with the same sanitized environment. Browser persistence remains synthetic, and signed-in Next-to-Supabase browser behavior is not established by the separate component, route and API layers.

Do not infer deployment readiness from targeted tests. Preserve the complete migration/build results and any environment blockers in the task receipt. This slice is excluded from the separately coordinated release; production application, real publisher grants and later runtime/payment work require their own authorization.
