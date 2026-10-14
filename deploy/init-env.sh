#!/usr/bin/env bash
# Creates a production .env from .env.example with generated secrets.
#
#   deploy/init-env.sh --app-domain app.hitechcloud.vn --publish-domain hitechcloud.site \
#     --admin-email admin@congty.vn [--acme-email ops@congty.vn] [--force]
#
# Missing values are asked for interactively. An existing .env is never overwritten
# unless --force is given (the old file is kept as .env.bak-<timestamp>).
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROOT=$(repo_root)
ENV_FILE="$ROOT/.env"
APP_DOMAIN='' PUBLISH_DOMAIN='' ADMIN_EMAIL='' ACME_EMAIL='' FORCE=0

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --app-domain) APP_DOMAIN="${2:-}"; shift 2 ;;
    --publish-domain) PUBLISH_DOMAIN="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    --acme-email) ACME_EMAIL="${2:-}"; shift 2 ;;
    --env-file) ENV_FILE="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage 0 ;;
    *) err "Tham số không hợp lệ: $1"; usage 1 ;;
  esac
done

ask() {
  local var="$1" prompt="$2"
  if [ -z "${!var}" ]; then
    [ -t 0 ] || die "Thiếu $prompt (chạy với tham số, xem --help)"
    read -r -p "$prompt: " "${var?}"
  fi
}

ask APP_DOMAIN 'Tên miền dashboard (vd app.hitechcloud.vn)'
ask PUBLISH_DOMAIN 'Tên miền gốc cho trang khách (vd hitechcloud.site)'
ask ADMIN_EMAIL 'Email quản trị nền tảng'
ACME_EMAIL="${ACME_EMAIL:-$ADMIN_EMAIL}"

APP_DOMAIN="${APP_DOMAIN,,}"; PUBLISH_DOMAIN="${PUBLISH_DOMAIN,,}"
domain_re='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'
[[ "$APP_DOMAIN" =~ $domain_re ]] || die "Tên miền dashboard không hợp lệ: $APP_DOMAIN"
[[ "$PUBLISH_DOMAIN" =~ $domain_re ]] || die "Tên miền trang khách không hợp lệ: $PUBLISH_DOMAIN"
[[ "$ADMIN_EMAIL" == *@*.* ]] || die "Email không hợp lệ: $ADMIN_EMAIL"
[ "$APP_DOMAIN" != "$PUBLISH_DOMAIN" ] || die "Tên miền dashboard và tên miền trang khách phải khác nhau"
case "$APP_DOMAIN" in
  *."$PUBLISH_DOMAIN") warn "Dashboard nằm dưới tên miền trang khách: trang của khách có thể đọc cookie dashboard. Nên dùng tên miền gốc khác (xem docs/DEPLOYMENT.md mục 1)." ;;
esac

if [ -e "$ENV_FILE" ]; then
  [ "$FORCE" = 1 ] || die "$ENV_FILE đã tồn tại. Dùng --force để tạo lại (file cũ được giữ thành .env.bak-…)."
  cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
fi

secret() { openssl rand -hex 32; }
umask 077
cp "$ROOT/.env.example" "$ENV_FILE"
env_set NODE_ENV production
env_set APP_URL "https://$APP_DOMAIN"
env_set APP_DOMAIN "$APP_DOMAIN"
env_set ACME_EMAIL "$ACME_EMAIL"
env_set PUBLISH_ROOT_DOMAIN "$PUBLISH_DOMAIN"
env_set CNAME_TARGET "sites.$PUBLISH_DOMAIN"
env_set SUPERADMIN_EMAILS "$ADMIN_EMAIL"
env_set MAIL_FROM "HiTechCloud <no-reply@${APP_DOMAIN#*.}>"
env_set LEAD_SECRET "$(secret)"
env_set METRICS_TOKEN "$(secret)"
chmod 600 "$ENV_FILE"

ok "Đã tạo $ENV_FILE (quyền 600) với LEAD_SECRET và METRICS_TOKEN ngẫu nhiên."
info "Việc tiếp theo:"
info "  1. Điền SMTP_URL (bắt buộc để gửi email) và khóa payOS/Pay2S nếu thu phí: nano $ENV_FILE"
info "  2. Trỏ DNS: $APP_DOMAIN, *.$PUBLISH_DOMAIN, sites.$PUBLISH_DOMAIN → IP máy chủ"
info "  3. Kiểm tra: deploy/preflight.sh"
