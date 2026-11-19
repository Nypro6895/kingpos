# iOS submission business data map — 2026-11-16

Internal inventory at commit `5b9609cc5faec74ae0893ed86d76a3d1970c3f66`. **Local candidate; not App Store Connect answers, legal approval or hosted schema parity.** Product files were read only. No live private customer/HR/tax/support content, provider settings, credentials or Apple metadata was read.

The [fresh public-policy readback](../artifacts/ios-submission-scope-20261116/public-policy-readback.json) separately records published copy that differs from this candidate. Do not treat policy fixes or migrations here as live. Root must reconcile the exact submission source/features. [Machine-readable map](../artifacts/ios-submission-scope-20261116/business-data-map.json) contains every group, question and source-file hash.

Apple candidates use [current Apple definitions](https://developer.apple.com/app-store/app-privacy-details/) checked 2026-11-16. Identifiable business customer/employee records count in the inventory even when entered by a salon. Business use, optionality, hashes and encryption do not establish exclusion or unlinked data. Provider secondary-use and tracking answers remain unresolved.

## Decisions supported by source

- Check Writer exposes bank account plaintext to authorized server PDF generation. **Payment Info cannot be excluded app-wide merely because Stripe card entry is external.**
- Retained payroll legal-name/pay snapshots remain identifying after profile deletion; business history is not automatically anonymous.
- Tax UI invites SSN/tax forms/EIN. Record government identifiers in the notice/risk map, but do not mechanically tick Apple Sensitive Info from ordinary legal sensitivity wording; classify actual document payloads.
- Existing account-deletion export is useful preparation, not a complete all-domain personal-rights response.

Owner confirmed **Market and advertising-credit transactions are included in the first iOS audit/declaration scope**. The separate commerce/attribution inventory must verify runtime activation, prices and providers. This confirms audit scope and does not authorize billing changes.

## Verified groups

### Account and Auth

**Data:** Auth identity/session/recovery state; user/Auth IDs, name/email/phone/avatar, language/timezone, status and activity timestamps.

**Access/recipients:** Self profile RLS; server/Auth operations; feature-specific public identity presentation. Infrastructure authority is separate from end-user access.

**Export:** Deletion archive contains identity/status, impact and lifecycle events; not a complete Auth/session/social/Tax subject-access package.

**Erasure/retention:** 30-day pending schedule; due finalization neutralizes covered profile fields, clears covered security state and disconnects links. Completion requires Storage tasks and hard Auth deletion. Stable users.id and limited lifecycle/recovery references remain. 30 days is a pending period, not an exact all-copy removal deadline. Notification email cleanup after completion is worker-dependent. Backup/provider log retention is unknown.

**Apple candidates:** Name; Email Address; Phone Number; User ID; Photos or Videos (avatar). **Linked:** Yes for identity-linked records. **Purpose:** App Functionality.

**Purpose-based role:** Reylumi determines direct-account purposes; infrastructure provider treatment requires actual agreements and configuration.

Evidence: [E01](../supabase/migrations/202607240001_account_salon_baseline.sql#L14-L29), [E02](../supabase/migrations/202607240001_account_salon_baseline.sql#L7153-L7165), [E03](../supabase/migrations/202610140003_account_erasure.sql#L378-L450), [E27](../supabase/migrations/202610140003_account_erasure.sql#L79-L138), [E32](../lib/lifecycle-export.ts#L731-L831), [E37](../lib/account-erasure-worker.ts#L19-L61), [E45](../supabase/migrations/202608210003_account_deletion_flow.sql#L184-L193), [E46](../lib/account-erasure-worker.ts#L73-L86). Open questions: Q2, Q3.

### Customers, booking and visits

**Data:** Customer name/phone/email and customer/account IDs; private/internal/staff notes; service/staff/time/status/cancellation/visit history and payment-policy snapshots.

**Access/recipients:** Authorized salon roles and linked customer/self paths through RLS/RPCs. Public salon availability does not make customer notes public.

**Export:** Permission-selected customer/booking domains in salon archive, including notes. Personal archive only includes owned salon archives, not every salon relationship.

**Erasure/retention:** Account deletion releases customer_user_id but retains salon customer contact/notes/history and released_user_id metadata. Structural booking/transaction history survives. No universal end date or automatic general notes-minimization job established. A business label does not establish that every note is legally necessary.

**Apple candidates:** Name; Email Address; Phone Number; User ID; Purchase History; Other User Content (notes). **Linked:** Yes: customer contact and booking relations identify people without an active app login. **Purpose:** App Functionality.

**Purpose-based role:** Salon chooses service/customer purposes; instructed Reylumi processing is plausible with actual contractual and factual limits. Direct personal-account purposes remain separate.

Evidence: [E04](../supabase/migrations/202608100003_customer_identity_claims.sql#L976-L1006), [E05](../supabase/migrations/202607240001_account_salon_baseline.sql#L156-L205), [E06](../supabase/migrations/202607240001_account_salon_baseline.sql#L376-L416), [E08](../lib/lifecycle-export.ts#L241-L305), [E09](../lib/lifecycle-export.ts#L383-L479), [E48](../supabase/migrations/202607240001_account_salon_baseline.sql#L7221-L7284). Open questions: Q1, Q4, Q5.

### Staff directory and scheduling

**Data:** Legal/display name, phone/email/address/city/state/postal code, job title, account/Auth links; availability/time-block reasons/service assignments; public photo/bio/specialties/consent flags.

**Access/recipients:** Salon management/permission scopes and own linked staff paths; selected public profile fields depend on profile settings/consent. Payroll has additional restrictions.

**Export:** Selected roster/availability/assignments/time blocks in salon staff domain; not every staff or HR field.

**Erasure/retention:** Account links and public bio/photo/visibility/posting are cleared. Directory names/contact/address and business scheduling/payroll records remain. No automatic general staff-contact/address end date established. Public-profile withdrawal is distinct from business-record deletion.

**Apple candidates:** Name; Email Address; Phone Number; Physical Address; User ID; Photos or Videos; Other User Content. **Linked:** Yes for employee/account identity. **Purpose:** App Functionality.

**Purpose-based role:** Salon operational purposes plus separately enabled public profile/community presentation; allocate roles by actual purpose.

Evidence: [E03](../supabase/migrations/202610140003_account_erasure.sql#L378-L450), [E05](../supabase/migrations/202607240001_account_salon_baseline.sql#L156-L205), [E09](../lib/lifecycle-export.ts#L383-L479), [E48](../supabase/migrations/202607240001_account_salon_baseline.sql#L7221-L7284), [E50](../types/staff.ts#L1-L30). Open questions: Q1, Q4, Q5.

### POS, receipts and financial corrections

**Data:** Customer/booking/staff/ticket IDs, service prices/assignments, discount/tax/tip, method/amount/note, actors and correction snapshots; Gift sale/redeem summaries where rendered.

**Access/recipients:** Existing non-Staff salon permission policies plus restrictive financial scope. Staff receive own-work/earnings projections rather than shared full receipts or coworkers money.

**Export:** Permission-scoped POS ticket/items/payments/audit/turn domain; actual Gift/checkout commerce scope is separately inventoried.

**Erasure/retention:** Canonical closed business transaction/audit structures survive personal deletion. Removing a profile or social review does not remove the underlying sale. No universal POS end date established. A recorded Card method is not proof of PAN/CVV collection or processor settlement.

**Apple candidates:** Purchase History; User ID; Other User Content (notes); Payment Info (form-of-payment candidate; inspect actual fields). **Linked:** Yes where customer, employee or operator identities attach. **Purpose:** App Functionality.

**Purpose-based role:** Salon sale/reconciliation purposes; processor/settlement role cannot be inferred from bookkeeping.

Evidence: [E07](../supabase/migrations/20261029101200_financial_history_privacy.sql#L20-L79), [E10](../types/pos-ticket.ts#L18-L78), [E11](../types/pos-payment.ts#L1-L20), [E08](../lib/lifecycle-export.ts#L241-L305). Open questions: Q1, Q4.

### Payroll and paystubs

**Data:** Staff legal/display-name snapshots, periods/settings/work data, wages/commission/fixed pay, cash/check, tips/bonus, tax/withholding and final_staff_income; adjustments/reasons, payments/check numbers and paystub document bytes.

**Access/recipients:** Owner/payroll-authorized roles; restrictive RLS limits Staff to own staff rows. Current connected Tax handoff returns selected published-period report fields, not a general raw-settings grant.

**Export:** Payroll lifecycle domain and scoped Owner/Staff CSV paths; canonical income, recorded payment and adjustments are separate records.

**Erasure/retention:** Business pay/legal-name/settings snapshots, ledgers and business files remain; disconnection does not anonymize them. Leased retained-file COPY detaches obsolete Auth ownership while keeping bytes and access rules. No blanket period, employment classification or legal necessity established. Ownership correction has isolated API acceptance, not hosted rollout proof.

**Apple candidates:** Name; User ID; Other Financial Info; Other User Content (paystub/upload/notes). **Linked:** Yes: staff and legal-name/payment snapshots remain identifying. **Purpose:** App Functionality.

**Purpose-based role:** Salon compensation/recordkeeping purposes; Tax professional is a separate recipient. Employer/provider/professional duties depend on facts.

Evidence: [E07](../supabase/migrations/20261029101200_financial_history_privacy.sql#L20-L79), [E12](../lib/lifecycle-export.ts#L575-L616), [E13](../lib/payroll-export.ts#L6-L37), [E36](../supabase/migrations/20261116215000_retained_storage_ownership.sql#L9-L45), [E37](../lib/account-erasure-worker.ts#L19-L61), [E49](../supabase/migrations/20261110230000_tax_period_alignment.sql#L41-L60). Open questions: Q1, Q4, Q5.

### Tax profile, documents and communication

**Data:** Personal tax profile name/contact_email/phone/company_name; PDF/image documents up to10MB and names/titles/versions/period/recipient IDs; messages/author_name, receipt amounts/status and actor-name audit events. UI invites employee tax forms/SSN and business EIN; no structured SSN/EIN column is inferred.

**Access/recipients:** Profile self-readable. Salon Owner or active separate Tax connection can work in salon workspace. Active frozen document recipient keeps access after employment/link/plugin expiry or owner-side archive/delete.

**Export:** Authorized document download and selected payroll handoff exist. Lifecycle archive does not establish a complete Tax profile/messages/events/documents rights export.

**Erasure/retention:** Candidate removes tax_profiles for future/pending leased erasures. Shared docs/messages/events/receipts retain existing custody. Owner document delete archives/tombstones, not physical file removal. Historical completed profiles are not automatically swept. Historical personal-profile residual remains an inventory gate. No general Tax content end date established; delivered recipient copies need purpose/access/retention justification.

**Apple candidates:** Name; Email Address; Phone Number; User ID; Other Financial Info; Emails or Text Messages (private Tax messages); Other User Content / Photos or Videos (payload-dependent); Government identifier: User ID or Other Data Types candidate; unresolved. **Linked:** Yes by actor/staff/recipient/salon account links and document identity. **Purpose:** App Functionality.

**Purpose-based role:** Direct professional profile purpose differs from salon workflow processing and professional independent engagement/filing purposes.

Evidence: [E14](../supabase/migrations/20261109230000_tax_personal_workspace.sql#L4-L36), [E15](../supabase/migrations/20261109230000_tax_personal_workspace.sql#L39-L141), [E16](../app/tax/tax-workspace.tsx#L914-L920), [E17](../supabase/migrations/20261109230000_tax_personal_workspace.sql#L276-L290), [E18](../supabase/migrations/20261116210000_tax_profile_account_erasure.sql#L3-L44), [E49](../supabase/migrations/20261110230000_tax_period_alignment.sql#L41-L60). Open questions: Q1, Q4, Q5, Q6.

### Check Writer bank and check data

**Data:** Bank name/city/routing/account/fractional routing, issuer/address/masked last4; payee/amount/memo/date, encrypted bank snapshot, payroll linkage, issued/void/audit/output records.

**Access/recipients:** Server and DB require active salon Owner; session-bound unlock where required. Authorized server PDF generation accesses bank plaintext; keys stay server-side.

**Export:** Check PDF download/print contains bank/check information. Lifecycle archive is not a complete Check Writer/bank export.

**Erasure/retention:** Business settings/ciphertext/issuance/audit records remain. Downloaded/printed copies cannot be remotely recalled. Encryption is confidentiality, not non-collection or deletion. No general bank settings/check history/key-destruction deadline established. Actual commercial activation is a separate gate.

**Apple candidates:** Payment Info (bank account); Name; Physical Address; User ID; Other Financial Info. **Linked:** Yes where bank/issuer/payee and salon/Owner/payroll identities attach. **Purpose:** App Functionality.

**Purpose-based role:** Salon instructed check preparation. Source does not establish bank clearing/ACH or independent financial-services status.

Evidence: [E19](../types/check-writer.ts#L8-L45), [E20](../lib/check-writer-crypto.ts#L33-L73), [E21](../supabase/migrations/20261028040000_check_writer.sql#L8-L54), [E22](../lib/check-writer-server.ts#L21-L47), [E23](../app/api/check-writer/pdf/route.ts#L52-L82). Open questions: Q1, Q4.

### Support and case evidence

**Data:** User/case IDs, category/summary/body/replies/context, PDF/image evidence; guest name/email/message/request ID and keyed network hash; outgoing delivery content/recipient.

**Access/recipients:** Own-case or admin RPCs; guest history requires HMAC cookie. Evidence bucket private and signed after authorization for600seconds. SMTP/Resend are configured delivery candidates, not confirmed live configuration.

**Export:** Own/guest conversation and evidence download exist; no complete support-case rights export established in lifecycle archive.

**Erasure/retention:** Reviewed personal erasure chain does not scrub support_case_messages/report free text. Generic planner classifies support-evidence retain_business; bucket label does not establish case-specific necessity. 30-day guest cookie and600-second links are access lifetimes, not case/blob retention. No universal support retention timer established.

**Apple candidates:** Customer Support; Name; Email Address; User ID; Photos or Videos / Other User Content (attachments). **Linked:** Yes by account or guest name/email/case; keyed network hash is not automatically anonymous. **Purpose:** App Functionality.

**Purpose-based role:** Reylumi direct support/enforcement purpose; hosting/delivery provider treatment requires actual agreements.

Evidence: [E24](../supabase/migrations/202610070017_user_support_cases.sql#L1-L82), [E25](../app/(legal)/api/contact-support/route.ts#L29-L44), [E26](../lib/guest-support.ts#L5-L20), [E27](../supabase/migrations/202610140003_account_erasure.sql#L79-L138), [E47](../lib/support-email.ts#L30-L80). Open questions: Q2, Q3, Q4.

### Beauty, Salon, reviews, experiences and Forum

**Data:** Author/profile IDs, captions/comments/reviews/replies, Forum topics/chat/follows/saves/reports and media. Candidate manifest stores hash/Storage identity plus classifier provider/model/policy metadata.

**Access/recipients:** Published content audience-visible; self/draft/moderation scopes separate. Forum chat is community content, not automatically private SMS. Candidate quarantine own-readable; verifier path separately privileged.

**Export:** Some salon review/looks/update domains and own views; not a complete all-community rights export.

**Erasure/retention:** Authored social text/media scrubbed/purged; structural/moderation references remain. Forum/experience extension applies. New image manifests/sources join erasure; old creator-only business classification remains unchanged. New private source eligible after7days, possibly removed earlier after approval; retries mean no exact physical deadline. Provider unconfigured/default unavailable. Avatar/cover are outside this new post-image pipeline.

**Apple candidates:** User ID; Photos or Videos; Other User Content; Customer Support (report/appeal context as applicable). **Linked:** Yes for author/profile/relationship/report records. **Purpose:** App Functionality; verify separately whether actual personalization/advertising adds purposes.

**Purpose-based role:** Reylumi community/moderation purposes; salon business publishing purposes separate. Future classifier needs selected provider/payload/retention verification.

Evidence: [E27](../supabase/migrations/202610140003_account_erasure.sql#L79-L138), [E28](../supabase/migrations/20261109220000_forum_privacy_completion.sql#L88-L119), [E29](../supabase/migrations/20261116220000_public_image_safety.sql#L9-L38), [E30](../supabase/migrations/20261116220000_public_image_safety.sql#L245-L285), [E31](../lib/public-image-safety.ts#L65-L106). Open questions: Q2, Q3, Q7.

### Lifecycle archives and downloaded copies

**Data:** Requester/subject/salon IDs, generated/expiry/state metadata, permission-selected operational JSON; account impact/events/owned-salon archives and recipient copies containing underlying data.

**Access/recipients:** Requester-bound metadata/path plus domain RLS; service signing checks requester/state and remaining life, at most15minutes for new links.

**Export:** Business/account-deletion preparation mechanism; not a full all-domain rights export of Tax/community/support/Auth/Check Writer.

**Erasure/retention:** Account erasure purges hosted personal exports. Candidate expiry blocks later authenticated access; newly created archives enter cleanup with retries. Recipient copies remain outside server deletion. New access7days and new link<=15minutes. Historical cleanup opt-in remains false until reviewed; prior bearer download/upload tokens are not automatically revoked by new RLS and require original-expiry/object-removal/revocation review.

**Apple candidates:** Underlying archive data categories; User ID (metadata). **Linked:** Yes by requester/subject and identifying contents. **Purpose:** App Functionality.

**Purpose-based role:** Underlying salon/domain purpose plus direct account/rights administration; export does not shift all retention duties to recipient.

Evidence: [E08](../lib/lifecycle-export.ts#L241-L305), [E32](../lib/lifecycle-export.ts#L731-L831), [E33](../lib/lifecycle-export-storage.ts#L74-L100), [E34](../lib/lifecycle-export-storage.ts#L151-L185), [E35](../supabase/migrations/20261116211000_lifecycle_export_expiry.sql#L11-L48), [E37](../lib/account-erasure-worker.ts#L19-L61). Open questions: Q2, Q4, Q6.

### Security, audit and pseudonymous identifiers

**Data:** Signed random device cookie/hashed device ID, keyed IP hash/country, account/action/source IDs; counters/restrictions/fingerprints/moderation/security audits and login/recovery state.

**Access/recipients:** Direct anonymous/authenticated table access revoked for security tables; service functions and permission-checked admin views remain. Hosting/Auth logs have separate unverified scope.

**Export:** Account lifecycle events exported; full abuse/provider/log records are not in account archive.

**Erasure/retention:** Core login/trust/recovery tables cleared. Distinct abuse/audit rows not universally erased; scheduled cleanup clears old network/device hashes while keeping event/action/account references. Cookie max90days; function has fingerprints7days, old event IP/device hashes30days and expiry-based thresholds; declared daily cron is not run-success proof. No universal audit/log/backup end date established.

**Apple candidates:** User ID; Device ID candidate; Coarse Location candidate (country); Other Usage Data candidate; diagnostics only with actual diagnostic payload evidence. **Linked:** Treat linked/possibly linked until de-identification demonstrated; stable hashes/pseudonyms do not establish unlinked data. **Purpose:** App Functionality for security; this map establishes no advertising/tracking answer..

**Purpose-based role:** Independently determined platform enforcement vs instructed tenant security/provider logging must be factually allocated.

Evidence: [E27](../supabase/migrations/202610140003_account_erasure.sql#L79-L138), [E38](../lib/abuse-signals.ts#L24-L45), [E39](../proxy.ts#L64-L77), [E40](../supabase/migrations/202610070008_abuse_prevention.sql#L10-L62), [E41](../supabase/migrations/202610070008_abuse_prevention.sql#L404-L415), [E42](../vercel.json#L12-L26). Open questions: Q2, Q3.

## Actual timers versus policy descriptions

| Control | Source establishes | Remaining boundary |
| --- | --- | --- |
| Account deletion | 30-day pending schedule; covered scrub, Storage steps, Auth hard deletion and strict completion | Hosted success, lawful record exceptions, backups and older completed-account residuals remain unverified |
| Tax personal profile | Future/pending jobs scrub tax_profiles; supported writer serialized with deletion | No automatic historical completed-account sweep; shared Tax content has separate custody |
| Lifecycle archives | New authenticated access7days, new link<=15minutes; new files eligible for leased cleanup | Old cleanup opt-in false; legacy bearer download/upload capabilities need inventory/removal/revocation review; downloaded copies remain |
| Image staging | New private source eligible after7days; may be removed after approval; retries; legacy excluded | Provider unconfigured; avatar/cover outside scope; no exact physical deletion timestamp |
| Business files | Exact leased service COPY detaches only deleting Auth ownership; bytes and private access preserved in local API test | No business-record destruction schedule or hosted deployment is established |
| Security | 90-day cookie; cleanup thresholds include7-day fingerprints and30-day event network/device hashes; daily schedule declared | Audit/account references and provider logs/backups have no universal verified end date; declared cron is not success proof |

[E43](../lib/account-retention-policy.ts#L30-L102) and [E44](../lib/legal-policies.ts#L704-L758) are retention descriptions/policy text, not category-wide deletion timers. No statutory minimum is used here to justify every field or indefinite retention. Support messages/evidence and shared Tax messages/events need specific retention and request-handling decisions; their preservation is not automatically an engineering bug or legally required.

## Roles depend on purpose

Salon chooses customer/staff/service/payroll and recipient operations; Reylumi can provide instructed hosting/calculation/storage/export. Actual limited-purpose contracts and practices are needed to establish provider/processor treatment.

Direct account, community, support, platform security and independently selected advertising purposes cannot all be relabelled solely salon processing.

Separate authorized recipient may determine independent engagement/filing/retention purposes. Connection credentials prove technical access, not engagement, legal authority or licensing.

Supabase Auth/database/Storage and application hosting are source recipients. Email/payment/maps/classifier depend on enabled routes/configuration. Live logging, region, retention, secondary uses and contractual role remain unverified.

These are factual allocation candidates, not a determination that a contract label alone establishes controller/business/service-provider/processor status.

## Hard questions source cannot answer

- **Q1 — Product/business owner with legal review:** Market and advertising-credit transactions are confirmed in first iOS audit/declaration scope. Verify actual runtime activation/prices/providers separately; confirm other role/feature availability, intended Tax uploads, professional engagement and who instructs processing. Source cannot establish employer/preparer status or legal necessity.
- **Q2 — Engineering/operations:** Verify hosted migrations, maintenance success/disabled flags, backup and log retention, historical deleted-account residuals and legacy bearer/file inventory. Local source/tests do not establish these live facts.
- **Q3 — Operations/provider evidence owner:** For each enabled provider gather exact payload/logging, region, access, retention, secondary uses and contracts. Do not ask the app owner to guess SDK behavior.
- **Q4 — Business owner with legal review:** Set record-specific periods/holds and request handling for retained customer/staff notes, payroll, Tax content, bank/check history, support/evidence and audits. A business label does not justify every field forever.
- **Q5 — Product/legal:** Confirm salon employee/customer notices, access/correction/deletion assistance, limits on free-text HR content, public staff consent and lawful recipient-access handling.
- **Q6 — Product/engineering with legal review:** Define a complete verified rights response beyond the account-deletion archive. Review historical completed Tax profiles and old exports/tokens without an automatic destructive sweep.
- **Q7 — Product/operations:** Keep image provider activation separate until approved provider, actual payload, retention and failure behavior are verified; avatar/cover protection is not inferred.

Location/search/advertising, binary manifests and full commerce are separate submission workstreams; this business map does not declare them absent. No Data Not Collected, universal No Tracking or blanket external-payment exception is supported here.

## Validation boundary

50 source references were line-validated and hashed against the local source. The [prior local combined receipt](../artifacts/public-image-safety/full-schema/public-image-safety-acceptance.json) records full433 cached Supabase migration/behavior acceptance with synthetic data: four retained buckets, unchanged bytes, private outsider denials, Auth hard deletion and strict completion. It is not hosted, provider-classifier, signed-binary, physical-device or store acceptance. No product edits, deployment, submission or message send was performed for this map.
