#!/usr/bin/env bash
# Shared helpers for the deploy/*.sh scripts. Source it; do not run it.

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BOLD=''; C_RESET=''
fi

info() { printf '%s\n' "$*"; }
ok() { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
err() { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die() { err "$*"; exit 1; }
step() { printf '\n%s== %s%s\n' "$C_BOLD" "$*" "$C_RESET"; }

# Repository root (the directory holding docker-compose.yml).
repo_root() { cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd; }

# env_get KEY [FILE]: value of KEY in a dotenv file without sourcing it
# (values such as "HiTechCloud <no-reply@…>" are not valid shell). Last line wins;
# surrounding single or double quotes are removed.
env_get() {
  local key="$1" file="${2:-${ENV_FILE:-.env}}" line
  [ -f "$file" ] || return 0
  line=$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1) || true
  line="${line#*=}"
  line="${line%$'\r'}"
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

# env_set KEY VALUE [FILE]: replace KEY=… in place, or append it.
env_set() {
  local key="$1" value="$2" file="${3:-${ENV_FILE:-.env}}" tmp
  tmp=$(mktemp)
  if grep -qE "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' "$file" > "$tmp"
  else
    cat "$file" > "$tmp"
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# compose …: docker compose run from the repository root.
compose() { (cd "$(repo_root)" && docker compose "$@"); }
