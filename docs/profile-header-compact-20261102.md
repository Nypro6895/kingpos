# Compact salon-profile header — 2026-11-02

Owner approved the header illustration with two corrections: remove public-view
actions completely and put Settings on the salon-name row. Code only; no deploy.

## Changes

- Website header Settings now belongs to the name row, including mobile and long
  names. Existing owner menu callbacks and permissions are preserved.
- Remove the ambiguous popular-price hint from the website header. Keep the
  underlying price calculation and service pricing elsewhere unchanged.
- Promote Experiences from overflow to the main website tab rail and remove the
  duplicate standalone header Experiences CTA. Narrow screens scroll the tab rail
  rather than wrapping labels or overflowing the page. Trust links and detailed
  Experiences/Trust sections remain distinct and functional.
- Remove View public profile from publication-status UI and the legacy studio
  shortcut. Preserve Not public guidance, preview and publication controls.

## Source and validation

Isolated worktree: `C:\Reylumi-worktrees\profile-header-compact-20261102`.
Base: `a07c49c18adb3e727e4c2b0b9f6a2ebdac106d26`, the verified Reports web release
source from `dpl_HqmigxW39vxi2SRAoYM1y4KjzB6G`. Canonical dirty work is untouched.

- Scoped TypeScript (header, parent view, studio, publication status and their
  imports): passed using `artifacts/profile-header-compact/tsconfig.json`.
- Scoped ESLint: passed. Scoped Git diff check: passed.
- New browser component test: passed; 30 viewport/layout/name combinations at
  320/390/428/768/1280. Confirms Settings/title alignment, no overlaps/page
  overflow, settings callbacks, direct Experiences access including empty state,
  visitor controls, removed public shortcut and retained unpublished guidance.
- Existing profile-default and website-layout suites: 6 passed, no skips.
- Screenshot: `artifacts/profile-header-compact/screenshots/owner-header.png`.
  This is a component fixture, not authenticated route or physical-device proof.
- Full-project TypeScript currently fails only on missing shared `pdf-lib` and
  `@pdf-lib/fontkit` dependencies in `lib/check-writer-pdf.ts`. No dependency
  installation or changes to the shared dependency tree were made.

No full Next build, deployment or authenticated iPhone acceptance in this task.
Release coordinator must merge the scoped change with its then-current baseline,
run production build and route checks. No schema, financial or native bridge
changes; this web-compatible patch alone does not require a new native binary.

The checkout has mixed historical line endings. Stage only the listed scope
using `git -c core.autocrlf=false add ...` to preserve existing CRLF source bytes;
do not mass-normalize the checkout or immutable release history.
