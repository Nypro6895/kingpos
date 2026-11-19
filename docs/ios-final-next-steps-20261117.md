# Reylumi iOS — bước tiếp theo và một đợt push final

Ngày hiển thị: **17/11/2026, America/Chicago**. Chưa push, deploy, upload binary, ghi metadata Apple hoặc Submit trong đợt này.

## Phạm vi đã chốt

- Reylumi LLC; thị trường Mỹ; tải app và chức năng nền tảng cơ bản miễn phí. Market và credit quảng cáo vẫn nằm trong phạm vi kiểm tra/khai báo; không tự bật flag, đổi giá hoặc thực hiện giao dịch thật.
- Người dùng/người có quyền giữ quyền đối với nội dung. Reylumi nhận license giới hạn phục vụ vận hành; trách nhiệm người nhập không loại trừ nghĩa vụ riêng của nền tảng đối với bảo mật, quyền riêng tư hoặc sai sót của mình.
- Không duyệt admin thường lệ từng ảnh; lọc tự động kết hợp report/block/takedown/appeal. Provider và key cho bộ lọc vẫn chờ lựa chọn; không gửi ảnh thật tới một provider chưa được chọn.
- Không tự đặt một tuổi tối thiểu chung hoặc khai age rating bằng suy đoán. Không tự điền App Privacy, tracking, Content Rights hoặc lời hứa retention khi chưa có chứng cứ.
- **Rà toàn bộ thay đổi trước push final và tích hợp trong một đợt chung.** Phần working/blocked phải được xử lý hoặc ghi rõ lý do còn chờ; không biến thành mã phát hành bằng cách push nguyên HEAD.

## Kết quả mới

| Hạng mục | Chứng cứ và giới hạn |
| --- | --- |
| Toàn repository | Ảnh kiểm kê đầu: 296 worktree; 2.169 journal events; 127 pending revisions gồm 21 ready, 93 needs-integration, 8 working, 5 blocked. Đây là snapshot, không phải số tính năng chưa hoàn thành hoặc toàn bộ mã chưa push. Công việc song song và chính đợt này làm inventory tiếp tục thay đổi. |
| Uncommitted / unpushed / unshipped | Đã phân biệt Git status, reachability tới remote refs đang cache và publication receipt theo từng kênh. Không fetch hoặc suy ra remote hiện tại chỉ từ cache. Xem [release inventory](ios-final-release-inventory-20261117.md). |
| Bản public | HTTP200 trên homepage và bốn policy. Fallback trình duyệt đã đăng nhập xác nhận Production Deployment `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv` đang gắn `reylumi.com`; source UI mở được. CLI chưa có auth; exact source commit/full manifest và applied environment chưa xác minh. Quan sát dashboard chưa phải full source baseline. Xem [baseline readback](ios-final-baseline-20261117.md). |
| Native | Workflow upload gần nhất được kiểm chứng lại là nguồn `830f0a6`, 1.0.0(100). Các lượt readiness sau đó bỏ qua upload. Apple chưa được đọc mới; không tự chọn build101 từ snapshot cũ, không coi TestFlight là App Store. |
| Provider/runtime | Đã lập roster, script đọc tối thiểu và mock kiểm tra. Hiện chưa có authenticated deployed-environment binding nên **0 provider requests**; active flags, selection, logs/backup/region/retention vẫn unknown. Xem [provider preflight](ios-provider-preflight-20261117.md). |
| Bản source privacy/photo | Các fix local đã có kiểm tra ở đợt trước; current HEAD cũng chứa toàn bộ patch photo đang blocked vì chưa nối verifier thật. Không dùng checkout này làm bản final bằng cách push toàn nhánh. |

Privacy public vẫn có lời hứa xóa trong 24 giờ. Candidate source đã sửa câu này nhưng chưa phát hành; không báo rằng khách hàng đã nhận bản sửa. Các mục bank/check, payroll/tax, provider, identifiers/location, quảng cáo, retention lịch sử và mailbox vận hành tiếp tục là gate cho khai báo cuối. Bản đồ đầy đủ nằm ở [submission scope](ios-submission-scope-20261116.md).

## Kiểm tra trước push đã triển khai

[verify-final-release-plan.mjs](../scripts/verify-final-release-plan.mjs) là công cụ **read-only**. Nó không chạy push, deploy, provider API, CI hoặc Apple writes. Không tự cài Git hook và không khẳng định có thể ngăn mọi lệnh push thủ công.

```powershell
node scripts/verify-final-release-plan.mjs --init artifacts/ios-next-steps-20261117/release-inventory-scope.json artifacts/ios-next-steps-20261117/final-release-plan.json
node scripts/verify-final-release-plan.mjs --check artifacts/ios-next-steps-20261117/release-inventory-scope.json artifacts/ios-next-steps-20261117/final-release-plan.json artifacts/ios-next-steps-20261117/final-release-plan-check.json
```

Các file output chỉ được tạo mới; công cụ không ghi đè review cũ. Dùng tên revision mới khi cần chụp lại.

