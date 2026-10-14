#!/usr/bin/env bash
# Restores a backup made by deploy/backup.sh into the Docker Compose deployment.
#
#   deploy/restore.sh /var/backups/hitechcloud/hitechcloud-<stamp>.db [files-<stamp>.tar.gz] [--yes] [--no-safety-backup]
#
# Steps: verify (SHA256SUMS if present, SQLite integrity_check) → safety backup of the
# current data (into <backup dir>/pre-restore) → stop app → move current files to
# /data/restore-old/<stamp> → copy the backup in → start app → wait until healthy.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DB='' FILES='' YES=0 SAFETY=1
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1; shift ;;
    --no-safety-backup) SAFETY=0; shift ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Tham số không hợp lệ: $1" ;;
    *) if [ -z "$DB" ]; then DB="$1"; elif [ -z "$FILES" ]; then FILES="$1"; else die "Thừa tham số: $1"; fi; shift ;;
  esac
done
[ -n "$DB" ] || die "Cần đường dẫn file .db (xem --help)"
[ -f "$DB" ] || die "Không có file: $DB"
[ -z "$FILES" ] || [ -f "$FILES" ] || die "Không có file: $FILES"
DB=$(cd "$(dirname "$DB")" && pwd)/$(basename "$DB")
[ -z "$FILES" ] || FILES=$(cd "$(dirname "$FILES")" && pwd)/$(basename "$FILES")
SRC=$(dirname "$DB")
[ -z "$FILES" ] || [ "$(dirname "$FILES")" = "$SRC" ] || die "File .db và .tar.gz phải nằm cùng thư mục"

# Checksums written by backup.sh for the same stamp, if available.
stamp=$(basename "$DB" .db); stamp="${stamp#hitechcloud-}"
if [ -f "$SRC/SHA256SUMS-$stamp" ]; then
  (cd "$SRC" && sha256sum --quiet -c "SHA256SUMS-$stamp") || die "Sai checksum, bản sao lưu có thể đã hỏng"
  ok "Checksum khớp"
fi

if [ "$YES" = 0 ]; then
  [ -t 0 ] || die "Chạy không tương tác thì thêm --yes"
  warn "Dữ liệu hiện tại sẽ được thay bằng $(basename "$DB")${FILES:+ và $(basename "$FILES")}. Dữ liệu phát sinh sau thời điểm sao lưu sẽ mất."
  read -r -p "Gõ KHOI PHUC để tiếp tục: " answer
  [ "$answer" = "KHOI PHUC" ] || die "Đã hủy"
fi

if [ "$SAFETY" = 1 ] && [ -n "$(compose ps -q --status running app 2>/dev/null)" ]; then
  step "Sao lưu dữ liệu hiện tại trước khi khôi phục"
  "$(dirname "${BASH_SOURCE[0]}")/backup.sh" --dest "$SRC/pre-restore" --keep-days 30
fi

step "Khôi phục"
NOW=$(date +%Y%m%d-%H%M%S)
compose stop app
# Runs as root (backup files are mode 600, owned by root on the host) and hands the
# result back to the image's "node" user (uid 1000). The backup is copied and verified
# in a staging directory first; the live files are only swapped once that succeeded.
# shellcheck disable=SC2016 # expanded by the container's shell
if ! compose run --rm --no-deps -T --user 0:0 -v "$SRC:/restore:ro" \
  -e DBF="$(basename "$DB")" -e FILES="$(basename "${FILES:-}")" -e NOW="$NOW" --entrypoint sh app -c '
  set -e
  new=/data/.restore-new
  trap "rm -rf /data/.restore-new" EXIT
  old="/data/restore-old/$NOW"
  rm -rf "$new"; mkdir -p "$new/files"
  cp "/restore/$DBF" "$new/hitechcloud.db"
  node --disable-warning=ExperimentalWarning -e "
    const { DatabaseSync } = require(\"node:sqlite\");
    const r = Object.values(new DatabaseSync(process.argv[1], { readOnly: true }).prepare(\"PRAGMA integrity_check\").get())[0];
    if (r !== \"ok\") { console.error(\"integrity_check: \" + r); process.exit(1); }
  " "$new/hitechcloud.db"
  [ -z "$FILES" ] || tar xzf "/restore/$FILES" -C "$new/files"
  mkdir -p "$old"
  for f in hitechcloud.db hitechcloud.db-wal hitechcloud.db-shm; do [ ! -e "/data/$f" ] || mv "/data/$f" "$old/"; done
  mv "$new/hitechcloud.db" /data/hitechcloud.db
  if [ -n "$FILES" ]; then
    for f in uploads lead-secret; do [ ! -e "/data/$f" ] || mv "/data/$f" "$old/"; done
    for f in "$new"/files/*; do [ ! -e "$f" ] || mv "$f" /data/; done
  fi
  rm -rf "$new"
  chown -R 1000:1000 /data/hitechcloud.db /data/restore-old
  for f in uploads lead-secret; do [ ! -e "/data/$f" ] || chown -R 1000:1000 "/data/$f"; done
  echo "Dữ liệu cũ được giữ tại $old"
'; then
  # The live files are only replaced after the backup was copied and verified, so a
  # failure here leaves the current data in place: bring the site back up.
  err "Khôi phục thất bại; dữ liệu hiện tại được giữ nguyên. Đang khởi động lại app."
  compose start app || true
  exit 1
fi
compose start app

step "Chờ ứng dụng khởi động"
cid=$(compose ps -q app)
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
  [ "$status" = healthy ] && break
  sleep 2
done
[ "$status" = healthy ] || die "app chưa healthy sau 120 giây (trạng thái: $status). Xem: docker compose logs --tail 100 app"
ok "Khôi phục xong. Kiểm tra: deploy/smoke-test.sh. Xóa /data/restore-old/$NOW khi đã chắc chắn."
