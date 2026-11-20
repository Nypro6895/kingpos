# Bảng nháp khai độ tuổi cho iOS

**16/11/2026 — worksheet để duyệt, chưa lưu câu trả lời lên Apple.**

Chủ app đã xác nhận Reylumi không tự đặt giới hạn tuổi; app tải miễn phí và phát hành tại Mỹ. Điều đó không thay cho bảng hỏi của Apple và không tự cho ra rating 4+. Phải khai theo tính năng/nội dung của candidate, kể cả phần web trong app; Apple tính rating từ câu trả lời. [Cách khai rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/).

Apple readback lúc **14:31–14:32 CST ngày 16/11/2026** vẫn có các câu hỏi tính năng/nội dung để trống. Hồ sơ là `1.0.1 / PREPARE_FOR_SUBMISSION`, đang chọn build `5.1`; native upload mới nhất là `1.0.0 (100), VALID`. Bảng này phải được rà lại với binary/candidate cuối đã đồng bộ version, không chỉ với checkout.

## Câu trả lời có căn cứ từ tính năng

“Đề nghị” là phương án điền để chủ app xem, không phải khai báo đã nộp. Nhóm chưa đủ bằng chứng phải để chờ chốt, không tự thay bằng No.

| Nhóm Apple / field API | Đề nghị | Bằng chứng và giới hạn |
| --- | --- | --- |
| User-generated content / `userGeneratedContent` | **Yes** | Người dùng tạo ảnh/bài Beauty, nội dung salon, bình luận/review; Forum có topic/reply/chat. Owner-only không làm Forum hết là UGC. |
| Social media / `socialMedia` | **Yes** | Explore/Beauty đưa nội dung người dùng tới feed/discovery; có tương tác xã hội. Dùng chính định nghĩa hiện hành của Apple để rà candidate, không loại vì app còn có POS/payroll. |
| Messaging and chat / `messagingAndChat` | **Yes** | Forum có chat, topic/reply để người dùng giao tiếp. Không khai No chỉ vì chưa thấy chat 1:1. |
| Advertising / `advertising` | **Yes** | Có renderer Sponsored và quảng cáo Forum/Explore. Việc bật/tắt ở một phiên xem hoặc doanh thu hiện tại không làm tính năng biến mất. |
| Parental controls / `parentalControls` | **Candidate No — cần walkthrough cuối** | Chưa thấy công cụ dành cho cha mẹ quản lý quyền/nội dung của trẻ trong đường đã rà. Vai trò Owner/Staff/Tax và block xã hội là quyền nghiệp vụ/an toàn, không phải parental controls. |
| Age assurance / `ageAssurance` | **Candidate No — cần walkthrough cuối** | Chưa thấy kiểm tra độ tuổi hoặc tích hợp Declared Age Range trong mã nguồn đã tìm. OTP điện thoại, email verification, tài khoản Owner và xác minh danh tính không chứng minh tuổi. |
| Social media disabled for users under 13 / `socialMediaAgeRestricted` | **Candidate No theo cơ chế hiện có** | Chưa có bằng chứng cơ chế nhận tuổi và tắt social cho người dưới 13. Không thể đánh dấu Yes từ một câu Terms hoặc suy ra người dùng Owner đều đủ tuổi. Điều này không tự giải quyết cách xử lý dữ liệu trẻ em. |
| Unrestricted web access / `unrestrictedWebAccess` | **Chưa chốt; không mặc định No** | Main WKWebView bị giới hạn origin, nhưng `ReylumiViewController.swift:366` mở HTTPS bên ngoài trong `SFSafariViewController`, và `NavigationPolicy.isExternalAllowed` nhận HTTPS rộng. Phải thử link salon, bài/ads và điều hướng tiếp: nếu người dùng có thể duyệt trang tùy ý trong sheet thì chọn Yes theo định nghĩa Apple. Chỉ chọn No nếu candidate thật đã giới hạn được khả năng đó và có bằng chứng. |

Đối chiếu định nghĩa tính năng với [Apple age-rating values and definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/). Không thay câu trả lời thật để đạt một rating mong muốn.

## Tần suất nội dung: còn cần kiểm kê

Không lấy “Community Standards cấm” làm bằng chứng rằng nội dung đó không xuất hiện. Cũng không tự chọn Infrequent chỉ vì UGC có khả năng bị lạm dụng. Cần xem corpus hiện đang hiển thị, quảng cáo/link đích, nội dung mẫu và kết quả vận hành kiểm duyệt; ghi tần suất đúng theo câu hỏi hiện tại của Connect.

