# 11. Email tóm tắt tuần: số lượt xem theo giờ Việt Nam và gửi bù

- **Người làm:** dev backend
- **Ưu tiên:** P3
- **Ước lượng:** 1 ngày

## Bối cảnh

Email tóm tắt lead hằng tuần (`src/lifecycle.js`) dùng ranh giới tuần theo giờ Việt Nam cho lead, nhưng lượt xem trang được lưu theo **ngày UTC** nên có thể lệch tối đa 7 giờ ở đầu/cuối tuần. Nếu máy chủ tắt suốt sáng thứ Hai, tuần đó bị bỏ qua (không gửi bù).

## Việc cần làm

1. Lưu lượt xem theo ngày giờ Việt Nam (hoặc theo giờ) trong bảng thống kê; migrate dữ liệu cũ hoặc chấp nhận từ ngày triển khai.
2. Cho phép gửi bù đến hết thứ Ba nếu `workspaces.digest_week` chưa phải tuần trước.
3. Test cho ranh giới tuần và gửi bù.

## Tiêu chí hoàn thành

Số liệu email khớp màn hình Thống kê cho cùng khoảng thời gian; tắt máy chủ cả thứ Hai thì thứ Ba vẫn nhận email.
