# Phạm vi thương mại để chuẩn bị hồ sơ iOS — 16/11/2026

**DRAFT_RUNTIME_EVIDENCE_PENDING — phạm vi đã chốt, chờ bằng chứng runtime; chưa phải hồ sơ đã nộp.** Đối chiếu checkout `5b9609cc5faec74ae0893ed86d76a3d1970c3f66`, trạng thái tracked sạch trước lượt đọc. Sau đó coordinator có delta riêng ở `ios/Reylumi/Info.plist` cho hai purpose strings Camera/Photos (event `99a55902-1e52-451b-a7f9-3081ab67c3ef`); không thuộc phạm vi thương mại này và không đổi 41 file nguồn đã hash. Chủ app đã chốt iOS, tải miễn phí, USA, copyright Reylumi và operator Reylumi LLC. Không hỏi lại các quyết định này.

Nguồn có Market, thuê bao, quảng cáo/credit, booking, Gift và POS. Vì vậy “tải miễn phí” không đủ để khai “mọi tính năng/giao dịch đều miễn phí”. Lượt này chỉ đọc mã và tài liệu Apple; không đọc giá trị env, dữ liệu khách, cấu hình provider/DB, không mua hàng hoặc phát quảng cáo.

## Cách hiểu trạng thái

- **Có đường nguồn:** đã nối được route/component/action; chưa phải nghiệm thu binary hay hosted.
- **Cấu hình chưa biết:** phải xác nhận enabled/ready/mode/catalog/quyền thực tế; không thay bằng giả định đã bật hoặc đã tắt.
- **Mặc định đóng:** mã yêu cầu opt-in rõ ràng; giá trị environment thật vẫn chưa được đọc.
- **Preview/test:** không mô tả thành sản phẩm đã bán hoặc đã tích hợp.

## Inventory và phạm vi nên mô tả

