# Gift Card designer — 2026-11-06

Implementation worktree: C:/Reylumi-worktrees/gift-card-designer-20261106
Base: cb6062a (existing integrated Gift Card implementation). No publication performed.

Cards metrics are compact and appear only in Cards. The owner management route preserves its mounted draft through Activity hide/reveal, remains authenticated and revalidated, and has no retained-data/prefetch permission. Other wallet/token/payment/API route policies remain unchanged. Tab changes are reflected in a non-secret URL fragment and restored after remount.

Design accepts JPG/PNG/WebP up to 20 MB with a decoded 50-million-pixel ceiling. Backgrounds open in a dedicated crop workspace with Move, zoom, arbitrary rotation, 90-degree rotation, reset, keyboard sliders, Cancel and Apply. Cover geometry prevents empty corners; transparent pixels flatten onto the chosen background. Applied backgrounds are 990x600 JPEG under 500,000 data-URL characters. Logos are reduced to at most 400 px. Object URLs are released. Errors preserve the existing image; selecting the same file again works. No credential, card-value or financial logic changed.

Three code-rendered original presets: Emerald & Gold, Ivory Atelier, Midnight Rose. Each includes a salon logo/name and Gift Card title. Presets embed as existing supported JPEG data, requiring no schema/API format change. Existing issued cards keep their design through the existing save contract.

Validation passed:
- Scoped ESLint and scoped strict TypeScript (artifacts/gift-card-designer/tsconfig.json).
- node tests/gift-card-designer-ui.mjs: five viewport widths (320/393/430/768/1440), Cards-only metrics under 180px, presets, 3.9 MB upload, crop/zoom/rotation/drag, compressed output under 375 KB, Activity hide/reveal, tab draft retention, edit/cancel, save failure/retry, invalid input and reload tab restoration; no page errors or horizontal overflow.
- node tests/gift-card-designer-policy.test.mjs: owner auth/revalidation preserved; unrelated wallet/transfer/token/API routes keep reset behavior.
- git diff --check.

Limits: browser tests use actual UI components with a synthetic transport and language stub; they do not prove authenticated hosted writes, physical iPhone picker behavior or a native release. Whole-repo TypeScript is blocked by pre-existing unavailable pdf-lib and @pdf-lib/fontkit dependencies; scoped TypeScript passes. No full production build claimed.

Integrate only this scoped change against the then-current production source. The worktree baseline is not a newly captured live baseline. Review route policy integration with newer shared-shell work, rerun assembled build and authenticated/iPhone upload-save acceptance. No Swift, signing or bridge configuration edited; evaluate bundled-native inclusion against the actual uploaded app at release time.

Preview/evidence: artifacts/gift-card-designer/{cards-phone.png,preset-Emerald.png,preset-Ivory.png,preset-Midnight.png,crop-phone.png,results.json}.
