# Isolated local-quality search measurement

The final baseline must include `20261017040000_explore_unified_query_performance.sql`, the latest committed v3 pull correction. Earlier diagnostic runs omitted that correction because the copied historical fixture stopped at17030000; they are not the final release-source comparison. The correction changes function code only, so existing synthetic sources can be retained while applying it and repeating the matrix. Its exact hash is included in the final report.

`scripts/benchmark-explore-local-quality.mjs` accepts only an owned native PostgreSQL server at `127.0.0.1:55441`; it verifies the server data directory and per-database ownership marker before using it. It never connects to the production database, drops an existing database, or changes shared servers.

The runtime data directory is `work/explore-local-quality-runtime/data`, created for this task with PostgreSQL 17.11 binaries already installed on the workstation. The Node `pg` driver is installed only in that runtime folder. Server settings are 256 MB shared buffers, 8 MB work memory, JIT off, and `pg_stat_statements.track=all`. Source setup has no statement deadline; measured SQL calls have a three-second deadline.

Prepare the synthetic source fixtures, then run baseline measurements before applying the quality migration:

```powershell
node scripts/benchmark-explore-local-quality.mjs --phase=baseline --setup-only=true --output=work/explore-local-quality-evidence/native-bulk-setup.json
node scripts/benchmark-explore-local-quality.mjs --phase=baseline --samples=42 --output=work/explore-local-quality-evidence/native-baseline-corrected-final.json
node scripts/profile-explore-local-quality.mjs --phase=baseline --scale=100000
```

For a fresh target after both migration sources are frozen, apply the unchanged preparation DDL, complete bounded foreground batches, activate, and measure the same sources:

```powershell
node scripts/benchmark-explore-local-quality.mjs --phase=quality --samples=42 --output=work/explore-local-quality-evidence/native-quality-final.json
node scripts/profile-explore-local-quality.mjs --phase=quality --scale=100000
```

The final measured read code uses effective pair `a843ed893cca2279f1d292991483456627947c62bff1dfe884cc2eb1cb8991b3` (main `5ad8295f813199f9eb22791290d2f94b49a18fe039d0433c92369109e396ef11`, preparation `900fda212ed246b481c8f994c43565586d399166b93c1f992c7963461e5b0562`). Its final two expression indexes and five read/activation function definitions are compatible with the already prepared `3a675d19...` projection rows. Those preserved large fixtures use an explicitly recorded QA overlay rather than repeating source setup. The original setup identity remains in `quality_sha`/`quality_setup_sha`; the effective code, exact overlay bytes and compatibility receipt have separate fields. This QA overlay is not a production rollout procedure.

`test-explore-local-quality-native-overlay.mjs` hashes projection/preparation/dirty contents and the revision clock before and after, then compares functions, indexes, columns, constraints, RLS, privileges, source view and triggers with a fresh ten-salon fixture that applies the entire exact final pair and foreground preparation. All three large fixtures match fresh final catalog SHA `ca0212c3e5d7ec5f74be1c89fff2c286225cd2416025223112506143fca669c0`. Content integrity uses counts plus two independent seeded 64-bit row-text hash sums, rather than an adversarial cryptographic proof. Request harnesses verify the saved proof hash and current catalog before using the effective identity.

The million-salon fixture resumes from 253,200 prepared rows using `--resume-preparation=true`; it continues the same bounded product RPC protocol and does not reapply DDL. Its setup duration therefore spans an older exact preparation, a verified compatible read-index overlay, and final-code resumption. These timings must not be called the wall time of a fresh million-row final migration. Fresh full-pair small/rich fixtures provide separate schema/preparation evidence. All original candidate, cancellation, setup and overlay receipts remain distinct.

Default scales are 100,000/500,000/1,000,000 salons; concurrency is 1/8/16 SQL workers. Twenty-one cases cover present/absent one/two-letter name prefixes, exact/fuzzy/missing names, broad category/state/service searches, multiword service and style queries, missing style, dense/sparse/zero regional GPS, explicit Closest/newest, and unsupported Trust fallback. Forty-two sessions give two repetitions of every case per scale/concurrency, with up to two pages per session. This is a bounded regression matrix, not a statistically robust production SLO or online-user capacity estimate. First-page and continuation results are separate. Latency percentiles include successful calls only; failures/timeouts are counted separately with their observed duration.

The fixture contains one reference introduction per salon. Roughly one salon in nineteen has two actual public image-post records and their current media metadata; another salon has twenty actual posts. This gives about 9.5% organic posts, repeated posts per salon, mixed service/style text, and a capped-activity tail. Dense Milwaukee has clustered coordinates, Madison has coordinates on 5% of its rows, Green Bay has none, and Los Angeles supplies distant rows. These are regional distributions in one fixture, rather than three complete-database replicas. No actual image payload is delivered by the SQL harness.