| Nhóm | Phân loại và đường nguồn | Điều còn phải xác nhận |
| --- | --- | --- |
| App/core | Tải iOS miễn phí; booking/discovery và workspace theo quyền. Native không loại Market khỏi các route cho phép. [NavigationPolicy:19](../ios/Reylumi/NavigationPolicy.swift#L19), [Market page:28](../app/(app)/market/page.tsx#L28). | Candidate và backend thực tế; không dùng trạng thái local để kết luận live. |
| Market và thuê bao | Digital modules: Check Writer, Vietnamese, Booking Rules, Booking Deposit, Check-in Receipt, Tax Company, BookSMS. Giá/catalog và readiness được tính lại từ dữ liệu runtime. [Allowlist](../lib/market-card-rules.ts#L1), [catalog](../lib/market-catalog-view.ts#L24), [readiness](../lib/market-experience-data.ts#L123). | Catalog published/fulfillment_ready, quote/tax/fees, enabled/live và quyền dùng hiện hữu. Không lấy sample price làm giá đã bán. |
| Thanh toán Market trên iOS | Client iOS yêu cầu external/hosted; server có nhánh hosted Stripe, native mở host được phép bằng Safari. Web còn có Stripe.js embedded. [Client:237](../app/market/card-checkout-panel.tsx#L237), [server:246](../app/market/card-payment-actions.ts#L246), [native:361](../ios/Reylumi/ReylumiViewController.swift#L361). | Đúng binary, bridge/version, checkout → Safari → quay lại → quyền dùng; không thử bằng giao dịch thật. |
| Trials/Check Writer | Trials tách khỏi paid checkout. Check Writer mở sales và trial bằng hai cờ độc lập cùng crypto readiness. [Trial:9](../app/market/trial-actions.ts#L9), [gates:6](../lib/check-writer-readiness.ts#L6). | Giá trị cờ, lịch sử/quyền cũ. Không bật cờ/key hoặc đổi trial trong báo cáo này. |
| Activation không thu tiền trong đường đã rà | Payroll Download cài/gỡ không gọi thanh toán. Phone Checkin có giá trong listing nhưng action hiện tại chỉ cài/gỡ plugin; không được suy ra đã thu phí. [Payroll:5](../app/market/plugin-actions.ts#L5), [Phone Checkin:63](../app/service-relay/actions.ts#L63). | Đối chiếu wording giá/trial với cơ chế đang dùng; không tự sửa giá hoặc quyền. |
| Preview/bank | Các proposal chưa tích hợp vẫn `available:false`/Coming Soon. Main Market đặt tên `BankCheckoutPanel` cho import **CardCheckoutPanel**; bank billing state không chứng minh đang mở bank-transfer UI. [Projection:34](../lib/market-catalog-view.ts#L34), [alias:39](../app/market/market-client.tsx#L39), [bank read:133](../lib/market-bank-billing.ts#L133). | Đường UI thực và invoice/quyền cũ. Không gọi mọi listing hoặc bank component là giao dịch đang bật. |
| Ads và ad credits | Bề mặt Sponsored có thật; Campaigns cài riêng, welcome/free credit khác credit mua thêm. Có Checkout và optional automatic top-up có consent/readiness. Đây là digital promotion. [Install/buy:14](../app/campaigns/credit-actions.ts#L14), [provider gate:10](../lib/campaign-payments.ts#L10), [delivery:9](../components/owner-sponsored-post.tsx#L9). | Advertiser, campaign đang bật, budget, payment/top-up. Không phát impression/click để kiểm. Quảng cáo của salon độc lập là candidate **Third-Party Advertising**; quảng bá sản phẩm Reylumi là candidate **Developer Advertising**; thống kê là **Analytics**. Hệ thống ads tự viết không quyết định tracking. |
| Booking của khách | Deposit/full prepayment cho dịch vụ salon, tách khỏi tiền thuê digital module Booking Deposit. Hosted/embedded theo salon; test order có thông báo không thu tiền. [Customer payment:46](../lib/booking-deposit.ts#L46), [test:137](../lib/booking-deposit.ts#L137), [module fee:9](../lib/booking-deposit-checkout.ts#L9). | Salon enable/active, merchant account charges/payouts, live/test, refund/support. Không gọi record nội bộ là đã thanh toán. |
| Gift | Counter sale, online sale, wallet, transfer và redemption là các nghiệp vụ khác nhau. Source mô tả dùng tại salon, chưa thấy Gift làm tiền mua plugin/ad credit. Online sale cần installed và Stripe-ready. Native có alias/command Gift dù không có renderer riêng trong inventory chính. [Stripe:13](../lib/gift-card-stripe.ts#L13), [API:43](../app/api/gift-cards/route.ts#L43), [alias:18](../lib/app-local-secondary-registry.tsx#L18), [command:68](../lib/app-local-platform-types.ts#L68). | Luồng binary/hosted/return, scope sử dụng và điều khoản Gift thực tế. Giữ balances, redemption, transfer và recovery cũ. |
| POS/receipt | Ghi nhận dịch vụ, tender, tip, Gift/Reward và receipt theo canonical submit; không tự chứng minh có charge/settlement của provider. [Submit:992](../app/pos/actions.ts#L992), [Gift reconciliation:26](../lib/pos-ticket-financial-view.ts#L26). | Payment method/provider thực tế nếu có. Không tạo receipt thật để lấy screenshot. |
| Developer/hosted app | Có runtime và API sau `MARKET_PLATFORM_ENABLED`; registry riêng sau `MARKET_PRIVATE_REGISTRY_ENABLED`. Commerce của developer yêu cầu test key và localhost, không chứng minh live sales. Main Market loader đang render first-party client; chưa thấy nối recovery/owner loader của developer vào nó. [Runtime:7](../lib/market-platform/server.ts#L7), [registry:8](../lib/market-registry/server.ts#L8), [test-only:4](../lib/market-platform/stripe-test.ts#L4), [isolated DB:15](../lib/market-platform/commerce.ts#L15). | Flags, catalog/software thật được cung cấp, permission consent và recipients. Không khai developer marketplace đã mở chỉ từ các file này. |

Các dòng trên là kết luận nguồn có giới hạn. Không suy ra giá trị flag/provider từ biến mặc định hoặc không tìm thấy import; các direct routes/API vẫn phải nằm trong preflight khi gate tương ứng bật.

## Dữ liệu thương mại cần đưa sang Privacy

- **Market:** user/salon/plugin, quote/tax/fees, payment/customer/subscription/invoice references và entitlements; backend/Supabase, Stripe khi dùng. Hosted card-entry khác embedded card-entry; không khai blanket rằng app không bao giờ tiếp xúc payment information.
- **Booking/Gift/POS:** identity/contact, appointment/service/staff, amount/tender/tip, receipt, Gift balance/transfer/redemption; salon/holder/người nhận được phép, hạ tầng và Stripe theo luồng. Email draft do người dùng chọn khác dịch vụ gửi email đã vận hành.
- **Ads:** campaign/session, area/query/device/audience/path, view/click/signup và user link. Signup truyền `p_user` rõ ràng tại [advertising-attribution:72](../lib/advertising-attribution.ts#L72). Phải map đúng advertiser ownership/mục đích; không nhận là anonymous hoặc no tracking khi chưa đối chiếu recipients/third-party data.
- **Hosted plugins:** version/manifest, scope consent, published data, launch/support/privacy destination và connection/revocation; xác nhận từng developer thực sự nhận dữ liệu. Không mặc định cấp payroll/tax hoặc toàn bộ workspace.

Bản đồ chi tiết native/provider ở [native data map](ios-submission-native-data-map-20261116.md); inventory có cấu trúc và evidence ở [commerce-scope.json](../artifacts/ios-submission-scope-20261116/commerce-scope.json).

## Apple rules used — checked 16 November 2026

[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/):

- 2.3.1/2.5.19: disclose real features; do not conceal functionality from review.
- 3.1.1: digital feature access and digital-use gift credit need payment analysis.
- 3.1.1(a): US storefront apps may link to external purchase methods without the link entitlement. This is not blanket approval of every implementation.
- 3.1.3(c): Owner/B2B labels alone do not establish the enterprise exception.
- 3.1.3(e): physical services consumed outside the app use non-IAP payment.
- 3.1.3(g): buying same-app promotion differs from a standalone ad-management service.
- 4.7: assess remote-software obligations if hosted plug-ins are actually offered.

[App Privacy](https://developer.apple.com/app-store/app-privacy-details/): displaying another business’s ads can be Third-Party Advertising. Analytics and user-linked data require their own mapping; tracking is a separate definition. These distinctions do not guarantee acceptance.

## Phạm vi nhỏ nhất có thể mô tả trung thực

Giữ core và toàn bộ quyền, balances, dữ liệu, invoice/subscription management/cancellation đang có. Với source hiện tại, inventory để review phải bao gồm Market, sponsored placements và mọi payment/credit path thực sự có thể tới được; không thể thu hẹp chỉ bằng cách bỏ chúng khỏi mô tả hoặc demo.

**Chủ app đã chốt: “Giữ trong phạm vi để kiểm tra và khai báo” đối với Market/ad-credit transactions trong lần iOS đầu.** Quyết định phạm vi đã đóng; không hỏi lại. Tiếp tục giữ toàn bộ quyền dùng hiện hữu và kiểm chứng runtime để khai báo đúng. Việc giữ trong phạm vi không cho phép tạo giá/billing mới, bật provider/flag đang tắt hoặc cấp key/permission mới; cũng không chứng minh checkout, ads hay paid catalog đang active. Giữ các preview/default-off/readiness gate hiện hữu đúng nghĩa, không bật để làm demo và không tắt để giấu reviewer.

Việc còn lại chỉ gồm ba nhóm: (1) owner/operator xác nhận snapshot không chứa secret về enabled/ready/live-test/catalog/entitlements, ad ownership; (2) agent đối chiếu native candidate/route/payment-return bằng fixture an toàn và soạn review notes từ trạng thái đã xác nhận; (3) owner/coordinator duyệt declarations, tích hợp/kiểm chứng trước submission. Chưa deploy, đổi billing/key, hoặc gửi Apple trong lượt này.
