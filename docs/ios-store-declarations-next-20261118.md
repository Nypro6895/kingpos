# Bản khai iOS tiếp theo — đối chiếu source ngày 18/11/2026

**DRAFT_SOURCE_SUPPORTED_RUNTIME_PENDING.** Baseline: `8a9d9335207db37969bff824e6ef3e55f37b6484`. Đây là bản để người có quyền Apple duyệt, chưa nhập/lưu/publish App Privacy, age rating hay content rights. Không gọi API/provider, đọc secrets, thay UI/schema hoặc triển khai. File JSON đi kèm lưu hash và dòng nguồn đã kiểm tra: [declarations.json](../artifacts/ios-store-declarations-next-20261118/declarations.json).

Phạm vi đã được chủ app xác nhận: Reylumi LLC, Mỹ, app tải miễn phí; Market và giao dịch credit quảng cáo nằm trong bản khai. UGC thuộc người dùng, nền tảng chỉ nhận giấy phép giới hạn để vận hành. Không tự thêm tuổi tối thiểu hoặc chế độ duyệt trước mọi bài. OpenAI đã được chọn cho kiểm tra ảnh; lựa chọn đó không chứng minh cấu hình provider hoặc tính năng đã chạy trên hosted.

## Hai phát hiện cần sửa trong worksheet nháp

**Search History và Precise Location có bằng chứng lưu tại server trong source**, vượt quá việc chỉ truyền để trả lời request. `app/explore/explore-client.tsx:2578–2579,3408–3409` dùng tọa độ trình duyệt; `lib/explore-search.ts:375–392` gọi `search_public_explore_session` với query và latitude/longitude. Định nghĩa mới nhất của RPC trong `20261017030000_explore_anywhere_search.sql:190,202–204` ghi query, tọa độ nguyên vào `unified_canonical`, `rank_origin_latitude/longitude`, cùng `current_public_user_id()` và viewer key. Schema `20261009052031_explore_search_sessions.sql:38–55` có `query_text`, thời điểm tạo và expiry mặc định 30 phút; expiry không chứng minh xóa vật lý đúng phút đó.

Vì vậy, trên candidate có luồng GPS/search này, đề nghị **Search History = Yes, Precise Location = Yes, linked = Yes cho dữ liệu gắn tài khoản, purpose App Functionality**. Tọa độ không được coarsen trước khi lưu ở đường này; `highAccuracy:false` hay private RLS không đổi kết luận. Thêm purpose khác chỉ khi chứng minh đúng cách dùng. Runtime/project thực và hoạt động cleanup chưa được kiểm tra trong lượt này.

