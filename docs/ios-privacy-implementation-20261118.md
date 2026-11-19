# Privacy/Terms candidate — 18/11/2026

Đã sửa nội dung có bằng chứng trong `lib/legal-policies.ts`, base `04128e40de1a2ce22170c0fc95ea053668c29e26`. Đây là **bản local để review**, chưa công bố, chưa thay App Store Connect, chưa triển khai hosted và chưa xác lập một quy trình chấp thuận mới. Giữ một lần push tổng hợp sau khi toàn bộ pending được review.

Giữ nguyên route, toàn bộ section ID, metadata và ngày: effective 21/08/2026; Privacy/Community/Business last updated 14/10/2026; Terms 13/10/2026. Những ngày này phải được review lại cùng thời điểm công bố, không được dùng để nói bản sửa mới đã có hiệu lực từ trước. Legal renderer hiện chỉ dùng dữ liệu tiếng Anh; theo điều phối, không thêm bản dịch chưa được render hoặc thay kiến trúc ngôn ngữ. Tài liệu này giải thích thay đổi bằng tiếng Việt.

## Nội dung đã sửa

| Vùng | Thay đổi | Giới hạn được giữ |
| --- | --- | --- |
| Terms / acceptance | Chấp thuận Terms không phải đồng ý mọi cách xử lý dữ liệu; quyền quản lý workspace không thay thế notice/consent cho từng mục đích | Không tuyên bố rằng chỉ hiển thị policy đã tạo consent hợp lệ; không thêm cơ chế clickwrap hay receipt version mới |
| Terms / payments | Phân biệt tải app miễn phí với Market, subscription, sponsored placement và ad credits nơi được cung cấp | Không đặt giá mới, không hứa hoàn tiền mặt, không thêm no-refund waiver; quyền được pháp luật bảo vệ được giữ |
| Privacy / nguồn dữ liệu | Phân biệt người dùng, salon/professional/người gửi khác, thiết bị và kết quả provider | Người chưa có tài khoản vẫn có thể có hồ sơ customer/staff do salon nhập; không gọi mọi dữ liệu là do chính đương sự nhập |
| Bank/Tax/payment | Làm rõ bank routing/account, check PDF được server có quyền giải mã; SSN/EIN có thể nằm trong tài liệu Tax; card checkout và bank workflow là các luồng khác nhau | Không suy ra không thu thập tài chính chỉ vì card nhập ở provider; không cho phép đưa hồ sơ riêng vào public posts |
| Location | Mô tả GPS hoặc địa chỉ nhập, request trực tiếp từ thiết bị so với qua server và external directions | Có manual city/ZIP/address thực tế; không hứa nhà cung cấp xóa mọi bản sao theo cache của app |
| Thiết bị và logs | Thêm read models/outbox, caption/file references để phục hồi; tách diagnostic report do người dùng chọn share khỏi server/hosting logs | Không nói mọi storage mã hóa, mọi log anonymous hoặc không có server collection |
| Chia sẻ | Phân biệt public audience, người nhận riêng và bản tải/in đã ra ngoài hệ thống | Export/publish không mở quyền truy cập payroll/Tax/bank cho người không liên quan |
| Export retention | Bao quát cả hosted account và salon export dùng chung controls: bảy ngày truy cập, URL mới tối đa 15 phút và capped bởi expiry | Expiry không đồng nghĩa đã xóa bytes; legacy links/files không tự bị thu hồi/purge; không thể xóa bản tải/in của người nhận |
| Deletion và retained records | Tách pending period của account workflow khỏi privacy request; retained support/business snapshots vẫn có thể nhận diện người | Không hứa xóa toàn bộ hồ sơ nghiệp vụ hoặc trong 24 giờ; không coi disconnect là anonymization |
| Privacy rights / trẻ em | Quyền sale/share, sensitive uses, non-discrimination được nêu có điều kiện theo luật; nêu actual knowledge về trẻ dưới 13 bên cạnh child-directed service | Không thêm global age gate, không nói GPC/opt-out UI đã hoạt động, không coi general guardian permission thay cho consent luật yêu cầu |

