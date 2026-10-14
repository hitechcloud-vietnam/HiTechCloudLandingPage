#!/usr/bin/env bash
# Prepares a fresh Ubuntu 22.04/24.04 or Debian 12 server for HiTechCloud LandingPage
# (docs/DEPLOYMENT.md section 4). Run as root; safe to run again.
#
#   sudo deploy/setup-server.sh [--user deploy] [--no-ufw] [--no-swap] [--dry-run]
#
# Installs updates, git/curl/jq/sqlite3/fail2ban/unattended-upgrades, Docker Engine with the
# Compose plugin (get.docker.com), limits Docker log size, sets the timezone to
# Asia/Ho_Chi_Minh, opens 22/80/443 in ufw, adds a 2 GB swap file when RAM < 2 GB and adds
# --user to the docker group. SSH hardening is left to you (docs section 4.2).
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DEPLOY_USER='' UFW=1 SWAP=1 DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --user) DEPLOY_USER="${2:-}"; shift 2 ;;
    --no-ufw) UFW=0; shift ;;
    --no-swap) SWAP=0; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Tham số không hợp lệ: $1" ;;
  esac
done

run() { if [ "$DRY" = 1 ]; then printf '+ %s\n' "$*"; else "$@"; fi; }
write_file() { # write_file PATH CONTENT
  if [ "$DRY" = 1 ]; then printf '+ ghi %s:\n%s\n' "$1" "$2"; else printf '%s\n' "$2" > "$1"; fi
}

[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || die "Cần chạy bằng root (sudo)"
. /etc/os-release 2>/dev/null || true
case "${ID:-}" in
  ubuntu|debian) ok "Hệ điều hành: ${PRETTY_NAME:-$ID}" ;;
  *)
    if [ "$DRY" = 1 ]; then warn "Hệ điều hành ${ID:-không rõ}: script chỉ hỗ trợ Ubuntu/Debian"
    else die "Chỉ hỗ trợ Ubuntu/Debian (đang là ${ID:-không rõ})"; fi ;;
esac
export DEBIAN_FRONTEND=noninteractive

step "Cập nhật hệ thống và công cụ"
run apt-get update -q
run apt-get -y -q full-upgrade
run apt-get -y -q install git curl jq sqlite3 ca-certificates fail2ban unattended-upgrades ufw rclone
run timedatectl set-timezone Asia/Ho_Chi_Minh
write_file /etc/apt/apt.conf.d/20auto-upgrades 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";'
run systemctl enable --now fail2ban

step "Docker"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Đã có $(docker --version | cut -d, -f1)"
else
  run sh -c 'curl -fsSL https://get.docker.com | sh'
fi
run mkdir -p /etc/docker
if [ ! -s /etc/docker/daemon.json ] || [ "$DRY" = 1 ]; then
  write_file /etc/docker/daemon.json '{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}'
  run systemctl restart docker
else
  warn "/etc/docker/daemon.json đã tồn tại, không ghi đè (cần có giới hạn log, xem docs mục 4.5)"
fi
run systemctl enable docker
if [ -n "$DEPLOY_USER" ]; then
  id "$DEPLOY_USER" >/dev/null 2>&1 || [ "$DRY" = 1 ] || die "Không có người dùng $DEPLOY_USER (tạo bằng: adduser $DEPLOY_USER)"
  run usermod -aG docker "$DEPLOY_USER"
  # Backups and their log belong to the operator, so backup.sh/update.sh/cron run without sudo.
  run install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/hitechcloud
  [ -e /var/log/hitechcloud-backup.log ] || run install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null /var/log/hitechcloud-backup.log
fi

if [ "$UFW" = 1 ]; then
  step "Tường lửa (ufw)"
  run ufw default deny incoming
  run ufw default allow outgoing
  run ufw allow OpenSSH
  run ufw allow 80/tcp
  run ufw allow 443/tcp
  run ufw allow 443/udp
  run ufw --force enable
fi

if [ "$SWAP" = 1 ]; then
  step "Swap"
  mem_mb=$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo)
  if [ "$mem_mb" -ge 2048 ]; then ok "RAM ${mem_mb} MB, không cần thêm swap"
  elif [ -e /swapfile ]; then ok "Đã có /swapfile"
  else
    run fallocate -l 2G /swapfile
    run chmod 600 /swapfile
    run mkswap /swapfile
    run swapon /swapfile
    run sh -c "echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  fi
fi

step "Xong"
info "Tiếp theo (người dùng ${DEPLOY_USER:-vận hành}, đăng nhập lại để nhận nhóm docker):"
info "  1. git clone https://github.com/hitechcloud-vietnam/HiTechCloudLandingPage.git /opt/hitechcloud"
info "  2. cd /opt/hitechcloud && deploy/init-env.sh"
info "  3. deploy/preflight.sh && docker compose up -d --build && deploy/smoke-test.sh"
