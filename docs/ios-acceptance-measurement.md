# Offline iOS acceptance evidence

`scripts/ios/acceptance-report.mjs` reads an explicitly supplied local JSON file and
creates a **new** JSON report. It does not connect to a Mac, inspect a device,
read application storage, collect credentials, run tests, change network settings,
or authorize an action. Existing QA source and sessions stay untouched.

Run the synthetic controls with:

```sh
node --test tests/ios-acceptance-report.test.mjs
node scripts/ios/acceptance-report.mjs --input private-input.json --output new-report.json
```

The output path must not exist. Keep private inputs on the approved private host;
run the reporter there when input exports contain private data. The output projects
fixed enums, numeric measurements and hashes. It omits raw identifiers, request
IDs, URLs/query strings, labels, DTOs, cookies, credential values and server text.
The CLI prints only a report digest/status or a fixed error code, never input or
filesystem error text. No sample in the tests is a real device measurement.
The CLI accepts a regular file of at most16MiB, reads no more than that plus one
size-check byte, caps trace windows at8192 rows and witness arrays at24.

## Current acceptance policy and release hold

The policy update recorded after PC reconnect makes **Simulator acceptance
required before deploy**. It must use the exact integrated candidate/source and
bundle/executable hashes, an actual authenticated session, the suitable real
backend and actual transport. Synthetic fixture, observer, compile or report
success does not replace that acceptance. The original frozen auth8776d0b5
snapshot/handoff is unchanged by this reporter delta.

**Physical iPhone checks are optional follow-up after deploy.** Missing a phone,
phone permission or physical Network Link Conditioner never holds a release.
That update does not authorize deploy: the remaining Simulator/auth/source and
release gates stay held. Network tools unavailable for a Simulator profile leave
that result cell UNMEASURED; label the actual profile and arrange the required
Simulator scenario evidence with the coordinator instead of inventing NLC use.

Before release, the integrated Simulator evidence needs an external checklist:

- Exact candidate, source-manifest, installed bundle and executable hashes match;
  the real backend and protocol compatibility are identified without secrets.
- Actual Guest flow and authenticated Personal/Owner/Staff flows are verified
  only where genuinely granted. Pending manual login is an explicit blocker to
  authenticated acceptance, not proof that the account is still Guest.
- Cold, warm, role A→B→A, background and restart have separately bound first
  correct usable content, fresh-data-ready and count evidence. Owner Today and
  Staff My Work need real data or verified valid empty states; headings alone
  cannot pass. Preserve the original Remember choice.
- Confirmed session revocation withdraws that account's private cache; loss of
  a salon/role permission withdraws that context. Same-account role switches
  preserve other authorized caches but require fresh destination admission.
  Check active retained content, post-admission restore, late200/304/hydration,
  principal/tenant changes and permission changes. Old private DOM/drafts cannot
  cross into the new role. Genuine availability503 is tested separately.
- Verify rollback for the same integrated candidate using its frozen backup and
  inverse delta; retain failed/blocked observations. No production operation,
  forced expiry, destructive logout or account mutation is implied by this list.
- Review all evidence and remaining release gates. A reporter output never
  changes the release hold, deploys or certifies a scenario matrix.

## Fixed identity and environment

Input `schemaVersion` is `1`. `metadata` accepts only these fields:

| Field | Contract |
| --- | --- |
| `sourceCommit` | Exact 40-character lowercase Git SHA |
| `bundleBuildId` | Exact 64-character lowercase bundle digest |
| `buildArtifactSha256` | Exact 64-character executable/build artifact digest |
| `principalAlias` | `principal-a` through `principal-z`, or `guest`; never a name/ID/email |
| `deviceAlias` | `device-a` through `device-z`; never a serial/UDID/name |
| `deviceKind` | `physical` or `simulator` |
| `networkProfile` | `wifi`, `nlc-3g`, `nlc-4g`, `simulator-unconditioned`, or `unknown` |
| `scenario` | `cold`, `warm`, `role-a-b-a`, `background`, or `restart` |
| `roles` | Fixed `guest`, `personal`, `staff`, `owner` sequence described below |

`acceptanceBindingSha256(metadata)` exports the canonical binding function.
Every witness, coverage record and clock alignment supplies that `bindingSha256`
and its own `proofSha256`. A hash is an evidence reference: the reporter does not
read or independently authenticate the referenced proof. The QA operator must
review actual source, artifact, account/scope, device and network evidence first.

`executionWitness` carries bound proof plus `integratedCandidateVerified:true`,
`realBackendTransportVerified:true` and `actualAuthenticatedSessionVerified:true`
for authenticated roles. Guest-only reports instead need
`originalGuestFlowVerified:true` and are labeled Guest evidence. Missing this
witness keeps recorded functional evidence UNMEASURED. These are positive external
QA claims to review against their proof; this offline tool cannot establish them.

`environmentWitness` additionally supplies matching `deviceKind`/`networkProfile`,
`actualDeviceVerified: true` and `networkProfileVerified: true`. Missing proof or
an `unknown` profile is **UNMEASURED**. Declaring `physical` or `nlc-3g` in metadata
alone does not certify that a phone or a conditioner was used. Physical WiFi,
conditioned physical profiles and Simulator runs are separate result populations.
An NLC profile is not evidence of a real cellular radio/network.

