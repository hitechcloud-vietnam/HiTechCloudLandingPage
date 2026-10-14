#!/usr/bin/env bash
# Online backup of the Docker Compose deployment: SQLite database (consistent
# VACUUM INTO while the app runs), uploaded images and lead-secret.
#
#   deploy/backup.sh [--dest DIR] [--keep-days N] [--remote RCLONE_REMOTE:PATH]
#
# Defaults: --dest /var/backups/hitechcloud (BACKUP_DIR), --keep-days 14 (BACKUP_KEEP_DAYS),
# --remote from BACKUP_REMOTE (optional; needs rclone, copies only files of the last 25 h).
# Output: hitechcloud-<stamp>.db, files-<stamp>.tar.gz, SHA256SUMS-<stamp>.
# Cron (02:30 daily):  30 2 * * * /opt/hitechcloud/deploy/backup.sh >> /var/log/hitechcloud-backup.log 2>&1
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DEST="${BACKUP_DIR:-/var/backups/hitechcloud}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
REMOTE="${BACKUP_REMOTE:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dest) DEST="${2:-}"; shift 2 ;;
    --keep-days) KEEP="${2:-}"; shift 2 ;;
    --remote) REMOTE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số không hợp lệ: $1" ;;
  esac
done
[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep-days phải là số"

[ -n "$(compose ps -q --status running app 2>/dev/null)" ] || die "Container app không chạy (docker compose ps)"
STAMP=$(date +%Y%m%d-%H%M%S)
umask 077
mkdir -p "$DEST"
DB="$DEST/hitechcloud-$STAMP.db"
FILES="$DEST/files-$STAMP.tar.gz"

# 1. Consistent copy inside the volume, integrity check, copy out, remove the temporary copy.
out=$(compose exec -T app node --disable-warning=ExperimentalWarning scripts/backup.js /data/backups)
inner="${out##*: }"
[ -n "$inner" ] || die "Không đọc được đường dẫn bản sao lưu từ: $out"
check=$(compose exec -T app node --disable-warning=ExperimentalWarning -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1], { readOnly: true });
  console.log(Object.values(db.prepare("PRAGMA integrity_check").get())[0]);
' "$inner")
[ "$check" = ok ] || die "Bản sao lưu lỗi integrity_check: $check"
compose cp "app:$inner" "$DB" >/dev/null 2>&1 || die "Không chép được bản sao lưu ra khỏi container"
chmod 600 "$DB"
compose exec -T app rm -f "$inner"
ok "Database: $DB ($(du -h "$DB" | cut -f1))"

# 2. Uploaded images (local storage) and the generated lead-secret, if present.
# shellcheck disable=SC2016 # expanded by the container's shell
compose exec -T app sh -c 'cd /data && set -- && for f in uploads lead-secret; do [ -e "$f" ] && set -- "$@" "$f"; done; [ $# -eq 0 ] || tar czf - "$@"' > "$FILES"
if [ -s "$FILES" ]; then ok "Tệp: $FILES ($(du -h "$FILES" | cut -f1))"; else rm -f "$FILES"; info "Không có ảnh cục bộ hoặc lead-secret để sao lưu"; fi

sums=("$(basename "$DB")")
[ -f "$FILES" ] && sums+=("$(basename "$FILES")")
(cd "$DEST" && sha256sum "${sums[@]}" > "SHA256SUMS-$STAMP")

# 3. Retention.
find "$DEST" -maxdepth 1 -type f \( -name 'hitechcloud-*.db' -o -name 'files-*.tar.gz' -o -name 'SHA256SUMS-*' \) -mtime +"$KEEP" -delete

# 4. Off-site copy.
if [ -n "$REMOTE" ]; then
  command -v rclone >/dev/null 2>&1 || die "BACKUP_REMOTE đặt nhưng chưa cài rclone"
  rclone copy "$DEST" "$REMOTE" --max-age 25h
  ok "Đã chép ra $REMOTE"
fi
ok "Sao lưu xong ($STAMP)"
