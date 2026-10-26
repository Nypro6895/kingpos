# KingPOS Portable 0.7.3

The Online edition now checks the Reylumi update feed at startup and every
30 minutes. Checking never downloads or installs without a user action.
Check for updates presents the available version with Download or Keep current
version. Download and install update checks for a new version, downloads it if
needed, verifies the installer checksum, saves and backs up device data, then
hands off to the installer with silent-install and reopen arguments. Windows
may still require its normal administrator approval.

Download-only leaves the current app running. Progress is visible in the POS
update panel. A verified cached installer is reused after restart. Failed
discovery, failed/corrupt downloads, unpersisted drafts, failed backup or
pending uploads never authorize installation. Ordinary app exit never installs
an update. Signed release publisher checks remain in place. The existing
unsigned Online distribution channel is unchanged; its user-initiated installer
download is checksum-verified through the HTTPS Reylumi feed.

Silent setup gives a gracefully closing app up to 15 seconds to exit before
replacing files. It fails if the app remains open and never kills the checkout.

Online Windows updates use the complete installer. Binary delta patches are
not advertised. Web-only feature updates continue through the existing hosted
web application and do not require a Windows version bump; users can keep the
installed native version when no new native capability is needed.

Validated locally: 22 unit/contract tests; real Electron updater download,
SHA512 verification, verified-cache reuse, corrupt-download rejection and
silent-install/reopen handoff; isolated native clean install, graceful exit,
active-app refusal, legacy upgrade and uninstall; browser download/progress/
blocked-install/retry/Later flow; scoped TypeScript and ESLint. Installer launch
in the Electron updater integration is intercepted to preserve the owner's
installed application. Actual NSIS install/uninstall checks use an isolated QA
app ID and profile.

Publication remains pending. Existing 0.7.2 installations require one manual
installation of 0.7.3 before these native menu changes become available.

Release together:
- The 0.7.3 Windows installer and these web modules.
- Server-only production values WINDOWS_POS_DOWNLOAD_URL,
  WINDOWS_POS_DOWNLOAD_VERSION, WINDOWS_POS_DOWNLOAD_SHA512 (base64 SHA512 of
  the exact published installer), and WINDOWS_POS_DOWNLOAD_SIZE (bytes).
- The native feed endpoint is /api/pos/windows-update/latest.yml. It returns
  503 until a complete checksum-pinned release is configured.
- Verify complete download hash, range requests, version metadata and absence
  of external source URLs through the deployed Reylumi endpoints.
- Web changes are compatible with older bridge versions; no iOS build needed.
