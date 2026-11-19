# Bỏ liên kết Auth khi giữ tệp nghiệp vụ

Ngày 16/11/2026. Thay đổi server/database độc lập với bộ lọc ảnh chưa chọn nhà cung cấp. Chưa deploy hoặc thay dữ liệu hosted.

Kiểm thử Storage API thật phát hiện luồng xóa tài khoản hiện có nhận COPY 200 nhưng hai trường `storage.objects.owner`/`owner_id` vẫn trỏ Auth cũ. Với Storage 1.84.19 đã kiểm tra, service JWT không có `sub`, nên COPY bỏ qua các cột owner trong UPSERT thay vì gán NULL. Checkpoint xóa tài khoản đúng ra tiếp tục từ chối; không được bỏ hoặc nới kiểm tra đó.

Migration `20261116215000_retained_storage_ownership.sql` sửa đúng trong transaction COPY do Storage API thực hiện. Trigger chỉ bỏ owner cũ khi là service `object.copy`, có tệp đích hiện hữu khớp eTag/size/MIME, có task `retain_business` chưa hoàn tất, job đang processing với lease còn hiệu lực, và tài khoản đã pending deletion/deleted. Cả owner hiện tại và owner mới phải NULL hoặc đúng Auth của tài khoản đang xóa. Phạm vi là bốn bucket giữ nghiệp vụ sẵn có: salon-profile-media, pos-display-media, payroll-paystubs và support-evidence.

Storage API tiếp tục quản lý bytes, COPY, version và metadata. Không có lệnh UPDATE Storage độc lập để bỏ qua provider, không xóa tệp nghiệp vụ, không đổi phép tính payroll/tax, không mở quyền đọc. Quyền Storage/RLS và các checkpoint kiểm tra ownership/Auth cuối cùng giữ nguyên. Upload bình thường, signed upload, caller authenticated, task sai, lease hết hạn, tệp đã mất hoặc bytes không khớp không được dùng correction này.

Hai kiểm tra SQL độc lập đã đạt cho cả bốn bucket và các nhánh từ chối. Bộ kiểm chứng 433 migration với Auth/Storage/PostgREST thật trong môi trường cô lập cũng đạt: SHA256 bytes trước/sau giống nhau ở cả bốn bucket, cả hai owner được bỏ, payroll/support vẫn chặn người khác/anonymous, checkpoint đạt, Auth hard delete và job complete. Hash migration được kiểm tra là `c5d3708079ae32d3da93160322fe1be78bd3a5166e98a242c304374e37e34389`. Chi tiết nằm trong receipt local; không coi COPY HTTP 200 riêng lẻ là bằng chứng hoàn tất.

Phụ thuộc patch `ios-store-privacy-remediation-20261116` và helper Storage operation đã được kiểm tra. Migration chạy trước các migration ảnh 2200/2210 và không tham chiếu bảng/hàm của pipeline ảnh, nên có thể ghép riêng sau khi được kiểm chứng. Khi provider nâng cấp Storage, chạy lại kiểm thử actual COPY và checkpoint; các cột owner và transaction/upsert là chi tiết tương thích quan trọng.
