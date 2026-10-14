# 13. Tài liệu OpenAPI cho API công khai `/api/v1`

- **Người làm:** dev backend
- **Ưu tiên:** P3
- **Ước lượng:** 1 ngày

## Bối cảnh

API v1 (`src/routes/publicApi.js`) chỉ được mô tả bằng bảng trong README mục "API công khai". Khách tích hợp (Zapier/Make/CRM) cần đặc tả máy đọc được.

## Việc cần làm

1. Viết `public/api/openapi.yaml` (OpenAPI 3.1): xác thực Bearer, các endpoint sites/pages/leads/publish, mã lỗi (401/402/403/404/429), giới hạn tần suất.
2. Trang `/api/docs` hiển thị (Redoc/Swagger UI tải từ CDN, CSP phù hợp).
3. Test: mọi route trong `publicApi.js` đều có trong đặc tả (so sánh tự động).

## Tiêu chí hoàn thành

Import `openapi.yaml` vào Postman gọi được toàn bộ endpoint.
