# Bản đồ dữ liệu native/web cho hồ sơ iOS

Ngày kiểm kê: **16/11/2026, America/Chicago** (machine timestamp `2026-11-17T04:45:34.901Z`). Base: `5b9609cc5faec74ae0893ed86d76a3d1970c3f66`. Phạm vi: iOS miễn phí, USA. Chỉ đọc source và tên/trạng thái cấu hình; không gọi provider, gửi tệp, tạo tài khoản demo, thay Store hoặc chạy CI. Đây là input để hoàn tất hồ sơ, chưa phải App Privacy đã chốt.

## Mức bằng chứng

- **Source xác nhận**: có đường mã và vị trí gọi; chưa chứng minh production bật hoặc đã có người dùng gửi dữ liệu.
- **Có cấu hình local**: tên có giá trị không rỗng; chưa kiểm tra key hợp lệ, DB override hoặc môi trường hosted.
- **Chưa xác minh runtime**: chưa bắt mạng trên iPhone/iPad thật, chưa đọc cấu hình/log/retention của provider.
- Fixture 433 migrations/Storage/Auth dùng ảnh tổng hợp và verifier giả lập có kiểm soát; không chứng minh provider ảnh thật hoặc Apple acceptance.

Base và hash từng file ở JSON. File thay đổi nội dung so với base trong lúc kiểm kê (so sánh chuẩn hóa CRLF): `ios/Reylumi/Info.plist`. Parent đã sửa riêng hai purpose strings trong Info.plist; key set quyền/bundle/version không đổi, archive và thiết bị thật còn pending. Không quy sửa đổi đó cho inventory.

## Native, quyền thiết bị và SDK

App dùng WKWebView với website store mặc định, bundle local và bridge gọi origin Reylumi. Các framework imports native: BackgroundTasks, CoreFoundation, CryptoKit, Foundation, SQLite3, SafariServices, Security, SwiftUI, UIKit, WebKit. Không tìm thấy Podfile/Cartfile/Package.resolved trong cây iOS tracked. Điều này không loại trừ SDK JavaScript trên trang hoặc mã provider tải động.

