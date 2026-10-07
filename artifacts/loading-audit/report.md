# Rà soát tải trang và trải nghiệm sử dụng KingPOS

Ngày rà soát: 05/10/2026. Phiên bản Next.js trong dự án: 16.2.9.

Bổ sung ngày 06/10/2026: kết quả kiểm tra website sau đăng nhập được lưu ở [Kiểm tra thực tế Reylumi](production-session-2026-10-06.md). Đã xác nhận hai cây nội dung Services ở responsive và phát hiện phạm vi Reports đổi sau refresh. Các giới hạn của lượt mã nguồn và lượt production được ghi riêng.

Các vấn đề có phạm vi ảnh hưởng lớn nhất là nội dung trang được gắn hai lần trong giao diện responsive, POS Portable tải sẵn nhiều tab nhưng vẫn làm mới cả route, và các truy vấn phụ nằm trên đường chờ hiển thị trang. Cần xử lý các cơ chế chung này trước khi tối ưu từng truy vấn riêng lẻ.

Phạm vi gồm danh mục 90 trang và 38 route handler, các luồng tải đầu, điều hướng, đổi bộ lọc, mở tab, lưu dữ liệu, realtime, polling, quay lại trang, khôi phục kết nối và cache offline. Đây là audit mã nguồn cùng kiểm tra HTTP local không đăng nhập; chưa phải xác nhận thao tác thực tế của mọi nút bằng tài khoản owner, staff, customer và admin. Các con số thời gian production, dung lượng payload thực tế của tài khoản và kế hoạch truy vấn database cần đo riêng.

`inventory.json` liệt kê toàn bộ trang, handler và vị trí cần xem xét: 85 dòng gọi `router.refresh()`, 33 dòng tạo interval, 29 dòng vô hiệu hóa layout gốc, 4 dòng gọi reload trình duyệt. Đây là số vị trí mã nguồn, không phải số lỗi hay số request. 82 trang không có loading.tsx ngay trong thư mục của mình; một số vẫn có loading từ thư mục cha.

## Các phát hiện ưu tiên cao

P1 là vấn đề nên xử lý đầu vì ảnh hưởng nhiều luồng hoặc gây tải lại lớn. P2 là tối ưu phạm vi hẹp hơn. “Xác nhận” nghĩa là cơ chế có trong mã; mức chậm thực tế vẫn phụ thuộc dữ liệu và môi trường.

### 01 Nội dung trang được gắn hai lần trong giao diện responsive

**P1 · Xác nhận.** `app/navigation-shell.tsx:3100` và `:3132` đặt cùng `children` vào phần giao diện mobile và desktop khi có `routeNavigation`. CSS ẩn một nhánh không ngăn các Client Component trong nhánh đó mount, chạy effect, interval hay subscription. Có thể tạo hai bản state và hai bộ đọc dữ liệu độc lập trên các trang có client refresh.

`app/pos/owner-pos-client.tsx:24` đã phải kiểm tra kích thước để chỉ mount workspace đang hiển thị, nhưng cơ chế này chỉ bảo vệ POS owner. Nên giữ một cây nội dung trang và thay đổi bố cục xung quanh bằng CSS; không giải quyết bằng thêm kiểm tra visibility riêng cho từng trang. Kiểm chứng bằng đếm mount và request ở desktop, mobile và khi đổi breakpoint. Việc gắn hai nhánh client không tự chứng minh server chạy loader hai lần.

### 02 Context tài khoản và salon bị đọc lại trong cùng lượt tải

**P1 · Xác nhận.** Layout dùng `lib/request-business-context.ts:7` với React cache theo request, nhưng guard `lib/route-context-guards.ts:54` và nhiều loader gọi thẳng hàm không cache. Ví dụ `/pos`: guard trong `app/(app)/pos/page.tsx:7`, loader tại `lib/pos-desk.ts:115`, bên cạnh context từ layout. `/customers`, trang chi tiết khách, `/payroll`, `/my-place`, `/settings`, trang salon công khai và admin có các đường đọc identity/context tương tự.

`lib/current-context.ts:1523` thực hiện chuỗi auth, memberships, accounts/salons, profile, staff liên kết và quyền; `:926` còn có RPC bootstrap trong đường load memberships. Nên truyền context đã xác thực vào loader và dùng chung cache theo server request cho đường đọc. Cần giữ kiểm tra quyền trên mọi request và không dùng cache context chung giữa người dùng. Đo số lần gọi context cho một render trước và sau.

### 03 Badge và dữ liệu thông báo chặn giao diện chung

