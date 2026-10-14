# Runbook vận hành HiTechCloud LandingPage

Quy trình xử lý sự cố từng bước cho người trực vận hành. Cài đặt và cấu hình: [DEPLOYMENT.md](DEPLOYMENT.md). Mọi lệnh chạy trong `/opt/hitechcloud` bằng người dùng vận hành (thuộc nhóm `docker`), trừ khi ghi `sudo`.

## Mục lục

1. [Lệnh chẩn đoán nhanh](#1-lệnh-chẩn-đoán-nhanh)
2. [Dashboard không truy cập được](#2-dashboard-không-truy-cập-được)
3. [Nhiều lỗi 5xx / nhận cảnh báo lỗi](#3-nhiều-lỗi-5xx--nhận-cảnh-báo-lỗi)
4. [Website của khách lỗi HTTPS](#4-website-của-khách-lỗi-https)
5. [Đầy ổ đĩa](#5-đầy-ổ-đĩa)
6. [Database lỗi hoặc dữ liệu sai: khôi phục](#6-database-lỗi-hoặc-dữ-liệu-sai-khôi-phục)
7. [Cập nhật lỗi: quay lui](#7-cập-nhật-lỗi-quay-lui)
8. [Khách đã thanh toán nhưng gói không đổi](#8-khách-đã-thanh-toán-nhưng-gói-không-đổi)
9. [Không gửi được email](#9-không-gửi-được-email)
10. [Báo cáo trang lừa đảo / nội dung vi phạm](#10-báo-cáo-trang-lừa-đảo--nội-dung-vi-phạm)
11. [Lộ khóa bí mật: đổi khóa](#11-lộ-khóa-bí-mật-đổi-khóa)
12. [Sự cố lộ dữ liệu cá nhân](#12-sự-cố-lộ-dữ-liệu-cá-nhân)
13. [Chuyển sang máy chủ mới](#13-chuyển-sang-máy-chủ-mới)
14. [Việc định kỳ](#14-việc-định-kỳ)

---

## 1. Lệnh chẩn đoán nhanh

```bash
docker compose ps                                           # trạng thái, app phải "healthy"
deploy/smoke-test.sh                                        # kiểm tra từ bên ngoài
docker compose logs --no-log-prefix --since 30m app | jq -cR 'fromjson? | select(.level=="error")'
docker compose logs --no-log-prefix --since 30m app | jq -cR 'fromjson? | select(.reqId=="<requestId khách báo>")'
docker compose logs --since 30m caddy | grep -iE 'error|tls'
df -h / && docker system df
deploy/preflight.sh --skip-dns                              # cấu hình còn hợp lệ?
```

Khi khách báo lỗi, xin **mã `requestId`** hiển thị trong thông báo lỗi 500 để tra đúng dòng log.

## 2. Dashboard không truy cập được

1. `docker compose ps`:
   - `app` không chạy / `restarting` → `docker compose logs --tail 200 app`. Lỗi cấu hình (biến môi trường sai) → sửa `.env`, `deploy/preflight.sh`, `docker compose up -d`. Lỗi database → mục 6.
   - `app` `unhealthy` → `docker compose exec app wget -qO- http://127.0.0.1:3000/healthz`; nếu treo, `docker compose restart app` và theo dõi log.
   - `caddy` không chạy → `docker compose logs caddy` (thường là lỗi cú pháp sau khi sửa `deploy/Caddyfile`: kiểm tra bằng `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile`).
2. Container chạy nhưng không vào được từ ngoài:
   - `curl -skI https://127.0.0.1 -H "Host: <APP_DOMAIN>"` trên máy chủ chạy được → vấn đề mạng/DNS/tường lửa: `dig +short <APP_DOMAIN>`, `sudo ufw status`, tường lửa của nhà cung cấp cloud (security group).
   - Lỗi chứng chỉ → `docker compose logs caddy | grep -i acme`; kiểm tra cổng 80 mở (bắt buộc cho ACME).
3. Sau khi khắc phục: `deploy/smoke-test.sh`.

## 3. Nhiều lỗi 5xx / nhận cảnh báo lỗi

1. Đọc cảnh báo trong kênh Slack/Discord (`ERROR_WEBHOOK_URL`): loại lỗi, `requestId`, route.
2. `docker compose logs --no-log-prefix --since 1h app | jq -cR 'fromjson? | select(.level=="error") | {time, reqId, route, msg: .err.message}'`.
3. Phân loại:
   - Lỗi xuất hiện ngay sau khi cập nhật → mục 7 (quay lui).
   - `SQLITE_BUSY` / `database is locked` → kiểm tra không có tiến trình thứ hai dùng cùng file DB, ổ đĩa không phải ổ mạng.
   - `ENOSPC` → mục 5.
   - Lỗi gọi dịch vụ ngoài (payOS, SMTP, S3, Zalo) → kiểm tra trạng thái nhà cung cấp, khóa trong `.env`.
4. Ghi lại sự cố (thời điểm, ảnh hưởng, nguyên nhân, cách xử lý).

## 4. Website của khách lỗi HTTPS

Áp dụng cho `<subdomain>.<PUBLISH_ROOT_DOMAIN>` và tên miền riêng.

```bash
HOST=www.khachhang.vn
dig +short "$HOST"                                                            # phải về IP máy chủ (hoặc CNAME về CNAME_TARGET)
dig +short TXT "_htc-verify.$HOST"                                            # tên miền riêng: phải có htc-verify=<mã>
docker compose exec app wget -qSO- "http://127.0.0.1:3000/_htc/tls-ask?domain=$HOST" 2>&1 | head -1   # phải 200
docker compose logs --since 2h caddy | grep "$HOST"
```

| `tls-ask` trả | Nguyên nhân | Xử lý |
|---|---|---|
| 404 | Tên miền chưa xác minh, website chưa xuất bản trang nào, website/tài khoản bị tạm ngưng | Khách bấm "Kiểm tra DNS"; xuất bản trang; xem tab An toàn nội dung |
| 200 nhưng Caddy báo `rateLimited` | Chạm giới hạn Let's Encrypt (50 chứng chỉ/tuần/tên miền) | Chờ, Caddy tự thử ZeroSSL; lâu dài dùng chứng chỉ wildcard (DEPLOYMENT mục 12.2) |
| 200 nhưng Caddy báo lỗi challenge | DNS trỏ sai, Cloudflare bật proxy (đám mây cam), cổng 80 bị chặn | Sửa DNS về DNS only; mở cổng 80 |

## 5. Đầy ổ đĩa

```bash
df -h /
sudo du -xh --max-depth=1 /var/lib/docker | sort -h | tail
docker compose exec app sh -c 'du -sh /data/* 2>/dev/null'
du -sh /var/backups/hitechcloud
```

Dọn theo thứ tự an toàn:

1. `docker image prune -f` và `docker builder prune -f` (image/cache build cũ).
2. Bản sao lưu cũ trên máy chủ (đã có bản ngoài máy chủ): `deploy/backup.sh --keep-days 7` lần tới, hoặc xóa tay file cũ trong `/var/backups/hitechcloud`.
3. `docker compose exec app sh -c 'rm -rf /data/restore-old /data/backups/*'` (dữ liệu cũ từ lần khôi phục trước).
4. Log Docker quá lớn → kiểm tra `/etc/docker/daemon.json` có giới hạn log (DEPLOYMENT mục 4.5).
5. Ảnh khách chiếm nhiều → chuyển sang S3 (DEPLOYMENT mục 11); tăng dung lượng đĩa.

Sau khi dọn: `docker compose restart app` nếu app đã lỗi ghi, rồi `deploy/smoke-test.sh`.

## 6. Database lỗi hoặc dữ liệu sai: khôi phục

Dấu hiệu: log `SQLITE_CORRUPT`, `database disk image is malformed`, hoặc dữ liệu bị xóa/sửa nhầm.

1. Thông báo khách (nếu ảnh hưởng rộng) và ghi lại thời điểm sự cố.
2. Chọn bản sao lưu **trước** thời điểm sự cố: `ls -lt /var/backups/hitechcloud | head` (hoặc tải từ kho ngoài máy chủ: `rclone copy offsite:hitechcloud-backups/<file> /var/backups/hitechcloud/`).
3. Khôi phục:
   ```bash
   deploy/restore.sh /var/backups/hitechcloud/hitechcloud-<thời điểm>.db /var/backups/hitechcloud/files-<thời điểm>.tar.gz
   deploy/smoke-test.sh
   ```
   Script tự sao lưu dữ liệu hiện tại vào `pre-restore/`, kiểm tra bản sao lưu trước khi thay, giữ dữ liệu cũ trong `/data/restore-old/`, và tự khởi động lại app nếu có lỗi.
4. Dữ liệu phát sinh sau thời điểm sao lưu (lead, đơn hàng) bị mất khỏi DB mới: đối chiếu đơn hàng với trang quản trị payOS/Pay2S và kích hoạt lại gói cho khách đã trả tiền (mục 8). Lead mới có thể còn trong kênh thông báo (email/Telegram/Sheets) của khách.
5. Khi chắc chắn: `docker compose exec app rm -rf /data/restore-old`.

## 7. Cập nhật lỗi: quay lui

Nếu đã cập nhật bằng `deploy/update.sh --auto-rollback`, việc quay lui đã tự động. Thủ công:

```bash
git log --oneline -5                                       # tìm commit/tag trước
deploy/update.sh --ref <tag-trước> --no-backup             # build từ mã nguồn
deploy/update.sh --image <tag-trước> --no-backup           # image dựng sẵn
```

Nếu phiên bản mới đã làm hỏng dữ liệu: khôi phục bản sao lưu `update.sh` tạo ngay trước khi cập nhật (file mới nhất trong `/var/backups/hitechcloud` trước giờ cập nhật) theo mục 6.

## 8. Khách đã thanh toán nhưng gói không đổi

1. Hỏi khách mã đơn / thời điểm thanh toán; tìm trong `/app/admin` → tab **Giao dịch**.
2. Đơn ở trạng thái chờ:
   - payOS: xem lịch sử webhook trong trang quản trị payOS (URL phải là `<APP_URL>/api/billing/webhooks/payos`, phản hồi 200). Log: `docker compose logs --since 24h app | grep -i webhooks/payos`.
   - Sai chữ ký → kiểm tra `PAYOS_CHECKSUM_KEY` / `PAY2S_SECRET_KEY` đúng với cổng.
3. Đã xác nhận tiền về tài khoản: kích hoạt gói thủ công trong `/app/admin` → tab **Khách hàng** (chọn gói, nhập số tháng), ghi lại lý do trong sổ vận hành.
4. Nếu khách cần hóa đơn VAT: tạo yêu cầu cho đơn đó (tab **Hóa đơn VAT**).

## 9. Không gửi được email

```bash
docker compose logs --no-log-prefix --since 2h app | jq -cR 'fromjson? | select((.msg // "") | test("mail|smtp"; "i"))'
```

- `SMTP_URL` trống → email chỉ ghi vào log.
- Lỗi xác thực → kiểm tra tài khoản/mật khẩu ứng dụng; ký tự đặc biệt trong mật khẩu phải mã hóa URL (DEPLOYMENT mục 6.2).
- Timeout → nhà cung cấp máy chủ chặn cổng 25/465/587; thử `smtp://…:587`, hoặc dùng dịch vụ gửi email qua API/SMTP khác.
- Email vào thư rác → SPF/DKIM/DMARC (DEPLOYMENT mục 9).

Liên kết xác minh email khẩn cấp cho một người dùng (khi SMTP hỏng):

```bash
docker compose logs app | grep -o 'https://[^ "]*/api/auth/verify?token=[A-Za-z0-9_-]*' | tail -5
```

## 10. Báo cáo trang lừa đảo / nội dung vi phạm

1. `/app/admin` → tab **An toàn nội dung**: xem trang bị gắn cờ / báo cáo, xem trước an toàn (không chạy script).
2. Lừa đảo rõ ràng (giả mạo ngân hàng, thu thập mật khẩu/OTP) → **Tạm ngưng website** ngay (trả HTTP 451, không cấp chứng chỉ mới, không nhận form). Nếu cùng tài khoản có nhiều website vi phạm → **Tạm ngưng tài khoản** (các website của tài khoản cũng bị tạm ngưng, API key bị chặn).
3. Nhầm lẫn → **Bỏ qua** cảnh báo (gỡ tạm ngưng tự động nếu có).
4. Lưu bằng chứng (ảnh chụp, URL, thời điểm) nếu cần cung cấp cho cơ quan chức năng hoặc ngân hàng bị giả mạo.
5. Mục tiêu xử lý báo cáo: trong 24 giờ.

## 11. Lộ khóa bí mật: đổi khóa

| Khóa | Cách đổi | Ảnh hưởng |
|---|---|---|
| payOS / Pay2S | Tạo khóa mới trên cổng, cập nhật `.env`, `docker compose up -d` | Đơn đang chờ vẫn kiểm tra được |
| `SMTP_URL` | Đổi mật khẩu ở nhà cung cấp, cập nhật `.env` | Không |
| `METRICS_TOKEN` | `openssl rand -hex 32`, cập nhật `.env` và Prometheus | Không |
| `LEAD_SECRET` | `openssl rand -hex 32`, cập nhật `.env` | Form mở trước đó phải tải lại; liên kết hủy nhận email đã gửi hết hiệu lực |
| `ZALO_APP_SECRET` | Đổi trên Zalo for Developers, cập nhật `.env` | Không |
| S3 | Tạo access key mới, cập nhật `.env`, xóa key cũ | Không |
| API key của khách | Khách thu hồi trong Cài đặt workspace và tạo key mới | Tích hợp của khách phải cập nhật |
| Mật khẩu tài khoản quản trị | Đổi trong Cài đặt → Đổi mật khẩu (mọi phiên đăng nhập khác bị đăng xuất) | — |

Sau mỗi lần đổi: `deploy/preflight.sh --skip-dns` và `deploy/smoke-test.sh`. Nếu `.env` bị lộ: đổi **toàn bộ** khóa trong bảng.

## 12. Sự cố lộ dữ liệu cá nhân

Theo Nghị định 13/2023/NĐ-CP, khi phát hiện vi phạm bảo vệ dữ liệu cá nhân phải thông báo cho cơ quan chuyên trách (Bộ Công an, Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao — A05) trong thời hạn luật định (72 giờ kể từ khi xảy ra vi phạm). Người phụ trách bảo vệ dữ liệu cá nhân (ghi trong `/privacy`) chủ trì; luật sư xác nhận quy định đang có hiệu lực.

1. Khoanh vùng: chặn đường rò rỉ (đổi khóa — mục 11, tạm ngưng tài khoản/website liên quan, chặn IP ở tường lửa).
2. Giữ bằng chứng: sao lưu log (`docker compose logs --since 7d app > incident-app.log`), bản sao lưu DB tại thời điểm phát hiện.
3. Đánh giá: dữ liệu nào, của bao nhiêu người, từ khi nào.
4. Thông báo cơ quan chức năng và người dùng bị ảnh hưởng theo mẫu quy định.
5. Khắc phục nguyên nhân, ghi biên bản sự cố.

## 13. Chuyển sang máy chủ mới

1. Máy chủ mới: DEPLOYMENT "Cài đặt nhanh" bước 1–4, dùng **cùng** `.env` (chép an toàn bằng `scp`, quyền 600). Chưa đổi DNS.
2. Máy chủ cũ: thông báo bảo trì, `deploy/backup.sh --dest /tmp/migrate`.
3. Chép `/tmp/migrate/*` sang máy chủ mới, chạy `deploy/restore.sh … --yes`.
4. Kiểm tra máy chủ mới trước khi đổi DNS: `deploy/smoke-test.sh --resolve <IP mới>` (từ máy của bạn).
5. Đổi bản ghi A của `APP_DOMAIN`, `*.PUBLISH_ROOT_DOMAIN`, `CNAME_TARGET` sang IP mới (giảm TTL xuống 300 giây trước đó 1 ngày).
6. Dừng app ở máy chủ cũ (`docker compose stop app`) để không nhận lead/đơn hàng vào DB cũ. Giữ máy chủ cũ vài ngày rồi mới xóa.
7. Khách dùng tên miền riêng trỏ CNAME về `CNAME_TARGET` không cần làm gì; khách trỏ bản ghi A thẳng vào IP cũ phải đổi.

## 14. Việc định kỳ

| Tần suất | Việc |
|---|---|
| Hằng ngày | Xem tab **An toàn nội dung** và **Hóa đơn VAT** trong `/app/admin`; kiểm tra `/var/log/hitechcloud-backup.log` có "Sao lưu xong" |
| Hằng tuần | `docker image prune -f`; xem dung lượng đĩa; xem cảnh báo lỗi trong tuần |
| Hằng tháng | Cập nhật hệ điều hành (`sudo apt full-upgrade`, khởi động lại nếu cần); cập nhật ứng dụng lên bản mới (`deploy/update.sh`); `npm audit --omit=dev` trên bản phát hành |
| Hằng quý | Diễn tập khôi phục trên máy chủ thử (mục 6) và đo thời gian; rà soát danh sách `SUPERADMIN_EMAILS`; đổi `METRICS_TOKEN` |
| Hằng năm | Rà soát trang pháp lý, tăng `TERMS_VERSION` nếu sửa; rà soát nhà cung cấp xử lý dữ liệu trong `/privacy` |
