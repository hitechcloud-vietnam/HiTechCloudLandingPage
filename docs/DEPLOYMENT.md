# Hướng dẫn triển khai HiTechCloud LandingPage

Tài liệu này mô tả từng bước đưa HiTechCloud LandingPage lên môi trường production: chuẩn bị máy chủ và tên miền, cấu hình, khởi chạy, các bước sau khi khởi chạy, sao lưu, cập nhật phiên bản, giám sát và xử lý sự cố.

Cách triển khai khuyến nghị là **Docker Compose + Caddy** (mục 4–7). Cách chạy trực tiếp bằng Node.js + systemd nằm ở mục 15. Xử lý sự cố từng bước: [docs/RUNBOOK.md](RUNBOOK.md).

## Cài đặt nhanh

Bộ công cụ trong [`deploy/`](../deploy/) làm thay các bước thủ công của tài liệu này; mỗi script có `--help`. Trên máy chủ Ubuntu 22.04/24.04 mới, sau khi đã trỏ DNS (mục 3):

```bash
# 1. Chuẩn bị máy chủ (root): cập nhật, Docker, tường lửa, swap, giới hạn log, múi giờ,
#    thư mục sao lưu /var/backups/hitechcloud thuộc người dùng vận hành "deploy" (mục 4.2)
sudo apt-get install -y git
sudo git clone https://github.com/hitechcloud-vietnam/HiTechCloudLandingPage.git /opt/hitechcloud
sudo /opt/hitechcloud/deploy/setup-server.sh --user deploy          # thêm --dry-run để xem trước
# (đăng nhập lại bằng người dùng deploy để nhận nhóm docker)
sudo chown -R deploy:deploy /opt/hitechcloud && cd /opt/hitechcloud

# 2. Tạo .env với khóa bí mật ngẫu nhiên, rồi điền SMTP_URL và khóa thanh toán
deploy/init-env.sh --app-domain app.hitechcloud.vn --publish-domain hitechcloud.site --admin-email admin@congty.vn
nano .env

# 3. Kiểm tra cấu hình, DNS, cổng, tài nguyên
deploy/preflight.sh

# 4. Khởi chạy (build từ mã nguồn) — hoặc dùng image dựng sẵn: deploy/update.sh --image v1.0.0
docker compose up -d --build

# 5. Kiểm tra từ bên ngoài
deploy/smoke-test.sh

# 6. Sao lưu hằng ngày lúc 02:30 (crontab của người dùng deploy)
( crontab -l 2>/dev/null; echo '30 2 * * * /opt/hitechcloud/deploy/backup.sh >> /var/log/hitechcloud-backup.log 2>&1' ) | crontab -
```

| Script | Việc làm | Mục |
|---|---|---|
| `deploy/setup-server.sh` | Chuẩn bị Ubuntu/Debian: gói, Docker + Compose, `daemon.json` giới hạn log, ufw 22/80/443, swap 2 GB khi RAM < 2 GB, fail2ban, cập nhật bảo mật tự động | 4 |
| `deploy/init-env.sh` | Tạo `.env` từ `.env.example`, sinh `LEAD_SECRET`/`METRICS_TOKEN`, quyền 600, không ghi đè `.env` có sẵn | 6 |
| `deploy/preflight.sh` | Kiểm tra `.env` (biến bắt buộc, `APP_URL` khớp `APP_DOMAIN`, tên miền tách biệt, cấu hình thanh toán/S3/Zalo đủ cặp), DNS trỏ đúng IP, cổng 80/443, đĩa, RAM | 6, 7 |
| `deploy/smoke-test.sh` | Kiểm tra bản triển khai đang chạy: health, trang, header bảo mật, 404, `APP_URL` đúng (chống CSRF), TLS ask, `/metrics`, website khách | 7 |
| `deploy/backup.sh` | Sao lưu trực tuyến DB + ảnh, kiểm tra toàn vẹn, checksum, xoay vòng, chép ra ngoài (rclone) | 13 |
| `deploy/restore.sh` | Khôi phục an toàn: checksum, sao lưu trước, kiểm tra trước khi thay, giữ dữ liệu cũ, tự khởi động lại khi lỗi | 13 |
| `deploy/update.sh` | Cập nhật (mã nguồn hoặc image), sao lưu trước, chờ healthy, smoke test, quay lui tự động | 14 |
| `deploy/test-stack.sh` | Kiểm thử toàn bộ các bước trên với stack thật trên `https://localhost` (chạy trong CI) | 21 |
| `deploy/native/*` | Unit systemd, Caddyfile và script sao lưu cho cách chạy không dùng Docker | 15 |

## Mục lục

