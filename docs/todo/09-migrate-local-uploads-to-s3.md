# 09. Công cụ chuyển ảnh cũ từ đĩa sang S3

- **Người làm:** dev backend
- **Ưu tiên:** P3
- **Ước lượng:** 1 ngày

## Bối cảnh

Khi bật S3 (`S3_BUCKET`), ảnh tải lên trước đó vẫn nằm trong `/data/uploads` và phục vụ qua `/uploads/…`. Không có công cụ chuyển.

## Việc cần làm

1. `scripts/migrate-uploads-to-s3.js`: duyệt bảng `assets`, tải từng file lên S3 bằng `createStorage(config)` (cùng key), xác minh, ghi tiến độ, chạy lại được (idempotent).
2. Cập nhật HTML các trang đã lưu (`draft_html`, `published_html`, `project_json`, `page_versions`) thay `/uploads/<key>` bằng `S3_PUBLIC_URL/<key>`, có chế độ `--dry-run`.
3. Tùy chọn `--delete-local` sau khi xác minh.
4. Tài liệu trong `docs/DEPLOYMENT.md` mục 11.

## Tiêu chí hoàn thành

Sau khi chạy, xóa `/data/uploads` mà mọi trang vẫn hiển thị đủ ảnh.
