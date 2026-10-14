# HiTechCloud LandingPage

Nền tảng **SaaS tạo landing page kéo thả** cho doanh nghiệp Việt Nam, do HiTechCloud-VN / Pho Tue SoftWare Solutions JSC phát triển.

Lõi trình thiết kế dùng [GrapesJS](https://github.com/GrapesJS/grapesjs). Kiến trúc SaaS (workspace, xuất bản, tên miền, thu lead) được thiết kế tham khảo ý tưởng từ [Webstudio](https://github.com/webstudio-is/webstudio) và [OpenPage](https://github.com/buildingopen/openpage), nhưng **không sao chép mã nguồn** của hai dự án này. Lý do xem mục [Giấy phép](#giấy-phép-mã-nguồn-bên-thứ-ba).

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| Trình thiết kế | Kéo thả trên GrapesJS, xem trước theo máy tính / tablet / điện thoại, tự động lưu, phím tắt Ctrl+S. Có 14 section dựng sẵn: Hero, Tính năng, Con số, Quy trình, Bảng giá, Đánh giá, FAQ, Video YouTube, Đếm ngược ưu đãi, Form thu lead, CTA, nút gọi/Zalo/Messenger nổi… |
| Tiện ích chuyển đổi | 3 block kéo thả, chỉnh trong tab Cài đặt (⚙) của editor: **Popup thu lead** (hiện khi khách định rời trang, sau N giây hoặc khi cuộn tới N% trang; trên điện thoại "rời trang" chuyển thành hẹn giờ; tần suất mỗi phiên / mỗi ngày / mỗi lần tải; có Esc, khóa cuộn nền, giữ focus trong hộp thoại), **Thanh thông báo cố định** (đầu hoặc cuối màn hình, có nút đóng), **Thông báo khách vừa đăng ký** (xoay vòng danh sách, tôn trọng chế độ giảm chuyển động). Form trong popup tự gửi lead như mọi form khác. Script chỉ được chèn khi trang có tiện ích tương ứng |
| Mẫu khởi đầu | 9 mẫu theo ngành, mỗi mẫu có bảng màu riêng: Trang trắng, Sản phẩm SaaS, Thu lead nhanh (có thanh thông báo), Sự kiện/Webinar, Spa/Thẩm mỹ, Bất động sản, Khóa học, Nhà hàng/F&B, Bán sản phẩm (COD, có popup khi rời trang) |
| Xuất bản | Tách bản nháp và bản đã xuất bản, gỡ xuất bản, xem trước bản nháp, cài SEO (title, meta description, OG) |
| Tên miền | `/p/<subdomain>`, `<subdomain>.<PUBLISH_ROOT_DOMAIN>`, tên miền riêng (gói Pro trở lên) |
| Thu lead & CRM | Mọi `<form>` trên trang đã xuất bản tự gửi về hệ thống. Tự ghi nhận nguồn khách (UTM, referrer). Có trạng thái (Mới → Đã liên hệ → Tiềm năng → Thành công/Thất bại), ghi chú, bộ lọc theo trạng thái / từ khóa / ngày. Kiểm tra và chuẩn hóa số điện thoại Việt Nam, kiểm tra email, gộp lead trùng SĐT/email (không báo lại). Chống spam nhiều lớp: honeypot, giới hạn tần suất, dấu thời gian có ký HMAC, chấm điểm spam (link, từ khóa, dữ liệu lặp), Cloudflare Turnstile tùy chọn; lead spam được lưu riêng, không gửi thông báo, không tính hạn mức. Xuất CSV theo bộ lọc (chống CSV injection) |
| A/B testing | Chia lưu lượng giữa trang gốc và trang biến thể theo tỉ lệ tùy chọn, mỗi khách luôn thấy cùng một phiên bản. Thống kê lượt xem, lead, tỉ lệ chuyển đổi và độ tin cậy (z-test) của từng phiên bản. Chọn phiên bản thắng để thay vào URL gốc (gói Pro trở lên) |
| Nhiều người thuê | Nhiều workspace cho mỗi người dùng, vai trò Chủ sở hữu / Quản trị viên / Biên tập viên, dữ liệu cách ly theo workspace |
| Gói dịch vụ | Miễn phí / Pro / Business, giới hạn số website, trang, thành viên, lead/tháng, tên miền riêng, gỡ nhãn "Tạo bởi HiTechCloud" |
| Thanh toán | **payOS** (VietQR) và **Pay2S**. Thanh toán theo chu kỳ 1 tháng hoặc 12 tháng (tặng 2 tháng). Gói tự hết hạn và quay về gói Miễn phí. Gia hạn được cộng dồn vào thời gian còn lại. Webhook xác thực chữ ký HMAC, xử lý trùng lặp an toàn (idempotent) và đối chiếu số tiền |
| Mã giảm giá | Super admin tạo mã giảm theo % hoặc số tiền cố định, giới hạn theo gói, chu kỳ (1/12 tháng), số lượt dùng và ngày hết hạn; bật/tắt bất kỳ lúc nào. Khách nhập mã ở tab Gói dịch vụ để xem giá sau giảm. Cổng thanh toán nhận số tiền đã giảm (tối thiểu 10.000đ); mã giảm 100% kích hoạt gói ngay, không qua cổng. Lượt dùng chỉ được tính khi đơn đã thanh toán. Email xác nhận ghi rõ giá gốc, số tiền giảm và số tiền đã trả |
| Quản trị nền tảng | `/app/admin`: số người dùng, workspace trả phí, MRR, doanh thu, danh sách khách hàng, lịch sử giao dịch, cấp gói thủ công |
| Thống kê | Tab “Thống kê” cho từng website: chọn 7/30/90 ngày, lượt xem (bỏ qua bot), lead, tỉ lệ chuyển đổi và % thay đổi so với kỳ trước; biểu đồ theo ngày, trang hiệu quả nhất, nguồn khách hàng (UTM, website giới thiệu, trực tiếp) và trạng thái lead |
| Tích hợp marketing | Google Analytics 4, Google Tag Manager, Facebook Pixel, TikTok Pixel. Sự kiện chuyển đổi (Lead) gửi tự động khi khách điền form. Favicon, og:image, canonical, `sitemap.xml`, `robots.txt`. Chèn mã tùy chỉnh vào `<head>`/`<body>` (gói Pro trở lên) |
| API công khai | REST API `/api/v1` cho Zapier/Make/CRM bằng API key của workspace: đọc website, trang, lead; cập nhật trạng thái lead; xuất bản trang. Key chỉ lưu mã băm, thu hồi được, giới hạn 120 yêu cầu/phút (gói Pro trở lên) |
| Thông báo lead | Email (chủ sở hữu, quản trị viên và tối đa 5 địa chỉ khác), webhook có ký HMAC (Zapier/Make/n8n/CRM, chặn gửi tới địa chỉ nội bộ để chống SSRF), Telegram bot, Slack, Discord, Google Sheets (qua Apps Script). Các kênh gửi song song, nút gửi thông báo thử báo kết quả từng kênh. Xem [Kênh thông báo lead](#kênh-thông-báo-lead) |
| Thư viện ảnh | Tải ảnh PNG/JPEG/GIF/WEBP vào editor. Kiểm tra định dạng bằng nội dung file. Dung lượng theo gói: 50 MB / 2 GB / 10 GB |
| Lịch sử phiên bản | Tự lưu một phiên bản mỗi lần xuất bản (giữ 20 bản gần nhất), khôi phục về bản nháp. Có nhân bản trang |
| Tài khoản | Quên/đặt lại mật khẩu qua email, mời thành viên qua email, đổi mật khẩu, giới hạn số lần đăng nhập sai |
| Xác minh email & quyền dữ liệu | Xác minh email khi đăng ký (bắt buộc trước khi xuất bản trang hoặc thanh toán). Tải toàn bộ dữ liệu cá nhân (JSON), tự xóa tài khoản, chuyển quyền sở hữu workspace. Xem [Quyền dữ liệu cá nhân](#quyền-dữ-liệu-cá-nhân-nghị-định-132023) |
| Tên miền riêng | Xác minh quyền sở hữu bằng bản ghi DNS TXT gắn với từng website. Chỉ tên miền đã xác minh, thuộc workspace còn gói trả phí, mới được phục vụ và cấp HTTPS. Yêu cầu gắn tên miền chưa xác minh quá 72 giờ sẽ được giải phóng cho website khác |
| Vận hành | `docker-compose` kèm Caddy tự cấp HTTPS (kể cả tên miền của khách), `/healthz`, email nhắc gia hạn trước 7 ngày và 1 ngày, `npm run backup`, CI trên GitHub Actions |
| An toàn nội dung | Chấm điểm rủi ro lừa đảo khi xuất bản, hàng đợi xem xét, tự động tạm ngưng trang giả mạo ngân hàng, form báo cáo vi phạm công khai `/_htc/report`, tạm ngưng website / tài khoản kèm email thông báo. Xem [An toàn nội dung](#an-toàn-nội-dung) |
| Bảo mật | Mật khẩu băm scrypt, session lưu trong DB (cookie httpOnly, SameSite=Lax), chống CSRF (kiểm tra Origin và bắt buộc body JSON), trang khách hàng phục vụ trên domain dashboard được cô lập bằng `CSP: sandbox` |

## Chạy thử

Yêu cầu Node.js 22.13 trở lên (dùng SQLite tích hợp sẵn `node:sqlite`, không cần cài database).

```bash
npm install
npm start            # http://localhost:3000
npm test             # test API/đơn vị (node:test, thư mục test/)
npm run e2e          # test E2E trên trình duyệt (Playwright, thư mục e2e/)
```

Bắt đầu tại `http://localhost:3000/app/signup`.

### Docker

```bash
docker build -t hitechcloud-landingpage .
docker run -p 3000:3000 -v htc-data:/data --env-file .env hitechcloud-landingpage
```

Các biến cấu hình nằm trong `.env.example`.

## Triển khai production (docker-compose + Caddy)

```bash
cp .env.example .env      # điền APP_URL, APP_DOMAIN, PUBLISH_ROOT_DOMAIN, SMTP_URL, khóa payOS/Pay2S…
docker compose up -d --build
```

1. **DNS:**
   - Trỏ bản ghi A của `APP_DOMAIN` (vd `app.hitechcloud.vn`) về máy chủ.
   - Trỏ wildcard `*.hitechcloud.site` và `sites.hitechcloud.site` (giá trị `CNAME_TARGET`) về máy chủ.
   - Nên dùng **tên miền gốc khác** với dashboard để cô lập cookie.
2. **HTTPS:** Caddy tự cấp chứng chỉ cho dashboard. Với subdomain và tên miền riêng của khách, chứng chỉ được cấp khi có lượt truy cập đầu tiên (*on-demand TLS*). Trước khi cấp, Caddy hỏi `/_htc/tls-ask` để chắc chắn host đó thuộc một website đang chạy.
3. **Tên miền riêng:** khách thêm bản ghi TXT `_htc-verify.<domain>` (xác minh quyền sở hữu) và CNAME về `CNAME_TARGET` (trỏ lưu lượng), sau đó bấm "Kiểm tra DNS" trong cài đặt website.
4. **Quản trị:** đặt `SUPERADMIN_EMAILS` để vào `/app/admin`.
5. **Sao lưu:** chạy định kỳ `docker compose exec app node scripts/backup.js /data/backups`. Lệnh này dùng `VACUUM INTO`, chạy được khi ứng dụng vẫn đang hoạt động.

## Kênh thông báo lead

Cấu hình trong **Cài đặt website → Thông báo khi có lead mới**. URL của Slack, Discord và Google Sheets được coi là bí mật: sau khi lưu sẽ không hiển thị lại. Để trống ô khi lưu thì giữ nguyên giá trị cũ, nhập `-` để xóa. Bấm **Gửi thông báo thử** để kiểm tra, kết quả hiện theo từng kênh (vd `Slack: ✓ · Google Sheets: ✓`).

- **Slack:** Slack → *Apps* → *Incoming Webhooks* → *Add to Slack*, chọn kênh rồi dán URL `https://hooks.slack.com/services/…`. Tin nhắn dùng định dạng mrkdwn, liệt kê các trường của lead và kèm link mở dashboard.
- **Discord:** *Cài đặt kênh* → *Tích hợp* → *Webhook* → *Webhook mới* → *Sao chép URL webhook* (`https://discord.com/api/webhooks/…`). Nội dung tối đa 2000 ký tự (phần dài hơn bị cắt), không ping @everyone.
- **Google Sheets:** mở Google Sheet → *Tiện ích mở rộng* → *Apps Script*, dán đoạn mã dưới đây và lưu. Sau đó chọn *Triển khai* → *Tùy chọn triển khai mới* → loại *Ứng dụng web*, *Thực thi với tư cách: Tôi*, *Ai có quyền truy cập: Bất kỳ ai*. Sao chép URL `https://script.google.com/macros/s/…/exec` và dán vào ô Google Sheets. Mỗi lead được gửi dưới dạng một dòng JSON phẳng `{createdAt, site, page, …các trường form, utm_source, utm_campaign, ref}`. Cột mới tự được thêm vào hàng tiêu đề.

```js
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var row = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    var headers = sheet.getLastColumn()
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      : [];
    Object.keys(row).forEach(function (k) {
      if (headers.indexOf(k) === -1) headers.push(k);
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.appendRow(headers.map(function (h) {
      return row[h] === undefined ? '' : row[h];
    }));
    return ContentService.createTextOutput('ok');
  } finally {
    lock.releaseLock();
  }
}
```

> Apps Script trả về mã 302 (chuyển hướng tới kết quả). Hệ thống coi 2xx/3xx là gửi thành công và không theo chuyển hướng. Mỗi lần sửa mã cần *Quản lý triển khai* → tạo phiên bản mới để thay đổi có hiệu lực.

## Lưu trữ ảnh

Ảnh tải lên thư viện được lưu qua `src/storage.js`, có hai driver:

- **local** (mặc định, khi `S3_BUCKET` để trống): lưu trên đĩa tại `UPLOADS_DIR` và phục vụ qua `/uploads/<workspace>/<tệp>`.
- **s3**: khi đặt `S3_BUCKET`, ảnh được tải lên dịch vụ tương thích S3 (AWS S3, Cloudflare R2, MinIO, Viettel/VNPT/FPT Object Storage). Yêu cầu được ký bằng AWS Signature V4 (không cần AWS SDK); mỗi đối tượng có `Content-Type` đúng loại ảnh và `Cache-Control: public, max-age=31536000, immutable`.

| Biến | Ý nghĩa |
| --- | --- |
| `S3_BUCKET` | Tên bucket. Đặt biến này để bật driver s3 |
| `S3_ENDPOINT` | Endpoint của nhà cung cấp, vd `https://<account-id>.r2.cloudflarestorage.com`. Trống = AWS S3 theo `S3_REGION` |
| `S3_REGION` | Vùng ký request (mặc định `us-east-1`; R2 dùng `auto`) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Khóa truy cập, chỉ cần quyền `PutObject` và `DeleteObject` trên bucket |
| `S3_PUBLIC_URL` | URL công khai để trình duyệt tải ảnh (CDN, tên miền public của bucket). Trống = URL bucket trên endpoint |
| `S3_FORCE_PATH_STYLE` | `true` để dùng dạng `<endpoint>/<bucket>/<key>` (MinIO và nhiều nhà cung cấp trong nước) |

Lưu ý:

- Ảnh được đọc trực tiếp từ `S3_PUBLIC_URL` (hoặc bucket), nên bucket/CDN phải cho phép **đọc công khai** các đối tượng; ứng dụng không cấp quyền này.
- Khóa đối tượng giống đường dẫn cũ (`<workspace_id>/<tên ngẫu nhiên>.<đuôi>`). Khi chuyển từ local sang S3, hãy sao chép thư mục `UPLOADS_DIR` lên bucket (vd `aws s3 sync /data/uploads s3://<bucket>/`) để thư viện ảnh hiển thị đủ ảnh cũ. Các trang đã xuất bản vẫn dùng đường dẫn `/uploads/…` cũ, nên hãy giữ nguyên volume `UPLOADS_DIR`: ứng dụng vẫn phục vụ `/uploads` với mọi driver.
- Nếu dịch vụ lưu trữ lỗi, API trả về 502 và không ghi nhận ảnh (hoặc giữ ảnh trong thư viện khi xóa thất bại) để người dùng thử lại.

## Giám sát & vận hành

- **Log có cấu trúc:** mỗi dòng log là một đối tượng JSON (`LOG_FORMAT=json`, mặc định khi `NODE_ENV=production`) hoặc dạng dễ đọc (`LOG_FORMAT=pretty`). Mức log đặt bằng `LOG_LEVEL` (`debug` | `info` | `warn` | `error` | `silent`). Các trường nhạy cảm (`password`, `token`, `authorization`, `cookie`, `secret`, `apiKey`, `checksumKey`, `m2signature`…) và thông tin đăng nhập trong URL luôn bị che thành `[REDACTED]`.
- **Log truy cập:** mỗi request ghi một dòng gồm `reqId`, method, đường dẫn (**không** có query string; token trong đường dẫn bị che), route, status, `durationMs`, host, IP và `userId` nếu đã đăng nhập. `/healthz`, `/readyz`, `/metrics` và file tĩnh chỉ ghi ở mức `debug`.
- **Request ID:** header `X-Request-Id` hợp lệ (8–128 ký tự `A-Z a-z 0-9 . _ : -`) được giữ nguyên, nếu không hệ thống tự sinh UUID. Giá trị luôn được trả lại trong header phản hồi; lỗi 500 trả về `{ "error": "Lỗi máy chủ", "requestId": "…" }` để tra log.
- **Kiểm tra sức khỏe:** `GET /healthz` (tiến trình và DB đọc được, dùng cho healthcheck Docker) và `GET /readyz` (DB nhận được khóa ghi — không ghi dữ liệu).
- **Prometheus:** đặt `METRICS_TOKEN` để bật `GET /metrics`. Endpoint chỉ phục vụ trên host của `APP_URL` và yêu cầu `Authorization: Bearer <METRICS_TOKEN>`; khi chưa đặt token, hoặc trên host của khách (subdomain / tên miền riêng), request đi tiếp như đường dẫn bình thường (thường là 404, hoặc trang có slug `metrics` của khách). Các metric chính:
  - `http_requests_total{method,route,status_class}` và `http_request_duration_seconds` (histogram). `route` là mẫu route Express (vd `/api/sites/:sid/pages`) để giới hạn số chuỗi; file tĩnh là `static`, còn lại là `other`.
  - `process_uptime_seconds`, `process_resident_memory_bytes`, `process_cpu_seconds_total`, `nodejs_heap_used_bytes`, `nodejs_eventloop_lag_seconds{quantile}` (độ trễ event loop kể từ lần scrape trước).
  - Chỉ số kinh doanh (cache 15 giây): `hitechcloud_users`, `hitechcloud_workspaces`, `hitechcloud_workspaces_paid{plan}`, `hitechcloud_sites`, `hitechcloud_pages_published`, `hitechcloud_leads_today` (tính từ 00:00 UTC).
- **Cảnh báo lỗi:** đặt `ERROR_WEBHOOK_URL` (https, tương thích Slack incoming webhook và Discord webhook) để nhận cảnh báo khi có lỗi 5xx, promise bị từ chối không được xử lý hoặc exception không bắt được (sau khi gửi cảnh báo, tiến trình thoát và Docker tự khởi động lại). Mỗi loại lỗi (theo *fingerprint*: tên lỗi + thông điệp đã bỏ số + vị trí ném lỗi) gửi tối đa 1 lần/phút; số lần bị gộp được ghi trong cảnh báo kế tiếp.
- **Quyết định về Caddy:** `/metrics` không bị chặn ở Caddy vì ứng dụng tự từ chối trên host của khách (một trang của khách có thể có slug `metrics`) và trên host dashboard thì yêu cầu token. Muốn chặt hơn, bật đoạn giới hạn IP có sẵn (đang được comment) trong `deploy/Caddyfile`. Ví dụ cấu hình scrape ở cuối `docker-compose.yml`.

## Cấu hình cổng thanh toán

Cổng nào có đủ biến môi trường thì sẽ hiện trong tab **Gói dịch vụ**. Xem `.env.example`.

### payOS
1. Tạo kênh thanh toán tại https://my.payos.vn và lấy `Client ID`, `API Key`, `Checksum Key`.
2. Khai báo Webhook URL: `<APP_URL>/api/billing/webhooks/payos`. Khi payOS gửi sự kiện thử, hệ thống trả 200.
3. Luồng xử lý:
   - Tạo link bằng `POST /v2/payment-requests`.
   - Khách thanh toán xong, payOS gửi webhook. Hệ thống xác thực chữ ký rồi kích hoạt gói.
   - Khi khách quay về `returnUrl`, hệ thống gọi thêm `GET /v2/payment-requests/{orderCode}` để kiểm tra. Nhờ vậy gói vẫn được kích hoạt nếu webhook đến chậm.

### Pay2S
1. Lấy `partnerCode`, `accessKey`, `secretKey` từ trang quản trị Pay2S. Đặt `PAY2S_ENV=sandbox` để thử nghiệm, `production` khi chạy thật.
2. Hệ thống gửi `ipnUrl = <APP_URL>/api/billing/webhooks/pay2s` kèm mỗi giao dịch.
3. Luồng xử lý:
   - Tạo giao dịch bằng `POST /v1/gateway/api/create`.
   - Chữ ký là HMAC-SHA256 trên các trường theo thứ tự cố định.
   - IPN và URL chuyển hướng về đều được xác thực bằng `m2signature`. `resultCode = 0` nghĩa là thành công.

> ⚠️ Môi trường phát triển không truy cập được `payos.vn` và `docs.pay2s.vn` (bị chặn mạng). Vì vậy đặc tả được lấy từ mã nguồn SDK:
> - payOS: SDK chính thức `@payos/node`. Chữ ký đã được kiểm tra trùng khớp với SDK.
> - Pay2S: gói cộng đồng `pay2s-node`. Đây **không phải SDK chính thức**.
>
> Trước khi chạy production, cần **chạy thử trên sandbox Pay2S** để xác nhận tên trường URL thanh toán trả về (`payUrl`), mã thành công và nội dung phản hồi IPN mà Pay2S yêu cầu.

## Hướng dẫn bắt đầu & email vòng đời khách hàng

**Danh sách "Bắt đầu nhanh"** nằm đầu tab Website của dashboard, tính phía máy chủ (`GET /api/workspaces/:id/onboarding`) cho từng người dùng + workspace:

1. Xác minh email · 2. Tạo website đầu tiên · 3. Xuất bản trang · 4. Nhận lead đầu tiên (không tính lead `spam`) · 5. Kết nối thông báo lead: ít nhất một kênh được cấu hình rõ trong Cài đặt website (email nhận thêm, webhook, Telegram, Slack, Discord, Google Sheets; email mặc định gửi cho chủ sở hữu không tính) · 6. Gắn tên miền riêng (tùy chọn, gói Pro trở lên, tính khi tên miền đã xác minh).

Thẻ tự ẩn khi xong 5 bước bắt buộc. Bấm **Ẩn** để ẩn vĩnh viễn (lưu trong bảng `onboarding_dismissals` theo người dùng + workspace, `POST /api/workspaces/:id/onboarding/dismiss`).

**Email vòng đời** do tiến trình nền (`src/jobs.js`, chạy mỗi giờ) gửi; logic nằm trong `src/lifecycle.js`:

| Email | Loại | Khi nào |
|---|---|---|
| Chào mừng (3 mẹo bắt đầu + link `/app/`) | Giao dịch | Ngay sau khi đăng ký (lượt chạy hằng giờ gửi bù nếu bị lỡ trong 2 ngày). Tài khoản có trước bản cập nhật không nhận. |
| Nhắc kích hoạt | Mẹo & nhắc nhở | 3 ngày sau đăng ký, nếu các workspace người dùng sở hữu chưa có trang nào được xuất bản. Chỉ gửi **một lần**, cho tài khoản 3–10 ngày tuổi. |
| Tóm tắt lead hằng tuần | Tóm tắt lead | Sáng thứ Hai từ 08:00 giờ Việt Nam (UTC+7) cho chủ sở hữu và quản trị viên: lead tuần trước (thứ Hai–Chủ nhật) theo từng website, 3 nguồn lead hàng đầu (`utm_source` hoặc trang giới thiệu), tỷ lệ chuyển đổi so với tuần trước. Không tính lead `spam`; bỏ qua workspace không có lượt xem và lead. Mỗi workspace một lần/tuần (`workspaces.digest_week`). |

- Người dùng bật/tắt hai loại email marketing trong **Cài đặt → Email** (`GET/PUT /api/auth/email-preferences` `{digest, tips}`). Email giao dịch (chào mừng, xác minh, mật khẩu, thanh toán) luôn được gửi.
- Email marketing có link hủy nhận `GET /email/unsubscribe?token=…` (không cần đăng nhập) và header `List-Unsubscribe` / `List-Unsubscribe-Post` (hủy một chạm, RFC 8058). Token ký HMAC-SHA256 bằng khóa dẫn xuất từ `LEAD_SECRET`; sửa token hoặc tài khoản đã xóa → trang báo lỗi 400. Nên đặt `LEAD_SECRET` cố định ở production để link trong email cũ vẫn dùng được khi đổi khóa SMTP/thanh toán.
- Không bao giờ gửi cho tài khoản bị tạm ngưng (`users.suspended_at`) hoặc đã xóa.
- Lượt xem trang được thống kê theo ngày UTC, nên số lượt xem trong email tóm tắt lệch tối đa 7 giờ so với ranh giới tuần giờ Việt Nam (lead được tính chính xác theo giờ Việt Nam).

## Chất lượng lead & chống spam

Mỗi lần gửi form đi qua các bước sau (`src/leadGuard.js`):

1. **Honeypot + giới hạn tần suất** (10 lần/phút cho mỗi IP và website).
2. **Kiểm tra dữ liệu:** trường tên `phone`, `sdt`, `so_dien_thoai`, `dien_thoai`, `tel`, `mobile` hoặc `<input type="tel">` phải là số Việt Nam hợp lệ: di động 03/05/07/08/09 (10 số) hoặc cố định 02x (11 số). Chấp nhận `+84`, `84`, dấu cách, chấm, gạch ngang. Số được lưu thống nhất dạng `0xxxxxxxxx`. Trường `email` phải đúng cú pháp. Sai thì khách được đưa về trang cũ (`?lead_error=phone|email|expired`) kèm thông báo màu đỏ. Tắt kiểm tra SĐT bằng tùy chọn "Chỉ nhận số điện thoại Việt Nam hợp lệ".
3. **Dấu thời gian `_ts`:** mỗi form có trường ẩn ký HMAC bằng `LEAD_SECRET`. Gửi sớm hơn 2 giây hoặc chữ ký sai bị coi là spam; quá 24 giờ thì khách được yêu cầu gửi lại. Trang cũ không có `_ts` vẫn được nhận (điểm spam +1). Nếu không đặt `LEAD_SECRET`, khóa được dẫn xuất từ khóa bí mật sẵn có (payOS/Pay2S/SMTP) hoặc sinh ngẫu nhiên và lưu cạnh file database.
4. **Cloudflare Turnstile (tùy chọn):** nhập site key + secret key trong tab Cài đặt. Mọi form được thêm ô xác minh. Máy chủ kiểm tra `cf-turnstile-response` qua `siteverify`; thiếu/sai token hoặc Cloudflare không phản hồi thì **từ chối** (fail closed). Khai báo hostname của website (subdomain/tên miền riêng) trong Cloudflare; đường dẫn `/p/<subdomain>` trên dashboard chạy trong sandbox nên không dùng được Turnstile.
5. **Điểm spam:** nhiều link, từ khóa cờ bạc/quảng cáo, mọi trường giống nhau, dấu thời gian bất thường. Điểm ≥ 5 → lưu với trạng thái **Spam** (ẩn khỏi danh sách mặc định, xem bằng bộ lọc "Spam"), không gửi thông báo, không tính vào hạn mức lead/tháng. Khách vẫn thấy trang cảm ơn.
6. **Lead trùng:** cùng SĐT hoặc email trên cùng website trong `dedupeHours` giờ (mặc định 24, 0–168, 0 = tắt) → vẫn lưu, đánh dấu "Trùng #id", không gửi thông báo lại.

Điểm, cờ và lead gốc được lưu ở `leads.spam_score`, `leads.flags_json`, `leads.duplicate_of` và trả về trong API (`spamScore`, `flags`, `duplicateOf`).

## Kiểm thử E2E

Bộ test trình duyệt dùng [Playwright](https://playwright.dev) (`@playwright/test`, Chromium) nằm trong thư mục `e2e/`, tách khỏi `test/` để `npm test` không chạy nhầm.

```bash
npx playwright install --with-deps chromium   # lần đầu (máy đã có trình duyệt Playwright thì bỏ qua)
npm run e2e                                   # chạy toàn bộ
npm run e2e -- editor.spec.js                 # một file
npm run e2e -- --project=desktop-chrome --headed
npx playwright show-report                    # xem báo cáo HTML (playwright-report/)
```

- `e2e/start-server.js` khởi động chính ứng dụng trên một cổng trống với cơ sở dữ liệu và thư mục ảnh tạm (tự xóa khi kết thúc), `SUPERADMIN_EMAILS=root@e2e.test`, không cấu hình SMTP/cổng thanh toán/S3. Mọi output của server được ghi thêm vào `e2e/server.log`; test đọc email trong log (dòng `[mail] to=…`) để lấy liên kết xác minh email và đặt lại mật khẩu — tức là đi đúng luồng thật.
- Mỗi test giả lập một IP riêng qua `X-Forwarded-For` (server tin proxy loopback) để giới hạn tần suất đăng ký/đăng nhập không ảnh hưởng giữa các test.
- Hai project: `desktop-chrome` chạy tất cả; `mobile-chrome` (Pixel 5) chạy các test gắn thẻ `@mobile`.
- Các luồng được kiểm tra:
  - `auth.spec.js`: đăng ký → email xác minh → banner biến mất; đăng xuất, đăng nhập (sai/đúng mật khẩu); quên mật khẩu → email → đặt lại mật khẩu.
  - `editor.spec.js`: tạo website từ mẫu → mở trình thiết kế → sửa tiêu đề → lưu (“Đã lưu”) → tải ảnh qua Asset Manager → xuất bản → kiểm tra `/p/<tên-miền-phụ>`; tài khoản chưa xác minh không xuất bản được.
  - `leads.spec.js`: gửi form trên trang đã xuất bản kèm UTM → banner cảm ơn → lead hiện trong tab “Khách hàng tiềm năng” với nguồn → đổi trạng thái, lọc.
  - `billing.spec.js`: bảng giá, chặn tính năng Pro ở gói miễn phí, super-admin cấp gói Pro trong trang quản trị → tên miền riêng (hướng dẫn DNS) và A/B testing hoạt động. Thanh toán qua cổng thật không chạy ở đây (đã có test API với gateway giả trong `test/billing.test.js`).
  - `a11y.spec.js`: trang chủ, đăng nhập, đăng ký, quên mật khẩu, bảng điều khiển (kể cả tab Cài đặt) và từng tab của trang website ở 375px: không lỗi console, không cuộn ngang, mọi ô nhập liệu đang hiển thị đều có nhãn/`aria-label`, có `lang="vi"`.
- Trên CI (job `e2e` trong `.github/workflows/ci.yml`) test được chạy lại 1 lần nếu lỗi, lưu trace ở lần chạy lại và tải lên artifact `playwright-report` (kèm `test-results/`, `e2e/server.log`) khi thất bại.

## Kiến trúc

```
src/
  server.js          Khởi động server
  app.js             Ghép middleware, CSRF, phục vụ thư viện GrapesJS
  config.js          Biến môi trường
  db.js              Schema SQLite
  auth.js            Băm mật khẩu, session cookie
  access.js          Kiểm tra quyền và cách ly dữ liệu theo workspace
  plans.js           Định nghĩa gói, giới hạn, giá theo chu kỳ, hết hạn gói
  billing.js         Tạo đơn, xử lý webhook/return, kích hoạt và gia hạn gói
  payments/payos.js  Kết nối payOS (ký và xác thực HMAC-SHA256)
  payments/pay2s.js  Kết nối Pay2S (ký và xác thực m2signature)
  templates.js       Section và mẫu landing page
  render.js          Render HTML trang đã xuất bản, chuyển hướng form về endpoint thu lead
  leadGuard.js       Kiểm tra chất lượng lead: SĐT/email, điểm spam, dấu thời gian ký HMAC, lead trùng, Turnstile
  routes/api.js      REST API cho dashboard và editor
  routes/sites.js    Phục vụ trang đã xuất bản (theo host hoặc /p/), xem trước, thu lead, sitemap, TLS ask
  routes/account.js  Quên mật khẩu, lời mời, đổi mật khẩu, xác minh email, xuất/xóa dữ liệu cá nhân
  routes/content.js  Thư viện ảnh, lịch sử phiên bản, nhân bản trang
  storage.js         Lưu ảnh tải lên: đĩa cục bộ hoặc S3-compatible (ký AWS SigV4)
  safety.js          Chấm điểm rủi ro lừa đảo, tạm ngưng website / tài khoản
  routes/safety.js   Form báo cáo vi phạm /_htc/report, API quản trị an toàn nội dung
  routes/abtests.js  A/B testing (chia lưu lượng, thống kê, chọn phiên bản thắng)
  http.js, usage.js  Tiện ích dùng chung (bọc handler, đếm mức sử dụng)
  siteSettings.js    Cài đặt tích hợp marketing và thông báo theo từng website
  notify.js          Gửi thông báo lead (email / webhook / Telegram / Slack / Discord / Google Sheets)
  domains.js         Xác minh tên miền riêng bằng DNS
  jobs.js            Nhắc gia hạn, dọn session và token hết hạn
  mailer.js          Gửi email qua SMTP
  logger.js          Log JSON có cấu trúc, che dữ liệu nhạy cảm, request ID + log truy cập
  metrics.js         Metric Prometheus (/metrics)
  errors.js          Gửi cảnh báo lỗi qua webhook (giới hạn 1 lần/phút mỗi loại lỗi)
public/
  index.html         Trang giới thiệu sản phẩm (SEO, Open Graph, JSON-LD, bảng giá lấy từ /api/plans)
  terms.html, privacy.html, refund.html, contact.html, 404.html
                     Điều khoản, chính sách bảo mật, thanh toán & hoàn tiền, liên hệ, trang 404
  robots.txt, sitemap.xml  SEO cho trang giới thiệu của nền tảng
  app/               Dashboard (đăng nhập, workspace, website, lead, thanh toán), admin.html
  editor.html        Trình thiết kế GrapesJS
test/                Test API bằng node:test
```

### API chính

| Method | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | Xác thực |
| GET | `/api/auth/me` | Người dùng và danh sách workspace |
| GET/PATCH/DELETE | `/api/workspaces/:id` | Workspace, gói, mức sử dụng |
| GET/POST/DELETE | `/api/workspaces/:id/members[/:uid]` | Thành viên |
| POST | `/api/workspaces/:id/checkout` | Tạo đơn thanh toán `{plan, months, provider, coupon?}`, trả về `checkoutUrl` (đơn giảm 100% trả về `paid: true`) |
| POST | `/api/workspaces/:id/coupon/preview` | Xem giá với mã giảm giá `{coupon, plan, months}` → `{valid, listAmount, discount, amount, message}` |
| GET | `/api/workspaces/:id/orders` | Lịch sử thanh toán |
| POST | `/api/billing/webhooks/payos`, `/api/billing/webhooks/pay2s` | Webhook / IPN từ cổng thanh toán |
| GET | `/api/admin/stats`, `/api/admin/workspaces`, `/api/admin/orders` | Quản trị nền tảng |
| POST | `/api/workspaces/:id/plan` | Cấp gói thủ công `{plan, months?}` (chỉ super admin) |
| GET/POST | `/api/admin/coupons` | Danh sách (kèm lượt dùng) và tạo mã giảm giá `{code, percent_off \| amount_off_vnd, applies_to_plans?, applies_to_months?, max_redemptions?, expires_at?, note?}` (chỉ super admin) |
| PATCH | `/api/admin/coupons/:id` | Bật/tắt, sửa ghi chú, hạn dùng, giới hạn lượt, gói/chu kỳ áp dụng (chỉ super admin) |
| GET/POST | `/api/workspaces/:id/sites` | Website |
| GET/PATCH/DELETE | `/api/sites/:id` | Website, tên miền riêng |
| GET/POST | `/api/sites/:id/pages` | Trang |
| GET/PUT | `/api/pages/:id/project` | Lưu và tải dự án GrapesJS |
| POST | `/api/pages/:id/publish`, `/unpublish` | Xuất bản |
| GET / PATCH | `/api/sites/:id/leads[?status=&q=&from=&to=&format=csv]`, `/api/leads/:id` | Lead: lọc (mặc định ẩn `spam`), xuất CSV, cập nhật trạng thái và ghi chú |
| PATCH | `/api/sites/:id/settings` | Tích hợp marketing và thông báo |
| POST | `/api/sites/:id/verify-domain` | Xác minh tên miền riêng |
| GET/POST/DELETE | `/api/workspaces/:id/assets`, `/api/assets/:id` | Thư viện ảnh (body là ảnh thô, `Content-Type: image/*`) |
| GET/POST | `/api/pages/:id/versions[/:vid/restore]`, `/api/pages/:id/duplicate` | Lịch sử phiên bản, nhân bản trang |
| GET/POST | `/api/sites/:id/ab-tests`, `/api/ab-tests/:id/stop` | A/B testing |
| GET/POST | `/api/workspaces/:id/api-keys` | Danh sách / tạo API key `{name}` (chủ sở hữu, quản trị viên; gói Pro trở lên) |
| DELETE | `/api/api-keys/:id` | Thu hồi API key |
| GET | `/api/v1/sites`, `/api/v1/sites/:id/pages` | API công khai (Bearer API key): website và trang |
| GET | `/api/v1/sites/:id/leads[?since=&status=&limit=&cursor=]` | API công khai: lead mới nhất trước, phân trang bằng `cursor` |
| PATCH | `/api/v1/leads/:id` | API công khai: cập nhật `{status, note}` của lead |
| POST | `/api/v1/pages/:id/publish` | API công khai: xuất bản trang |
| GET | `/api/sites/:id/analytics?days=7\|30\|90` | Thống kê: chuỗi theo ngày, tổng và so sánh kỳ trước, theo trang, nguồn, trạng thái |
| GET/POST | `/api/auth/verify?token=`, `/api/auth/resend-verification` | Xác minh email (link trong email, gửi lại) |
| GET/POST | `/api/auth/export`, `/api/auth/delete-account` | Tải dữ liệu cá nhân, xóa tài khoản `{password, confirm: "XOA TAI KHOAN"}` |
| POST | `/api/workspaces/:id/transfer` | Chuyển quyền sở hữu `{userId}` (chỉ chủ sở hữu) |
| GET/POST | `/api/workspaces/:id/onboarding`, `/onboarding/dismiss` | Danh sách bắt đầu nhanh `{steps: [{id, done, optional}], completed, total, allDone, dismissed, visible}`, ẩn danh sách |
| GET/PUT | `/api/auth/email-preferences` | Tùy chọn email marketing `{digest, tips}` |
| GET/POST | `/email/unsubscribe?token=` | Hủy nhận email marketing (link ký HMAC, không cần đăng nhập) |

## API công khai

API REST `/api/v1` dành cho Zapier, Make, n8n, CRM… (gói Pro trở lên). Tạo API key ở dashboard → **Cài đặt** → **API keys** (chỉ chủ sở hữu và quản trị viên). Key có dạng `htc_live_…` và chỉ hiển thị **một lần** khi tạo; hệ thống chỉ lưu mã băm SHA-256, sau đó chỉ hiển thị phần đầu (`htc_live_xxxx…`) để nhận diện. Key bị thu hồi hoặc workspace hết gói trả phí sẽ bị từ chối ngay.

- Xác thực: header `Authorization: Bearer <API key>` (không dùng cookie). Mọi dữ liệu được giới hạn trong workspace sở hữu key.
- Giới hạn: 120 yêu cầu/phút cho mỗi key (vượt quá trả `429` kèm `Retry-After`).
- Lỗi trả về JSON `{"error": "..."}`: `400` dữ liệu không hợp lệ, `401` thiếu/sai/đã thu hồi key, `402` gói không hỗ trợ API, `404` không tìm thấy hoặc thuộc workspace khác, `429` vượt giới hạn.
- Danh sách trả về dạng `{"data": [...]}`. Lead có dạng `{id, page, data, source, status, note, createdAt}`; trạng thái hợp lệ: `new`, `contacted`, `qualified`, `won`, `lost`.

```bash
export HTC_KEY=htc_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export HTC_URL=https://app.example.vn

# Danh sách website và trang
curl -H "Authorization: Bearer $HTC_KEY" $HTC_URL/api/v1/sites
curl -H "Authorization: Bearer $HTC_KEY" $HTC_URL/api/v1/sites/1/pages

# Lead mới từ một thời điểm (mới nhất trước, tối đa 500 mỗi lần; dùng nextCursor để lấy trang tiếp)
curl -H "Authorization: Bearer $HTC_KEY" "$HTC_URL/api/v1/sites/1/leads?since=2026-10-01T00:00:00Z&status=new&limit=100"
curl -H "Authorization: Bearer $HTC_KEY" "$HTC_URL/api/v1/sites/1/leads?limit=100&cursor=42"

# Cập nhật trạng thái và ghi chú của lead
curl -X PATCH -H "Authorization: Bearer $HTC_KEY" -H "Content-Type: application/json" \
  -d '{"status":"contacted","note":"Đã gọi lúc 10h"}' $HTC_URL/api/v1/leads/42

# Xuất bản trang
curl -X POST -H "Authorization: Bearer $HTC_KEY" $HTC_URL/api/v1/pages/7/publish
```

## Quyền dữ liệu cá nhân (Nghị định 13/2023)

Hỗ trợ các quyền của chủ thể dữ liệu theo Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân. Người dùng thao tác trong **Cài đặt** của dashboard:

- **Xác minh email:** khi đăng ký, hệ thống gửi một liên kết dùng một lần, hiệu lực 24 giờ (token chỉ lưu dạng băm SHA-256). Chưa xác minh vẫn dùng được ứng dụng nhưng không xuất bản trang và không thanh toán được. Có thể gửi lại email, tối đa 3 lần/giờ. Nhận lời mời qua email cũng được tính là đã xác minh. Tài khoản tạo trước khi có tính năng này được coi là đã xác minh.
- **Tải dữ liệu của tôi:** tệp JSON gồm hồ sơ, danh sách workspace tham gia và vai trò. Với workspace bạn sở hữu, tệp có thêm website, trang (HTML/CSS), lead và đơn hàng. Tệp không chứa mật khẩu băm, token, khóa tích hợp (như Telegram bot token) hay thông tin của thành viên khác.
- **Xóa tài khoản:** cần nhập mật khẩu và gõ `XOA TAI KHOAN`. Hệ thống xóa vĩnh viễn tài khoản, session và các workspace bạn sở hữu (kèm website, trang, lead, đơn hàng), sau đó gửi email xác nhận. Nếu bạn còn sở hữu workspace có thành viên khác thì phải chuyển quyền sở hữu hoặc xóa các thành viên trước.
- **Chuyển quyền sở hữu:** chủ sở hữu chuyển workspace cho một quản trị viên hoặc biên tập viên hiện có (tab **Thành viên**). Chủ sở hữu cũ trở thành quản trị viên.

## Trang pháp lý và thông tin cần điền trước khi công bố

Cổng thanh toán (payOS, Pay2S) yêu cầu website có đủ thông tin doanh nghiệp và chính sách. Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân cũng yêu cầu điều này. Các trang sau đã có sẵn:

| Đường dẫn | Nội dung |
|---|---|
| `/terms` | Điều khoản sử dụng |
| `/privacy` | Chính sách bảo mật và bảo vệ dữ liệu cá nhân: dữ liệu thu thập, mục đích, cơ sở pháp lý, bên xử lý, chuyển dữ liệu ra nước ngoài, thời gian lưu trữ, quyền của chủ thể dữ liệu, thông báo vi phạm |
| `/refund` | Chính sách thanh toán, gia hạn và hoàn tiền |
| `/contact` | Thông tin liên hệ và thông tin doanh nghiệp |
| `/404.html` | Trang lỗi 404. Server trả trang này cho mọi yêu cầu GET trình duyệt không khớp đường dẫn nào trên tên miền dashboard |

Trang đăng ký có ô bắt buộc "Tôi đồng ý với Điều khoản sử dụng và Chính sách bảo mật". Ô này chỉ được kiểm tra ở trình duyệt, API đăng ký không thay đổi.

> ⚠️ Các trang pháp lý là **bản mẫu** và đều có dòng thông báo "Bản mẫu — cần được luật sư rà soát trước khi công bố". Khi luật sư đã duyệt, xóa khối `<div class="legal-notice">` trong từng trang. Luật sư cũng cần đối chiếu với Luật Bảo vệ dữ liệu cá nhân và các văn bản hướng dẫn đang có hiệu lực.

Những chỗ cần thay đều được đánh dấu `[...]` và tô vàng trên trang. Tìm bằng lệnh `grep -rn "\[" public/*.html`:

- Thông tin doanh nghiệp (chân trang, `/terms`, `/privacy`, `/refund`, `/contact`, JSON-LD trên trang chủ): `[Mã số thuế]`, `[Ngày cấp]`, `[Nơi cấp]`, `[Địa chỉ trụ sở]`, `[Số điện thoại]`, `[Người đại diện theo pháp luật]`, `[Giờ làm việc…]`.
- Pháp lý chung: `[Ngày hiệu lực]`. Trong `/terms` có thêm thời hạn báo trước khi đổi điều khoản `[15]` và nơi giải quyết tranh chấp `[Tỉnh/Thành phố]`.
- Bảo vệ dữ liệu cá nhân (`/privacy`):
  - Người phụ trách: `[Họ tên người phụ trách bảo vệ dữ liệu cá nhân]`.
  - Nơi đặt máy chủ: `[Vị trí máy chủ…]`.
  - Bên xử lý: `[Nhà cung cấp dịch vụ email/SMTP]`, `[Nhà cung cấp SMS – nếu sử dụng]`, `[Nhà cung cấp lưu trữ đối tượng – nếu sử dụng]`, `[Nhà cung cấp hạ tầng máy chủ / trung tâm dữ liệu]`.
  - Thời hạn lưu trữ: `[30]` và `[90]` ngày.
- Thanh toán (`/refund`, bảng giá trên trang chủ):
  - VAT: `[Giá đã/chưa bao gồm VAT]`.
  - Các mốc thời gian: `[2 giờ]`, `[3]`, `[7]`, `[24 giờ]`, `[1]`, `[5]`.
  - Thời hạn xuất hóa đơn: `[Thời hạn nhận yêu cầu xuất hóa đơn]`.
- Tên miền: thay `https://hitechcloud.vn` bằng tên miền thật. Cần thay ở thẻ canonical và Open Graph của các trang, JSON-LD trên trang chủ, `robots.txt` và `sitemap.xml`. Trang chủ chưa có `og:image`, có thể thêm khi đã có ảnh.
- JSON-LD trên trang chủ ghi giá cố định (0–599.000đ). Khi sửa `src/plans.js`, cần cập nhật theo.

## An toàn nội dung

Trang lừa đảo / giả mạo (đặc biệt là giả mạo ngân hàng, ví điện tử) là rủi ro lạm dụng lớn nhất của dịch vụ lưu trữ landing page. Hệ thống có ba lớp:

**1. Báo cáo vi phạm.** Bất kỳ ai cũng gửi được báo cáo tại `/_htc/report` trên **mọi tên miền** đang phục vụ trang (đường dẫn `/p/…`, `<subdomain>.<PUBLISH_ROOT_DOMAIN>`, tên miền riêng), không cần đăng nhập. Nhãn “Tạo bởi HiTechCloud” của gói Miễn phí có thêm liên kết nhỏ “Báo cáo vi phạm”; với gói trả phí (không có nhãn), quy ước đường dẫn `/_htc/report` được nêu trong điều khoản sử dụng. Trên tên miền của khách, website được nhận diện theo tên miền; ở nơi khác người báo cáo nhập đường dẫn trang. Lý do: *Lừa đảo / giả mạo*, *Nội dung độc hại*, *Vi phạm bản quyền*, *Spam*, *Khác*, kèm mô tả và email liên hệ (không bắt buộc). Chống spam bằng honeypot và giới hạn 5 báo cáo/giờ cho mỗi IP. Trang báo cáo không có script và được phục vụ với `CSP: sandbox allow-forms`. Mỗi báo cáo mới được email tới các địa chỉ `SUPERADMIN_EMAILS`.

**2. Tự động chấm điểm khi xuất bản.** Mỗi lần xuất bản (dashboard hoặc API `/api/v1`), HTML của trang được chấm điểm theo các dấu hiệu (heuristic thận trọng, xem `src/safety.js`):

| Dấu hiệu | Điểm |
|---|---|
| Ô nhập mật khẩu (`type="password"`) | 30 |
| Ô số thẻ / CVV-CVC / OTP / PIN (theo `name`, `id`, `placeholder`, `autocomplete`) | 30 / 30 / 25 / 20 |
| Cụm từ lừa đảo thường gặp: “đăng nhập ngân hàng”, “xác minh tài khoản”, “tài khoản bị tạm khóa”, “nhập mã OTP”… (có hoặc không dấu) | 15 mỗi cụm, tối đa 30 |
| Tên ngân hàng / ví điện tử (Vietcombank, BIDV, MB Bank, MoMo, ZaloPay…) trong tiêu đề / trong nội dung | 20 / 10 |
| Form có `action` gốc trỏ ra máy chủ bên ngoài | 20 |
| Mã gửi dữ liệu tới `api.telegram.org/bot…` | 40 |

- Điểm từ **45** trở lên: trang vào hàng đợi xem xét của quản trị viên. Việc xuất bản **không bị chặn**; người dùng không được biết điểm hay lý do.
- Điểm từ **60** trở lên **và** có cả ô mật khẩu lẫn tên ngân hàng/ví điện tử: trang vẫn được xuất bản nhưng website bị **tạm ngưng tự động** chờ xem xét. Chủ sở hữu và quản trị nền tảng nhận email. Tắt bằng `SAFETY_AUTO_SUSPEND=0` (khi đó chỉ gắn cờ).
- Quản trị viên **bỏ qua** cảnh báo (nhầm lẫn) thì tạm ngưng tự động được gỡ và nội dung y hệt sẽ không bị gắn cờ lại khi xuất bản lần sau.
- Mẫu trang có sẵn không bị gắn cờ (có test).

**3. Tạm ngưng.** Quản trị nền tảng tạm ngưng / gỡ tạm ngưng website hoặc tài khoản kèm lý do; chủ sở hữu (hoặc người dùng) nhận email.

- Website bị tạm ngưng: mọi URL (đường dẫn `/p/`, tên miền con, tên miền riêng, `sitemap.xml`, `robots.txt`) trả **451** “Trang đã bị tạm ngưng do vi phạm điều khoản”; không được cấp chứng chỉ HTTPS mới (`/_htc/tls-ask` trả 404); form không nhận lead; không xuất bản được (403). Dashboard hiện thông báo đỏ ở trang website. Tạm ngưng website cũng đóng các cảnh báo và báo cáo đang mở của website đó.
- Tài khoản bị tạm ngưng: mọi session bị xóa và bị từ chối, đăng nhập trả 403. Không thể tạm ngưng tài khoản quản trị nền tảng.

Giao diện: `/app/admin` → tab **An toàn nội dung** (trang bị gắn cờ kèm điểm và dấu hiệu, xem trước an toàn không chạy script, báo cáo đang mở / đã xử lý, danh sách đang tạm ngưng).

| Method | Đường dẫn | Mô tả |
|---|---|---|
| GET/POST | `/_htc/report[?site=&page=]` | Form báo cáo vi phạm công khai (urlencoded: `reason`, `details`, `email`, `url`) |
| GET | `/api/admin/safety/flags?status=open\|dismissed\|actioned` | Trang bị gắn cờ |
| POST | `/api/admin/safety/flags/:id/dismiss` | Bỏ qua cảnh báo (gỡ tạm ngưng tự động nếu có) |
| GET | `/api/admin/safety/reports?status=open\|resolved` | Báo cáo vi phạm |
| POST | `/api/admin/safety/reports/:id/resolve` | Đánh dấu đã xử lý `{note?}` |
| GET | `/api/admin/safety/pages/:id/preview` | Xem trước trang (CSP sandbox, không script, không form) |
| GET | `/api/admin/safety/suspended` | Website và tài khoản đang tạm ngưng |
| POST | `/api/admin/sites/:id/suspend`, `/unsuspend` | Tạm ngưng `{reason}` / gỡ tạm ngưng website |
| POST | `/api/admin/users/:id/suspend`, `/unsuspend` | Tạm ngưng `{reason}` / gỡ tạm ngưng tài khoản |

## Lộ trình tiếp theo

- Xuất hóa đơn VAT điện tử sau khi thanh toán.
- Lưu ảnh lên S3-compatible storage (hiện lưu trên đĩa, trong volume `/data`).
- Gửi thông báo lead qua Zalo OA.
- Chuyển sang PostgreSQL khi mở rộng nhiều instance.

## Giấy phép mã nguồn bên thứ ba

Xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
