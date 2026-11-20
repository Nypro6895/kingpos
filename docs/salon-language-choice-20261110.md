# Salon language choices

Implemented for the language-settings discussion of November 10, 2026 (America/Chicago).

## Agreed behavior

- Personal workspaces use English. The Language selector shows English selected and unavailable package languages disabled. Its top-right information button explains salon-provided language packages without naming a particular language.
- Salon packages grant access; activation does not automatically change an owner's or staff member's language. English remains available. Choices belong to the authenticated user and salon, independently of other people and salons.
- Settings → Language and the profile language control display the effective language. Selecting an available language saves immediately; profile Save/Cancel continues to govern the separate profile draft.
- On the next visible salon app session, an unacknowledged package activation presents a popup in the offered language, with an English explanation. Switching saves and applies the choice directly; the popup includes a Settings → Language reminder.
- Later/Escape keeps the current language. Display acknowledgement is saved across sessions. The invitation remains available under Notifications → All for that salon, including a direct switch button. It is not an email, SMS, or push delivery.
- Requests validate the current workspace and database entitlement. An expired/removed package or revoked staff access cannot be selected. English is the fallback. A renewed entitlement after a lapse or a new installation requires fresh confirmation. Continuous subscription renewals retain the choice.
- New staff members discover the current package invitation on first use. Notices are deduplicated by user, salon, language and activation. Changing staff access does not reset an owner's continuing choice.
- Catalog/copy and offer adapter are separated for future languages. Vietnamese is the only additional renderer/package currently implemented. Adding another package still requires its entitlement adapter, catalog entry, translations and invitation copy.

## Conflicts resolved and affected logic

The old profile `users.language` was editable but did not drive translation. It is preserved as legacy data, removed from profile writes, and is not imported as consent. New `salon_language_choices` and `salon_language_notices` store explicit choices and durable acknowledgements. All authenticated data access uses restricted security-definer RPCs; direct table access is denied. Existing subscription billing, trials, pricing and portable flags remain intact.

Both server translation and the client language provider now use the same salon choice. A successful switch updates client text and refreshes server-rendered copy. The provider is keyed by viewer/salon/mode, ignores stale background results after a mutation, and ignores mutation results after unmount. Periodic visible-session/focus checks discover changed offers and update expiration. Package changes do not rely on localStorage.

Personal/customer routes retain their existing English boundary. Portable POS is a shared device session without an individual account language identity; it retains its separate salon portable configuration. No Swift or bundled native bridge contract changed; a native binary is not required for this web-compatible change.

## Verification

- 9 focused tests passed: real React browser interactions, PGlite migration/RPC execution, existing subscription/plugin tests, workspace/portable translation regression, Settings contracts and payment entitlement checks.
- SQL checks include own choice vs other people/salons, legacy language defaults, later acknowledgement, direct switch, English override, unsupported/stale offers, staff revocation, owner preference preservation, expiry/renewal and anonymous/direct-table denial.
- Browser checks include mobile/tablet/desktop widths, native modal, disabled personal options, package-neutral information, direct notification switch, persistence, failed saves, stale reads and switching workspace during an in-flight save.
- New TypeScript modules pass ESLint. Project TypeScript passed. Production webpack compilation and its TypeScript stage passed, but the full build fails during page-data collection: `Missing Today quick access route for settings.` in `lib/today-quick-accesses.ts`. The same module failure was independently reproduced on the canonical checkout. It is outside this change.
- Three extended localization/Market tests also fail on both the canonical checkout and this source (dictionary coverage and existing browser bundle server-boundary dependencies). These are recorded as baseline failures, not passing checks. Two existing UI selectors were updated for the clarified staff-option label.
- Browser screenshots use the real React components and generated project CSS with fixture RPC responses; they are component proof, not authenticated hosted/native acceptance. See `artifacts/salon-language-choice-20261110/` for logs and screenshots.

## Integration and preview

The task is isolated at `C:\Reylumi-worktrees\salon-language-choice-20261110`. Canonical product files were not overwritten. A frozen task overlay and original touched-file baselines accompany the release journal. Apply only this overlay against the current release source; the worktree also contains inherited canonical work that is outside this task.

The exact-source Next development server runs at `http://127.0.0.1:3196/settings?section=language` and is registered to the owning chat in Codex Live Preview. Background booking dispatch does not start in development. The viewer was not launched. Authentication and the new migration are required to exercise real account choices in that app; no production migration or live deployment was performed. Chromium component screenshots do not establish iPhone/Safari acceptance.

Before publication: integrate against the exact production baseline, apply the additive migration through the authorized release process, resolve the pre-existing Today build blocker, complete the production build, and verify authenticated owner/staff sessions on hosted web. Status: needs integration; no deployment requested.

## Second-pass audit

The follow-up review found and corrected these additional cases:

1. A delayed server-rendered snapshot could overwrite an already-saved newer choice. This was reproduced against the prior component (`en` instead of the saved `vi`). Each database choice now increments an atomic revision; older initial props and background snapshots are ignored. Existing in-flight mutation/unmount guards remain in place.
2. An open language invitation could remain on a personal/customer route, or after a package was revoked. Popup rendering now checks the current route, current offer identity, expiry and accepted state on every render. Unavailable invitations are also excluded from notification cards.
3. A rejected account/workspace read previously left the last translated UI active. Explicit access-denied responses now remove offers and invitations and fall back to English. Temporary network errors retain the last verified choice until its entitlement deadline; they do not replay mutations.
4. The offer RPC originally inferred entitlement solely from whether the person owned the salon. A person with both owner and staff roles could therefore bypass `staff_enabled` while in a staff workspace. All application RPC calls now pass the active mode, which is checked against real owner/active-staff membership. A preference is still shared across eligible roles within the same salon, rather than being silently reset merely by switching roles.
5. A failed server-client setup no longer returns an apparent personal workspace for a salon session; it follows the scoped error/retry path.

The expanded SQL/browser checks cover these cases, including owner/staff dual roles, stale rendered props, popup removal on Explore and package revocation, and an access-denied response after Vietnamese is active. This revision replaces the previous implementation overlay for future integration; earlier frozen snapshots and journal events are preserved. No production data or releases were changed during the audit.
