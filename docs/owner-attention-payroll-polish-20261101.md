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

## Revision: flat full-width groups and live read transport

Supersedes the rounded-group revision after validation. Groups are flat edge-to-edge bands on mobile, with subtle vertical elevation and normal 16px text gutters. Nested Attention notifications and daily rows are lists without card shadows. Browser checks assert group edges at x=0 and viewport width on both hosted/native layouts; compact right detail targets remain.

The exact screenshot warning string originates in the Swift bridge cancellation handler for commands, not the day-closing calculation. Previously Shop Money POST served both reads and writes; native classified refresh reads as commands and emitted command-complete events for reads. A successful save also triggered its own duplicate refresh. This is a reproducible source-level failure mechanism; the specific device request cannot be identified from the screenshot alone. No device logs or physical-device reproduction is claimed.

Shop reads now use authenticated owner/salon-bound GET and an uncached pinned native read; writes retain the single-attempt POST command. GET cannot invoke shop_money_write. Current figures remain live, without caching or freezing. Self-generated update events no longer reread the same workspace. A confirmed write followed by a failed refresh says Saved, but the latest figures could not load, instead of implying the write failed. A genuinely unconfirmed write remains an error and is never replayed automatically.

Snapshot audit: owner_closing_reviews stores only date, fingerprint, reviewer and timestamp, not frozen payroll totals. pos_ticket_input_snapshot in Attention builds current ticket facts on each query. The pre-existing Shop legacy_snapshot field is a compatibility comparison against old report inputs; collectionForDay exposes later report edits instead of hiding them behind an old collection. This revision does not replace those recorded facts or remove compatibility/audit history. Shop totals are calculated by the bundled lib/shop-money.ts; this inspected Payroll baseline still calculates staff live lines on the server. Therefore full local-only Payroll calculation is not claimed, and any separately developed local engine must be preserved at integration.

Revision validation: 20 API/native/financial regressions passed, including owner isolation, GET cannot write, read versus command classification and no automatic write retry; 64 actual-component Payroll browser views plus confirmed-save/read-failure and exactly-one-refresh checks passed; five Attention widths passed list/group assertions. Full TypeScript, scoped lint and Safari16 bundle source verification passed. Backend/browser fixtures remain simulated; physical iPhone and deployment checks remain pending.
