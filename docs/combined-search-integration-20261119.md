# Tích hợp Search vào nguồn phát hành kết hợp — 19/11/2026

Đã ghép phạm vi cố định từ Search event `af864636-570b-47b5-a805-352a6ced7a9b`, commit `7abbedd8486fac3c13ed2ac280107239611f9056`, baseline `23e66abd5a197d66fd9d2e9fbb358b160af06307`, lên candidate `045dfa2278548787c1abb434b0362ef83b90afec`. Snapshot manifest SHA256 `b5132d2f265f1e2be60ec7d21c0df420388281d8f7af84b34ac4fa8595f76669`; hai migration có identity kết hợp `a843ed893cca2279f1d292991483456627947c62bff1dfe884cc2eb1cb8991b3`. Đây là tích hợp source, chưa triển khai hoặc kích hoạt production.

Đã xác minh113 hash của snapshot rồi đối chiếu ba nguồn base/current/incoming cho từng đường dẫn.55 file sản phẩm/QA và58 file bằng chứng được chọn; không có đường dẫn cùng bị sửa khác nhau hoặc xung đột. Chỉ10 file runtime đã tồn tại thay đổi; các sửa iPhone Explore Card, quảng cáo Why/Report, native shell transport và các file ngoài manifest giữ nguyên. Bản ghi immutable của Search được giữ nguyên cùng bằng chứng cuối. Không lấy nguyên branch/checkout dirty và không ghép generated native bundles.

## Kiểm tra trên candidate

- Chạy lại coherent suite:153 tests,152 pass,0 fail,1 optional isolated-Supabase skip.82 validation-input hashes trước/sau không đổi. Có PGlite local theo quyền coordinator; không Docker/provider hoặc production SQL.
- Lint9 runtime TypeScript/TSX:23 diagnostics có sẵn ở baseline045dfa2,23 hiện tại,0 mới. Không gọi toàn bộ lint là sạch.
-36 file JavaScript module kiểm tra cú pháp đạt.
- Peer source SQL đọc độc lập không tìm thấy blocker mới về RLS, public content authority, rights hoặc ad selector. Đây không thay thế replay toàn schema kết hợp và kiểm tra runtime.

Chi tiết: `artifacts/search-integration-r1/incoming-verification.json`, `three-way-application.json`, `coherent-regressions.json`, `eslint-comparison.json`, `javascript-syntax.json`, `combined-feature-preservation.json`, `sql-compatibility-review.json`. Full Next/TypeScript checkpoint trước đó8f887760 không chứa Search này; cần build cuối từ commit sau tích hợp.

## Bằng chứng hiệu năng được chọn

Bản cuối `native-write-pressure-a843ed893cca-20261119071200.json` dùng5.120 bài thực trong PostgreSQL thử nghiệm,96 lượt đọc/4 worker,0 lỗi và0 timeout; p95 nhóm cao nhất khoảng261ms. Identity a843 và cả hai migration hash khớp snapshot. Những ca prototype/ce2d từng timeout vẫn được giữ làm chẩn đoán lịch sử; chúng không phải acceptance cuối.378 phiên mẫu100k/500k/1m kết thúc không có lỗi ở bản cuối. Không chạy lại benchmark lớn trong lượt tích hợp này.

Các số trên là dữ liệu giả lập/local. Bộ browser của producer dùng API/ảnh kiểm soát; chưa chứng minh hosting thực, Safari hoặc thiết bị vật lý.1m hồ sơ tối giản dùng khoảng16,8GB projection/index mới: không suy ra hosting hiện có đủ dung lượng, IOPS, RAM hoặc thời gian cutover. Xem `docs/explore-local-quality-benchmark.md` và `artifacts/search-integration-r1/producer-evidence-selection.json`.

## Migration, backfill và cutover vẫn tách riêng

Hai migration tạo projection/index rỗng, readiness mặc định OFF và dirty-generation hooks trên history hiện hành; không backfill hoặc tự bật trên apply. Raw derivative tables/view không cấp anon/auth; helper/preparation RPC chỉ service. Canonical salon/content/source-token/block proof vẫn là thẩm quyền cho public kết quả; ad selector không bị thay thế. Trong lúc OFF, new sessions/cursor cũ tiếp tục shipped path.

Trước activation cần full-schema replay từ nguồn cuối, kiểm tra crosspack rights/moderation/account-erasure cùng public hydrate/read, cấu hình hosting và dung lượng thực. Sau đó mới chạy foreground preparation có kiểm soát: status/read-only trước; `--apply` mới backfill từng transaction50 mặc định/100 tối đa; `--activate` cần kèm `--apply` và là quyết định riêng. Activation kiểm scan complete/dirty rỗng/41 indexes valid-ready, ANALYZE ngoài canonical clock, rồi NOWAIT clock+revision boundary và readback.100ms lock timeout giới hạn chờ khóa, không giới hạn toàn thời gian ANALYZE. Source script nạp service config khi chạy CLI; không được coi dry-run/status là không đọc cấu hình. Lượt này không chạy script hoặc SQL trên hosting.

## Native gate

Search client/helper thay đổi nên bundle JS cuối phải được tái sinh cùng toàn bộ candidate, rồi native archive và physical QA. Marketing version hiện1.0.1. Helper thực là `node scripts/ios/local-bundle-release.mjs prepare` rồi `verify`: nó yêu cầu public Supabase URL/anon key hiện hành và ghim source/config/bundle. Không được dùngqa.invalid/synthetic config từ Next compile để làm release bundle; helper không tự chứng minh deployed-environment binding. Không sửa generated bundle trong lượt ghép này.

Pure Swift typecheck trong checkout Mac cô lập có thể chạy độc lập với provider/bundle: lấy SDK bằng `xcrun --sdk iphonesimulator --show-sdk-path`, rồi `xcrun --sdk iphonesimulator swiftc -typecheck -target arm64-apple-ios16.0-simulator -sdk <SDK> ios/Reylumi/*.swift`. Đây chỉ là compile, không XCTest/Simulator/device acceptance. Repo không có Swift Package để mặc định dùng swift test. Đường gate đầy đủ `REYLUMI_SIMULATOR_FAMILY=iphone bash ios/scripts/check-build.sh` và lần riêngipad yêu cầu bundle đã rebuilt+verify trước, dùng Simulator ad-hoc Keychain entitlements và tạo unsigned archive sau test; không phải bước độc lập khi chưa có bundle/config thật. Chưa chạy các lệnh native này ở lượt tích hợp. Signed archive/upload, Apple processing và QA iPhone/iPad cuối vẫn phải thực hiện riêng.
