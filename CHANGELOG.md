# Changelog

Các thay đổi đáng chú ý của HiTechCloud LandingPage. Phiên bản theo [SemVer](https://semver.org/lang/vi/).

## [v1.0.0] - 2026-10-14

Bản phát hành đầu tiên.

### Trình thiết kế và xuất bản
- Trình thiết kế kéo thả GrapesJS, 9 mẫu trang, 17 khối nội dung, thư viện ảnh, lịch sử phiên bản, nhân bản trang.
- Xuất bản trên tên miền con `<subdomain>.<PUBLISH_ROOT_DOMAIN>` và tên miền riêng (xác minh TXT), HTTPS tự động qua Caddy on-demand TLS.
- SEO (tiêu đề, mô tả, Open Graph, sitemap, robots), chèn mã tùy chỉnh (Pro), favicon, GA4/GTM/Facebook Pixel/TikTok Pixel.
- Widget chuyển đổi: popup, thanh dính, social proof, đếm ngược. A/B testing có thống kê độ tin cậy.

### Lead và CRM
- Mọi form trên trang tự gửi lead về hệ thống, ghi nhận UTM/referrer; trạng thái, ghi chú, lọc, xuất CSV.
- Chống spam: honeypot, giới hạn tần suất, dấu thời gian ký HMAC, chấm điểm spam, Cloudflare Turnstile, đánh dấu lead trùng, kiểm tra số điện thoại Việt Nam.
- Thông báo lead: email, webhook ký HMAC, Telegram, Slack, Discord, Google Sheets, Zalo OA.

### SaaS
- Workspace nhiều thành viên (owner/admin/editor), lời mời qua email, chuyển quyền sở hữu.
- Gói Free/Pro/Business, thanh toán payOS và Pay2S, nâng/hạ gói theo tỷ lệ, mã giảm giá, nhắc gia hạn.
- Yêu cầu xuất hóa đơn VAT (kế toán xuất thủ công, ghi số hóa đơn trong trang quản trị).
- API công khai `/api/v1` với API key (Pro trở lên). Thống kê lượt xem, chuyển đổi, nguồn truy cập.
- Hướng dẫn bắt đầu nhanh, email chào mừng, nhắc kích hoạt, tóm tắt lead hằng tuần, hủy nhận email.

### Tuân thủ và an toàn
- Xác minh email; quyền dữ liệu cá nhân theo Nghị định 13/2023 (tải dữ liệu, xóa tài khoản); lưu bằng chứng đồng ý điều khoản.
- Trang pháp lý mẫu: điều khoản, chính sách bảo mật, hoàn tiền, liên hệ (cần điền thông tin doanh nghiệp và luật sư rà soát).
- Báo cáo vi phạm, phát hiện trang lừa đảo khi xuất bản, tạm ngưng website/tài khoản (HTTP 451).

### Vận hành
- Docker Compose + Caddy, log JSON có request id, `/healthz`, `/readyz`, `/metrics` (Prometheus), cảnh báo lỗi qua webhook, sao lưu SQLite trực tuyến, lưu ảnh trên S3-compatible storage.
- CI: test Node 22/24 (232 test), E2E Playwright desktop + mobile (23 test), Docker build, CodeQL. Phát hành: GitHub Release và image `ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage`.
- Tài liệu triển khai: `docs/DEPLOYMENT.md`. Việc còn lại: `PLAN.md`, `docs/todo/`.
