# KingPOS Portable for Windows

Scope: one Windows checkout. Customer Display on another device, multiple desks,
Owner redesign, macOS, iOS and Android are intentionally outside this change.
Version 0.4 includes a paired Customer Display window on the same computer.
Use the monitor button in the POS header to open it. A second connected monitor
is selected automatically; otherwise it opens as another window. It shares local
display messages with POS but has no access to the native ticket vault. Locking
POS closes the customer window. Prepare both screens online before offline use.
The fullscreen button now controls the native window; the application menu is
available from the three-dot button instead of occupying a permanent menu row.

## Application and data

Electron hosts the existing Portable application in an isolated persistent session.
It is not a bundled copy of the Next server and does not embed Supabase service-role
keys or the offline PIN private key. A deployed KingPOS server is still required
for initial authentication and synchronization. The test build targets localhost:3107.
The app does not start that server. Initial use requires a connection; authorized,
previously cached Portable can reload offline within the existing session/cache policy.
Logging out keeps data but requires online authentication to reopen the workspace.

Native SQLite stores queued operations, submitted-receipt checkpoints, working drafts
and parked tickets. WAL + synchronous FULL commit happens before acknowledging save.
Payloads are encrypted with Electron safeStorage (Windows DPAPI). Browser clients
keep the existing IndexedDB/localStorage behavior. There is no automatic migration
of pre-existing Chrome/Edge tickets: synchronize those before switching applications.

Data directory: `%APPDATA%\KingPOS Portable\data\<origin hash>\tickets.sqlite`.
Test builds use `%APPDATA%\KingPOS Portable Test` instead. The directory is outside
the installation folder and the installer does not delete it on upgrade/uninstall.
Use the same Windows account, service origin and Portable access key to recover
the same work. Changed/revoked keys need an explicit authorized recovery workflow;
the app does not bypass access controls. DPAPI data is not a portable backup for a
different Windows account or computer. Hardware failure/deleting app data remains
a loss risk until upload; no software can promise survival of arbitrary disk damage.

The accepted idle policy still applies: prompt after 3 minutes, discard after
another 60 seconds if ignored. Closing/logout does not invoke that discard policy.
An explicit Reset, Remove or idle discard is intentionally different from closing.

## Development/build

From `desktop`: `npm ci`, `npm test`, `npm start`, `npm run dist:test`.
Use Node 24+. Build uses the root project's Sharp dependency to format its existing
brand icon. Output is `desktop/dist/KingPOS Portable Test-Setup-0.6.0.exe`.
The default test build is unsigned and may trigger Windows reputation warnings.
Do not distribute it as a production-ready or signed release.

The server must include `lib/portable-device-storage.ts` and associated integrations.
An older deployment does not provide the native storage guarantees. This remains
a hybrid desktop app: web UI arrives from the configured HTTPS service, shell and
code are cached for offline use; native host/storage ship in the installer.

## Updates

Packaged builds with an enabled feed check on startup and every 30 minutes.
Downloads happen in the background. The header reminder offers Later and Update now.
Later leaves the reminder available. Scheduling was removed in 0.6 because Windows
may require user interaction. Existing appointments are cleared on startup.

Explicit Update now flushes the current draft first. All installs require a
successful encrypted SQLite backup and a final pending-upload check. There is
no automatic installation at app exit and no downgrade. A newer database schema
is rejected without clearing saved data.

Production build requires environment variables:

- `KINGPOS_DESKTOP_ORIGIN`: fixed HTTPS origin (no path).
- `KINGPOS_DESKTOP_UPDATE_URL`: HTTPS generic update feed.
- `KINGPOS_DESKTOP_PUBLISHER`: certificate subject/publisher.
- `CSC_LINK` and signing password as required by electron-builder.

Run `npm run dist:release`. Build enforces signing; downloaded updates retain
Authenticode publisher verification. Publish the generated signed installer,
blockmap and latest.yml together to that feed. No release is uploaded automatically.
Signing secrets must be in CI secret storage, never committed or bundled.

Before first release, validate a signed v1→v2 update on an installed test machine,
with parked/active tickets and denied installation while an operation is pending.
Rollback is a separately tested release, not an automatic database downgrade.
Backend API deployments must continue accepting queued payloads from supported
older clients; retain compatible static assets and avoid forcing reload mid-sale.
Web UI deployments and desktop host updates are distinct release paths.

## Verification

- `desktop/tests/vault.test.cjs`: SQLite crash persistence, checkpoints, immutable
  operation identity, scope separation, storage failure and navigation policy.
- `tests/portable-desktop.test.mjs`: actual Electron/DPAPI, draft logout/reopen,
  parked receipt, process exit and preload boundary against an isolated UI fixture.
- `tests/portable-desktop-e2e.mjs`: actual Next Portable with opt-in isolated test DB
  fixture, native fullscreen, same-computer customer amount/thanks/idle offline,
  offline attendance/submit/reload, restart/upload, logout/re-authentication.
- `tests/portable-offline-shell.test.mjs`: preparing Customer Display first still
  prepares the POS shell, so readiness cannot hide a missing offline POS page.
- `tests/portable-attendance.test.mjs` and the rollback SQL integration fixture
  verify existing late-arrival and leave/return catch-up rules locally and on server.
- Staff photos revalidate on reconnect and every minute while mounted; available
  photos are cached for offline display, with a safe fallback when unavailable.
- Existing browser/SQL tests remain applicable; they do not certify native updates.

Release blockers: production service URL, signing certificate/update hosting,
signed upgrade validation, and installed-app cold offline acceptance testing across
the required session durations. Current 24-hour offline shell policy is not an
unlimited offline sign-in permission and never deletes the native ticket database.

Version 0.4 keeps the customer fullscreen control visible in every display mode.
Exit restores a movable window on the same monitor; drag it to another monitor
and enter fullscreen again. The display preload exposes a separate read-only
fullscreen getter so state checks never toggle older hosts accidentally.

## Local unsigned updates (0.5+)

The test installer now enables unsigned NSIS updates from the **same loopback
KingPOS origin**, at `/desktop-updates/`. It does not require a Windows signing
certificate. Release builds retain their signing requirement. SHA-512 verification
still rejects corrupt downloads; this is not publisher authentication. Only use
this local feed on the controlled test computer.

Install 0.5.0 manually once over 0.4.0. The staged feed offers 0.6.0 for the first
update exercise. Keep the existing localhost:3107 POS service running. Open the
app; it checks and downloads in the background. Use the warning icon for Later or Update now. The native menu also offers Check for updates. Windows may
ask for confirmation or block an unsigned installer under its device policy.
No protection settings are changed by this code.

For each future test release, bump the desktop package version, build with
`npm run dist:test`, then `npm run publish:local -- <build-output-directory>`.
The publisher validates SHA-512 and size before copying installers; latest.yml
is switched only after the file is ready. Keep old versioned installers while
clients may still be downloading them. Restart the local Next server after adding
new public files so its production file inventory sees them. Do not publish local
unsigned artifacts to the signed release feed.

The updater keeps the existing pending-upload, device-flush and
backup checks. `autoInstallOnAppQuit` stays off. The integration test downloads
through the real Electron updater and intercepts only the final installer process
launch so it cannot replace the user's installed POS during testing.

Version 0.6 uses a silent NSIS handoff with force-run after explicit Update now.
Windows can still require permission. Manual installation defaults to launching
KingPOS at Finish. An upgrade initiated by an older host can still show the wizard;
keep its Run KingPOS option selected. Installer launch arguments are integration
verified; actual OS installation/relaunch must also be checked on the test machine.
