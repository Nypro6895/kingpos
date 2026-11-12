# Reylumi Android preview

Native Android host for the existing responsive Reylumi website. Android 8+
(API 26), compile/target API 36, Java 17, Gradle 8.13, AGP 8.13.2.
Open this folder in Android Studio, install SDK platform 36 and build tools
35.0.0, then Run. The proposed application ID is `com.reylumi.android`;
confirm ownership before registering it in Play Console.

From this folder with Java 17 and the Android SDK configured (the checked-in
wrapper downloads verified Gradle 8.13):

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

The CI workflow produces an installable **debug preview**, not a store release.
The app loads `https://reylumi.com/explore`; unshipped web changes are not bundled.
Includes system Back, native sharing, file picker, persistent WebView
cookies, rotation/state restoration, keyboard/system-bar insets, progress and
connection retry. TLS errors use WebView's default rejection. The JavaScript
bridge is restricted to the Reylumi HTTPS origin and main frame. No background
jobs, push or broad storage permissions are enabled. Owner-approved camera and
foreground location permissions are requested when the feature is used, with
an active user gesture required for the first web permission prompt. Microphone
and background location are unsupported. File input uses the system chooser;
image capture can use the system camera through a cache-only FileProvider.
The trusted main-frame bridge adds
Android's share sheet, print preview and Save as for same-origin/blob downloads
up to 10 MB. No cookies are forwarded to other apps; cross-origin or redirected
downloads require the browser. Share/print open system UI; they do not send or
print automatically. Financial exports and printers require their own QA.

There is no duplicate native Back/Reylumi/Share toolbar. The existing Reylumi
headers and bottom navigation provide the app UI. Back first dismisses the IME
or an open app popover/dialog, then navigates WebView history. An ordinary cold
start restores the last trusted path without query strings/fragments; auth
routes return to Explore. Rotation keeps the current WebView and draft DOM.
No guarantee is made for process-death recovery of unsaved form contents.

Preview limitations: Market and API top-level links are blocked pending Android
billing review. This navigation filter is not an authorization or purchase
boundary: the remotely served SPA can still route/fetch internally. Before
store submission, integrate server/web recognition of `ReylumiAndroid/1.0`,
hide/gate unsupported purchasing in every entry point, preserve existing
entitlements, and validate Google Play Payments compliance. Do not reuse the
iOS external-checkout exemption as an Android policy decision. Social login,
provider redirects and POS hardware remain unaccepted. Galaxy A16 camera access
and exact test-QR decoding passed; the production Staff Scan workflow remains
unaccepted because the salon has Scan disabled. Physical GPS requests timed out;
an emulator location fix is not physical-device GPS acceptance.

Offline recovery uses the normal ACCESS_NETWORK_STATE permission to detect a
missing default network. It shows the existing retry screen even when WebView
could otherwise display a broken cached page. Reconnection requires an explicit
tap on Try again; it does not automatically reload a form or replay a write.
The WebView remains in memory while the offline screen is visible.

## Store bundle after owner signing decisions

Use the owner's existing secure key store / CI secret mechanism. Never commit
keys, passwords or reviewer credentials. Supply these environment variables:
`REYLUMI_ANDROID_KEYSTORE` (absolute path), `REYLUMI_ANDROID_STORE_PASSWORD`,
`REYLUMI_ANDROID_KEY_ALIAS`, `REYLUMI_ANDROID_KEY_PASSWORD`.

```powershell
.\gradlew.bat --no-daemon testDebugUnitTest lintRelease bundleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab`. Missing signing
variables fail release validation. Enroll in Play App Signing and preserve the
upload key under the owner's control. Set a versionCode greater than every
previous upload once the Play application identity is confirmed.

See [store preparation](../docs/android-ipad-store-preparation-20261105.md).

## Isolated local QA APK

`assembleQa` builds a debug-signed, test-only app named **Reylumi QA** with an
orange QA icon and separate package `com.reylumi.android.qa`. It does not replace
the normal Reylumi app, cookies or device permissions. The normal debug/release
variants retain `https://reylumi.com`, the existing identity and no cleartext.
The QA variant uses the same native Back, keyboard/insets, file picker, bridge,
camera and foreground-location code with the exact local app origin.

Start this checkout's isolated backend and app using `qa/local/Start-QA.ps1`.
Build with Java 17 and SDK 36 configured:

```powershell
.\gradlew.bat --no-daemon testQaUnitTest testDebugUnitTest lintQa lintDebug assembleQa
```

From the repo root, install/open on one explicitly selected ADB device:

```powershell
.\qa\local\Open-AndroidQA.ps1 -Serial '<ADB device serial>'
```

The launcher validates the local QA identity and APK package before installation,
then reverses only ports 3117 and 55421. Keep USB/ADB, Docker and the local app
running. It never launches or stops the production app. No QA credentials or
provider tokens are bundled into the APK; use only the synthetic local accounts.

QA HTTP resources (including service-worker fetches) are confined to
`http://localhost:3117` and `http://127.0.0.1:55421`. Camera/location/bridge access
is confined to the app origin, excluding the backend. External navigation is
blocked. Only generated checkout URLs matching
`https://checkout.stripe.com/qa/cs_test_qa_<32 lowercase hex>` map to the same-origin
QA checkout screen, which uses the local provider simulator server-side. This
never opens Stripe or tests real card, 3DS, refunds, delivery or billing approval.
Document WebSockets are confined to `ws://localhost:3117/_next/webpack-hmr`
and `ws://127.0.0.1:55421/realtime/v1/websocket` (the isolated backend).

QA is a developer test harness, not an operating-system firewall or a production
security boundary. These local checks do not establish real-device acceptance,
store readiness or provider integration. See the dated
[native QA report](../docs/android-native-qa-20261111.md) for tested evidence.
