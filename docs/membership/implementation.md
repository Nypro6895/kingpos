# Membership — desktop Platform Admin

Updated 2026-11-03 after the approved Settings / Manage mockup. This revision replaces the long single-plan editor with a compact desktop workspace inside the existing Platform Admin shell.

## Screens and actions

- **Manage / Salon list** is the default. One row per salon, with current plan, validity, SMS and campaign balance. Search, plan and status filters precede pagination. Change plan, Renew and Add credit are direct row actions; clicking the salon opens details.
- **Manage / SMS & credit** keeps balances visible and exposes Adjust balance and History. A short inline form allows positive/negative adjustments, shows the resulting known balance and saves once. Technical service is not a credit resource.
- **History & support** remains available as a secondary management action; detailed immutable history and task records remain searchable and paginated.
- **Settings / Plans & pricing** shows all three plans in columns. Edit names, monthly/annual prices, verified-payment methods, initial setup and delivery, training sessions, support level and enrollment in one compact matrix.
- **Settings / SMS & credit** shows only actual usage resources: SMS segments, email messages, campaign delivery credit and AI credit. Carry-forward caps and additional-use reference prices are tucked into an expandable section.
- **Settings / Website** edits the public headline, introduction, contact label and plan-card copy. Support scope, response targets, future-feature explanations and FAQ copy are secondary controls. A one-click modal previews the current unsaved draft, including generated prices/allowances/service benefits.
- Save draft or Save & publish applies changed settings together, across tabs and across all three columns. Settings drafts survive navigation between sections. Invalid inputs take the user back to the relevant section. No permanent side preview and no bottom floating save bar.

## Practical service benefits

New plans use included/not-included/by-agreement setup, remote/on-site/by-agreement delivery, training session count (blank means by agreement), and standard/priority/dedicated support. Work is tracked by technician, appointment, task status and notes. Completing a task no longer requires or deducts minutes. Training counts describe the commercial scope; appointment caps are staff-managed rather than silently billed or blocked.

The additive desktop migration preserves all old versions, terms and legacy minute ledgers. It does not convert minutes into sessions. Legacy data remains available for audit, but minute balances are absent from the admin plan matrix, adjustments and public plan projection.

## Data behavior

Plan publication still creates immutable versions; current salon terms are not silently repriced. A multi-plan save/publication is atomic and revision-checked, including website copy where changed. Enrollment switches are published with the plan. Intended enrollment changes are retained in saved drafts.

The Manage list chooses the active term first, otherwise a scheduled/latest historical term, rather than showing the same salon several times. It materializes current credit buckets before returning balances. Scheduled/inactive terms show no current balance. Scheduled renewals are reflected in the row; the Renew form starts after the latest queued term, retaining exact timestamp precision.

Website draft/published copies are stored separately. Public pages read only published text; the admin preview uses draft props without publishing or navigation to a purchase. Monetary values shown in QA screenshots are fixtures, not proposed or production pricing.

## Routes and permissions

`/admin/membership`, `/admin/settings/membership` (redirect), and `/membership`. Existing sidebar and Settings links remain. Dedicated membership read/configure/manage permissions are checked in server actions and SQL. Direct table/private helper access remains revoked. No service-role shortcut was added.

## Migrations and verification

Apply in order to an isolated integration database:
1. `202611030001_reylumi_membership_admin.sql` — original storage/operations.
2. `202611030002_membership_desktop_settings.sql` — practical service settings, website draft/publication, atomic settings batches and desktop list projection.

Commands:
- `node --test tests/reylumi-membership.integration.test.mjs tests/membership-desktop.integration.test.mjs` — 16 passing tests, including legacy regression, draft privacy, atomic rollback, stale version protection, permission checks, current balances, one-salon projection, queued renewals, and task completion without minute deduction.
- `node scripts/verify-membership-browser.mjs` — real React with current canonical Platform Admin stylesheet plus both SQL migrations in isolated PGlite; desktop Settings/Manage, draft-to-public website, one-click row adjustment, technician completion, read-only controls and phone document overflow. Captures screenshots in `artifacts/membership-desktop/`.
- `node node_modules/typescript/bin/tsc -p docs/membership/tsconfig.verify.json` and scoped ESLint — source checks against current canonical shared dependencies, excluding stale generated caches.

The browser harness has test-only auth stubs and never contacts production, providers or dispatch workers. It verifies the actual components and SQL, not a second mockup implementation. Full assembled Next.js build, hosted authentication and production acceptance are separate release checks.

## Source and release boundary

Worktree: `C:/Reylumi-worktrees/membership-admin-20261103`; branch: `codex/membership-admin-20261103`. Preserve unrelated work. In particular, the canonical Settings page and admin navigation have independent changes: merge the narrow Membership links into their current versions, never overwrite Market & System with the older Settings page from this branch.

This revision implements the requested desktop interface and administrative settings. It does not deploy, alter production data or prices, collect payments, cancel subscriptions, change provider dispatch or expand the current billing/plugin integration scope. Existing release policy and combined-source verification still apply.

## Next.js / current Admin verification — 2026-11-03

`node scripts/verify-membership-next.mjs` now builds and runs a real Next.js candidate in `artifacts/membership-next/candidate` with Cache Components enabled. It loads current canonical AdminShell, auth/session guards and ExperienceScopeProvider; the membership pages and actual Server Actions come from this branch. The backend is a loopback-only auth/PostgREST fixture over isolated PGlite. Core role/permission SQL functions are extracted from the existing admin migration, rather than replaced with an always-allow stub.

Confirmed: anonymous login redirect; signed Admin session; actual Server Action publication, salon grant, balance adjustment and queued renewal; one row per salon; read-only controls; direct Server Action replay denied for a read-only actor without mutation; revoked-role denial on browser Back after the existing five-second refresh window; expired/missing Admin session denial; Settings links and redirect. The existing Settings composition with MarketSystemWorkspace also compiles as part of the candidate. Its provider panels are not exercised or connected by this test.

Two compatibility fixes are included: membership pages now use the current experience boundary; the public page no longer exports force-dynamic, which is incompatible with current Cache Components. The Settings entry composes MembershipSettingsLinks with the current MarketSystemWorkspace instead of replacing the Settings screen.

Shared navigation/permission/settings overlays are assembled from current canonical source in the generated candidate, with before-hashes and preservation checks recorded in `next-verification.json`. The canonical working files are not modified. Fixture Settings navigation screens only mount the authorized Membership links, not the live provider administration panels.

The generated fixture skips full-project type validation; new/changed membership source passes the scoped TypeScript check and ESLint separately. This is an isolated Next production-mode compilation and local runtime verification, not the full release source build, hosted Supabase/GoTrue acceptance, provider acceptance or deployment. No production secrets are loaded: the child environment is restricted to system variables and ephemeral fixture configuration. Fixture servers close after the check.
