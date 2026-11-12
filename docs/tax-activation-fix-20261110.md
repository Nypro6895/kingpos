# Tax activation handoff — 2026-11-10

Implementation only. No deployment, production migration, live payment, outbound
message or native build/upload. Depends on `tax-refinement-20261110` and its prior
Tax workspace dependency. Integrate only the selected delta over the then-current
production baseline; this working checkout contains other unreleased source.

- A still-valid owner connection whose entitlement expires remains in the Tax
  business list as Paused. Only business label/location, an inactive reason and a
  Refresh access action remain; financial counts are null and workspace data is
  denied. Suspended identities, inactive salons, disabled credentials, disconnected
  accounts and generation mismatches are excluded entirely. Renewal restores a
  connection that the owner has not revoked.
- Explicitly starting the Tax trial returns a scoped owner-setup destination only
  after the owner RPC returns active access. Merely viewing a trial never navigates.
- Embedded card completion, manual status checks and foreground reconciliation
  advance to owner connection setup only after the existing server verification
  confirms active paid access. The destination carries the salon ID. The settings
  page authenticates, validates membership and switches via the existing workspace
  route when necessary; it never silently edits the currently selected other salon.
- New Tax card reservations freeze `tax_activation_setup=true` in the existing
  purchase snapshot. Only those new reservations get the new return destinations.
  Older reservations and sessions retain their original provider request and
  idempotency key, including a retry after a lost storage acknowledgment. No price,
  tax, fee, settlement or entitlement-grant calculation changes.
- New hosted Tax checkouts retain the existing `/market/payment-return` bridge and
  `reylumi://market` app link. Its website continuation carries the paid salon to
  connection setup. Embedded redirects go directly to the same setup page. Pending
  access polls the existing server confirmation with bounded retry and never treats
  URL parameters or client completion as proof of payment. Existing legacy sessions
  keep their old return URLs and can use the prominent Next setup CTA in Market.
- Owner Market/settings/workspace controls expose Copy sign-in link with
  `https://reylumi.com/tax`. The owner no longer opens professional onboarding from
  its settings CTA. The professional independently signs in, opts into Tax and
  connects using owner-issued credentials; website use does not require installation.

`20261110234500_tax_activation_handoff.sql` requires the existing Market card table,
Tax migrations and trial-aware runtime access gates. It does not rewrite old card
snapshots, published payroll or documents. Production catalog publication/provider
configuration remains an acceptance dependency, not something this task changes.

Validation uses actual SQL via PGlite, real server actions with provider mocks,
browser interaction tests and actual local Next components with loopback-only seeded
QA data. Screenshots and localhost build evidence do not establish real Stripe/webhook
acceptance, production sessions or physical iOS/Windows behavior. No native bridge
or application source was changed.
