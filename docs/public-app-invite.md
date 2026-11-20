# Public app invitation

The mobile website can show a compact Reylumi invitation on supported public QR and share landings. It is disabled by default. The website remains usable, and dismissing the invitation suppresses it on that browser for seven days. Desktop browsers, installed standalone web apps and recognized Reylumi native contexts do not receive it.

Release configuration is server-only. There is no URL or query switch that enables the invitation.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `REYLUMI_PUBLIC_APP_INVITE_ENABLED` | Off | Set to the exact string `true` only after the intended public store listing is available and verified. |
| `REYLUMI_CUSTOMER_IOS_INSTALL_URL` | Empty | Public `https://apps.apple.com/.../app/.../id6821394475` listing for Reylumi. TestFlight is excluded. |
| `REYLUMI_CUSTOMER_ANDROID_INSTALL_URL` | Empty | Public `https://play.google.com/store/apps/details?id=com.reylumi.android` listing, once that exact package has been published and verified. |
| `REYLUMI_PUBLIC_GIFT_APP_HANDOFF_ENABLED` | Off | Set to the exact string `true` only after the compatible iOS Gift Card receiver has shipped and is available to the intended users. |

Each platform needs its own valid store URL. An absent or invalid URL keeps that platform's invitation hidden even if the global flag is enabled. The URL validator restricts the host and exact application identity, rejects credentials, non-HTTPS URLs, nondefault ports and fragments, and removes unrelated query parameters before presenting the link. These checks validate configuration; they do not prove that Apple or Google has made the listing available.

Eligible entries are an exact `/check-in/<UUID>` or `/qr?entry=<UUID>`; a Gift Card share at `/gift-cards#card=<64 lowercase hexadecimal characters>`; and explicit public booking, salon, Beauty, look, inspiration and campaign detail pages. Private QR, saved destinations, account and staff pages, invitation tokens, guest booking management, payment pages and Gift Card mobile payment sessions are excluded. Most query-bearing URLs are excluded to avoid interrupting an active transaction or forwarding a capability.

The current iOS app already accepts the exact `reylumi://check-in/<UUID>` link. The invitation offers that handoff only on iOS. Gift Card handoff requires the compatible native receiver and its separate release flag. Adding or changing Swift receivers or native navigation policy requires a new signed native build through the existing release process. A source change, local web test or TestFlight upload does not establish App Store publication. Android currently receives only its configured store action; no Android custom-scheme receiver is assumed. Other public share pages offer installation without claiming that they can open the same content in the installed app.

Gift Card bearer tokens stay in the `#card=` fragment when handing off to the compatible app. The invitation must not copy them into store links, query parameters, cookies, local storage, logs or analytics. Its dismissal storage contains only a timestamp under `reylumi.public-app-invite.dismissed.v1`. External store navigation uses a no-referrer policy. The prompt does not change authentication, claim, check-in, payment, balance or receipt authority.

Before enabling a store channel, verify its public listing on the intended device and browser, then validate the invitation's download, dismissal and continue-on-web behavior. Before enabling Gift Card handoff, verify the exact installed compatible binary, signed-in and signed-out handling, the fragment-preserving handoff and existing claim authority. Older installed builds must retain the web fallback. Universal Links currently associate the check-in route; expanding associated routes requires separate native and hosted association validation.

Installing a new app does not automatically resume the original Gift Card or booking. No deferred deep linking is added by this feature. The customer can return to the original web page and use the available explicit action after installation.

Behavioral unit checks: `node --test tests/public-app-invite.test.mjs`. Browser checks and release receipts remain separate evidence from physical iOS, Android, store and provider acceptance.

## Local handoff, 2026-11-14

Implemented in `C:\Reylumi-worktrees\public-app-invite-20261114` from clean release commit `23e66ab`. No website deployment, store publication, tester invitation or native upload was performed.

- Web: 17 focused unit/landing/native-bridge checks passed; scoped ESLint, TypeScript and the optimized Next build passed (308 generated pages).
- Actual local Next source: Chromium checks at 320/390/430/768px passed for layout, 44px action targets, fragment changes, mobile-payment exclusion, dismissal persistence, iOS/Android store selection, and native/desktop/standalone suppression. Gift page reads were blocked; this was not a populated Gift Card or payment acceptance test.
- A separate local optimized-build check with the flag off and valid store URLs configured verified no invitation, store download link or Smart App metadata on iPhone/Android user agents across public salon, Gift Card and check-in routes.
- iOS: strict Gift Card receiver, hosted fallback and latest-link ordering are implemented with XCTest cases. Two source reviews and existing bridge checks passed. Swift compilation and the new XCTest cases are pending: Windows has no Xcode/Swift and the configured `Mac.lan` hostname did not resolve. Keep the native event `needs-integration` and the Gift Card handoff flag off until these checks and the compatible native release are complete.
- Evidence is in `artifacts/public-app-invite-20261114/` (browser results, screenshots and frozen patch). The preview server enables sample configuration only on loopback, with background dispatch disabled and external/provider requests blocked.

Exploratory existing QR browser suites `personal-qr-ui.test.mjs` and `phone-checkin-camera.test.mjs` did not pass: the former has missing navigation exports in its isolated fixture, and the latter timed out waiting for its existing Scan salon QR control. Their source and QR implementation were unchanged by this task; these results do not establish a native failure or complete QR regression acceptance. The touched camera landing suite passed after updating its expectations for the new release gate.
