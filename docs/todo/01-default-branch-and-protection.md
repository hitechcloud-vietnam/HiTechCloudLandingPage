# 01. Đặt `main` làm nhánh mặc định và bảo vệ nhánh

- **Người làm:** chủ repo (quyền Admin trên GitHub)
- **Ưu tiên:** P0 — làm ngay
- **Ước lượng:** 10 phút

## Bối cảnh

Nhánh mặc định của repo đang là `hitechcloud/gifted-meitner-my4af7` (nhánh phát triển). Toàn bộ mã đã được gộp vào `main`, nhưng công cụ dùng để phát triển không có quyền đổi cài đặt repo.

## Việc cần làm

1. GitHub → **Settings → General → Default branch** → chọn `main` → **Update**.
2. **Settings → Branches → Add branch ruleset** (hoặc *Branch protection rule*) cho `main`:
   - Require a pull request before merging (1 approval).
   - Require status checks to pass: `Test (Node 22)`, `Test (Node 24)`, `E2E (Playwright)`, `Docker build`, `CodeQL`.
   - Require branches to be up to date before merging.
   - Block force pushes, restrict deletions.
3. Sau khi đổi nhánh mặc định, xóa nhánh cũ `hitechcloud/gifted-meitner-my4af7` nếu không còn PR nào dùng (Settings → Branches hoặc trang Branches).

## Tiêu chí hoàn thành

- Trang chủ repo hiển thị nhánh `main`.
- Push thẳng vào `main` bị chặn; PR chỉ merge được khi CI xanh.
