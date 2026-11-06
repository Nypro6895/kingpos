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
Includes system Back, public-link sharing, file picker, persistent WebView
cookies, rotation/state restoration, keyboard/system-bar insets, progress and
connection retry. TLS errors use WebView's default rejection. No JavaScript
native bridge, background jobs, push, location, camera or storage permissions.
File input uses the system chooser; direct camera capture and QR scanning need
separate device QA and permission decisions. Authenticated downloads/printing
are not implemented; the app explains the browser fallback.

Preview limitations: Market and API top-level links are blocked pending Android
billing review. This navigation filter is not an authorization or purchase
boundary: the remotely served SPA can still route/fetch internally. Before
store submission, integrate server/web recognition of `ReylumiAndroid/1.0`,
hide/gate unsupported purchasing in every entry point, preserve existing
entitlements, and validate Google Play Payments compliance. Do not reuse the
iOS external-checkout exemption as an Android policy decision. Social login,
provider redirects, POS hardware and device camera/GPS remain unaccepted.

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
