# Check Writer — Created by Reylumi

Implementation worktree: `C:\Reylumi-worktrees\kingpos-check-writer-20261027`, branch `codex/check-writer-20261027`.
This work does **not** deploy, apply a production migration, open real checkout, print a real check, or upload an iOS build.

## Entry points and behavior

- Keep the Market ID `print-check`; display **Check Writer**, publisher **Reylumi**. Retain it in My features after paid access expires so historical records remain reachable.
- `/check-writer` requires an active salon Owner. Payroll contains period and individual staff links. There is no new primary navigation item or separate Windows executable.
- From Payroll uses the existing `getPayrollPageData` read-only calculator and `final_check_amount`. When the Owner confirms, re-read and compare the selected employees' canonical names, check/cash/tip/bonus/gross values and check numbers. Store the confirmed snapshot **only in the plugin**. Saved statements remain supported.
- No changes to Payroll calculations, actions, payout statuses or financial source data. Printing does not mark payroll paid. The only Payroll page edits are links and an Owner visibility prop.
- Standalone checks allow custom payee, positive exact-decimal amount, issuer, address, date and memo. Bank accounts remain salon scoped. Standalone checks never create Payroll entries.
- Each Letter sheet has a 3.5-inch top check and two stubs. Each stub defaults to amount + memo; the Owner can select Check, Cash, Tip, Bonus and Gross independently or link both copies. Gross explicitly means `gross_sales` (service sales before deductions), not employee gross wages. Tip/bonus details are not added to the check amount.
- Settings save salon defaults explicitly; changing stub choices in an individual batch does not save defaults. Only calibration offsets are saved in localStorage, never bank or payroll information.
- Issued checks cannot be edited. Void and create a replacement. Exact and overlapping staff payroll periods cannot have two active checks. Reprints keep the original serial and require a reason after a prior PDF preparation.

## Security boundaries

- Every API and PDF action revalidates the authenticated Owner, active salon, paid entitlement (except history/void/unlock/lock safety operations) and explicit client salon scope. Stale UI cannot issue into a newly selected salon. Sensitive routes reset on hide through the existing experience boundary.
- All plugin tables have RLS enabled and no anon/authenticated table grants. Mutation RPCs are service-role only. The server derives actor/salon; these are never accepted from the browser as authority.
- Bank configuration and historical bank snapshots use AES-256-GCM with random nonce and salon/version AAD. There is no full account reveal endpoint. History returns no ciphertext. Never log request bodies or send them to analytics.
- Unlock with the current password, or verified TOTP when MFA is enabled. MFA has no password fallback. A persistent database limiter allows five attempts per 15 minutes. Unlock is a five-minute HttpOnly, SameSite=Strict cookie bound to salon, user and current access token. The UI clears bank-entry/password fields and document URLs on backgrounding. All sensitive endpoints send no-store responses and require same-origin POSTs.
- Atomic serial allocation and request IDs recover the same batch after a lost response. A different payload cannot reuse a request ID. Invalid batches roll back all issuance and serial changes. Bank/settings version is checked inside the issue transaction.
- Live payroll is a reviewed snapshot of the existing calculator, not an atomic transaction over the app's entire operational history. The server re-reads and compares at confirmation; the plugin records the source fingerprint and confirmation time. Changes after that confirmation do not mutate the check. Saved runs and lines are locked and version checked inside issuance.
- `pdf_prepared` records document preparation, not physical output. Owner confirmation records printing separately and does not assert bank settlement. A downloaded PDF or printed paper cannot be revoked; internal Void does not instruct the bank to stop payment.

## Configuration and future release

