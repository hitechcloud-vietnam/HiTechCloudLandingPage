# 15. Sao lưu tự động đóng gói sẵn trong docker-compose

- **Người làm:** DevOps
- **Ưu tiên:** P2
- **Ước lượng:** 0,5 ngày

## Bối cảnh

Đã có `deploy/backup.sh` / `deploy/restore.sh` (được CI kiểm thử) và hướng dẫn cron trong `docs/DEPLOYMENT.md` mục 13. Việc còn lại là đóng gói lịch chạy vào chính docker-compose để không phải cài cron trên máy chủ.


Sao lưu hiện dựa vào script và cron trên máy chủ (`docs/DEPLOYMENT.md` mục 13). Dễ quên cài khi dựng máy chủ mới.

## Việc cần làm

1. Service `backup` trong `docker-compose.yml` (image node hoặc alpine + sqlite3) dùng chung volume `app-data`, chạy `scripts/backup.js` theo lịch (vd supercronic), giữ N bản, nén `uploads/`.
2. Tùy chọn đẩy ra S3 (dùng lại biến `S3_*` hoặc biến riêng `BACKUP_S3_*`), mã hóa bằng `age`/`gpg`.
3. Chỉ số `hitechcloud_last_backup_timestamp_seconds` trong `/metrics` để cảnh báo khi quá 26 giờ không có bản sao lưu.

## Tiêu chí hoàn thành

Dựng máy chủ mới bằng `docker compose up -d` đã có sao lưu hằng ngày ra ngoài máy chủ mà không cần cấu hình cron.
