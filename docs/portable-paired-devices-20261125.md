# Portable paired devices — agreed scope, 2026-11-25

Exactly two POS families: Portable staff checkout at the salon (existing Windows staff UI across Windows, browser and iPad) with its customer surface; and existing compact Owner POS in the iPhone app, unchanged. Preserve business flows, receipt/payment validation and durable draft recovery. No deployment is authorized by this implementation request.

Web/iPad enter `/pos/portable` and choose Employee or Customer screen. Employee uses the existing POS ID/passcode. Customer enters a short one-time pairing code issued from the authenticated employee workstation; QR is optional, never a camera requirement. Both use the same role/pairing model. Existing Windows installer and local dual-monitor behavior remain compatible.

Pair the customer device to a stable salon workstation, not to an incidental login or ticket. Persist this enrollment across browser/app restarts and employee login/logout. Customer does not log out until replaced/revoked; an employee logout must not remove enrollment. The unattended customer screen exposes only its allowed receipt/phone/check-in/tip functionality and must not gain employee or Owner access. Do not let Owner cookies choose the customer workstation.

Replacement customer enrollment revokes the old display, including reads, realtime and customer writes. Moving the employee to another device uses the same workstation and preserves customer pairing; transfer writer ownership without losing unsubmitted durable drafts or allowing two employee writers. Never silently copy unsynced work across devices or finalize a sale on reconnect.

Receipt edits must reach the customer while typing, without Submit. Customer tip must reach employee immediately. Use an authorized bidirectional workstation stream with current cart/revision/sequence, durable reconciliation and stale/duplicate protection. Measure both directions, including simultaneous edit/tip and reconnect; do not infer speed from timers or claim unmeasured physical-device acceptance.

Implementation source: clean assembled source21 commit `23aad9f1e1ca38b2912adb7523878519bd55d5ce`. The latest live/native release must still be reconciled by a release coordinator before publication. Local schema migrations, preview/browser tests and any native build are separate acceptance gates.

## Phương án đã chốt và đã thực hiện

- **Portable tại tiệm:** Windows, trình duyệt và iPad dùng chung bàn POS nhân viên và giao diện khách đang có. Windows giữ installer và adapter hai màn hình trên cùng PC. iPad tại quầy vào Portable, không dùng notebook Owner cho nhân viên.
- **Owner gọn:** giữ nguyên POS của chủ trong app iPhone. Phiên, quyền và nháp Portable không lấy theo cookie Owner. Vé bán của cùng tiệm vẫn đi vào báo cáo đúng luồng hiện có.
- **Đường vào:** `/pos/portable`; chọn Employee hoặc Customer screen. Giữ biểu tượng cài riêng Reylumi POS và lựa chọn mở Portable khi khởi động app iPad. Trang `/pos/portable/display` nằm trong scope web app; app iPad dùng hosted customer surface vì không có quyền staff native trên máy khách.
- **Lần đầu:** nhân viên đăng nhập POS ID/passcode, mở Devices for this counter, đặt tên/tạo quầy hoặc chọn quầy đã có. Bấm Connect customer screen để lấy mã 8 số, có hạn 5 phút và chỉ dùng một lần. Máy khách nhập mã; không cần camera và không cần mật khẩu nhân viên.
- **Hằng ngày:** máy nhân viên đăng nhập/đăng xuất như cũ. Máy khách giữ enrollment riêng và không đăng xuất theo nhân viên; khi quầy không hoạt động, máy khách về welcome/waiting và vẫn cho phép khách tự check-in/chọn dịch vụ. Checkout/tip cần quầy đang kết nối. Enrollment được gia hạn khi sử dụng. Không cần ghép lại mỗi ngày.
- **Đổi thiết bị:** Replace/Remove customer screen thu hồi quyền máy khách cũ ngay, kể cả đọc/ghi/realtime. Máy mới nhập mã một lần. Chuyển máy nhân viên giữ liên kết khách với cùng quầy; phải có quầy cũ online, nháp trống đã lưu và không còn việc chờ đồng bộ. Không tự chuyển nháp chưa đồng bộ sang máy khác. Web Lock chặn hai cửa sổ nhân viên ghi cùng nháp.
- **Đồng bộ:** preview gửi theo thay đổi tiền trước Submit; tip/customer intent phải được máy nhân viên kiểm tra đúng cart/revision và lưu bền trước ACK. Có generation/sequence, chữ ký, chống lặp và reconnect. Màn hình khách không nhận bearer token cũ; adapter gift/rewards/check-in giữ các thao tác khách hiện có.
- **Phục hồi:** browser đã đăng ký quầy có slot nháp ổn định qua cửa sổ mới, giữ cùng operation ID chưa được xác nhận. Không thay đổi slot lưu của Windows hay native iOS đang có.

