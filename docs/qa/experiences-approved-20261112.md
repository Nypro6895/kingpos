# Customer experiences — approved proposal implementation

Date: 2026-11-12. Source baseline: ec2c292bb574d5db53a5bd4ea3c85dbfea376e9c.
Worktree: C:\Reylumi-worktrees\experiences-approved-mockup-20261112.

Implemented the approved proposal: rounded white cards, author/date/verified row,
compact teal All/Positive/Concerns filters with an independent verification checkbox,
sentiment badge, inline outline Reply, one expanded gray composer, Cancel and Send reply.
Report and Block remain available inside each card's options. Existing server actions,
permissions, one-shot reply rules, customer resolution and LUMI Truth behavior are preserved.
Dates and text use real records. No sample content is shipped. The shared profile header
and global navigation retain their established components; the generated reference is
not a pixel-exact specification of these shared controls or of every responsive width.
Vietnamese UI translations were added for new copy. Filter state is remembered.
Drafts survive Cancel and switching between cards. Both reply paths retain failed drafts;
verified replies retain the idempotency key for retries. Successful replies cannot resubmit.

Validation:
- 13 focused browser/component/database tests pass (approved UI, compact profile,
  existing final-feedback browser suite and PGlite feedback integration suite).
- ESLint passes for modified product TypeScript.
- TypeScript noEmit passes.
- No horizontal overflow at 320, 390, 430, 768 and 1280px in actual extracted components.
- Full Next.js source ran at http://localhost:3149/salon-profile#customer-experiences,
  authenticated as an existing synthetic local QA owner. Heading and filters render,
  no horizontal overflow. The existing QA salon has zero experiences; populated cards
  and reply behavior were verified in the component browser suite with isolated actions.
- Live Preview registered to this exact source/port. Backend: existing loopback-only QA;
  no production configuration. Dispatch disabled and external server fetch blocked.
- An additional existing profile-header-compact test fails its pre-existing source
  assertion forbidding priceHint, which is already passed by the baseline header.
  Header source was not changed by this task. This is not a new visual regression.

Evidence (local, ignored): artifacts/experiences-approved/browser/{list-390,reply-390}.png,
browser/results.json, full-page-390.png and full-page-results.json.
No deployment or native/physical-device acceptance. Web-compatible UI; no native bridge,
Swift or bundled configuration change. Release coordinator must integrate the scoped patch
against its then-current production source and assess app-local bundle packaging normally.

## Owner refinement — 2026-11-12

Verified Visit now follows the customer name on the identity row. The Reply opener
is compact teal text with no border, background or button padding. Cancel and Send
reply retain their existing composer controls. Feedback/reply rows are shorter.
Responsive wrapping remains available for long names.

Validation: updated component browser and compact-profile suites 4/4 pass, ESLint
and TypeScript noEmit pass. Screenshots refreshed at 320/390/430/768/1280px; the
390px list was visually inspected. The same exact-source server and Live Preview
registration are reused. No deployment.

Owner refinement: removed the pending "Awaiting a salon response." helper from
experience cards. Acknowledged/resolved messages and underlying issue state remain
unchanged. Compact browser/profile checks: 4/4 pass. No deployment.
