#!/usr/bin/env bash
# Updates the Docker Compose deployment to a new version.
#
#   deploy/update.sh                      # source build: git pull --ff-only on the current branch
#   deploy/update.sh --ref v1.1.0         # source build: check out a tag/branch/commit
#   deploy/update.sh --image v1.1.0       # released image: sets APP_IMAGE=ghcr.io/…:v1.1.0
#   options: --no-backup  --auto-rollback  --insecure (smoke test against a self-signed cert)
#
# Steps: preflight → backup → new version → wait until healthy → smoke test. If the new
# version is unhealthy or fails the smoke test, the previous commit/image is restored with
# --auto-rollback, otherwise the rollback commands are printed. The database is not rolled
# back automatically (schema changes only add tables/columns); restore a backup if needed.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ROOT=$(repo_root)
ENV_FILE="$ROOT/.env"
IMAGE_REPO=ghcr.io/hitechcloud-vietnam/hitechcloudlandingpage
REF='' IMAGE='' BACKUP=1 AUTO_ROLLBACK=0 PULL=1 SMOKE_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) REF="${2:-}"; shift 2 ;;
    --image) IMAGE="${2:-}"; shift 2 ;;
    --no-backup) BACKUP=0; shift ;;
    --auto-rollback) AUTO_ROLLBACK=1; shift ;;
    --no-pull) PULL=0; shift ;;
    --insecure) SMOKE_ARGS+=(--insecure); shift ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số không hợp lệ: $1" ;;
  esac
done
[ -z "$REF" ] || [ -z "$IMAGE" ] || die "Chọn --ref (build từ mã nguồn) hoặc --image (image dựng sẵn), không dùng cả hai"
cd "$ROOT"

step "Kiểm tra cấu hình"
"$ROOT/deploy/preflight.sh" --skip-dns --skip-host >/dev/null || die "preflight có lỗi, chạy deploy/preflight.sh để xem chi tiết"
ok "preflight đạt"

PREV_COMMIT=$(git rev-parse HEAD)
PREV_IMAGE=$(env_get APP_IMAGE "$ENV_FILE")
if [ -n "$IMAGE" ]; then
  case "$IMAGE" in */*|*:*) ;; *) IMAGE="$IMAGE_REPO:$IMAGE" ;; esac
  MODE=image
elif [ -n "$PREV_IMAGE" ] && [ -z "$REF" ]; then
  IMAGE="$PREV_IMAGE"; MODE=image
else
  MODE=source
fi

if [ "$BACKUP" = 1 ] && [ -n "$(compose ps -q --status running app 2>/dev/null)" ]; then
  step "Sao lưu trước khi cập nhật"
  "$ROOT/deploy/backup.sh"
fi

deploy_current() { # (re)creates the app container from the current checkout / APP_IMAGE
  if [ -n "$(env_get APP_IMAGE "$ENV_FILE")" ]; then
    [ "$PULL" = 0 ] || compose pull app
    compose up -d --no-build
  else
    compose up -d --build
  fi
}

wait_healthy() {
  local cid status=unknown
  cid=$(compose ps -q app)
  for _ in $(seq 1 90); do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
    [ "$status" = healthy ] && return 0
    case "$status" in exited|restarting|dead) break ;; esac
    sleep 2
  done
  err "app không healthy (trạng thái: $status)"
  return 1
}

step "Cập nhật"
if [ "$MODE" = image ]; then
  env_set APP_IMAGE "$IMAGE" "$ENV_FILE"
  info "Image: $IMAGE"
else
  [ -z "$(git status --porcelain --untracked-files=no)" ] || warn "Có thay đổi chưa commit trong mã nguồn trên máy chủ (git status)"
  git fetch --tags origin
  if [ -n "$REF" ]; then git checkout --quiet "$REF"; else git pull --ff-only; fi
  info "Mã nguồn: $(git log --oneline -1)"
fi
deploy_current

step "Kiểm tra phiên bản mới"
if wait_healthy && "$ROOT/deploy/smoke-test.sh" "${SMOKE_ARGS[@]}"; then
  ok "Cập nhật thành công"
  exit 0
fi

err "Phiên bản mới không đạt kiểm tra. Log: docker compose logs --tail 200 app"
if [ "$MODE" = image ]; then
  rollback_cmd="sed -i 's|^APP_IMAGE=.*|APP_IMAGE=$PREV_IMAGE|' .env && docker compose up -d --no-build"
else
  rollback_cmd="git checkout $PREV_COMMIT && docker compose up -d --build"
fi
if [ "$AUTO_ROLLBACK" = 1 ]; then
  step "Quay lui"
  if [ "$MODE" = image ]; then env_set APP_IMAGE "$PREV_IMAGE" "$ENV_FILE"; else git checkout --quiet "$PREV_COMMIT"; fi
  PULL=0 deploy_current
  if wait_healthy; then warn "Đã quay lui về phiên bản trước"; else err "Quay lui cũng không healthy: cần xử lý thủ công (docs/RUNBOOK.md)"; fi
else
  warn "Quay lui: $rollback_cmd"
fi
exit 1
