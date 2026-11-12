# App Store privacy and legal preparation — 2026-11-09

Publication is on hold by owner instruction. This is an engineering audit and an unpublished factual wording proposal, not legal approval or an App Store submission. No web, database, payment, security permission, Apple metadata, tester group or distribution change was performed.

Subsequent local engineering work is documented in [UGC completion](app-store-ugc-completion-20261109.md). The gaps below describe the audited build 97 baseline; several now have tested source fixes, which remain unpublished.

## Source and evidence

- Isolated branch: `codex/app-store-legal-audit-20261109`, starting at `acb17696eabeb49fc03a680b2610d4b6d1dc92bc`.
- That commit is the source identified by the November 6 build 97 receipt: `C:/Reylumi-worktrees/all-completed-release-20261106/artifacts/all-completed-20261106/native-final-verified.json`. The historical receipt records 1.0.0 (97), Apple VALID, internal TestFlight, 247 native tests. It explicitly does not claim App Store submission/publication. Apple status has not been freshly queried in this audit.
- Current production alias/source has not been captured. The offline Vercel CLI invocation failed because its package was absent from npm cache. Do not treat the historical deployment `dpl_4NjSvYQbEc8fV1EmTPN1hJPjtfyr` as a current verified alias.
- The shared `C:/Reylumi/kingpos` checkout is dirty and its native code is older. This task does not replace it or any concurrent task snapshot. Work is isolated under `C:/Reylumi/work/app-store-legal-20261109`.
- Machine memory and repo release policy were read. No repo `.agents/skills/SKILL.md` files were found in either the initial checkout or this isolated source.
- Detailed local evidence: `artifacts/app-store-legal-20261109/`. Native source hashes are in `native-inventory.json`; `native-before.json` records the pre-fix missing declarations.

## Technical fix prepared

The build 97 source has no `PrivacyInfo.xcprivacy`, despite direct required-reason API use:

| Category | Verified use | Declaration prepared |
| --- | --- | --- |
| UserDefaults | `ReylumiLocalAppTransport.swift`: read/write the app-local generation value with `.standard`; no suite/shared defaults found | `NSPrivacyAccessedAPICategoryUserDefaults`, reason `CA92.1` |
| System boot time | `ReylumiLocalAppTransport.swift`, `ReylumiLocalAppViewController.swift`, `ReylumiLocalDiagnostics.swift`: measure elapsed app events and operation durations | `NSPrivacyAccessedAPICategorySystemBootTime`, reason `35F9.1` |

Added `ios/Reylumi/PrivacyInfo.xcprivacy` containing these API entries. `ios/project.yml` explicitly copies it as a resource and excludes it from the general source glob to avoid duplicate inclusion. This does not change API use, tracking, permissions, payments or data processing.

The manifest deliberately does not assert `NSPrivacyTracking=false` or an empty collected-data list. App-wide collection, tracking and partner practice declarations remain a separate review. Absence of those declarations is not evidence that no data is collected, and this API-only file does not make the app submission-ready.

Source scan: 15 Swift files, 27 matching source lines, two detected categories. The baseline scan reports both declarations missing; the amended source scan reports none missing. The XML plist parses and has the exact two category/reason pairs. Parsed XcodeGen YAML has one explicit resource and the matching glob exclusion. Node syntax and Git whitespace checks pass.

No direct file-timestamp, disk-space or active-keyboard API use was found by the scoped scan/manual review. `URL.resourceValues(.fileSizeKey)` reads size, not a timestamp; `isExcludedFromBackup` sets a storage property. These were not assigned invented timestamp reasons. The scanner is heuristic and does not replace archive/binary analysis or review of future SDK additions.

Required next checks: generate the Xcode project on macOS, run native tests/archive, inspect `Reylumi.app/PrivacyInfo.xcprivacy` in the resulting archive and exported IPA, and generate/review Xcode's aggregated privacy report. Windows has no Xcode, so those checks have not run. Do not upload while the owner's hold remains in effect.

Apple references checked November 9:

- [Required-reason APIs](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api): declare the app's actual covered API use and approved purposes.
- [API category/reason reference](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype): UserDefaults `CA92.1`; elapsed-event timing `35F9.1`.
- [Privacy manifest resource](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk): add the file to the application target's resources.

