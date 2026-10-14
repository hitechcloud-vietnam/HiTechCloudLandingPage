# 06. Tích hợp API hóa đơn điện tử và báo kế toán khi có yêu cầu mới

- **Người làm:** dev backend + kế toán
- **Ưu tiên:** P2 (hiện xuất thủ công vẫn dùng được)
- **Ước lượng:** 3–5 ngày cho một nhà cung cấp

## Bối cảnh

Đã có: thông tin xuất hóa đơn theo workspace, yêu cầu hóa đơn theo đơn hàng (tự động hoặc thủ công), tab **Hóa đơn VAT** trong `/app/admin` để xuất CSV, nhập số hóa đơn/mã tra cứu, hủy kèm lý do (`src/invoices.js`, `src/routes/invoices.js`, `test/invoices.test.js`, README mục "Hóa đơn VAT").

Còn thiếu:

- Không có email/thông báo cho kế toán khi có yêu cầu mới (chỉ có số đếm trên tab admin).
- Kế toán phải phát hành hóa đơn thủ công trên phần mềm hóa đơn điện tử.
- Hóa đơn đã xuất không sửa/hủy được trong ứng dụng (điều chỉnh làm trên phần mềm HĐĐT).

## Việc cần làm

1. Thêm biến `INVOICE_NOTIFY_EMAILS`; gửi email (hoặc gộp 1 email/ngày) khi có yêu cầu mới.
2. Chọn nhà cung cấp (MISA meInvoice, VNPT Invoice, Viettel S-Invoice…), lấy tài liệu API và tài khoản thử.
3. Viết adapter `src/einvoice/<provider>.js` với giao diện chung `issue(request) → {invoiceNo, lookupCode, lookupUrl}`; nút **Phát hành tự động** trong tab Hóa đơn VAT; lưu lỗi trả về.
4. Xử lý mẫu số/ký hiệu hóa đơn, thuế suất VAT, làm tròn, đơn vị tiền tệ theo quy định (Nghị định 123/2020, Thông tư 78/2021 và văn bản sửa đổi).
5. Test với API giả lập (fetch injection như `test/billing.test.js`).

## Tiêu chí hoàn thành

Đơn đã thanh toán có yêu cầu hóa đơn → bấm một nút (hoặc tự động) → hóa đơn được phát hành trên hệ thống nhà cung cấp và khách nhận email tra cứu.