## Kiểm chứng và giới hạn

Nguồn này qua TypeScript, ESLint cho các file sửa, production web build và bundle iOS target Safari 16. Bundle giữ `productionReady:true` như baseline; đây là readiness của asset cục bộ, không phải đã upload/publish iOS.

60 kiểm tra riêng biệt đạt. Một ca kiểm tra bản Windows cài thật bị skip vì không chạy installer trong lượt này. Kiểm tra HTML manifest trên Next server thật đã chạy riêng và đạt. Có ảnh desktop/iPad của trang vào trên dev server đúng worktree, không lỗi runtime hoặc tràn ngang.

Đo UI thật trong môi trường cô lập: 20 lần gõ tiền, lần đầu 125.8 ms, p50 14.0 ms, p95 46.7 ms; tip đến máy nhân viên, lưu bền và vẽ xong 14.0 ms cho một mẫu. Dùng timestamp trong browser và MutationObserver + requestAnimationFrame, loại thời gian Playwright. Kết nối đã admission trước khi gõ. Đây là phép đo cục bộ, không suy ra kết quả provider hoặc thiết bị thật.

PGlite thực thi migration mới; API, chữ ký, client transport và UI sản phẩm là nguồn thật. Auth, cloud draft ACK cũ và kênh giao Supabase dùng adapter cô lập; chưa xác nhận Supabase provider thật, full production schema hay hai iPad/PC vật lý. UI thử stale custom tip trong lúc nhân viên sửa tiền: từ chối bản cũ, thử lại đúng receipt thì thành công; reload không lặp tip.

Chưa chạy migration production, deploy web, build archive/sign/upload iOS hoặc cập nhật bản Windows tải về. Event hoàn thành là `needs-integration` vì nguồn source21 cần được đối chiếu với release baseline hiện hành trước phát hành. Migration và bundle mới phải được ghép trong cùng lượt phát hành; máy khách chưa ghép tiếp tục dùng trang vào.

Evidence: `artifacts/portable-paired-devices-20261125/actual-ui/result.json`, `browser/result.json`, `native-bundle-validation.json`, `ui-results.json`, frozen source và receipt của change event.

## Check-in customer web/iPad follow-up

The paired display preserves the existing phone → profile/account choice if required → “Hello, [name]!” service selection → confirmed check-in flow. Successful HTTP responses containing business steps (`profile_required`, `identity_choice_required`) reach the existing client handler instead of becoming a connection exception. A standalone check-in retains its pending request and chosen services across unrelated idle-cart changes or temporary stream reconnects; pending indicators belong to the exact request. Completed-receipt expiry now emits the next paired preview without requiring an employee edit.

Enrolled customer devices can submit their own check-in while the employee is signed out. The server forces the existing check-in-only resolver, retains live checkout/cart/revision checks, and resets a closed cloud draft only through its existing expired-receipt reader. Service updates and optional check-in receipts require a short-lived signed grant for the visit returned by phone confirmation, bound to the current customer enrollment. The paired receipt adapter resolves the legacy display bearer only on the server. No new schema or Owner permission is introduced.

Frozen before-fix reproduction and current-source UI evidence: `artifacts/portable-paired-checkin-20261125/`. Follow-up build, bundle hash validation and source handoff: `artifacts/portable-customer-checkin-transition-20261125/`. These checks use actual components, route, workstation SQL and phone/visit routing with isolated legacy-domain RPC and realtime delivery adapters; they do not establish provider or physical-iPad acceptance. This follow-up remains implementation-only until integration and publication.

Follow-up validation: 76 distinct local checks pass, including nine check-in journeys/security cases and four tests executing the original completion effect with a controlled clock. Scoped ESLint, TypeScript, production web build and all 370 updated native-bundle asset hashes pass.
