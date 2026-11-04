# Combined release candidate — 2026-11-04

Status: locally integrated and validated; **not deployed**. Production database migration and authenticated browser verification are pending because Chrome automation cannot read or control the signed-in Supabase tab. No production SQL, Vercel candidate/promotion, paid activation, SMS/campaign dispatch, or new native upload was performed.

The exact serving baseline was `dpl_AxfeLKBrbaUcgTMNTZu2otekuLFp`, source commit `2844e9c3fd047bc9fc2969322be10bfaa388a360`. All 4,067 deployed source files were checked against Vercel SHA-1 and retained-source SHA-256 before assembly. The canonical checkout was not modified.

The candidate combines membership affiliation and shared salon labels, Today forum preview, booking reward estimates, Settings save clearance, and the reviewed external Market portal foundation. The newer deployed ticket toolbar was preserved. Initial four salon-label adapters were superseded by the reviewed universal patch. Existing check-in, identity verification, LUMI Truth, financial behavior and first-party membership authority remain authoritative. External paid commerce remains gated; no plan, price, subscription or enrollment was activated.

Assembly found incomplete Market event deltas. Missing transitive files and seven foundational migrations were recovered from immutable commit `0eae687` and the reviewed 337-file checkpoint, checking both receipt hashes and normalized Git blob equality. Shared production files were merged rather than replaced. The 10 later Market migrations passed their frozen checksum checkpoint.

Native baseline is the actually uploaded version 1.0.0 build 92, source `7ece58d03fea9cd48378eda5b4e50da2ed4f0ff1`. Its prompt/cache correction was preserved. New affiliation lookups use an explicit scoped, cancellable, non-retained native read delegating to the same HTTP handler. A new native bundle/build is required and has not been uploaded. No physical iPhone acceptance is claimed.

Validation on the assembled source:

- Fresh `npm ci`, TypeScript check, production Next build and offline asset generation passed.
- Membership, scope/HTTP/native, admin/credit and Forum tests: 45 passed, no skips.
- Market authorization, version/publication continuity, synthetic isolation, revocation, runtime budgets and refresh retry tests: 30 passed, no skips.
- Full isolated PostgreSQL 17 migration replay plus booking reward lifecycle: 8 passed, no skips; temporary test resources cleaned up. Earlier failed assembly runs remain in evidence.
- Loopback built-page smoke checks returned HTML for `/membership`, `/admin/membership`, `/developer-platform`; invalid affiliation input returned 400. HTML responses do not establish authenticated Admin acceptance.

Detailed evidence is retained at `artifacts/combined-release-20261104/`: exact-baseline.json, assembly.json, resolution.json, dependencies.json, market-foundation-dependencies.json, queue-reconciliation.json, build-final.log, membership-and-forum-final.log, market-tests-final.log, reward-sql-final.log, sql-fixture-final/, native-transport-tests.log and local-smoke.json.

The 117 pending records were retained: 8 selected for integration, 11 unfinished/blocked, 2 design references, and 96 historical records needing revision-level reconciliation. Historical records were not silently marked published. This candidate is not a claim that every old queue item has shipped.

Resume by reacquiring the shared lock, reading current alias and pending journal again, reconciling any baseline movement, inspecting the production migration ledger and exact SQL checksums, then applying only approved missing migrations. Complete authenticated responsive browser checks, freeze and deploy a candidate, verify deployed source hashes, run `verify-production-base.mjs` immediately before promotion, verify live, record exact web events, and finish the required native build/upload/Apple verification. Preserve the user's existing SQL editor draft.
