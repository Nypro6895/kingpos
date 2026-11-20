# Baseline phát hành iOS/web — 17/11/2026

Readback: **2026-11-17T06:21:08.763Z** (00:21 ngày 17/11, America/Chicago). Source worktree lúc bắt đầu: `2349fc2536bf5d0b2fa23bf4bee63e0fa705e722`. Giữ **một lần push tổng hợp sau khi toàn bộ thay đổi pending được review**. Lượt này không push/deploy/upload, không dispatch CI, không sửa Store/tester/group/metadata hoặc journal.

## Kết quả và giới hạn hiện tại

| Kênh | Đã xác minh trong lượt này | Chưa được suy ra |
| --- | --- | --- |
| Web public | Homepage và bốn trang policy HTTP200; asset URLs cùng mang `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv` | Chưa xác minh authenticated production alias hoặc source hiện tại từ Vercel |
| Vercel source | Có receipt Nov14 map deployment trên tới source `830f0a6`, source hash đã kiểm tra lúc phát hành | Receipt cũ và public asset hint không đủ đóng current-baseline gate |
| Native upload qua workflow hiện có | GitHub GET xác nhận upload thật gần nhất run **43567533278**, source `830f0a6ec3029177c94e88137a8165f784c47ae4`, **1.0.0 (100)**, sign/upload success; artifact digest khớp | Không loại trừ upload thủ công/kênh khác sau lần đọc Apple gần nhất |
| Apple/TestFlight/App Store | Đọc lại artifact/snapshot Apple cũ có timestamp riêng | Không có Apple GET mới; không tuyên bố App Store đã phát hành hoặc trạng thái Apple hiện tại |
| Windows/Android | Không kiểm kê lại trong lượt này | Không dùng bằng chứng web/native iOS thay cho các kênh đó |

## Production Vercel: thiếu auth cho alias/source

`npx.cmd --no-install vercel whoami` kết thúc exit1, authentication_required; không tải/cài CLI mới trong lệnh này. Không có tên VERCEL/NOW_TOKEN đang có giá trị trong process và ba vị trí auth.json đã kiểm tra đều không có file. Không in credential hoặc thông tin tài khoản.