**P1 · Xác nhận.** `app/salon-switcher.tsx:189` chờ `getWorkspacePendingSummary` trước khi trả shell. `lib/workspace-pending.ts:167–241` lần lượt đọc notification feed, connection requests, count hồ sơ nhân viên, publication requests và booking action count. Nhiều phần không phụ thuộc kết quả của nhau.

Tách phần hiển thị nội dung chính khỏi việc chờ badge, hoặc gom các truy vấn độc lập vào song song/RPC tổng hợp. Cache hiện có theo request giúp tránh một số gọi trùng, nhưng không rút ngắn chuỗi chờ đầu tiên. Không cần tải toàn bộ danh sách connection requests để chỉ hiện một số đếm và vài preview.

### 04 POS Portable chuẩn bị cả năm tab ngay từ đầu

**P1 · Xác nhận, có đánh đổi thiết kế.** `app/(app)/pos/portable/layout.tsx:114` tạo panel POS, Check-in, Book, Report và Ticket theo quyền; mỗi panel gọi page loader của mình. Suspense cho phép streaming nhưng không biến panel ẩn thành tải theo nhu cầu. `app/pos/portable/portable-panels.tsx:38` giữ mọi panel được cấp quyền mounted bằng thuộc tính `hidden`.

Việc giữ giỏ hàng và chuyển tab local nhanh là có ích. Nên ưu tiên panel đang mở, chuẩn bị các panel còn lại sau khi trang chính sẵn sàng hoặc khi lần đầu mở; giữ state sau lần mở đầu. Chuẩn bị offline cần có lịch riêng, không tranh tài nguyên với lần hiển thị đầu. Route page cũng có thể được Next chuẩn bị cùng panel có loader được gọi trực tiếp; cần trace để xác định phần tính toán trùng thực tế.

### 05 POS Portable vẫn làm mới cả route khi realtime đến

**P1 · Xác nhận có điều kiện.** `app/pos/portable/portable-workspace-tabs.tsx:235` mount `PosWorkspaceRealtimeRefresh` khi `offlineEnabled` false, dù layout đặt `localPanels` true. `app/pos/pos-workspace-realtime-refresh.tsx:43` gọi `router.refresh()` sau 75 ms cho source không bị bỏ qua.

Cùng lúc, broker trong `lib/pos-workspace-sync.ts` và các panel đã đọc riêng staff, ticket, booking, settings. Một sự kiện có thể vừa tải dữ liệu riêng vừa render lại route và các panel. `PortableShellRefresh` trả null không vô hiệu hóa bộ refresh nằm trong header. Nên thống nhất việc cập nhật theo resource trong chế độ localPanels; dùng reload route cho thay đổi phiên/quyền thật sự. Bộ cũ cũng thiếu kiểm tra document visibility và khóa request đang chạy.

### 06 Trang đã tải ở server lại được đối soát ngay khi mount

**P1 · Xác nhận.** `lib/pos-workspace-sync.ts:72` lên lịch fetch tức thì cho mọi `usePosResourceRefresh`; khi socket SUBSCRIBED, broker lại wake mọi resource. Các trang `/bookings`, `/reports`, `/pos-tickets`, POS owner và provider Portable đã có initial data từ server nhưng có thể gọi lại ngay.

Một lần đối soát đầu có thể cần cho HTML offline cũ. Nên truyền thời điểm/version snapshot để bỏ fetch đầu khi dữ liệu vừa tải, chỉ đối soát ngay khi snapshot cũ hoặc có dấu hiệu thay đổi. Subscription và initial fetch phải dùng cùng lịch, tránh thêm fetch thứ hai khi socket kết nối sau request đầu.

### 07 POS owner tải riêng từng resource rồi vẫn tải nguyên workspace

**P1 · Xác nhận.** `app/pos/owner-pos-client.tsx:99–116` đăng ký staff, catalog và settings. Callback settings lấy settings/preferences rồi `await refresh()` lấy nguyên workspace. Wake mỗi phút gửi tất cả resource, nên tạo các fetch nhỏ và một fetch đầy đủ dù không có thay đổi cấu hình.

`app/api/pos/owner/workspace/route.ts:35` gọi `getCurrentSalonPosDeskData` cho nhánh đầy đủ; `lib/pos-desk.ts:148` đọc cả 25 khách gần nhất, trong khi endpoint không trả danh sách khách. Trang POS owner tìm khách riêng khi mở panel. Nên trả defaults/preferences trực tiếp trong resource settings, tránh đọc khách trong loader refresh và bỏ việc tải catalog/settings mỗi phút khi version không đổi.

