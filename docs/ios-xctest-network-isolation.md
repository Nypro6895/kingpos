# Native XCTest network isolation

The XCTest host's white idle scene prevents automatic product startup. It does
not prevent a test from constructing and starting a real controller. Stopping a
WebView immediately after initialization cannot undo an already submitted load.

`StartupLoopbackFixture` gives the six viewport/launch tests that initialize a
hosted controller a fresh, owned IPv4 loopback origin. Actual initialization,
display-frame startup, foreground handling and existing assertions remain
enabled. Its constant HTML has no external assets. GET/HEAD return that fixture;
all other methods return 405. Tests stop the listener and its owned connections
in `defer`. Startup failure/timeout cannot resume its continuation twice.

Loaded tiny local-bundle fixtures use an injected unavailable native HTTP client,
including during a subsequent foreground notification. Their production-origin
navigation policy and original boundary assertions remain unchanged. Pure URL
and detached-controller metadata tests do not gain a server or a fake result.

Actual packaged Help and POS tests retain the real installed HTML, JavaScript,
storage, cryptography, controls and assertions. Before WebKit is created, a
test-only content rule list blocks HTTP(S) and WebSocket resources, and document
start scripts deny fetch, XHR, WebSocket, EventSource and sendBeacon. Each test's
existing counters/probes run after this common fence. Native HTTP remains an
injected synthetic/unavailable client; the POS fixture rejects unknown commands,
including `http.shell.campaign-event`, without a network fallback. Only the exact
existing synthetic benefits DTO and DeskRelay loader have fixture responses.
Resource rules are removed by their unique test-owned identifiers on teardown.

The real installed Explore and Owner Today tests already combine injected native
HTTP, an HTTP content-rule blocker and document-start fetch/WebSocket/beacon
stubs. XHR, EventSource and external image/script requests are covered by those
resource rules. Their original recovery/diagnostic assertions are retained.

The new fixture tests exercise GET/HEAD and forbidden POST against only an owned
loopback listener, then probe direct browser APIs and an owned image canary with
zero accepted listener requests. These establish fixture isolation, not live
provider or physical-device acceptance.

The hosted viewport script contract also now explicitly expects the existing
ReceiptPrintBridge once, alongside AppViewport, NativeBridge and
PortableDeviceBridge. Exact count, document-start and main-frame assertions are
retained. The production scripts and controller are unchanged.

## Audit scope

All 36 original Swift test files were checked for controller creation, delayed
startup/foreground, real WK fixtures, injected native HTTP, URLs, external assets
and command dispatch. An input-hash inventory and per-file classification are
preserved with the release evidence.

| Test surface | Network boundary |
| --- | --- |
| AppViewport / LaunchAppearance initialization | Fresh owned loopback origin; actual startup retained |
| LocalAppWebView tiny generated HTML | Local custom scheme; injected unavailable native HTTP |
| Installed Help / POS | Real bundled code; precreation browser fence; injected native HTTP |
| Installed Explore / Owner Today | Existing browser resource fence and injected native HTTP |
| LocalHostedReturn / OfflineWebView | Existing owned ephemeral loopback servers and constant fixtures |
| SecurityChallengeWebView | Explicit `startNavigation: false` before attachment; constant inline HTML; real origin kept for policy assertions |
| Cookie authority WK helpers | Owned website-data profile; constant CSP-denied about:blank fixture |
| PortableStoreWebView / StaffOnlineAccess | Tiny owned custom-scheme bundle; injected HTTP fixture |
| Remaining transport tests | Injected in-memory HTTP actors; production URLs are asserted request metadata |
| Remaining policy/store/geometry/metadata tests | No network initialization; retained unchanged |

No production origin, navigation policy, security guard, entitlement, minimum OS,
app runtime, provider setting or signing configuration changes in this patch.
Runtime simulator results must be recorded separately from compile success and
from iPhone/iPad physical acceptance. A full-suite run must use the frozen test
source and a new owned simulator profile, not an existing physical app profile.
