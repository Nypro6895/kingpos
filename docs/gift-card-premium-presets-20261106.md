# Premium Gift Card presets — 2026-11-06

Follow-up to gift-card-designer-20261106. Worktree C:/Reylumi-worktrees/gift-card-designer-20261106; incremental base 4931e00. No deployment performed.

Replaces the three simple canvas presets with original generated artwork: Emerald Signature (malachite/champagne foil), Ivory Peony (ivory paper/sculpted florals), Noir Couture (charcoal/golden silk). Optimized local JPEG assets are 990x600, 41,350 / 47,456 / 50,912 bytes. Asset paths are versioned v2. Generated originals and final composite preview are preserved under artifacts/gift-card-designer/premium-originals and premium-collection.png. Artwork was generated with the built-in imagegen skill/tool; no stock/provider attribution claimed.

The picker displays complete card thumbnails. Choosing a preset embeds its JPEG as a data URL in the existing GiftDesign schema, preserving issued-card artwork independently of future asset hosting. Asset errors leave the draft unchanged and permit retry. Default selects Emerald Signature. Existing saved designs are not automatically replaced.

New elements have optional allowlisted font: serif or sans. The normalizer preserves only those values and leaves legacy elements without a font unchanged. New styled elements scale with card width; font choices also apply to saved-image text. Title, message and salon name remain editable; an actual salon logo is included when available. No database migration, financial operation, credential behavior or share/transfer behavior changed. Existing clients that do not recognize the optional font still have usable image/text data; final native asset/bundle evaluation belongs to release integration.

Validation passed:
- Scoped ESLint over the changed components/types.
- Scoped strict TypeScript, including customer saved-image component and preset loader.
- node tests/gift-card-presets.test.mjs: asset dimensions/bytes, embedded design size, optional logo, two-pass server/client normalization, legacy fallback and font allowlist.
- node tests/gift-card-designer-ui.mjs: actual components, synthetic transport, failed asset load/retry, all three preset selections and saves, editable fonts preserved, five viewport widths, image upload/crop/drag/rotation, save failure/retry, cancel and tab/Activity retention.
- Visual review of all three phone previews and premium-collection.png.
- Scoped diff whitespace check.

Limits: these are local browser/fixture checks. Authenticated hosted persistence and physical iPhone acceptance remain pending. Full production build was not rerun; prior whole-repo TypeScript was blocked by unavailable unrelated pdf-lib/fontkit dependencies. Integrate this incremental patch on top of the earlier Gift Card designer event against the then-current production baseline and rerun release checks. No publication authorized by this design follow-up.

Preview: artifacts/gift-card-designer/premium-collection.png.
