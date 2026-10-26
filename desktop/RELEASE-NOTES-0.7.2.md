# KingPOS Portable 0.7.2

Fixes installation getting stuck while checking for running applications on
Windows machines with an unresponsive WMI/CIM service. The installer and
uninstaller now enumerate processes natively. If the app is open, interactive
setup asks the user to close it; silent setup exits without replacing files.

Upgrades use the newly built uninstaller with the existing installation path
and keep-data flags, so an older hanging uninstaller is not executed. Signing
continues through the existing electron-builder pipeline. The online build
retains the existing unsigned distribution configuration.

The website's public download/share/copy URL is `/download/windows`. The route
streams the installer through Reylumi and follows storage redirects on the
server. Storage URLs, response headers and error documents are not exposed to
customers. Range requests and HEAD remain supported.

Validated locally on 2026-10-26:
- Online Windows x64 installer built successfully.
- Isolated native runtime checks passed: clean install, running-app refusal,
  upgrade with a deliberately hanging legacy uninstaller, and uninstall.
- The legacy stub was not called; obsolete files were removed and a saved
  profile fixture survived upgrade and uninstall.
- 25 desktop/download tests, scoped TypeScript, ESLint and diff checks passed.
- Packaged runtime modules match the previously installed 0.7.1 application;
  this change only updates installer behavior and the package version.

Full-checkout TypeScript currently reports stale generated Help route imports
in `.next-readiness-check`; the affected download modules pass scoped checking.

Publication is pending. Do not describe the website URL or 0.7.2 as live yet.
At release, upload the exact verified 0.7.2 installer through the existing
distribution channel and update the server-only WINDOWS_POS_DOWNLOAD_URL and
WINDOWS_POS_DOWNLOAD_VERSION together. The source URL may remain a storage
URL; clients only receive `/download/windows`. Do not configure that source
variable to `/download/windows` itself.

Verify a complete installer download and SHA256 through the deployed Reylumi
route before marking publication complete. Local streaming checks do not prove
the deployed provider path. Vercel documents streaming responses for large
payloads: https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions

Local candidate SHA256:
`a7710b8f6647fb09ba2012c41e238ea85ee8b543233e33e28dabe0f790cf99b7`