## Scenario matrix

| Scenario | Roles/legs | Required real scenario evidence |
| --- | --- | --- |
| `cold` | One role | New process/native origin with original reused profile; distinguish fresh install |
| `warm` | Three equal roles | Same-role original A→B→A navigation, independently witness all three bodies |
| `role-a-b-a` | Three roles, first=third and second different | Every original switch, accepted destination and outgoing scope withdrawal |
| `background` | One role | Existing process backgrounds/resumes; same PID, late-error observation |
| `restart` | One role | Explicit controlled boundary, backup and new PID/origin; original Remember choice preserved |

Use a separate report for each device/network/scenario window. Role roundtrips
include Staff↔Owner and Staff↔Personal where actually granted. No fixture may
grant a role, log out, delete cookies/caches, force expiry or replace a session.
A restart with Remember OFF may legitimately require sign-in: classify the actual
Guest/auth-needed result separately, preserve an observed retention failure, and
do not invent a cookie-loss cause. This reporter does not judge persistence policy.

Required pre-deploy results come from Simulator and record the actual network
profile. Simulator unconditioned, NLC3G and NLC4G are separate populations;
conditioned results require verified tools/configuration. Physical WiFi,
physical NLC3G and physical NLC4G are optional post-deploy follow-up populations,
never a release blocker. Unavailable cells remain unmeasured. The read-only inventory
at 2026-10-21T23:44:48Z found eight simulated devices, zero physical phones, and
no Network Link Conditioner in two checked preference-pane locations or Spotlight.
It did not inspect/change phone permissions or network profiles. The owned c701
process still presented the hosted controller; its paused local observed-auth
boolean did not establish current login success/failure. These are point-in-time
inventory facts, not permanent device/access claims or measurements by this script.

## Independent correctness and freshness witnesses

`window` has bound proof plus `start` and `end`. `legs` contains a `start` for
each role. Timestamps are `{ clock: "qa" | "native" | "javascript", ms: number }`.
`witnesses` must contain exactly one record of each kind **for each leg**:

```js
{
  kind: "correct-usable", // or "fresh-data-ready"
  leg: 0, role: "staff",
  at: { clock: "qa", ms: 300 },
  bindingSha256, proofSha256,
  currentAuthorityVerified: true, scopeGenerationVerified: true,
  bodyVerified: true, noBlockingError: true,
  firstCorrectVerified: true, // mandatory for correct-usable only
  // These additional fields are mandatory for fresh-data-ready:
  namedDataVerified: true, freshness: "fresh-200" // or "revalidated-304"
}
```

The witness must be separately timestamped evidence of actual correct usable
content (including a valid empty state), current authority, and no blocking
credential/modal/error state. Freshness separately proves the expected named data
under that authority. A warm authorized retained body can be usable before fresh
data is verified. `revalidated-304` explicitly means validated retained data; it
does not prove a new DTO commit or database work avoided.
For `revalidated-304`, `retainedBodyValidationVerified:true` must additionally
prove that the actual retained body/validator and current authority match. A bare
304 status cannot manufacture that witness. The correct-usable witness must
separately establish it was the first correct usable content, not a later sample.

Staff requires actual granted My Work schedule/shift/ticket data or an authorized
valid empty state under the expected permissions. Owner Today needs the authorized
phases of its current page contract or valid empty states; headings alone cannot
prove usable content. Public Explore needs actual cards/social or
salon content and ordinary public data. `boot.ready`, `route.reveal`, `gate.show`,
`surfaceReady`, `data.visible`, HTTP200, a switcher, and a cache hit cannot create
either witness. Staff online-only `grantStatus:503` lease metadata is not raw wire503.

The existing export does not prove native↔JS current scope/generation association.
Do not create an authority witness by assuming adjacent events or a last observed
auth boolean refer to the same tuple. Missing association remains **UNMEASURED**;
explicit wrong/rejected authority or unsafe/body failure is **NOT_MET**.

## Clocks, counts and spans

No wall/native/JS/automation clocks are subtracted implicitly. Non-QA witness times
need `clockAlignment.native` or `.javascript`, each with bound proof and a finite
`offsetToQaMs`. Missing alignment makes witness timing UNMEASURED. AX observation
duration includes automation and is not app load/paint time.

`diagnostics` uses the existing native report shape: `schemaVersion:1`, matching
`bundleBuild`, `native` and `javascript` arrays. Optional `http.requests` uses the
existing QA same-response records. For `native`, `javascript` and `responses`,
`coverage` supplies bound proof, `complete:true`, `afterSequence` and
`throughSequence`, plus `windowProofSha256` matching the bound scenario window's
`proofSha256`. The reporter requires a dense, unique sequence window
`(afterSequence, throughSequence]`; responses use `requestSequence`. A gap,
duplicate, absent proof, wrong bundle or unknown coverage is UNMEASURED, not zero.
A proven empty window can explicitly record zero. The operator must establish
same-process before/after anchors and provenance; this script does not collect it.

