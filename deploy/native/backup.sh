#!/usr/bin/env bash
# Backup for a native (systemd) install: database via scripts/backup.js and uploads.
#   sudo -u htc /opt/hitechcloud/deploy/native/backup.sh [DEST]   (default /var/backups/hitechcloud)
set -euo pipefail
APP="${HTC_APP_DIR:-/opt/hitechcloud}"
DATA="${HTC_DATA_DIR:-/var/lib/hitechcloud}"
DEST="${1:-/var/backups/hitechcloud}"
STAMP=$(date +%Y%m%d-%H%M%S)
umask 077
mkdir -p "$DEST"
out=$(cd "$APP" && DB_FILE="$DATA/hitechcloud.db" node --disable-warning=ExperimentalWarning scripts/backup.js "$DEST")
mv "${out##*: }" "$DEST/hitechcloud-$STAMP.db"
if [ -d "$DATA/uploads" ] || [ -e "$DATA/lead-secret" ]; then
  set --
  for f in uploads lead-secret; do [ ! -e "$DATA/$f" ] || set -- "$@" "$f"; done
  tar czf "$DEST/files-$STAMP.tar.gz" -C "$DATA" "$@"
fi
sums=("hitechcloud-$STAMP.db")
[ ! -f "$DEST/files-$STAMP.tar.gz" ] || sums+=("files-$STAMP.tar.gz")
(cd "$DEST" && sha256sum "${sums[@]}" > "SHA256SUMS-$STAMP")
find "$DEST" -maxdepth 1 -type f -mtime +14 \( -name 'hitechcloud-*.db' -o -name 'files-*.tar.gz' -o -name 'SHA256SUMS-*' \) -delete
echo "Sao lưu xong: $DEST ($STAMP)"