### 08 Bookings mỗi lần cập nhật lại tải cả bộ thiết lập

**P1 · Xác nhận.** `app/bookings/owner-live-booking-workspace.tsx:11` không dùng IDs của booking change, luôn gọi endpoint workspace. `lib/bookings.ts:1060` đọc bookings, customers, staff, services, assignments, availability rules, time blocks và requests; sau đó đọc lines/events/tickets/inspiration, users, beauty profiles và no-show counts.

Một thay đổi trạng thái appointment thường chỉ cần cập nhật appointment liên quan và số đếm. Tách dữ liệu lịch đang xem khỏi danh mục/config, hỗ trợ cập nhật theo ID với đối soát toàn bộ có giới hạn. Các truy vấn đã có giới hạn 200/300/500 bookings; vẫn cần cơ chế phân trang đầy đủ nếu người dùng chọn phạm vi lớn, không chỉ tăng limit.

### 09 Reports tải cả hai tab và so sánh lịch sử mỗi lần đồng bộ

**P1 · Xác nhận.** `app/(app)/reports/page.tsx:42` chờ operational report rồi mới tải daily closing. `app/api/pos/owner/reports/route.ts:10` luôn tải cả hai. `lib/operational-report.ts:1491` đọc facts của kỳ hiện tại và kỳ trước. Callback realtime `app/reports/owner-live-reports.tsx` lặp lại endpoint này.

Người chỉ mở Daily Closing vẫn trả chi phí của Overview; thay đổi trong ngày có thể kéo theo tính lại kỳ trước. Nên tải theo tab/date, tách daily closing và operational overview, tái sử dụng phần facts không đổi và song song hóa phần độc lập. Báo cáo tài chính phải có version/snapshot phù hợp trước khi thêm cache.

### 10 Làm mới server nhưng state Reports và Tickets chưa nhận snapshot mới

**P1 · Xác nhận.** `app/reports/owner-live-reports.tsx` giữ `useState(initial)` và `app/pos-tickets/owner-live-tickets.tsx` giữ `useState(initialTickets)` mà không đồng bộ khi props đổi. Key ở page phụ thuộc filter/date, không phụ thuộc snapshot. Các nút lưu Daily Closing gọi router.refresh nhưng refresh cùng date/filter không chắc cập nhật state này; người dùng có thể chờ realtime/polling sau một render tốn chi phí.

Nên hợp nhất snapshot mới từ props vào state hoặc lấy state trực tiếp từ một nguồn cache có version. Kiểm tra lưu rồi nhìn lại số liệu ngay, giữ ngày đang xem, và tránh snapshot cũ ghi đè thay đổi mới.

### 11 Hồ sơ salon công khai tải đầy đủ dữ liệu cho metadata và trang

**P1 · Xác nhận hai lần gọi loader; số request DB cần trace.** `app/(app)/explore/salons/[salonId]/page.tsx:17` và `:39` cùng gọi `getPublicSalonProfileData`. Hàm tại `lib/salon-profile.ts:1540` không được bọc React cache và thực hiện 16 nhánh tải song song, gồm bài đăng, experiences, reviews, services, staff, trust, identity, preferences và hours. Metadata chỉ cần tên/tagline/description.

Nên có loader metadata tối thiểu và loader nội dung chia phần; nếu dùng chung dữ liệu thì memoize loader theo request. Không mặc định POST RPC của Supabase được Next tự deduplicate. `app/(app)/salon-profile/page.tsx:302–322` còn tải quản trị rồi trạng thái hoạt động rồi public profile, khiến người quản lý cũng chờ nhiều dữ liệu nối tiếp.

### 12 Payroll tự lưu từng dòng gây tính lại trang nặng

**P1 · Xác nhận.** `app/payroll/staff-income-autosave-inputs.tsx` debounce 700 ms và submit khi giá trị đổi. `app/payroll/actions.ts:149` revalidate `/payroll` và `/payroll/tax-company` cho mỗi lần lưu. `lib/payroll.ts:4328–4370` tính live payroll, snapshot, staff, settings, service analytics, tax lines và presentation trước khi trả trang.

Debounce giúp giảm số lần lưu nhưng mỗi lần vẫn có thể cập nhật server render lớn. Nên trả kết quả dòng và phần tổng bị ảnh hưởng, gom các thay đổi trong một lượt chỉnh, tải analytics/tax theo tab. Phải kiểm chứng tổng tiền và trạng thái kỳ lương trước khi thay đổi chiến lược.

## Các phát hiện ưu tiên tiếp theo

