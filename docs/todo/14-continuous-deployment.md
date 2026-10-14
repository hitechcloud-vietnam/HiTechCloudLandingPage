# 14. Triển khai tự động (CD)

- **Người làm:** DevOps + chủ repo (cung cấp secrets)
- **Ưu tiên:** P1
- **Ước lượng:** 1 ngày

## Bối cảnh

CI (`.github/workflows/ci.yml`) đã chạy test Node 22/24, E2E Playwright, Docker build, CodeQL cho mọi PR và mỗi lần push lên `main`. Đã có `.github/workflows/release.yml`: khi `main` có `version` mới trong `package.json` (hoặc khi đẩy tag `v*`) sẽ chạy test, tạo GitHub Release (ghi chú lấy từ `CHANGELOG.md`) và đẩy image `ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage:<tag>` + `:latest`. Chưa có bước triển khai tự động lên máy chủ; hiện triển khai thủ công theo `docs/DEPLOYMENT.md` mục 14.

## Việc cần làm

1. Workflow `.github/workflows/deploy.yml`, chạy khi tạo tag `v*` (hoặc khi CI trên `main` xanh, qua `workflow_run`), dùng GitHub Environment `production` có **required reviewers**.
2. ~~Build image và đẩy lên GHCR~~ (đã có trong `release.yml`). Sửa `docker-compose.yml` cho phép dùng `image: ghcr.io/…:<tag>` thay vì `build:` (vd biến `APP_IMAGE`). Nếu package GHCR đang ở chế độ private, máy chủ cần `docker login ghcr.io` bằng token chỉ có quyền `read:packages`, hoặc chuyển package sang public.
3. SSH vào máy chủ (secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`) và chạy: sao lưu → `docker compose pull` → `docker compose up -d` → kiểm tra `/readyz`; lỗi thì quay về tag trước.
4. Môi trường staging (tùy chọn) triển khai tự động từ `main`.

## Tiêu chí hoàn thành

Tạo tag `v1.0.1` → sau khi được duyệt, phiên bản mới chạy trên production trong < 5 phút, có bản sao lưu trước khi cập nhật.
