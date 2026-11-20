# Reylumi LLC — US first-release legal readiness, 2026-11-10

Internal work artifact; not published policy, legal advice or submission approval. Owner confirmed “Tên Reylumi LLC, phát hành tại Mỹ.” Applied **Reylumi LLC** as operator to both proposed policy introductions and **United States** as the first App Store market. Existing public policy source/dates, Apple metadata and production are unchanged. Deploy, upload and submission remain on hold.

## What this resolves and what it does not

Further owner confirmation: Ny said “Tôi sẽ tạo hộp mails đó. Hãy sử dụng nó” in response to the support@reylumi.com contact question. The designated privacy/legal address is therefore **support@reylumi.com**. Ny plans to create it; this is not confirmation of provisioning, delivery or monitoring. No postal address was supplied.

The entity-name question and first-market question are closed. Do not ask Ny to answer them again. The name does not establish state of formation, registered/notice address, signing authority or a state-law/forum choice. US App Store distribution does not prove the website excludes non-US users, providers keep data in the US, or every user is a US resident. Do not add a geographic block, US-only data-residency claim or extra market without authorization.

Updated deliverables: [Privacy/Terms draft](app-store-privacy-terms-draft-20261109.md), [App Privacy worksheet](app-store-app-privacy-worksheet-20261109.md). Existing D/E identifiers remain stable so open decisions and evidence can be tracked without losing earlier context.

## Remaining owner facts and decisions

| Priority | Concrete question / needed decision | Why it remains necessary |
| --- | --- | --- |
| 1 | What notice/business mailing address should Reylumi LLC publish, and who monitors/escalates requests at the selected support@reylumi.com? | Email choice is settled. Ny will create it; provisioning, receipt, replies and staffing remain to verify. No invented postal address. Do not send test email without separate messaging authorization. |
| 1 | Which ages may create client/community accounts and business/staff accounts? Who owns child-safety escalation? | No explicit minimum-age/date-of-birth gate was found by scoped app/lib/ios string search; absence of search hits is not proof of absence. Do not set 13/18, collect identity documents or promise parental consent without a product decision and counsel review. Apple age rating is a separate content questionnaire. |
| 1 | Which paid products actually launch, and who is seller/collector? Confirm subscriptions, credits/campaigns, salon service charges, cancellation/refund rules. | Product/payment categories need distinct review; sample Market cards are not an approved price list. Source integrations do not authorize legal promises or billing changes. |
| 1 | What first-party campaign measurement and external advertising/partner use is intended? Who handles reports/appeals and privacy requests? | Determines disclosures, choices and operational ownership; no no-tracking/no-sale/no-sharing promise is justified yet. |
| 2 | Confirm business processing roles and retention owner; supply counsel-approved schedule per category. | Existing technical preservation of payroll/tax/booking records does not prove legal necessity or a retention duration. Business documents and any processing agreement must align. |

These questions can be bundled for Ny after engineering evidence is assembled. Do not request blanket approval of placeholder documents. Counsel must choose/review governing law, dispute process, mandatory consumer protections, content license, liability language, acceptance/change notices and any state-specific rights; this task does not invent those provisions or require a particular arbitration clause.

## US-specific verification, not an applicability opinion

Official references checked 2026-11-10:

