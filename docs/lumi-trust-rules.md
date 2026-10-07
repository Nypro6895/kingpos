# Quy tắc LUMI Trust v2

Phiên bản: `lumi-trust-v2`. Ngày: 2026-10-05.

## Mục tiêu

Trust tổng hợp phản hồi khách hàng và hành vi quay lại. Tổng lượt ghé, tuổi tiệm,
rating cũ, doanh thu, giá dịch vụ, follower, love/share và badge admin không cộng
điểm chất lượng. Nhiều bằng chứng làm kết luận chắc hơn, không mặc nhiên tốt hơn.
Đây là tín hiệu từ dữ liệu được ghi nhận, không phải chứng nhận chất lượng.

## Nơi chỉnh sửa

- `lib/reylumi-trust.ts`, hằng `LUMI_TRUST_RULES`: trọng số, Wilson, benchmark quay
  lại, ngưỡng điểm, cỡ mẫu, giới hạn khi có phản hồi kém và sàn Diamond.
- SQL `public.lumi_trust_evidence_policy()`: số ngày phản hồi, số ngày chờ quay lại
  và chiều dài cohort. Khi đổi, tạo migration mới; không sửa migration đã áp dụng.
- SQL `public.get_public_lumi_trust_signals(uuid[])`: điều kiện hợp lệ, loại trùng,
  nhận diện khách, loại người nội bộ và cách lấy mẫu.
- `lib/lumi-trust-data.ts`: kiểm tra dữ liệu RPC và chuyển tên trường sang ứng dụng.
- `tests/lumi-trust-contract.test.mjs`: kiểm thử tính điểm/level.
- `tests/lumi-trust-evidence.integration.sql`: kiểm thử dữ liệu, luôn rollback.

Đổi ý nghĩa dữ liệu phải đổi version ở SQL và TypeScript cùng nhau. Ứng dụng không
dùng nguồn không tương thích để cấp level cao. Mỗi thay đổi phải cập nhật tài liệu
này, chạy kiểm thử và mô phỏng ảnh hưởng tới các nhóm salon.

## Lượt ghé hợp lệ

1. Ticket POS của đúng salon, `status = closed`, có `closed_at`, không ở tương lai.
2. Khách thuộc đúng salon và liên kết với `customer_user_id`.
3. Ticket có ít nhất một dòng dịch vụ/hàng bán có giá trị dương.
4. Loại người có liên kết account membership, salon membership hoặc staff với tiệm;
   kể cả liên kết không còn active, để không tăng điểm bằng tài khoản từng nội bộ.
5. Một tài khoản khách tại một salon trong một ngày địa phương chỉ tính một lượt.
   Nhiều customer record liên kết cùng tài khoản vẫn là một người.
6. Tổng lượt ghé hiển thị là lịch sử các lượt hợp lệ; không đưa tổng này vào điểm.

Giới hạn hiện tại: ticket là bằng chứng do hệ thống salon ghi nhận, không chứng minh
thanh toán bằng nguồn độc lập. Dòng giá dương chưa chắc là đã thanh toán đầy đủ.
Sửa miễn phí không có dòng giá dương bị loại. Sửa làm lại có thu tiền, hoàn tiền,
giao dịch giả và nhiều tài khoản của một người chưa có bộ phát hiện hoàn chỉnh.
Khách walk-in chưa liên kết tài khoản chưa tham gia mẫu độc lập. Không gọi chỉ số
này là tổng mọi lượt khách đến tiệm.

## Phản hồi

- Lấy phản hồi `good` hoặc `issue` gắn với ticket hợp lệ và đúng tài khoản khách.
- Cửa sổ mặc định: lượt ghé trong 180 ngày gần nhất.
- Mỗi tài khoản chỉ có một phiếu: phiếu của lượt ghé mới nhất có phản hồi trong
  cửa sổ. Ngày chỉnh sửa văn bản không làm lượt ghé cũ thành lượt ghé mới.
- Không có phản hồi là không biết, không coi là tốt hoặc xấu.
- `issue_status = resolved` không đổi phiếu issue thành good. Khách tự thay đổi
  phản hồi hoặc phản hồi ở lượt sau vẫn có thể thay đổi phiếu đại diện của họ.
