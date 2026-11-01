# Owner Attention and Payroll polish

Implementation only; no deployment or production migration. Worktree: C:/Reylumi-worktrees/owner-attention-payroll-polish-20261101.

Baseline: committed Payroll reference source 154c0ce, with the previous owner financial Attention implementation cherry-picked as 4931ef6. Preserve both features when assembling the release; never replace a newer deployment with this full checkout. Prior Attention event 861da700-d17d-48e8-ad05-d25de2dd59cc remains a dependency, including its SQL migration. This patch follows that feature and the committed Payroll reference; it does not include uncommitted work from other chats.

## Behavior

Attention notifications place compact View details and Ignore controls at the right. The visual detail label is small; interactive targets remain at least 44px tall. Today, Attention, Payroll and shared Shop Money financial groups use subtle shadows. Today explicitly disables the legacy global border-image responsible for full-width horizontal dividers. Internal ledger row dividers remain.

Mobile Payroll uses the app's 16px horizontal gutter exactly once: hosted shell owns its gutters, native local page supplies its own. Safe-area support remains. Both actual page renderers were checked.

## Load audit and fixes

The native default Shop view unnecessarily loaded analytics. Payroll then performed history, recorded facts and presentations serially, duplicated staff/settings/timezone reads, and only fetched Shop Money after client mount. Plugin entitlements were loaded for unrelated tabs.

The new shared tab plan requests analytics only on its tab and entitlements only for relevant tabs. Independent reads run together; authorized owner Shop data arrives in the page read instead of another mount round-trip. Staff/settings/timezone reads are reused. Staff-only authorization retains its original calculation path. The canonical calculation functions, recorded facts and money rules remain unchanged; tests compare existing returned Payroll fields against the previous implementation. No cache/stale-money shortcut was added.

A failed Shop prefetch remains an explicit error with Retry. A successful seed does not fetch again on mount; update events still refresh it. New server props take precedence over an older client refresh result.

## Evidence

- TypeScript full noEmit source check passed.
- Scoped ESLint: zero errors, seven existing unused declarations in Payroll renderers.
- 32 unit/regression tests passed (18 Attention/load tests and 14 Shop Money/Today financial regressions).
- Browser: 64 actual-component Payroll views across web/native, 320/390/768/1440 widths and eight tabs; no overflow or page errors. Seeded data avoids duplicate initial reads, update refresh and explicit Retry checked.
- Browser Attention: five widths, compact right controls, 44px hit targets, shadow groups without border-image, expense modal, persistent Ignore, exact details and failure state passed.
- Native bundle source verification: Safari16, 337 pinned actions, 894 modules, zero unsupported actions; no assets written.
- Controlled source benchmark with identical simulated 12ms backend boundaries: median 155ms before versus 60ms after, 61% shorter. This isolates orchestration overhead and is not live server/network/iPhone timing.

Evidence is under artifacts/owner-payroll-polish and artifacts/owner-financial-attention/browser. Browser fixtures use actual components with simulated authentication/backend boundaries. Real authenticated iPhone timing, full production build, staging acceptance and native archive/upload remain release checks. A new iOS bundled client is required; no release was performed.
