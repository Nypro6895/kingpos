# Wisconsin public beauty directory

The initial collection on October 5, 2026 includes 606 listings: 586 under nails, 10 under hair and 11 under massage (one business has both hair and massage). There are 78 city names. Every published record has a business name, street address and ten-digit phone. Email is empty when unavailable; 21 records have a published email.

## Website

The 606 businesses have been imported into the linked Supabase database as real `locations` and public `salon_settings`, with 606 published `salon_profile_updates`. Main Explore searches include these profiles and their reported categories. Each uses the standard `/explore/salons/<salonId>` profile, which supports following, contact details, directions and the reference post. `/explore/wisconsin` remains a contact directory whose links open these same profiles; old directory detail links redirect to the canonical profile. `/api/explore/wisconsin/export` downloads contact data with persisted salon IDs.

Each newly imported salon has its own ownerless account, preserving tenant isolation for a future verified owner. No account/salon management memberships, staff, booking services, fictional prices, appointment durations, customer reviews or reputation evidence are generated. Booking is explicitly disabled. The profile displays an unclaimed notice with its contact details and source, and unknown opening hours are shown as unconfirmed. Database changes and data import have been applied remotely; application display changes have been tested locally and have not been deployed to production.

## Provenance and limitations

- `data/wisconsin-business-sources.json`: 34 business-website records, with contact-source URLs. Source inspection does not mean phone verification or owner consent.
- `data/wisconsin-directory-sources.json`: 572 additional records collected from 78 Wisconsin city pages on NailSalonDirectories.com. Listings without a usable address or phone are omitted. The category and website links are reported by this third-party source, not independently verified. Source claims of "verified" and source ratings are deliberately not imported.
- The directory may contain stale listings or mislabeled categories and does not cover every Wisconsin business. Confirm details before relying on them.
- Stable IDs retain each record's identity for later linking to a claimed salon. Duplicate phone records in the business-website batch take priority over third-party entries; directory entries use phone plus street address as their identity.
- Reference introductions are generated from facts and clearly attributed to Reylumi. They do not reproduce source marketing descriptions, testimonials or reviews.
- Photos are currently empty. A small copyright credit is not permission to reuse customer-uploaded photographs. Add only photos with documented permission or a compatible reuse license, and store the source, photographer/rights holder, license or permission evidence and credit with each image.

## Refresh

Run `node scripts/collect-wisconsin-directory.mjs` to refresh the third-party batch. The collector reads public city pages with two concurrent requests, extracts factual name/address/phone/website fields from structured listings, and preserves the existing file if a page fails. It does not log in, bypass restrictions or retrieve photos. Check changed contacts and duplicate identities before deploying refreshed data.

Run `node --test tests/wisconsin-directory.test.mjs` to verify contact completeness, source attribution, reference-post labeling, search and parser behavior.

## Future business claims

`salon_directory_listings` persists the listing-to-salon link, provenance, reference post ID and claim state. The public read RPCs omit claimant identity. Anonymous and authenticated users cannot write to the claim ledger or assign themselves as owner. The claim workflow added in migration `202610050006_business_claims.sql` verifies the stored phone through SMS/voice or routes the request to ownership review, locks the account/salon before granting roles, and preserves profile URLs, follows and posts. See `docs/business-claims.md` for approval rules, support review and messaging configuration. Existing salon identity verification remains independent of ownership claims.

## Database import

Migration `202610050005_precreated_salon_profiles.sql` creates the provenance ledger and public read RPCs, and adds reported categories to existing discovery RPCs without creating operational services. It has been applied to the linked project and recorded in migration history. Generate the import SQL with `node scripts/build-wisconsin-salon-import.mjs`; this writes `supabase/.temp/import-wisconsin-salon-profiles.sql`. Imports are transactional, use deterministic UUIDs, skip already-linked listings, and preserve existing independently registered profiles. Repeating the initial import inserted zero additional profiles. Never push unrelated pending migrations as part of a directory refresh.

`tests/precreated-salon-profiles.integration.sql` checks public profiles, reference attribution, searchable categories, disabled booking, absent memberships and blocked client-side ownership writes. The initial migration and import passed these checks in a rolled-back transaction before the identical changes were committed to the linked database.