| Mã | Mức | Khu vực và bằng chứng | Vấn đề và hướng xử lý |
| --- | --- | --- | --- |
| 13 | P2 | `app/services/services-manager.tsx:934`, `app/quick-workspace-panel.tsx:196`, `app/login/login-form.tsx:120` | push/replace rồi refresh ngay tạo hai cơ chế điều hướng và cập nhật cùng lúc. Services đã đổi URL để hiển thị item mới. Chọn một cơ chế cho từng luồng; với login/workspace phải xác nhận cookie và shell đã đổi đúng trước khi bỏ refresh. |
| 14 | P2 | `app/services/services-manager.tsx:912`, `app/booking-setup/booking-setup-editors.tsx:841`, `app/bookings/booking-workspace-client.tsx`, actions tương ứng | Nhiều save vừa gọi Server Action có revalidatePath vừa gọi client refresh. Next 16.2.9 cập nhật UI của path đang xem ngay từ Server Function, nên refresh sau đó có nguy cơ dư. Kiểm chứng từng mutation, dùng action trả snapshot/patch thay vì refresh vô điều kiện. |
| 15 | P1 | `app/salon-profile/actions.ts:167`, `app/my-place/actions.ts:62`, `app/staff/appointments/actions.ts:123`, và danh sách rootInvalidation trong inventory | revalidatePath('/', 'layout') vô hiệu hóa layout và các trang bên dưới. Một sửa nội dung hoặc trạng thái booking có phạm vi hẹp nhưng lại làm cache điều hướng rộng mất hiệu lực. Thu hẹp path/tag; giữ phạm vi rộng cho thay đổi identity/quyền/workspace có lý do cụ thể. Nhiều path revalidate không có nghĩa tất cả được fetch ngay cùng lúc. |
| 16 | P2 | `app/staff/my-work/staff-daily-refresh.tsx:30–44` | Staff có polling riêng 30/60 giây và broker polling 60 giây; focus/online/visibility cũng được đăng ký ở cả hai. Queue đã chống một số trùng nhưng nhiều resource từ một sự kiện vẫn cùng yêu cầu refresh toàn route. Dùng một lịch đối soát, thu hẹp event theo view; giữ chống missed broadcast và rollover ngày. |
| 17 | P2 | `app/pos/portable/ticket/portable-ticket-client.tsx:433–452`, `app/pos/portable/check-in/portable-check-in-client.tsx:249–270`, provider `portable-workspace-state.tsx:79` | Ticket polling 30 giây và Check-in polling 60 giây chạy khi panel hidden; Ticket còn lắng nghe broker/focus/pageshow. Provider và Check-in có hai đường đọc roster. Dùng roster chung và tạm dừng dữ liệu chi tiết của tab ẩn, giữ đối soát tối thiểu cần cho POS. Book panel đã có kiểm tra kích thước/visibility nên không xếp chung lỗi tab ẩn. |
| 18 | P2 | `app/pos/pos-desk-client.tsx:708` | Waiting queue trong localFirstDraft fetch mỗi 5 giây, ngoài sự kiện local/online; không khóa fetch đang chạy, không kiểm tra panel/tab visible. Request timeout cũng 5 giây nên mạng chậm có thể chồng lượt. Dùng broker waiting, khóa request, poll dự phòng chậm hơn khi không có event. |
| 19 | P2 | `app/pos/portable/staff-avatar.tsx:34` | Mỗi avatar có một timer fetch no-cache mỗi phút, kể cả tab ẩn và cùng ảnh được dùng nhiều nơi. Dùng URL có version, cache chung theo src và chỉ revalidate khi roster/photo đổi. Browser có thể trả 304 nhưng vẫn phát sinh kiểm tra mạng. |
| 20 | P1 | `app/pos/portable/portable-offline-shell.tsx:35`, `public/portable-sw.js:27–42` | Mỗi phút prepare lại HTML `/pos/portable` với no-store, rồi fetch mọi asset mà không kiểm tra cache/version trước. Tải HTML lại có thể kích hoạt chuẩn bị toàn bộ panel server. Tách cache shell/code theo build version khỏi snapshot dữ liệu theo độ mới; chỉ tải asset thiếu. Asset immutable có thể lấy từ HTTP cache nên không suy ra toàn bộ byte đều tải mạng mỗi phút. |
| 21 | P2 | `app/pos/portable/portable-sync-indicator.tsx:24`, `app/pos/owner-queue-runtime.tsx:11` | Connection probe mỗi 15 giây và đọc/sync outbox mỗi 5 giây. Giữ đồng bộ outbox là cần thiết, nhưng probe không kiểm tra visibility, và owner có runtime toàn layout. Dùng một probe dùng chung, backoff khi không có việc; sync helper đã có khóa nên không kết luận luôn gửi mutation trùng. |
| 22 | P2 | `app/(app)/customers/page.tsx:370`, `app/pos-tickets/owner-live-tickets.tsx:284`, `app/(app)/more/[section]/page.tsx:320`, `app/(app)/explore/wisconsin/page.tsx:39`, admin filter tại `_components/admin-ui.tsx:443` | Form HTML GET nội bộ không intercept hoặc Next Form gây document navigation, chạy lại shell và reset client state. Chuyển bộ lọc sang điều hướng client/Next Form và giữ URL; chỉ thay phần kết quả. Reports đã intercept submit bằng router.push nên không thuộc lỗi này. |
| 23 | P2 | `app/(app)/settings/page.tsx:187`, `app/(app)/account/page.tsx:60`, `app/(app)/salon-settings/page.tsx:884–906` | Trang settings/account chờ phân tích ảnh hưởng xóa tài khoản dù người dùng chỉ chỉnh thông tin; salon-settings còn chờ readiness, map, directory, owners, closure review. Tải phần nguy hiểm hoặc chuyên biệt khi mở section, stream phần thông tin cơ bản trước. |
| 24 | P2 | `app/(app)/explore/page.tsx:1132–1169` | Home content được chờ trước khi gọi search; request tìm kiếm vẫn tải initial feed, quick actions và utility booking/notifications. Tách đường search khỏi home; chỉ chờ thông tin location cần cho query và ưu tiên kết quả tìm kiếm. ExploreMap đã dùng dynamic import. |
| 25 | P2 | `lib/public-booking-availability-client.ts:3`, `app/book/[salonId]/public-booking-client.tsx:1067–1135` | Slot/hint đã có debounce, cache promise 30 giây và bỏ kết quả cũ bằng active flag, nhưng fetch không nhận abort/timeout. Đổi lựa chọn nhanh sau debounce để request cũ tiếp tục tính trên server. Thêm timeout và cancellation có quản lý ownership của promise chung; giữ kiểm tra availability thật khi confirm. |
| 26 | P2 | `components/quick-booking.tsx:56–82` | Popup dùng import động và warm context 5 giây, nhưng pointerover/focus/pointerdown có thể gọi context mới khi lướt nhiều link, và pointerover có thể lặp khi đi qua phần tử con sau TTL. Thêm dwell intent, dedupe theo salon/selection và hạn mức warm request; kiểm tra với Next Link prefetch để tránh chuẩn bị cả page và popup cho cùng ý định. Phần trùng với Link là giả thuyết cần network trace. |
| 27 | P2 | `app/(app)/admin/layout.tsx:6`, `lib/platform-admin/auth.ts:35–79`, các page admin | Layout và page cùng requirePlatformAdmin; helper không cache theo request và đọc auth/current user/admin RPC. Dùng identity và admin context theo request, vẫn kiểm quyền riêng theo từng page. Các read-only notes ở chi tiết admin có thể tải song song sau khi biết target. |
| 28 | P2 | Danh mục loading trong inventory, `app/(app)/layout.tsx:70` | Nhiều route dynamic nặng thiếu loading gần trang hoặc thiếu Suspense ở phần dữ liệu phụ, trong khi layout còn chờ context/shell. Điều hướng có thể trông như không phản hồi. Ưu tiên loading/Suspense cho payroll, customers, settings, salon-profile, activity, staff appointments; kiểm tra boundary cha, không coi 82 trang là 82 lỗi độc lập. Skeleton cải thiện phản hồi nhưng không thay thế việc giảm truy vấn. |
| 29 | P2 | `app/pos/pos-desk-client.tsx:1098`, `lib/pos-local-display.ts:31` | Draft preview publish qua BroadcastChannel mỗi 100 ms kể cả payload không đổi; phía display nhận và báo presence lại. Đây là tải xử lý local, không phải request HTTP. Publish khi revision đổi, giữ heartbeat chậm riêng để kiểm tra display/reconnect. |

