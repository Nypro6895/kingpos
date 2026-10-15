# Nhật ký thay đổi và phát hành

Quy tắc: [docs/release-policy.txt](../docs/release-policy.txt), được tham chiếu bởi AGENTS.md ở gốc project.

- `changes/*.json`: mỗi event thay đổi có UUID, ngày UTC, phạm vi và bằng chứng. Không ghi đè lịch sử.
- `history/*.json`: receipt tổng hợp cho từng lượt phát hành và từng kênh; chỉ xác minh đúng event đã ship.
- `node scripts/release-journal.mjs pending`: đọc các việc còn chờ, gồm các linked worktree.
- `node scripts/release-journal.mjs lock <release-id>`: khóa phát hành chung trong Git common directory.

Commit các record cùng mã nguồn. Trước mỗi release phải khám phá thêm Git/status/source production và receipt cũ; journal không tự chứng minh mọi thay đổi đã được đăng ký hoặc đã lên live. Không lưu secrets hay dữ liệu người dùng.
