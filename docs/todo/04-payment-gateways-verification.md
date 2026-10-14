# 04. Kiểm chứng tích hợp payOS và Pay2S trên môi trường thật

- **Người làm:** dev backend + kế toán
- **Ưu tiên:** P0 trước khi thu tiền
- **Ước lượng:** 1 ngày

## Bối cảnh

Môi trường phát triển không truy cập được `payos.vn` và `docs.pay2s.vn`:

- payOS được viết theo SDK chính thức `@payos/node` (chữ ký đã khớp SDK) — rủi ro thấp.
- Pay2S được viết theo gói cộng đồng `pay2s-node` (**không phải SDK chính thức**) — cần xác nhận tên trường `payUrl`, mã thành công `resultCode = 0`, thứ tự trường ký `m2signature`, nội dung phản hồi IPN mà Pay2S yêu cầu.

File liên quan: `src/payments/payos.js`, `src/payments/pay2s.js`, `src/billing.js`, `test/billing.test.js`.

## Việc cần làm

1. payOS: tạo kênh thật, khai báo webhook `<APP_URL>/api/billing/webhooks/payos`, thanh toán thật số tiền nhỏ (dùng mã giảm giá để giảm giá trị), xác nhận gói được kích hoạt và có biên nhận.
2. Pay2S: chạy `PAY2S_ENV=sandbox`, đối chiếu tài liệu chính thức, sửa `src/payments/pay2s.js` nếu khác, cập nhật test với payload thật (đã ẩn khóa).
3. Thử các tình huống: hủy thanh toán, webhook gửi lặp, webhook đến trước khi khách quay về, khách quay về trước webhook.
4. Ghi kết quả và ngày kiểm chứng vào README mục "Cấu hình cổng thanh toán", bỏ cảnh báo ⚠️ tương ứng.

## Tiêu chí hoàn thành

Mỗi cổng có ít nhất một giao dịch thật thành công trên production và test tự động dùng payload đúng định dạng thật.