**Contacts cần đưa social graph vào câu trả lời.** `202608210004_account_beauty_following.sql:1–7,77` lưu quan hệ `profile_id ↔ user_id`, không phải chỉ đọc một danh sách trên máy. Apple liệt kê social graph trong Contacts. Đề nghị **Contacts = Yes nếu Beauty following vẫn thuộc candidate**, linked, App Functionality; thêm Product Personalization khi bản phát hành dùng quan hệ đó để cá nhân hóa feed. Đây là áp dụng taxonomy từ source, không phải tuyên bố app đọc danh bạ điện thoại. Không có Contacts permission không đủ để chọn No. [Apple: loại dữ liệu, liên kết và collection](https://developer.apple.com/app-store/app-privacy-details/).

Worksheet Nov16 để hai luồng search/GPS ở trạng thái chưa chứng minh retention và chưa chốt Contacts. Giữ nguyên hồ sơ cũ để bảo toàn lịch sử; bản này bổ sung bằng chứng cụ thể thay vì sửa ngược bản frozen.

## App Privacy: câu trả lời chuẩn bị được và phần còn chờ

Apple yêu cầu khai cả app và phần web/backend liên quan; câu trả lời phải theo phiên bản thực phát hành. Nhãn nguồn, permission strings và privacy manifest không thay cho nhau. Không dùng bản nháp này để bấm Publish. [Apple: quản lý App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/).

| Nhóm | Đề nghị source cho candidate | Bằng chứng/giới hạn cần giữ |
| --- | --- | --- |
| Có thu thập dữ liệu | **Yes**; không chọn Data Not Collected | Account, nội dung, giao dịch và search sessions có server storage. |
| Search History / Precise Location | **Yes** theo hai phát hiện trên | Linked khi có user ID; App Functionality. Không thay precise bằng coarse cho tọa độ nguyên. |
| Contacts | **Yes có điều kiện candidate giữ following** | Social graph đã lưu; không suy ra có quyền đọc phone contacts. |
| Name / Email / Phone / Physical Address / User ID | Giữ ứng viên **Yes, linked**, App Functionality từ business/native maps | Gồm dữ liệu khách, staff, payee và người gửi tài liệu, không chỉ người đăng nhập. Địa chỉ salon công khai khác địa chỉ cá nhân. |
| Payment Info / Other Financial Info / Purchase History | Giữ ứng viên **Yes** trong full scope | Bank account/routing của Check Writer, payroll/tax và transaction records phải tách khỏi card entry tại checkout bên ngoài. Không áp ngoại lệ hosted-card cho mọi dữ liệu tài chính. |
| Photos or Videos / Other User Content / Customer Support / Emails or Text Messages | Giữ ứng viên **Yes**, linked theo luồng | Ảnh công khai, tài liệu/nội dung, report/support và trao đổi riêng phải phân loại theo dữ liệu thật; không coi mọi PDF là ảnh hoặc mọi comment là private message. |
| Device ID | Ứng viên **Yes** cho identifier browser/device chống abuse | `lib/abuse-context.ts` và `lib/abuse-server.ts:49–50` đưa device/IP hash cùng user tới kiểm soát abuse. Cần xác nhận lifetime và hành vi provider; hash không tự thành anonymous. |
| Product Interaction / Advertising Data | Ứng viên **Yes** cho events thực sự lưu | `owner_campaign_events` lưu visitor/campaign/view/click; sponsored component gửi event. Purpose Third-Party Advertising cho quảng cáo salon khác, Analytics khi đo hiệu quả; không tự gán purpose quảng cáo cho bank/payroll. |
| Coarse Location | Khai thêm cho dữ liệu khu vực được giữ nếu đúng candidate | Không thay thế dòng precise. Phân biệt địa chỉ nhập tay, khu vực từ IP và tọa độ GPS. |
| Diagnostics / Browsing History / Other Usage Data | **Chưa chốt từng subtype** | Local diagnostics chưa gửi không tự là collection; support upload là luồng khác. Cần archive/network và log configuration. Mở external website không tự chứng minh app lưu browsing history. |
| Government identifiers / Sensitive Info / Health, Audio… | **Rà theo mục đích và field thật** | SSN/EIN trong Tax documents cần mô tả, nhưng không tự khớp Apple Sensitive Info. Không tick mọi loại vì free text có thể chứa chúng; cũng không loại theo riêng native permissions. |
| Tracking | **Chưa được xác nhận No/Yes toàn app** | Cần thực hành liên kết/chia sẻ dữ liệu và secondary use của các bên nhận. Ads, device hashes hoặc không có IDFA không tự quyết định tracking. |

Các dòng carry-forward dựa trên [business map](ios-submission-business-data-map-20261116.md), [native map](ios-submission-native-data-map-20261116.md), [commerce map](ios-submission-commerce-scope-20261116.md) và [worksheet App Privacy cũ](ios-submission-app-privacy-20261116.md); không phải inventory runtime mới của mọi field/provider. Bằng chứng GPS/search/social graph và delta OpenAI dưới đây đã đọc trực tiếp ở source hiện tại.

### Delta OpenAI cần đưa vào reviewer notes và đối chiếu privacy

`lib/public-image-verifier-openai.ts:8–11,105–140` xây request server tới Moderations bằng processed WebP pixels; body không thêm caption, user ID hoặc Storage URL. `lib/beauty.ts:1063` và `lib/salon-profile.ts:1833` đi qua helper consent; `lib/public-photo-processing-consent.ts:4–9,20–32` yêu cầu lựa chọn affirmative đúng notice version. `lib/legal-policies.ts:669` đã mô tả bên nhận và giới hạn này.

Đây là đường gửi ảnh tới bên thứ ba trong candidate, **không phải bằng chứng pixel anonymous**, không phải kiểm tra bản quyền, không bảo đảm phát hiện mọi nội dung xấu. Không suy ra không training, không lưu log, US-only hoặc retention cụ thể từ payload nhỏ/consent. Cần provider/account settings và runtime acceptance, không cần gửi khóa hay ảnh khách thật cho audit này. Nhãn ảnh vẫn phải tính việc Reylumi lưu ảnh và liên kết với post/account; không được bỏ nhãn chỉ vì người dùng có thể từ chối. Apple yêu cầu disclosure và explicit permission khi chia sẻ personal data với third-party AI. [App Review 5.1.2(i)](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing).

`ios/Reylumi/PrivacyInfo.xcprivacy:11–19` có required-reason API declarations UserDefaults/SystemBootTime với reasons `CA92.1`/`35F9.1`, được đưa vào resources ở `ios/project.yml:19–20`; chưa có privacy report của archive cuối trong lượt này. Info.plist có Camera/Photos/location purpose strings. Không dùng các file đó làm chứng nhận labels/SDK/tracking toàn app.

Một gate riêng của archive: `ITSAppUsesNonExemptEncryption=false` trong Info.plist vẫn giữ nguyên, trong khi source dùng CryptoKit AES.GCM/Keychain cho lưu trữ cục bộ (`ReylumiBackgroundSync.swift:83–92`, `ReylumiLocalReadStore.swift:160`). Không tự đổi flag hoặc kết luận exemption sai/đúng từ tên thuật toán; người phụ trách binary cần rà export classification của candidate cuối theo [hướng dẫn Apple](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/).

## Age/content: phương án điền theo source

| Câu hỏi | Đề nghị hiện tại | Điều còn cần |
| --- | --- | --- |
| UGC / Social Media / Messaging and Chat / Advertising | **Yes** | Beauty/feed/comments, Forum topic/reply/chat và sponsored ads có trong source. Role Owner hoặc app business không làm các tính năng này biến mất. |
| Parental Controls / Age Assurance | **Candidate No**, chưa có walkthrough cuối | Block/report và OTP là công cụ khác; không khai chúng như parental controls hay bằng chứng tuổi. |
| Social Media Disabled for Users Under 13 | **Không có bằng chứng để chọn Yes** | Để chọn **Yes cho tùy chọn này**, Apple yêu cầu tối thiểu gọi Declared Age Range trước khi bật social và cung cấp nội dung phù hợp tuổi. Không suy ra từ Terms hoặc mong muốn không áp age gate; không coi đây là yêu cầu API áp cho mọi social app. |
| Unrestricted Web Access | **Chưa chốt; không tự chọn No** | `NavigationPolicy.swift:26–28` chấp nhận HTTPS rộng; `ReylumiViewController.swift:366` mở trong SFSafariViewController. Cần walkthrough link salon/ads và khả năng điều hướng trong sheet. Hosted card/Maps mở ngoài app là đường riêng. |
| Các mức profanity, mature/sexual, horror, violence, weapons, substances, health/medical | **Tần suất còn chờ kiểm kê** | Corpus/ads/link và vận hành moderation; không lấy source filter hoặc fixture làm bằng chứng None. |
| Contests / gambling / simulated gambling / loot boxes | Giữ **candidate không có, cần kiểm kê offer/rules** | Credit, Gift và reward không tự là gambling; không đủ bằng chứng để khai có cơ chế này, cũng không điền thay người vận hành. |
| Made for Kids / override | **Candidate Not Applicable**, chưa override rating | Không áp tuổi tối thiểu không đồng nghĩa Kids Category hoặc rating 4+. Nếu thay EULA tuổi tối thiểu cần rà override riêng. |

Theo bảng Apple hiện hành cho OS26, Social Media nằm trong nhóm 13+; đây không phải rating cuối đã tính cho app. Khai toàn bộ câu hỏi đúng rồi xem rating do Connect tạo, gồm các OS/region khác. [Định nghĩa rating hiện hành](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/), [quy trình/override](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/). Worksheet Nov16 vẫn là tài liệu lịch sử; không coi snapshot Apple lúc đó là trạng thái hiện tại.

## Content rights và các quyết định còn mở

UGC, ảnh salon và creatives của bên khác làm **`USES_THIRD_PARTY_CONTENT` là candidate phù hợp hơn `DOES_NOT_USE_THIRD_PARTY_CONTENT`**. Enum này không tuyên bố Reylumi sở hữu mọi ảnh. Terms giữ ownership của người dùng và license giới hạn; trước khi xác nhận quyền cần đối chiếu quyền sử dụng logo, artwork, screenshot, templates, ads và các nội dung hiện hiển thị. Chủ app đã xác nhận copyright Reylumi cho phần sở hữu của mình; không hỏi lại và không mở rộng thành blanket transfer. [Apple: Content Rights](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-compliance-information/), [enum chính thức](https://developer.apple.com/documentation/appstoreconnectapi/appupdaterequest/data-data.dictionary/attributes-data.dictionary).

Những đầu việc cụ thể còn lại:

1. **Engineering:** ràng buộc exact web/native candidate, build/SDK privacy report và provider/flags thực; xác nhận GPS/search/following/Market/ads nào được phát hành. Không dùng source8a9 như proof đang live.
2. **Provider operator + engineering:** chứng cứ cấu hình/contract cho retention, logging, vùng xử lý và secondary use, đặc biệt ảnh OpenAI và các bên nhận ads/identity/location. Không yêu cầu chủ app đoán SDK hoặc gửi secrets.
3. **Content operator:** kiểm kê tần suất nội dung, ads/link đích, external-sheet walkthrough và hoạt động report/block/contact. Ảnh có review case vẫn được giữ bởi queue cleanup bảo thủ; private-evidence/takedown là thiết kế riêng, không hứa xóa mọi public copy/cache.
4. **Owner/rights operator:** xác nhận quyền/licensing cho nội dung và marketing thực tế; chấp nhận câu trả lời age đúng tính năng, không chọn rating thấp theo mong muốn. Không tự đổi chính sách tuổi đã xác nhận.
5. **Người có quyền Apple:** sau khi candidate và facts chốt, xem bản preview của từng data type/purpose/linking/tracking; nhập, save/readback và kiểm tra rating/content rights thực tế. **Báo cáo này không thực hiện bước đó và không Submit for Review.**

Không cần build toàn app cho hai file báo cáo. Kiểm tra của lượt này: source refs/dòng/hash hợp lệ, JSON parse, link nguồn Apple chính thức và không có product diff thuộc task. Các tệp frozen cũ được giữ nguyên.
