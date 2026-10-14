#!/usr/bin/env bash
# Checks a running deployment from the outside (run on the server or any machine).
#
#   deploy/smoke-test.sh [--url https://app.example.vn] [--site SUBDOMAIN] [--insecure] [--resolve IP]
#
# --url       dashboard URL (default: APP_URL in .env)
# --site      also open https://SUBDOMAIN.<PUBLISH_ROOT_DOMAIN>/ (a site with a published page)
# --insecure  accept self-signed certificates (local tests only)
# --resolve   send requests to this IP instead of DNS (test before DNS switch-over)
# Exit code 0 = all checks passed.
set -uo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_FILE="${ENV_FILE:-$(repo_root)/.env}"
URL="$(env_get APP_URL "$ENV_FILE")" SITE='' RESOLVE=''
CURL=(curl -sS --max-time 15)
while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="${2:-}"; shift 2 ;;
    --site) SITE="${2:-}"; shift 2 ;;
    --insecure) CURL+=(-k); shift ;;
    --resolve) RESOLVE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số không hợp lệ: $1" ;;
  esac
done
[ -n "$URL" ] || die "Không có URL (dùng --url hoặc đặt APP_URL trong .env)"
URL="${URL%/}"
host_of() { local h="${1#*://}"; h="${h%%/*}"; printf '%s' "${h%%:*}"; }
port_of() { case "$1" in https://*) echo 443 ;; *) echo 80 ;; esac; }
with_resolve() { if [ -n "$RESOLVE" ]; then printf -- '--resolve\n%s:%s:%s\n' "$(host_of "$1")" "$(port_of "$1")" "$RESOLVE"; fi; }

FAILED=0
check() { # check NAME EXPECTED_STATUS URL [extra curl args…] ; body in $BODY, headers in $HEADERS
  local name="$1" expect="$2" url="$3"; shift 3
  local tmp; tmp=$(mktemp -d)
  local -a extra=(); mapfile -t extra < <(with_resolve "$url")
  STATUS=$("${CURL[@]}" "${extra[@]}" -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$@" "$url" 2>"$tmp/err") || STATUS="000"
  BODY=$(cat "$tmp/body" 2>/dev/null); HEADERS=$(tr -d '\r' < "$tmp/headers" 2>/dev/null)
  if [ "$STATUS" = "$expect" ]; then ok "$name ($STATUS)"; rm -rf "$tmp"; return 0; fi
  err "$name: mong đợi $expect, nhận $STATUS $(head -c 200 "$tmp/err")"; FAILED=$((FAILED + 1)); rm -rf "$tmp"; return 1
}
expect_body() { if [[ "$BODY" == *"$1"* ]]; then ok "  nội dung có \"$1\""; else err "  thiếu \"$1\" trong nội dung"; FAILED=$((FAILED + 1)); fi; }
expect_header() { if grep -qi "^$1:" <<<"$HEADERS"; then ok "  có header $1"; else err "  thiếu header $1"; FAILED=$((FAILED + 1)); fi; }

step "Dashboard $URL"
check "GET /healthz" 200 "$URL/healthz" && expect_body '"ok":true'
check "GET /readyz" 200 "$URL/readyz" && expect_body '"ok":true'
check "Trang chủ" 200 "$URL/"
if check "Trang đăng nhập" 200 "$URL/app/login"; then
  expect_header X-Content-Type-Options
  expect_header X-Frame-Options
  [[ "$URL" == https://* ]] && expect_header Strict-Transport-Security
fi
check "Trang không tồn tại → 404" 404 "$URL/khong-ton-tai-$RANDOM"
# A JSON login with the dashboard's own Origin must reach the auth check (401), not the
# CSRF check (403 "Origin không hợp lệ"), which would mean APP_URL is wrong.
if check "Đăng nhập sai mật khẩu → 401 (APP_URL đúng)" 401 "$URL/api/auth/login" -X POST -H "Origin: $URL" -H 'Content-Type: application/json' --data '{"email":"smoke-test@example.invalid","password":"sai-mat-khau"}'; then :; else
  [[ "$BODY" == *Origin* ]] && warn "  Lỗi Origin: APP_URL trong .env phải đúng bằng $URL"
fi
check "TLS ask từ chối tên miền lạ → 404" 404 "$URL/_htc/tls-ask?domain=smoke-$RANDOM.example.invalid"
token=$(env_get METRICS_TOKEN "$ENV_FILE")
if [ -n "$token" ]; then
  check "/metrics không có token → 401" 401 "$URL/metrics"
  check "/metrics có token" 200 "$URL/metrics" -H "Authorization: Bearer $token" && expect_body http_requests_total
fi

if [ -n "$SITE" ]; then
  root=$(env_get PUBLISH_ROOT_DOMAIN "$ENV_FILE")
  [ -n "$root" ] || die "Thiếu PUBLISH_ROOT_DOMAIN trong .env"
  step "Website khách https://$SITE.$root"
  check "Trang chủ website" 200 "https://$SITE.$root/"
  check "sitemap.xml" 200 "https://$SITE.$root/sitemap.xml"
fi

step "Kết quả"
if [ "$FAILED" -gt 0 ]; then err "$FAILED kiểm tra thất bại"; exit 1; fi
ok "Tất cả kiểm tra đạt"