0. [Cài đặt nhanh](#cài-đặt-nhanh)
1. [Kiến trúc tổng quan](#1-kiến-trúc-tổng-quan)
2. [Yêu cầu](#2-yêu-cầu)
3. [Tên miền và DNS](#3-tên-miền-và-dns)
4. [Chuẩn bị máy chủ](#4-chuẩn-bị-máy-chủ)
5. [Lấy mã nguồn](#5-lấy-mã-nguồn)
6. [Cấu hình biến môi trường (.env)](#6-cấu-hình-biến-môi-trường-env)
7. [Khởi chạy](#7-khởi-chạy)
8. [Việc cần làm ngay sau khi khởi chạy](#8-việc-cần-làm-ngay-sau-khi-khởi-chạy)
9. [Email (SMTP)](#9-email-smtp)
10. [Cổng thanh toán payOS và Pay2S](#10-cổng-thanh-toán-payos-và-pay2s)
11. [Lưu trữ ảnh trên S3](#11-lưu-trữ-ảnh-trên-s3)
12. [HTTPS, tên miền con và tên miền riêng của khách](#12-https-tên-miền-con-và-tên-miền-riêng-của-khách)
13. [Sao lưu và khôi phục](#13-sao-lưu-và-khôi-phục)
14. [Cập nhật phiên bản và quay lui](#14-cập-nhật-phiên-bản-và-quay-lui)
15. [Triển khai không dùng Docker](#15-triển-khai-không-dùng-docker)
16. [Giám sát, log và cảnh báo](#16-giám-sát-log-và-cảnh-báo)
17. [Bảo mật](#17-bảo-mật)
18. [Danh sách kiểm tra trước khi mở cho khách](#18-danh-sách-kiểm-tra-trước-khi-mở-cho-khách)
19. [Xử lý sự cố](#19-xử-lý-sự-cố)
20. [Giới hạn hiện tại và hướng mở rộng](#20-giới-hạn-hiện-tại-và-hướng-mở-rộng)
21. [Kiểm thử bộ công cụ triển khai](#21-kiểm-thử-bộ-công-cụ-triển-khai)

---

## 1. Kiến trúc tổng quan

```
                    Internet
                       │  80/443 (TCP), 443 (UDP, HTTP/3)
                ┌──────▼───────┐
                │    Caddy     │  HTTPS tự động (Let's Encrypt / ZeroSSL)
                │              │  - APP_DOMAIN: chứng chỉ cấp sẵn
                │              │  - <sub>.PUBLISH_ROOT_DOMAIN và tên miền riêng:
                │              │    cấp khi có lượt truy cập đầu tiên (on-demand),
                │              │    sau khi hỏi app qua /_htc/tls-ask
                └──────┬───────┘
                       │ http://app:3000 (mạng nội bộ Docker)
                ┌──────▼───────┐
                │  app (Node)  │  Express: dashboard, trình thiết kế GrapesJS, API,
                │              │  phục vụ trang đã xuất bản, nhận lead, webhook thanh toán,
                │              │  job nền mỗi giờ (nhắc gia hạn, dọn phiên hết hạn…)
                └──────┬───────┘
                       │
             volume app-data → /data
               ├── hitechcloud.db (+ -wal, -shm)   SQLite (chế độ WAL)
               ├── uploads/                        ảnh khách tải lên (khi không dùng S3)
               ├── lead-secret                     khóa ký form, tự sinh nếu không đặt LEAD_SECRET
               └── backups/                        bản sao lưu do scripts/backup.js tạo
```

Ba loại tên miền:

| Loại | Ví dụ | Dùng cho |
|---|---|---|
| `APP_DOMAIN` | `app.hitechcloud.vn` | Dashboard, trình thiết kế, API, trang quản trị, webhook thanh toán, đường dẫn xem trước `/p/<subdomain>` |
| `PUBLISH_ROOT_DOMAIN` | `hitechcloud.site` | Website của khách dạng `<subdomain>.hitechcloud.site` |
| Tên miền riêng | `www.khachhang.vn` | Website của khách sau khi xác minh TXT |

> **Nên dùng tên miền gốc khác nhau** cho dashboard (`hitechcloud.vn`) và trang của khách (`hitechcloud.site`). Trang của khách có thể chứa mã tùy chỉnh (gói Pro); khi tách tên miền gốc, mã đó không đọc được cookie đăng nhập dashboard.

Ứng dụng là **một tiến trình duy nhất** dùng SQLite. Không chạy nhiều bản sao `app` cùng lúc trên cùng một file database (xem mục 20).

## 2. Yêu cầu

### Máy chủ

| Quy mô | CPU | RAM | Ổ đĩa | Ghi chú |
|---|---|---|---|---|
| Thử nghiệm / dưới 100 khách | 1 vCPU | 1 GB (+ 1 GB swap) | 20 GB SSD | Đủ cho Docker build |
| Đến ~2.000 khách | 2 vCPU | 2–4 GB | 40–80 GB SSD | Nên dùng S3 cho ảnh |
| Lớn hơn | 4 vCPU | 8 GB | NVMe | Xem mục 20 |

- Hệ điều hành: Ubuntu Server 22.04/24.04 LTS hoặc Debian 12 (tài liệu dùng Ubuntu 24.04).
- IP công khai tĩnh (IPv4; IPv6 nếu có thì khai báo thêm bản ghi AAAA).
- Cổng mở ra Internet: **80/tcp**, **443/tcp**, **443/udp**. Cổng 80 bắt buộc để cấp chứng chỉ và chuyển hướng HTTPS.
- Nhà cung cấp gợi ý tại Việt Nam: Viettel IDC, VNPT, FPT Cloud, BizFly Cloud, Long Vân… Đặt máy chủ trong nước giúp tải trang nhanh hơn cho khách Việt Nam. Ghi vị trí máy chủ vào `/privacy` (mục 18).

### Phần mềm

- Docker Engine 24+ và plugin Docker Compose v2 (`docker compose`, không phải `docker-compose` bản cũ).
- Git.
- Nếu chạy không dùng Docker: Node.js **≥ 22.13** (cần module `node:sqlite`) và Caddy 2.8+.

### Tài khoản dịch vụ bên ngoài

| Dịch vụ | Bắt buộc? | Dùng để |
|---|---|---|
| Nhà đăng ký tên miền / DNS | Có | Trỏ tên miền về máy chủ |
| SMTP (email) | Có cho production | Xác minh email, đặt lại mật khẩu, lời mời, thông báo lead, biên nhận |
| payOS và/hoặc Pay2S | Khi thu phí | Thanh toán nâng cấp gói |
| S3-compatible (R2, MinIO, object storage trong nước) | Không | Lưu ảnh ngoài máy chủ |
| Slack/Discord webhook | Không | Cảnh báo lỗi |
| Prometheus/Grafana, Uptime Kuma | Không | Giám sát |

## 3. Tên miền và DNS

Giả sử IP máy chủ là `203.0.113.10`, dashboard là `app.hitechcloud.vn`, trang khách dùng `hitechcloud.site`.

| Tên | Loại | Giá trị | Mục đích |
|---|---|---|---|
| `app.hitechcloud.vn` | A | `203.0.113.10` | Dashboard (`APP_DOMAIN`) |
| `*.hitechcloud.site` | A | `203.0.113.10` | Mọi tên miền con của khách |
| `sites.hitechcloud.site` | A | `203.0.113.10` | Đích CNAME cho tên miền riêng (`CNAME_TARGET`); đã nằm trong wildcard, khai báo riêng cho rõ |
| `hitechcloud.vn` (tùy chọn) | A | IP trang giới thiệu | Trang chủ marketing có sẵn trong ứng dụng (`/`, `/terms`…) cũng phục vụ được trên `APP_DOMAIN` |

Có IPv6 thì thêm bản ghi AAAA tương ứng.

Kiểm tra trước khi khởi chạy (bản ghi phải trả về IP máy chủ):

```bash
dig +short app.hitechcloud.vn
dig +short test123.hitechcloud.site
dig +short sites.hitechcloud.site
```

**Nếu dùng Cloudflare làm DNS:** để các bản ghi trên ở chế độ **DNS only (đám mây xám)**. Lý do:

- Caddy cần nhận trực tiếp kết nối để cấp chứng chỉ on-demand cho tên miền con và tên miền riêng.
- Khi bật proxy (đám mây cam), ứng dụng thấy IP của Cloudflare thay vì IP khách. Giới hạn tần suất (đăng ký, gửi form, báo cáo vi phạm) sẽ áp cho cả nhóm khách dùng chung IP Cloudflare.

Nếu muốn bật proxy Cloudflare cho `APP_DOMAIN`, phải cấu hình Caddy tin header IP của Cloudflare (`trusted_proxies`) và chọn SSL mode "Full (strict)". Cách này không được mô tả trong tài liệu.

## 4. Chuẩn bị máy chủ

Các lệnh dưới đây chạy trên Ubuntu 24.04 với quyền root (hoặc `sudo`). `deploy/setup-server.sh` làm sẵn các mục 4.1, 4.3, 4.4, 4.5 (xem trước bằng `--dry-run`); mục 4.2 (khóa SSH) làm thủ công.

### 4.1. Cập nhật hệ thống và múi giờ

```bash
apt update && apt -y full-upgrade
timedatectl set-timezone Asia/Ho_Chi_Minh
apt -y install git curl ufw fail2ban unattended-upgrades jq sqlite3
dpkg-reconfigure -plow unattended-upgrades   # bật cập nhật bảo mật tự động
```

Ứng dụng lưu thời gian theo UTC trong database. Múi giờ máy chủ chỉ ảnh hưởng tới log hệ thống và lịch cron.

### 4.2. Tạo người dùng vận hành và khóa SSH

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
```

Trong `/etc/ssh/sshd_config`, đặt `PermitRootLogin no` và `PasswordAuthentication no`. Sau đó `systemctl restart ssh`. Hãy mở một phiên SSH mới bằng `deploy` để kiểm tra **trước khi** đóng phiên root.

### 4.3. Tường lửa

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw enable
```

> Docker tự thêm luật iptables cho các cổng được publish và **bỏ qua ufw**. Trong `docker-compose.yml` chỉ Caddy publish cổng (80/443). Container `app` không publish cổng 3000 ra ngoài; giữ nguyên như vậy.

### 4.4. Swap (máy chủ ≤ 2 GB RAM)

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 4.5. Cài Docker

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
docker --version && docker compose version
```

Giới hạn dung lượng log của Docker để log không làm đầy ổ đĩa. Tạo `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
```

```bash
systemctl restart docker
```

## 5. Lấy mã nguồn

```bash
sudo mkdir -p /opt/hitechcloud && sudo chown deploy:deploy /opt/hitechcloud
cd /opt/hitechcloud
git clone https://github.com/hitechcloud-vietnam/HiTechCloudLandingPage.git .
git checkout main          # nhánh phát hành
git log --oneline -1       # ghi lại commit đang triển khai
```

Nên triển khai từ một **tag phát hành** (vd `git checkout v1.0.0`) để dễ quay lui (mục 14). Danh sách phiên bản và ghi chú: trang **Releases** của repo và `CHANGELOG.md`. Mỗi tag cũng có image dựng sẵn `ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage:<tag>`; mặc định `docker-compose.yml` build từ mã nguồn; muốn dùng image dựng sẵn xem mục 14.3.

## 6. Cấu hình biến môi trường (.env)

```bash
deploy/init-env.sh --app-domain app.hitechcloud.vn --publish-domain hitechcloud.site --admin-email admin@congty.vn
nano .env          # điền SMTP_URL, khóa payOS/Pay2S, ERROR_WEBHOOK_URL…
deploy/preflight.sh
```

`init-env.sh` điền sẵn `NODE_ENV`, `APP_URL`, `APP_DOMAIN`, `ACME_EMAIL`, `PUBLISH_ROOT_DOMAIN`, `CNAME_TARGET` (`sites.<tên miền trang khách>`), `SUPERADMIN_EMAILS`, `MAIL_FROM`, sinh `LEAD_SECRET` và `METRICS_TOKEN` ngẫu nhiên, đặt quyền 600. Làm thủ công thì: `cp .env.example .env && chmod 600 .env`, tạo khóa bằng `openssl rand -hex 32`.

`preflight.sh` báo **lỗi** (thoát mã 1) khi thiếu biến bắt buộc, `NODE_ENV` khác `production`, `APP_URL` không đúng bằng `https://<APP_DOMAIN>`, dashboard nằm trong tên miền trang khách, cấu hình thanh toán/S3/Zalo chỉ điền một phần, DNS không trỏ về máy chủ; báo **cảnh báo** khi thiếu SMTP, cổng thanh toán, cảnh báo lỗi, quyền `.env` quá rộng, ít RAM/đĩa. Tùy chọn: `--ip <IP công khai>`, `--skip-dns` (trước khi trỏ DNS).

### 6.1. Bảng biến môi trường

**Cơ bản (bắt buộc)**

| Biến | Ví dụ | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `production` | Bật cookie `Secure`, HSTS, log JSON. **Bắt buộc là `production`** khi chạy thật |
| `APP_URL` | `https://app.hitechcloud.vn` | URL công khai của dashboard, không có `/` ở cuối. Dùng cho kiểm tra Origin (chống CSRF), liên kết trong email, URL trả về sau thanh toán. Phải khớp chính xác giao thức + tên miền mà trình duyệt dùng |
| `APP_DOMAIN` | `app.hitechcloud.vn` | Tên miền dashboard cho Caddy (không có `https://`) |
| `ACME_EMAIL` | `admin@congty.vn` | Email nhận thông báo từ Let's Encrypt/ZeroSSL |
| `PUBLISH_ROOT_DOMAIN` | `hitechcloud.site` | Tên miền gốc cho trang khách `<subdomain>.<PUBLISH_ROOT_DOMAIN>`. Để trống thì trang khách chỉ xem được qua `APP_URL/p/<subdomain>` |
| `CNAME_TARGET` | `sites.hitechcloud.site` | Tên máy chủ mà khách trỏ CNAME tên miền riêng về; hiển thị trong hướng dẫn DNS cho khách |
| `SUPERADMIN_EMAILS` | `admin@congty.vn,ops@congty.vn` | Email tài khoản quản trị nền tảng (vào `/app/admin`), phân tách bằng dấu phẩy |
| `SMTP_URL` | `smtps://user:pass@smtp.example.com:465` | Máy chủ gửi email (mục 9). Để trống thì email chỉ được in ra log |
| `MAIL_FROM` | `HiTechCloud <no-reply@hitechcloud.vn>` | Người gửi email |
| `LEAD_SECRET` | 64 ký tự hex | Khóa HMAC ký dấu thời gian trong form chống bot và ký liên kết hủy nhận email. Để trống thì hệ thống dẫn xuất từ khóa thanh toán/SMTP hoặc tự sinh và lưu ở `/data/lead-secret`. **Bắt buộc đặt cố định ở production**: nếu để trống, khi đổi khóa thanh toán/SMTP các liên kết hủy nhận email đã gửi sẽ hết hiệu lực |

**Do docker-compose đặt sẵn (không cần sửa)**

| Biến | Giá trị trong container |
|---|---|
| `DB_FILE` | `/data/hitechcloud.db` |
| `UPLOADS_DIR` | `/data/uploads` |
| `PORT` | `3000` |

**Phiên đăng nhập, pháp lý và an toàn nội dung**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `SESSION_DAYS` | `30` | Số ngày giữ đăng nhập |
| `REQUIRE_TERMS_CONSENT` | `1` | Đăng ký bắt buộc đồng ý Điều khoản/Chính sách (Nghị định 13/2023). Không nên tắt |
| `TERMS_VERSION` | `1` | Phiên bản điều khoản lưu cùng sự đồng ý của người dùng. **Tăng lên mỗi khi sửa `/terms` hoặc `/privacy`** |
| `SAFETY_AUTO_SUSPEND` | `1` | Tự tạm ngưng website khi trang vừa xuất bản có dấu hiệu giả mạo ngân hàng. `0` = chỉ gắn cờ chờ duyệt |

**Thanh toán (mục 10)**

| Biến | Ý nghĩa |
|---|---|
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | Khóa kênh thanh toán payOS. Đủ cả 3 thì payOS hiện trong tab Gói dịch vụ |
| `PAY2S_PARTNER_CODE`, `PAY2S_ACCESS_KEY`, `PAY2S_SECRET_KEY` | Khóa tích hợp Pay2S |
| `PAY2S_PARTNER_NAME` | Tên hiển thị trên trang thanh toán Pay2S |
| `PAY2S_ENV` | `sandbox` hoặc `production` |

**Lưu trữ ảnh S3 (mục 11)**

| Biến | Ý nghĩa |
|---|---|
| `S3_BUCKET` | Tên bucket. Để trống thì ảnh lưu trên đĩa (`/data/uploads`) |
| `S3_ENDPOINT` | Endpoint nhà cung cấp. Để trống = AWS S3 |
| `S3_REGION` | Vùng (`auto` với Cloudflare R2, `us-east-1` với MinIO) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Khóa truy cập |
| `S3_PUBLIC_URL` | URL công khai/CDN để trình duyệt tải ảnh |
| `S3_FORCE_PATH_STYLE` | `true` cho MinIO và nhiều nhà cung cấp trong nước |

**Zalo OA (thông báo lead qua Zalo)**

| Biến | Ý nghĩa |
|---|---|
| `ZALO_APP_ID`, `ZALO_APP_SECRET` | Ứng dụng Zalo for Developers của nền tảng (https://developers.zalo.me). Để trống thì kênh Zalo OA bị tắt. Mỗi website tự nhập refresh token của OA và ID người nhận trong Cài đặt website (xem README, mục "Zalo OA") |

**Giám sát (mục 16)**

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `LOG_FORMAT` | `json` khi production | `json` hoặc `pretty` |
| `METRICS_TOKEN` | trống (tắt) | Token Bearer cho `GET /metrics` |
| `ERROR_WEBHOOK_URL` | trống | Webhook Slack/Discord (https) nhận cảnh báo lỗi 5xx và sự cố tiến trình |

### 6.2. Ví dụ `.env` production

```dotenv
NODE_ENV=production
APP_URL=https://app.hitechcloud.vn
APP_DOMAIN=app.hitechcloud.vn
ACME_EMAIL=admin@hitechcloud.vn
PUBLISH_ROOT_DOMAIN=hitechcloud.site
CNAME_TARGET=sites.hitechcloud.site
SUPERADMIN_EMAILS=admin@hitechcloud.vn
SESSION_DAYS=30
LEAD_SECRET=<openssl rand -hex 32>
REQUIRE_TERMS_CONSENT=1
TERMS_VERSION=1
SAFETY_AUTO_SUSPEND=1

SMTP_URL=smtps://no-reply%40hitechcloud.vn:<mat-khau>@smtp.example.com:465
MAIL_FROM=HiTechCloud <no-reply@hitechcloud.vn>

PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...

LOG_LEVEL=info
LOG_FORMAT=json
METRICS_TOKEN=<openssl rand -hex 32>
ERROR_WEBHOOK_URL=https://hooks.slack.com/services/...
```

> Ký tự đặc biệt trong mật khẩu SMTP phải được mã hóa URL: `@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`. Mã hóa nhanh: `node -e "console.log(encodeURIComponent(process.argv[1]))" 'mat:khau@1'`.

## 7. Khởi chạy

```bash
cd /opt/hitechcloud
docker compose up -d --build
docker compose ps
docker compose logs -f app      # Ctrl+C để thoát
```

Khi chạy thành công, log có dòng `HiTechCloud LandingPage đang chạy tại https://app.hitechcloud.vn (port 3000)` và trạng thái `app` chuyển sang `healthy` sau khoảng 30 giây.

Kiểm tra (trên máy chủ hoặc bất kỳ máy nào có repo):

```bash
deploy/smoke-test.sh                               # dùng APP_URL trong .env
deploy/smoke-test.sh --url https://app.hitechcloud.vn --site demo    # thêm website khách demo.<PUBLISH_ROOT_DOMAIN>
deploy/smoke-test.sh --resolve 203.0.113.10       # thử máy chủ mới trước khi đổi DNS
```

Script kiểm tra `/healthz`, `/readyz`, trang chủ, trang đăng nhập và các header bảo mật (HSTS, nosniff, X-Frame-Options), trang 404, đăng nhập sai trả 401 (nếu trả 403 "Origin không hợp lệ" là `APP_URL` sai), `/_htc/tls-ask` từ chối tên miền lạ, `/metrics` yêu cầu token. Thủ công: `curl -fsS https://app.hitechcloud.vn/healthz` phải trả `{"ok":true}`.

Lần đầu truy cập, Caddy mất vài giây để lấy chứng chỉ. Xem log Caddy: `docker compose logs -f caddy`.

Database được tạo và **migrate tự động** mỗi lần ứng dụng khởi động. Không có bước migrate thủ công.

## 8. Việc cần làm ngay sau khi khởi chạy

1. **Tạo tài khoản quản trị:** mở `https://app.hitechcloud.vn/app/signup` và đăng ký bằng một email có trong `SUPERADMIN_EMAILS`.
2. **Xác minh email:** mở liên kết trong email xác minh. Nếu chưa cấu hình SMTP, tìm liên kết trong log:
   ```bash
   docker compose logs app | grep -o 'https://[^ "]*/api/auth/verify?token=[A-Za-z0-9_-]*' | tail -1
   ```
3. **Vào trang quản trị** `https://app.hitechcloud.vn/app/admin` và kiểm tra các tab Khách hàng, Giao dịch, Mã giảm giá, An toàn nội dung.
4. **Thử luồng chính:** tạo website từ mẫu → sửa trong trình thiết kế → Xuất bản → mở `https://<subdomain>.hitechcloud.site` (lần đầu chờ vài giây để cấp chứng chỉ) → gửi form → kiểm tra lead trong tab "Khách hàng tiềm năng" và email thông báo.
5. **Thử thanh toán** ở chế độ sandbox (mục 10).
6. **Điền thông tin pháp lý:** thay các chỗ `[...]` trong `public/terms.html`, `public/privacy.html`, `public/refund.html`, `public/contact.html`, trang chủ (`public/index.html`) và JSON-LD (xem README, mục "Trang pháp lý"). Nhờ luật sư rà soát rồi xóa khối `<div class="legal-notice">`. Sau khi sửa, build lại: `docker compose up -d --build`.
7. **Thay tên miền mẫu** `https://hitechcloud.vn` trong thẻ canonical/Open Graph, `public/robots.txt`, `public/sitemap.xml` nếu tên miền thật khác.
8. **Bật sao lưu tự động** (mục 13) và **giám sát** (mục 16).
9. **Email vòng đời** chạy tự động trong tiến trình nền mỗi giờ: email chào mừng ngay khi đăng ký, email nhắc xuất bản trang sau 3 ngày, email tóm tắt lead sáng thứ Hai (08:00 giờ Việt Nam). Không cần cấu hình thêm ngoài SMTP và `LEAD_SECRET` cố định. Ứng dụng phải chạy liên tục (không tắt vào sáng thứ Hai) để tóm tắt tuần được gửi.

## 9. Email (SMTP)

Định dạng `SMTP_URL`:

- `smtps://user:pass@host:465` — SSL/TLS ngay từ đầu (cổng 465).
- `smtp://user:pass@host:587` — STARTTLS (cổng 587).

Ví dụ:

| Nhà cung cấp | `SMTP_URL` |
|---|---|
| Google Workspace (mật khẩu ứng dụng) | `smtps://no-reply%40congty.vn:<app-password>@smtp.gmail.com:465` |
| Amazon SES (Singapore) | `smtp://<SMTP-user>:<SMTP-pass>@email-smtp.ap-southeast-1.amazonaws.com:587` |
| Zoho Mail | `smtps://no-reply%40congty.vn:<pass>@smtp.zoho.com:465` |
| Máy chủ mail riêng / nhà cung cấp trong nước | Theo thông số nhà cung cấp |

Để email không vào thư rác, cấu hình DNS cho tên miền gửi (`hitechcloud.vn`):

- **SPF:** bản ghi TXT `v=spf1 include:<nhà-cung-cấp> ~all`.
- **DKIM:** bản ghi do nhà cung cấp email cấp.
- **DMARC:** TXT `_dmarc.hitechcloud.vn` = `v=DMARC1; p=quarantine; rua=mailto:dmarc@hitechcloud.vn`.

Kiểm tra: dùng "Quên mật khẩu" với tài khoản của bạn; theo dõi `docker compose logs -f app` để xem lỗi gửi email nếu có. Gmail cá nhân giới hạn khoảng 500 email/ngày, không phù hợp production.

## 10. Cổng thanh toán payOS và Pay2S

Cổng nào có đủ biến môi trường thì xuất hiện trong tab **Gói dịch vụ** của khách. Giá gói nằm trong `src/plans.js` (Miễn phí 0đ, Pro 199.000đ/tháng, Business 599.000đ/tháng; có chu kỳ nhiều tháng). Sửa giá thì cập nhật cả JSON-LD trên trang chủ.

### 10.1. payOS

1. Đăng nhập https://my.payos.vn → tạo **Kênh thanh toán** gắn với tài khoản ngân hàng doanh nghiệp.
2. Lấy **Client ID**, **API Key**, **Checksum Key** → điền `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`.
3. Khai báo **Webhook URL**: `https://app.hitechcloud.vn/api/billing/webhooks/payos`. Ứng dụng trả 200 cho sự kiện kiểm tra của payOS.
4. Khởi động lại: `docker compose up -d`.
5. Thử: tạo tài khoản khách → tab Gói dịch vụ → chọn Pro → payOS → thanh toán số tiền nhỏ (có thể tạo mã giảm giá trong `/app/admin` để giảm giá trị thử) → kiểm tra gói chuyển sang Pro, đơn ở trạng thái đã thanh toán trong tab Giao dịch và có email biên nhận.

Gói được kích hoạt khi payOS gửi webhook. Nếu webhook đến chậm, ứng dụng kiểm tra trạng thái đơn lúc khách quay về trang `/billing/return/payos`.

### 10.2. Pay2S

1. Lấy `partnerCode`, `accessKey`, `secretKey` trong trang quản trị Pay2S.
2. Bắt đầu với `PAY2S_ENV=sandbox`. IPN URL được gửi kèm mỗi giao dịch: `https://app.hitechcloud.vn/api/billing/webhooks/pay2s` (không cần khai báo riêng, trừ khi Pay2S yêu cầu đăng ký trước).
3. **Bắt buộc chạy thử sandbox** trước khi bật `production`. Tích hợp Pay2S được viết theo gói cộng đồng `pay2s-node`, không phải SDK chính thức; cần xác nhận tên trường URL thanh toán trả về (`payUrl`), mã thành công (`resultCode = 0`) và nội dung phản hồi IPN.

### 10.3. Lưu ý chung

- Webhook phải đến được `APP_URL` qua HTTPS với chứng chỉ hợp lệ.
- Đơn chưa thanh toán sau 1 ngày tự chuyển sang "đã hủy" (job nền).
- Nâng/hạ gói giữa kỳ được tính theo tỷ lệ thời gian còn lại.
- **Hóa đơn VAT:** ứng dụng chưa kết nối API nhà cung cấp hóa đơn điện tử. Khách nhập *Thông tin xuất hóa đơn* (tên đơn vị, mã số thuế, địa chỉ, email) và gửi yêu cầu cho từng đơn đã thanh toán (hoặc bật tự động). Kế toán vào `/app/admin` → tab **Hóa đơn VAT**, xuất CSV, phát hành trên phần mềm hóa đơn điện tử (MISA/VNPT/Viettel…), rồi bấm **Đã xuất** để nhập số hóa đơn và mã tra cứu; khách nhận email kèm thông tin tra cứu. Phân công người kiểm tra tab này hằng ngày vì chưa có email báo khi có yêu cầu mới.

## 11. Lưu trữ ảnh trên S3

Mặc định ảnh lưu trong volume Docker (`/data/uploads`) và phục vụ qua `/uploads/…`. Chuyển sang S3 khi muốn tách dữ liệu ảnh khỏi máy chủ, dùng CDN hoặc máy chủ sắp hết dung lượng.

Ứng dụng tải ảnh lên S3 từ phía máy chủ (chữ ký SigV4), trình duyệt **không** tải trực tiếp lên bucket nên không cần cấu hình CORS. Bucket (hoặc CDN phía trước) phải **cho phép đọc công khai** để trang của khách hiển thị ảnh.

| Nhà cung cấp | Cấu hình |
|---|---|
| Cloudflare R2 | `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_FORCE_PATH_STYLE=true`, `S3_PUBLIC_URL=https://cdn.hitechcloud.vn` (tên miền tùy chỉnh gắn vào bucket) |
| AWS S3 | Để trống `S3_ENDPOINT`, `S3_REGION=ap-southeast-1` |
| MinIO tự host | `S3_ENDPOINT=http://minio:9000`, `S3_REGION=us-east-1`, `S3_FORCE_PATH_STYLE=true`, `S3_PUBLIC_URL` trỏ tới tên miền công khai của MinIO |
| Object storage trong nước (Viettel, VNPT, FPT, BizFly…) | Theo endpoint nhà cung cấp, thường `S3_FORCE_PATH_STYLE=true` |

Lưu ý:

- Ảnh đã tải lên trước khi chuyển sang S3 **vẫn nằm trên đĩa** và vẫn phục vụ qua `/uploads/…`. Giữ volume `app-data`; không có công cụ tự chuyển ảnh cũ.
- Khi xóa ảnh, workspace hoặc tài khoản, ứng dụng xóa luôn đối tượng tương ứng trên S3 hoặc đĩa.
- Hạn mức dung lượng theo gói được tính theo tổng dung lượng ảnh của workspace, không phụ thuộc nơi lưu.

## 12. HTTPS, tên miền con và tên miền riêng của khách

### 12.1. Cách cấp chứng chỉ

- `APP_DOMAIN`: Caddy lấy chứng chỉ khi khởi động. Tùy cách Caddy gom chính sách cấp chứng chỉ, tên miền dashboard cũng có thể đi qua bước hỏi `tls-ask` bên dưới; ứng dụng luôn trả 200 cho host của `APP_URL` nên dashboard luôn có chứng chỉ.
- Tên miền con của khách và tên miền riêng: Caddy lấy chứng chỉ ở **lượt truy cập HTTPS đầu tiên** (on-demand TLS). Trước khi lấy, Caddy hỏi `http://app:3000/_htc/tls-ask?domain=<host>`; ứng dụng chỉ trả 200 khi host là tên miền con của một website đang hoạt động hoặc tên miền riêng **đã xác minh**, và website không bị tạm ngưng. Nhờ vậy kẻ xấu không thể bắt Caddy xin chứng chỉ cho tên miền tùy ý.

### 12.2. Giới hạn của Let's Encrypt và chứng chỉ wildcard

Let's Encrypt giới hạn **50 chứng chỉ mỗi tuần cho mỗi tên miền đăng ký** (vd `hitechcloud.site`). Mỗi tên miền con của khách được cấp chứng chỉ riêng, nên khi có hơn ~50 website mới mỗi tuần sẽ chạm giới hạn. Caddy tự chuyển sang ZeroSSL khi Let's Encrypt từ chối, nhưng với quy mô lớn nên dùng **chứng chỉ wildcard** `*.hitechcloud.site` qua thử thách DNS.

Ví dụ với DNS Cloudflare (cần bản Caddy có module `caddy-dns/cloudflare`):

1. Tạo `deploy/Dockerfile.caddy`:
   ```dockerfile
   FROM caddy:2.10-builder-alpine AS builder
   RUN xcaddy build --with github.com/caddy-dns/cloudflare
   FROM caddy:2.10-alpine
   COPY --from=builder /usr/bin/caddy /usr/bin/caddy
   ```
2. Trong `docker-compose.yml`, thay `image: caddy:2.10-alpine` bằng `build: { context: ., dockerfile: deploy/Dockerfile.caddy }` và thêm biến `CF_API_TOKEN` (token Cloudflare có quyền `Zone.DNS:Edit` cho `hitechcloud.site`) vào `environment` của service `caddy`.
3. Thêm vào `deploy/Caddyfile`, **trước** khối `https://`:
   ```caddyfile
   *.{$PUBLISH_ROOT_DOMAIN} {
   	tls {
   		dns cloudflare {env.CF_API_TOKEN}
   	}
   	encode zstd gzip
   	reverse_proxy app:3000
   }
   ```
   và thêm `PUBLISH_ROOT_DOMAIN: ${PUBLISH_ROOT_DOMAIN}` vào `environment` của `caddy`.
4. `docker compose up -d --build`.

Tên miền riêng của khách vẫn dùng on-demand TLS; giới hạn Let's Encrypt áp theo từng tên miền của khách nên không bị ảnh hưởng.

### 12.3. Tên miền riêng của khách (gói Pro trở lên)

Khách nhập tên miền trong tab **Cài đặt** của website, hệ thống hiển thị hai bản ghi cần tạo:

| Bản ghi | Tên | Giá trị | Mục đích |
|---|---|---|---|
| TXT | `_htc-verify.www.khachhang.vn` | `htc-verify=<mã>` | Chứng minh quyền sở hữu (bắt buộc) |
| CNAME | `www.khachhang.vn` | `sites.hitechcloud.site` (`CNAME_TARGET`) | Trỏ lưu lượng về máy chủ |

Sau khi bản ghi có hiệu lực, khách bấm **Kiểm tra DNS**. Chỉ tên miền đã xác minh TXT mới được phục vụ và cấp chứng chỉ. Tên miền đã khai báo nhưng chưa xác minh quá 72 giờ có thể được website khác khai báo lại.

Tên miền gốc (`khachhang.vn`, không có `www`) không đặt được CNAME ở nhiều nhà cung cấp DNS; khi đó khách dùng bản ghi A trỏ về IP máy chủ, hoặc tính năng CNAME flattening/ALIAS của nhà cung cấp DNS.

## 13. Sao lưu và khôi phục

Dữ liệu cần sao lưu đều nằm trong volume `app-data` (`/data` trong container):

| Thành phần | Cách sao lưu |
|---|---|
| `hitechcloud.db` | `VACUUM INTO` (qua `scripts/backup.js`), nhất quán khi ứng dụng đang chạy. **Không** copy trực tiếp file `.db` khi ứng dụng đang chạy vì dữ liệu mới có thể còn trong file `-wal` |
| `uploads/` | Nén thư mục (chỉ cần khi không dùng S3, hoặc còn ảnh cũ trên đĩa) |
| `lead-secret` | Chỉ có khi không đặt `LEAD_SECRET` |
| `.env` | Lưu riêng ở nơi an toàn (trình quản lý mật khẩu). Không đưa vào Git |

### 13.1. Sao lưu: `deploy/backup.sh`

```bash
cd /opt/hitechcloud
deploy/backup.sh                                  # mặc định vào /var/backups/hitechcloud, giữ 14 ngày
deploy/backup.sh --dest /mnt/backup --keep-days 30
```

Script làm lần lượt:

1. Tạo bản sao nhất quán trong volume bằng `VACUUM INTO`.
2. Chạy `PRAGMA integrity_check` trên bản sao; lỗi thì dừng và báo.
3. Chép ra `hitechcloud-<thời điểm>.db` (quyền 600), xóa bản tạm trong volume.
4. Nén `uploads/` và `lead-secret` (nếu có) thành `files-<thời điểm>.tar.gz`.
5. Ghi `SHA256SUMS-<thời điểm>` để kiểm tra khi khôi phục.
6. Xóa bản cũ hơn số ngày giữ lại; chép ra ngoài máy chủ nếu đặt `--remote` / `BACKUP_REMOTE`.

Các script chạy bằng người dùng vận hành (thuộc nhóm `docker`). `setup-server.sh --user deploy` đã tạo `/var/backups/hitechcloud` (quyền 700) và `/var/log/hitechcloud-backup.log` thuộc người dùng này. Đặt lịch (02:30 hằng ngày) bằng `crontab -e` của người dùng đó:

```cron
30 2 * * * BACKUP_REMOTE=offsite:hitechcloud-backups /opt/hitechcloud/deploy/backup.sh >> /var/log/hitechcloud-backup.log 2>&1
```

### 13.2. Sao lưu ra ngoài máy chủ

Bản sao lưu nằm trên cùng máy chủ không bảo vệ được khi mất máy chủ. Cấu hình `rclone` (đã cài bởi `deploy/setup-server.sh`):

```bash
rclone config             # tạo remote "offsite" (S3/R2/Google Drive…), nên thêm remote kiểu "crypt" để mã hóa
deploy/backup.sh --remote offsite:hitechcloud-backups
```

`--remote` chỉ chép các file của 25 giờ gần nhất. Nên mã hóa bản sao lưu ngoài máy chủ vì database chứa dữ liệu cá nhân của khách và lead (Nghị định 13/2023).

### 13.3. Khôi phục: `deploy/restore.sh`

```bash
cd /opt/hitechcloud
ls -lt /var/backups/hitechcloud | head
deploy/restore.sh /var/backups/hitechcloud/hitechcloud-20261014-023000.db \
                       /var/backups/hitechcloud/files-20261014-023000.tar.gz
deploy/smoke-test.sh
```

Thứ tự an toàn mà script áp dụng:

1. Kiểm tra checksum (`SHA256SUMS-…`), hỏi xác nhận (gõ `KHOI PHUC`, hoặc `--yes` khi chạy tự động).
2. Sao lưu dữ liệu hiện tại vào `<thư mục bản sao lưu>/pre-restore/` (bỏ qua bằng `--no-safety-backup`).
3. Dừng `app`, chép bản sao lưu vào vùng tạm và chạy `integrity_check`.
4. Chỉ khi bản sao lưu hợp lệ mới thay dữ liệu đang dùng. Dữ liệu cũ được chuyển vào `/data/restore-old/<thời điểm>/`, không bị xóa.
5. Khởi động `app` và chờ đến khi healthy. Nếu bất kỳ bước nào lỗi, dữ liệu đang dùng được giữ nguyên và `app` được khởi động lại.

Kiểm tra xong thì xóa `/data/restore-old/…`:

```bash
docker compose exec app rm -rf /data/restore-old
```

Nên **diễn tập khôi phục** mỗi quý trên một máy chủ thử. Toàn bộ quy trình sao lưu → khôi phục được CI kiểm thử tự động (mục 21).

## 14. Cập nhật phiên bản và quay lui

### 14.1. Cập nhật: `deploy/update.sh`

```bash
cd /opt/hitechcloud
deploy/update.sh                        # build từ mã nguồn: git pull --ff-only nhánh hiện tại
deploy/update.sh --ref v1.1.0           # build từ mã nguồn: chuyển sang tag/nhánh/commit
deploy/update.sh --image v1.1.0         # dùng image dựng sẵn ghcr.io/…:v1.1.0 (mục 14.3)
deploy/update.sh --image v1.1.0 --auto-rollback
```

Script lần lượt: kiểm tra `.env` (`preflight.sh`) → sao lưu (`backup.sh`, bỏ bằng `--no-backup`) → chuyển phiên bản → chờ `app` healthy → chạy `smoke-test.sh`. Nếu phiên bản mới không healthy hoặc smoke test lỗi:

- có `--auto-rollback`: tự quay về commit/image trước và chờ healthy;
- không có: in ra đúng lệnh quay lui.

Lưu ý:

- Migrate database chạy tự động khi khởi động; các thay đổi schema chỉ **thêm** bảng/cột.
- Gián đoạn khoảng vài giây khi container `app` được tạo lại (ứng dụng dừng nhẹ nhàng khi nhận SIGTERM, chờ request đang xử lý tối đa 10 giây).
- Trước khi cập nhật, đọc `CHANGELOG.md` và các biến mới: `git diff <tag-cũ>..<tag-mới> -- .env.example`.
- Dọn image cũ định kỳ: `docker image prune -f`.

### 14.2. Quay lui thủ công

```bash
git checkout <commit-hoặc-tag-trước> && docker compose up -d --build                       # build từ mã nguồn
sed -i 's|^APP_IMAGE=.*|APP_IMAGE=ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage:v1.0.0|' .env \
  && docker compose up -d --no-build                                                     # image dựng sẵn
```

Mã cũ thường chạy được trên database mới vì migrate chỉ thêm cột/bảng. Nếu phiên bản mới đã ghi dữ liệu mà mã cũ không hiểu, khôi phục bản sao lưu `update.sh` đã tạo trước khi cập nhật (mục 13.3); dữ liệu phát sinh sau thời điểm đó sẽ mất.

### 14.3. Dùng image dựng sẵn thay vì build trên máy chủ

Mỗi bản phát hành có image `ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage:<tag>` (và `:latest`), do workflow `release.yml` tạo. Dùng image giúp cập nhật nhanh hơn và không cần RAM để build.

```bash
deploy/update.sh --image v1.0.0          # ghi APP_IMAGE vào .env, pull và khởi động lại
```

Nếu package trên GHCR để private, đăng nhập một lần bằng token chỉ có quyền `read:packages`: `echo <TOKEN> | docker login ghcr.io -u <github-user> --password-stdin`. Muốn quay lại build từ mã nguồn: để trống `APP_IMAGE=` trong `.env`.

## 15. Triển khai không dùng Docker

Dùng khi máy chủ không cài được Docker hoặc muốn quản lý bằng systemd. Các file mẫu nằm trong `deploy/native/`.

### 15.1. Cài Node.js 22 và mã nguồn

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v                                   # phải ≥ v22.13
sudo useradd --system --home /opt/hitechcloud --shell /usr/sbin/nologin htc
sudo mkdir -p /opt/hitechcloud /var/lib/hitechcloud /var/backups/hitechcloud
sudo chown deploy:deploy /opt/hitechcloud
cd /opt/hitechcloud && git clone https://github.com/hitechcloud-vietnam/HiTechCloudLandingPage.git . && git checkout main
npm ci --omit=dev
sudo chown -R htc:htc /var/lib/hitechcloud /var/backups/hitechcloud
deploy/init-env.sh --app-domain app.hitechcloud.vn --publish-domain hitechcloud.site --admin-email admin@congty.vn
sudo chown deploy:htc .env && sudo chmod 640 .env
```

Trong `.env`, sửa 3 dòng sau (giá trị mặc định là đường dẫn trong Docker):

```dotenv
DB_FILE=/var/lib/hitechcloud/hitechcloud.db
UPLOADS_DIR=/var/lib/hitechcloud/uploads
PORT=3000
```

### 15.2. Dịch vụ systemd

```bash
sudo cp deploy/native/hitechcloud.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hitechcloud
sudo systemctl status hitechcloud
journalctl -u hitechcloud -f
```

Unit chạy bằng người dùng `htc`, chỉ được ghi vào `/var/lib/hitechcloud` (`ProtectSystem=strict`). Biến môi trường lấy từ `.env` qua `EnvironmentFile`.

### 15.3. Caddy chạy trực tiếp

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
sudo cp deploy/native/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile            # thay app.hitechcloud.vn và email
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

### 15.4. Sao lưu, cập nhật

```bash
sudo -u htc /opt/hitechcloud/deploy/native/backup.sh               # vào /var/backups/hitechcloud, giữ 14 ngày
# cron của người dùng htc: 30 2 * * * /opt/hitechcloud/deploy/native/backup.sh
git pull --ff-only && npm ci --omit=dev && sudo systemctl restart hitechcloud
deploy/smoke-test.sh
```

Khôi phục: `sudo systemctl stop hitechcloud`, chép file `.db` vào `/var/lib/hitechcloud/hitechcloud.db` (xóa `hitechcloud.db-wal`, `hitechcloud.db-shm` cũ), giải nén `files-….tar.gz` vào `/var/lib/hitechcloud`, `sudo chown -R htc:htc /var/lib/hitechcloud`, rồi `sudo systemctl start hitechcloud`.

## 16. Giám sát, log và cảnh báo

### 16.1. Kiểm tra sức khỏe

| Endpoint | Ý nghĩa | Dùng cho |
|---|---|---|
| `GET /healthz` | Tiến trình chạy và đọc được database | Healthcheck Docker, giám sát uptime |
| `GET /readyz` | Database nhận được khóa ghi | Kiểm tra sau khi cập nhật/khôi phục |

Giám sát từ bên ngoài bằng Uptime Kuma, UptimeRobot hoặc Better Stack: kiểm tra `https://app.hitechcloud.vn/healthz` mỗi 1 phút, cảnh báo khi 2 lần liên tiếp thất bại. Thêm một kiểm tra tới trang của một website mẫu (`https://demo.hitechcloud.site/`) để phát hiện lỗi chứng chỉ trên tên miền con.

### 16.2. Log

- Mỗi dòng log là một JSON (`LOG_FORMAT=json`), có `reqId` để tra theo mã lỗi người dùng báo (`requestId` trong phản hồi lỗi 500).
- Dữ liệu nhạy cảm (mật khẩu, token, cookie, khóa API, chữ ký thanh toán) luôn bị che `[REDACTED]`; log truy cập không ghi query string.

```bash
docker compose logs -f app
docker compose logs --no-log-prefix app --since 1h | jq -cR 'fromjson? | select(.level == "error")'
docker compose logs --no-log-prefix app --since 1h | jq -cR 'fromjson? | select(.reqId == "<requestId>")'
```

Muốn tập trung log: dùng Grafana Loki (promtail đọc log container Docker) hoặc Vector/Fluent Bit gửi về ELK.

### 16.3. Prometheus

Đặt `METRICS_TOKEN`, sau đó cấu hình Prometheus:

```yaml
scrape_configs:
  - job_name: hitechcloud
    scheme: https
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ["app.hitechcloud.vn"]
```

Gợi ý cảnh báo:

| Cảnh báo | Biểu thức PromQL |
|---|---|
| Tỷ lệ lỗi 5xx > 2% trong 5 phút | `sum(rate(http_requests_total{status_class="5xx"}[5m])) / sum(rate(http_requests_total[5m])) > 0.02` |
| Độ trễ p95 > 1 giây | `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) > 1` |
| Event loop bị nghẽn | `nodejs_eventloop_lag_seconds{quantile="0.99"} > 0.2` |
| Bộ nhớ > 1 GB | `process_resident_memory_bytes > 1e9` |
| Không có lead nào trong 24 giờ (khi đã có khách) | `hitechcloud_leads_today == 0` (đánh giá vào cuối ngày) |

Chỉ số kinh doanh có sẵn: `hitechcloud_users`, `hitechcloud_workspaces`, `hitechcloud_workspaces_paid{plan}`, `hitechcloud_sites`, `hitechcloud_pages_published`, `hitechcloud_leads_today`.

### 16.4. Cảnh báo lỗi tức thời

Đặt `ERROR_WEBHOOK_URL` (Slack incoming webhook hoặc Discord webhook, bắt buộc https). Ứng dụng gửi cảnh báo khi có lỗi 5xx, promise bị từ chối không xử lý, hoặc exception không bắt được (sau đó tiến trình thoát và Docker/systemd khởi động lại). Mỗi loại lỗi gửi tối đa 1 lần/phút.

### 16.5. Dung lượng đĩa

```bash
df -h /
docker system df
docker compose exec app sh -c 'du -sh /data/hitechcloud.db* /data/uploads /data/backups 2>/dev/null'
```

Cảnh báo khi đĩa dùng > 80%. Khi SQLite đầy đĩa, mọi thao tác ghi (đăng ký, gửi form) đều lỗi.

## 17. Bảo mật

Ứng dụng đã có sẵn:

- Cookie phiên `HttpOnly`, `SameSite=Lax`, `Secure` khi `NODE_ENV=production`; HSTS trên dashboard.
- Chống CSRF: kiểm tra `Origin` khớp `APP_URL` và chỉ nhận body JSON cho `/api`.
- Trang của khách ở đường dẫn `/p/…` trên dashboard chạy trong CSP `sandbox`. Trang trên tên miền con/tên miền riêng tách khỏi cookie dashboard nhờ tên miền gốc khác nhau.
- Giới hạn tần suất cho đăng ký, đăng nhập, quên mật khẩu, gửi form, báo cáo vi phạm, API v1.
- Chống SSRF cho webhook gửi đi (chặn IP nội bộ khi kết nối).
- Phát hiện trang lừa đảo, tạm ngưng website/tài khoản, HTTP 451.

Việc của người vận hành:

- [ ] `NODE_ENV=production` và `APP_URL` dùng `https://`.
- [ ] Tên miền gốc của trang khách **khác** tên miền dashboard.
- [ ] `.env` quyền `600`, không đưa vào Git; khóa thanh toán chỉ người cần mới xem được.
- [ ] SSH chỉ dùng khóa, tắt đăng nhập root, bật `fail2ban` và cập nhật bảo mật tự động.
- [ ] Chỉ mở cổng 22, 80, 443. Không publish cổng 3000.
- [ ] `SUPERADMIN_EMAILS` chỉ gồm người thật sự cần; các tài khoản này nên dùng mật khẩu mạnh, riêng.
- [ ] Sao lưu mã hóa khi đưa ra ngoài máy chủ; diễn tập khôi phục.
- [ ] Theo dõi tab **An toàn nội dung** trong `/app/admin` hằng ngày; xử lý báo cáo vi phạm trong 24 giờ.
- [ ] Đổi khóa ngay khi nghi lộ: khóa payOS/Pay2S (tạo lại trên cổng), `METRICS_TOKEN`, mật khẩu SMTP. Đổi `LEAD_SECRET` làm các form đang mở quá 24 giờ phải tải lại trang (không ảnh hưởng dữ liệu).
- [ ] Bật GitHub secret scanning và Dependabot cho repo; chạy `npm audit --omit=dev` trước mỗi lần phát hành.

## 18. Danh sách kiểm tra trước khi mở cho khách

**Hạ tầng**
- [ ] DNS: `APP_DOMAIN`, `*.PUBLISH_ROOT_DOMAIN`, `CNAME_TARGET` trỏ đúng IP (mục 3).
- [ ] HTTPS hoạt động trên dashboard và một tên miền con thử.
- [ ] `/healthz` và `/readyz` trả `{"ok":true}`.
- [ ] Sao lưu tự động chạy, có bản sao ngoài máy chủ, đã thử khôi phục.
- [ ] Giám sát uptime và cảnh báo lỗi gửi được tới kênh của đội vận hành.
- [ ] Giới hạn log Docker và cảnh báo dung lượng đĩa.

**Ứng dụng**
- [ ] SMTP gửi được, email không vào thư rác (SPF/DKIM/DMARC).
- [ ] Đã thử: đăng ký → xác minh email → tạo website → xuất bản → gửi form → nhận lead và email thông báo.
- [ ] Thanh toán payOS thật với số tiền nhỏ thành công; Pay2S đã thử trên sandbox trước khi bật production.
- [ ] Tài khoản quản trị vào được `/app/admin`.
- [ ] `LEAD_SECRET` đã đặt cố định.
- [ ] Đã phân công người xử lý tab **Hóa đơn VAT** và **An toàn nội dung** trong `/app/admin`.
- [ ] (Nếu dùng Zalo OA) đã đặt `ZALO_APP_ID`/`ZALO_APP_SECRET` và bấm **Gửi thử Zalo** thành công trên một website thử.

**Pháp lý (Việt Nam)**
- [ ] Điền đủ thông tin doanh nghiệp (mã số thuế, địa chỉ, người đại diện, số điện thoại) trong `/contact`, `/terms`, `/privacy`, `/refund`, chân trang và JSON-LD.
- [ ] Luật sư đã rà soát các trang pháp lý; đã xóa dòng "Bản mẫu".
- [ ] `/privacy` ghi đúng nơi đặt máy chủ, các bên xử lý dữ liệu (SMTP, S3, máy chủ), thời hạn lưu trữ, người phụ trách bảo vệ dữ liệu cá nhân.
- [ ] Đã đặt `TERMS_VERSION` khớp phiên bản điều khoản công bố.
- [ ] Hồ sơ đánh giá tác động xử lý dữ liệu cá nhân theo Nghị định 13/2023 (nếu thuộc diện phải lập).
- [ ] Thông báo website thương mại điện tử với Bộ Công Thương (online.gov.vn) nếu thuộc diện phải thông báo.
- [ ] Cổng thanh toán đã duyệt website (payOS/Pay2S thường yêu cầu trang chính sách đầy đủ).

## 19. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Đăng nhập/lưu bị lỗi 403 "Origin không hợp lệ" | `APP_URL` không khớp địa chỉ trình duyệt dùng (sai `https`, thừa `/`, khác `www`) | Sửa `APP_URL` cho khớp chính xác, `docker compose up -d` |
| Đăng nhập xong vẫn bị đẩy về trang đăng nhập | Truy cập bằng `http://` trong khi `NODE_ENV=production` (cookie `Secure`) | Luôn truy cập qua HTTPS |
| Tên miền con của khách báo lỗi chứng chỉ | DNS wildcard chưa trỏ; website chưa xuất bản trang nào; website bị tạm ngưng; chạm giới hạn Let's Encrypt | `dig` kiểm tra DNS; `curl "http://127.0.0.1:3000/_htc/tls-ask?domain=<host>"` từ trong container `app` phải trả 200; xem `docker compose logs caddy`; cân nhắc chứng chỉ wildcard (mục 12.2) |
| Tên miền riêng không xác minh được | Chưa có TXT `_htc-verify.<domain>`, DNS chưa lan truyền, TXT bị nhà cung cấp tự thêm tên miền gốc | `dig TXT _htc-verify.<domain> +short` phải trả `"htc-verify=<mã>"`; một số nhà cung cấp chỉ cần nhập `_htc-verify.www` |
| Không nhận được email | `SMTP_URL` sai, mật khẩu chứa ký tự đặc biệt chưa mã hóa, nhà cung cấp chặn cổng 25/465/587 | Xem lỗi trong `docker compose logs app`; mã hóa mật khẩu (mục 6.2); thử cổng 587 với `smtp://` |
| Email vào thư rác | Thiếu SPF/DKIM/DMARC; `MAIL_FROM` khác tên miền đã xác thực | Mục 9 |
| Thanh toán xong gói không đổi | Webhook không tới (sai URL, chứng chỉ lỗi), sai `PAYOS_CHECKSUM_KEY` | Kiểm tra lịch sử webhook trên payOS; log `app` có dòng lỗi chữ ký; khách quay về `/billing/return/payos` để ứng dụng tự kiểm tra lại |
| Form trên trang khách báo "phiên đã hết hạn" | Trang mở quá 24 giờ, hoặc `LEAD_SECRET` vừa đổi | Tải lại trang rồi gửi lại |
| Zalo OA báo "không làm mới được access token" | Refresh token của OA hết hạn, đã dùng ở nơi khác, hoặc chuỗi token bị đứt khi mất kết nối lúc làm mới | Chủ website lấy refresh token mới (README, mục "Zalo OA") và dán lại vào Cài đặt website, bấm **Gửi thử Zalo** |
| Liên kết hủy nhận email báo không hợp lệ | `LEAD_SECRET` để trống và khóa dẫn xuất đã đổi (đổi khóa thanh toán/SMTP) | Đặt `LEAD_SECRET` cố định; người dùng tắt email trong **Cài đặt → Email** |
| Form trên `/p/…` không gửi được | Website bật Turnstile; đường dẫn xem trước không qua được Turnstile | Thử trên tên miền con/tên miền riêng |
| Lead bị đánh dấu Spam | Gửi quá nhanh sau khi tải trang (< 2 giây), nhiều link, từ khóa spam | Xem lý do trong lead; chuyển trạng thái nếu nhầm |
| Website trả 451 | Website hoặc tài khoản chủ sở hữu bị tạm ngưng (tự động hoặc bởi quản trị) | `/app/admin` → An toàn nội dung → danh sách đang tạm ngưng |
| `database is locked` / `SQLITE_BUSY` | Chạy hai tiến trình trên cùng file DB; ổ đĩa mạng (NFS) | Chỉ một container `app`; đặt DB trên ổ đĩa cục bộ |
| `app` liên tục khởi động lại | Lỗi cấu hình, đĩa đầy, file DB hỏng | `docker compose logs --tail 200 app`; `df -h`; khôi phục từ bản sao lưu |
| Docker build thất bại vì hết RAM | Máy chủ 1 GB không có swap | Bật swap (mục 4.4) |

Lấy thông tin để báo lỗi: thời điểm, `requestId` hiển thị cho người dùng, và kết quả `docker compose logs --no-log-prefix app --since 30m | jq -cR 'fromjson? | select(.reqId=="<requestId>")'`.

## 20. Giới hạn hiện tại và hướng mở rộng

- **Một tiến trình, một máy chủ:** SQLite chế độ WAL xử lý tốt hàng trăm request/giây trên một máy chủ, nhưng không chia sẻ được giữa nhiều máy chủ. Giới hạn tần suất và hàng đợi thông báo nằm trong bộ nhớ của tiến trình. Không chạy `docker compose up --scale app=2`.
- **Mở rộng theo chiều dọc trước:** tăng CPU/RAM, dùng ổ NVMe, chuyển ảnh sang S3 + CDN.
- **Khi cần nhiều máy chủ:** chuyển database sang PostgreSQL (trong lộ trình), đưa giới hạn tần suất và hàng đợi sang Redis, rồi chạy nhiều bản `app` sau Caddy/load balancer.
- **CDN cho trang khách:** có thể đặt CDN trước tên miền con của khách sau khi đã dùng chứng chỉ wildcard; trang đã xuất bản có thể cache ngắn hạn nhưng form gửi về `/_htc/lead` không được cache.

## 21. Kiểm thử bộ công cụ triển khai

`deploy/test-stack.sh` chạy toàn bộ quy trình trên stack production thật (container `app` + Caddy, HTTPS bằng CA nội bộ của Caddy trên `https://localhost`):

1. `init-env.sh` + `preflight.sh`, `docker compose up -d --build`, chờ healthy.
2. `smoke-test.sh`.
3. Luồng người dùng qua HTTPS: đăng ký (có đồng ý điều khoản) → xác minh email (lấy liên kết từ log) → tạo website từ mẫu → xuất bản → xem `/p/<subdomain>` → tải ảnh lên.
4. `backup.sh` → sửa dữ liệu → `restore.sh` → dữ liệu và ảnh trở về đúng thời điểm sao lưu.
5. Khôi phục từ file hỏng: phải bị từ chối, dữ liệu đang dùng giữ nguyên, `app` chạy lại, smoke test đạt.
6. Dọn dẹp (`docker compose down -v`, xóa `.env` thử) — giữ lại bằng `--keep`.

Script từ chối chạy khi đã có `.env` (tránh ghi đè cấu hình thật). Job **Deploy test** trong CI chạy `shellcheck` cho mọi script trong `deploy/` và chạy `deploy/test-stack.sh` cho mỗi PR và mỗi lần push lên `main`. Chạy tại máy: cần Docker, cổng 80/443 trống:

```bash
deploy/test-stack.sh                       # build image từ mã nguồn
deploy/test-stack.sh --image hitechcloud-landingpage:local --keep
```

