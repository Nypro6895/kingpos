# Contextual appointment check-in — 2026-11-03

Owner approved implementation of the inline appointment proposal; no deployment authorized.

Base: 6865c6c00b9b72389ae3f46482cab4bae3e7009d (matching screenshot UI). Isolated worktree: C:/Reylumi-worktrees/contextual-booking-checkin-20261103.

- Remove unconditional standalone check-in block from Bookings.
- Inline scanner and personal QR links only for each eligible booking from start minus 15 minutes through start plus 60 minutes inclusive.
- Exclude recorded arrival, visit ID/state, receipt, cancelled, no-show, completed, checked-in and in-service records.
- Promote just-started history appointments into Upcoming during eligibility, without modifying canonical data, statuses, money or deduplication.
- Exact timer boundaries and foreground resume; refresh at most every 30 seconds while eligible to obtain staff-side changes. Existing resource access/identity boundaries remain in place. Hide when refreshed data carries arrival evidence.
- No automatic popup. Existing active-visit details and QR remain available.

Validation: 17/17 tests (journey logic, real-component Chromium browser, scoped native history read); full TypeScript noEmit; scoped ESLint; diff check. Browser widths 360, 390, 428, 768, 1280. Screenshot: artifacts/contextual-booking-checkin-20261103/browser/appointment-checkin.png. Native client esbuild verify-only: Safari 16, 933 modules, 338 pinned actions, zero unsupported actions, no signed bundle assets written.

Release integration: overlay only the five listed source/test files onto the then-current exact production baseline; preserve other work. CustomerJourney is imported by lib/app-local-page-registry.tsx, so iOS requires a rebuilt bundled app in addition to web release. Production build of assembled source, archive/sign/upload and physical-device acceptance remain pending. No production data writes, deployment, or iOS upload occurred.
