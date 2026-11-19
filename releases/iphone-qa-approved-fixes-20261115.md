# Approved iPhone QA fixes — local completion

November 18 update: the retained Customer keyboard regression and newly found Help return route defect are both corrected and physically rechecked in local108. See `releases/iphone-help-return-fix-20261118.md` for current acceptance. The 106 evidence below remains historical; no deployment has occurred.

No deployment or TestFlight upload. Today, authorization grants, booking/payment/payroll actions and calculations are unchanged.

Based on the recorded November 14 release source: task base `23e66abd5a197d66fd9d2e9fbb358b160af06307`, published source `830f0a6ec3029177c94e88137a8165f784c47ae4`, physical baseline 1.0.0 (100). Recheck the production source before any future integration.

- POS fills the catalog default only for a blank current amount. Explicit zero, manual values/expressions and saved lines remain authoritative.
- Library was already corrected in 100. Confirmed again; no duplicate Library patch.
- Current-workspace entry removes four push-then-refresh calls. Native admission uses a neutral pending shell instead of flashing public guest navigation; the body portal and authorization boundaries stay intact.
- Book keeps a date/menu scaffold for an unseen query. Pending lists contain no borrowed rows, counts or New action. Scope/salon reference checks and denied-read fallback remain. Date/menu parameters follow the existing controls. Payroll uses a neutral skeleton while its original read is pending. These are continuity improvements, not a backend latency claim.
- Approved UI: single-line Exit POS, wrapping Explore filter chips, one active Book menu, compact Customer notes/actions and separate Staff invitation/profile headings. Customer actions account for the iPhone keyboard; mobile navigation is hidden only while that form's keyboard is open. Existing form fields, actions and submitted notes are preserved.

Validation:

- Final production build and offline assets passed: `artifacts/iphone-qa-approved-fixes-20261115/production-build-final106.txt`.
- 22 focused tests passed, including actual POS callback cases, held Book reads/query updates/denial/scope checks, pending shell body retention, session recovery and named-read lifecycle: `focused-final-tests.txt`.
- Customer source browser checks: 320×568, 428×926, 428×460, overlay keyboard and edit payload preservation; 4 checks passed (`customer-browser-final.txt`). Chromium evidence is separate from physical acceptance.
- Scoped Book client/panel and Customer helper lint passed. POS has the same pre-existing `react-hooks/set-state-in-effect` error (`setGiftDelivery(null)`) as the release baseline. Older unrelated browser fixtures with missing server-boundary mocks were not counted as passing.

Physical acceptance on iPhone 12 Pro Max, iOS 27.0.1: installed signed local Debug 1.0.0 (106), immutable bundle `a566c5297ed8139a7b6bffd04c3008029103dcc56c4d8583089910fdc5e5060d`; all 368 bundled file hashes verified against the built app. POS $35/default → manual $45 → change service → save/reopen $45 passed; draft reset, no Submit. Book unseen November 23, Availability and professional-hours loading retain controls. Personal/Owner/Staff and direct Library passed. Customer keyboard, Explore, Staff and Exit POS visual checks were captured on the same patch in local 105; 106 only adds Book continuity. Payroll Gift & Rewards pending/settled passed on 106.

Evidence: `C:\Reylumi\qa-evidence\iphone-approved-fixes-20261115\REPORT.html`, screenshots and install receipt. Baseline 100 and candidate 105 each have one warm Staff→Personal capture; transient guest navigation is gone in the candidate, but the samples do not support a whole-app speed percentage. The XCTest controller was stopped and this task's device lease released. Phone remains on Library in local 106. No real payment, booking, customer creation, invitation or outbound message was submitted during this fix/retest phase.
