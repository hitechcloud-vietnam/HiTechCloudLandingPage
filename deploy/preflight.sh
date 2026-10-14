#!/usr/bin/env bash
# Checks a server and its .env before `docker compose up` (or after a change).
#
#   deploy/preflight.sh [--env-file PATH] [--ip PUBLIC_IP] [--skip-dns] [--skip-host]
#
# --ip         public IP the DNS records must point to (default: detected via api.ipify.org)
# --skip-dns   do not resolve the domains (e.g. before DNS is set up)
# --skip-host  do not check Docker, ports, disk and memory (e.g. checking a .env elsewhere)
# Exit code 0 = no errors (warnings allowed), 1 = at least one error.
set -uo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_FILE="$(repo_root)/.env"
PUBLIC_IP='' SKIP_DNS=0 SKIP_HOST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --ip) PUBLIC_IP="${2:-}"; shift 2 ;;
    --skip-dns) SKIP_DNS=1; shift ;;
    --skip-host) SKIP_HOST=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số không hợp lệ: $1" ;;
  esac
done

ERRORS=0 WARNINGS=0
fail() { err "$*"; ERRORS=$((ERRORS + 1)); }
caution() { warn "$*"; WARNINGS=$((WARNINGS + 1)); }
get() { env_get "$1" "$ENV_FILE"; }

step "Tệp cấu hình ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  fail "Không có $ENV_FILE. Tạo bằng: deploy/init-env.sh"
  exit 1
