# Check Writer — chuẩn bị gộp release, vẫn đóng bán

Ngày: 2026-10-28 (America/Chicago). Chưa deploy, push, upload, mở bán, chạy migration production, thu tiền hoặc in check thật.

## Đã hoàn tất trong lượt chuẩn bị này

- Chốt runtime `CHECK_WRITER_SALES_ENABLED` mặc định đóng; chỉ giá trị chính xác `true` cùng khóa mã hóa hợp lệ mới vượt qua chốt này. Chốt catalog vẫn độc lập. Chốt chỉ áp dụng checkout mới của Check Writer; không sửa Payroll hoặc chặn lịch sử/hủy check của salon đã có quyền.
- Migration bổ sung `20261029040000_check_writer_sales_hold.sql` giữ giá 490 cents, đặt `fulfillment_ready=false`. Ghép cả ba migration Check Writer theo thứ tự; không dừng sau migration giá cũ vì nó từng đặt ready=true. Chưa có migration nào được chạy lên production trong chat này.
- PostgreSQL 17 thật trên Docker local (image Supabase sẵn có), dữ liệu giả lập, listener 127.0.0.1:55478: 18/18 kiểm thử đạt. Có hai connection thật cạnh tranh: cùng request chỉ tạo một batch; hai lần chuẩn bị output với cùng counter chỉ một thành công. Đây là PostgreSQL local, không phải Supabase staging/Auth/PostgREST được nghiệm thu.
- 74/74 kiểm thử tập trung đạt, gồm provider contract: gọi code đối soát hiện hữu với provider fixture, kiểm tra đúng salon/plugin/account/490 cents/month/USD, invoice/payment succeeded, không cấp quyền cho hóa đơn chưa trả, giữ refund facts. Không gọi Stripe thật. ESLint và production Next.js build (gồm TypeScript) đạt.
- Preflight staging chỉ đọc, yêu cầu chọn rõ project ref và cấu hình `CHECK_WRITER_ENVIRONMENT=staging`; không thực thi nội dung env, không xuất secret, không query dòng ngân hàng/payroll. Kiểm tra đúng target, cấu hình mã hóa, schema truy cập service, anonymous bị từ chối và catalog 490/closed. Không tự thay đổi quyền hoặc bật bán.

## Cần owner cung cấp / thao tác

