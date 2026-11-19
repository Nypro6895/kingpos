# iOS commerce — triển khai và kiểm chứng local 18/11/2026

**Đã sửa hai lỗi xác nhận trạng thái; chưa deploy hoặc nghiệm thu giao dịch thật.** Baseline `04128e40de1a2ce22170c0fc95ea053668c29e26`. Market và ad-credit transactions tiếp tục nằm trong phạm vi iOS theo quyết định đã chốt. Không đổi giá, trial, billing, entitlement, flags, provider, key hoặc quyền salon.

## Hai lỗi có bằng chứng và phần sửa

1. **Market return giấu lỗi đối soát.** [market-payment-return.ts](../lib/market-payment-return.ts#L8) dùng `Promise.allSettled` nhưng bỏ kết quả, nên [Server Action](../app/market/payment-return-actions.ts#L6) báo “Payment status checked” ngay cả khi mọi lần xác nhận bị lỗi. Hàm nay trả số check thành công/thất bại; action giữ thông báo pending nếu có failure. Vẫn xử lý hết các sibling, chỉ đọc purchase đã lưu của Owner/salon hiện hành, bỏ duplicate plugin cũ, và chỉ sync subscription từ checkout đã complete. Không dùng URL return làm chứng cứ paid.
2. **Webhook expiry ad-credit có thể mất retry.** [expireCreditCheckout](../lib/campaign-payments.ts#L244) trước đây bỏ qua lỗi trả về từ database update. Một write thất bại có thể vẫn đi tới đánh dấu event processed. Nay lỗi được ném về caller để [processCardEvent](../lib/market-card.ts#L40) giữ trạng thái failed/retry. Update vẫn chỉ nhắm đúng order, `automatic=false`, `status=pending`; không thay payment reference, tạo charge, trả tiền hoặc cấp credit.

Các test mới chạy chính các module nguồn với state/transport giả. Baseline mode chỉ thay ba file product bằng nội dung Git của baseline, không sửa checkout đang làm việc. Nó tái hiện thông báo checked sai và expiry mất retry; log baseline thất bại có chủ đích được lưu riêng, không gọi đó là acceptance đạt.

## Phạm vi acceptance

| Luồng | Bằng chứng local thực hiện | Giới hạn |
| --- | --- | --- |
| Giá, phí, thuế và metadata checkout | Quote từ stored snapshot, tax inclusive/exclusive và legacy fee; metadata/order/provider account, hosted success/cancel return; không dùng client price hoặc return flag làm paid authority. | Mock provider + fixture; chưa chứng minh giá/config live. |
| Market retry và Safari return | Recovery cùng checkout/reservation; không tạo checkout thay thế khi subscription/payment chưa rõ; chỉ reconcile saved purchase. Chromium kiểm tra bridge, foreground retry chỉ read, đổi salon/unmount và return không mang quyền thanh toán. | Chromium không phải Safari/native iOS hoặc device acceptance. |
| Subscription entitlement/refund | Paid/unpaid/trial/expiry, invoice/charge compatibility, partial/full refund, automatic-tax credit-note và admin role/payer gates trong các test hiện có. | Chỉ chứng minh logic đã kiểm; không thực hiện refund thật hoặc xác nhận provider account. |
| Ad-credit checkout và return | Stored amount/metadata/idempotency; không dùng customer của payer khác; unpaid/foreign order/intent chưa succeeded/ledger error không được báo credit đã sẵn sàng. Replay giữ order/reference. | Ledger idempotence được kiểm tra thêm bằng SQL fixture, không phải một mocked wallet tự cộng tiền. |
| Hủy ad-credit checkout | Complete không bị đổi thành cancelled; expiry lỗi không cập nhật trạng thái; thành công chỉ expire saved checkout rồi update pending order. | Hủy checkout chưa trả tiền khác hủy campaign hoặc hoàn tiền card. |
| Card setup | Owner/salon/customer/setup-intent và payment revision; stale callback không thay lựa chọn mới. Chỉ lưu card sau verification; không tạo auto purchase. | Không gửi card, không gọi setup provider thật. |
| Auto-top-up | Actual queue payment callback với fetch giả: unknown result giữ processing; retry có provider reference chỉ GET cùng intent, không charge mới; frozen claim giữ amount/customer/method. SQL fixture kiểm tra demand, consent, monthly cap, paused reserve và late-success cấp một lần. | Không bật top-up hoặc chạy cron/provider thật. |
| Credit returns | SQL fixture kiểm tra unused campaign credits trở về đúng salon balance, period/budget và reconciliation; pending/unknown không bị coi là đã quyết toán. | Đây không phải cash refund. |

Ba UI fixture cũ cần sửa boundary test: chúng còn mock direct actions trong khi component hiện dùng `useScopedMarketActions`. Esbuild vì vậy kéo cả server graph vào browser/SSR fixture và lỗi trước assertions. Đã giữ **hook/context/salon scoping thật**; chỉ thay scoped server transport bằng fixture, action không dùng sẽ throw. Không giảm hoặc bỏ các assertion giá/thuế, bridge, foreground và account/salon switching. Các import graph này đã có ở baseline; lỗi fixture không do hai product fixes thêm import.

## Refund còn mở, không được ghi thành đã xong

[Credit panel](../app/campaigns/credit-panel.tsx#L303) nói unused campaign credits trở về salon balance và hủy ad không tự refund card. Trong scoped campaign paths chưa tìm thấy user cash-refund UI hoặc chính sách debit/reversal ad-credit đã triển khai cho một one-off card refund/dispute. Generic subscription invoice/refund tests không chứng minh phần đó.

Đây là quyết định legal/commercial và thiết kế ledger cần chốt riêng: partial/full refund khi credit chưa dùng/đã dùng, dispute, authority, audit và hỗ trợ. Không tự trừ wallet, refund, bật route hoặc viết blanket no-refund waiver. Legal agent đã được báo ranh giới này; các quyền hoàn tiền/hủy không thể miễn trừ vẫn phải được tôn trọng. Báo cáo local chỉ xác nhận các test cụ thể ở bảng trên, không gọi toàn bộ refund system hoàn tất.

## Apple và runtime

Đã đọc lại [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) ngày 18/11/2026. §3.1.1(a) cho phép external purchase links/CTA trên US storefront mà không cần link entitlement; không suy ra mọi digital flow được chấp thuận. §3.1.3(e) phân biệt dịch vụ salon dùng ngoài app; §3.1.3(g) phân biệt mua promotion hiển thị trong chính app với standalone ad management. Vì vậy giữ phân loại đúng giữa download miễn phí, paid digital modules/ad credits và physical salon payments; không đổi sang IAP hoặc khai mọi thứ miễn phí chỉ từ một giả định.

Theo readback trực tiếp của coordinator ngày 18/11, Vercel project hiện trỏ `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv`; tên/scope env được nhìn thấy nhưng value bị masked. Verify-to-Reveal yêu cầu người dùng xác minh và đã được hủy, không nhập code/reveal value. Việc thấy tên Check Writer flags hoặc public Supabase variables không chứng minh boolean/value đã áp dụng cho deployment. Applied-environment binding vẫn mở; lượt này không GET Stripe/Supabase commerce config, không đọc bank/customer rows, không ghi report/provider và không dùng proof giả. Xem [provider preflight](ios-provider-preflight-20261117.md).

## Kiểm chứng và bàn giao

- New actual-source acceptance: 9/9 pass, toàn bộ provider/database transports giả; không real purchases, messages hoặc ads deliveries.
- Affected fixture rerun: 18/18 pass sau khi sửa đúng transport boundary; original assertions được giữ.
- Combined scoped acceptance: **123/123 pass, zero skipped**, gồm server/mock, PGlite và browser fixtures; `final-acceptance.log`.
- Scoped ESLint và CRLF-aware whitespace check: **pass** trên các file owned.
- Không chạy full build riêng: coordinator sẽ build một lần trên combined frozen source của mọi agent, sau key flow và release reconciliation.

Artifacts tại `artifacts/ios-commerce-implementation-20261118/`: start/scope immutable journal manifests, baseline regression logs, affected fixture log, final scoped acceptance, frozen manifest và completion record. Trạng thái bàn giao là **needs-integration**; full build, exact runtime configuration, physical iOS/Safari, commercial/legal refund decision và App Review vẫn không được suy ra từ các test local.
