# 03. Hoàn thiện trang pháp lý và thủ tục tuân thủ

- **Người làm:** pháp chế / ban giám đốc (+ 1 dev sửa HTML)
- **Ưu tiên:** P0 — bắt buộc trước khi mở cho khách và trước khi cổng thanh toán duyệt
- **Ước lượng:** 2–5 ngày (phụ thuộc luật sư)

## Bối cảnh

Các trang `/terms`, `/privacy`, `/refund`, `/contact`, chân trang và JSON-LD trên trang chủ là **bản mẫu**, có chỗ trống `[...]` tô vàng và dòng "Bản mẫu — cần được luật sư rà soát trước khi công bố".

## Việc cần làm

1. Tìm mọi chỗ cần điền: `grep -rn "\[" public/*.html`.
2. Điền: mã số thuế, ngày cấp, nơi cấp, địa chỉ trụ sở, số điện thoại, người đại diện theo pháp luật, giờ làm việc, ngày hiệu lực, nơi giải quyết tranh chấp, người phụ trách bảo vệ dữ liệu cá nhân, vị trí máy chủ, các bên xử lý dữ liệu (SMTP, S3, máy chủ), thời hạn lưu trữ, VAT, các mốc thời gian hoàn tiền.
3. Luật sư rà soát theo Nghị định 13/2023/NĐ-CP, Luật Bảo vệ dữ liệu cá nhân và văn bản hướng dẫn đang có hiệu lực, Luật Thương mại điện tử.
4. Xóa khối `<div class="legal-notice">` ở từng trang sau khi được duyệt.
5. Đặt `TERMS_VERSION` trong `.env` khớp phiên bản công bố; tăng mỗi lần sửa điều khoản.
6. Thay `https://hitechcloud.vn` bằng tên miền thật trong canonical, Open Graph, JSON-LD, `public/robots.txt`, `public/sitemap.xml`; thêm `og:image` cho trang chủ.
7. Thủ tục: thông báo website TMĐT với Bộ Công Thương (online.gov.vn) nếu thuộc diện; lập hồ sơ đánh giá tác động xử lý dữ liệu cá nhân nếu thuộc diện.

## Tiêu chí hoàn thành

- `grep -rn "\[" public/*.html` không còn chỗ trống cần điền.
- Không còn dòng "Bản mẫu".
- Có văn bản xác nhận của luật sư.
