# 07. PostgreSQL + Redis để chạy nhiều instance

- **Người làm:** dev backend
- **Ưu tiên:** P3 (chỉ khi một máy chủ không còn đủ)
- **Ước lượng:** 2–3 tuần

## Bối cảnh

Ứng dụng dùng SQLite (`node:sqlite`, WAL) và một số trạng thái trong bộ nhớ tiến trình:

- Giới hạn tần suất (`src/ratelimit.js`).
- Hàng đợi/retry thông báo lead (`src/notify.js`).
- Khóa làm mới token Zalo (`src/zalo.js`).
- Bộ đệm chỉ số kinh doanh (`src/metrics.js`).
- Job nền chạy mỗi giờ trong cùng tiến trình (`src/jobs.js`).

Vì vậy chỉ chạy được **một** instance (xem `docs/DEPLOYMENT.md` mục 20).

## Việc cần làm

1. Lớp truy cập DB: tách câu lệnh SQL khỏi route, hỗ trợ cả SQLite (dev/test) và PostgreSQL (`pg`). Lưu ý cú pháp khác: `datetime('now')`, `INSERT OR IGNORE`, `ON CONFLICT`, `AUTOINCREMENT`, `PRAGMA`.
2. Thay hệ migrate `add(table, column, ddl)` bằng migration có phiên bản (thư mục `migrations/`).
3. Công cụ chuyển dữ liệu SQLite → PostgreSQL.
4. Redis cho rate limit, hàng đợi thông báo (BullMQ hoặc tương đương), khóa phân tán (token Zalo), job nền chỉ chạy trên một instance (leader lock).
5. Session vẫn trong DB (đã ổn).
6. Cập nhật `docker-compose.yml` (postgres, redis), CI chạy test trên cả hai DB.

## Tiêu chí hoàn thành

`docker compose up --scale app=3` chạy đúng; toàn bộ test xanh trên PostgreSQL.
