# QR app MFA / Xác thực hai bước

## English

The QR QA sign-in supports existing verified TOTP authenticators. Select a
factor, request a challenge, and enter its six-digit code. Phone and passkey
factors fail closed in this reference. No enrollment, recovery-code handling,
MFA removal, password reset or account security setting is performed here.
Use the canonical account security interface for those separate operations.

Password sign-in with an enrolled factor creates only a pending session, never
full access. Its opaque Secure/HttpOnly cookie expires within ten minutes.
The AAL1 token, selected challenge and allowed return path stay encrypted in
the private SQL store, bound to context, cookie hash and revision. Only a
verified AAL2 response for the same account and current factor can atomically
consume the pending row and create the full app session. Client headers,
callback URLs and older app cookies cannot elevate a pending session.

Each pending session permits at most five challenges and five verification
attempts. An incorrect code consumes its challenge; request a fresh challenge
before another attempt. Expired challenges cannot be verified. Reloading or
restarting the app preserves these limits. Starting a new password sign-in
retires the old app session and cancels older pending state.

A lost provider/database response leaves the operation unresolved. Reload
does not repeat the provider write. Cancel the pending session and sign in
again deliberately. Cancellation clears its encrypted token and fences late
verification responses. After five known incorrect codes, the pending token
is cleared. The identity provider's own limits still apply independently.

Never capture codes, passwords, cookies or tokens in screenshots, request
recordings, support tickets or logs. The app does not retain provider refresh
tokens. Deployments need HTTPS and a separately reviewed target; the shipped
target remains disabled. Local tests mock GoTrue and use PGlite, and do not
establish real Auth, managed PostgreSQL concurrency or hosted-cookie acceptance.

Fresh QA databases use storage.sql and the bundled restricted-role grant.
For an existing reviewed three-table private store, inspect
mfa-storage-upgrade.sql separately. It adds only the pending table and narrow
permissions; it does not alter Auth users, factors, keys or settings. Neither
script is executed against a real database by this work.

## Tiếng Việt

Trang đăng nhập QR hỗ trợ ứng dụng xác thực TOTP đã được đăng ký và xác minh.
Chọn thiết bị, tạo yêu cầu xác thực, rồi nhập mã sáu chữ số. Ví dụ này chưa hỗ
trợ SMS hay passkey; không tự đăng ký, tắt MFA, đổi mật khẩu hoặc dùng mã khôi
phục. Các thao tác đó thuộc trang bảo mật tài khoản chính thức.

Sau mật khẩu, tài khoản có MFA chỉ nhận phiên chờ tối đa mười phút. Token và
yêu cầu xác thực được mã hóa trên máy chủ. Chỉ kết quả AAL2 được Auth xác minh,
đúng tài khoản và thiết bị hiện hành mới tạo phiên truy cập đầy đủ. Không thể
dùng header, đường dẫn callback hoặc cookie cũ để bỏ qua bước này.

Mỗi phiên chờ có tối đa năm yêu cầu và năm lần kiểm tra mã. Mã sai làm yêu cầu
hiện tại hết hiệu lực; cần tạo yêu cầu mới trước khi thử tiếp. Tải lại trang
hoặc khởi động lại ứng dụng không đặt lại giới hạn. Đăng nhập mới thu hồi phiên
ứng dụng cũ và hủy phiên chờ trước đó.

Nếu kết quả bị mất khi kết nối gián đoạn, trang không tự gửi lại. Hãy hủy phiên
chờ rồi chủ động đăng nhập lại. Hủy sẽ xóa token chờ và chặn kết quả xác minh
đến muộn. Sau năm mã sai đã xác nhận, token chờ bị xóa. Giới hạn riêng của nhà
cung cấp Auth vẫn áp dụng.

Không đưa mã xác thực, mật khẩu, cookie hay token vào ảnh, log hoặc yêu cầu hỗ
trợ. Bộ kiểm thử dùng dữ liệu giả và PostgreSQL trong bộ nhớ; chưa chứng minh
GoTrue thật, HTTPS hoặc cơ sở dữ liệu nhiều kết nối. Cấu hình QA mặc định vẫn
tắt. Chưa tạo tài khoản, đăng ký MFA, cấp khóa hoặc thay đổi tài nguyên thật.

Với cơ sở dữ liệu mới, dùng bộ SQL đã rà soát. Với kho riêng ba bảng đã có,
rà soát riêng mfa-storage-upgrade.sql; bản nâng cấp chỉ thêm bảng phiên chờ và
quyền tối thiểu cho role hiện hữu, không thay đổi bảo mật tài khoản Auth.

References: [challenge](https://supabase.com/docs/reference/javascript/auth-mfa-challenge),
[verify](https://supabase.com/docs/reference/javascript/auth-mfa-verify).