fi
mode=$(stat -c %a "$ENV_FILE" 2>/dev/null || echo 600)
if [ $((8#$mode & 8#077)) -ne 0 ]; then caution ".env đang có quyền $mode; nên đặt: chmod 600 $ENV_FILE"; else ok "Quyền .env: $mode"; fi

for key in APP_URL APP_DOMAIN ACME_EMAIL PUBLISH_ROOT_DOMAIN CNAME_TARGET SUPERADMIN_EMAILS LEAD_SECRET; do
  if [ -z "$(get "$key")" ]; then fail "Thiếu $key"; fi
done
if [ "$(get NODE_ENV)" = production ]; then ok "NODE_ENV=production"; else fail "NODE_ENV phải là production (cookie Secure, HSTS, log JSON)"; fi

APP_URL=$(get APP_URL); APP_DOMAIN=$(get APP_DOMAIN); PUBLISH=$(get PUBLISH_ROOT_DOMAIN); CNAME=$(get CNAME_TARGET)
if [ -n "$APP_URL" ] && [ -n "$APP_DOMAIN" ]; then
  if [ "$APP_URL" = "https://$APP_DOMAIN" ]; then ok "APP_URL khớp APP_DOMAIN"; else fail "APP_URL ($APP_URL) phải đúng bằng https://$APP_DOMAIN (không có / ở cuối)"; fi
fi
if [ -n "$PUBLISH" ] && [ -n "$APP_DOMAIN" ]; then
  case "$APP_DOMAIN" in
    "$PUBLISH"|*."$PUBLISH") fail "APP_DOMAIN nằm trong PUBLISH_ROOT_DOMAIN: trang của khách đọc được cookie dashboard. Dùng tên miền gốc khác." ;;
    *) ok "Dashboard và trang khách dùng tên miền khác nhau" ;;
  esac
fi
secret=$(get LEAD_SECRET)
if [ -n "$secret" ] && [ ${#secret} -lt 32 ]; then caution "LEAD_SECRET ngắn (${#secret} ký tự); nên dùng: openssl rand -hex 32"; fi

if [ -n "$(get SMTP_URL)" ]; then ok "Đã cấu hình SMTP"; else caution "SMTP_URL trống: email (xác minh, đặt lại mật khẩu, thông báo lead) chỉ được ghi ra log"; fi
[ -n "$(get METRICS_TOKEN)" ] || caution "METRICS_TOKEN trống: /metrics bị tắt"
[ -n "$(get ERROR_WEBHOOK_URL)" ] || caution "ERROR_WEBHOOK_URL trống: lỗi 5xx chỉ được ghi log, không có cảnh báo"

# A provider is either fully configured or not at all.
group() {
  local name="$1"; shift
  local set=0 key
  for key in "$@"; do [ -n "$(get "$key")" ] && set=$((set + 1)); done
  if [ "$set" -eq "$#" ]; then ok "$name: đã cấu hình"; return 0; fi
  if [ "$set" -gt 0 ]; then fail "$name: thiếu một số biến ($*)"; fi
  return 1
}
payos=0 pay2s=0
group payOS PAYOS_CLIENT_ID PAYOS_API_KEY PAYOS_CHECKSUM_KEY && payos=1
group Pay2S PAY2S_PARTNER_CODE PAY2S_ACCESS_KEY PAY2S_SECRET_KEY && pay2s=1
[ $((payos + pay2s)) -gt 0 ] || caution "Chưa cấu hình cổng thanh toán nào: khách không nâng cấp gói được"
if [ "$pay2s" = 1 ] && [ "$(get PAY2S_ENV)" != production ]; then caution "PAY2S_ENV=$(get PAY2S_ENV): đang ở sandbox"; fi
if [ -n "$(get S3_BUCKET)" ]; then group 'Lưu trữ S3' S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY >/dev/null || true; fi
if [ -n "$(get ZALO_APP_ID)$(get ZALO_APP_SECRET)" ]; then group 'Zalo OA' ZALO_APP_ID ZALO_APP_SECRET >/dev/null || true; fi
[ "$(get REQUIRE_TERMS_CONSENT)" = 0 ] && caution "REQUIRE_TERMS_CONSENT=0: đăng ký không bắt buộc đồng ý điều khoản (Nghị định 13/2023)"

if [ "$SKIP_DNS" = 0 ] && [ -n "$APP_DOMAIN" ] && [ -n "$PUBLISH" ]; then
  step "DNS"
  if [ -z "$PUBLIC_IP" ]; then PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true); fi
  if [ -n "$PUBLIC_IP" ]; then info "IP công khai của máy chủ: $PUBLIC_IP"; else caution "Không xác định được IP công khai (dùng --ip); chỉ kiểm tra tên miền có phân giải được"; fi
  probe="htc-preflight-$RANDOM.$PUBLISH"
  for host in "$APP_DOMAIN" "$probe" "$CNAME"; do
    [ -n "$host" ] || continue
    ips=$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')
    label="$host"; [ "$host" = "$probe" ] && label="*.$PUBLISH (thử bằng $probe)"
    if [ -z "$ips" ]; then fail "$label không phân giải được (thiếu bản ghi A?)"
    elif [ -n "$PUBLIC_IP" ] && [[ " $ips" != *" $PUBLIC_IP "* ]]; then fail "$label trỏ tới $ips, không phải $PUBLIC_IP (Cloudflare proxy? phải để DNS only)"
    else ok "$label → $ips"; fi
  done
fi

if [ "$SKIP_HOST" = 0 ]; then
  step "Máy chủ"
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "$(docker --version | cut -d, -f1), $(docker compose version --short 2>/dev/null | sed 's/^/Compose /')"
    docker info >/dev/null 2>&1 || fail "Docker daemon không chạy hoặc người dùng chưa thuộc nhóm docker"
  else
    fail "Chưa cài Docker và plugin Compose v2 (deploy/setup-server.sh)"
  fi
  if command -v ss >/dev/null 2>&1; then
    for port in 80 443; do
      holder=$(ss -ltnpH "sport = :$port" 2>/dev/null | head -n 1)
      if [ -n "$holder" ] && [[ "$holder" != *docker-proxy* ]] && [[ "$holder" != *caddy* ]]; then
        caution "Cổng $port đang bị chiếm: $holder"
      fi
    done
  fi
  free_gb=$(df -Pk / | awk 'NR == 2 { printf "%d", $4 / 1048576 }')
  if [ "$free_gb" -ge 5 ]; then ok "Đĩa trống: ${free_gb} GB"; else caution "Đĩa trống chỉ ${free_gb} GB (nên ≥ 5 GB)"; fi
  mem_mb=$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo)
  swap_mb=$(awk '/SwapTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo)
  if [ "$mem_mb" -lt 1800 ] && [ "$swap_mb" -lt 1000 ]; then caution "RAM ${mem_mb} MB, swap ${swap_mb} MB: nên thêm swap 2 GB (deploy/setup-server.sh)"; else ok "RAM ${mem_mb} MB, swap ${swap_mb} MB"; fi
fi

step "Kết quả"
if [ "$ERRORS" -gt 0 ]; then err "$ERRORS lỗi, $WARNINGS cảnh báo"; exit 1; fi
ok "Không có lỗi ($WARNINGS cảnh báo)"