The main scale fixtures have city/state/ZIP profile terms, with phone, street and description fields empty; their presence counts are recorded. Their storage footprint must not be extrapolated to full production profiles. The separate rich-profile fixture supplies phones, streets/suites and longer descriptions, measuring posting fanout, table/index footprint and lookup work. Rejected prototype and interrupted setup artifacts remain diagnostic evidence, separate from the final comparison.

The quality migration pair is `20261119042923_explore_local_quality_search.sql` followed by `20261119052341_explore_local_quality_preparation.sql`. DDL creates empty indexes and keeps new searches on the shipped path until readiness is explicitly activated. The native adapter imports the same foreground operator state machine and calls `get_explore_local_quality_preparation`, `prepare_explore_local_quality_batch(100)` and `activate_explore_local_quality` in separate transactions. Each migration, batch and activation is timed separately; failed/busy work is retained. It deliberately omits the CLI's default 100 ms pauses to measure raw database work and writer interference. At a million salons, 10,000 full batches alone would add about 1,000 seconds of deliberate pauses with that CLI configuration; the native setup time is not a measured operational wall time.

During preparation, a second owned connection samples RowExclusive locks on both canonical history tables and a NOWAIT row lock on the canonical revision clock, then rolls back. These controls record lock availability and distinguish brief DDL access from backfill access. They do not execute source updates or establish sustained committed import throughput. All controls stop before query latency measurement. PostgreSQL DDL still takes schema locks; phased preparation reduces the long backfill lock window rather than making deployment lock free.

A separate matched rollback-only source-profile UPDATE hit a two-second statement deadline on both the corrected 100k baseline and an idle prepared prototype. Both stopped in the shipped `refresh_explore_unified_search` content-source proof, rather than a new preparation lock. `canonical-writer-baseline-control.json` retains the exact error context; the failed first syntax-only diagnostic is also preserved. This is a limitation of the owned minimal synthetic canonical fixture, whose complete production schema/index inventory is not replayed. It does not prove a production writer failure, and lock-control success must not be presented as end-to-end source-write success. A small full-trigger write-pressure gate provides separate bounded evidence.

Setup applies the existing schema migrations while empty, disables all seeded source-table user triggers, bulk loads synthetic sources, then restores those triggers. It bulk seeds the final legacy read-model rows using the exact product source-token/fingerprint functions and shapes. This bypasses old historical upgrades and the all-ID refresh coordinator, whose cost is outside this request benchmark. Secondary legacy projection indexes are rebuilt from the saved exact definitions before measurements. The new quality migration pair and bounded preparation functions execute unchanged against the full populated fixture. Actual incremental trigger semantics have separate integration/high-fanout tests.

Reports include migration/harness hashes, dataset shape, cursor actor/query/version/expiry rejection checks, duplicate/scope/GPS checks, SQL errors/timeouts, projection/index storage, and posting fanout. The profile helper captures nested `auto_explain` plans above a 20 ms threshold, including actual loops, rows, filter rejections, buffers and spill sorts. Those instrumented calls establish plan shape and work, not benchmark latency. Plan node visits can count the same row in several nodes.

The separate generic-name typo pressure gate uses `test-explore-local-quality-native-sorts.mjs --generic-typos-only=true --repeats=16 --scale=1000000`, giving 32 sessions per concurrency level and recording the peak actual first-page concurrency. These `Nailz`/`Naiks Nails` cases retain the shipped fuzzy semantics and can inspect a regional set when signature keys are common. They are additional stress evidence and do not replace any case in the 21-case before/after matrix. No constant-work claim is made for every fuzzy query.

The pending quality migration was renamed from version 20261119010000 to 20261119042923 to avoid another worktree's migration version. A later preparation migration separates DDL, bounded backfill and activation. Between the final baseline and after commands, the baseline source data, existing migration stack, workload, request parameters and measured deadlines are unchanged. Receipt/setup changes archive each file's exact single-read bytes before execution, recording its hash and using the same string for PostgreSQL. The ordered pair identity is SHA256 of `JSON.stringify([{file,sha256},...])`, with canonical repository-relative file names. Native ownership markers, sort and deep-cursor gates compare this combined identity, and reports retain each individual SHA. Candidate archives are read-only and named by SHA. Earlier atomic prototypes remain diagnostic; the initial 5588 prototype preceded the archive safeguard and retains its actual applied database/schema dump, receipt hash and plans.

Before large after measurements, a disposable100k clone can use `--fixture-suffix=probe` and a distinct `--output` path for both harnesses. Preserve a frozen migration SHA for that probe; a new candidate needs a fresh clone. The main harness refuses to reuse a database after its recorded quality SHA changes.

