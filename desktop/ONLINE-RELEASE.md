# Windows online edition 0.7.0

The installer opens `https://reylumi.com/pos/portable`. It does not need a local
Next.js server. Build from `desktop` with `npm run dist:online`.

This edition is unsigned because no publisher certificate is configured. Windows
may show an unknown-publisher or reputation warning. Automatic native updates are
disabled; download a newer installer from `https://reylumi.com/download/windows`.
Signed releases still use `npm run dist:release` and retain signing enforcement.

Online and signed editions use the `KingPOS Portable` Windows profile. Local test
editions retain their separate `KingPOS Portable Test` profile. Localhost data is
not migrated to the online origin: synchronize pending work with the original
server before retiring the test application. Initial sign-in and synchronization
require internet and a salon POS ID/passcode.

Installers are hosted as versioned GitHub release assets, outside the web bundle.
Configure `WINDOWS_POS_DOWNLOAD_URL` and `WINDOWS_POS_DOWNLOAD_VERSION` in Vercel
production, then redeploy the website. `/download/windows` redirects to the
configured installer, and POS Settings uses the same release information.