1. Integrate only the frozen task file list/patch with the then-current source, following `docs/release-policy.txt`.
2. Validate and apply `20261028040000_check_writer.sql` to a local/staging database first. It creates only plugin data plus the existing Market catalog/billing integration. No Payroll data migrations or formula changes are included.
3. Set server-only `CHECK_WRITER_ENCRYPTION_KEY` to 32 cryptographically random bytes encoded as 64 hex characters. Never put it in a `NEXT_PUBLIC_` variable or commit a real key. Back up keys separately from database backups. Loss of a historical key prevents legitimate reprints of snapshots using it.
4. Optional rotation: `CHECK_WRITER_ENCRYPTION_KEYS` is a JSON key-ID to 64-hex-key map; `CHECK_WRITER_ACTIVE_KEY_ID` chooses the encryption/signing key. Keep historical key IDs available for old snapshots. The legacy single key is ID `v1`. Changing the active key expires old unlock cookies. Never delete a historical key without a validated re-encryption/recovery procedure.
5. The Owner approved **USD $4.90/month per salon** on 2026-10-28. Apply the initial migration, `20261028193000_check_writer_output_and_price.sql`, then `20261029040000_check_writer_sales_hold.sql` together. The final catalog state is `price_cents=490`, `fulfillment_ready=false`. Keep server-only `CHECK_WRITER_SALES_ENABLED=false`; missing/false defaults closed even if crypto exists or an older catalog row was ready. Future sale activation requires separate release acceptance and authorization, both the runtime flag and catalog gate, valid server encryption and existing live card configuration. Taxes/fees follow the existing Market quote. No payment-return URL grants access. No live catalog/payment setting has been changed here. See `docs/check-writer-readiness.md` for pending external acceptance.
6. The Swift/NativeBridge changes add capability version `__reylumiCheckWriterPDF=2`, accept bounded PDF data and unique job IDs, and present native print UI with duplex disabled and copies hidden. This requires a future native build; Windows cannot archive/sign/test UIKit. Older clients retain PDF download, with an explicit update message for native printing.
7. Embed Noto Sans (OFL license included) for Vietnamese names and reuse the MICR asset supplied in the user's existing CheckWriter project. Check its redistribution rights before external distribution. Keep server tracing includes for both PDF API handlers.
8. Validate actual Letter stock, printer margins/scaling, single-sided one-copy output, MICR equipment/consumables, AirPrint, cancellation and failure on physical devices. Software tests are not physical check acceptance. Sign by hand after printing.

## Local evidence

Run `node --test tests/check-writer-runtime.test.mjs tests/check-writer-api.test.mjs tests/check-writer.integration.test.mjs tests/check-writer-ui.test.mjs`.

- PGlite runs real plugin and Market billing SQL with fabricated owners, salons and payroll rows: isolation, private grants, idempotency, rollback, version conflicts, overlapping periods, live snapshots, void/reprint and paid access/refunds.
- API fixtures exercise same-origin enforcement, stale salon rejection, Owner/unlock gates, amount tampering, encrypted settings, rate limiting and MFA behavior. They do not contact an auth or payment provider.
- Chromium fixtures exercise 390px and 1440px layouts, both creation modes, independent stub selection, review/create, bank masking and calibration. Vietnamese mobile is covered. Screenshots: `work/check-writer-tests/ui/`.
- PDF runtime tests embed Vietnamese/MICR fonts, reject overflowing text and void printing, and assert 612 × 792 point pages. Fabricated PDFs and rendered PNGs: `work/check-writer-tests/`.
- Production build and targeted ESLint/TypeScript are local validation only. No live services or physical devices have been exercised.
- Final focused run: 65 tests passed (plugin, API, read-only Payroll adapter, Chromium layouts, card billing/tax regression and Payroll source contract). Targeted ESLint and production build passed.
- The broader existing route-inventory test fails at `/qr`; the captured pre-task policy and task policy both classify that route as unknown. `/check-writer` itself is explicitly authenticated, has no data/UI retention, disables prefetch and resets on hide. This unrelated baseline failure is preserved in `review/route-policy-baseline.json`.

The handoff contains a scoped binary patch, frozen source, original touched-file baselines and SHA-256 manifest. Verify `manifest.json` and apply the patch with `git -c core.autocrlf=false apply --check check-writer.patch` against the matching source before integration. Never promote this worktree's unrelated inherited changes wholesale. Native acceptance and production setup remain pending; no release has been performed.
