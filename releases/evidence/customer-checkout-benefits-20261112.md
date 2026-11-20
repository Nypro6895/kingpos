# Customer checkout benefits — implementation receipt

Implemented 2026-11-12 (America/Chicago). Change: `customer-checkout-benefits-20261112`.

## Result

- Preserve the approved two-column receipt and customer controls. Use a cream/sage/gold illustrated background on the Reward card. The SVG is a shared default, with a readable plain-color fallback.
- Keep one main receipt total. Show reward discount, gift payment and gift purchase separately; do not subtract a confirmed reward twice.
- Place Reward above tip and Gift below tip. Keep four configured tip suggestions, Custom tip and No tip. Save tip automatically; keep explicit customer approval for spending points.
- Render saved owner/issued gift-card artwork through the existing shared GiftArtwork and dialog. Preserve both Use and Buy, paired dismissal, expiration and next-customer isolation.
- Retain owner display privacy/settings, promotional layout and custom/default assets. Keep the approved check-in entry screens. Membership is not fabricated when no checkout contract exists.

## Logic and compatibility

`20261113033000_customer_checkout_preview.sql` adds a read-only preview behind the existing authenticated/pairing-gated Reward display RPC. The preview is accepted only when its customer and monetary facts match the displayed receipt. Estimated points are separate from spendable points; paid settlement remains authoritative. The preview does not write to the ledger; existing enrollment and welcome-point behavior stays unchanged.

The new scoped tip RPC locks and checks draft/customer/receipt versions before delegating to the existing tip command. Idempotent retries remain valid. Older clients retain their original RPC. The customer input is disabled while saving; changing customers cancels unsaved input. A money change clears prior Gift approval and asks the customer to review the card again.

The current migration set supports POS Gift counter sales. The earlier audit conclusion based on an obsolete helper guard was corrected; this change does not disable purchases or replace settlement logic.

## Verification

- Real React product components in Chromium, isolated synthetic transport: customer checkout, unchanged check-in/promotion variants, shared POS Gift entry/dialog, owner/issued artwork, automatic decimal tip, save failure/retry, explicit reward consent, all four offers, Gift reapproval, customer change and responsive layout. No production writes.
- Responsive checks: 1920, 1366, 1024, 820, 390 and 320 px widths. Totals stay within the receipt; desktop retains two columns; touch controls and horizontal overflow checked.
- Isolated PostgreSQL/Auth/PostgREST: all 424 migrations replayed. Existing Reward/receipt/Gift authority regression: 13 tests passed. New preview/scoped-tip suite: 7 tests passed, including private-helper denial, stale receipt/customer rejection, null-safe idempotency, paused earning and Gift-reduced qualifying spend.
- Presentation, tip formatting, appearance and paired Gift lifecycle: 10 tests passed.
- Scoped ESLint, production Next.js build/TypeScript and complete offline asset generation passed. These are local source checks, not installed Windows, hosted, Safari or physical-device acceptance.

## Source and integration

Worktree: `C:/Reylumi-worktrees/customer-checkout-benefits-20261112`.

Base: `b911fba43fa253b67c18c321702a0ad60a454f1b`. Dependency: `checkin-windows-gift-lifecycle-20261111` (event `89c5806d-59b5-4982-afff-1558bc89d9ac`). The initial working event used an old dependency label; the completion event uses this canonical change ID.

Scoped source, SHA256 manifest, patch, browser screenshots and local verification logs are under `artifacts/customer-checkout-benefits/`. `frozen-manifest.json` binds each file to the frozen source; the completion journal event identifies the implementation commit.

Real local development source is registered at `http://127.0.0.1:43136/pos/customer-display`; checkout appears through the normal POS handoff, not a fabricated live-preview route.

Status: **needs integration**, not published or installed. Integrate the scoped patch plus its dependency into the current release baseline and apply the validated migration before the new client. No hosted migration, deployment, portable installer, auto-update or native upload was performed by this task.

Windows online customer display and browser use this shared web code. No Electron/Swift/Capacitor bridge, permission or updater changes are included. A release must refresh the hosted client and its offline assets; whether a packaged app requires a new binary depends on that package's actual bundled baseline. Shared Reward presentation also requires the normal iOS release assessment; Chromium tests do not establish iOS acceptance.
