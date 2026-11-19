# Security hardening implementation and integration handoff

Implementation source: `codex/security-hardening-20261119-r1`, based on assembled
commit `40bc21be6bd1ccf6c31528fa15d23b2e29e3871d`. This is a local implementation
baseline, not a verified production deployment baseline. The canonical checkout
and other chats' source were not modified.

## Implemented scope

- Patched Next/React/Sharp and compatible transitive dependencies; pinned the
  supplier-patched MapLibre 5.24.1 and changed its loader to a versioned URL.
- Bound authenticated admission and device revocation to provider-verified
  session identity, including direct database/Storage policies and the
  PostgREST pre-request boundary for SECURITY DEFINER RPCs.
- Added an exact-origin mutation guard across cookie/pre-login API writes,
  preserving the independently verified Bearer-only recovery boundary and
  the installed app's existing HTTPS-origin transport. Loopback host recovery
  is limited to the same scheme/port because NextURL canonicalizes local
  127.0.0.1/IPv6 names; forwarded/external Host headers grant no authority.
- Enforced object/base/frame restrictions and browser security headers.
  The stricter script/resource CSP is Report-Only. Existing cache components,
  previous prefetch behavior and streaming remain enabled as before.
- Bounded five payment webhook bodies while streaming, before signature or
  provider work; preserved signed UTF-8 bytes and existing settlement authority.
- Replaced POS quick-add filter concatenation with a bound exact-lookup RPC.
  Customer search now uses caller table RLS instead of bypassing it.
- Added PR security checks and a narrowly scoped, supplier-backed audit-range
  correction for the exact MapLibre 5.24.1 advisory. Other High/Critical findings
  and incomplete audit responses block the check.

## Validation and evidence

Run `npm run security:audit`, `npm run security:test`, and `npm run build`.
The security suite includes actual Route Handler execution, signed/chunked body
handling, PostgreSQL RLS tests, installed MapLibre malicious-attribution tests in
Chrome, existing native transport and POS draft/duplicate-submit regressions.
It does not call production payment, mail or SMS providers.

An isolated native local-bundle compile targeting Safari 16 produced 368 assets,
100 registered routes and 370 commands with no missing routes. Its manifest and
each asset's byte count/hash were verified; the versioned MapLibre `.js` bytes
match the installed patched package. This is a staged compile with
`productionReady: false`, not a signed binary or device acceptance.

The opt-in `tests/security-sessions.full-schema.test.mjs` uses isolated real
Auth/PostgREST/Storage services and ephemeral synthetic accounts. Its acceptance
must be recorded separately from the default suite's explicit skip. Relevant
logs and acceptance receipts are under `artifacts/security-hardening-20261119/`
and the session test's own evidence directory. The release-journal completion
event records the exact checks and frozen file hashes.

## Integration and release gates

1. Capture the actual production source and current provider schema/settings;
   integrate only this reviewed patch and preserve newer shipped work.
2. Run the aggregate-only session preflight and preserve the effective existing
   PostgREST hook. See [session rollout](security-account-sessions-20261119.md).
3. Apply both additive migrations before enabling the new server source. Missing
   session schema is unavailable, not an accepted authenticated session. Test the
   assembled candidate with its real effective hook before promotion.
4. Prove a revoked JWT is denied on table reads, private Storage and a definer
   RPC; prove a sibling device, provider refresh, anon access and service-role
   operations retain the intended access. Inventory affected ambiguous legacy
   sessions; only those need fresh credential login, with app drafts retained.
5. Test login/Remember/MFA/recovery, Owner/Staff/Personal boundaries, POS and
   booking, Stripe sandbox checkout/3DS and MapLibre on the assembled web source.
6. Rebuild the native local bundle when distributing this change to installed
   app-local clients. Verify embedded library/loader versions and an upgrade
   from an old cached install on devices. See [browser/native boundaries](security-browser-hardening-20261119.md).

No public deployment, production migration, native binary upload, store
publication or physical-device acceptance is established by this implementation.
Existing provider-authorized sockets and previously issued signed URLs have
their own lifetime/revocation limits documented in the session rollout. CSP
Report-Only telemetry is diagnostic and is not strict script enforcement.
