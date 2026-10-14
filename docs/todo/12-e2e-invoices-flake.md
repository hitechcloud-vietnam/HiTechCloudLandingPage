# 12. Kiểm tra độ ổn định E2E `invoices.spec.js`

- **Người làm:** dev QA
- **Ưu tiên:** P2
- **Ước lượng:** 0,5 ngày

## Bối cảnh

Khi chạy toàn bộ `npm run e2e` cục bộ, có một lần `e2e/invoices.spec.js` phải chạy lại (retry) mới qua; lần chạy tiếp theo qua ngay (23/23). Spec này ghi trực tiếp đơn đã thanh toán vào file SQLite của máy chủ e2e (không có cổng thanh toán trong e2e), có thể tranh chấp khóa với tiến trình máy chủ.

## Việc cần làm

1. Chạy lặp: `npx playwright test -c e2e/playwright.config.js invoices.spec.js --repeat-each=20 --workers=4 --retries=0`.
2. Nếu lỗi, xem trace (`test-results/`) để tìm nguyên nhân (khóa SQLite, chờ UI chưa đủ, dữ liệu dùng chung).
3. Cách sửa gợi ý: tạo đơn qua một endpoint chỉ bật trong môi trường e2e (vd biến `E2E_FIXTURES=1`) thay vì ghi thẳng vào DB, hoặc dùng `busy_timeout`.

## Tiêu chí hoàn thành

20 lần chạy lặp liên tiếp không lỗi, không cần retry.