Run before/after requests without simultaneous builds, browser stress, fixture seeding, or write tests. Setup and prior calls can warm OS/database buffers; no cold-disk claim is made. SQL timings exclude HTTP, selected-card canonical enrichment, browser responsiveness and media delivery. The same-data comparison adds new indexes/projections after the baseline, so physical footprint and cache history differ. Physical iPhone/Safari acceptance remains separate.

After all owned tests finish, stop only this data directory with the existing `pg_ctl.exe -D <absolute runtime/data> -m fast stop`; keep its database and reports for review. Do not use a shared data directory or stop another chat's server.

## Measured final acceptance

42 sessions/group; p95 includes successful calls only. Before 1m, only 4/42 calls succeed per group, so its p95 is not overall latency.

| Salons | Workers | Before first p95 ms (successes) | After first p95 ms | Timeouts before → after | After next p95 ms |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100000 | 1 | 1398 (29/42) | 95 | 13 → 0 | 11 |
| 100000 | 8 | 1623 (28/42) | 121 | 14 → 0 | 13 |
| 100000 | 16 | 1716 (28/42) | 135 | 14 → 0 | 14 |
| 500000 | 1 | 2981 (23/42) | 97 | 19 → 0 | 11 |
| 500000 | 8 | 2884 (12/42) | 142 | 30 → 0 | 14 |
| 500000 | 16 | 3062 (9/42) | 143 | 33 → 0 | 14 |
| 1000000 | 1 | 2118 (4/42) | 138 | 38 → 0 | 12 |
| 1000000 | 8 | 2582 (4/42) | 134 | 38 → 0 | 13 |
| 1000000 | 16 | 3285 (4/42) | 140 | 38 → 0 | 14 |

Main after: 378 sessions, zero errors/timeouts and no observed scope/duplicate failures. Corrected before: 237 timeouts. Separate gates: 48 explicit-sort sessions, 96 generic-typo sessions with actual 16 first-page workers, and deep scrolling through 50 pages/600 unique primary rows all passed. Generic worst p95 at 1/8/16 workers: 755/1033/1059 ms; regional work remains.

| Additional final gate | Shape | Result |
| --- | --- | --- |
| Rich profiles | 10k salons, all with phone/street/suite/56-word description | 13 cases ×8 samples, zero errors; 163,274,752 projection bytes; actual profile/phone/broad plans captured |
| Write/read pressure | 100 salons, 100/1000/4000 new posts then one edit; four readers | 96 reads, zero errors; worst read p95 261 ms; writes 76/126/574 ms, edit 2025 ms; actual edited post visible |
| Post-proof plan | 5120 actual posts on one salon | Current-key index: one row ×5100 probes; former quadratic selfjoin removed |
| Owned native server | PID63624, localhost55441 | Stopped, no listener; all data/reports preserved |

Effective pair: a843ed893cca2279f1d292991483456627947c62bff1dfe884cc2eb1cb8991b3

Fresh-matched catalog: ca0212c3e5d7ec5f74be1c89fff2c286225cd2416025223112506143fca669c0

Original setup 3a and measured ce2d resumption are separately retained. Main profiles have no phone/street/description content; 1m projections total 16,825,663,488 bytes. No fresh-final 1m migration wall-time claim, production capacity claim or deployment.

The recorded million-row preparation resume ran under compatible ce2d code: 1313.9 seconds for 7469 bounded calls, with batch p95 242 ms and maximum 670 ms. Its 1293 backfill history/clock lock samples passed. Activation calls took 2245/2415/2278 ms, returning transient busy twice before ready; the busy cause was not classified. Another 253,200 rows were already prepared under the earlier setup. These are recorded phases rather than the wall time of a fresh a843 migration.

The earlier ce2d main read pass was superseded when a fresh 1000-post burst exposed a quadratic current-post join: four style timeouts at three seconds. A separate 30-second diagnostic completed around 4.6 seconds and showed 1100 ×1100 current-post scans. The final keyed lookup preserves the same-post, source-token, current-author/block and publication-time checks. The original failure and plans are preserved; the final fresh 5120-post gate passed all 96 reads, and its actual plan used one current-key row per 5100 matching posts.

Final actual million-row plans show GiST nearest-neighbor pages and indexed zero-row negative guards. Generic fuzzy queries retain regional candidate work. Instrumented calls establish access paths, not latency. The first overlapping sort/generic run is preserved as diagnostic; accepted timing comes from sequential reruns.

All native gates finished before stopping only the owned PostgreSQL server at localhost:55441. Its verified data directory and PID are in `owned-pg-stop-final.json`; all databases and reports are retained.
