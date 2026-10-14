# HiTechCloud LandingPage

Nền tảng **SaaS tạo landing page kéo thả** cho doanh nghiệp Việt Nam, do HiTechCloud-VN / Pho Tue SoftWare Solutions JSC phát triển.

Lõi trình thiết kế dùng [GrapesJS](https://github.com/GrapesJS/grapesjs). Kiến trúc SaaS (workspace, xuất bản, tên miền, thu lead) được thiết kế tham khảo ý tưởng từ [Webstudio](https://github.com/webstudio-is/webstudio) và [OpenPage](https://github.com/buildingopen/openpage), nhưng **không sao chép mã nguồn** của hai dự án này. Lý do xem mục [Giấy phép](#giấy-phép-mã-nguồn-bên-thứ-ba).

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| Trình thiết kế | Kéo thả trên GrapesJS, xem trước theo máy tính / tablet / điện thoại, tự động lưu, phím tắt Ctrl+S. Có 14 section dựng sẵn: Hero, Tính năng, Con số, Quy trình, Bảng giá, Đánh giá, FAQ, Video YouTube, Đếm ngược ưu đãi, Form thu lead, CTA, nút gọi/Zalo/Messenger nổi… |
| Mẫu khởi đầu | 9 mẫu theo ngành, mỗi mẫu có bảng màu riêng: Trang trắng, Sản phẩm SaaS, Thu lead nhanh, Sự kiện/Webinar, Spa/Thẩm mỹ, Bất động sản, Khóa học, Nhà hàng/F&B, Bán sản phẩm (COD) |
| Xuất bản | Tách bản nháp và bản đã xuất bản, gỡ xuất bản, xem trước bản nháp, cài SEO (title, meta description, OG) |
| Tên miền | `/p/<subdomain>`, `<subdomain>.<PUBLISH_ROOT_DOMAIN>`, tên miền riêng (gói Pro trở lên) |
| Thu lead & CRM | Mọi `<form>` trên trang đã xuất bản tự gửi về hệ thống. Tự ghi nhận nguồn khách (UTM, referrer). Có trạng thái (Mới → Đã liên hệ → Tiềm năng → Thành công/Thất bại), ghi chú, bộ lọc theo trạng thái / từ khóa / ngày. Chống spam (honeypot + giới hạn tần suất). Xuất CSV theo bộ lọc (chống CSV injection) |
| A/B testing | Chia lưu lượng giữa trang gốc và trang biến thể theo tỉ lệ tùy chọn, mỗi khách luôn thấy cùng một phiên bản. Thống kê lượt xem, lead, tỉ lệ chuyển đổi và độ tin cậy (z-test) của từng phiên bản. Chọn phiên bản thắng để thay vào URL gốc (gói Pro trở lên) |
| Nhiều người thuê | Nhiều workspace cho mỗi người dùng, vai trò Chủ sở hữu / Quản trị viên / Biên tập viên, dữ liệu cách ly theo workspace |
| Gói dịch vụ | Miễn phí / Pro / Business, giới hạn số website, trang, thành viên, lead/tháng, tên miền riêng, gỡ nhãn "Tạo bởi HiTechCloud" |
| Thanh toán | **payOS** (VietQR) và **Pay2S**. Thanh toán theo chu kỳ 1 tháng hoặc 12 tháng (tặng 2 tháng). Gói tự hết hạn và quay về gói Miễn phí. Gia hạn được cộng dồn vào thời gian còn lại. Webhook xác thực chữ ký HMAC, xử lý trùng lặp an toàn (idempotent) và đối chiếu số tiền |
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
  - `a11y.spec.js`: trang chủ, đăng nhập, đăng ký, quên mật khẩu, bảng điều khiển ở 375px: không lỗi console, không cuộn ngang, mọi ô nhập liệu đang hiển thị đều có nhãn/`aria-label`, có `lang="vi"`.
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
  routes/api.js      REST API cho dashboard và editor
  routes/sites.js    Phục vụ trang đã xuất bản (theo host hoặc /p/), xem trước, thu lead, sitemap, TLS ask
  routes/account.js  Quên mật khẩu, lời mời, đổi mật khẩu, xác minh email, xuất/xóa dữ liệu cá nhân
  routes/content.js  Thư viện ảnh, lịch sử phiên bản, nhân bản trang
  storage.js         Lưu ảnh tải lên: đĩa cục bộ hoặc S3-compatible (ký AWS SigV4)
  routes/abtests.js  A/B testing (chia lưu lượng, thống kê, chọn phiên bản thắng)
  http.js, usage.js  Tiện ích dùng chung (bọc handler, đếm mức sử dụng)
  siteSettings.js    Cài đặt tích hợp marketing và thông báo theo từng website
  notify.js          Gửi thông báo lead (email / webhook / Telegram / Slack / Discord / Google Sheets)
  domains.js         Xác minh tên miền riêng bằng DNS
  jobs.js            Nhắc gia hạn, dọn session và token hết hạn
  mailer.js          Gửi email qua SMTP
public/
  index.html         Trang giới thiệu sản phẩm
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
| POST | `/api/workspaces/:id/checkout` | Tạo đơn thanh toán `{plan, months, provider}`, trả về `checkoutUrl` |
| GET | `/api/workspaces/:id/orders` | Lịch sử thanh toán |
| POST | `/api/billing/webhooks/payos`, `/api/billing/webhooks/pay2s` | Webhook / IPN từ cổng thanh toán |
| GET | `/api/admin/stats`, `/api/admin/workspaces`, `/api/admin/orders` | Quản trị nền tảng |
| POST | `/api/workspaces/:id/plan` | Cấp gói thủ công `{plan, months?}` (chỉ super admin) |
| GET/POST | `/api/workspaces/:id/sites` | Website |
| GET/PATCH/DELETE | `/api/sites/:id` | Website, tên miền riêng |
| GET/POST | `/api/sites/:id/pages` | Trang |
| GET/PUT | `/api/pages/:id/project` | Lưu và tải dự án GrapesJS |
| POST | `/api/pages/:id/publish`, `/unpublish` | Xuất bản |
| GET / PATCH | `/api/sites/:id/leads[?status=&q=&from=&to=&format=csv]`, `/api/leads/:id` | Lead: lọc, xuất CSV, cập nhật trạng thái và ghi chú |
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

## Lộ trình tiếp theo

- Xuất hóa đơn VAT điện tử sau khi thanh toán.
- Lưu ảnh lên S3-compatible storage (hiện lưu trên đĩa, trong volume `/data`).
- Gửi thông báo lead qua Zalo OA.
- Chuyển sang PostgreSQL khi mở rộng nhiều instance.

## Giấy phép mã nguồn bên thứ ba

Xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
