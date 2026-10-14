# 08. Turnstile trên đường dẫn xem trước `/p/…`

- **Người làm:** dev backend
- **Ưu tiên:** P3
- **Ước lượng:** 0,5–1 ngày

## Bối cảnh

Khi website bật Cloudflare Turnstile, form trên `APP_URL/p/<subdomain>` không gửi được vì: trang chạy trong CSP `sandbox` (origin rỗng) và hostname dashboard thường không có trong danh sách hostname của site key. Tên miền con và tên miền riêng hoạt động bình thường. Hiện chỉ có ghi chú trong tab Cài đặt website và README.

## Phương án

- A (khuyến nghị): trên `/p/…` không hiển thị Turnstile mà hiển thị dòng "Biểu mẫu chỉ nhận dữ liệu trên tên miền chính thức" và vô hiệu nút gửi; máy chủ giữ nguyên kiểm tra (fail closed).
- B: chuyển hướng `/p/<subdomain>` sang `https://<subdomain>.<PUBLISH_ROOT_DOMAIN>` khi đã cấu hình `PUBLISH_ROOT_DOMAIN`.

File liên quan: `src/render.js` (`rewriteForms`, `TURNSTILE_JS`), `src/routes/sites.js` (`SANDBOX_CSP`, `servePublished`).

## Tiêu chí hoàn thành

Không còn trải nghiệm "gửi form rồi bị từ chối" trên đường dẫn xem trước; có test.