Helper hiện có `readProductionAlias` đã được đọc trước khi gọi: nó chỉ GET `/v4/aliases/reylumi.com`, không promote. Lần gọi bị timeout30giây; session do lượt audit sở hữu đã dừng. Chưa lấy được current deployment ID/source bằng auth. [scripts/verify-production-base.mjs:6](../scripts/verify-production-base.mjs#L6), [scripts/verify-production-base.mjs:9](../scripts/verify-production-base.mjs#L9), [scripts/ios/build-check-ci.mjs:13](../scripts/ios/build-check-ci.mjs#L13), [scripts/ios/build-check-ci.mjs:27](../scripts/ios/build-check-ci.mjs#L27)

Fresh public GET/HEAD thấy cùng deployment hint `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv`. Đây là dữ liệu xuất hiện trong response/page assets, có cache HIT; không phải chứng minh alias API hiện tại hay toàn bộ source bytes. HTML SHA256 trong JSON chỉ là hash response, không phải source hash.

Historical source receipt **2026-11-14T06:49:04.005Z**:

- Deployment: `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv`; historical commit `830f0a6ec3029177c94e88137a8165f784c47ae4`.
- Source hash: `731b418d697e34bde56da98550cb7fc2b955bc30d6e2d442fe60b697f285ee42`; overlay hash `f73b27bdaa8bda7558cedad08d0f0f01539b4921f304a49df0c64720dcc08d28`.
- 4327 source files đã đối chiếu content-addressed hashes lúc đó; không có source archive đơn trong format CLI65.
- Receipt gốc: `C:/Reylumi/artifacts/release-review-20261114/live-source-verified.json`; file SHA256 lưu trong JSON. Cần lấy alias/source mới trước khi dùng làm production baseline cho bản tổng hợp.

## Native: upload thật khác audit workflow

GitHub jobs/artifacts được GET lại lúc **2026-11-17T06:20:37.934Z**. Ba run mới hơn — 43950696294, 43666349965, 43569825897 — đều có **upload skipped**, store-readiness success, các bước upload screenshot/prepare metadata skipped. Thành công của chúng là audit, không phải binary mới.

Upload thật mới nhất trong workflow đã kiểm kê:

- [Run 43567533278](https://github.com/Nypro6895/kingpos/actions/runs/43567533278), source ref `release/complete-20261114-source`, SHA `830f0a6ec3029177c94e88137a8165f784c47ae4`. Ref hiện tại vẫn trỏ đúng SHA này qua GET.
- Receipt trong artifact: bundle `com.reylumi.ios`, version **1.0.0**, build **100**, upload **accepted**; source/bundle provenance khớp SHA của run.
- Artifact ID `14103570799`, digest `sha256:3f243b23530f27a6666f4daa6caf93743cc260745a96f7e3d3da744267f8acf1`; local ZIP đã hash lại và khớp digest GitHub vừa đọc. Không cần chạy upload/helper mutating.
- Toolchain ghi trong signed/upload receipt: **Xcode 26.3 / Build version 17C529**. Chưa trực tiếp kiểm tra signed product DTSDKName hoặc aggregate Privacy Report trong lượt này.
- Source SHA256 `f73e499b31c43a5684f5966c96d9c5855ff07316e9ed15a6aea38065b767bebc`; bundled build ID `1e6a5e45af32623521fc885cae98330019614e1b735f7caa30daba00f1b5eb33`.

Latest remote main là `4d17bb6cf068ee37ac344c621b43b963f59966a9`; main không được dùng làm bằng chứng production/upload. Không fetch/reset/chuyển branch hoặc push trong audit.

## Apple: timestamp cũ phải giữ nguyên

Snapshot listing lúc **2026-11-16T20:31:59.971Z**, native lúc **2026-11-16T20:32:07.964Z**:

- Latest observed Apple build **1.0.0 (100)**, VALID; không thấy build sau100 ở snapshot đó.
- Draft **1.0.1**, PREPARE_FOR_SUBMISSION, đang chọn old build **5.1**.
- Copyright/content rights/review/age/pricing chưa hoàn tất trong snapshot; USA là territory đã bật; App Privacy labels chưa xác minh qua API.
- Next build **101** chỉ là con số sau maximum của snapshot cũ. Phải đọc lại Apple trước khi chọn số/build/version và upload candidate; GitHub không loại trừ upload ngoài workflow.

Snapshot gốc: `C:/Reylumi/artifacts/ios-store-preparation-20261116/apple/20261116T2031Z/audit-summary.json`. Không gọi Apple, dispatch CI hoặc sử dụng helper có thể thay tester/group/metadata trong lượt này.

## Public policy và privacy HEAD mới

Public read lúc **2026-11-17T06:21:08.763Z**; không execute scripts, submit forms, gửi auth cookies hoặc đọc dữ liệu riêng.

| Route | HTTP GET | Ngày hiển thị |
| --- | --- | --- |
| /privacy | 200 | Effective date: August 21, 2026; Last updated: October 14, 2026 |
| /terms | 200 | Effective date: August 21, 2026; Last updated: October 13, 2026 |
| /community | 200 | Effective date: August 21, 2026; Last updated: October 14, 2026 |
| /business-terms | 200 | Effective date: August 21, 2026; Last updated: October 14, 2026 |

Privacy HEAD trả **200**, server Vercel, cache-control `public, max-age=0, must-revalidate`, x-vercel-cache `HIT`; không có ETag/Last-Modified được trả trong HEAD này. Privacy public vẫn chứa lời hứa deletion normally completes within24hours. Candidate policy/privacy fixes chưa được coi là đã live từ receipt local hoặc HTTP200.

## Gate cho một bản tổng hợp

- **combined-push — hold:** Keep one combined push only after all pending changes are reviewed; this audit did not push or dispatch CI.
- **web-current-source — blocked:** Authenticated production alias and current deployment source have not been reacquired. Public hint matches old receipt but cannot close this gate.
- **web-baseline-before-promotion — pending:** Once authenticated, GET current alias, obtain exact source/files and hashes, assemble all approved pending changes, and re-run verify-production-base immediately before any promotion.
- **native-latest-Apple — pending:** Before building/uploading final candidate, read Apple builds again without tester/group/metadata changes; do not assume no manual uploads since Nov16.
- **version-alignment — pending:** Last ASC draft1.0.1 selected old5.1; latest observed upload1.0.0(100). Final marketing version must match target listing and build must exceed current Apple maximum;101 is only prior snapshot nextBuild.
- **native-final-archive — pending:** Build combined final source including bundled routes/purpose copy; inspect signed archive SDK/Info.plist/entitlements/aggregate Privacy Report and packaged required-reason APIs/SDKs.
- **native-device-review — pending:** Actual current-candidate iPhone/iPad journeys and stable reviewer access still needed; simulator/local proofs do not establish this.
- **AppStore-publication — not_performed:** No App Review submit or Store metadata/group/price/privacy declaration changes in this audit.

Source Xcode workflow vẫn cấu hình26.3: [.github/workflows/reylumi-ios-testflight.yml:19](../.github/workflows/reylumi-ios-testflight.yml#L19). Sau khi source tổng hợp chốt, cần signed archive đúng candidate, packaged Privacy Report/manifest/reasons/SDK, version-build alignment, native purpose text và iPhone/iPad/reviewer journeys. Không đánh dấu các gate đó đạt từ archive100 hoặc kiểm thử local của task khác.

Evidence machine-readable: [baseline-readback.json](../artifacts/ios-next-steps-20261117/baseline-readback.json). Chỉ hai file baseline này được viết; không product/journal/commit.

## Bổ sung sau readback CLI: dashboard đã đăng nhập — khoảng 06:34 UTC

Mốc này được **root trực tiếp quan sát qua CUA**, dùng phiên Vercel dashboard đã đăng nhập sẵn; agent ghi tài liệu không mở lại browser. Không login, tạo token hoặc bấm auth flow. Root đã gửi completion của phần CUA.

- Tại [project dashboard](https://vercel.com/kingpos/kingpos), Production Deployment trỏ tới `F5yYNDU4nXW2epT5pozciBmPfHhv` / `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv`, với current domains **reylumi.com** và **www.reylumi.com**. Đây là quan sát dashboard đã xác thực, bổ sung mạnh hơn public asset hint ở mốc06:21.
- Deployment **Ready**, tạo **14/11/2026 00:29:44 CST** (06:29:44 UTC), duration **2m44s**. Source page mở được cây file của **CLI upload**; không thấy Git commit, không đọc source values hoặc hash toàn bộ archive.
- Deployment Settings mở rộng hiển thị **Node24.x**, region **pdx1**, **Skew Protection12hours**. Không thay settings, không mở env hoặc đọc secrets.

**Phạm vi cập nhật:** phần “chưa có quan sát đã xác thực về production assignment” ở mốc CLI trước đã được giải quyết một phần bằng dashboard. **CLI vẫn không có auth**, alias API chưa được đọc lại; **source commit hiện tại, full manifest/source hash và applied environment mapping vẫn chưa xác minh**. Receipt Nov14 map tới `830f0a6` tiếp tục là chứng cứ lịch sử, không được đổi thành current source proof chỉ vì deployment ID trùng. Gate exact-source và immediate pre-promotion guard vẫn mở.

Receipt bổ sung: [baseline-browser-readback.json](../artifacts/ios-next-steps-20261117/baseline-browser-readback.json). Receipt [baseline-readback.json](../artifacts/ios-next-steps-20261117/baseline-readback.json) ở mốc06:21 được giữ nguyên, SHA256 `312a8328b94259b14a8bb2117d1106d32e85da3e6dff4811dd5b37f1275faf94`. Kind mới là `reylumi-production-browser-observation`, trạng thái partial; **không phải typed `reylumi-production-baseline` và không đủ điều kiện vượt validateBaselineEvidence**. Giữ một lần push tổng hợp sau khi toàn bộ pending được review.
