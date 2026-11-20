# Payroll loading — local QA110

Native implementation complete; no deployment, push, TestFlight upload or App Store action. Depends on the earlier `iphone-qa-approved-fixes-20261115` source, including local108. This is a separate change and does not supersede that task's ready event.

Shop, Gift, Rewards and Discounts now share the existing authorized Payroll read for an identical period. An explicit period URL aliases the default read only when the server-accepted period proves they are identical. The UI still receives the original URL. Prefetch uses the same identity; legacy hosted Gift bootstrap snapshots retain their original authority and timestamps under the shared key. Staff, Tools, Settings, Tax, Analytics and other periods keep their separate reads.

If the default period changes while an explicit period's editor is mounted, the editor keeps that same period's accepted data and draft while its own original read loads. A denied read, cache reset, scope change or lost Owner access withdraws this fallback immediately. No cache freshness extension or new seed operation is introduced.

Calculation, ledger, payment, Payroll action/live-refresh/view, page admission and hosted bootstrap source are unchanged (11 protected files verified against `14daa99a671ae432a26163764063aec1cb8bed05`). Other pages and Today are unchanged. Backend RPC waterfalls were outside this native-only patch; there is no cold-load or backend speed claim.

Validation:

- 145 focused tests passed, zero failures or skips; includes 12 browser cases exercising the real resource hooks, prefetch and production Payroll registry. Forced period rollover preserves the same editor node/draft; denial/reset/lost access remove it; stale replies cannot restore prior data; legacy bootstrap avoids another read without merging privileged tabs.
- Scoped ESLint, production build and offline bundle verification passed. The original source fails the new duplicate-read regression, providing a negative control.
- Local signed Debug 1.0.0 (110) installed and read back on the physical iPhone 12 Pro Max, iOS 27.0.1. All 368 bundled files and codesign verified. Bundle build ID `e242ce48a0810f13289cc09b05d30c004b6ee5fe89852857efb5606da8e2407f`; manifest SHA256 `6538ad60e7f84fadd1424c3c7800a4da208902375afff6b35105a341f5d895b5`.

Physical loading comparison: same phone/account/salon/network, January–May 2027, Shop content already available before selecting Gift. Baseline108's five first transitions showed pending content with median bracket 1.998–2.944 seconds. QA110 showed Gift content in every first captured frame, bounded at 0.778–0.815 seconds after the tap (median upper bound 0.798 seconds), with no Payroll skeleton in the sampled frames. Native cached data was preserved and the candidate revisited the periods; these are conditional warm-data observations, not a whole-app percentage, cold-start improvement, device request count or zero-latency claim. Bounds use device capture timestamps, excluding AX tree and transfer time.

Physical functional checks passed: all four money tabs; Staff, Tools, Settings and Tax; an unseen June period displaying neutral pending content before correct June data; Owner Book; Staff Today/My Pay; Personal Library; background/foreground returning to Library. Opening Money manual native key entry `42.34` stayed visible after 38 seconds, then the unsaved draft was discarded and the reopened form returned to zero. No Save, payment, invitation, activation or outbound message was submitted. One bulk XCTest typing attempt entered only `4`; it is excluded from input acceptance, which uses the verified manual-key sequence. Forced rollover and denied-auth acceptance are browser fixtures, not physical account mutations.

Evidence: `C:\Reylumi\qa-evidence\payroll-loading-20261118\REPORT.html`, `acceptance110.json`, `comparison.json`, `protected-source-verification.json`, the install receipt, raw before108/after110 screenshots and validation logs. The XCTest controller completed successfully; this task's device lease was released. The phone remains on Personal Library in QA110.

Before any later authorized release, integrate this frozen patch and its dependency against the exact current production/native source, rebuild, and repeat the relevant acceptance checks. Local QA110 is not distribution evidence.
