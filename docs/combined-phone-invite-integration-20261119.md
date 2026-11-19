# Phone and public-invitation integration — 19 November 2026

Integrated three approved scoped inputs on clean candidate parent `c3fe075ec1275ff9a02c031ea9931f61065e0699`: Phone dialog event `4ad0f9d9-225c-49eb-9b6b-267819f499ea`, public invite web event `f5265a25-ece4-4ec9-b6f1-f3c975645962`, and native receiver event `a6494a20-174b-4881-924c-a3ea65b4997b`. Original frozen files were verified against immutable source commits `e2d20bf56255ab7d8d9fd20de03ab46cd7f0fb16` and `c43368e69c142a0f2d7c44a518ba05c87fc2b583`; their exact parent commits and patch hashes are in the preparation manifest.

## Result and preserved behavior

All three actual three-way applications were clean. The account verification dialogs use the approved portal/focus layer and keep draft/OTP/error recovery. Android avatar-only actions retain normal document flow; the new browser regression checks actual computed static positioning after opening the real avatar editor. Existing account-menu, cancel, email proof, public identity and block behavior remain in their original controls.

Native strict Gift-link recognition opens the existing hosted Gift page and preserves latest-link ordering. It does not claim or redeem a card automatically, alter balances, or introduce a new redirect authority. Existing receipt printing, provisional-print authorization, cancellation and Check Writer PDF guards remain intact: seven relevant source case bodies are exactly unchanged from the Android/Tax/Ticket candidate parent. This source preservation check is distinct from Swift compilation or actual printing acceptance.

## Activation

Public app invitation remains disabled unless its existing release flag is explicitly true. Store URLs are null while disabled. The public Gift handoff action requires both invitation and its separate handoff flag. No environment file, configured URL or feature flag was changed. The native code prepares the strict receiver and hosted fallback; it has no separate native runtime flag and performs no automatic Gift claim. Keep the public Gift handoff flag off until the final compatible signed binary and device flow have passed. Generated native bundles are excluded and must be regenerated once from the final complete source.

## Validation and limits

The four original focused fixtures passed 19 Node test records with zero skips. They include actual Chromium account-dialog checks at six viewports, route/hash/Back/Activity draft behavior, personal settings, and mocked public-invite/Camera boundaries. After adding the avatar-only regression to personal settings, that affected test passed again. This repeat is not an additional independent test total. All operational actions and requests in browser fixtures are mocked/blocked.

ESLint on ten owned TS/TSX/test files passed with zero errors or warnings; the parent comparison is also clean. Repository-configured syntactic and semantic checks found zero diagnostics in six owned TS/TSX modules. These scoped checks do not replace the final assembled Next build. The added native XCTest cases are source-only here; no Xcode, archive, provider, real customer, printer or physical-device call occurred. The optional Live Preview process was not running and was not opened; fixture screenshots are Chromium evidence rather than a product dev-server or native acceptance.

Evidence and frozen source are under `artifacts/combined-phone-invite-integration-20261119/`: actual preflight/application receipts, focused TAP logs, lint/TypeScript results, native print-preservation hashes and the final manifest. An independent bounded Swift source review found no concrete blocker, confirmed strict lowercase64hex/no-query Gift fragments, hosted-only navigation, latest-link fences and unchanged print authority. Its five source hashes are bound in the acceptance receipt. Native compile/device limits remain unchanged. The pending source status remains needs-integration until the coordinator completes exact live-baseline reconciliation, the combined build/QA, regenerated native archive/device acceptance and the applicable Store gates. No production activation, push, deployment or upload is recorded.