1. Plan bị ràng buộc SHA256 với inventory. Mỗi event/channel phải được quyết định riêng, gồm bản ready cũ còn chờ khi revision mới vẫn working. Mặc định tất cả là `unreviewed`, không tự duyệt 127 revisions.
2. Chỉ snapshot `ready`, có manifest và validation đạt mới được chọn. Kiểm hash từng file/deletion; thiếu dependency đúng kênh phải có publication receipt thật khớp journal. `needs-integration` cần tích hợp/kiểm tra rồi ghi ready revision mới trước khi chọn.
3. Kiểm source đã ghép với từng contributor. Hash khác phải có resolution receipt gắn đúng commit/file/event và validation. Diff từ exact baseline tới candidate không được chứa file sản phẩm chưa chọn; không thể lẫn phần deferred/blocked vào một clean commit.
4. Worktree có dữ liệu chưa commit, file chưa theo dõi hoặc lỗi đọc phải có disposition rõ. Kiểm tra lại membership, Git paths/status/HEAD và journal khi chạy. **Fingerprint status không hash nội dung file riêng tư/untracked**; nguồn frozen được chọn và candidate bytes được kiểm riêng.
5. Cần typed authenticated-baseline receipt khớp deployment/source/manifest; một file bất kỳ có hash đúng hoặc public deployment hint không đủ. Candidate phải clean ở đúng commit. Snapshot lỗi, journal/worktree thay đổi, thiếu chứng cứ hoặc thiếu quyết định đều giữ trạng thái blocked.

Exit2 nghĩa là reconciliation còn thiếu; exit1 là lỗi đọc/schema/thực thi. `mayPush` và `mayPublish` luôn false: công cụ tạo kết quả cho coordinator rà soát, không cấp quyền phát hành. Build, secret review, migrations, hosted/device acceptance, release lock và `verify-production-base.mjs` ngay trước promotion vẫn bắt buộc theo release policy.

Validation mới: **28/28 tests** cho reconciliation/evidence/filesystem đạt, ESLint sạch; provider preflight có **5/5 mock-only tests** đạt và dry-run thật 0 requests. Kiểm cả dangling symlink và missing descendant để link không bị hiểu nhầm là file đã xóa. Không chạy lại full app build vì đợt này chỉ thay công cụ/docs; kết quả này không thay cho build của candidate tích hợp.

Draft r2 dùng [scope-final](../artifacts/ios-next-steps-20261117/release-inventory-scope-final.json): 128 pending revisions/173 event-channel decisions, gồm working event của chính coordinator. Mọi quyết định vẫn unreviewed; không biến danh sách kiểm kê thành xác nhận đã review/đã tích hợp. Hai `.env.example` trong ready snapshots được root kiểm byte-hash riêng, khớp2/2, không xuất nội dung: [receipt](../artifacts/ios-next-steps-20261117/ready-template-hash-readback.json). Sau completion event của đợt này và trước push final, phải chụp journal/status mới; inventory cũ không được tự coi là còn hiện hành.

## Thứ tự còn lại

1. Hoàn thành disposition từng revision/worktree từ inventory, đọc frozen source và xử lý các nhóm overlap/dependency. Đối chiếu những record cũ với publication receipt để giữ phần đã ship; không áp lại patch cũ hoặc bỏ mất ready revision.
2. Lấy authenticated current alias, exact deployed source và environment mapping bằng kênh đã được cấp quyền. Nếu không có, giữ integration/promotion bị chặn; không tải bulk secrets hoặc tạo receipt giả để đi tiếp.
3. Chạy provider preflight tối thiểu sau binding; xác minh actual Auth hooks, logging/backup/retention và Support mailbox/monitoring. Không gửi thư/SMS, tạo charge hoặc đọc tài liệu payroll/tax khách thật chỉ để kiểm tra activation.
4. Sau lựa chọn provider/key, nối verifier ảnh thật; kiểm tra allow/reject/error, thời gian xử lý, retry, false positive và report/appeal. Rà các bề mặt UGC còn lại. Giữ dữ liệu payroll/tax/support riêng ngoài luồng lọc ảnh bài đăng.
5. Tạo worktree tích hợp riêng từ exact production baseline dưới `C:\Reylumi-worktrees`; ghép các nguồn frozen đã chọn và xử lý conflict theo ý định đã được duyệt. Kiểm toàn candidate, migrations, tài chính/quyền/trạng thái, policy/data map và secret scan. Không copy nguyên checkout dirty.
6. Freeze candidate cuối và push chung sau khi review/required checks đạt. Bundled JS và Info.plist đã đổi nên cần native rebuild từ đúng nguồn chung; chọn version/build bằng Apple readback mới, archive/sign/upload theo kênh hiện có rồi kiểm tra Apple processing và thiết bị.
7. Chuẩn bị demo bằng dữ liệu giả, screenshots đúng binary và review notes; chốt/đọc lại giá free, USA, copyright, Content Rights, age rating, App Privacy, support/review details, version/build trước Submit. Chưa có dữ kiện thì giữ unknown, không khai cho đủ ô.

Đây là công việc chuẩn bị cho một release chung. Không mở một lịch tự chạy, không phát hành riêng Check Writer/mobile-spacing hoặc kích hoạt Market/ads để vượt gate.