## SDK and data inventory

The source XcodeGen app target declares no CocoaPods, Swift Package, binary framework or third-party native SDK dependency. Its Swift imports are Apple frameworks: BackgroundTasks, CoreFoundation, CryptoKit, Foundation, SafariServices, Security, SwiftUI, UIKit and WebKit. This is source evidence, not verification of a signed archive's complete linked libraries.

The web app and bundled JavaScript have separate dependencies, including Supabase JS, Stripe JS, BotID, MapLibre, jsQR, React/React DOM, Next, pdf-lib/fontkit and server-side sharp. `package-inventory.json` records locked versions. A JavaScript dependency is not automatically a linked native SDK, and lack of native ad SDKs does not establish absence of advertising data collection.

| Function/provider in source | Data/path evidence | What is still unknown |
| --- | --- | --- |
| Supabase Auth/database/Storage | account identity, sessions, membership, customer/booking/POS/payroll records, public content, uploaded files; `lib/supabase/`, account erasure worker | production region, contracts, backup retention, provider account configuration |
| Vercel / BotID | hosting/request handling, IP/country-derived abuse signals; `lib/abuse-signals.ts`, `lib/abuse-server.ts` | configured logging retention, any enabled platform analytics/monitoring, provider secondary uses |
| Stripe | checkout/billing/payment integration and browser SDK; Market uses externally hosted payment flows | enabled products/territories, actual returned payment fields, policy/contract approval; no payment change proposed |
| Resend | email API in `lib/support-email.ts`, recipient/message delivery; feature configuration may disable it | current activation, delivery retention and contractual disclosures |
| Twilio Verify | phone verification configuration and provider API in `lib/twilio-settings.ts` | current activation, countries, phone/log retention and contractual disclosures |
| MapTiler and US Census | `lib/location/providers/`: salon addresses and exact requested GPS coordinates sent to provider endpoints; MapTiler when configured, Census fallback | provider contracts/log retention; user disclosures and purpose selection |
| First-party advertising | `lib/advertising-attribution.ts`: signed attribution cookie, campaign/session/device-class/audience/path/time; signup event can include user ID through `record_advertising_event` | production activation, recipients, partner sharing and Apple's linked/tracking classification |
| Native local state | cookies, encrypted app read models, Keychain-protected keys, workspace preferences, bundled assets and bounded opt-in local diagnostics | signed archive inspection and end-to-end device/account switching acceptance |

Do not choose "Data Not Collected" from this inventory. Prepare App Privacy entries for contact information, user IDs, user content/support, purchases/financial business data, location and usage/diagnostic categories as applicable, then verify purpose/linking/tracking against actual configuration. Do not infer that pseudonymous UUIDs or hashed signals are anonymous.

## Deletion and UGC verification

All verification was local with test databases/mocks; no real account was deleted and no real report or block was sent.

The initial shared-checkout tests passed 40/40, but that checkout differs from the build 97 source. Re-running those nine test files against this isolated source yielded 38/40: the two failures were a missing unshipped SQL test fixture (`supabase/tests/account_deletion_flow.sql`) and an outdated browser mock missing `next/navigation.useSearchParams`. They are not represented as application runtime defects or ignored silently.

The browser fixture was copied into the evidence directory and its missing hook mock added without changing application code or its assertions. It then passed 1/1 against this source, testing report permission/submission failures, retrying the selected reason and hiding only the target. The static missing-fixture check remains unresolved in that imported test. Full logs are retained.

The existing Forum runtime, continuous-feed and campaign suites also passed 25/25. They cover existing access control, reporting/moderation and pagination; they do not test a personal block feature or Forum account-erasure behavior because those features were not found in the reviewed source.

The passing runtime/database checks cover storage failure before auth deletion, hard auth deletion after checkpoints, missing-auth retries, provider/final-verification errors, retained business objects, deadlines, content scrubbing, last-owner protection, bidirectional/reversible social blocking, private report records, moderator review enforcement and comment identity/abuse controls. They do not establish live cron health or provider execution.

