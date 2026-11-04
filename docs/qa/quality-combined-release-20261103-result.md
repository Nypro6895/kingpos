# Kết quả phát hành gộp 2026-11-03

Web đã live tại https://reylumi.com. Deployment: dpl_AxfeLKBrbaUcgTMNTZu2otekuLFp; source: 2844e9c3fd047bc9fc2969322be10bfaa388a360. Đối chiếu 4.067 tệp live khớp manifest; giữ 3.818 tệp baseline nguyên byte và 68 tệp có thay đổi đã chọn. Receipt web: 02179c7f-9e7e-485e-8e08-6d9b0961e4d1.

iPhone: **1.0.0 (92)**, Apple VALID và có sẵn trong nhóm Internal TestFlight hiện tại. Source: 7ece58d03fea9cd48378eda5b4e50da2ed4f0ff1; receipt: 4cf25a82-2cd0-40e6-87da-0688ee24a6df. Bản 92 đã cài và kiểm tra trên iPhone 12 Pro Max qua Mac. Đây là TestFlight, chưa phát hành App Store.

Đã tích hợp các thay đổi hoàn tất tương thích: Market V8/trials, Forum/feed/Following/avatar, logo Market, phục hồi phiên, Closing History, Help diagnostic export, các thay đổi giao diện và luồng đã đóng băng trong journal. Bản91 đã kiểm tra đủ các luồng được liệt kê ở ba vai trò; bản 92 giữ nguyên chúng và thêm sửa tải dư hẹp. Nguồn chi tiết: releases/evidence/quality-combined-20261103-web.json, quality-combined-20261103-build91.json và quality-combined-20261103-ios.json.

| Kiểm tra | Kết quả |
| --- | --- |
| Source/web | 438/438 regression; TypeScript; lint không có lỗi mới; build production đạt |
| Closing History / Expenses local browser | 16 / 3 trường hợp đạt |
| Native bản 92 | 246 test thực thi đúng một lần; 0 fail/skip/missing/duplicate; archive unsigned/signed/export khớp source và bundle |
| Native contract | Public config giữ nguyên từ91; Services pilot OFF; command mapping khớp web |
| SQL | Local: 16 security/compatibility + 374 migration baseline; atomic apply/replay đạt; production: 22/22 guard đạt; ledger 368 → 371 |
| Sửa cache mới | 40/40 focused/adjacent đạt; counterfactual trước sửa tái hiện tải dư; review độc lập PASS |

SQL editor chuyển LF thành CRLF khi lưu ledger; đã đối chiếu chính xác source sau chuẩn hóa EOL. Không sửa lại ledger, không chạy lại wrapper raw LF lên ledger CRLF. Dữ liệu, ACL và RLS hiện có được bảo toàn.

Thứ tự iPhone: **Personal → Staff → Owner**. Bản91 đã xem Explore/Beauty/Bookings/Library, Staff Today/My Pay/Tickets/Analysis/Schedule, Owner Today/Reports/Expenses/Market/Forum/Following, foreground và Help export. Expenses đạt chu kỳ hiện tại → kỳ trước → hiện tại, chuyển tab và background/foreground; tổng/danh sách khớp kỳ, trạng thái tải kết thúc. Bản 92 chạy smoke Personal/Staff rồi kiểm tra tập trung Owner và Expenses; phạm vi thực tế của lần này nằm trong trường physical của receipt mới. Không gộp coverage UI với coverage của buffer trace.

Beauty giữ refresh chủ động và không tự chèn bài. Expenses dùng kỳ Payroll đã cấu hình và giữ công thức. POS không nâng cấp thiết kế; Payroll Tools giữ nguyên. Chỉ thêm flag CHECK_WRITER_TRIAL_ENABLED=true; sales và khóa mã hóa hiện có giữ nguyên byte, không xoay khóa hay mở lại tiền/phí.

Một khai báo còn thiếu trong inventory native của trang feedback một lần đã được bổ sung đúng loại online-only. Guard activation hiện đạt 99 route / 347 command, không có mục thiếu. Việc này không đổi quy tắc feedback; không coi kiểm tra bundle là acceptance gửi feedback trên dữ liệu thật.

