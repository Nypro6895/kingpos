# Reylumi member blue check

The blue check means **Reylumi Member**: a salon belongs to the Reylumi membership community. It is not identity verification, a quality guarantee, or a change to LUMI Truth scoring. Existing identity approval stays independent.

All three plan drafts offer `salon_member_badge: true`. Admin can switch it per plan in Settings → Plans & pricing, then Save draft or Save & publish in the existing batch workflow. The website renders the benefit directly from published settings. Migration does not publish plans, enroll salons, charge money or rewrite purchased plan versions. Missing benefit on an older version means no member badge until a new term includes it.

The authority is the current uncancelled membership term and its immutable version: `starts_at <= now < ends_at`, enabled benefit, active salon, existing public-profile visibility rules. Future renewals do not grant the check early. Cancelling, expiration or suspension removes eligibility. Credit exhaustion does not remove the check. Gift/trial/manual terms qualify when explicitly assigned an eligible version; affiliation does not claim payment was made.

`reylumi_membership_salon_badges(uuid[])` accepts at most 100 IDs and exposes only eligible salon IDs and validity end times. It does not expose plan, price, payment reference or private salons. Direct table grants remain closed. Public availability is determined by the existing `salon_profile_public_salon_exists` authority.

The shared `SalonMemberBadge` batches requests, uses canonical IDs rather than names, hides on failure, checks live status every 15 seconds and on focus/page restore, and removes the badge at its known expiration. Cancellation may remain visible for up to the refresh interval while a page is open; this is affiliation display, not an authorization guard. The marker is small, accessible and uses a tooltip rather than another persistent row. `MemberCheck` is presentation only and must not receive eligibility from editable salon profile fields.

## Source coverage and integration boundary

The initial four-adapter revision is superseded by the universal web source revision in [everywhere-implementation.md](everywhere-implementation.md). Its frozen scoped patch covers 72 shared files and includes the public, workspace, Admin and POS identity surfaces, with private access, role-aware names and refresh handling. The documented plain-text and pre-authentication boundaries remain intentional. Production deployment and hosted acceptance are separate.

## Local evidence

- 21 SQL/integration tests pass, including new membership badge cases: malformed config, default drafts, version preservation, anonymous data privacy, private/disabled salons, future/expired/cancelled terms and batch limits.
- `node scripts/verify-member-badge.mjs`: actual React component in a local browser fixture; 105 salons use two requests; nonmember and personal-profile IDs are unmarked; refresh removes revoked checks; exact expiration removes checks.
- `node scripts/verify-membership-browser.mjs`: all three admin toggles, existing draft/publication and desktop/phone workflow pass. Screenshot: `artifacts/membership-desktop/settings-plans-desktop.png`.
- Scoped membership TypeScript and ESLint pass. These checks do not establish the full current release build, hosted RPC acceptance, iOS/WebKit behavior or production coverage.
