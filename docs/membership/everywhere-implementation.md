# Salon membership identity across web surfaces

The universal web revision supplies 199 scoped source edits across 72 current shared files, including 100 directly rendered salon-name sites plus role-aware workspace names, headings and salon comment attribution. One compact `SalonName` presentation keeps the marker at its natural width while long text truncates. The full name remains available to assistive technology and on hover. Existing links and buttons keep their actions; the marker adds no click or modal.

## Coverage

| Area | Included identity surfaces |
| --- | --- |
| Public discovery | Explore cards, map selections, search/detail variants, nail inspiration, Beauty/look attribution, salon profile/header/home, saved salons and salon report context |
| Social | Salon post publishers, salon attribution on personal posts, confirmed salon replies in comments. Personal authors, staff names and optimistic replies are never given a salon mark. |
| Customer | Booking flow, guest booking management, booking/visit/activity history and drawers, receipt previews, notification visits, customer claim preview and phone check-in |
| Workspace | Desktop/mobile navigation and workspace switchers, quick workspace list, My Place, salon lists/settings, connection lists, owner invitations, staff Today/workday and report headings |
| Platform Admin | Business list/detail/reviews, related salon headings, claim/verification queues and report evidence |
| POS | Owner POS identity/receipt-preview headings, portable brand/tabs/editor/check-in, customer welcome/receipt display and check-in receipt UI |

Native select-option text, metadata, image descriptions, editable inputs, confirmation phrases, financial print/export payloads and prose mentioning a salon remain strings. The identity next to the relevant action/list uses the shared marker. Pre-authentication phone-history labels intentionally have no canonical salon ID: the shared text presentation is used, but names alone cannot grant membership. Seeded/sample salons likewise never acquire a mark by name matching. This is the intended coverage boundary, not an unresolved wiring list.

## Authority and refresh

The same existing active, versioned membership benefit applies. Public requests preserve the public-salon visibility authority. Private salon affiliation is returned only through existing salon membership/management access, linked customer ownership, tax-company access, or the existing Platform Admin read permission with signed Admin-session context. A known salon ID alone does not grant private affiliation.

Portable credentials stay in the existing HttpOnly cookies and are checked by `pos_portable_access_salon_id`; the HTTP endpoint respects the existing local lock. Display tokens, relay entries, visit references, owner invitations and customer-claim tokens delegate to their existing read authorizers. The badge projection is read-only and returns only the eligible salon ID and validity end time.

The in-memory store deduplicates repeated salon IDs and batches at most 100 IDs per HTTP request. There is one refresh interval for mounted markers, not a timer or request per row. Hidden documents stop polling. Evidence expires at the membership deadline or after 30 seconds without refresh. Regular cancellation refresh is 15 seconds. Focus, restored pages and identity-reset signals withdraw stale evidence; an aborted response from an older identity generation cannot restore the check. Scope keys come from the existing ExperienceScopeProvider; cache contents are never persisted or shared across account scopes. This display is not an authorization guard for salon operations.

## Source delivery

The canonical checkout contains unrelated work from other chats. It was not modified. `salon-name-adapters.json` is the frozen scoped patch: each shared file has its source SHA-256 and exact reviewed edits. It preserves the current shared content and refuses drift before writing any candidate file. The earlier initial adapter copies must not overwrite these newer shared modules.

To assemble against the captured release baseline, review/rebase any reported drift and apply this patch to a separate candidate:

```
node scripts/apply-membership-name-adapters.mjs <release-baseline-source> <separate-candidate>
```

Include the current `components/salon-member-badge.tsx` and its CSS module, `lib/salon-member-store.ts`, `app/api/membership/salon-badges/route.ts`, and all four membership migrations in dependency order. Apply existing membership Admin navigation/settings changes alongside this scoped patch. The full assembled release still requires its production build and hosted acceptance; this task does not publish or migrate production.

## Verification

- 30 automated tests pass: existing membership behavior plus public/private eligibility, read permissions, resource-reference delegation, portable signature scoping, local-lock HTTP routing, response sanitization and atomic source-drift refusal.
- Current-source TypeScript: baseline 0 diagnostics, candidate 0 diagnostics across the patched modules and new feature modules.
- New feature ESLint passes. Shared-module lint retains the existing booking-workspace effect diagnostic, with no new diagnostics from identity edits.
- Local browser: 105 unique salon IDs require two lookups; repeated IDs deduplicate; nonmembers/personal profiles remain unmarked; a long name leaves space for the check; expiry/revocation/reset and late-response handling pass.
- Actual reviewed Profile, Explore card, post identity, saved list and role-aware navigation presentation is exercised at 1440 and 390 pixels. A discovered profile-heading flex overflow was fixed with `min-width:0` and checked again. Screenshots use sample data and local authority/action stubs, not hosted data.
- Existing desktop Membership Settings/Manage and public website workflow still passes.

These checks do not claim a production deployment, full hosted route-by-route acceptance, physical iPhone/WebKit acceptance or installed native-bundle compatibility. No Swift/native bundle changes were made; native release assessment must use the source of the actually installed bundle during combined integration.
