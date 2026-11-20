# Kết quả search local — chưa deploy

Đã triển khai ưu tiên vùng/tọa độ, từ khóa dịch vụ/tên tiệm, rồi độ đầy đủ hồ sơ và bài đăng công khai thật. Tiệm được cộng tối đa 10 điểm hoạt động từ 5 bài; mỗi tiệm xuất hiện một lần. Hỗ trợ cả `dip powder Chicago` và `Chicago dip powder`.

Giữ trang 12 kết quả, cursor và hàng đợi 64; mỗi request cập nhật thẻ tối đa 36 tiệm. Cấu trúc mới mặc định OFF, backfill từng transaction 50–100 tiệm, đồng bộ thay đổi phát sinh và thống kê chỉ mục trước khi bật.

| Kiểm tra local | Kết quả |
| --- | --- |
| Regression | 152 pass, 0 fail, 1 bài tích hợp tùy chọn skip; 82 hash nguồn không đổi |
| Build/TypeScript | Đạt; lint các helper đổi đạt, lỗi lint cũ ở Explore không tăng |
| 100k/500k/1m tiệm giả lập | 378 phiên: 237 timeout ở baseline → 0 timeout sau sửa |
| 1m, 1/8/16 kết nối SQL | p95 trang đầu 138/134/140 ms; trang tiếp 12–14 ms |
| Typo phổ biến, 1m | 96 phiên, đủ 16 kết nối thực tế: 0 lỗi; p95 cao nhất khoảng 1,06 giây |
| Sắp xếp và cursor | 48 phiên sort và 600 kết quả/50 trang: đúng thứ tự, không trùng |
| 10k hồ sơ đầy đủ | 104 lượt đầu + 72 lượt tiếp: 0 lỗi; 163,3 MB bảng/chỉ mục |
| Một tiệm 5.120 bài + sửa bài | 96 lượt đọc/4 luồng: 0 timeout; p95 đọc cao nhất 261 ms |
| Giao diện production build local | 600 thẻ + 600 URL ảnh riêng mỗi viewport; nhập 24–27 ms, không lỗi JavaScript |

Đã xử lý hai nguyên nhân lớn: dò không có kết quả vẫn quét toàn bảng, và kiểm tra bài đăng tạo vòng lặp khoảng 1,21 triệu lượt đọc. Ca post từng vượt 3 giây đã đạt lại với tra bản hiện tại theo khóa bài đăng.

**Giới hạn cần giữ rõ:** số liệu SQL dùng PostgreSQL local/dữ liệu giả lập; giao diện dùng API/ảnh kiểm soát, chưa xác nhận HTTP production hay thiết bị iOS. Mẫu 1m có hồ sơ tối giản, phần projection/index mới chiếm khoảng 16,8 GB; cần đo trên cấu hình và dữ liệu thật trước khi bật. Từ dịch vụ hiện khớp trên toàn menu, có thể thuộc nhiều mục, chưa bảo đảm một mục dịch vụ chứa tất cả từ.

Nguồn ở `C:\Reylumi-worktrees\local-search-quality-20261118`, baseline sạch `23e66abd`. Chưa xác minh được source production hiện tại nên bàn giao ở trạng thái **needs-integration**. Không deploy, không push, không đổi dữ liệu production. PostgreSQL thử nghiệm đã dừng và giữ lại dữ liệu/bằng chứng.

Xem phương pháp và giới hạn chi tiết tại `docs/explore-local-quality-benchmark.md`; bằng chứng được cố định trong `artifacts/local-search-quality-20261118`.