Lỗi tốc độ đã sửa: lượt kiểm tra gợi ý Campaign chỉ cập nhật cooldown hiển thị nhưng bị phân loại như ghi nghiệp vụ, làm mất cache của các trang Owner, kể cả trả về null. Chỉ ngoại lệ đúng action đó được đổi. Test dùng generator, command client và resource cache thật:

| Luồng minh họa trong test | Trước sửa | Sau sửa |
| --- | --- | --- |
| Mở bốn DTO Owner | 4 lượt đọc | 4 lượt đọc |
| Prompt trả null hoặc claim rồi quay lại | Cache bị xóa, đọc thêm 4 | Giữ cache, không đọc thêm |
| Tổng | 8 lượt đọc | 4 lượt đọc |
| Lưu/dismiss Campaign | Làm mới dữ liệu | Vẫn làm mới dữ liệu |

Đây là số đo fixture, không phải khẳng định giảm đúng 4 HTTP trên mọi phiên iPhone. Quyền, scope/generation, RPC và cadence giữ nguyên.

Logo Market giảm số phần tử tạo từ 2.821 xuống 155 (94,5%) trong 32 trường hợp parity; byte đầu ra giữ nguyên. Đây là benchmark local, không quy đổi thành phần trăm tốc độ iPhone.

Quan sát chưa chốt nguyên nhân: hai lượt đọc trong phiên Staff của trace91 mất khoảng 3,76/3,50 giây, server echo 425,5/202 ms. Cookie capture khoảng 2 ms và phần sau HTTP khoảng 5–6 ms không giải thích được khoảng chênh này. Category generic chưa định danh được resource; không gọi chúng là hai API Staff cụ thể. Trace chưa tách thời gian kết nối, truyền tải, scheduling và phần server trước instrumentation. Không sửa logic theo giả định. Đây là điểm cần đo tiếp, chưa phải quyết định nghiệp vụ cần chủ project chốt. Chi tiết và giới hạn nằm trong releases/evidence/quality-combined-20261103-performance.json.

Trace Staff bản 92 có 19 HTTP 200, một 409 và năm lượt bị hủy. Sau 409 lúc khởi động, trace ghi nhận thu hồi display cũ, đổi authority rồi context mới 200, phù hợp cơ chế phục hồi scope có sẵn. Sau mốc context Staff đầu tiên, bảy lượt đọc và hai lượt context đều 200; bảy lượt đọc trong cửa sổ đó mất khoảng 444–926 ms. Một lượt generic lúc cold start vẫn mất 3,322 giây, server đo 1,9235 giây; chưa xác định resource hoặc nguyên nhân chênh lệch. Không kết luận các tail bản 91 đã hết. Trace Owner sớm ghi nhận một lượt prompt tự nhiên 200 và cache hit; không quy các hit thành số HTTP tiết kiệm khi thiếu khóa resource. Xem báo cáo kèm provenance và cửa sổ đo trong performance evidence.

Help export đã tạo report native mới và mở Share Sheet; kiểm tra report qua USB riêng. Không chọn đích chia sẻ hoặc xác nhận Save to Files. Log native512/JS256 có giới hạn, clocks khác gốc; chỉ requestID khớp mới dùng phân tích timing. Không đưa raw trace, cây UI, ảnh hay dữ liệu tài khoản vào Git.

Không tạo giao dịch, sửa lương/chấm công, kích hoạt trial, trả tiền, post/follow, gửi SMS/tin nhắn, mời tester hay mở quyền thiết bị để QA. Phần developer platform còn làm dở, ứng dụng riêng và phạm vi trì hoãn được giữ lại, không ghi nhận đã deploy. Không có quyết định nghiệp vụ mới cần xác nhận trong phần đã hoàn tất.

Giới hạn: đây là acceptance các luồng đã liệt kê; không chứng nhận mọi route, mọi tài khoản hay hiệu năng tối đa. Chưa acceptance các thao tác tiền thật/POS payment, printer, QR camera, offline/network-loss, toàn bộ accessibility và load/concurrency matrix. Hồ sơ riêng giữ rõ coverage của91 và 92.
