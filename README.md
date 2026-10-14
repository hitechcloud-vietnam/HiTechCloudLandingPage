# HiTechCloud LandingPage

Nền tảng **SaaS tạo landing page kéo thả** cho doanh nghiệp Việt Nam, do HiTechCloud-VN / Pho Tue SoftWare Solutions JSC phát triển.

Lõi trình thiết kế dùng [GrapesJS](https://github.com/GrapesJS/grapesjs). Kiến trúc SaaS (workspace, xuất bản, tên miền, thu lead) được thiết kế tham khảo ý tưởng từ [Webstudio](https://github.com/webstudio-is/webstudio) và [OpenPage](https://github.com/buildingopen/openpage), nhưng **không sao chép mã nguồn** của hai dự án này. Lý do xem mục [Giấy phép](#giấy-phép-mã-nguồn-bên-thứ-ba).

## Tính năng

| Nhóm | Chi tiết |
|---|---|
| Trình thiết kế | Kéo thả trên GrapesJS, xem trước theo máy tính / tablet / điện thoại, 8 section dựng sẵn (Hero, Tính năng, Bảng giá, Đánh giá, Form thu lead, CTA…), tự động lưu, phím tắt Ctrl+S |
| Mẫu khởi đầu | Trang trắng, Sản phẩm SaaS, Thu lead nhanh, Sự kiện/Webinar |
| Xuất bản | Tách bản nháp và bản đã xuất bản, gỡ xuất bản, xem trước bản nháp, cài SEO (title, meta description, OG) |
| Tên miền | `/p/<subdomain>`, `<subdomain>.<PUBLISH_ROOT_DOMAIN>`, tên miền riêng (gói Pro trở lên) |
| Thu lead | Mọi `<form>` trên trang đã xuất bản tự gửi về hệ thống. Có chống spam (honeypot + giới hạn tần suất), xuất CSV (chống CSV injection) |
| Nhiều người thuê | Nhiều workspace cho mỗi người dùng, vai trò Chủ sở hữu / Quản trị viên / Biên tập viên, dữ liệu cách ly theo workspace |
| Gói dịch vụ | Miễn phí / Pro / Business, giới hạn số website, trang, thành viên, lead/tháng, tên miền riêng, gỡ nhãn "Tạo bởi HiTechCloud" |
| Bảo mật | Mật khẩu băm scrypt, session lưu trong DB (cookie httpOnly, SameSite=Lax), chống CSRF (kiểm tra Origin và bắt buộc body JSON), trang khách hàng phục vụ trên domain dashboard được cô lập bằng `CSP: sandbox` |

## Chạy thử

Yêu cầu Node.js 22.13 trở lên (dùng SQLite tích hợp sẵn `node:sqlite`, không cần cài database).

```bash
npm install
npm start            # http://localhost:3000
npm test             # chạy bộ test API
```

Bắt đầu tại `http://localhost:3000/app/signup`.

### Docker

```bash
docker build -t hitechcloud-landingpage .
docker run -p 3000:3000 -v htc-data:/data --env-file .env hitechcloud-landingpage
```

Các biến cấu hình nằm trong `.env.example`.

## Triển khai production

1. Dashboard đặt tại `APP_URL`, ví dụ `https://app.hitechcloud.vn`.
2. Trỏ wildcard DNS `*.hitechcloud.site` về máy chủ và đặt `PUBLISH_ROOT_DOMAIN=hitechcloud.site`. Nên dùng **tên miền gốc khác** với dashboard để cô lập cookie.
3. Tên miền riêng của khách hàng: khách trỏ CNAME về máy chủ. Reverse proxy (Caddy với *on-demand TLS*, hoặc Traefik) cấp chứng chỉ HTTPS tự động.
4. Đặt `SUPERADMIN_EMAILS` để quản trị viên nền tảng đổi gói cho khách.

## Kiến trúc

```
src/
  server.js          Khởi động server
  app.js             Ghép middleware, CSRF, phục vụ thư viện GrapesJS
  config.js          Biến môi trường
  db.js              Schema SQLite
  auth.js            Băm mật khẩu, session cookie
  access.js          Kiểm tra quyền và cách ly dữ liệu theo workspace
  plans.js           Định nghĩa gói và giới hạn
  templates.js       Section và mẫu landing page
  render.js          Render HTML trang đã xuất bản, chuyển hướng form về endpoint thu lead
  routes/api.js      REST API cho dashboard và editor
  routes/sites.js    Phục vụ trang đã xuất bản (theo host hoặc /p/), xem trước, thu lead
public/
  index.html         Trang giới thiệu sản phẩm
  app/               Dashboard (đăng nhập, workspace, website, lead)
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
| POST | `/api/workspaces/:id/plan` | Đổi gói (chỉ super admin) |
| GET/POST | `/api/workspaces/:id/sites` | Website |
| GET/PATCH/DELETE | `/api/sites/:id` | Website, tên miền riêng |
| GET/POST | `/api/sites/:id/pages` | Trang |
| GET/PUT | `/api/pages/:id/project` | Lưu và tải dự án GrapesJS |
| POST | `/api/pages/:id/publish`, `/unpublish` | Xuất bản |
| GET | `/api/sites/:id/leads[?format=csv]` | Lead |

## Lộ trình tiếp theo

- Tích hợp thanh toán (VNPay / MoMo / Stripe) cho trang nâng cấp gói. Hiện chỉ super admin đổi được gói.
- Thư viện ảnh / upload asset lên S3-compatible storage.
- Xác minh quyền sở hữu tên miền riêng (TXT record) trước khi kích hoạt.
- Gửi email / webhook / Zalo khi có lead mới. Mời thành viên qua email.
- Chuyển sang PostgreSQL khi mở rộng nhiều instance.
- A/B testing, thống kê lượt xem và tỉ lệ chuyển đổi.

## Giấy phép mã nguồn bên thứ ba

Xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