- [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions): child-directed services and certain actual-knowledge collection require assessment. An age label alone does not settle coverage. Counsel/product must evaluate the intended audience and real collection before finalizing D6; no claim that COPPA applies or does not apply to Reylumi LLC is made.
- [California Attorney General CCPA overview](https://oag.ca.gov/privacy/ccpa): coverage depends on business facts and statutory criteria. Obtain applicable revenue/volume/sale/share facts privately for counsel; do not put business metrics or personal data into the repo. Do not infer exemption from LLC status or assume California is the only relevant state.
- [California privacy policy guidance](https://oag.ca.gov/privacy/facts/online-privacy/privacy-policy): use as a disclosure review aid, not a universal template. Counsel should separately assess state privacy/online-policy laws, consumer and employee/business data, rights, appeal/opt-out and applicable signals. A CCPA threshold assessment alone does not finish that work.
- [FTC CAN-SPAM business guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business): assess actually enabled commercial email and distinguish it from transactional messages. Sender/address/unsubscribe operations require verification if marketing launches; no marketing sends or opt-out changes performed.

Apple distribution rules remain separate from US legal analysis. Review actual paid features/storefront under [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); do not infer external checkout eligibility solely from US distribution. [App Privacy definitions](https://developer.apple.com/app-store/app-privacy-details/) still require real provider/data-flow evidence. No declaration has been selected or submitted.

## Engineering evidence still missing

1. Actual enabled provider configuration, regions, payloads, logs/retention/secondary uses and contracts (E1–E4). No credentials or vendor dashboards were accessed in this revision. Source-only inventory cannot close these rows.
2. Exact paid-feature inventory and actual checkout/recurring/refund behavior (E8); no money, pricing or production configuration changes.
3. Safe hosted and installed-app deletion/report/block acceptance (E5–E7), scheduler/Storage/Auth completion and account-switching checks; historical already-finalized deletion inventory and bounded remediation plan. The local PostgreSQL race test used a reduced schema; it is not hosted acceptance.
4. macOS native tests/archive, actual packaged manifest and SDK/privacy-report review, bundled native UI and physical-device acceptance. Windows/source checks cannot replace these.
5. Final integrated current-production source/schema/ACL comparison, reviewed policy/label/permission/age-rating consistency, working public URLs/contact and authorized review access. Existing build-97 receipts do not prove current Apple status or legal readiness.

Local source checks in this revision confirmed the support-email constant and `ACCOUNT_DELETION_GRACE_DAYS = 30` in `lib/account-deletion.ts`. The latter supports draft timing for the pending period, not the previous public wording's unverified 24-hour completion claim. Production source, provider settings and mailbox operation were not verified. No real deletion, report, block, email or payment was executed.

## Handoff / release gates

### Contact acceptance checklist (prepared, not executed)

1. Ny provisions support@reylumi.com under the intended controlled domain/account and identifies a responsible monitor plus escalation/backup. Do not put mailbox credentials, customer messages or screenshots containing private data in Git.
2. Obtain provisioning/status evidence or owner's confirmation; source constants or public DNS alone cannot prove a working mailbox. No DNS, mailbox/provider configuration or access rights were changed here.
3. With explicit messaging authorization or an owner-run test, verify receipt of a non-sensitive message from an independent address and ability to reply. Record only date/result and a sanitized reference, including whether spam filtering delayed delivery; never fabricate a successful test.
4. Confirm the operational process for privacy/legal requests: triage, safe identity verification, restricted access, escalation and applicable deadlines reviewed by counsel. No unsupported response-time promise. Email must not replace the existing in-app deletion initiation.
5. Before publication, confirm the selected address consistently appears in final reviewed Privacy/Terms and the appropriate support/contact surfaces; check visible mailto behavior on web/iPhone. Do not invent a separate Privacy Choices URL or treat an email alone as the public Privacy Policy URL required by Apple.

Contact readiness is currently **pending**, not failed or verified. These prepared checks require actual mailbox operation; no email was sent and no new mailbox was created by this task. Other E1–E8 work remains as listed above, without new configuration, hosted or archive evidence in this documentation revision.

Drafting is complete for currently confirmed facts. Final legal wording remains blocked on the specific owner/counsel decisions above; App Privacy final answers remain blocked on evidence, not merely consent. Once those are resolved, prepare a concrete final policy diff and declaration worksheet for authorized review, then reconcile all hosted/native acceptance gates. No public-policy edits, deploy, TestFlight upload, Apple submission or production changes are authorized by this confirmation alone.
