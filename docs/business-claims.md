# Business ownership claims

Implemented October 5, 2026. Public unclaimed salon profiles link to `/claim/<salonId>`. The shared profile view also covers the salon website presentation. Creating a salon checks existing public profiles as the user types and checks again on submission. Phone formatting and common street abbreviations are normalized; address matches require city/state context and the same suite. Phone-only matches can include shared business numbers. A match is a suggestion, never ownership evidence. The user may explicitly continue with a different salon. Browser session storage preserves the creation draft while visiting a claim page.

## Verification and granting

The claimant signs in, confirms authority, and chooses SMS or a voice call to the phone stored on the salon. Twilio Verify generates and checks the code; the client cannot change the destination, supply a provider SID, or grant ownership. Database reservations bind the provider SID to the requesting user, salon and send timestamp. Expiry is 10 minutes, with five checks per send, a 60-second cooldown, five sends per phone per hour and ten sends per user per hour. Limits apply across channels and across salons sharing a number. Provider failures do not release send limits.

Automatic approval requires an unclaimed listing sourced from a business website within 90 days, a phone unique among salons, and no other waiting or live pending claim. Imported directory listings require admin ownership review after phone confirmation. All approvals also require an active claimant and account, a salon that is not permanently closed, and an isolated imported account with exactly one salon and no nonremoved management memberships. SMS/voice possession is evidence of phone access; it is not independent proof of legal ownership.

Granting locks account, salon and request in that order, creates owner roles and account/salon memberships, claims the directory ledger, and expires competing requests. Profile IDs, URLs, followers and posts remain. Booking remains disabled until configured by the owner. Claims never award the blue identity badge. Existing managed salons accept support requests but cannot be approved through claims; an owner invitation or privileged ownership recovery is required.

## Support and review

Users who cannot access the listed phone submit a reason, with up to three optional private JPG/PNG/PDF documents, 5 MB each. Waiting applicants can add supporting information. Uploads are server-only; storage paths cannot be submitted through the authenticated support RPC. Documents are appended under a request lock and never replace prior evidence. Five support submissions per user per day are allowed. Only the applicant and authorized platform administrators can read a request. Admins open `/admin/claims`; reading requires `admin.locations.read`, and approving/rejecting requires `admin.locations.update_status` and a decision reason. Private file links expire after 60 seconds. Events record sends, evidence and decisions.

## Server configuration

Set these only on the server, locally in `.env.local` and separately in the production host's environment:

- `SUPABASE_SERVICE_ROLE_KEY`
- `REYLUMI_TWILIO_ACCOUNT_SID` (or `TWILIO_ACCOUNT_SID`)
- `REYLUMI_TWILIO_AUTH_TOKEN` (or `TWILIO_AUTH_TOKEN`)
- `REYLUMI_TWILIO_VERIFY_SERVICE_SID` (or `TWILIO_VERIFY_SERVICE_SID`)

Use a dedicated Twilio Verify Service with a six-digit code and SMS/voice enabled for the intended destinations. Keep fraud protection enabled. Verify handles voice delivery without a custom call webhook or TwiML endpoint. Trial-account delivery is limited by Twilio; confirm the account's allowed destinations before testing. Never test by sending unsolicited codes to imported salon contacts; use a consenting business phone. Real SMS and voice delivery were verified on a user-authorized test number on October 5, 2026; this does not establish delivery to every carrier or landline.

Twilio setup: the dedicated `Reylumi` Verify Service was created after the user confirmed the friendly-name authorization statement. SMS and Voice are enabled, the code length is six digits, Fraud Guard was kept enabled, and Voice DTMF input is required before reading the code. The user authorized storing the existing Auth Token in `.env.local`; it was saved without displaying it in chat or committing it. An authenticated read of the service confirmed that the local application credentials connect successfully, the code length is six and DTMF is required. A real SMS challenge and then a separate voice challenge were sent to the user-authorized number. The user supplied each received code, and both SID-bound VerificationCheck responses returned `approved`. These were provider delivery tests; they did not claim a salon. The temporary test file containing the destination and challenge IDs was removed after completion. The existing `King Nails` Verify Service was not modified. Production server secrets were subsequently configured with the admin-managed settings update below.

Migration `202610050006_business_claims.sql` was validated with rollback-only database tests, then applied to the linked database and recorded in migration history. No unrelated pending migrations were pushed. The application and admin settings are included in the October 5 production deployment.

## Validation

`tests/business-claims.integration.sql` covers normalized duplicates/suites, grants, private reads, missing permissions, cross-user cooldowns, stale send attachment, wrong SID, expired codes, changed phone, attempt exhaustion, replay, directory review, competing claims, private document append, and refusal to replace existing management. Run it in a transaction and roll back its fixtures. `tests/business-claim-provider.test.mjs` uses mocked provider responses and checks SMS/call parameters and SID-bound approvals without sending messages.

Production build, TypeScript, targeted lint, twelve related Node tests and the salon-creation routing check passed. The public claim CTA and login return path were checked in the browser. A temporary QA login checked the authenticated claim page, private upload availability, duplicate suggestions, and draft preservation on return. Claim at 390 px and creation at 390/320 px had no horizontal overflow. The temporary QA authentication user and isolated account were removed. No real business was claimed. Subsequent user-authorized provider tests confirmed both real SMS and voice codes as described above.
## Admin-managed Twilio (2026-10-05)

Platform owners manage messaging at `/admin/settings/twilio`: account SID, replacement Auth Token, Verify Service SID, optional booking Messaging Service/sender, master enable and claim SMS/voice switches. Blank token preserves the existing token. Test connection makes a read-only Verify request and sends no code. The same managed credentials power booking SMS and salon identity SMS; those require a separate approved Messaging Service or sender.

Configuration is AES-256-GCM encrypted in the private `platform_twilio_settings` table. Only server service-role reads are allowed. The encryption key is server-only `PLATFORM_SETTINGS_ENCRYPTION_KEY` (32 random bytes, base64); preserve it in deployment secrets when redeploying or restoring backups. Public metadata and the admin audit exclude the token. Database authorization rechecks the active platform owner, and changing account/service is blocked while unexpired claim challenges exist. Database failures fail closed rather than falling back to old credentials. Existing pending checks remain valid when new sends are disabled.

Migration `202610050007_twilio_admin_settings.sql` was applied. Existing authorized Reylumi Verify credentials were imported into the encrypted record and recorded in the admin audit. Server encryption key and Supabase service key were configured for Vercel production. Crypto/provider tests and private-table SQL checks passed.


Production deployment `dpl_49iPtoVb5Abn9AzitZBoKStAooH5` reached READY and was aliased to https://reylumi.com and https://www.reylumi.com. Live HTTP checks confirmed the public salon profile returns 200 with its claim link, claim redirects preserve the target salon, and admin claims/settings require login. The encrypted admin save action, blank-token preservation, read-only connection test, owner-only access, ciphertext authentication and configuration-switch guard passed automated tests. Both local and Vercel production builds passed.