## Những cơ chế cần giữ

`router.refresh()` lấy lại payload Server Components và merge vào client, không tương đương `window.location.reload()`. Không nên gọi mọi refresh là tải lại toàn bộ document. Chỉ các native GET form và lệnh location.reload tạo kiểu tải document trong các trường hợp nêu trên.

Giữ giới hạn trang, quyền truy cập và khả năng offline. Notification center đã phân trang 10 items, có AbortController và request version. Comments đọc qua GET có timeout 15 giây, tránh hàng đợi mutation Server Action. Inspiration availability dùng IntersectionObserver, batch và giới hạn hai request. Booking popup import wizard khi có ý định; wizard cache slot/hint theo selection. Các timer chỉ cập nhật đồng hồ hay carousel không tự tạo request mạng. Reload sau chuẩn bị device hoặc thay đổi trạng thái khóa/sign-in có mục đích rõ ràng và cần kiểm tra khả năng thay thế trước khi sửa.

Tài liệu Next.js đi kèm phiên bản được đối chiếu: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`, `revalidatePath.md`, và `01-getting-started/04-linking-and-navigating.md`. Theo tài liệu này, Server Functions revalidate path đang xem cập nhật UI ngay; các trang đã ghé có thể bị refresh khi quay lại. Route Handler chỉ đánh dấu revalidation cho lần truy cập sau. Không suy luận rằng gọi revalidate nhiều path sẽ tự fetch tất cả path ngay lúc gọi.

## Thứ tự cải thiện và cách nghiệm thu

1. Gắn nội dung một lần, thống nhất context theo request, đưa badge ra khỏi đường chờ chính. Đếm mount, context reads và thời gian server trả shell.
2. Cho POS một cơ chế sync theo resource; ưu tiên tab đang mở; ngăn poll tab ẩn và vòng tải lại offline shell. Kiểm tra giỏ hàng, chuyển tab, offline, reconnect và ngày mới.
3. Tách Bookings/Reports/Payroll/Public Profile thành loader nhỏ theo view. Giữ version của snapshot, sync props và patch sau save; kiểm tra số liệu hiển thị ngay sau thao tác.
4. Thu hẹp revalidation, bỏ push/replace cộng refresh khi đã có cập nhật đúng, đổi native filter form sang client navigation, thêm loading boundaries.
5. Đo production bằng tài khoản kiểm thử cho từng vai trò: tải trực tiếp, Link, đổi filter/tab, mở drawer, save, browser back/forward, refresh thủ công, focus/visibility, realtime, offline/reconnect. Thu HAR, số request, byte JSON/RSC, TTFB, LCP/INP, thời gian click tới kết quả và p50/p95 truy vấn. So sánh dữ liệu nhỏ và lớn, một tab và nhiều tab, mạng nhanh và mạng chậm.

Nghiệm thu: không có hai bản client workspace hoạt động cho cùng trang; thao tác nhỏ không kéo danh mục/báo cáo không liên quan; dữ liệu mới xuất hiện sau save; tab ẩn có ngân sách đồng bộ rõ ràng; chỉ các lý do thay đổi phiên/quyền mới cập nhật shell rộng; cache không trộn dữ liệu giữa salon hay người dùng. Ngưỡng thời gian nên chốt sau baseline production, không gán tỷ lệ tăng tốc từ audit tĩnh.

## Kiểm tra bản chạy local

Kết quả HTTP được lưu trong `local-smoke.json` và `local-smoke-sequential.json`. Lượt đồng thời không đăng nhập cho `/login` trả 200, khoảng 1,23 giây tới headers và 1,96 giây nhận hết body; bảy route còn lại chạm timeout 25 giây. Lượt thử lại tuần tự cho `/login`, `/terms` và `/explore` đều chạm timeout 15 giây. Có cả route legal trong nhóm timeout, nên chưa thể quy kết các timeout cho truy vấn salon hay logic của từng trang. Bản local có thể đang biên dịch hoặc gặp nghẽn chung. Các số này không đại diện production và các route bảo vệ chưa được đo trong phiên đã đăng nhập.

Danh mục đầy đủ các route và tín hiệu nằm trong inventory; không có thay đổi logic ứng dụng trong lượt audit này.


## Danh mục 90 trang được quét

Các cột dưới đây là kiểm kê cấu trúc, không phải xác nhận E2E từng thao tác. Loading ghi có khi tồn tại boundary ở chính thư mục hoặc thư mục cha trong cây app.

| Route | Mã nguồn | Loading trong cây cha |
| --- | --- | --- |
| /account | app/(app)/account/page.tsx | Chưa có |
| /account-recovery | app/(app)/account-recovery/page.tsx | Chưa có |
| /activity | app/(app)/activity/page.tsx | Chưa có |
| /activity/receipts/[ticketId] | app/(app)/activity/receipts/[ticketId]/page.tsx | Chưa có |
| /admin/audit | app/(app)/admin/audit/page.tsx | Có |
| /admin/businesses | app/(app)/admin/businesses/page.tsx | Có |
| /admin/businesses/[businessId] | app/(app)/admin/businesses/[businessId]/page.tsx | Có |
| /admin/claims | app/(app)/admin/claims/page.tsx | Có |
| /admin/locations | app/(app)/admin/locations/page.tsx | Có |
| /admin/locations/[locationId] | app/(app)/admin/locations/[locationId]/page.tsx | Có |
| /admin | app/(app)/admin/page.tsx | Có |
| /admin/recovery | app/(app)/admin/recovery/page.tsx | Có |
| /admin/reports | app/(app)/admin/reports/page.tsx | Có |
| /admin/reports/[reportId] | app/(app)/admin/reports/[reportId]/page.tsx | Có |
| /admin/settings/twilio | app/(app)/admin/settings/twilio/page.tsx | Có |
| /admin/team | app/(app)/admin/team/page.tsx | Có |
| /admin/users | app/(app)/admin/users/page.tsx | Có |
| /admin/users/[userId] | app/(app)/admin/users/[userId]/page.tsx | Có |
| /admin/verification | app/(app)/admin/verification/page.tsx | Có |
| /beauty | app/(app)/beauty/page.tsx | Chưa có |
| /book/[salonId] | app/(app)/book/[salonId]/page.tsx | Chưa có |
| /booking/manage/[token] | app/(app)/booking/manage/[token]/page.tsx | Chưa có |
| /bookings | app/(app)/bookings/page.tsx | Có |
| /businesses/create | app/(app)/businesses/create/page.tsx | Chưa có |
| /businesses/new | app/(app)/businesses/new/page.tsx | Chưa có |
| /businesses | app/(app)/businesses/page.tsx | Chưa có |
| /claim/customer | app/(app)/claim/customer/page.tsx | Chưa có |
| /claim/[salonId] | app/(app)/claim/[salonId]/page.tsx | Chưa có |
| /customers/new | app/(app)/customers/new/page.tsx | Chưa có |
| /customers | app/(app)/customers/page.tsx | Chưa có |
| /customers/[customerId]/edit | app/(app)/customers/[customerId]/edit/page.tsx | Chưa có |
| /customers/[customerId] | app/(app)/customers/[customerId]/page.tsx | Chưa có |
| /explore/beauty/[profileId] | app/(app)/explore/beauty/[profileId]/page.tsx | Có |
| /explore/beauty/[profileId]/posts/[postId] | app/(app)/explore/beauty/[profileId]/posts/[postId]/page.tsx | Có |
| /explore/looks/[lookId] | app/(app)/explore/looks/[lookId]/page.tsx | Có |
| /explore | app/(app)/explore/page.tsx | Có |
| /explore/salons/[salonId] | app/(app)/explore/salons/[salonId]/page.tsx | Có |
| /explore/wisconsin | app/(app)/explore/wisconsin/page.tsx | Có |
| /explore/wisconsin/[businessId] | app/(app)/explore/wisconsin/[businessId]/page.tsx | Có |
| /forgot-password | app/(app)/forgot-password/page.tsx | Chưa có |
| /login | app/(app)/login/page.tsx | Chưa có |
| /more | app/(app)/more/page.tsx | Chưa có |
| /more/[section] | app/(app)/more/[section]/page.tsx | Chưa có |
| /my-bookings | app/(app)/my-bookings/page.tsx | Chưa có |
| /my-bookings/[bookingId] | app/(app)/my-bookings/[bookingId]/page.tsx | Chưa có |
| /my-place | app/(app)/my-place/page.tsx | Chưa có |
| /notifications | app/(app)/notifications/page.tsx | Chưa có |
| /notifications/visits/[visitId] | app/(app)/notifications/visits/[visitId]/page.tsx | Chưa có |
| /ownership/invite/[token] | app/(app)/ownership/invite/[token]/page.tsx | Chưa có |
| / | app/(app)/page.tsx | Chưa có |
| /payroll | app/(app)/payroll/page.tsx | Chưa có |
| /payroll/tax-company | app/(app)/payroll/tax-company/page.tsx | Chưa có |
| /permissions | app/(app)/permissions/page.tsx | Chưa có |
| /pos/customer-display | app/(app)/pos/customer-display/page.tsx | Có |
| /pos/customer-display/setup | app/(app)/pos/customer-display/setup/page.tsx | Có |
| /pos | app/(app)/pos/page.tsx | Có |
| /pos/portable/book | app/(app)/pos/portable/book/page.tsx | Có |
| /pos/portable/check-in | app/(app)/pos/portable/check-in/page.tsx | Có |
| /pos/portable | app/(app)/pos/portable/page.tsx | Có |
| /pos/portable/report | app/(app)/pos/portable/report/page.tsx | Có |
| /pos/portable/ticket | app/(app)/pos/portable/ticket/page.tsx | Có |
| /pos/portable/today | app/(app)/pos/portable/today/page.tsx | Có |
| /pos/settings | app/(app)/pos/settings/page.tsx | Có |
| /pos-tickets | app/(app)/pos-tickets/page.tsx | Chưa có |
| /pos-tickets/[ticketId] | app/(app)/pos-tickets/[ticketId]/page.tsx | Chưa có |
| /reports | app/(app)/reports/page.tsx | Có |
| /reset-password | app/(app)/reset-password/page.tsx | Chưa có |
| /roles | app/(app)/roles/page.tsx | Chưa có |
| /salon-profile/client-transformations | app/(app)/salon-profile/client-transformations/page.tsx | Chưa có |
| /salon-profile | app/(app)/salon-profile/page.tsx | Chưa có |
| /salon-settings | app/(app)/salon-settings/page.tsx | Chưa có |
| /salons/new | app/(app)/salons/new/page.tsx | Chưa có |
| /salons | app/(app)/salons/page.tsx | Chưa có |
| /services | app/(app)/services/page.tsx | Chưa có |
| /settings/login-security | app/(app)/settings/login-security/page.tsx | Chưa có |
| /settings | app/(app)/settings/page.tsx | Chưa có |
| /settings/recovery-back-office | app/(app)/settings/recovery-back-office/page.tsx | Chưa có |
| /signup | app/(app)/signup/page.tsx | Chưa có |
| /staff/appointments | app/(app)/staff/appointments/page.tsx | Chưa có |
| /staff/connections | app/(app)/staff/connections/page.tsx | Chưa có |
| /staff/invite/[token] | app/(app)/staff/invite/[token]/page.tsx | Chưa có |
| /staff/my-work | app/(app)/staff/my-work/page.tsx | Có |
| /staff | app/(app)/staff/page.tsx | Chưa có |
| /staff/today | app/(app)/staff/today/page.tsx | Có |
| /staff/workday | app/(app)/staff/workday/page.tsx | Chưa có |
| /business-terms | app/(legal)/business-terms/page.tsx | Chưa có |
| /community | app/(legal)/community/page.tsx | Chưa có |
| /legal | app/(legal)/legal/page.tsx | Chưa có |
| /privacy | app/(legal)/privacy/page.tsx | Chưa có |
| /terms | app/(legal)/terms/page.tsx | Chưa có |

## Danh mục 38 route handler được quét

- app/(app)/api/auth/callback/route.ts
- app/(app)/api/auth/forgot-password/route.ts
- app/(app)/api/auth/login/route.ts
- app/(app)/api/auth/logout/route.ts
- app/(app)/api/auth/mfa/verify/route.ts
- app/(app)/api/auth/signup/route.ts
- app/(app)/api/public/salons/operating-status/route.ts
- app/(app)/api/staff/invite/signup/route.ts
- app/(app)/api/vendor/maplibre-gl/route.ts
- app/(app)/workspace/open/route.ts
- app/api/explore/wisconsin/export/route.ts
- app/api/internal/booking-messages/route.ts
- app/api/notifications/preferences/route.ts
- app/api/notifications/route.ts
- app/api/pos/connection/route.ts
- app/api/pos/customer-display/settings/route.ts
- app/api/pos/owner/bookings/route.ts
- app/api/pos/owner/operations/route.ts
- app/api/pos/owner/reports/route.ts
- app/api/pos/owner/tickets/route.ts
- app/api/pos/owner/workspace/route.ts
- app/api/pos/portable/device/route.ts
- app/api/pos/portable/draft/route.ts
- app/api/pos/portable/offline-staff/route.ts
- app/api/pos/portable/operations/route.ts
- app/api/pos/portable/staff/route.ts
- app/api/pos/portable/tickets/route.ts
- app/api/pos/portable/waiting/route.ts
- app/api/pos/portable/workspace/route.ts
- app/api/post-comments/route.ts
- app/api/public-booking/availability/route.ts
- app/api/public-booking/confirm/route.ts
- app/api/public-booking/context/route.ts
- app/api/public-booking/inspiration-times/route.ts
- app/api/staff/booking-preferences/route.ts
- app/api/staff/confirm-booking/route.ts
- app/api/staff/create-appointment/route.ts
- app/api/staff/report-no-show/route.ts
