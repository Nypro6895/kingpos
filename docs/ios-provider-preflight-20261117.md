# Provider preflight cho iOS — 17/11/2026

**BLOCKED_AUTHENTICATED_DEPLOYED_ENVIRONMENT_BINDING.** Đã chuẩn bị kiểm tra đọc cấu hình thật, nhưng chưa gửi request tới Supabase hoặc API email/SMS/payment. Chưa push/deploy, đổi provider, key, billing hay flag. Market và ad-credit transactions đã được chủ app chốt giữ trong phạm vi kiểm tra/khai báo; quyết định đó không bị hỏi lại.

## Điều đã xác minh an toàn

Checkout `2349fc2` có nguồn đọc cấu hình global được mã hóa. Canonical checkout có Vercel project link và Supabase project-ref; ref khớp URL public local. Bundle native tracked chứa một Supabase origin với hash cùng URL đó. Các kiểm tra này chỉ dùng metadata/URL hash, không in hoặc lưu key.

Probe cũ chỉ đọc 16 JS assets của `/privacy`, không tìm thấy project origin và đã dừng trước Auth GET. Login dùng server auth routes nên không có căn cứ để coi việc JS thiếu URL là lỗi provider. Coordinator báo public deployment hint `dpl_F5yYNDU4nXW2epT5pozciBmPfHhv` khớp receipt nguồn `830f0a6`, nhưng chưa có alias/source/environment provenance được xác thực. **Không dùng hint, metadata local hoặc bundle native để vượt binding gate.**

