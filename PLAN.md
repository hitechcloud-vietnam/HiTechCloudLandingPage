# PLAN — HiTechCloud LandingPage

Kế hoạch và trạng thái công việc. Mỗi việc chưa xong có một file riêng trong [`docs/todo/`](docs/todo/) gồm bối cảnh, file liên quan, các bước cần làm và tiêu chí hoàn thành. Dev nhận việc thì ghi tên vào cột "Trạng thái", tạo nhánh `todo/<số>-<tên-ngắn>` từ `main` và mở PR; khi PR được gộp, xóa file tương ứng trong `docs/todo/` và chuyển dòng sang mục "Đã hoàn thành".

## Trạng thái hiện tại

- Nhánh phát hành: `main`. CI (GitHub Actions) chạy cho mọi PR và mỗi lần push lên `main`: test đơn vị/API trên Node 22 và 24 (`npm test`), E2E Playwright trên desktop + mobile (`npm run e2e`), build Docker, CodeQL.
- Phát hành: tăng `version` trong `package.json` (vd `1.0.1`) và thêm mục `## [v1.0.1] - <ngày>` vào `CHANGELOG.md`, gộp vào `main`. Workflow `release.yml` thấy version chưa có tag sẽ chạy test, tạo tag + GitHub Release (ghi chú lấy từ CHANGELOG) và đẩy image `ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage:<tag>` + `:latest`. Đẩy tag `v*` thủ công cũng kích hoạt phát hành.
- Triển khai: thủ công theo [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Docker Compose + Caddy). Triển khai tự động lên máy chủ: việc 14.
- Mô tả tính năng và API: [README.md](README.md).

## Việc chưa xong

Ưu tiên: **P0** chặn việc mở cho khách · **P1** nên làm trong tuần đầu · **P2** trong tháng đầu · **P3** khi cần.

| # | Việc | Người làm | Ưu tiên | Trạng thái |
|---|---|---|---|---|
| 01 | [Đặt `main` làm nhánh mặc định, bảo vệ nhánh](docs/todo/01-default-branch-and-protection.md) | Chủ repo | P0 | Chưa làm |
| 02 | [Đóng cảnh báo CodeQL `storage.js:84` (false positive)](docs/todo/02-codeql-storage-alert.md) | Chủ repo | P1 | Chưa làm |
| 03 | [Hoàn thiện trang pháp lý, luật sư rà soát, thủ tục tuân thủ](docs/todo/03-legal-pages-and-compliance.md) | Pháp chế + dev | P0 | Chưa làm |
| 04 | [Kiểm chứng payOS/Pay2S trên môi trường thật](docs/todo/04-payment-gateways-verification.md) | Dev + kế toán | P0 | Chưa làm |
| 05 | [Zalo OA: kiểm chứng API, luồng "Kết nối Zalo" OAuth](docs/todo/05-zalo-oa-verification-and-connect-flow.md) | Dev | P1 | Chưa làm |
| 06 | [Tích hợp API hóa đơn điện tử, email báo kế toán](docs/todo/06-e-invoice-provider-integration.md) | Dev + kế toán | P2 | Chưa làm |
| 07 | [PostgreSQL + Redis, chạy nhiều instance](docs/todo/07-postgresql-and-multi-instance.md) | Dev | P3 | Chưa làm |
| 08 | [Turnstile trên đường dẫn xem trước `/p/`](docs/todo/08-turnstile-on-preview-urls.md) | Dev | P3 | Chưa làm |
| 09 | [Công cụ chuyển ảnh cũ từ đĩa sang S3](docs/todo/09-migrate-local-uploads-to-s3.md) | Dev | P3 | Chưa làm |
| 10 | [Chứng chỉ wildcard có sẵn trong compose](docs/todo/10-wildcard-tls-in-compose.md) | DevOps | P2 | Chưa làm |
| 11 | [Tóm tắt tuần: lượt xem theo giờ VN, gửi bù](docs/todo/11-weekly-digest-accuracy.md) | Dev | P3 | Chưa làm |
| 12 | [Độ ổn định E2E `invoices.spec.js`](docs/todo/12-e2e-invoices-flake.md) | QA | P2 | Chưa làm |
| 13 | [OpenAPI cho API `/api/v1`](docs/todo/13-openapi-docs.md) | Dev | P3 | Chưa làm |
| 14 | [Triển khai tự động (CD) lên máy chủ](docs/todo/14-continuous-deployment.md) | DevOps + chủ repo | P1 | Chưa làm |
| 15 | [Sao lưu tự động trong docker-compose](docs/todo/15-backups-in-compose.md) | DevOps | P2 | Chưa làm |

### Thứ tự đề xuất

1. **Trước khi mở cho khách:** 01 → 03 → 04 (song song), rồi triển khai production theo `docs/DEPLOYMENT.md` và đi hết checklist mục 18.
2. **Tuần đầu:** 02, 14, 05.
3. **Tháng đầu:** 10, 15, 12, 06.
4. **Khi cần mở rộng:** 07, 09, 08, 11, 13.

## Đã hoàn thành

- Trình thiết kế kéo thả GrapesJS, 9 mẫu trang, 17 khối nội dung; đa người thuê (workspace, vai trò owner/admin/editor, lời mời).
- Xuất bản trên tên miền con, tên miền riêng (xác minh TXT), HTTPS tự động (Caddy on-demand TLS); SEO, sitemap/robots, mã tùy chỉnh (Pro).
- Thu lead + CRM (trạng thái, ghi chú, lọc, CSV), chống spam nhiều lớp (honeypot, rate limit, dấu thời gian ký HMAC, điểm spam, Turnstile, lead trùng), kiểm tra SĐT Việt Nam.
- Thông báo lead: email, webhook ký HMAC, Telegram, Slack, Discord, Google Sheets, Zalo OA (cần kiểm chứng thêm — việc 05).
- Thanh toán payOS + Pay2S, gói Free/Pro/Business, nâng/hạ gói theo tỷ lệ, mã giảm giá, nhắc gia hạn, yêu cầu hóa đơn VAT (xuất thủ công — việc 06).
- A/B testing, thống kê (lượt xem, chuyển đổi, nguồn UTM), widget chuyển đổi (popup, thanh dính, social proof, đếm ngược).
- API công khai `/api/v1` với API key (Pro+).
- Xác minh email, quyền dữ liệu cá nhân theo Nghị định 13/2023 (tải dữ liệu, xóa tài khoản, chuyển quyền sở hữu), lưu bằng chứng đồng ý điều khoản.
- An toàn nội dung: báo cáo vi phạm, phát hiện trang lừa đảo, tạm ngưng website/tài khoản (HTTP 451).
- Hướng dẫn bắt đầu nhanh, email vòng đời (chào mừng, nhắc kích hoạt, tóm tắt lead hằng tuần, hủy nhận).
- Vận hành: log JSON có request id, `/healthz`, `/readyz`, `/metrics` (Prometheus), cảnh báo lỗi qua webhook, sao lưu SQLite trực tuyến, lưu ảnh S3.
- Kiểm thử: 231 test đơn vị/API, 23 test E2E (desktop + mobile, kiểm tra a11y và hiển thị 375px); CI xanh.
- Tài liệu triển khai chi tiết: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