| Field / nhóm | Trạng thái nháp | Bằng chứng cần để chốt |
| --- | --- | --- |
| `profanityOrCrudeHumor`, `matureOrSuggestiveThemes`, `horrorOrFearThemes` | **Chưa chốt tần suất** | Mẫu nội dung công khai và Forum có phân loại; quyết định moderator; không chỉ tìm từ trong source. |
| `sexualContentOrNudity`, `sexualContentGraphicAndNudity` | **Chưa chốt tần suất** | Rà ảnh/video/avatar/cover, UGC, ads và nội dung ngoài được mở trong app. Chưa có bộ lọc ảnh đã được kiểm chứng để dùng làm bằng chứng “None”. |
| `violenceCartoonOrFantasy`, `violenceRealistic`, `violenceRealisticProlongedGraphicOrSadistic`, `gunsOrOtherWeapons` | **Chưa chốt tần suất** | Rà nội dung thực tế và media; kiểm tra các bề mặt có thể đăng/chia sẻ. Không suy ra từ chủ đề salon rằng mọi nhóm đều không có. |
| `alcoholTobaccoOrDrugUseOrReferences` | **Chưa chốt tần suất** | Nội dung bài, ảnh, ads và link; đặc biệt nội dung được duyệt để quảng bá. |
| `healthOrWellnessTopics` | **Chưa chốt** | Phân biệt chủ đề làm đẹp/chăm sóc sức khỏe thực tế trong candidate với suy đoán từ tên “spa”. Cần xác nhận nội dung đã hiển thị. |
| `medicalOrTreatmentInformation` | **Candidate None nếu kiểm kê xác nhận; chưa kết luận** | Rà lời khuyên/chẩn đoán/điều trị do app hoặc người dùng cung cấp. Payroll/tax là nghiệp vụ, không phải nội dung y tế. |
| `contests`, `gamblingSimulated`, `gambling`, `lootBox` | **Candidate không có nếu inventory xác nhận; chưa nộp** | Chưa có bằng chứng các cơ chế này trong các luồng đã rà. Quảng cáo “campaign”, điểm thưởng và Gift không tự là cuộc thi/cờ bạc; phải đối chiếu luật chơi, cơ chế ngẫu nhiên và khả năng nhận giải thực tế. |

Worksheet không xác nhận đã rà toàn bộ corpus live. Chủ app/người vận hành cần chốt người làm kiểm kê, khoảng thời gian/mẫu xem, loại nội dung bị gỡ, số case và thời gian xử lý; chỉ tổng hợp tối thiểu, không đưa thông tin payroll/tax riêng vào hồ sơ rating.

## Các trường còn lại và quyết định liên quan

| Trường | Phương án để duyệt |
| --- | --- |
| `kidsAgeBand` / Made for Kids | **Candidate Not Applicable.** Hiện không có xác nhận app được thiết kế cho Kids Category. “Không áp tuổi tối thiểu” không đồng nghĩa “Made for Kids”. Không tự đăng ký category này. |
| `ageRatingOverride`, `ageRatingOverrideV2` | Hiện readback là `NONE`. Giữ chưa override trong worksheet; để Apple tính sau khi khai đúng. Nếu Terms cuối có tuổi tối thiểu cao hơn rating tính được, phải rà lại override theo hướng dẫn Apple. |
| `koreaAgeRatingOverride`, `gracRatingClassificationNumber` | Chỉ Mỹ đang được bật. Không tự mở Hàn Quốc hoặc bịa mã phân loại; kiểm tra trường mà Connect thực tế yêu cầu. |
| `developerAgeRatingInfoUrl` | Chưa có URL chuyên biệt đã được xác nhận. Không tự điền Privacy URL để làm như đã có nội dung giải thích rating. Chỉ bổ sung nếu có trang đúng chức năng hoặc Apple yêu cầu. |

Xếp hạng của Apple, tuổi tối thiểu trong Terms, xử lý dữ liệu của trẻ em, bộ lọc UGC và khai App Privacy là những quyết định có liên quan nhưng khác nhau. Bảng này không thay kết luận pháp lý về trẻ em hoặc khai privacy labels; người dùng giữ bản quyền UGC cũng không quyết định rating.

## Việc phải chứng minh trước khi xác nhận trên Connect

1. Chốt candidate web/native, version/build; rà đầy đủ các route và nhóm người dùng, gồm Forum/Tax/Owner và các sheet web ngoài.
2. Hoàn tất kiểm kê tần suất nội dung và kết quả kiểm duyệt. Phương án trong [moderation-proposal.md](ios-store-moderation-proposal-20261116.md) chưa phải cơ chế đã chạy.
3. Walkthrough iPhone/iPad: UGC/feed, Forum chat, ads/link, report/block và web ngoài. Ghi riêng cái đã quan sát và cái còn bị chặn bởi tài khoản/dữ liệu.
4. Chủ app xem lại từng câu trả lời chưa chốt; người có quyền Connect nhập đúng trường, lưu/readback và kiểm tra rating Apple tính. **Bước này chưa được thực hiện và không bao gồm Submit for Review.**

## Bằng chứng nguồn

- Apple readback mới: `C:/Reylumi/artifacts/ios-store-preparation-20261116/apple/20261116T2031Z/store-readiness.json`, `release-version-preflight.json` và `audit-summary.json`. Không có API read failures; privacy labels không được API audit này trả về.
- `supabase/migrations/20261103180000_owner_forum.sql:25–45,179–213`: topic/reply/chat; `app/(app)/forum/actions.ts`: đường gọi hiện có.
- `components/explore-advertising.tsx:132–142`: nội dung quảng cáo có nhãn; `components/owner-sponsored-post.tsx`: sponsored feed.
- `ios/Reylumi/NavigationPolicy.swift:5–26`, `ios/Reylumi/ReylumiViewController.swift:342–367`: điều hướng nội bộ/bên ngoài.
- `C:/Reylumi/artifacts/ios-legal-readiness-20261114/ugc-audit/findings.json`: giới hạn hiện tại của bộ lọc và bằng chứng moderation.
- [Apple: đặt age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/) và [định nghĩa](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/), đọc lại 16/11/2026. Không dự đoán hoặc bảo đảm một mức rating cụ thể.
