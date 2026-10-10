# Bước đầu cho iPhone + Windows

## Trạng thái

- Source WebView, icon, cấu hình XcodeGen và unit tests đã được chuẩn bị.
- Workflow `.github/workflows/reylumi-ios-check.yml` chạy trên macOS cloud của GitHub.
- Workflow chạy khi cập nhật nhánh riêng `codex/reylumi-ios-webview`, hoặc chạy thủ công khi đã có trên nhánh mặc định. Nó kiểm tra Simulator và tạo archive **chưa ký**, không phát hành hoặc cài app lên iPhone.
- Cần đưa các file iOS và workflow lên GitHub trước khi chạy; việc chỉ có file trên Windows chưa tạo một cloud build.

## Đăng ký Apple Developer

1. Trên iPhone, mở **Apple Developer**, vào **Account** và đăng nhập Apple Account hiện tại.
2. Kiểm tra xác thực hai yếu tố đã bật và tên pháp lý chính xác.
3. Chọn đăng ký Apple Developer Program. Chọn **Individual** nếu muốn tên cá nhân là người bán; **Organization** nếu có pháp nhân và muốn tên công ty là người bán.
4. Hoàn thành xác minh và thanh toán theo hướng dẫn Apple. Cài ứng dụng Apple Developer không tự kích hoạt membership.
5. Khi membership hoạt động, ghi lại **Team ID** trong tài khoản developer và xác nhận có thể mở App Store Connect.

Không gửi mật khẩu Apple Account, mã xác thực, private key hoặc certificate vào chat. Những thông tin bí mật phục vụ build phải được cấu hình trong kho secrets của dịch vụ build.

Hướng dẫn chính thức: [đăng ký Apple Developer](https://developer.apple.com/programs/enroll/).

## Kiểm tra build chưa ký

Sau khi workflow có trên GitHub, mở repository → **Actions → Reylumi iOS Build Check → Run workflow**, chọn nhánh có source iOS.

Kết quả gồm log, Simulator test results, archive chưa ký và receipt chứa commit, phiên bản Xcode và SHA256 source. Bản archive này kiểm tra tính khả thi của mã Swift; **không phải IPA để cài trên iPhone**. Đạt unit tests không chứng minh tất cả luồng web đã hoạt động trên iOS.

Repository hiện tại là public. Runner tiêu chuẩn trên repository public được GitHub cung cấp miễn phí; nếu đổi thành private hoặc dùng runner lớn, cần kiểm tra quota/billing. [GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage).

## Sau khi Apple kích hoạt membership

Chuẩn bị từng bước:

1. Xác nhận Team ID và Bundle ID riêng cho Reylumi (dự kiến `com.reylumi.ios`, cần kiểm tra còn đăng ký được).
2. Đăng ký App ID và tạo app record Reylumi trong App Store Connect.
3. Cấu hình signing: Apple Distribution certificate có private key và App Store provisioning profile, hoặc dịch vụ ký tự động phù hợp.
4. Cấu hình App Store Connect API key để upload từ cloud, cất private key vào secrets.
5. Workflow **Reylumi TestFlight** tạo archive đã ký, export IPA và upload App Store Connect bằng Xcode 26.3. Workflow chạy khi script ký được cập nhật trên nhánh iOS, hoặc chạy thủ công sau khi workflow được đăng ký trên nhánh mặc định.
6. Khi build được Apple xử lý, thêm tài khoản của chủ app vào nhóm internal testers rồi cài qua TestFlight.

Sau đó kiểm tra trên iPhone thật: login/logout, đóng mở app và session, personal/owner/staff workspace, booking, POS, export CSV, camera/ảnh, location/map, share, file download, bàn phím và safe area, mạng chậm/mất mạng, admin bị chặn. Chưa dùng dữ liệu production để thực hiện thanh toán/ghi giao dịch thử.

Trước khi app trỏ production, các thay đổi web nhận diện iOS phải được triển khai theo baseline production hiện tại trong AGENTS.md. Không triển khai toàn bộ checkout cũ để tránh ghi đè các bản Explore/admin/support đã phát hành.

TestFlight là bước kiểm thử; việc duyệt App Store chính thức vẫn cần hoàn thiện privacy, account deletion, moderation và giá trị ứng dụng theo Guideline 4.2.

Signing dùng GitHub Secrets `IOS_DISTRIBUTION_P12`, `IOS_DISTRIBUTION_PASSWORD`, `IOS_PROVISIONING_PROFILE`, `APP_STORE_CONNECT_PRIVATE_KEY` và variables `APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`. Không đưa chứng chỉ có private key, mật khẩu hoặc API private key vào Git. Build number là `run_number.run_attempt`; receipt và log được giữ 7 ngày. Upload thành công vẫn cần chờ Apple xử lý trước khi cài TestFlight.
