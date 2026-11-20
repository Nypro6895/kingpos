# Kiểm tra OpenAI thật cho ảnh bài đăng — 18/11/2026

**Kết nối và hợp đồng phản hồi của adapter đạt cho một ảnh tổng hợp an toàn. Chưa bật đăng ảnh công khai, deploy hoặc nộp Store.**

Owner tự tạo và tự lưu key vào `.env.local` của worktree iOS theo lựa chọn đã trao đổi. Kiểm tra chỉ xác nhận file/key có mặt, file được Git ignore và không tracked; không in giá trị. Agent không tạo key, không ghi/copy secret, không gọi lại luồng xác nhận nơi lưu đã trả not-approved. Key chỉ được đọc trong memory để gửi Authorization tới endpoint cố định của OpenAI.

## Kết quả thực tế

Thời điểm: **21:26:45 ngày 18/11/2026, America/Chicago**; timestamp UTC trong receipt là `2026-11-19T03:26:45.619Z`.

| Kiểm tra | Kết quả |
| --- | --- |
| Số lần gọi provider | **1**; không retry |
| Endpoint | `POST https://api.openai.com/v1/moderations` |
| Model yêu cầu / được trả | `omni-moderation-latest` / `omni-moderation-latest`; không tự suy snapshot phía sau alias |
| Ảnh | WebP 96 × 96, 86 bytes, màu tổng hợp; không ảnh thật, người dùng, tài liệu hoặc thông tin cá nhân |
| HTTP / redirect | **200**, JSON, đúng endpoint, không redirect |
| Hợp đồng | Adapter thật xác thực một result, đủ 13 categories/scores/applied-input-types và các điều kiện kiểu/giá trị hiện hành |
| Verdict | `allowed: true`, provider `openai`, policy version `reylumi-public-photo-openai-20261118-v1` |
| Thời gian adapter | **2.434 ms** (2,434 giây), một lần đo; header response 2.421 ms |
| Source adapter | SHA256 `76a9be68dcd28ba53e9add1c6e48a5d577b0f8ad6359f2c76cae484664b9dbc5`, khớp trước/sau phép thử |

[Receipt đã lược dữ liệu nhạy cảm](../artifacts/openai-photo-live-acceptance-20261118/acceptance.json). Harness ở [run-benign-acceptance.mjs](../artifacts/openai-photo-live-acceptance-20261118/run-benign-acceptance.mjs), dùng bundle của adapter hiện tại với server-only marker stub cho standalone Node context; không đổi logic adapter. Harness từ chối chạy khi receipt đã tồn tại, không tạo thêm request khi gọi nhầm lại trên snapshot này.

HTTP 200 đơn thuần không được dùng làm pass: kết quả trên phải đi qua schema validation và verdict của `createOpenAIPublicPostVerifier`. Test không gọi database, Storage, publish RPC, route đăng bài, nhắn tin hoặc dữ liệu tenant. Không lưu request Authorization, giá trị env, toàn bộ headers/body provider, ảnh/base64 hoặc thông tin tài khoản trong receipt. Snapshot không chứa `.env.local`.

## Giới hạn phải giữ khi bàn giao

- Pass chứng minh key có quyền cần thiết để gọi endpoint/model và phản hồi benign này tương thích adapter. Không chứng minh cấu hình least privilege, đúng organization/project dự kiến, vùng xử lý, retention, secondary use hoặc môi trường production. Không lấy org/project đã chọn trong picker cũ làm bằng chứng cho key owner tự tạo.
- Một ảnh màu tổng hợp và một lần đo không chứng minh tốc độ upload thực tế, cold start, tải đồng thời, classifier accuracy hoặc false positives. Reject/error/retry trước đây là mocked/local evidence; không đổi nhãn thành acceptance provider thật cho các nhánh đó.
- Không thử ảnh độc hại/nhạy cảm và không gửi ảnh người dùng. Không chứng minh CSAM/PII/copyright coverage hoặc quyền sử dụng ảnh.
- Consent UI/checkbox và admin r2 vẫn là minh họa chờ owner lựa chọn. Caller hiện thiếu permission hợp lệ vẫn chặn ảnh mới; thêm key chưa hoàn thiện product flow.
- Private evidence/public-origin removal, sponsored-ad reporting/targeting, provider/runtime binding, support operations, App Privacy/age/content rights, native/archive/thiết bị và final combined integration vẫn là các đầu việc riêng.

Các tài liệu cũ ghi chưa có real API request là snapshot lịch sử; lượt này bổ sung đúng một checkpoint mới, không sửa ngược frozen evidence. Source sản phẩm không đổi nên không chạy lại app build hay lặp các suite đã đạt. Giữ một đợt push final sau khi review toàn bộ pending và exact production baseline.
