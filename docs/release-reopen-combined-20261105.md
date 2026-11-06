# Combined Reylumi release, November 5, 2026

Web published: https://reylumi.com
Deployment: dpl_HzMkmRaFPcHaNLCQHGEuQEiibXeu
Previous deployment: dpl_ALqNQmC8UcaAKXi5ENHs15AGo3Bo
Native candidate commit: 2defa6574c8dbbd9f96017b7ac0be4a0ccca3b2d
Native workflow: https://github.com/Nypro6895/kingpos/actions/runs/42149564712

## Integrated groups

- touch-keyboard-review-20261105 (9342faa2-2ef2-48ac-90ef-3d4dc081ba2e)
- staff-customer-contact-privacy-20261105 (c0a333b7-c877-4a4f-aa44-9460d64ccde7)
- ios-bottom-safe-area-20261105 (8b1a64a2-eb2f-4aea-a6f9-e1ebf4db4e53)
- confirmed-iphone-queue-20261105 (43ac9602-e4db-44ee-a4e2-6e8bacc80d5a)
- pos-interface-compact-20261105 (17d79746-d0e5-4c41-96bc-bd90a01a3db6)
- ios-reopen-auth-20261105 (fc8d22bf-2eb8-418d-b7b2-de82a78fbaf8)

## Evidence

Production build and TypeScript passed. Candidate and live public routes passed. Downloaded Vercel source archive matched 4,318 deployment files. Staff contact migration normalized source hash matched exactly. 27 focused runtime checks, four database contact-privacy regressions, a phone/desktop contact-control browser case, seven responsive POS cases and 13 POS submit/gift/reward race checks passed. The existing startup/reset/home tests also passed.

Live unauthenticated Today context: HTTP 200, grantStatus 401, authenticated false, home /explore. Live guest Explore context: HTTP 200, grantStatus 200, authenticated false.

## Limits and other queue items

Native 1.0.0 build 96 is Apple VALID / IN_BETA_TESTING and available to the existing Reylumi Internal group. 246 native tests passed in 14 isolated hosts; source, signed/exported bundle and generated mappings were verified from workflow receipts. No App Store publication or physical iPhone acceptance is claimed. CoreDevice sees the iPhone but reports it must be paired before connecting; no device trust or account changes were made.

Older independent/unfinished handoffs remain inventoried in other-pending-audit.json. They were not applied wholesale to override current serving source. Existing Market/Check Writer activation gates and separate plugin projects remain unchanged.

## Final receipt

789fd075-f20b-4ed9-99a7-c1db69d925dd

![Database source hash verification](../artifacts/reopen-release/database-verified.jpg)
