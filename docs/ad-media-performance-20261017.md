# Advertising image and display changes — 2026-10-17

Implementation only. No deployment, production migration, credit transaction, email, or native upload was performed.

## Image policy

- Shared default: retain aspect ratio, auto-orient, do not enlarge; longest edge at most 1600 px. Target 300 KiB, enforced ceiling 500 KiB. Quality steps precede further dimension reduction.
- Covers, avatars and social images retain their existing crop choices. Beauty and Salon browser encoders use the shared policy. Publication validates and, if necessary, normalizes actual storage bytes on the server after ownership checks, using the authenticated user's existing RLS permissions.
- Admin uploads, signed uploads and pasted public HTTPS URLs all pass through server normalization before their URL enters campaign configuration. External downloads pin a vetted public IPv4 address and bound redirects, bytes and time.
- Customer standalone creatives use the same server normalizer. Admin and standalone creatives additionally have 480/960 px variants. Customer cards use a prepared signed 960 px asset; admin images use responsive variants. Private creatives remain private.
- GIF/animated WebP movement is retained. Decode budget: 40 million input pixels and at most 100 frames. Oversized or undecodable inputs return a recoverable error instead of publishing an unbounded file.
- Standard browser-produced images already within policy are validated without storing a duplicate. Reprocessed originals use a new immutable path. UUID-shaped social filenames preserve existing cover constraints. Failed creative retries with a different photo cannot mix that photo's variants with an earlier upload.
- This covers advertising and the public Beauty/Salon photo publication paths. Evidence documents, receipts, video, and unrelated upload features are outside this change.

## Display and accounting

- Admin popup is a floating, dismissible, nonmodal card. No background blur, full-screen input interception, body scroll lock, focus stealing, or keyboard trap. Safe-area padding accommodates mobile WebKit. Existing announcement positioning and targeting remain.
- Image preparation happens during the configured delay and before admission. Broken/slow images fail closed. Popup waits while a modal is open or a form input is focused. Navigation cancels pending preparation.
- New admin clients reserve an eligible display, render decoded content, then confirm after paint and viewport checks. Reservation alone does not insert a view or consume daily popup history. Expiry is 30 seconds; confirmation is bound to campaign, session and visitor and is idempotent. Admission still rechecks campaign state and quotas atomically. Old clients retain the existing claim interface.
- Migration `202610170001_advertising_display_reservations.sql` is additive and has only service-role access. Transient rows older than seven days are cleaned in bounded batches; reporting tables are not deleted or rewritten.
- Customer views still require a loaded image and at least 50% viewport exposure for one uninterrupted visible second. Leaving the viewport or hiding the tab resets the timer. Failed private signing and missing required media do not produce an ad card.
- Customer credit pricing, wallet, payment, targeting and nonce/idempotency SQL are unchanged. A navigation before the view qualifies does not manufacture a billable view. A view already sent after real exposure may legitimately finish after navigation; its nonce prevents a repeated charge.
- Links navigate immediately. Click statistics are background requests, and clicks never manufacture a customer view. Customer clicks before an admitted view are not included in click statistics, consistent with the existing server requirement for a qualifying impression.
- Ad GET/claim/confirmation requests have a 4-second client deadline; image preparation has a 6-second deadline. A potentially committed view is not automatically retried. Announcement duration starts when displayed, instead of expiring during server delay.

## Existing images and release integration

Existing production originals have not been changed. New uploads and saved admin edits use the policy. `scripts/normalize-campaign-images.mjs` previews existing admin/standalone creative candidates by default. A future authorized maintenance run can opt into `--apply`; it retains originals and compares the old timestamp/path before updating a reference, so a concurrent edit is not overwritten. This script was syntax-checked, not run against production.

Apply and verify the additive migration before releasing the new client. Preserve the current production source when integrating the task overlay. No Swift, bundled bridge, entitlements, permissions, or native assets changed; a native binary is not required for this web-compatible change. A real iPhone smoke test is still a release check; WebKit tests on Windows are not a signed iOS binary/device test.

## Verification evidence

Evidence is in `artifacts/ad-media-performance-20261017/`:

- `focused-verification.log`: image/animation/metadata enforcement, request deadlines, admin reservation integration, admin UI/targeting, Chrome and mobile WebKit interaction, customer delivery, wallet/credits, replay/refunds and payment regression tests.
- `lint.log`, `typecheck.log`: checks for changed implementation files and workspace TypeScript.
- `final-build.log`: complete production build of an isolated source copy. Only the check copy enables Next's documented memory optimizations, sets one build CPU, and narrows TypeScript discovery to that copy. Product configuration is unchanged. The initial in-place build was stopped for memory pressure.
- `screenshots/`: popup interaction fixtures in Chrome and mobile WebKit; no real user data.
- Wider existing checks exposed two pre-existing contract failures: Beauty expects the absent text `More post actions` (also reproduced against the captured before-source in `baseline-contract.log`); Salon publication expects no `revalidatePath` in `app/salon-profile/actions.ts`, a file this task did not modify. These are not silently treated as passing.
- The frozen task overlay, source hashes and exact patch against the captured/reconstructed pre-change source accompany the completion journal record. Do not publish the whole dirty workspace or mistake this receipt for a live release.
