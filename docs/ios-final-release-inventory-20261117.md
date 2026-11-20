# Final combined release inventory — 2026-11-17

**Read-only inventory and reconciliation plan; no integration, push or publication performed.** Product source tip at capture: `2349fc2536bf5d0b2fa23bf4bee63e0fa705e722`. Last recorded release source: `830f0a6ec3029177c94e88137a8165f784c47ae4` (web/Windows and TestFlight build100 receipts dated November14). The current production alias/source baseline is not established by this audit. Root subsequently observed the production alias through the authenticated dashboard ([root readback](../artifacts/ios-next-steps-20261117/baseline-browser-readback.json)); this does not by itself establish frozen source-archive/native parity. Cached Git remote refs are not a fresh remote or live deployment check.

## Captured scope

| Fact | Count / boundary |
| --- | --- |
| Registered worktrees | 296; all exist and were inventoried |
| Trees with tracked changes | 104 at streamed status capture |
| Trees with untracked paths | 166 at streamed status capture |
| Standard Git status errors | 4 ownership-trust errors; explicit blockers, not silently ignored |
| Journal records | 2171, including 195 release records and 651 change IDs |
| Pending exact revisions | 128: ready21, needs-integration94, working8, blocked5 |
| Pending event/channel pairs | 173: web111, iOS62; publication is channel-specific |
| Original post-830/recent candidate rows |15 before the coordinator/QA delta; older pending rows112 still require dispositions |
| Frozen ready checks |Agent19/21 plus root byte-only template matches2/2: combined21/21; no live integration inferred |
| Pending path overlaps |401 across distinct change IDs;27 involve recent/post-recorded-release changes and product paths |
| Earlier ready revisions preserved |2; neither is hidden by newer needs-integration/working state |

The initial capture saw102 tracked-dirty and161 untracked trees; later streamed capture saw104/166 because other work continued. Root's current tree status was refreshed to0 tracked/9 untracked paths when final compact scope was captured. These are point-in-time facts. The live final-push check correctly rejects later journal/worktree drift.

Canonical `C:/Reylumi/kingpos` had **395467 untracked paths, 393479 under artifacts**. No artifact contents, customer/payroll records, env values or credentials were read. Path-prefix classification does not authorize deletion, staging or pushing generated/user files. Raw path inventories stay local evidence and must not be force-added wholesale.

## What the Git and journal states mean

- **Uncommitted**: captured tracked/untracked worktree paths. They may be generated artifacts, stale overlays or real unfinished source; an old dirty tree is not a merge candidate by itself.
- **Not known on cached remotes**: current2349fc2 has six local commits not reachable from cached remote refs and no upstream. No fetch was made, so this is not a statement that no remote already has them.
- **Unpublished**: exact pending event/channel pairs in the journal. A commit, push, local build, higher app build number or installed local107 is not proof of web publication, TestFlight availability or App Store submission.
- **Ready**: a validated frozen revision exists. It still needs live-baseline and semantic reconciliation; changed whole-file hashes do not prove a fix was never integrated.
- **Needs-integration / working / blocked**: do not turn these into ready merely because source files are present. Six older needs-integration records report all passed validations, but their declared status remains unchanged.

## Ordered combined assembly plan

| Order | Scope | Required handling |
| --- | --- | --- |
|1|Privacy foundation + retained ownership|Use frozen scoped files. Foundation differs from current candidate at erase-due route and moderation proposal. Keep the foundation scheduler without the blocked image sweep until photo scope resolves. Retained ownership2150 is independent; all4 scoped files match current candidate. Do not cherry-pick mixed16ff6cb wholesale.|
|2|Phone verification + approved iPhone QA|Phone ready4ad0f9d9 has4 validated files. Keep prior QA ready8eb5c0bd alongside latest89911e60 needs-integration; reconcile shared profile/navigation/customer form work. New QA snapshot d7fc7f5/frozen107 has24 files and passed local regression/build/installed107 evidence; physical fixed-UI acceptance remains pending.|
|3|iPad role/landscape/four fixes/optimizations + Camera/Photos text|Consolidate shared Swift/web shell and Info.plist changes once. Regenerate one exact combined JS/CSS/manifest bundle; never overwrite it with a branch-specific app.js from an older source.|
|4|Owner Tax read-only mirror + ticket-detail UI|Port snapshot deltas onto current financial authority. Preserve canonical final_staff_income, receipt totals, roles, scopes and read-only behavior; run relevant SQL/RLS and UI regressions.|
|5|Public app invitation|Account separately for web readyf5265a25 and iOS needs-integration successor. Web ready remains despite later native work. Keep store/listing activation default-off until the real store path is verified; one declared env template awaits byte-only hash evidence.|
|6|Submission/policy evidence|Keep candidate docs and public-policy readback; reconcile labels against final enabled scope, including owner-confirmed Market/ad credits. No new billing/activation authority or live policy claim follows from source preparation.|
|7|Photo safety pipeline|**Hold until provider/secure setup/classifier/privacy/native/hosted gates resolve.** Current2349 already contains all27 files of blocked photo scope. Source presence is not clearance to push/promote the whole branch as the final release.|
|8|All112 older pending rows|Give each event/channel pair an explicit source-backed disposition: selected scoped port, semantic already-incorporated evidence, explicit supersession, retained non-product tooling/docs, or held owner handoff. Do not replay old whole trees or erase them.|

This is a safe **reconciliation subset**, not approval to omit other completed work. All173 pairs, including the current coordinator work, must be accounted before the final combined push. No automatic integration is proposed while the actual live baseline is unknown.

