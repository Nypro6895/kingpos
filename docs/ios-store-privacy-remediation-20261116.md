# iOS store privacy preparation — 2026-11-16

Status: implemented and verified locally; needs integration and policy review. No public policy, hosted data, store metadata, native upload or App Review submission was changed.

## Scope and source

- Worktree: C:/Reylumi-worktrees/ios-store-privacy-20261116.
- Base: 23e66abd5a197d66fd9d2e9fbb358b160af06307; product source matches uploaded native source 830f0a6ec3029177c94e88137a8165f784c47ae4.
- Fresh Apple readback on November 16 still shows 1.0.0 (100), VALID, and draft 1.0.1 selecting old build 5.1. No upload newer than 100 was found.
- The current production alias could not be refreshed through the available local Vercel authentication in this preparation. This work is based on the last verified shipped source, not a claim of current-alias parity. Recapture exact live source and use the release guard before any later publication.
- Owner decisions remain: iOS, free app, USA, platform copyright Reylumi, users/rightsholders retain existing submission rights, no arbitrary universal minimum age.

## Implemented

1. Tax personal profile erasure composes the existing Forum/personal erasure functions, covers future finalization and already-pending leased jobs, and prevents completion while the profile remains. The supported profile writer locks and rechecks account status to prevent a stale request recreating the profile.
2. Shared Tax documents/messages/events, paystubs and financial records keep their existing access/custody rules. Completed historical accounts are not swept. Historical residual review needs a bounded plan.
3. New export metadata receives a database-controlled seven-day lifetime, immutable identity/path/expiry and requester-bound authorization. Expired metadata and new authenticated reads are denied.
4. Storage operation-aware restrictive RLS disallows direct signing, signed-upload issuance, unsupported upload protocols and object replacement for this bucket. Ordinary authorized upload/read operations remain scoped to their matching metadata. The application issues a capped download URL using a private service signer only after requester/id/path/bucket/status checks.
5. URL lifetime is separate from file access: newly issued URLs last at most 15 minutes and are capped to remaining lifetime. Both Account and Salon backup notices receive the actual download expiry separately from the hosted export expiry.
6. New exports enter a leased expiry queue. The worker removes through Storage API and records completion only after database metadata absence is verified. Failures remain retryable. The existing authenticated maintenance route is reused; no extra cron was created. The local background-dispatch disable flag protects the route.
7. Pre-migration files are not automatically placed in the physical-purge queue. Previously issued download/upload bearer tokens are not revoked by new RLS; their original expiry or removal/revocation must be reviewed separately. New code must not claim all historical access is revoked.
8. The local legal candidate identifies Reylumi LLC, preserves user/rightsholder ownership and limits service licensing by purpose/audience, separates private records, preserves nonwaivable rights, narrows support promises, explains sensitive Tax/payroll records and removes the unsupported 24-hour deletion claim. Dates/routes/section IDs are preserved for review; this is not the published final version.
9. The deletion confirmation email no longer labels all retained business records as legally required. No email was sent during verification.

## Verification

- Fresh source-bound production build and offline asset build: passed, with background dispatch disabled and placeholder public configuration. This does not verify hosted provider configuration.
- TypeScript and scoped ESLint: passed.
- Focused combined suite: 47/47 passed, zero skipped, including actual PostgreSQL sessions for the stale Tax writer.
- Full isolated Supabase: 430 migrations passed, including both new migrations. Cached Postgres 17.11.0.006, GoTrue 2.197.0, Storage 1.84.19 and PostgREST 16.5; no external network, published host ports or production credentials.
- Actual isolated Storage upload/own download: allowed. Outsider download, direct authenticated signing/signed-upload issuance and expired authenticated download: denied. Service signing, API removal plus database checkpoint: passed.
- Future Tax erasure, a pre-existing pending job, actual isolated GoTrue hard-delete and final completion: passed.
- Actual built Terms/Privacy/Community/Business routes rendered at widths 390, 820 and 1280: all 12 checks passed, no horizontal overflow. Chromium evidence is not Safari, installed iOS or physical-device acceptance.
- Fixed sources used by the validation copy are hash-compared with this worktree before freezing. Dependency installation was isolated in the validation copy; another chat's dependency directory was not changed.

Detailed evidence is in artifacts/ios-store-privacy-20261116/: tests-final-complete.log, build-final.log, typecheck.log, lint-final.log, legal-preview-result.json, tax-erasure-concurrency.json, and full-schema/privacy-full-schema-acceptance.json.

## Reviewable next decisions

- [Moderation flow proposal](ios-store-moderation-proposal-20261116.md): preserve spam monitor-only; add a separate public-content safety layer. New shared-photo approval is a proposed behavior change, not implemented.
- [Age-rating worksheet](ios-store-age-rating-worksheet-20261116.md): actual feature candidates and unresolved content-frequency/region checks. No age answers were written to Apple and no 4+ rating was invented.
- Legal text is in lib/legal-policies.ts. Phone previews are in artifacts/ios-store-privacy-20261116/legal-preview/.

## Gates before publication/submission

1. Integrate with the exact current live source/schema/ACLs. Both migrations fail closed if required installed shapes or Storage operation helpers differ. Perform hosted preflight and provider acceptance; isolated containers are bounded evidence.
2. Review historical Tax-profile/export residuals and previously issued bearer tokens separately; no retroactive bulk purge or signing-key rotation is authorized by this patch.
3. Complete named provider/data-purpose/recipient/log/backup/retention evidence, sale/share/tracking classification and final Apple App Privacy labels. Do not choose Data Not Collected from the native manifest.
4. Confirm actual support/privacy intake, operator contact and staffing; finalize applicable rights/child-data handling and legal declarations. Candidate text is not proof of these operations.
5. Decide and implement the public-content filtering flow and moderation staffing, then test report/block/removal/appeals on every surface. Source monitor-only is preserved in this phase.
6. Review the final policy diff and publication dates. No arbitrary cap, arbitration, new waiver, DMCA registration or blanket user assumption of the platform's own duties was inserted.
7. Align native marketing version with the store draft, build from the exact integrated source and choose a newer valid build after a fresh Apple check. Preserve uploaded native changes and verify packaged privacy report, physical journeys and store review access.
8. Fill free pricing/copyright/Content Rights/age/review details with authorized verified facts; read back the saved values. No store submission or public listing is implied by this preparation.
