# Android Portable POS: local build and QA runbook

Updated 2026-11-18, America/Chicago. Implementation/local QA only; this document
does not authorize deployment, store upload, production writes or installation
on an unselected physical device. Follow [release policy](release-policy.txt)
for the later integration/release, and preserve the pending OTP worktree.

## Packages and entry point

The dedicated app reuses the existing `/pos/portable` UI and commands. It adds
native durability, scoped offline preparation and system printing. It does not
replace the general Reylumi Android app or the existing general QA package.

| Gradle variant | Package | Origin / first route | Purpose |
| --- | --- | --- | --- |
| `posQa` | `com.reylumi.android.pos.qa` | Configured exact local app origin, `/pos/portable` | Debug-signed, test-only isolated QA |
| `posDebug` | `com.reylumi.android.pos.debug` | `https://reylumi.com/pos/portable` | Debug host; opens production, so not a synthetic QA substitute |
| `posRelease` | `com.reylumi.android.pos` | `https://reylumi.com/pos/portable` | Proposed separate release identity; ownership/signing/store registration remain release gates |

The original `debug`/`qa`/`release` variants retain their own identity/behavior.
The POS variants add `ReylumiAndroidPOS/1.0` to the existing Android user agent.
Only that dedicated marker requires the Portable native vault; the general
Android WebView must not be mistaken for a durable POS host.

Minimum SDK 26, compile/target 36, Java 17. The dedicated Android app always
starts in Portable mode; iOS-only Personal/Portable launch-mode controls are
hidden on this Android package.

## Build the isolated candidate

Use the exact worktree and its healthy isolated synthetic backend. The
2026-11-18 candidate uses app `http://localhost:3121` and backend
`http://127.0.0.1:55621`. Verify source/process/project ownership first; a
historical QA environment endpoint alone is not ownership proof.

Configure `JAVA_HOME`, `ANDROID_HOME` and `ANDROID_SDK_ROOT` to an installed
JDK17/SDK36 toolchain, then run from `android/`:

```powershell
.\gradlew.bat --no-daemon -PqaAppPort=3121 -PqaBackendPort=55621 testPosQaUnitTest testQaUnitTest lintPosQa assemblePosQa assemblePosQaAndroidTest
```

Outputs:

- `android/app/build/outputs/apk/posQa/app-posQa.apk`
- `android/app/build/outputs/apk/androidTest/posQa/app-posQa-androidTest.apk`

The two QA port properties must be distinct canonical ports in 1024–65535.
They bind native resources/permissions/bridge and QA WebSocket policy to those
exact hosts and ports. They do not broaden production trust. Defaults remain
3117/55421 for the older generic QA workflow. `qa/local/Open-AndroidQA.ps1`
targets that generic package/default pair; do not use it unmodified to install
this POS candidate.

Record the exact source manifest, APK SHA256, application ID/version, testOnly
flag and signing-certificate digest before handing off an APK. A successful
debug build is not a signed store artifact. No credentials, private cookie
values, provider tokens or keys belong in APKs, build receipts or logs.

## Selected-device installation

Use only the device/emulator explicitly selected for this QA run. Verify the
target and APK package first. Apply an update using the same package and
certificate; preserve its app data. Never resolve a signature/package mismatch
by uninstalling or clearing storage while tickets may be pending.

With a selected QA serial, run from the repository root:

```powershell
adb -s '<selected QA serial>' reverse tcp:3121 tcp:3121
adb -s '<selected QA serial>' reverse tcp:55621 tcp:55621
adb -s '<selected QA serial>' install -r -t android/app/build/outputs/apk/posQa/app-posQa.apk
adb -s '<selected QA serial>' shell am start -n com.reylumi.android.pos.qa/com.reylumi.android.MainActivity
```

Enter synthetic POS credentials through the normal UI. Do not inject cookies
or copy private runtime files into public evidence. Keep the app/server/backend
and background dispatch guards aligned with the same QA project. Forwarding
these ports is not a network firewall or provider acceptance.

## Durable and offline contract

`PortableStore` keeps the financial draft/outbox separate from replaceable
display snapshots. SQLite uses WAL/FULL; AES-256-GCM keys are non-exportable
AndroidKeystore keys and files live under the app's no-backup directory.
Ciphertext is bound to its saved key or operation ID/scope. An existing vault
with a missing/invalidated key fails closed; it is never silently replaced.
Hardware-backed key storage is not inferred from an emulator result.

A returned synchronous save means the native commit succeeded. The operation
and its anti-resurrection checkpoint share a transaction. Operation identity,
payload, sequence/retry/import behavior and terminal-state guards preserve the
existing Portable protocol. Bodies up to the defined limits are read in
128 KiB chunks inside a stable SQLite transaction, avoiding Android's smaller
CursorWindow row limit. Native persistence errors throw and keep the work
open; they never silently fall back to browser persistence. A legacy browser
copy may migrate only after native admission and a successful native write;
that migration is not an error fallback.

Native admission comes from the exact trusted native HTTP transport and
existing private POS cookies, not an envelope supplied by JavaScript. It checks
canonical scope/path, capabilities, generation/revision, private cookie
fingerprint and the existing server-issued lease capped at 24 hours. There is
no new signing protocol or extra server mutation authority. New queued commands
require `KINGPOS_PORTABLE_DRAFT_OUTBOX=1`, `localCommands` and their capability;
the server still rechecks canonical permissions/money on synchronization.

Before showing protected cold-start HTML, the native host restores an unexpired
cookie-bound admission from its sealed cache. A snapshot is not authority.
Explicit lock, observed authorization denial, changed cookies or an expired
lease withdraw access while preserving pending financial work. Root document
nonce/generation and process-wide writer tokens fence old pages and rival
WebViews; a live writer is not taken over by elapsed time.

