# Customer keyboard navigation regression — local fix

November 18 update: physical QA107 keyboard acceptance is complete. A separate Help return defect found during that round is corrected and physically checked in local108. See `releases/iphone-help-return-fix-20261118.md` and `C:\Reylumi\qa-evidence\iphone107-acceptance-20261118\REPORT.html`. The pending status below records the November 17 boundary; no deployment has occurred.

User authorized checking and fixing on November 17. No deployment or TestFlight upload.

The retained Customer form kept `data-keyboard-open=true` after Cancel hid its React Activity. Its global CSS selector consequently hid the next page's mobile navigation. `CustomerFormActions` now owns the mounted node for its full effect lifetime, clears that node's keyboard flag/inset on setup and cleanup, cancels queued animation work and ignores callbacks after cleanup. Footer geometry, draft fields, form actions, Today and authorization/business logic are unchanged.

Validation on the actual component/CSS:

- New regression suite before fix: 1 passed / 3 failed. After fix: 4 passed / 0 failed. Covers Cancel without a closing resize, retained draft/DOM, pending frame, hide/show, StrictMode/unmount, two forms, missing visualViewport and pinch zoom.
- All 26 focused POS, Book, role/session/read-lifecycle and keyboard tests passed.
- Four Customer create/edit, viewport and payload checks passed; scoped ESLint and final production build/offline asset generation passed.
- Signed local Debug 1.0.0 (107) built; all 368 bundle file hashes verified, installed version read back from the physical iPhone. Bundle buildId: `e390359fb9181e9ac071dc490c020a3d4868517eed47cfb55b19d4af04abdecf`.

Physical UI acceptance remains pending. The fresh November 17 XCTest attempt failed before any test method with `Timed out while enabling automation mode`, despite a connected/paired device, enabled Developer Mode and compatible DDI. This is infrastructure evidence, not an app failure. The owner was asked to restart/unlock the iPhone for a further attempt. Do not claim the browser results as WKWebView acceptance or publish this revision until the requested device retest is complete.

Evidence: `C:\Reylumi\qa-evidence\iphone-keyboard-nav-fix-20261117\REPORT.html` and this worktree's `artifacts/iphone-keyboard-nav-fix-20261117/`. Earlier 106 evidence and frozen snapshots are preserved. This revision includes all originally approved POS/loading/UI changes; completion remains `needs-integration` solely for the pending physical retest.
