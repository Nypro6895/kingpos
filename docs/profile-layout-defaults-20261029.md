# Profile layouts and default images — 2026-10-29

Owner approved the FIRST illustrated proposal plus default images, explicitly
discarding the later three-architecture redesign. Implementation only; no deploy.

## Result

- Keep the existing `booking`, `portfolio`, `balanced` preference keys and save
  action. Use continuous white/ivory canvases, botanical welcome backgrounds,
  compact service thumbnails for A/C and the existing editorial photo for B.
- A missing salon photo uses a decorative default. Own published photos / cover
  / published photo library take precedence. Broken or unsuitable large images
  fall back to defaults. If defaults also fail, the existing text/initials
  fallback remains. Booking uses the cover in the welcome background.
- Neutral manicure illustration for nails; neutral botanical fallback for
  unknown business categories. The existing category-aware resolver remains
  compatible when this patch is integrated with current canonical source.
- Defaults are labelled, noninteractive in the featured area, and never saved
  as uploads/posts/reviews/services. Existing content visibility and booking
  eligibility continue to control sections and actions.
- Settings adds three compact layout illustrations beside native radio inputs.
  Choosing a radio does not save until the existing submit action runs.
  Miniatures are illustrative layout previews, not live salon screenshots.
- New generated botanical WebP: 61,292 bytes, 1200 x 800. Four thumbnail WebPs
  are resized from existing repository nail illustrations, 13,558 bytes total.
  No external image host or credentials needed. Original AI asset remains in
  the originating chat's generated_images folder.

## Validation

- Full `npx tsc --noEmit --incremental false --pretty false`: passed.
- Scoped ESLint and `git diff --check`: passed.
- `node --test tests/salon-website-layouts.test.mjs`: 5 passed, including all
  visibility combinations, photo selection, reviews and grid reflow.
- `node --test tests/profile-layout-defaults.test.mjs`: passed; browser component
  fixture covers all layouts at 320/390/768/1280, empty/full/own/broken/hidden
  states, no fabricated content, image loading, radio selection and save flow.
- Existing photo-feed unit test: passed; other opt-in browser suites were not
  counted as passes when skipped.
- Screenshots under `artifacts/profile-layout-defaults/screenshots/`; combined
  `implemented-preview.png` is rendered from actual component fixtures, not AI.

## Integration boundary

Base is canonical Git HEAD `252612d`, isolated in
`C:\Reylumi-worktrees\profile-layout-defaults-20261029`. Canonical checkout has
newer dirty implementations in overlapping files. Do not replace those files
wholesale: merge this branch's scoped diff into the exact current release base,
preserving WorkspaceText, SalonIntroduction, post identity/engagement, layout
reflow fixes and category-aware default imagery already present there. This
change does not include or supersede those other chats' work.

Before a combined release, run source/build and authenticated route checks on
the assembled source. This task has no full Next production build, live-route
acceptance or physical iPhone evidence. It does not change Swift, bundled native
assets or bridge contracts and does not require a new native build by itself.
