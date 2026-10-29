# Shipped source and finite read/navigation coverage

Native68 + webDQAy source 7ccb53a507839d6f439ecda90e162d7638d9e08c. 15 exact events; 125 unique declared files. Aggregate overlaps retained.

PASS is only the exact stated layer/read assertion. No whole-event/full-file/full-app/security/write acceptance inferred. NOT_RUN/BLOCKED reasons and remaining named assertions are explicit.

| File | Event IDs | Source | Browser/runtime | Physical68 cases/status |
| --- | --- | --- | --- | --- |
| .env.example | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| .gitignore | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| app/(app)/check-writer/page.tsx | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/(app)/more/more-layout.module.css | 4dd0acc9, 3fbfd81f | PASS (67 identical bytes) | PASS scoped More | BLOCKED: 328-C04 BLOCKED |
| app/(app)/more/page.tsx | 4dd0acc9, 3fbfd81f | PASS (67 identical bytes) | PASS scoped More | BLOCKED: 328-C04 BLOCKED |
| app/(app)/my-bookings/page.tsx | bb3456b8, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Booking | BLOCKED: 328-C03 BLOCKED; 328-C05 BLOCKED |
| app/(app)/payroll/page.tsx | c84379a7, 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Payroll | PASS: 328-C06 BLOCKED; 327-Payroll PASS |
| app/account/account-profile-editor.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/account/actions.ts | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| app/account/phone-change-actions.ts | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| app/api/app-local/context/route.ts | 96b97016 | PASS (67 identical bytes) | PASS scoped Cleanup | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/api/app-local/read/route.ts | 96b97016 | PASS (67 identical bytes) | PASS scoped Cleanup | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/api/check-writer/pdf/route.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/api/check-writer/route.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/api/images/normalize/route.ts | d335a046 | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/bookings/appointment-progress.module.css | 4dd0acc9, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Booking | BLOCKED: 328-C03 BLOCKED; 328-C05 BLOCKED |
| app/bookings/booking-workspace-client.tsx | 4dd0acc9, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Booking | BLOCKED: 328-C03 BLOCKED; 328-C05 BLOCKED |
| app/check-writer/check-writer.module.css | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/check-writer/check-writer.tsx | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/globals.css | 0bf23f73, 3fbfd81f, c43e7b71 | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/market/card-payment-actions.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| app/market/check-writer-actions.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| app/market/check-writer-panel.tsx | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/market/market-client.tsx | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/market/sample-apps.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| app/my-place/place-panels.tsx | 9da1d904, 3fbfd81f | PASS (67 identical bytes) | PASS scoped MyPlace | BLOCKED: 328-C04 BLOCKED |
| app/payroll/payroll-daily-listing.tsx | c84379a7, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Payroll | PASS: 328-C06 BLOCKED; 327-Payroll PASS |
| app/payroll/payroll-mobile.module.css | c84379a7, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Payroll | PASS: 328-C06 BLOCKED; 327-Payroll PASS |
| app/payroll/payroll-period-rail.tsx | c84379a7, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Payroll | PASS: 328-C06 BLOCKED; 327-Payroll PASS |
| app/pos-tickets/ticket-filters.module.css | 4dd0acc9, 0bf23f73, 3fbfd81f | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos-tickets/ticket-filters.tsx | 4dd0acc9, 0bf23f73, 3fbfd81f | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos/owner-local-panels.tsx | 3fbfd81f, c43e7b71 | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos/owner-notebook-menu.css | 3fbfd81f, c43e7b71 | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos/owner-pos-client.tsx | 0bf23f73, 3fbfd81f, c43e7b71 | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos/owner-pos.css | 0bf23f73, 3fbfd81f | PASS (67 identical bytes) | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos/owner-workspace-frame.tsx | 0bf23f73, 3fbfd81f, c43e7b71, 4256266f | PASS | PASS scoped POS | BLOCKED: 328-C01 BLOCKED; 328-C02 BLOCKED |
| app/pos/settings/settings-group-form.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/reports/reports.module.css | bb3456b8, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Reports | PASS: 327-Reports PASS |
| app/services/services.css | bb3456b8, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Services | BLOCKED: 328-C10 BLOCKED |
| app/settings/blocked-users-panel.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/settings/deferred-personal-section.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/settings/direct-settings-panel.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/direct-settings-ui.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/login-security/login-security-panel.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/settings/login-security/login-security-quick-editor.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/settings/notification-preferences-panel.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/settings/ownership-lifecycle-panels.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/settings/personal-public-profile-panel.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C08 BLOCKED |
| app/settings/plugin-settings-row.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/settings/pos-settings-panel.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/settings/salon-profile-preferences-panel.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/settings/salon-settings-panels.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/settings-controls.css | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/settings-hub-client.tsx | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/settings-hub.css | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/settings-icon.tsx | c3abe2ef | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/settings-navigation.ts | c3abe2ef | PASS (67 identical bytes) | PASS scoped Settings | PASS: 327-Settings PASS; 328-C08 BLOCKED; 328-C09 BLOCKED |
| app/settings/shortcuts-settings-panel.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/settings/team-payroll-panels.tsx | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | BLOCKED: 328-C09 BLOCKED |
| app/staff/today/today-dashboard-view.tsx | 4dd0acc9, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Today | PASS: 327-Cold1 PASS; 327-Cold2 PASS; 327-Warm PASS |
| app/staff/today/today-layout.module.css | 4dd0acc9, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Today | PASS: 327-Cold1 PASS; 327-Cold2 PASS; 327-Warm PASS |
| assets/check-writer/NotoSans-Regular.ttf | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| assets/check-writer/OFL.txt | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| assets/check-writer/micr-e13b.ttf | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| docs/check-writer-audit-20261028.md | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| docs/check-writer-readiness.md | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| docs/check-writer.md | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| ios/Reylumi/NativeBridge.js | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Native | PASS: 328-C01 BLOCKED; 327-Staff PASS; 327-Beauty PASS |
| ios/Reylumi/ReylumiViewController.swift | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Native | PASS: 328-C01 BLOCKED; 327-Staff PASS; 327-Beauty PASS |
| lib/account-phone-change.ts | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| lib/app-local-command-policy.json | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| lib/app-local-commands-server.generated.ts | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/app-local-explore-http-client.ts | 8fbbe92f, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Comments | BLOCKED: 328-C07 BLOCKED |
| lib/app-local-explore-metadata.ts | 8fbbe92f, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Comments | BLOCKED: 328-C07 BLOCKED |
| lib/app-local-explore-server.ts | 8fbbe92f, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Comments | BLOCKED: 328-C07 BLOCKED |
| lib/app-local-online-routes.json | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| lib/app-local-owner-payroll-view.tsx | c84379a7, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Payroll | PASS: 328-C06 BLOCKED; 327-Payroll PASS |
| lib/app-local-prefetch.ts | 639fea99 | PASS | PASS scoped Prefetch | PASS: 327-Payroll PASS; 327-Reports PASS; 327-Staff PASS; 327-Beauty PASS; 327-Settings PASS |
| lib/app-local-read-observation.ts | 96b97016 | PASS | PASS scoped Cleanup | NOT_RUN: Owned temporary source removed; source/live silence tested, no device UI assertion |
| lib/app-local-route-inventory.generated.json | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| lib/check-writer-crypto.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| lib/check-writer-market.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/check-writer-pdf.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/check-writer-readiness.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/check-writer-request.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| lib/check-writer-rules.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/check-writer-server.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| lib/check-writer-subscription.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Production account/security/payment/write path deliberately outside finite read/navigation scope |
| lib/experience-route-policies.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/market-card-rules.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/market-catalog-view.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/market-commerce.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/market-experience-data.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/vietnamese-check-writer.json | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| lib/vietnamese-dictionary.ts | c3abe2ef, 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| lib/vietnamese-settings-copy.json | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| next.config.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |
| package-lock.json | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| package.json | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| scripts/check-writer-preflight.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| scripts/generate-app-local-routes.mjs | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| supabase/migrations/20261028040000_check_writer.sql | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| supabase/migrations/20261028193000_check_writer_output_and_price.sql | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| supabase/migrations/20261029040000_check_writer_sales_hold.sql | 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/account-phone-change.test.mjs | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Settings | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/app-local-comments-transport.test.mjs | 8fbbe92f, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/app-local-prefetch-runtime.test.mjs | 639fea99 | PASS | PASS scoped Prefetch | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/app-local-read-observation.test.mjs | 96b97016 | PASS | PASS scoped Cleanup | NOT_RUN: Owned temporary source removed; source/live silence tested, no device UI assertion |
| tests/check-writer-api.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-market.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-payroll-read.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-preflight.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-provider-contract.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-runtime.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-sales-hold.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer-ui.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/check-writer.integration.test.mjs | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/fixtures/check-writer-bootstrap.sql | 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/ios-personal-settings.test.mjs | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/login-security-contract.test.mjs | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/settings-consistent-layout.test.mjs | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/settings-grouped-editors.test.mjs | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/settings-hub-ui.test.mjs | c3abe2ef, 45c66e66, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| tests/settings-owner-closure-ui.test.mjs | c3abe2ef, 3fbfd81f | PASS (67 identical bytes) | PASS scoped Assembly | NOT_RUN: Test/doc/config/asset/dormant SQL has no independent read/navigation UI assertion |
| types/check-writer.ts | 08e308fd, 3fbfd81f | PASS (67 identical bytes) | PASS scoped CheckWriter | NOT_RUN: Disabled activation or assembly/server-only scope; source/runtime/build verification, no physical feature activation |

## Finite remaining assertions

- R01 NOT_RUN: First uncached load. No verified row-only performance-cache helper; sealed store also contains authority/lease/binding. No reset performed.
- R02 NOT_RUN: Causal speedup / under1s first load. 12→2 source/runtime offroute proof only;67/68 cache/network/harness not controlled; endpoint totals not named-budget counts.
- R03 NOT_RUN: Real OTP/password/account/ownership/role permission modifications. Read/navigation scope only; simulated auth/revocation/latecache fixtures separate.
- R04 BLOCKED: CheckWriter paid activation/real printing/provider acceptance. Sales closed,3SQL/key/catalog activation not performed; new developer Market excluded.
- R05 NOT_RUN: Physical iPad/Windows hardware, complete charts hit-tests, real device offline/revocation, financial or content writes. Outside finite shipped read-only QA; responsive/browser tests not physical hardware proof.

Full exact UUID/file/evidence/assertion mapping: SHIPPED-FILE-COVERAGE.json. No raw AX/screens, account contents, credentials or cache data included.