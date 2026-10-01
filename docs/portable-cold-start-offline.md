# Windows offline cold start â€” 0.6.3

## Findings

The previous service worker erased the prepared UI after 24 hours. Its staff PIN verification bundle also expired after 24 hours. Native SQLite already retained submitted/parked tickets, but that did not guarantee the app itself could open. The backend separately rejected commands older than 30 days. Browser-session cookies also needed durable native restoration.

## Changes

- `desktop/offline-shell.cjs`: encrypted SQLite workspace archive, stored beside the existing ticket vault in the stable Windows user profile, separated by origin/channel. Authorized POS and paired Customer Display HTML plus required Next static assets are published in a FULL-sync transaction only after all files download. A failed preparation preserves the previous complete generation. No time-based expiry. APIs and POST requests are never cached or acknowledged locally by this layer.
- `desktop/main.cjs`: same-origin protocol fallback, 4-second navigation fallback when a prepared page exists; restore app session cookies from encrypted storage. Forward same-origin mutation Origin only when Electron's initiator matches the configured origin. Explicit lock invalidates the archive and wins against in-flight preparation. Native sessions retire the browser service worker; other browser storage and ticket data remain intact.
- Preload version 4 provides narrowly scoped prepare/lock APIs; Customer Display still has no ticket-vault access.
- `portable-offline-shell.tsx`: prepare the native workspace automatically and retry every minute/when connectivity returns. Browser fallback no longer has a 24-hour shell expiry and falls back on server errors/timeouts too.
- `portable-offline-staff.ts`: native PIN verifier bundles and failed-attempt counters use encrypted device storage. Native bundles do not expire by age; online refresh and PIN checks remain. Older native/browser clients retain their prior verifier policy. No plaintext staff PIN is stored.
- `202609280001_portable_unbounded_offline.sql`: removes the 30-day lower age limit for Portable and Owner queued operations, retaining finite/future-time checks, authorization, original business dates, deduplication, conflict and payment rules. Applied to the linked test backend using this migration only.

## Verification

- TypeScript, targeted ESLint, production Next build passed. Initial webpack cache failure resolved by moving the old build cache aside; font downloads retried successfully.
- 13 native unit tests passed, including atomic archive refresh, interruption/lock, 400-day clock advance and process restart.
- Real Electron test with HTTP server physically stopped and browser service-worker/cache storage cleared: cold start loads local HTML/JS and retains the app session. Same-origin POST Origin and session-cookie forwarding verified.
- Full isolated Desktop E2E passed: expired PIN bundle, offline check-in, Customer Display, custom service, parked/queued ticket, close/reopen offline, reconnect upload exactly once, live Ticket refresh, logout/login retains saved tickets. Network disconnection is injected at the native upstream fetch boundary for this suite; the separate cold-start test stops a real server. Test fixtures removed.
- SQL integration test replays attendance and ticket from 400 days ago exactly once, retains original sale time and rejects future time. Transaction rolled back.
- Browser service-worker regression passed with an expired legacy metadata timestamp and lock clearing.

## Boundaries

First provision requires a successful online sign-in and complete workspace preparation. Explicit sign-out keeps tickets but requires online sign-in before reopening the authorized workspace. Revoked credentials, conflicting edits, closed-day rules and external payment authorization are not bypassed. Available disk capacity still limits storage; there is no days-based ticket deletion.

This installer is the local test channel and still targets http://localhost:3107. Offline operation does not require that server, but uploading does require the configured server to be reachable, not merely a Wi-Fi connection. The current server is a development preview, not an installed Windows service or production cloud endpoint. Moving to production needs the hosted endpoint and update feed; do not include backend secrets in the desktop installer.

References: Electron protocol.handle and session.fetch (bypassCustomProtocolHandlers), official Electron API documentation.

## Delivery

Windows 0.6.3 installer built in `desktop/dist-offline-0.6.3-final`, verified its embedded native archive/Origin forwarding code, and published to the local desktop update feed. Next production preview is running on port 3107 (not a Windows startup service). Business-day rollover and durable queue/PIN/local-display regressions also passed; an older queue test fixture was updated to supply its required business date and check-in timestamp.

## September 30 follow-up — 0.6.4

Observed on the actual test machine: web listener on 3000, no listener on the app origin 3107. Read-only inspection of the actual native archive found zero prepared resources and no POS auth cookie metadata (only the workspace-device cookie); no offline UI was available for fallback. Ticket vault retained 43 synced operations and one cancelled operation, with no pending operations. No user ticket data was changed.

Restarted the existing production preview on 3107. Added a per-user Windows Startup shortcut `KingPOS Test Server.lnk` invoking `desktop/start-local-server.ps1` hidden. This local-development helper checks health/listener first, never kills another process, and starts the existing production build only. It is specific to this development machine, not bundled server credentials or a production hosting solution.

Native recovery now includes a direct Try again button and automatic server recovery every ten seconds. Recovery IPC is restricted to the main window's local unavailable page. Menu item Offline readiness reports whether a complete native shell exists. Version 0.6.4 keeps the existing profile/vault.

Verification: 13 native tests passed; real Electron cold-start with server stopped still passed; a new real Electron recovery test starts with an empty profile and unavailable server, uses Try again, then starts the server and verifies automatic navigation to the workspace. Startup helper rerun preserved the existing server process.
