# 02. Đóng cảnh báo CodeQL `storage.js:84`

- **Người làm:** chủ repo (quyền Security)
- **Ưu tiên:** P1
- **Ước lượng:** 5 phút

## Bối cảnh

CodeQL báo *Network data written to file* tại `src/storage.js:84` (ghi ảnh khách tải lên vào đĩa). Đây là chức năng chính của bộ lưu trữ cục bộ. Đã kiểm tra:

- Route `POST /api/workspaces/:id/assets` yêu cầu đăng nhập và là thành viên workspace.
- Nội dung phải đúng chữ ký file PNG/JPEG/GIF/WebP (SVG/HTML bị từ chối), có giới hạn dung lượng.
- Tên file do máy chủ sinh ngẫu nhiên (`<workspaceId>/<24 hex>.<ext>`); `fileFor()` chặn đường dẫn ra ngoài thư mục gốc.
- File được phục vụ với `X-Content-Type-Options: nosniff`.

## Việc cần làm

Security → Code scanning → mở cảnh báo → **Dismiss alert** → lý do *False positive* (hoặc *Won't fix*), ghi chú: "Upload ảnh đã kiểm tra magic bytes, tên file do server sinh, path được giới hạn trong uploads root."

## Tiêu chí hoàn thành

Không còn cảnh báo CodeQL mở trên `main`.