- Không dùng rating/review cũ trong công thức v2. Review cũ vẫn đọc được ở danh
  sách Experiences nhưng không được chuyển tự động thành phiếu good.
- `counts_toward_reputation` là quy tắc lịch sử của luồng cũ. v2 tự lấy một phiếu
  đại diện mỗi khách, không cộng tất cả phản hồi của khách quay lại nhiều lần.
- Số ý kiến trong điểm là số khách độc lập được lấy mẫu, không phải số comment
  trên bài, cũng không phải tổng mọi review trong danh sách.

## Khách quay lại

Mặc định `returnDays = 90`, `cohortDays = 180`.

Tại thời điểm T, chọn các lượt ghé làm mốc trong `[T - 270 ngày, T - 90 ngày]`.
Mỗi khách chọn mốc sớm nhất trong khoảng này. Khách được tính quay lại nếu có một
lượt hợp lệ ở ngày địa phương khác, sau mốc và không quá 90 ngày từ mốc.
Mỗi khách chỉ đóng góp một kết quả vào mẫu, dù quay lại nhiều lần.

```text
tỷ lệ quay lại = số khách quay lại / số khách đủ 90 ngày quan sát
```

- Đây là khách có cơ hội được quan sát đầy đủ, không nhất thiết khách mới lần đầu.
- Khách ghé hôm qua không phải là một lần thất bại quay lại.
- Sau 90 ngày mới quay lại không là success của kỳ này.
- Quay lại là bằng chứng hành vi; không thêm vào good feedback hoặc xóa issue.
- Không có mẫu đủ tuổi: tỷ lệ là unknown, không là 0%.
- Mẫu quay lại có độ trễ; không đại diện tức thời cho chất lượng hôm nay.

## Công thức và thiếu dữ liệu

Với một tỷ lệ `p = successes / n`, lấy cận dưới Wilson một phía 95%, `z = 1.645`:

```text
lower = [p + z²/(2n) - z*sqrt(p*(1-p)/n + z²/(4n²))] / [1 + z²/n]
F = Wilson(good feedback, feedback customers)
R = min(1, Wilson(returning customers, eligible customers) / 0.50)
wF = 0.60 * min(1, feedback_customers / 20)
wR = 0.40 * min(1, eligible_return_customers / 20)
quality = (wF*F + wR*R) / (wF+wR)
```

`0.50` là benchmark sản phẩm khởi đầu để quy đổi hành vi quay lại, không phải
chuẩn ngành hoặc bằng chứng “50% nghĩa là hài lòng”. Phải hiệu chỉnh theo dữ liệu
và chu kỳ dịch vụ; hiện toàn bộ salon dùng cùng benchmark để không tự ưu ái tiệm.

Nếu thiếu một nguồn, chuẩn hóa theo trọng số nguồn còn lại (chỉ F thì quality=F,
chỉ R thì quality=R). Thiếu cả hai thì quality=null; hoạt động hợp lệ chỉ đạt Common.
Một nguồn thiếu không bị thay bằng điểm tốt/xấu giả định. Tỷ lệ 0/n với n>0 là dữ
liệu thật; khác với 0/0 là chưa biết.

Khi cả hai nguồn có ít nhất 20 khách, công thức là 60% F + 40% R. Trước đó nguồn
ít mẫu có trọng số nhỏ hơn. Điều này tránh việc phản hồi tốt đầu tiên làm tiệm có
mẫu quay lại mạnh rơi từ Gold xuống Common chỉ vì nguồn mới có một phiếu. Wilson
vẫn điều chỉnh sự thận trọng trong mỗi nguồn. Mốc 20 chỉnh ở `fullWeightSample`.

Wilson là biện pháp thận trọng với cỡ mẫu, không sửa được thiên lệch chọn khách,
tài khoản giả hoặc sự phụ thuộc giữa các khách. Nguồn tham khảo phương pháp:
https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm

## Level mặc định

| Level | Điểm quality | Có cả hai nguồn: tối thiểu ở mỗi mẫu | Chỉ một nguồn |
|---|---:|---:|---:|
| Empty | Không có hoạt động hợp lệ | Không icon | Building LUMI Trust |
| Common | Chưa đủ điều kiện Silver | Có hoạt động | Có hoạt động |
| Silver | >= 0.55 | 5 | 10 |
| Gold | >= 0.75 | 20 | 30 |
| Diamond | >= 0.88 | 40 | Không được cấp |

