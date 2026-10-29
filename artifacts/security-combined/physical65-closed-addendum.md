# Physical iPhone65: finite QA addendum

This addendum follows publication receipt `9adc36dd-2d40-4bba-bad9-b46cbb041828`; it does not alter the original receipt or relabel QA64.

Installed version was verified through CoreDevice after TestFlight Update: **1.0.0 (65)**. Native source `f4e6104fab5ecf2468b7ff624f5e9da9673cdd6b`, run `40820981797`, source SHA256 `dd6aebccfc6bd2927b3f3e333799b4bb279af343cf02f0c0ef5669ab58e92a61`. Web publication evidence confirms `dpl_Gv64Dt919UZ5Pf76BwSerpqTqpAj`, source `8ede4591f6ad77b7ec072e4a14cb40f33db1072f`. The phone's runtime bundle fingerprint was not extracted; installation and published-source proofs are distinct.

| Requested check | Status | Evidence / limit |
|---|---|---|
| Update and exact installed65 | PASS | TestFlight65 Update→Open; CoreDevice before64, after/final65 |
| App startup and existing account context | Observed, stability not accepted | Explore, Owner context/account switcher and Owner More appeared; app/session changed during testing |
| New POS bottom navigation | PENDING | Did not establish reliable arrival at POS65 |
| More Exit POS / View all settings / third link / repeated open-close | PENDING | Owner More outside POS appeared; this is not proof of the repaired POS menu |
| Custom Services rename / Cancel | PENDING | Required POS Custom service marker was not observed; no rename or Done/Submit used |
| Preserve draft | PENDING | No existing nonzero draft verified or modified; no claim of preservation |
| Top Add / Reset location | PENDING | Did not reach the correct POS view; neither invoked |
| Payroll rail / cards / charts | PENDING | Did not reach a reliable Payroll65 state |

Summary: one installation PASS, one startup/context observation without acceptance, six functional checks PENDING. No confirmed product FAIL from this run. **Physical functional acceptance remains false.**

## Interruption and bounded recovery

`ControlPrepare65TestFlight318` successfully installed/opened65 and read UI, then failed at `ControllerTests.swift:129`: **Failed to get matching snapshot: Application com.reylumi.ios is not running**. One owned harness recovery, `ControlFunctional65Recovery320`, started successfully and read UI again. It later ended with the same error after 339.283 seconds. No second recovery or additional pipeline was run. Both owned xcodebuild processes had ended at the final process check.

App PIDs observed across snapshots were5535,5547,5567. Some attempted navigation resulted in Explore/post preview/comment focus rather than the intended POS state. Empty comment input was focused inadvertently; no text was entered or posted. A native Done action dismissed its input toolbar. Labels and screenshots from those states are retained as diagnostic observations, not successful POS tests.

Accessible `systemCrashLogs` search for Reylumi returned zero files. Jetsam index contained two events dated October23, not a matching current event. This absence does **not** prove that a crash did not occur. Current evidence does not distinguish self-termination, external closure/relaunch, or harness/session invalidation. Do not call it a confirmed app crash or confirmed product navigation regression. USB connectivity alone does not establish healthy automation.

No security/permission changes, app/data resets, cache deletion, credentials, migrations, payment, actual Reset/Submit, customer CRUD, posting/upload or deep performance measurement occurred in this QA. The phone's final UI after the last harness failure was not independently verified; do not claim it was left on POS/Owner Today.

## Evidence and next condition

Windows package: `functional65-319-checkpoint.zip`, SHA256 **`e5af1faaff5fb194c9ff021bab211d09cc64499e06332a20936ff4fc6f5f8527`**. It includes `prepare65-318` installation proofs, `functional65-319/checkpoint-manifest.json`, full command/AX evidence, interruption logs, process and crash indexes, and screenshots. Raw AX contains private account/customer labels and is internal QA evidence. The displayed screenshots contain public salon content/counts and no keys/credentials.

Screenshots separately available: `owner65-319.png` (Owner More visible) and `current65-319.png` (Explore/comment input state). They do not prove the requested POS65 scenarios passed.

Before the coordinator's final stop instruction, one pending owner question requested the minimum external condition: open existing Reylumi65 → Owner → More → POS and leave the screen untouched; no passcode/security/reset request. No answer has been used as approval or proof. This finite run is now closed per coordinator instruction; do not automatically restart it or retry taps. A later verified device condition can support a separately bounded continuation within existing authorization. Published web/TestFlight proof remains valid; there is no basis here to open another pipeline or roll back publication merely because this harness was unstable.