Native/JS rings cap at512/256; hosted events cap64. QA successful/blocked HTTP
records cap512 while error paths can exceed that. A completion-only QA response
list may omit pending requests: do not label coverage complete until that is
resolved. Incomplete retained history cannot prove absence of activity.

The report keeps three count layers separate:

- Native HTTP starts, ends and failures; starts are not added to ends.
- JS context/resource read starts, auth checks and cache joins; nested checks are
  not treated as extra independent user operations or deduplicated by guesswork.
- Per-response `backend_auth/rest/rpc.calls`, when actually exported. No cross-
  response/global total is fabricated and no counter is called database queries.

The new native parser can also export `backendCalls`, `responseBytes` and
`sizedResponses` on fixed `serverTiming` backend_auth/rest/rpc stages. The reporter
keeps these as separate native sequence samples, requiring proven native coverage
and bounded integer call counts. Optional byte fields mean returned Content-Length
and the number of responses that supplied it; they are not total payload size or
DB work. Native/QA views may repeat the same exchange and are never summed.
If only one view has coverage, its samples remain labeled separately while the
other view is UNMEASURED. Bytes alone cannot establish any call count.

Native HTTP/server timing, JS auth/fetch/resource-hydration durations and numeric
same-response Server-Timing are reported separately. Numeric stages are fixed;
free-form descriptions are discarded. Nested/parallel auth/load/backend spans
overlap and are **not added**. The candidate adds the fixed nested Staff/auth
stages described below. Current installed/live stage coverage stays UNMEASURED
until its exact source/build/backend evidence is verified; missing spans are not
zero. Resource-cache hydration is not React hydration. The local app uses
`createRoot`; shell lifecycle marks and two animation frames do not prove data paint.
Owner Today `data.visible` tracks initial/removed pending phases and may be absent
on a successful warm refresh. No whole-page render timing is invented.

Optional read correlation uses the new typed UUID protocol. Native
`contextDelivered`, `readDelivered` or `serverTiming` with a `requestId` and
`readKind:context|read` means that native verified the server's exact echo.
`httpStart`/`httpEnd` alone only carry the locally sent ID and cannot establish
that echo. JS requires the same UUID/readKind on the allowlisted read/context
completion or accept/reject/abort events and `readSource:network|joined`.
`readSource:cache` never inherits a network UUID. Legacy or mismatched echoes
remain valid responses but uncorrelated. Clock proximity never joins requests.

An optional QA `http.requests` record can join the same response only with the
exact matching `sentRequestId`, `echoedRequestId` and `readKind`,
`forwarded:true`, `outcome:http-response` and proven response coverage. This is an
additional adapter-input contract; older QA records without those fields remain
UNMEASURED. Ambiguous duplicates do not select a favorable response. The report
exports only sequence/response ordinals and fixed read-kind enums, not UUIDs or
headers. Correlation proves neither authority nor scope/generation association,
clock alignment, database execution or equivalence of nested logical operations.
The added fixed stages `auth_user/status/session/tombstone` and
`staff_resolve/revalidate` are measured caller-stage durations, not DB execution.

`RECORDED_REQUIRES_EXTERNAL_REVIEW` means both supplied witnesses exist for every
leg and the separately bound environment/execution witnesses exist. It is not PASS, current access authority, release approval, phone validation
or a latency SLO. Performance acceptance remains UNMEASURED until agreed budgets
and repeated comparable samples exist; no absolute timing target is invented.

While sign-in is pending, safely independent work is PC-only synthetic reporter
controls, offline proof/coverage review and a future scoped measurement design.
Native diagnostics correlation changes require their separate owner/review and
new source binding. Do not change the frozen app to make a report complete.

## Isolated native compile feasibility, source review only

The existing `ios/scripts/check-build.sh` verifies bundled bytes, generates the
project, picks an available simulator, may boot it, then runs tests and an unsigned
device archive. Do not call the whole script while preserving the current manual
login app/session. `ios/project.yml` already contains a Debug app plus unit-test
target/scheme; `Simulator.entitlements` binds application identifier and Keychain
group to that build host's own bundle identifier. No new storage bridge is needed.

After the coordinator freezes the combined inputs and gives a build go-ahead,
an isolated source copy and unique DerivedData directory can attempt only:

```sh
xcodegen generate
xcodebuild build-for-testing -project Reylumi.xcodeproj -scheme Reylumi \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$task_run_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY=- CODE_SIGN_ENTITLEMENTS="$PWD/ReylumiTests/Simulator.entitlements"
```

This is a source-reviewed candidate command, **not an executed or proven Mac
build**. Validate the generic destination's build-for-testing support on the
available Xcode; do not substitute current app lifecycle actions on a failure.
Generate the project only in the isolated source copy; record exact Swift/test/
bridge/bundled-manifest inputs before and after. A unique run directory prevents
collisions with prior build results. The command contains no install, simctl
boot/launch/terminate, test run, archive, upload, signing ownership change or
current app storage access. Verify packaged bundle bytes/entitlements and retain
compile logs before considering a separate test plan. Compilation alone still
does not meet authenticated Simulator acceptance or authorize release.