Diamond còn yêu cầu F >= 0.85. Đây là mốc sản phẩm ban đầu, chưa phải kết quả
hiệu chỉnh trên dữ liệu thực tế toàn hệ thống.

Silver/Gold có thể đạt bằng điều kiện một nguồn mạnh kể cả nguồn thứ hai đã xuất
hiện nhưng còn ít mẫu. Tất cả nguồn đã có vẫn tham gia điểm theo trọng số cỡ mẫu.
Diamond luôn cần cả hai nguồn ít nhất 40; không có đường tắt một nguồn.

Giới hạn phản hồi xấu: ít nhất 5 khách phản hồi mà tỷ lệ good <72% thì tối đa
Common. Ít nhất 10 khách mà tỷ lệ good <82% thì tối đa Silver. Quay lại cao không
được bù hết phản hồi có vấn đề.

Confidence dùng cỡ mẫu nguồn mạnh hơn, chuẩn hóa tới 40 khách; điều kiện Diamond
vẫn kiểm tra riêng nguồn ít mẫu hơn. Nó không được cộng lần nữa vào chất lượng. Trusted sort
ưu tiên level đã giải quyết, rồi quality; không thêm điểm vì tổng ticket lớn.
Các nhóm khám phá và bộ lọc chất lượng ở Explore dùng cùng nguồn LUMI Truth; không dùng sao cũ để chọn mức.

## Hiển thị

- Icon vẫn có 4 vật liệu Common, Silver, Gold, Diamond; Empty không có icon.
- Chi tiết Trust có tên level, lượt ghé, phản hồi good/issue, số khách đủ quan sát,
  tỷ lệ quay lại, cửa sổ ngày và thời điểm cập nhật.
- Chưa đủ thời gian hiển thị Building evidence, không 0% quay lại.
- Lỗi RPC hiển thị Trust temporarily unavailable trong phần chi tiết; không cấp
  level mới dựa trên legacy counts. Version không hợp lệ cũng không cấp tier cao.
- Trang Experiences liên kết từ chi tiết Trust; rating cũ không xuất hiện trong
  panel Trust mới. Các vị trí dùng hàng Trust chung theo `docs/salon-identity-layout-and-verification.md`.
- Badge admin và giá dịch vụ không cộng điểm Trust. Quy trình verify và quy tắc giá được ghi riêng trong tài liệu bố cục; share/save/direction giữ chức năng hiện có.

## Chống gian lận và việc đào sâu tiếp theo

Đã làm: loại người nội bộ đã liên kết, kiểm tra author/ticket/customer, loại ticket
trùng theo ngày và danh tính, một phiếu/khách, không nâng quality bằng volume,
không xóa issue khi xử lý, không dùng legacy rating để nâng level.

Chưa làm: xác thực thanh toán độc lập/hoàn tiền, nhiều tài khoản một người, tấn công
phản hồi có phối hợp, cờ fraud/review admin chuyên dụng, loại làm lại có thu tiền,
chu kỳ riêng theo nhóm dịch vụ, chống lựa chọn chỉ mời khách hài lòng. Không tự
khóa chỉ vì IP hoặc thiết bị chung. Cần thiết kế dữ liệu và quyền kiểm duyệt trước.

## Kiểm thử và thay đổi an toàn

1. Chạy unit tests công thức, data adapter và kiểm thử nối nguồn Explore/Profile.
2. Chạy SQL integration trong transaction rollback; không tạo dữ liệu QA lâu dài.
3. Kiểm tra fixtures: khách mới, khách không phản hồi nhưng quay lại, tiệm ít/đông
   khách cùng chất lượng, issue đã resolved, duplicate ticket/customer, insider,
   salon private, lỗi dữ liệu và version mismatch.
4. Chạy TypeScript và ESLint cho các file thay đổi.
5. Khi đổi policy, lưu kết quả mô phỏng phân bố level trước/sau và ghi lý do vào
   bảng lịch sử dưới đây; không đổi trọng số chỉ để đạt một phân bố đẹp.

| Version | Ngày | Thay đổi |
|---|---|---|
| v2 | 2026-10-05 | Feedback 60%, return 40%; matured cohort; independent samples; loại volume/rating khỏi quality |
