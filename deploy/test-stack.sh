#!/usr/bin/env bash
# End-to-end test of the production stack (app + Caddy) and the deploy tools, on
# https://localhost with Caddy's internal CA. Used by CI ("Deploy test" job).
#
#   deploy/test-stack.sh [--image IMAGE] [--keep]
#
# --image  use an existing image (APP_IMAGE) instead of building from source
# --keep   leave the stack, .env and backups in place afterwards (for debugging)
# Refuses to run when a .env already exists: it would overwrite a real configuration.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROOT=$(repo_root)
cd "$ROOT"
IMAGE='' KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số không hợp lệ: $1" ;;
  esac
done
[ ! -e .env ] || die ".env đã tồn tại; script này chỉ chạy trên bản checkout không có cấu hình thật"

WORK=$(mktemp -d)
BACKUPS="$WORK/backups"
JAR="$WORK/cookies"
B=https://localhost
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    warn "Thất bại, log gần nhất của app:"
    compose logs --tail 60 app >&2 || true
  fi
  if [ "$KEEP" = 0 ]; then
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK" "$ROOT/.env"
  else
    info "Giữ lại stack, .env và $WORK"
  fi
  exit "$code"
}
trap cleanup EXIT

step "Cấu hình thử nghiệm (localhost)"
"$ROOT/deploy/init-env.sh" --app-domain app.example.vn --publish-domain example.site --admin-email root@example.vn >/dev/null </dev/null
ENV_FILE="$ROOT/.env"
env_set APP_DOMAIN localhost
env_set APP_URL "$B"
env_set PUBLISH_ROOT_DOMAIN sites.localhost
env_set CNAME_TARGET sites.sites.localhost
[ -z "$IMAGE" ] || env_set APP_IMAGE "$IMAGE"
"$ROOT/deploy/preflight.sh" --skip-dns --skip-host >/dev/null
ok "preflight đạt"

step "Khởi chạy"
if [ -n "$IMAGE" ]; then compose up -d --no-build; else compose up -d --build; fi
cid=$(compose ps -q app)
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" = healthy ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$cid")" = healthy ] || die "app không healthy"
ok "app healthy"
for _ in $(seq 1 30); do curl -sk -o /dev/null "$B/healthz" && break; sleep 1; done
"$ROOT/deploy/smoke-test.sh" --insecure

step "Luồng người dùng qua HTTPS"
api() { # api METHOD PATH [JSON]
  curl -sSk -b "$JAR" -c "$JAR" -H "Origin: $B" -H 'Content-Type: application/json' -X "$1" "$B$2" ${3:+--data "$3"}
}
code() { curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" -H "Origin: $B" -H 'Content-Type: application/json' -X "$1" "$B$2" ${3:+--data "$3"}; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=new Function("d","return "+process.argv[1])(JSON.parse(s));console.log(v)})' "$1"; }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else die "$1: mong đợi $3, nhận $2"; fi; }

expect "Đăng ký" "$(code POST /api/auth/signup '{"name":"Chủ Shop","email":"owner@example.vn","password":"matkhau123","workspaceName":"Shop","acceptTerms":true}')" 201
link=$(compose logs app 2>&1 | grep -o 'https://[^ "\\]*/api/auth/verify?token=[A-Za-z0-9_-]*' | tail -n 1)
[ -n "$link" ] || die "Không thấy liên kết xác minh trong log"
expect "Xác minh email" "$(curl -sk -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" "$link")" 302
WS=$(api GET /api/auth/me | json 'd.workspaces[0].id')
expect "Tạo website" "$(code POST "/api/workspaces/$WS/sites" '{"name":"Shop","subdomain":"shop","template":"leadgen"}')" 201
SITE=$(api GET "/api/workspaces/$WS/sites" | json '(d.sites||d)[0].id')
PAGE=$(api GET "/api/sites/$SITE/pages" | json 'd[0].id')
expect "Xuất bản" "$(code POST "/api/pages/$PAGE/publish" '{}')" 200
expect "Xem trang /p/shop" "$(curl -sk -o /dev/null -w '%{http_code}' "$B/p/shop")" 200
cp "$ROOT/e2e/fixtures/pixel.png" "$WORK/p.png"
SRC=$(curl -sSk -b "$JAR" -H "Origin: $B" -H 'Content-Type: image/png' --data-binary @"$WORK/p.png" "$B/api/workspaces/$WS/assets" | json 'd.src')
expect "Ảnh tải lên phục vụ được" "$(curl -sk -o /dev/null -w '%{http_code}' "$B$SRC")" 200

step "Sao lưu → thay đổi → khôi phục"
"$ROOT/deploy/backup.sh" --dest "$BACKUPS"
expect "Đổi tên website" "$(code PATCH "/api/sites/$SITE" '{"name":"Sau sao lưu"}')" 200
DB=$(ls "$BACKUPS"/hitechcloud-*.db); FILES=$(ls "$BACKUPS"/files-*.tar.gz)
"$ROOT/deploy/restore.sh" "$DB" "$FILES" --yes
for _ in $(seq 1 30); do curl -sk -o /dev/null "$B/healthz" && break; sleep 1; done
expect "Dữ liệu trở về lúc sao lưu" "$(api GET "/api/workspaces/$WS/sites" | json '(d.sites||d)[0].name')" Shop
expect "Ảnh vẫn còn sau khôi phục" "$(curl -sk -o /dev/null -w '%{http_code}' "$B$SRC")" 200

step "Khôi phục từ bản hỏng phải bị từ chối, dữ liệu giữ nguyên"
mkdir -p "$WORK/broken"; head -c 50000 /dev/urandom > "$WORK/broken/hitechcloud-20990101-000000.db"
if "$ROOT/deploy/restore.sh" "$WORK/broken/hitechcloud-20990101-000000.db" --yes --no-safety-backup >/dev/null 2>&1; then die "Bản hỏng không bị từ chối"; fi
for _ in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null)" = healthy ] && break; sleep 2; done
expect "Dữ liệu còn nguyên" "$(api GET "/api/workspaces/$WS/sites" | json '(d.sites||d)[0].name')" Shop
"$ROOT/deploy/smoke-test.sh" --insecure >/dev/null
ok "Smoke test sau khôi phục đạt"

step "Kết quả"
ok "Kiểm thử triển khai đạt"