Vercel nêu thay đổi env chỉ áp dụng cho deployment mới; vì vậy snapshot project env hiện tại chưa tự chứng minh env đã áp dụng cho deployment đang phục vụ. [Environment variables](https://vercel.com/docs/environment-variables). Không dùng `vercel env pull`/`vercel pull` trong lượt này vì chúng ghi env ra đĩa. [CLI pull](https://vercel.com/docs/cli/pull).

## Provider roster và output được phép

| Nhóm | Đường nguồn / dữ kiện có thể đọc sau binding | Hiện trạng thật |
| --- | --- | --- |
| Support/notification email | [support-email:30](../lib/support-email.ts#L30): singleton encrypted config; chỉ xuất provider Resend/SMTP, enabled, notification/domain flags và booleans cấu hình. Hostinger trong code là supported/default host, không phải bằng chứng đang dùng. | Chưa đọc saved selection. Support email khác Auth email; không gọi send hoặc domain-verify. |
| System SMS/voice | [twilio-settings:29](../lib/twilio-settings.ts#L29): global Twilio config, claim/auth/login/verification flags; không xuất SID/token/số gửi. [Auth hook](../app/api/auth/sms-hook/route.ts#L1) là đường có thể gửi nên tuyệt đối không gọi để probe. | Chưa biết config/hook nào đang được dùng; SDK hoặc global setting không chứng minh hook Auth đã bật/delivery thành công. |
| BookSMS | [booksms:14](../lib/booksms.ts#L14): cài đặt, access/allowance và encrypted config riêng từng salon. | Ngoài tám GET global; không đọc tenant credentials, khách hoặc message. Nếu cần, lập phạm vi metadata tổng hợp/tenant được chọn riêng. |
| Payment | [platform-payment:10](../lib/platform-payment.ts#L10): global encrypted Stripe config; chỉ xuất enabled, live/test, version và credential/webhook/account/portal configured booleans. | Chưa biết selected config hoặc readiness. Không Stripe GET, checkout, charge, connect hay webhook action. Legacy env precedence cần chứng cứ env deployment riêng. |
| Market | [market-payments:26](../lib/market-payments.ts#L26), [bank state:133](../lib/market-bank-billing.ts#L133): enabled, published/fulfillment flags, test flag, billing version/expiry. | Chưa xác minh saved flags; không coi default-off là giá trị production. Không đọc bank account/routing hoặc entitlements của khách. |
| Ads/credit | [owner settings:16](../lib/owner-campaigns.ts#L16), [ad limits:10](../lib/explore-advertising.ts#L10), [payment gate:10](../lib/campaign-payments.ts#L10): global enabled/prompts/delivery limits. | Không query campaign creative, reports hoặc delivery; không tạo impression/click. Ads của salon độc lập vẫn có thể thuộc Third-Party Advertising. `sessionMinutes` ở đây không phải log/data-retention. |
| Log/backup/region | Không có trường ứng dụng đã rà nào chứng minh plan/retention thực của Vercel, Supabase, SMTP/Resend, Twilio hoặc Stripe. | Chưa xác minh. Cần metadata plan/configuration và hợp đồng của đúng project/provider; không điền bằng vendor default. |

Runtime flags `MARKET_PLATFORM_ENABLED`, `MARKET_PRIVATE_REGISTRY_ENABLED`, `CHECK_WRITER_SALES_ENABLED`, `CHECK_WRITER_TRIAL_ENABLED` và background-dispatch chỉ lấy từ bằng chứng **deployed environment** đã xác thực. Không suy ra từ `.env.local` hoặc default trong source. Không kiểm tra OpenAI secrets hoặc làm API/key setup khi lựa chọn provider riêng còn chờ.

## Tool đã chuẩn bị

[provider-preflight.mjs](../artifacts/ios-next-steps-20261117/provider-preflight.mjs) là artifact độc lập, không thêm script vào sản phẩm. Mặc định dry-run, không đọc service/encryption key và không gửi network request:

```powershell
node artifacts/ios-next-steps-20261117/provider-preflight.mjs
```

Sau khi coordinator đã xác thực và duyệt current alias/deployment/applied-environment mapping:

```powershell
node artifacts/ios-next-steps-20261117/provider-preflight.mjs --execute --binding <sanitized-reviewed-evidence.json> --expected-deployment <current-authenticated-deployment-id>
```

Tool không tự đăng nhập hoặc chứng minh authentication. Một JSON tự ghi `verified` không phải bằng chứng; không tạo receipt như vậy để làm cho lệnh chạy. Receipt phải dựa trên metadata đã xác thực, không chứa key, có deployment/project/URL hash, thời điểm trong 15 phút và hash ba file chứng cứ đã sanitize. Hiện **chưa có receipt đủ điều kiện**, vì vậy chưa chạy execute với cấu hình thật.

Schema record tối thiểu nằm trong `bindingEvidenceTemplate` của [JSON](../artifacts/ios-next-steps-20261117/provider-preflight.json): `kind`, `status`, `coordinatorReviewed`, `appOrigin`, `target`, `deploymentId`, `observedAt`, `deployedEnvironmentAttested`, hai project/origin hashes, ba `evidence` records (`kind/path/sha256`) và `runtimeFlags` chỉ boolean/null. Template được ghi rõ `templateNotProof:true`, `status:unverified`, chưa reviewed/attested và không có file chứng cứ. Tool từ chối template/fixture được đánh dấu; không dùng nó thay cho nguồn metadata xác thực. Các proof “verified” trong test chỉ là object giả trong memory với fetch/secrets/evidence mocks, không phải proof thật hoặc verified JSON đã lưu.

Sau gate, tool chỉ GET tám endpoint allowlist: ba singleton encrypted email/SMS/payment, global Market, bank billing flags, owner ads, ad limits và public-style catalog flags. Chỉ ba singleton ciphertext được giải mã trong memory; output không spread config và không có credential/from-address/account IDs/bank details. Không RPC, POST/PATCH/DELETE, domain-verification, send, report hoặc vendor account API. Response có giới hạn bytes/rows/timeout; lỗi trở thành typed unknown, không thành disabled. Query chạy xong không có nghĩa provider đã hoạt động hoặc đủ khai App Privacy cuối.

[Test artifact](../artifacts/ios-next-steps-20261117/provider-preflight.test.mjs): **5/5 pass**, hoàn toàn mock. Bao gồm dry-run không đọc secret, binding sai/stale/hash sai chặn trước request, tám GET cố định, projection không rò secret, lỗi HTTP/crypto/schema/budget không đưa raw body ra output. Dry-run thật: **0 provider requests**.

Lệnh tái kiểm: `node --test artifacts/ios-next-steps-20261117/provider-preflight.test.mjs`. Receipt dry-run đã lưu riêng ở [provider-preflight-dry-run.json](../artifacts/ios-next-steps-20261117/provider-preflight-dry-run.json); không phải kết quả đọc cấu hình provider thật.

## Bằng chứng tối thiểu còn thiếu

1. Coordinator/hosting admin lấy authenticated current alias + deployment/project và env mapping thực sự áp dụng cho deployment đó; không chỉ public ID hoặc latest project config, không bulk-pull secrets.
2. Agent chạy tám GET đã chuẩn bị với local config hiện có sau binding; lưu duy nhất kết quả projection. Không có row hoặc decrypt thất bại phải giữ unknown; không thay bằng config đoán.
3. Engineering/provider admin đọc actual Auth mail/SMS hook, log/backup/region/retention/secondary-use theo đúng project/plan/hợp đồng. Chủ app không phải đoán SDK/provider từ UI.
4. Coordinator đối chiếu runtime với scope/Privacy/candidate và toàn bộ pending release trước khi cân nhắc phát hành. Không thực hiện phát hành riêng từ lượt này.

Kết quả máy đọc được: [provider-preflight.json](../artifacts/ios-next-steps-20261117/provider-preflight.json). Báo cáo này không xác nhận provider đang bật/tắt, delivery, lưu dữ liệu chỉ ở Mỹ hoặc thời hạn giữ dữ liệu cuối cùng.
