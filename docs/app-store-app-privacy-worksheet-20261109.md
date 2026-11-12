# App Privacy worksheet — internal, not submitted — 2026-11-09

Based on source `494c3433f67d5734dfe104903469f51badb8577f`, [audited data inventory](app-store-legal-audit-20261109.md) and [draft policy/decision IDs](app-store-privacy-terms-draft-20261109.md). This is a provisional evidence worksheet, not App Store Connect answers. Current production configuration, the signed archive and provider secondary practices are not verified. No Apple metadata has been changed.

Owner update 2026-11-10: operator **Reylumi LLC**, first App Store market **United States**. These facts do not resolve any collection, linking, tracking, retention or provider row. See [US readiness](app-store-us-legal-readiness-20261110.md). No App Store Connect country selection was changed.

## Classification rules

Contact update 2026-11-10: Ny designated **support@reylumi.com** for privacy/legal requests and plans to create it. Selection is confirmed, provisioning and working delivery/replies/monitoring are pending. Do not change the public privacy URL or declare a working request channel on this basis alone. This choice does not change data-type, purpose, linking or tracking answers.

Use [Apple's current definitions](https://developer.apple.com/app-store/app-privacy-details/) (checked 2026-11-09). Collection concerns off-device access beyond real-time request servicing. Transmission alone does not establish retained collection; source-only local processing does not establish collection either. First verify logging, storage and vendor behavior. WebView product traffic counts. Optional features and different account roles do not exempt otherwise collected data. Do not select Data Not Collected.

For every row, complete: actual fields; feature/platform; recipients; duration; Apple type(s); all actual purposes; identity linking; tracking; evidence owner/date. Proposed purposes below describe verified functionality, not a complete list of production uses. App Functionality includes relevant account, security, support and feature operation; add Analytics, Developer's Advertising or Marketing, Third-Party Advertising or other Apple purpose only where evidence supports it.

Account/customer/workspace IDs and identifiable UGC are generally linked in the reviewed schema. Hashing/pseudonymous IDs are not sufficient to declare unlinked. Mark unlinked only after verifying Apple's de-identification conditions across collection and later use. First-party campaign measurement alone does not establish tracking; cross-company advertising linkage or data-broker sharing can. Tracking remains unresolved until recipient/partner uses are verified; do not assert “No” or introduce ATT/tracking without owner review.

## Provisional category mapping

| Apple data type | Source evidence and proposed purpose | Linking / decision / missing evidence |
| --- | --- | --- |
| Contact Info: Name, Email Address, Phone Number | Auth/profile/customer and staff workflows; `lib/supabase/`, policy inventory; App Functionality | Account/customer-linked. Confirm exact optional fields, verification and enabled messaging vendors (E4). |
| Contact Info: Physical Address | Salon/business addresses; location provider requests | Declare personal/user-associated addresses where actually collected; don't classify every public business address as personal. Confirm customer/address fields and provider retention (E2). |
| Identifiers: User ID | Auth IDs, customer/user relations, memberships and report case binding | Linked; App Functionality. Campaign signup linkage may add another purpose if activated (E3). |
| User Content: Photos or Videos | Public/profile/salon uploads and Storage | Linked where author/profile/booking associated; App Functionality. Verify all upload entrypoints and retention, including embedded metadata. |
| User Content: Other User Content | Posts, comments, reviews, experiences, salon replies and Forum text | Linked; App Functionality. Confirm whether Forum chat is a public thread or private message before assigning message type; no all-UGC deletion claim yet. |
| User Content: Emails or Text Messages | Source has communications and support conversations; provider messaging paths | Assess actual private in-app messages and retained message contents/metadata. Not excluded merely because messages are non-SMS. Confirm activation and visibility; avoid double-counting same support content without reason. |
| User Content: Customer Support | Private support/report reasons, case messages/context, moderator handling | Linked; App Functionality. New report evidence resolves current canonical text; review queue retention and free-text scrubbing. |
| Purchases: Purchase History | Booking/POS service/ticket/amount history associated with clients/accounts | Linked; App Functionality. Confirm actual transaction fields and applicable roles; operational record can still be collected data. |
| Financial Info: Other Financial Info | Staff earnings, commissions, tips, payroll/tax operational values | Linked to staff/business users; App Functionality. Retention/legal grounds D4 unresolved. Don't omit because called business data. |
| Financial Info: Payment Info | POS payment-method fields plus Stripe integration | Examine actual fields accessible to app/operator and checkout location. External payment entry qualifies for Apple's exception only if developer never accesses payment info; no blanket exception for Stripe or claim card numbers are stored. E8. |
| Location: Precise Location | `lib/location/providers/` can send exact GPS lookup coordinates to server/provider | Purpose: nearby discovery/geocoding (App Functionality). Retained collection and linking depend on server/provider logs/storage; E2. Permission optionality doesn't resolve collection. |
| Location: Coarse Location | IP/country abuse signals and any retained coarsened location | App Functionality for security; possible additional uses not yet verified. Determine actual granularity/retention, don't re-label precise data coarse. E1/E2. |
| Usage Data: Product Interaction; Advertising Data; Other Usage Data as applicable | `lib/advertising-attribution.ts` campaign/session/device category/audience/path/time and signup; `lib/explore-advertising.ts` | Enabled campaign event fields/storage must be checked. Candidate purposes: Developer's Advertising or Marketing and/or Analytics, only if actual uses fit. Signup can link account. Partner sharing/tracking unresolved (E3). |
| Identifiers: Device ID | Source has session/device-category signals, not proof of a persistent device identifier | Device class alone is not automatically Device ID. Inspect identifier lifetime, IP-derived signals and provider identifiers before selecting/excluding (E1/E3/E4). No IDFA finding is asserted. |
| Diagnostics: Performance Data, Crash Data, Other Diagnostic Data | Native bounded local diagnostic facilities and hosting/request/error logs | Local-only files are not automatically collected. Trace user-initiated support attachment/upload and automatic telemetry; confirm actual retained payloads and linking before selecting each subtype (E1/E4). |
| Search History | Explore/search endpoints exist | Endpoint existence is not proof of retained search history. Check DB/events, access logs and provider logs before inclusion/exclusion. |
| Browsing History | App navigation/path measurement exists | In-app paths fit interaction/usage, not automatically Apple's external browsing history category. Inspect external navigation logging/partners before inclusion/exclusion. |
| Contacts, Health, Fitness, Sensitive Info, Audio Data, Credit Info, Other Data | No dedicated collection established by the scoped audit | Not a verified “No.” Inspect actual schemas/forms/uploads/SDKs for e.g. sensitive payroll fields, voice/video content or other data. Unstructured user text can contain personal information; counsel/product assessment needed. Do not invent permissions or features. |

## Provider and binary evidence to collect

| Evidence | Required result before final answers |
| --- | --- |
| Supabase, Vercel/BotID | Enabled services, request/storage/log fields, regions, access, retention, backup behavior and secondary uses; no secrets copied. |
| Stripe, Resend, Twilio | Activation per feature/territory, exact transmitted/returned fields, log/retention/partner uses; don't infer activation from dependency/config variable names. |
| MapTiler / Census | Which lookup paths execute, precise/coarse fields, server/provider logs, retention, linkage and contracts. |
| Advertising | Campaign activation, destinations/event schema, cookies/session lifetime, signup account linkage, third-party matching/broker use and required user choices. |
| Signed iOS archive | Actual SDKs/resources and aggregated Xcode privacy report; API-only manifest is separate from app-wide collection answers. Source lists Apple native imports but does not prove full binary contents. |
| Hosted/installed app | Safe-account network/data-flow checks, per-role features, report/block/deletion behavior, identity switching and diagnostic upload paths. No production destructive tests. |

## Decision and submission gate

Ny has confirmed Reylumi LLC, the United States first market and support@reylumi.com for privacy/legal requests. Remaining owner decisions include postal notice details, monitoring/escalation responsibility, audience, commercial features and intended advertising uses. Mailbox provisioning and delivery/replies remain unverified. Counsel reviews the resulting privacy/retention/rights obligations; engineering verifies E1–E8 and records per-row final purpose/linking/tracking evidence. Do not ask Ny to guess SDK or logging behavior. Confirm public policy URL and in-app accessibility only after reviewed publication is separately authorized; `/privacy` existing in source is not live acceptance evidence.

Reconcile label, Privacy Policy, Terms, permission purpose strings, actual app behavior and archive report. Optional Disclosure exceptions require all Apple criteria; no blanket exemption is claimed for support, payments, business accounts or opt-in features. Do not tick every candidate category “just in case”; resolve uncertainty with evidence. Do not accept declarations, modify App Store Connect, deploy or submit while the owner hold remains.

The reduced-schema two-session PostgreSQL test and 19/19 report tests support the documented engineering changes, not this app-wide declaration or legal compliance. Apple review requirements and legal obligations are separate; no approval guarantee is made.
