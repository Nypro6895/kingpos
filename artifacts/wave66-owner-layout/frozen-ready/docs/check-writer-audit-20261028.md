# Check Writer audit — 2026-10-28

Local fixes only; no deployment, production migration, live charge or native release.

## Findings fixed

- High: batch PDF preparation previously updated counters one check at a time. Preparation is now one database transaction with expected counters; stale/concurrent requests fail before any counter changes.
- High: a prepared PDF could trigger repeated app print/download actions. Each real output now has a short-lived, actor/salon-bound, one-use dispatch ticket. Void status is rechecked at dispatch. Native printing rejects repeated job IDs and clears shared printer data after completion.
- High: delayed API/FileReader responses could recreate or print sensitive document data after hiding the app. Generation guards, five-minute expiry and background clearing now cover those asynchronous paths; document URLs and bank fields are revoked/cleared.
- High: losing an issuance response could encourage another standalone check. Persist only its random request ID in sessionStorage, recover the committed batch, or atomically cancel the pending request. A cancellation tombstone rejects a late original request. No issued check is silently voided.
- Medium: standalone/history depended on Payroll loading successfully. Payroll failure now leaves these flows available; standalone issuance skips the calculator. Payroll calculations and source rows remain unchanged.
- Medium: refresh could overwrite manual issuer/memo/stub choices, changed settings could invalidate a review, and already covered Payroll lines remained selectable. Preserve draft choices, compare settings versions, and disable covered lines; server overlap guards remain authoritative.
- Medium: unsupported glyphs, bidi controls and large calibration offsets could produce misleading/clipped checks. Reject unsupported text and unsafe bounds; normalize Windows line endings. Masked previews retain actual bank display identity while hiding routing/account digits.
- Medium: Market still had pending pricing and incomplete recovery for canceled subscriptions. Price is now $4.90/month/salon. Reuse the normal card checkout, invoice verification, tax/fee quote and portal. Checkout is blocked before provider work when encryption is missing. Only provider-synced canceled subscriptions may clear an expired old billing link; refunds/unknown/past-due states do not permit a second subscription.

## Validation

- 70 focused tests: real SQL in PGlite, API authorization/tampering/MFA, crypto/PDF validation, read-only Payroll adapter, Chromium plugin/Market UI, existing card/tax and Payroll source regressions.
- Chromium widths 320, 390, 768, 1440; Vietnamese mobile; both creation modes; independently selected stubs; one-use download; sensitive data clearing on hide; request recovery without issuing again. Market fixtures exercise unavailable, active, pending return and $4.90 pricing on Windows/iOS user agents.
- Targeted ESLint and production Next.js build pass. PDF rendered and visually inspected: Vietnamese names, two stubs, MICR and blank hand signature.
- Core Payroll files compare unchanged with the pre-plugin reconstructed baseline. Inherited checkout changes are excluded from this audit patch.

## Remaining acceptance boundaries

Physical iOS/AirPrint and Windows printer dialogs, MICR stock/ink alignment, native Swift archive and real staging Stripe/Supabase acceptance remain unverified. Downloaded PDFs and OS printer copy controls are outside app enforcement; one-use tickets prevent repeated app dispatch, not external copying. A canceled/failed print consumes the attempt and requires a reason to prepare again. Preparing a PDF does not prove paper was printed; printing never marks Payroll paid.

The existing full route inventory `/qr` failure is a captured unrelated baseline issue. Review the frozen snapshot and journal before integration; never deploy this inherited dirty worktree wholesale.