1. **Staging Supabase riêng:** chỉ vị trí file cấu hình private trên máy hoặc secret manager, cùng project ref staging. Cần `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; không gửi giá trị secret trong chat. Không dùng file production hiện hữu làm staging. Cho biết môi trường staging đã có toàn bộ schema Market/card/tax hiện hữu hay chưa. Việc kiểm tra schema không được tự suy ra đã kiểm tra đăng nhập Owner/MFA với tài khoản thật.
2. **Khóa Check Writer staging:** cấu hình server-only `CHECK_WRITER_ENCRYPTION_KEY` (32 bytes ngẫu nhiên, 64 ký tự hex) hoặc key map + active ID qua secret manager. Tạo riêng cho staging; không tái sử dụng key ephemeral của demo, không commit/log. Giữ key backup tách khỏi DB backup, giữ key cũ khi rotation. Tôi chưa tạo hoặc ghi credential thật.
3. **Stripe acceptance:** pipeline Market hiện hữu bắt buộc `mode=live` khi reserve và `livemode=true` khi đối soát/webhook. Vì vậy chỉ cung cấp sk_test không đủ để chạy end-to-end qua pipeline này. Cần thống nhất một môi trường/provider acceptance test riêng tương thích trước; không sửa thành live, không dùng tiền thật và không nới guard production để giả lập kết quả. Nếu muốn hỗ trợ Stripe test end-to-end, đó cần một thay đổi Market test-mode có ranh giới staging rõ, được review riêng trước khi thực hiện. Không có live paid acceptance proof trong gói này.
4. **Mac/Xcode:** kết nối máy Mac để build simulator/test + unsigned archive đúng source Check Writer bridge v2 đã ghép vào baseline iOS mới nhất. Workflow kiểm tra hiện hữu là `.github/workflows/reylumi-ios-check.yml`; không dùng workflow TestFlight upload cho bước nghiệm thu này. Hai Desktop Commander devices đều offline tại lúc kiểm tra; Windows không có Xcode/Swift. Không dispatch/push/upload hoặc đụng pipeline/lock release khác trong chat này.
5. **Máy in:** owner dùng giấy trắng/dummy stock có đánh dấu TEST, ngân hàng giả, không ký và không đưa lưu thông. Thử Windows printer + iPhone/AirPrint; cung cấp ảnh bản in và tên thiết bị/driver/stock, không lộ tài khoản thật. Kiểm tra kích thước Letter 100%, một mặt, một bản, check trên cùng, hai cùi dưới, vùng MICR/margin, tên tiếng Việt, memo và dòng ký tay. MICR/stock acceptance thực tế phải được xác nhận trước khi phát hành in check.

## Chạy preflight khi có staging

File private dành cho kiểm tra thêm `CHECK_WRITER_ENVIRONMENT=staging` và `CHECK_WRITER_SALES_ENABLED=false`. Biến ENVIRONMENT là nhãn bảo vệ cho công cụ preflight, không đổi hành vi billing runtime.

```powershell
node scripts/check-writer-preflight.mjs --env-file <private-staging-env-path> --staging-project-ref <exact-staging-ref>
node scripts/check-writer-preflight.mjs --env-file <private-staging-env-path> --staging-project-ref <exact-staging-ref> --check-backend
```

Không gọi được staging thì giữ gate pending; không coi local fixture là pass. Chỉ chạy migration vào staging riêng đã xác định, sau khi review nguồn và phạm vi; không chạy qua file production.

## Phiếu nghiệm thu thiết bị / backend

| Ca thử | Kết quả cần có | Trạng thái |
|---|---|---|
| Staging schema + service/anon quyền | Đủ bảng/RPC, anon không đọc ngân hàng/check | Chờ staging |
| Owner thực, MFA, đổi salon, hết unlock | Không fallback MFA; dữ liệu/PDF xóa khi nền/khóa; không ghi sai salon | Chờ staging |
| Encryption persistence/rotation | Reload/decrypt/reprint đúng key; key sai fail closed; không lộ số tài khoản | Local đạt; chờ staging |
| Provider checkout/renewal/refund/portal | Chỉ provider xác minh mới cấp quyền, sai invoice không cấp, không mua trùng | Fixture + SQL đạt; provider thật chưa kiểm tra |
| iOS compile/tests/unsigned archive | Bridge v2 trong đúng revision ghép; giữ thay đổi native đã ship | Chờ Mac/CI source đã duyệt |
| Windows print + AirPrint | PDF không cắt chữ, đúng Letter/stock, một mặt/một bản; hai cùi chỉ có mục đã tick | Chờ thiết bị |
| Hủy dialog / printer jam / app background | Không đánh dấu đã trả; output đã dùng cần lý do để chuẩn bị lại; không tạo số mới | Logic local đạt; chờ thiết bị |
| In lặp / tải PDF rồi in | App chỉ dispatch một lần; kiểm tra lý do/lịch sử cho lần sau | Local đạt; PDF/OS vẫn có thể copy ngoài app |

## Tái chạy PostgreSQL local

Không dùng remote DB URL. Test adapter cố định localhost:55478 và tạo DB test mới cho mỗi lần chạy. Container `reylumi-check-writer-qa-20261028` dùng image `public.ecr.aws/supabase/postgres:17.11.0.006`, cổng chỉ bind 127.0.0.1, volume tmpfs, mật khẩu public disposable `local-disposable-qa`; không lưu dữ liệu salon thật. `pg` chỉ được cài trong thư mục work, không thêm runtime dependency cho app.

```powershell
npm install --prefix work/check-writer-readiness pg@8.23.1 --no-audit --no-fund
$env:CHECK_WRITER_LOCAL_POSTGRES='true'
node --test tests/check-writer.integration.test.mjs
Remove-Item Env:CHECK_WRITER_LOCAL_POSTGRES
```

Evidence local PostgreSQL: `postgres.txt`; focused suite: `tests.txt`; production build: `build.txt`; targeted lint: `lint.txt` trong review của frozen handoff readiness. Không đánh đồng PostgreSQL local với toàn bộ Supabase staging.

## Kết luận bàn giao

Giữ `needs-integration`. Phần code đã kiểm tra có thể đưa vào candidate gộp với checkout đóng, nhưng chưa ghi READY cho backend/provider/native/physical acceptance chưa có bằng chứng. Giữ audit/source cũ bất biến; overlay readiness này bắt buộc đi sau bản audit giá. Coordinator đối chiếu baseline production mới nhất trước khi ghép. Không phụ thuộc Market mới đang xây riêng; không triển khai nguyên worktree kế thừa.
