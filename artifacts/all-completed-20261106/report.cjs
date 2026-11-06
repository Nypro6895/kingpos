const fs=require('fs');const out='artifacts/all-completed-20261106';const read=f=>JSON.parse(fs.readFileSync(out+'/'+f));const web=read('web-source.json'),receipt=read('web-release.json'),ready=read('ready-web-revisions.json');const native=fs.existsSync(out+'/native-final-verified.json')?read('native-final-verified.json'):null;const late=read('latest-pending.json').filter(e=>Date.parse(e.occurredAt)>Date.parse('2026-11-06T07:18:00Z')&&!e.changeId.startsWith('all-completed-release-'));
const text=`REYLUMI — PHÁT HÀNH TỔNG HỢP 06/11/2026

Web: Đã phát hành và xác minh https://reylumi.com
Deployment: dpl_4NjSvYQbEc8fV1EmTPN1hJPjtfyr
Baseline: ${web.baselineDeploymentId}
Source commit: ${web.commit}
Source SHA256: ${web.sourceSha256}
Overlay SHA256: ${web.overlaySha256}
Web receipt: ${receipt.id}

Các nhóm web mới:
${ready.map(e=>'- '+e.changeId+' | ready '+e.id+' | source event '+e.originalEventId).join('\n')}

Giữ nguyên các tính năng đã có từ baseline, gồm POS headerless, privacy liên hệ khách, startup/reopen, Reward, Membership và Check Writer.
Check Writer được đọc lại trực tiếp: fulfillment ready, giá được phê duyệt 490 cents, các bảng riêng/RLS và chặn anonymous đạt; không mua gói hay tạo check thật.

Kiểm chứng:
- Fresh local + Vercel production builds và TypeScript đạt; ESLint 0 lỗi, 1 warning dependency effect có sẵn của Forum.
- Tải lại source archive Vercel: khớp 3984/3984 file, không thêm/thiếu.
- 16 kiểm tra HTTP public/guest live đạt. Không suy ra acceptance tài khoản salon từ các request public.
- More: 18 tổ hợp role/viewport + 4 kích thước POS; đủ route hiện hành, giữ draft, focus/dismissal và Settings.
- Help: fixture song ngữ và server Next thực với tìm kiếm, filter, ngôn ngữ, responsive và các bài hướng dẫn.
- Gift designer: preset, crop, lưu/lỗi/retry và 5 viewport.
- Salon header: 75 cấu hình layout/width/content + Follow/hours/share/claim. Giữ SalonName/member badge và tool quản lý.
- Today: 17/17 regression; Campaign đang ship: 85/85 regression.

iOS: ${native?`${native.version} (${native.build}) — Apple VALID; TestFlight verified=${native.testflightAvailable}; tests=${native.simulatorTests}; commit=${native.sourceCommit}`:'Workflow 42181451347 đang chạy; chưa suy ra upload/Apple/TestFlight từ trạng thái đang chạy.'}
Workflow: https://github.com/Nypro6895/kingpos/actions/runs/42181451347
Native baseline đã upload: 1.0.0 (96), commit 2defa6574c8dbbd9f96017b7ac0be4a0ccca3b2d.
App Store: KHÔNG submit, KHÔNG phát hành.
Android/iPad: nguồn preparation đã tích hợp, không mở kênh phân phối/store mới.

Còn chờ:
- Campaign hoàn credit chưa dùng: thiếu SQL access production (browser SQL Editor không điều khiển được; CLI chưa đăng nhập). Chưa áp migration, worker giữ đúng bản baseline. Patch riêng đạt 7/7 test; cần preflight ledger/function/ACL, migration nguyên tử, rồi publish worker cùng lượt.
- External Market: còn hosting/provider/domain/device/policy acceptance; chưa mở commerce công khai. Các record cũ và task chưa hoàn thành giữ riêng trong pending-audit.json, không đè snapshot cũ lên source đang live.
- Các event đến sau selection freeze: ${late.map(e=>e.changeId+' ('+e.status+')').join(', ')||'none'}.
- Chưa kiểm chứng iPhone vật lý hay các luồng salon đăng nhập cần dữ liệu thật.

Ghi chú kiểm thử: fixture profile cũ giả định sparse profile không có ảnh; production hiện có ảnh mặc định nên acceptance được thu hẹp đúng header/identity. Fixture tên salon cực dài phát hiện footer cũ tràn ngang; footer đó giữ nguyên từ baseline, không nằm trong thay đổi header này. Không coi fixture đó là hosted/device proof.
`;fs.writeFileSync(out+'/RELEASE.txt',text);console.log({report:out+'/RELEASE.txt',web:'published',native:native?.build??'in progress',late:late.length});