| UGC surface | Existing source evidence | Acceptance status |
| --- | --- | --- |
| Beauty / Explore / salon looks and updates | shared `PostActions`, report/block permissions, shared post-safety modal and SQL blocking; report browser and database tests | local coverage only; live/authenticated/iPhone pending |
| Shared comments | shared comment thread and existing identity/abuse tests | inspect individual comment reporting affordances and runtime block behavior; post-level coverage is not complete comment-level acceptance |
| Salon reviews / experiences / replies | `BlockUserButton` on author, existing SQL test suppresses blocked authors/replies; erasure scrubs review/reply text and removes customer experience text | individual review/reply report affordance and live/iPhone acceptance still require review |
| Forum topics, replies, chat | forum controls expose Report; moderator restrict/delete/restore exist | no personal-user block control or `user_blocks` check found in Forum source/migrations; moderator restriction is a different capability |

Additional confirmed source gap: `202610140003_account_erasure.sql` does not scrub Forum topics/replies/chat, which were introduced later. Their author foreign keys use `ON DELETE SET NULL`, but the erasure flow keeps the public user row and removes Auth identity; even a null author would leave body text. The current Privacy statement that deletion removes authored social posts must not be considered fully true for Forum without a fix or a narrowly justified legal exception. No production cleanup or new deletion behavior was applied here because data retention/exception decisions remain unresolved.

[Apple's UGC guideline](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) calls for filtering, reporting/response, blocking and published contact information. [Apple's account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/) includes associated UGC, with legal retention explained to users. These gaps therefore remain App Store readiness blockers; this audit does not certify all UGC surfaces compliant.

## Unpublished factual wording proposals

These drafts are for `lib/legal-policies.ts` review. They have NOT been inserted into public pages or submitted to Apple. Keep the actual policy dates unchanged until a reviewed policy is published.

**Location paragraph:** "When you choose to use your location to find nearby salons, ReyLUMI sends the coordinates needed for the lookup to its server and a mapping or geocoding provider. The current implementation can use MapTiler or the U.S. Census geocoder. Public salon addresses may also be sent to these providers to place salons on a map." Confirm enabled providers and their retention before finalizing.

**First-party advertising paragraph:** "When you interact with a ReyLUMI promotion, ReyLUMI can record the campaign, session identifier, device category, audience category, page path and event time to measure campaign activity. A signup associated with a promotion can be linked to the new account." Confirm activation, partners, precise purposes and required choices before finalizing. Do not replace this with an unsupported "no tracking" declaration.

**Deletion completion paragraph:** "You can request personal account deletion in Settings and cancel during the displayed pending period. After that period, the service processes deletion and retries failed steps. The private status link shows whether deletion has completed. Certain business records remain subject to the retention and access rules described below." This avoids the current unverified promise that completion normally occurs within 24 hours. Do not finalize the complete deletion description until Forum coverage, cron operation and legally required retention are resolved.

**Provider paragraph:** name verified enabled providers and explain their functions, rather than saying providers "should" be disclosed in a public policy. Source integration alone does not prove production activation; use the inventory above as the configuration checklist.

## Decisions and remaining gates

Ny / counsel must settle the actual operating legal entity, address and privacy contact; intended territories; governing law/forum/arbitration/liability terms; age eligibility and minors handling; retention durations and legal exceptions by category (including payroll, tax, bookings, disputes, backups and UGC); actual payment/subscription/refund/cancellation terms and geographic rules; and any sale/share/tracking or statutory rights/opt-out obligations. No values have been invented.

Engineering follow-up: close Forum block and erasure gaps, review report coverage for every comment/review/reply surface, verify actual provider settings without exposing secrets, reconcile legal text/App Privacy/age rating with that evidence, perform macOS archive/privacy-report checks and test installed-app deletion/report/block with safe fixtures. Changes to access/security or destructive data behavior must stay within the owner's explicit boundaries and the release policy.

Submission additionally needs current Apple metadata/status readback, review contact and lawful image/content rights, a working review account provided outside the repository, and acceptance of the final legal declarations by the authorized owner. Do not create users/testers, accept agreements, change pricing or submit automatically.
