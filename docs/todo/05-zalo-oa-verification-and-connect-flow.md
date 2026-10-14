# 05. Zalo OA: kiểm chứng API và luồng "Kết nối Zalo" trong ứng dụng

- **Người làm:** dev backend + frontend
- **Ưu tiên:** P1
- **Ước lượng:** 2–3 ngày

## Bối cảnh

Kênh thông báo lead qua Zalo OA đã chạy (`src/zalo.js`, `src/notify.js`, `test/zalo.test.js`), nhưng được viết khi **không truy cập được** developers.zalo.me:

- Chưa đối chiếu: dạng request/response của `POST https://openapi.zalo.me/v3.0/oa/message/cs` và `POST https://oauth.zaloapp.com/v4/oa/access_token`, mã lỗi token hết hạn (`-216`, `-124` đang được giả định), đơn vị `expires_in`, mã lỗi khi người nhận chưa tương tác gần đây (`-230` chỉ có trong test giả lập).
- Khách phải tự lấy refresh token bằng curl/API Explorer (README mục "Zalo OA") — khó dùng.
- Khóa chống làm mới token song song nằm trong bộ nhớ tiến trình (chỉ đúng khi chạy 1 instance, xem việc 07).
- Nếu lần làm mới thành công ở phía Zalo nhưng phản hồi bị mất (timeout), chuỗi refresh token bị đứt; chủ OA phải cấp quyền lại.

## Việc cần làm

1. Đối chiếu tài liệu chính thức, sửa `src/zalo.js` và `test/zalo.test.js` theo đúng định dạng thật; ghi nguồn tài liệu và ngày kiểm chứng trong README.
2. Thêm luồng OAuth trong ứng dụng:
   - Nút **Kết nối Zalo OA** trong Cài đặt website → chuyển tới `https://oauth.zaloapp.com/v4/oa/permission?app_id=…&redirect_uri=…&code_challenge=…&state=…` (PKCE, `state` ký HMAC gắn site + user).
   - Endpoint callback `GET /integrations/zalo/callback` đổi `code` lấy token, lưu vào `zalo_tokens`, quay về trang cài đặt.
   - Khai báo callback URL trong ứng dụng Zalo for Developers.
3. Nút "Lấy ID người nhận": hướng dẫn người nhận nhắn tin cho OA, đọc `user_id` từ webhook sự kiện của OA (cần endpoint webhook OA, xác thực chữ ký Zalo) và cho chủ website chọn.
4. Kiểm thử với một OA thật.

## Tiêu chí hoàn thành

- Kết nối OA bằng một cú nhấp, không cần curl.
- Gửi thử thành công tới OA thật; tự làm mới token sau 25 giờ hoạt động đúng.