[ios/Reylumi/ReylumiLocalAppViewController.swift:88](../ios/Reylumi/ReylumiLocalAppViewController.swift#L88), [ios/Reylumi/ReylumiViewController.swift:137](../ios/Reylumi/ReylumiViewController.swift#L137), [lib/public-post-receipt.ts:14](../lib/public-post-receipt.ts#L14), [lib/public-post-receipt.ts:48](../lib/public-post-receipt.ts#L48), [lib/experience-state.ts:4](../lib/experience-state.ts#L4), [lib/location/explore-gps-area-client.ts:19](../lib/location/explore-gps-area-client.ts#L19)

Info.plist khai **Camera, Photo Library, Location When In Use**. Entitlement có associated domains, không có APNs. Source scanner dùng video với `audio:false`. Không tìm thấy native Contacts/microphone/IDFA/ATT/APNs registration/CLLocationManager/PHPhotoLibrary APIs trong phạm vi Swift đã kiểm kê; không có bằng chứng vị trí nền. Kết quả âm tính này không phủ nhận quyền do WebKit/file input/browser GPS sử dụng. Cần kiểm tra trên thiết bị thật.

[ios/Reylumi/Info.plist:20](../ios/Reylumi/Info.plist#L20), [ios/Reylumi/Info.plist:21](../ios/Reylumi/Info.plist#L21), [ios/Reylumi/Info.plist:22](../ios/Reylumi/Info.plist#L22), [ios/Reylumi/Reylumi.entitlements:4](../ios/Reylumi/Reylumi.entitlements#L4)

Camera còn phục vụ QR check-in và service relay; Photos còn dùng cho Support/Claim và paystub ảnh ở Tax. Purpose string tại base chỉ mô tả Beauty/Salon. Parent đã cập nhật wording bao quát các mục đích này riêng, không thêm quyền mới; XML/key set/bundle/version đã đối chiếu, chưa có archive/device QA. Xem [camera-purpose-validation.json](../artifacts/ios-submission-scope-20261116/camera-purpose-validation.json).

[ios/Reylumi/Info.plist:20](../ios/Reylumi/Info.plist#L20), [app/staff/scan/qr-scanner.tsx:18](../app/staff/scan/qr-scanner.tsx#L18), [app/staff/scan/qr-scanner.tsx:37](../app/staff/scan/qr-scanner.tsx#L37), [app/service-relay/staff-relay.tsx:254](../app/service-relay/staff-relay.tsx#L254)

[ios/Reylumi/Info.plist:21](../ios/Reylumi/Info.plist#L21), [app/beauty/beauty-profile-client.tsx:460](../app/beauty/beauty-profile-client.tsx#L460), [app/beauty/actions.ts:3](../app/beauty/actions.ts#L3), [lib/public-image-safety.ts:67](../lib/public-image-safety.ts#L67), [lib/normalize-image.ts:5](../lib/normalize-image.ts#L5), [app/support/support-ui.tsx:8](../app/support/support-ui.tsx#L8), [app/tax-company/actions.ts:56](../app/tax-company/actions.ts#L56), [app/claim/claim-panel.tsx:65](../app/claim/claim-panel.tsx#L65)

### PrivacyInfo không thay thế App Privacy

File hiện chỉ có required-reason APIs: **UserDefaults / CA92.1**, **SystemBootTime / 35F9.1**. Không có khóa `NSPrivacyTracking` hoặc `NSPrivacyCollectedDataTypes` trong file được kiểm kê. Không được suy ra “app không thu thập dữ liệu”, “tracking=false đã được xác nhận” hoặc nhãn App Privacy đã xong. Cần aggregate Privacy Report của archive cuối và đối chiếu API/SDK thực sự được đóng gói.

[ios/Reylumi/PrivacyInfo.xcprivacy:5](../ios/Reylumi/PrivacyInfo.xcprivacy#L5), [ios/Reylumi/PrivacyInfo.xcprivacy:13](../ios/Reylumi/PrivacyInfo.xcprivacy#L13), [ios/Reylumi/PrivacyInfo.xcprivacy:19](../ios/Reylumi/PrivacyInfo.xcprivacy#L19), [ios/project.yml:20](../ios/project.yml#L20)

| Dependency | Lock version | Phạm vi cần xét |
| --- | --- | --- |
| @supabase/supabase-js | 2.108.2 | JS browser/WK hoặc hosted route; theo điều kiện feature |
| @stripe/stripe-js | 10.0.0 | JS browser/WK hoặc hosted route; theo điều kiện feature |
| botid | 1.5.11 | JS browser/WK hoặc hosted route; theo điều kiện feature |
| maplibre-gl | 5.24.0 | JS browser/WK hoặc hosted route; theo điều kiện feature |
| jsqr | 1.4.0 | JS browser/WK hoặc hosted route; theo điều kiện feature |
| nodemailer | 10.5.0 | Server/build; không suy ra là SDK native iOS |
| sharp | 0.34.5 | Server/build; không suy ra là SDK native iOS |
| next | 16.2.9 | Server/build; không suy ra là SDK native iOS |

SDK source/lock evidence: @supabase/supabase-js: [package.json:25](../package.json#L25), [package-lock.json:1995](../package-lock.json#L1995); @stripe/stripe-js: [package.json:24](../package.json#L24), [package-lock.json:1918](../package-lock.json#L1918); botid: [package.json:26](../package.json#L26), [package-lock.json:3345](../package-lock.json#L3345); maplibre-gl: [package.json:28](../package.json#L28), [package-lock.json:5915](../package-lock.json#L5915); jsqr: [package.json:27](../package.json#L27), [package-lock.json:5514](../package-lock.json#L5514); nodemailer: [package.json:30](../package.json#L30), [package-lock.json:6169](../package-lock.json#L6169); sharp: [package.json:34](../package.json#L34), [package-lock.json:6867](../package-lock.json#L6867); next: [package.json:29](../package.json#L29), [package-lock.json:6059](../package-lock.json#L6059).

jsQR xử lý QR cục bộ; MapLibre là renderer, còn endpoint map tiles/geocoding thuộc MapTiler. Không coi việc có package là bằng chứng package tự thu thập dữ liệu. Next có cả runtime web và build/server; không phải SDK native iOS. Những SDK tải động/được đóng gói phải được xác minh từ archive và mạng thực tế trước khi chốt.

[ios/project.yml:4](../ios/project.yml#L4), [.github/workflows/reylumi-ios-testflight.yml:19](../.github/workflows/reylumi-ios-testflight.yml#L19), [ios/project.yml:11](../ios/project.yml#L11)

Project target iOS 16.0, iPhone/iPad; workflow source chọn Xcode 26.3. Các giá trị này không thay SDK/version/build từ signed archive cuối. Native đã quan sát gần nhất là **1.0.0 (100)**, source `830f0a6`; snapshot Apple 16/11/2026 20:31–20:32 UTC. Inventory này không refresh Apple.

## Dữ liệu theo đường chạy

Category/purpose tiếng Anh là **ứng viên để đối chiếu taxonomy Apple**, chưa phải khai báo cuối. Linked được suy ra khi source gửi/lưu account/session/salon/recipient; hash và mã hóa không tự biến dữ liệu thành anonymous.

### Camera / QR

- Dữ liệu: Video frames decoded locally; QR identifier goes to feature callback. User-chosen captured photos follow upload flow.
- Category ứng viên: Photos or Videos when uploaded; Identifiers/Other Data for submitted QR workflow.
- Purpose ứng viên: App Functionality.
- Đường đi: Browser getUserMedia(video,audio:false) → canvas/jsQR → callback. Native permission string exists; no separate native camera module found.
- Liên kết / giới hạn: Scanner frames are local in inspected code; subsequent check-in/relay command can be account/workflow-linked.
- Bằng chứng: `source_confirmed; physical permission and no-frame-upload network check pending`.

[ios/Reylumi/Info.plist:20](../ios/Reylumi/Info.plist#L20), [app/staff/scan/qr-scanner.tsx:18](../app/staff/scan/qr-scanner.tsx#L18), [app/staff/scan/qr-scanner.tsx:37](../app/staff/scan/qr-scanner.tsx#L37), [app/service-relay/staff-relay.tsx:254](../app/service-relay/staff-relay.tsx#L254)

### Photos / social content / private documents

- Dữ liệu: Selected image/PDF; caption/body; author/salon IDs and logical paths; normalized dimensions/hash.
- Category ứng viên: Photos or Videos; Other User Content; Customer Support; User ID; Financial Info where paystub/tax document is uploaded.
- Purpose ứng viên: App Functionality; Product Personalization only where feature actually uses it.
- Đường đi: File input → local Blob preview/conversion → authenticated Storage. New social candidate: private staging → server normalization → verifier seam → immutable approved public bytes. Private support/Tax remain separate.
- Liên kết / giới hạn: Uploads and manifest are linked to author/salon/recipient. Local preview is not server collection. Private business files must not enter social verifier.
- Bằng chứng: `source_confirmed; classifier not connected; hosted activation unverified`.

[ios/Reylumi/Info.plist:21](../ios/Reylumi/Info.plist#L21), [app/beauty/beauty-profile-client.tsx:460](../app/beauty/beauty-profile-client.tsx#L460), [app/beauty/actions.ts:3](../app/beauty/actions.ts#L3), [lib/public-image-safety.ts:67](../lib/public-image-safety.ts#L67), [lib/normalize-image.ts:5](../lib/normalize-image.ts#L5), [app/support/support-ui.tsx:8](../app/support/support-ui.tsx#L8), [app/tax-company/actions.ts:56](../app/tax-company/actions.ts#L56), [app/claim/claim-panel.tsx:65](../app/claim/claim-panel.tsx#L65)

### Location / GPS

- Dữ liệu: Exact latitude/longitude, resolved city/state/ZIP; request IP at network boundary.
- Category ứng viên: Precise Location candidate; Coarse Location; Identifiers/network metadata.
- Purpose ứng viên: App Functionality.
- Đường đi: getCurrentPosition → first-party POST /api/explore/area → server MapTiler if key, else/fallback Census. Exact coordinates also occur in scoped sessionStorage cache key; server bounded memory cache hashes exact inputs.
- Liên kết / giới hạn: First-party request carries session context. Resolver does not write GPS to account/disk. This does not establish provider/hosting non-retention or unlinked status. highAccuracy:false does not make returned coordinates coarse.
- Bằng chứng: `source_confirmed; provider/runtime/retention unverified`.

[ios/Reylumi/Info.plist:22](../ios/Reylumi/Info.plist#L22), [app/explore/explore-client.tsx:3404](../app/explore/explore-client.tsx#L3404), [lib/location/explore-gps-area-client.ts:19](../lib/location/explore-gps-area-client.ts#L19), [lib/location/explore-gps-area-client.ts:29](../lib/location/explore-gps-area-client.ts#L29), [lib/location/explore-gps-area.ts:47](../lib/location/explore-gps-area.ts#L47), [lib/location/explore-gps-area.ts:4](../lib/location/explore-gps-area.ts#L4)

### Maps / address search / directions

- Dữ liệu: Map viewport/tiles/IP; typed address/area query; salon street/city/state/ZIP; destination address/coordinate in external link.
- Category ứng viên: Location; Search History candidate; Physical Address where personal address is provided; Other Data.
- Purpose ứng viên: App Functionality.
- Đường đi: Client MapLibre → MapTiler maps/styles; first-party server → MapTiler geocoding/Census; explicit directions → Apple/Google Maps.
- Liên kết / giới hạn: Direct tiles expose client network metadata; server geocoding exposes server IP plus query/coordinates. External destination handling belongs in provider review.
- Bằng chứng: `source_confirmed; production key/provider logs unknown`.

[app/explore/explore-map.tsx:154](../app/explore/explore-map.tsx#L154), [lib/location/address-suggestions.ts:16](../lib/location/address-suggestions.ts#L16), [lib/location/providers/census-address-geocoder.ts:10](../lib/location/providers/census-address-geocoder.ts#L10), [ios/Reylumi/NavigationPolicy.swift:68](../ios/Reylumi/NavigationPolicy.swift#L68)

### Account / session / security

- Dữ liệu: Auth access/refresh cookies and user ID; login IP, user agent, OS/device label, coarse city/region/country; signed random app/browser identifier and HMAC abuse signals.
- Category ứng viên: Contact Info; User ID; Device ID candidate for app/browser pseudonymous identifier; Coarse Location; Other Data/security.
- Purpose ứng viên: App Functionality; Security/fraud prevention (confirm Apple purpose mapping).
- Đường đi: WK default cookies ↔ first-party server → Supabase Auth/DB. Native bridge forwards applicable origin cookies; browser Supabase client may connect directly.
- Liên kết / giới hạn: Login activity explicitly stores user_id with IP/UA. Pseudonymous device cookie is not IDFA or hardware identifier; hashing does not establish anonymity.
- Bằng chứng: `source_confirmed; live cookies/log retention unverified`.

[lib/supabase/server.ts:18](../lib/supabase/server.ts#L18), [lib/supabase/browser.ts:19](../lib/supabase/browser.ts#L19), [ios/Reylumi/ReylumiCookieAuthority.swift:9](../ios/Reylumi/ReylumiCookieAuthority.swift#L9), [ios/Reylumi/ReylumiLocalAppTransport.swift:436](../ios/Reylumi/ReylumiLocalAppTransport.swift#L436), [lib/account-security.ts:433](../lib/account-security.ts#L433), [lib/abuse-signals.ts:29](../lib/abuse-signals.ts#L29)

### Native read cache / POS outbox

- Dữ liệu: Authorized read envelopes, account/workspace/salon scopes, customer/business/POS display data, queued operation bodies; device-only encryption keys.
- Category ứng viên: Inherit actual customer/business payload categories; local storage alone is not server collection.
- Purpose ứng viên: App Functionality.
- Đường đi: App Support encrypted read files; AES-GCM body blobs in SQLite; Keychain AfterFirstUnlockThisDeviceOnly; file protection/backup exclusion. Native display cache separate from command queue; outbox sends authorized operations when permitted.
- Liên kết / giới hạn: Locally scoped to account/workspace/salon authority. Encryption does not remove personal/business data. Queued operation becomes collection when transmitted.
- Bằng chứng: `source_confirmed; device backup/reset/logout/recovery proof pending`.

[ios/Reylumi/ReylumiPortableStore.swift:14](../ios/Reylumi/ReylumiPortableStore.swift#L14), [ios/Reylumi/ReylumiPortableStore.swift:136](../ios/Reylumi/ReylumiPortableStore.swift#L136), [ios/Reylumi/ReylumiPortableStore.swift:105](../ios/Reylumi/ReylumiPortableStore.swift#L105), [ios/Reylumi/ReylumiPortableStore.swift:117](../ios/Reylumi/ReylumiPortableStore.swift#L117), [ios/Reylumi/ReylumiLocalReadStore.swift:118](../ios/Reylumi/ReylumiLocalReadStore.swift#L118), [ios/Reylumi/ReylumiLocalReadStore.swift:270](../ios/Reylumi/ReylumiLocalReadStore.swift#L270), [ios/Reylumi/ReylumiBackgroundSync.swift:92](../ios/Reylumi/ReylumiBackgroundSync.swift#L92)

### WKWebView / browser storage / draft recovery

- Dữ liệu: Persistent first-party cookies/website data; session browsing state; unresolved post request UUID, frozen caption/input/media paths; GPS preference and exact-coordinate cache key.
- Category ứng viên: User Content/Identifiers when submitted; local-only retention reviewed separately.
- Purpose ứng viên: App Functionality.
- Đường đi: WKWebsiteDataStore.default; bounded sessionStorage experience state and unresolved post receipts; manual-location localStorage read/removal remains reachable.
- Liên kết / giới hạn: Receipt is author/profile/salon-scoped and not anonymous. No File/Blob/access token stored by helper. SessionStorage lifetime on actual WK app restart must be checked; do not imply indefinite durability.
- Bằng chứng: `source_confirmed; iOS lifecycle/device erasure unverified`.

[ios/Reylumi/ReylumiLocalAppViewController.swift:88](../ios/Reylumi/ReylumiLocalAppViewController.swift#L88), [ios/Reylumi/ReylumiViewController.swift:137](../ios/Reylumi/ReylumiViewController.swift#L137), [lib/public-post-receipt.ts:14](../lib/public-post-receipt.ts#L14), [lib/public-post-receipt.ts:48](../lib/public-post-receipt.ts#L48), [lib/experience-state.ts:4](../lib/experience-state.ts#L4), [lib/location/explore-gps-area-client.ts:19](../lib/location/explore-gps-area-client.ts#L19)

### Sponsored ads / attribution / discovery

- Dữ liệu: HMAC IP/visitor identifier; campaign/session/path/audience/mobile-desktop; impression/click time; signup conversion user ID; guest UUID or signed-in Explore user key.
- Category ứng viên: Advertising Data; Product Interaction; User ID; Device ID/Other Data candidates.
- Purpose ứng viên: Third-Party Advertising candidate for sponsored salon advertiser; Analytics; App Functionality for discovery.
- Đường đi: First-party cookies → ad API → Supabase campaign/impression/events; advertised external destination may leave origin.
- Liên kết / giới hạn: Signup conversion explicitly passes p_user:user.id. No-IDFA/native-ad-SDK search does not settle tracking=false; cross-company combination/provider use must be evidenced separately.
- Bằng chứng: `source_confirmed; tracking/sale-share classification and operational retention unknown`.

[app/api/explore/advertising/route.ts:35](../app/api/explore/advertising/route.ts#L35), [app/api/explore/advertising/route.ts:116](../app/api/explore/advertising/route.ts#L116), [lib/advertising-attribution.ts:79](../lib/advertising-attribution.ts#L79), [lib/explore-visitor.ts:16](../lib/explore-visitor.ts#L16), [lib/explore-visitor.ts:24](../lib/explore-visitor.ts#L24)

### Local diagnostics / hosting logs / anti-abuse

- Dữ liệu: Bounded timing/status/category, allowed command name and random request UUID; app/build/bundle/time in manual report. Server separately records user-linked login/security IP/UA and errors.
- Category ứng viên: Performance Data; Other Diagnostic Data; Identifiers/security data.
- Purpose ứng viên: App Functionality; Analytics only as actual diagnostic/processor practice supports.
- Đường đi: Native transport defaults local diagnostics enabled. User chooses Save/Share; no automatic report upload. First-party requests carry request UUID; server/hosting have independent logging.
- Liên kết / giới hạn: Native report allowlist rejects account/device IDs, URLs, cookies and business payloads. Server security logs explicitly link user ID. Do not conflate local diagnostic privacy with server retention.
- Bằng chứng: `source_confirmed; live hosting logs/drains/provider retention unverified`.

[ios/Reylumi/ReylumiLocalAppTransport.swift:88](../ios/Reylumi/ReylumiLocalAppTransport.swift#L88), [ios/Reylumi/ReylumiLocalDiagnostics.swift:103](../ios/Reylumi/ReylumiLocalDiagnostics.swift#L103), [ios/Reylumi/ReylumiLocalDiagnostics.swift:125](../ios/Reylumi/ReylumiLocalDiagnostics.swift#L125), [ios/Reylumi/ReylumiLocalAppViewController.swift:392](../ios/Reylumi/ReylumiLocalAppViewController.swift#L392), [lib/account-security.ts:439](../lib/account-security.ts#L439), [lib/abuse-server.ts:65](../lib/abuse-server.ts#L65)

### Payments / email / SMS

- Dữ liệu: Amounts/orders/subscriptions/account-salon metadata; billing/card entry in Stripe UI when applicable; phone/email recipient, OTP/booking/support/invite body, delivery IDs.
- Category ứng viên: Purchase History; Payment Info/Other Financial Info candidates by actual collector; Email Address; Phone Number; Customer Support; Other User Content.
- Purpose ứng viên: App Functionality.
- Đường đi: Server → Stripe/Twilio/Resend/SMTP; iOS Market requests hosted checkout and opens Safari. Embedded Stripe.js is web/booking path, not proof all iOS Market payments embed.
- Liên kết / giới hạn: Orders and delivery records can link to account/salon/recipient. Raw card data in provider UI does not mean app collects no financial information.
- Bằng chứng: `source_confirmed; enabled products/live-test mode/delivery/provider retention unknown`.

[app/market/card-checkout-panel.tsx:237](../app/market/card-checkout-panel.tsx#L237), [components/booking-card-payment.tsx:13](../components/booking-card-payment.tsx#L13), [lib/platform-payment.ts:10](../lib/platform-payment.ts#L10), [lib/gift-card-stripe.ts:56](../lib/gift-card-stripe.ts#L56), [lib/system-sms.ts:16](../lib/system-sms.ts#L16), [lib/booking-notifications.ts:27](../lib/booking-notifications.ts#L27), [lib/email.ts:80](../lib/email.ts#L80), [lib/smtp-mail.ts:17](../lib/smtp-mail.ts#L17)

### In-app notifications / background refresh / push boundary

- Dữ liệu: Notification title/body/booking/salon/recipient-kind/read state; no APNs device token path found in scoped source.
- Đường đi: Authenticated app_notifications DB reads and /api/notifications polling; BGTaskScheduler read-refresh for native cached models. These are separate from APNs remote notifications.
- Liên kết / giới hạn: Notification data is contextual to account/business workflow. Background fetch is not evidence of push permission or a push SDK.
- Bằng chứng: source_confirmed; no native or web PushManager/Notification.requestPermission registration found in searched app/components/lib/public/native source; physical delivery/lifecycle unverified.

[lib/app-notifications.ts:5](../lib/app-notifications.ts#L5), [lib/notification-client.ts:216](../lib/notification-client.ts#L216), [ios/Reylumi/Info.plist:18](../ios/Reylumi/Info.plist#L18), [ios/Reylumi/ReylumiAppDelegate.swift:6](../ios/Reylumi/ReylumiAppDelegate.swift#L6)

## Provider và ranh giới client/server

| Provider | Đường đi và dữ liệu | Cấu hình / thiếu chứng cứ |
| --- | --- | --- |
| supabase | Browser/WK client Storage/media/realtime plus first-party server. Native HTTP bridge only calls first-party /api/app-local. Account/contact/session; scoped user/business/financial content; photos/files; security/ad events as enabled. | Canonical local env names present; production project/region/RLS/backups/logs not queried. |
| vercel-botid | Client initBotId protects POST; conditional server check when VERCEL=1. Hosting sees feature requests and network metadata. Endpoint payloads, IP/UA/headers/security context. Exact BotID SDK signals/retention not inferable from app source. | Source configured; hosted activation, region, logs/drains/account settings unknown. |
| maptiler | Browser/WK map requests direct; address/GPS lookup via first-party server. Viewport/tiles/client IP; typed address or exact coordinate with server IP for geocoding. | Requires MAPTILER_API_KEY/public map config; no matching local name populated in audited locations. Hosted and packaged config unknown. |
| us-census | Server in traced providers; code requires no API key. Exact GPS or street/city/state/ZIP, server IP. | Reachable without commercial map key; no live request made. |
| twilio | Server only; global encrypted settings/env fallback and separate salon encrypted entitlement-bound config. Phone, verification channel/OTP or SMS body, routing and provider delivery ID; no phone contacts permission shown. | Canonical local account/auth/Verify names present; DB may override. Runtime activation, consent and provider logs/retention unknown. |
| email | Server only, encrypted shared DB settings or env fallback. Recipient/sender/reply-to, subject, HTML/text support/booking/invite content, delivery IDs. | No local Resend/SMTP names populated in audited env/files; DB settings and sender readiness not queried. |
| stripe | Server APIs; iOS Market hosted checkout opens Safari; conditional embedded web/booking checkout. Amounts/orders/products/subscriptions/customer-salon metadata; card/billing data entered in provider UI, app keeps results/webhooks. | Encrypted platform payment DB settings plus booking/gift/campaign configuration. No local Stripe names populated; hosted live/test mode unknown. |
| image-verifier | Future approved verifier receives final normalized shared social image bytes from server; current helper has no provider client. Normalized image bytes; no blanket permission to send private Tax/payroll/support files. Provider training/region/retention/terms cannot yet be claimed. | Not connected: missing verify throws unavailable. Synthetic fixture verifier is not production classifier. |

**supabase** — Endpoint/source: deployment-specific *.supabase.co. [lib/supabase/browser.ts:15](../lib/supabase/browser.ts#L15), [lib/supabase/server.ts:164](../lib/supabase/server.ts#L164), [ios/Reylumi/ReylumiLocalBundle.swift:53](../ios/Reylumi/ReylumiLocalBundle.swift#L53), [app/beauty/actions.ts:64](../app/beauty/actions.ts#L64)

**vercel-botid** — Endpoint/source: reylumi.com first-party hosting; BotID runtime route/domain requires network capture. [instrumentation-client.ts:5](../instrumentation-client.ts#L5), [lib/abuse-server.ts:62](../lib/abuse-server.ts#L62), [lib/abuse-signals.ts:35](../lib/abuse-signals.ts#L35), [next.config.ts:2](../next.config.ts#L2)

**maptiler** — Endpoint/source: api.maptiler.com. [app/explore/explore-map.tsx:154](../app/explore/explore-map.tsx#L154), [lib/location/address-suggestions.ts:9](../lib/location/address-suggestions.ts#L9), [lib/location/providers/maptiler-area-reverse.ts:7](../lib/location/providers/maptiler-area-reverse.ts#L7)

**us-census** — Endpoint/source: geocoding.geo.census.gov. [lib/location/providers/census-area-reverse.ts:8](../lib/location/providers/census-area-reverse.ts#L8), [lib/location/providers/census-address-geocoder.ts:11](../lib/location/providers/census-address-geocoder.ts#L11), [lib/location/explore-gps-area.ts:63](../lib/location/explore-gps-area.ts#L63)

**twilio** — Endpoint/source: verify.twilio.com; api.twilio.com. [lib/twilio-settings.ts:31](../lib/twilio-settings.ts#L31), [lib/twilio-settings.ts:42](../lib/twilio-settings.ts#L42), [lib/system-sms.ts:18](../lib/system-sms.ts#L18), [lib/booksms.ts:15](../lib/booksms.ts#L15)

**email** — Endpoint/source: api.resend.com; operator-configured SMTP TLS port 465/587. [lib/support-email.ts:31](../lib/support-email.ts#L31), [lib/email.ts:77](../lib/email.ts#L77), [lib/smtp-mail.ts:15](../lib/smtp-mail.ts#L15), [lib/smtp-mail.ts:35](../lib/smtp-mail.ts#L35)

**stripe** — Endpoint/source: api.stripe.com; checkout.stripe.com; billing.stripe.com; connect.stripe.com; Stripe.js runtime domains require capture. [lib/platform-payment.ts:10](../lib/platform-payment.ts#L10), [lib/booking-deposit.ts:12](../lib/booking-deposit.ts#L12), [app/market/card-checkout-panel.tsx:13](../app/market/card-checkout-panel.tsx#L13), [ios/Reylumi/NavigationPolicy.swift:63](../ios/Reylumi/NavigationPolicy.swift#L63), [components/booking-card-payment.tsx:15](../components/booking-card-payment.tsx#L15)

**image-verifier** — Endpoint/source: chưa chọn. [lib/public-image-safety.ts:67](../lib/public-image-safety.ts#L67), [lib/public-image-safety.ts:76](../lib/public-image-safety.ts#L76), [docs/public-image-safety-20261116.md:7](../docs/public-image-safety-20261116.md#L7)

## Tên và presence cấu hình đã kiểm tra

Process và worktree hiện không có các tên provider trong bộ lọc ở environment/file .env được kiểm kê. Canonical `C:/Reylumi/kingpos/.env.local` có các tên sau với trạng thái present=true: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REYLUMI_TWILIO_ACCOUNT_SID`, `REYLUMI_TWILIO_VERIFY_SERVICE_SID`, `REYLUMI_TWILIO_AUTH_TOKEN`, `PLATFORM_SETTINGS_ENCRYPTION_KEY`. Không ghi giá trị vào tài liệu/JSON.

Đây không phải bằng chứng hosted đang bật hoặc credential còn hợp lệ. Twilio, email, thanh toán và BookSMS đọc encrypted DB settings/entitlement theo hệ thống hoặc salon; audit không truy vấn các bản ghi đó. Thiếu tên MapTiler/Stripe/Resend local không chứng minh production không dùng provider. Không cần yêu cầu chủ app đoán SDK hoặc gửi key cho bước source inventory này.

Parent kiểm tra public JS nhưng **dừng trước provider GET** vì không bind duy nhất được Supabase origin; không đọc Auth settings hoặc dữ liệu riêng. Đây là khoảng trống cấu hình kỹ thuật, không phải bằng chứng Auth/provider tắt. Xem [public-auth-readback.json](../artifacts/ios-submission-scope-20261116/public-auth-readback.json).

Public policy readback của parent lúc 2026-11-17T04:42:21.058Z: bốn route /privacy, /terms, /community, /business-terms đều HTTP 200; /privacy vẫn chứa lời hứa xóa trong 24 giờ. Reachability không chứng minh policy đã khớp data flow/retention mới. Xem [public-policy-readback.json](../artifacts/ios-submission-scope-20261116/public-policy-readback.json).

## Chứng cứ còn thiếu trước khi chốt

1. Inspect final signed archive/IPA: aggregate Privacy Report, included manifests/SDK signatures/reasons, exact Xcode/SDK/version/build, permissions/entitlements. Workflow Xcode26.3 and project defaults are not final archive evidence.
2. Actual iPhone/iPad: camera/Photos/QR, location allow/deny/manual fallback, app-local and hosted routes, background refresh, logout/account switch, offline expiry/reset/deletion, sessionStorage lifetime. No physical acceptance in this audit.
3. Sanitized device/network capture and provider/admin read-only evidence for enabled settings, direct/server destinations, region/subprocessors, IP/UA/log/backup retention, deletion and training/data-use terms.
4. Complete Apple category/purpose/linking/tracking mapping from all feature data. Native manifest/no-IDFA search cannot decide App Privacy. Sponsored salon advertisers need Third-Party Advertising purpose review separately from tracking.
5. Choose/connect/validate real image verifier only with separate authorization. Record photo recipient/purpose/retention. Do not send unrelated private financial/support documents.
6. Confirm operational retention and historical residual/bearer token limits. New staging seven-day expiry and strict isolated erasure tests are not provider-wide deletion evidence.
7. Prepare authorized non-sensitive reviewer fixtures: guest, customer author/report/block, salon owner/staff scope, disposable account deletion. Stable OTP/MFA/review access; do not require real purchase or SMS or expose private records.
8. Read back final App Store age/rights/free-USA/review/build/App Privacy after approval. No Store data or provider settings changed by this inventory.

Reviewer fixture tối thiểu: guest public, customer author/report/block, owner/staff của salon fixture, và tài khoản có thể tự xóa thử. Ghi rõ route/role, OTP hoặc MFA thay thế hợp lệ và giới hạn tính năng. Dùng dữ liệu giả có quyền sử dụng; không đưa hồ sơ Tax/payroll/customer thật hoặc bắt reviewer mua hàng/gửi SMS thật để mở chức năng cốt lõi. Inventory không tạo tài khoản hay truyền credentials.

Sponsored salon ads cần đối chiếu **Third-Party Advertising** dù không có SDK quảng cáo ngoài. Tracking là câu hỏi riêng: cần xác minh việc kết hợp dữ liệu giữa các doanh nghiệp và cách từng bên nhận sử dụng. Cookie app/browser ID và conversion signup có dữ liệu liên kết; không viết “không IDFA nên không Device ID/tracking”.

Market và giao dịch ad credits vẫn thuộc phạm vi audit/khai báo bản iOS đầu tiên theo quyết định của chủ app. Điều kiện installed/entitlement/default-off không loại dữ liệu của các đường source này khỏi inventory; quyết định này không bật feature đang tắt hoặc đổi giá.

Market iOS hosted checkout khác web embedded Stripe.js. Miễn phí tải app không tự giải quyết việc bán digital features hoặc ad credits. Xem [commerce inventory](ios-submission-commerce-scope-20261116.md); tài liệu này không quyết định thay review thanh toán theo storefront/sản phẩm.

Phần dữ liệu nghiệp vụ/private bổ sung: [business data inventory](ios-submission-business-data-map-20261116.md). Không dùng native-only manifest để bỏ qua dữ liệu do backend của các feature đó xử lý.

Machine-readable evidence: [native-data-map.json](../artifacts/ios-submission-scope-20261116/native-data-map.json). Chỉ hai file inventory được viết; không sửa sản phẩm, journal hoặc commit.