`storage.prepare` admits the current view. `offline.status`/`storage.status`
are passive; background preparation must not block local operation ACKs or
extend/replace the editor's admission. “Ready for offline work” requires both
the authorized resource/staff bundles and verified native HTML/assets. An
online durable draft alone does not prove offline readiness. HTML snapshots
retain their original capture/lease expiry; normal online navigation is
network-first. Hash-verified static assets may be cache-first.

Display pruning is native-only and limited to old `display:v1:<build>|` asset
versions and other-scope Portable HTML. It must preserve financial saved rows,
operations/checkpoints, transport/context metadata and the current build/scope.

## Shared receipt setup and printing

Receipt setup is shared web UI for Windows/iOS/Android. It selects 58 mm,
80 mm or A4, optional salon logo/phone/address and a bounded custom footer.
These are device/workspace layout preferences, separate from financial
storage and permissions; no receipt or tax formula changes follow from them.

Android renders the isolated receipt document and opens the system print UI
(or Save as PDF). Presenting/submitting the OS dialog is not proof that paper
was printed. No direct USB/Bluetooth printer protocol, silent printing or new
sensitive permission is introduced here. Real printer/service, paper width,
cutting/margins and cancellation need their own device/hardware QA.

A provisional slip must refer to a persisted pending local receipt operation
and checkpoint under the currently admitted scope. Native print validation
does not accept authority from the job payload. The common renderer marks it
as awaiting server validation; it is not a paid/closed server receipt. Missing
authority, a draft, rejected/unverified operation or expired lease must not
be papered over as a confirmed receipt. Returning online uses the existing
idempotent command path, not a new “paid” shortcut.

## Regression checks and current evidence boundaries

Run the Node shim contract independently from the repository root:

```powershell
node --test android/tests/portable-device-bridge.test.mjs tests/ios-portable-device-bridge.test.mjs tests/portable-checkpoint-zero.test.mjs
```

Use explicitly selected emulator instrumentation instead of an unqualified
connected-device task when a physical phone is also connected. Install the
test APK on that same selected emulator, then run:

```powershell
adb -s '<selected QA emulator>' install -r -t android/app/build/outputs/apk/androidTest/posQa/app-posQa-androidTest.apk
adb -s '<selected QA emulator>' shell am instrument -w -r -e class 'com.reylumi.android.PortableStoreInstrumentationTest,com.reylumi.android.PortableColdStartTest' com.reylumi.android.pos.qa.test/androidx.test.runner.AndroidJUnitRunner
```

The 2026-11-18 core run passed 14 platform tests, 3 JVM writer/namespace tests,
7 JVM cached HTTP projection tests,
and 15 bundled-shim tests (3 Android, 6 iOS and 6 cross-platform). It covers real SQLite/Keystore, commit rollback, ciphertext
substitution/lost key, immutable retries/checkpoints, credentials/scope/depth
guards, cookie/flight/document/writer fences, large 2.6 MB cold reads and
display-only pruning. Failed-before PRAGMA and CursorWindow attempts are
retained as evidence of fixes, not counted as passes.

Only two existing GET views may project native cached DTOs after an observed
network failure: Tickets and the Report workspace resource. Filters must be
unique and known; explicit dates match exactly, no-date requests use today's
salon timezone, and Report retains its today-only rule. Scope/schema/status and
the original date/reportDate field must match; no totals or missing data are
invented. The shell rechecks current capability, cookie/revision/lease and
document boundaries. An opaque native read guard prevents a late HTTP denial
from locking a newer admission or changed session.

The shared cold-draft regression evaluates each actual bundled shim in a new
JavaScript VM document with the previously committed native fixture retained.
An `operations.checkpoint` reply of numeric `0` means no receipt has checkpointed
that draft; it must permit normal draft recovery. Both shims validate finite
nonnegative checkpoint numbers, array operation lists and object replies for
the other actions, while rejecting null/undefined and native error envelopes.
The failed-before VM run and subsequent 15-test pass are retained separately.
This compatibility patch also requires an updated bundled iOS build before it
can affect an installed iOS app; Node VM evidence is not physical iOS acceptance.

For process-death proof, the root coordinator additionally ran the cold-start
fixture with instrumentation argument `portablePersistencePhase=prepare`,
force-stopped only the selected emulator's POS QA target, then ran a separate
`verify` instrumentation process. This preserved the same acknowledged fixture
draft/operation/checkpoint. The fixture uses its own no-backup directory and
Keystore alias; it is not a business ticket or the app's real vault.

These core tests do not replace the root's combined APK/UI and reconnect/sync
checks. Acceptance still needs actual Portable login, saved ticket/relaunch,
airplane-mode or server-unreachable cold launch, lease expiry/lock, idempotent
reconnect, system print/PDF cancellation and the exact installed build. Samsung,
Windows installer, physical iOS/printer and real provider/store acceptance must
be recorded separately. Do not claim all of them from browser or emulator tests.

Device-only pending work cannot survive app deletion, storage clearing, lost
Keystore material or device loss. Preserve the app/data when investigating
errors; reconnect and synchronize through the existing authorized workflow.

The task did not publish web changes, register a Play identity, sign/upload an
AAB or deploy/push. Production billing/SPA/server gates and owner-controlled
release signing/version decisions remain separate release work.

## API references

- [Android Keystore](https://developer.android.com/privacy-and-security/keystore)
- [KeyGenParameterSpec](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec)
- [SQLiteDatabase](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase)
- [CursorWindow](https://developer.android.com/reference/android/database/CursorWindow)