## Ready lineage that must not disappear

| Change | Earlier ready | Newer revision / action |
| --- | --- | --- |
|public-app-invite-20261114|f5265a25-ece4-4ec9-b6f1-f3c975645962, web pending|Latest native needs-integration does not supersede the web ready channel.|
|iphone-qa-approved-fixes-20261115|8eb5c0bd-ff04-405f-8a6d-53a4bb31c0c6, web/iOS pending|Latest89911e60 needs-integration replaces an intermediate working marker, not this ready revision. Root must choose/reconcile exact source deliberately.|

This agent left two declared `.env.example` templates unread (Nails one-click and public invite). Root subsequently reported byte-only SHA256 matches2/2 in [separate template evidence](../artifacts/ios-next-steps-20261117/ready-template-hash-readback.json). Combined frozen-source evidence is21/21; the original19/21 raw check remains preserved. No env values were printed or used, and this is not proof of live integration.

## Concrete overlap and ownership gates

- Shared UI/auth/roles: `app/navigation-shell.tsx`, `app/local-app/entry.tsx`, account-profile/editor, customer forms and retained local shell. Preserve latest session/role authority and drafts while combining fixes.
- Native source and generated output: Swift controller/Info.plist plus `ios/Reylumi/LocalAppBundle/app.js`, `app.css`, `manifest.json`. Rebuild after assembly and verify archive/bundle provenance; local installed107 is not TestFlight or physical post-fix acceptance.
- Privacy/photo scheduler: `app/api/account/erase-due/route.ts` differs between foundation and current blocked-photo source. Select the intended dependency set explicitly.
- Market: multiple historical publisher/developer/payment/QR changes overlap actions, developer-app UI, translation and acceptance docs. Preserve actual entitlements, price/readiness gates, provider modes and canonical balances; confirmed audit scope does not authorize new billing behavior.
- Financial/POS/Tax: combine scoped UI/read-only changes with canonical receipt/payroll authority; no broad stale-file replacement.

All401 path overlaps and551 pending paths dirty in the initial worktree capture are listed in machine evidence. These are potential overlaps, not proof of merge conflicts; root must record chosen file hashes and concrete resolution evidence. Latest owner paths/status are available per exact event. Eight original working revisions and five blocked revisions are not silently eligible. The fast delta added current coordinator1d72d4f6 and QA89911e60; working count remains8 after the QA transition.

The four ordinary Git trust failures are historical sandbox-owned paths. A precise per-command read-only safe-directory override allowed metadata inventory without changing global config, while the normalized standard-command fingerprints retain the errors as blockers:

- `C:/Reylumi/audited-ui-completion-20261030`
- `C:/Reylumi/market-phase1-demo`
- `C:/Reylumi/market-real-20261028`
- `C:/Reylumi/work/app-store-legal-20261109`

**Known concurrent drift:** QA owner was fingerprinted at1697f69; new handoff is d7fc7f5. Refresh that owner before final preflight. Root current status was refreshed, but its final completion event and any new work require another release-boundary refresh. No more full scans were performed after root requested handoff.

## Check Writer and mobile spacing — correct historical treatment

The combined-only rule remains: genuinely unshipped Check Writer/mobile-spacing changes must not publish, schedule, activate or change billing separately. Current journal facts differ from old memory: mobile-page-spacing ready0f195937, disabled Check Writer08e308fd and operational628a8718 have no pending channel, with exact publication records. Five older Check Writer needs-integration entries remain. Compare them with actual baseline/receipts and mark their disposition; do not reapply old bank/price/migration files just because those discovery records remain pending.

## Machine handoff and missing final guards

- [Final compact scope](../artifacts/ios-next-steps-20261117/release-inventory-scope-final.json) — SHA256 `edbcaf6bf579017749d2be084d465df105560ca884a934ec8879faf5dc6e8117`; exact128 pending objects,296 compact worktree rows and digest-bound raw inventories.
- [Final reconciliation plan](../artifacts/ios-next-steps-20261117/release-inventory-plan-final.json) — all128 revision rows /173 channel pairs, priorities,27 relevant overlaps, new24-file source manifest and explicit concurrent drift.
- [All revision/hash checks](../artifacts/ios-next-steps-20261117/release-inventory-revisions.json), [all overlaps](../artifacts/ios-next-steps-20261117/release-inventory-overlaps.json), [journal delta](../artifacts/ios-next-steps-20261117/release-inventory-journal-delta.json), [generated-prefix counts](../artifacts/ios-next-steps-20261117/release-inventory-generated-paths.json). Initial raw/scope/plan files were preserved.

`statusFingerprint` is SHA256 of raw stdout bytes from `git --no-optional-locks -c core.quotepath=false -C <path> status --porcelain=v2 --branch --untracked-files=all -z` with optional locks disabled, no persisted trust override. Nonzero exit produces null fingerprint and an error. Array fingerprints are fallback provenance only.

Before final push root still needs: fresh actual web/native baseline; fresh strict journal read and selected-owner fingerprints; explicit disposition for every event/channel and dirty/error worktree scope; verified immutable frozen realpaths/hashes/deletions; one chosen hash per conflicting source file; blocked scope handling and provider/legal/native gates; assembled build/regressions/bundle/device evidence; a frozen selected push set. The fast delta scan read only new IDs after the initial strict journal audit, so it cannot replace the final strict reread.

No product edits, fetch/pull/merge/rebase, stash/clean/reset, relocation, journal record, commit, push, deployment or provider mutation were performed by this inventory task. No env values or live customer/payroll documents were opened.
