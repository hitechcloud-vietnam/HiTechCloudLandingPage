# 10. Chứng chỉ wildcard cho tên miền con trong cấu hình mặc định

- **Người làm:** DevOps
- **Ưu tiên:** P2 (trước khi có > 50 website mới/tuần)
- **Ước lượng:** 0,5 ngày

## Bối cảnh

Mỗi tên miền con của khách được cấp chứng chỉ riêng (on-demand TLS). Let's Encrypt giới hạn 50 chứng chỉ/tuần cho một tên miền đăng ký. Cách dùng chứng chỉ wildcard qua DNS challenge đã được mô tả trong `docs/DEPLOYMENT.md` mục 12.2 nhưng chưa có sẵn trong repo.

## Việc cần làm

1. Thêm `deploy/Dockerfile.caddy` (xcaddy + `caddy-dns/cloudflare`, có thể thêm nhà cung cấp DNS khác).
2. Thêm `deploy/Caddyfile.wildcard` và một profile/override `docker-compose.wildcard.yml` dùng biến `CF_API_TOKEN`, `PUBLISH_ROOT_DOMAIN`.
3. CI: build thử image Caddy tùy chỉnh.
4. Cập nhật tài liệu: chỉ cần `docker compose -f docker-compose.yml -f docker-compose.wildcard.yml up -d`.

## Tiêu chí hoàn thành

Tạo 100 website thử trên staging, tất cả có HTTPS hợp lệ, không chạm giới hạn ACME.