Quyền UGC, license không độc quyền giới hạn theo dịch vụ/audience, trách nhiệm của Reylumi đối với xử lý/tính toán/security của chính mình và quyền bình luận trung thực đã có trong candidate được giữ. Không thêm arbitration, liability cap, indemnity rộng, chuyển quyền UGC, DMCA registration hoặc lời hứa safe harbor.

## Chứng cứ source cho các điểm dễ hiểu nhầm

### Account và salon export thực sự dùng cùng controls

- Account: [app/account/actions.ts:825](../app/account/actions.ts#L825) gọi `createAccountDeletionExport`; [lib/lifecycle-export.ts:825](../lib/lifecycle-export.ts#L825) chuyển `exportType: account_deletion` vào shared writer.
- Salon: [app/salon-settings/actions.ts:445](../app/salon-settings/actions.ts#L445) gọi `createSalonLifecycleExport`; [lib/lifecycle-export.ts:721](../lib/lifecycle-export.ts#L721) chuyển `exportType: salon_lifecycle` vào cùng writer.
- Shared writer: [lib/lifecycle-export-storage.ts:80](../lib/lifecycle-export-storage.ts#L80) đặt expiry bảy ngày; [TTL constant:9](../lib/lifecycle-export-storage.ts#L9) là 15 phút; [clamp:157](../lib/lifecycle-export-storage.ts#L157) dùng expiry DB trả về; [authorization:166](../lib/lifecycle-export-storage.ts#L166) kiểm tra requester/id/bucket/path/status trước [service signing:178](../lib/lifecycle-export-storage.ts#L178).
- DB không chỉ tin timestamp client: [migration:44](../supabase/migrations/20261116211000_lifecycle_export_expiry.sql#L44) ép expiry từ created-at cho row mới; [metadata gate:94](../supabase/migrations/20261116211000_lifecycle_export_expiry.sql#L94) và [Storage gate:112](../supabase/migrations/20261116211000_lifecycle_export_expiry.sql#L112) chặn truy cập requester không đúng/đã hết hạn. Migration không giới hạn các controls này riêng `account_deletion`.
- Đây là bằng chứng candidate source, không phải hosted migration acceptance. Cleanup legacy mặc định không bật; URL bearer cũ và historical files cần review riêng. Không thay bằng một lời hứa xóa toàn bộ sau bảy ngày.

### Manual location là UI và handler có thật

[Explore search-area form:154](../app/explore/explore-search-toolbar.tsx#L154) nhận input với label [City, state, ZIP or address:155](../app/explore/explore-search-toolbar.tsx#L155). [applySearchArea:3748](../app/explore/explore-client.tsx#L3748) tắt GPS preference và chạy search bằng location đã nhập; [GPS denial:3426](../app/explore/explore-client.tsx#L3426) hướng dẫn city/ZIP fallback. Có thể từ chối GPS mà dùng manual search; việc permission và network thực tế trên iPhone/iPad vẫn phải QA.

### Dữ liệu tài chính và lưu local

[Business map](ios-submission-business-data-map-20261116.md) có 11 nhóm hồ sơ và source cho Check Writer, payroll, Tax, Support và các ngoại lệ retention. [Native data map](ios-submission-native-data-map-20261116.md) phân biệt native/WKWebView/server, GPS, logs, cookie giả danh, manual diagnostic share và provider boundaries. Các map là inventory source, không phải xác nhận dữ liệu thực đã được gửi hoặc cấu hình provider hiện tại.

Việc checkbox, permission hoặc account setup có mặt không tự chứng minh đã có tất cả notice/consent cần thiết cho dữ liệu của người khác. Task này không thay signup/invite acceptance hoặc ghi consent version. Nhãn App Privacy và consent/opt-out còn cần đối chiếu với bản chạy và vận hành thực tế.

## Nguồn chính thức đã đối chiếu

- Apple yêu cầu policy mô tả collection/use/third-party protection/retention/deletion và in-app account deletion; UGC còn cần filtering/report/block/contact. Bản copy không thay cho việc vận hành các controls. [App Review Guidelines 5.1 và 1.2](https://developer.apple.com/app-store/review/guidelines/).
- FTC yêu cầu thông tin về app/data practices trung thực, consent thích hợp cho xử lý nhạy cảm/không hiển nhiên và thực hiện đúng lời hứa privacy. Đây là lý do không thêm cam kết provider, no-training hoặc fixed purge chưa có chứng cứ. [Marketing Your Mobile App](https://www.ftc.gov/business-guidance/resources/marketing-your-mobile-app-get-it-right-start), [Protecting Personal Information](https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business).
- California có quyền know/delete/correct và các quyền opt-out/limit/non-discrimination khi luật áp dụng. Phạm vi CCPA/CPRA, sale/share và thiết kế controls của Reylumi chưa được kết luận từ việc có khách USA. [California AG CCPA](https://oag.ca.gov/privacy/ccpa).
- CalOPPA có yêu cầu transparency về tracking signals/third-party cross-site collection trong phạm vi áp dụng. Không có đủ runtime/recipient evidence để viết “không tracking” hoặc “đã honor GPC”. Direct Leginfo read bị 403; đã dùng tài liệu chính thức AG làm đối chiếu, không suy ra đây là review đầy đủ mọi luật bang. [Making Your Privacy Practices Public](https://oag.ca.gov/sites/all/files/agweb/pdfs/cybersecurity/making_your_privacy_practices_public.pdf).
- COPPA không chỉ liên quan service child-directed; actual knowledge về collection từ trẻ dưới 13 cũng có thể làm phát sinh nghĩa vụ. Không đặt tuổi tối thiểu tùy ý và không nói đã có verifiable parental-consent workflow. [FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [16 CFR Part 312](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312).
- Copyright thuộc quyền đang có của tác giả/rightsholder; limited service license khác ownership transfer. Honest reviews không được bị chặn hoặc bị lấy copyright bằng standardized contract trái luật. DMCA safe harbor có điều kiện riêng; chưa xác minh agent registration/quy trình của Reylumi. [U.S. Copyright Office](https://www.copyright.gov/what-is-copyright/), [Section 512](https://www.copyright.gov/512/), [FTC Consumer Review Fairness Act](https://www.ftc.gov/business-guidance/resources/consumer-review-fairness-act-what-businesses-need-know).

Nguồn được đọc ngày 18/11/2026. Không copy mẫu Terms của nền tảng khác, không thêm choice-of-law/forum/waiver chưa được quyết định.

## Các dữ kiện/quyết định chưa được bản copy giải quyết

1. **Provider và runtime:** current applied environment, recipients/payload, region, logs/backups, retention, secondary use/training và contractual protection cho từng service phải có bằng chứng. Root chỉ thấy env names/scopes; account re-verification đã được hủy trước reveal. Không có value/provider GET mới chứng minh các mục này. Chủ app đã chọn OpenAI và tạo key mới bằng secure picker do root xử lý; tại lúc hoàn tất bản legal này, chưa có key/provider connection được xác minh và không có API integration trong task legal. Policy giữ provider-neutral cho tới khi payload, cấu hình, điều khoản và thực hành thực tế được kiểm chứng.
2. **Retention và quyền dữ liệu:** cần record-specific schedule/criteria, legal holds và vận hành request cho customer/staff notes, identifying payroll snapshots, shared Tax docs/messages, bank/check history, support content và audits. Historical deleted-account residuals, legacy exports/bearer URLs cần kế hoạch riêng; không có retroactive bulk purge được thực hiện.
3. **Ads/privacy choices:** Market và ad-credit transactions vẫn nằm trong scope bản iOS đầu. Phải quyết định sale/share/tracking dựa trên mục đích và bên nhận thực, rồi triển khai/kiểm chứng notice-at-collection, opt-out/limit/GPC hoặc ATT nếu áp dụng. Paragraph rights có điều kiện và Contact Support không chứng minh các controls/response operations đã đầy đủ.
4. **Audience/trẻ em:** cần quyết định và kiểm chứng audience, cách xử lý actual knowledge/parental consent, quyền ảnh và dữ liệu trẻ do người khác tải lên. Không có global age gate hoặc parental-consent workflow mới được thêm; Apple questionnaire là bước riêng.
5. **Billing:** unused campaign credits quay về salon balance không phải card cash refund. Chính sách hoàn tiền mặt/ad-credit debit, subscription cancellation và offer-specific terms còn cần chốt theo luật và flow thực tế; task không tự chọn refund/no-refund.
6. **Support, IP và request operations:** cần xác minh inbox/case intake, người trực xử lý, identity/authorized-agent verification, escalation và thời hạn luật áp dụng. MX/DMARC là routing DNS, không chứng minh inbox support đã provision/delivery/monitoring. Rights complaint flow không tự tạo DMCA registration/safe-harbor status.
7. **Publication/assent:** review toàn bộ diff và ngày công bố cùng notices/acceptance theo feature. Không coi existing signup/invite flow đã có consent-version receipt. Material change hoặc mục đích mới có thể cần notice/consent khác; không áp dụng hồi tố chỉ bằng sửa policy.
8. **Integration/App Store:** ghép đúng production source/schema, chạy hosted/provider acceptance được ủy quyền, final archive/SDK/Privacy Report, labels, reviewer demo và physical iPhone/iPad QA. Không dùng bản text candidate để đánh dấu các gate này đạt.

## Public hiện tại và kiểm chứng local

Readback của root tại [public-policy-contact-readback.json](../artifacts/ios-steps-234-20261118/public-policy-contact-readback.json) lúc `2026-11-18T21:03:54.315Z`: bốn policy routes HTTP 200; Privacy public còn câu deletion normally completes within 24 hours. Đây là bằng chứng bản local chưa được coi là thay thế copy public. DNS có MX/DMARC không phải mail-delivery test. Không gửi thư, SMS, provider request hoặc sửa Store trong task.

Scoped tests kiểm tra metadata/section IDs, intra-policy anchors, private financial disclosure, local/server logging, account+salon export/legacy boundaries, rights/deletion, ownership/license, không thêm refund/age/provider assurances và render cả bốn document bằng legal page renderer thực với navigation/TOC stubs. Không dùng mock page để gọi là bản live, Safari/native hoặc device acceptance.

Kết quả cuối, source hashes, frozen own-file snapshot và dated journal completion được lưu tại `artifacts/ios-privacy-implementation-20261118/`. Chỉ snapshot ba file được giao; không freeze cả checkout, commit, push, deploy hoặc công bố policy.

### Kết quả scoped checks

- `node --test tests/legal-privacy-implementation-20261118.test.mjs tests/lifecycle-export-download.test.mjs tests/lifecycle-export-expiry.integration.test.mjs`: **20/20 passed, 0 skipped**. Mười test policy/renderer; phần còn lại kiểm tra signer/expiry bằng fixture, không gọi provider thật.
- `node_modules/.bin/eslint.cmd lib/legal-policies.ts tests/legal-privacy-implementation-20261118.test.mjs`: passed, không warning.
- `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check -- lib/legal-policies.ts tests/legal-privacy-implementation-20261118.test.mjs`: passed; giữ line ending Windows hiện có, không sửa global Git config.
- Không full build, không dev-server/live publication hay physical acceptance trong task copy này; root sẽ build candidate tổng hợp.
