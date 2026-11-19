# Browser security hardening boundaries

This source change does not establish production or native publication.

The enforced browser policy blocks object embedding, foreign base URLs and
cross-origin framing. Same-origin framing remains available for the owner's
public booking preview. `nosniff`, Referrer Policy and explicit first-party
camera, microphone and geolocation permissions accompany it.

The production script/resource policy is **Report-Only**. It observes a stricter
script allowlist without blocking existing streamed React/Next inline scripts.
It is not yet strict script enforcement and must not be described as preventing
all XSS. No request nonce, forced dynamic rendering or HTML buffering was added;
Cache Components and streaming remain in place. Any subsequent strict nonce/hash
policy needs rendering and performance validation first.

Next 16.4.6 introduces an explicit Partial Prefetching choice for older Cache
Components apps. `partialPrefetching: false` preserves the previous per-link
prefetch behavior, including existing full-prefetch links. Enabling the new mode
requires a separate navigation audit; it is outside this dependency security fix.

CSP telemetry is anonymous and bounded to 16 KiB, 10 reports per batch and a
10-second body deadline. A per-instance budget accepts at most 30 requests per
minute. This is best-effort telemetry protection, not a distributed account or
IP rate limit. Logged fields are finite directive, page-area, provider-category
and disposition labels. Raw URLs, paths, IDs, queries, fragments, source samples,
referrers, IPs, cookies and user agents are not logged by the collector.

MapLibre is pinned to 5.24.1, which the supplier lists as patched for
[GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579).
The npm bulk advisory currently incorrectly includes this patched 5.x version.
Only this exact advisory/version combination receives a supplier-range correction
in the audit gate. The browser regression exercises the actual vendor attribution
control with adjacent event attributes, `javascript:` links and SVG, and requires
safe attribution links to survive.

New web source requests `/api/vendor/maplibre-gl/5.24.1.js`, bypassing an existing
immutable cache entry for the old unversioned URL. The compatibility endpoint
still serves patched bytes but now uses `no-store`. A server cannot revoke old
bytes already cached under the previous one-year immutable policy. Installed
native app-local bundles may still contain the old loader or library. Their
acceptance requires rebuilding the native local bundle from the reviewed source,
checking its embedded versions/asset manifest, and testing an upgrade from an old
cached installation on a physical device. Web publication alone must not mark
that native upgrade gate complete. This task does not modify generated native
bundles, Swift/Java source or store distribution.
