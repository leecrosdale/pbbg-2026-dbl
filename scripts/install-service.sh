#!/usr/bin/env bash
set -Eeuo pipefail

# Usage: sudo bash scripts/install-service.sh [project-directory] [run-as-user]
# Build as your normal deployment user first.
if [[ "$EUID" -ne 0 ]]; then
  printf '%s\n' 'Run this installer with sudo.' >&2
  exit 1
fi
for tool in runuser systemctl curl sed install readlink realpath stat id ss; do
  command -v "$tool" >/dev/null || { printf 'Missing command: %s\n' "$tool" >&2; exit 1; }
done
[[ -d /run/systemd/system ]] || { printf '%s\n' 'This installer needs Ubuntu with systemd running.' >&2; exit 1; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(realpath -- "${1:-$SCRIPT_DIR/..}")"
SERVICE_USER="${2:-${SUDO_USER:-$(stat -c '%U' "$APP_DIR")}}"
selected_node="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$selected_node" || ! -x "$selected_node" ]]; then
  printf '%s\n' 'Node was not found under sudo. Pass your Node path: sudo env NODE_BIN="$(command -v node)" bash scripts/install-service.sh' >&2
  exit 1
fi
NODE_BIN="$(readlink -f -- "$selected_node")"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
if [[ "$SERVICE_USER" == root ]]; then
  printf '%s\n' 'Choose a non-root service user: sudo bash scripts/install-service.sh /path/to/project ubuntu' >&2
  exit 1
fi
# These values enter a systemd unit and sed replacement.
for path in "$APP_DIR" "$NODE_BIN"; do
  [[ "$path" =~ ^/[A-Za-z0-9_./-]+$ ]] || { printf 'Unsupported path: %s\n' "$path" >&2; exit 1; }
done
for account in "$SERVICE_USER" "$SERVICE_GROUP"; do
  [[ "$account" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || { printf 'Unsupported account: %s\n' "$account" >&2; exit 1; }
done
[[ -f "$APP_DIR/dist/index.html" && -f "$APP_DIR/node_modules/ws/package.json" ]] || {
  printf '%s\n' 'Build the project first: npm ci && npm test && npm run build' >&2
  exit 1
}
[[ -f "$APP_DIR/deploy/dbl.service" ]] || { printf '%s\n' 'Missing deploy/dbl.service template.' >&2; exit 1; }
runuser -u "$SERVICE_USER" -- test -r "$APP_DIR/server/index.js" || {
  printf 'The user %s cannot read the project. Check parent directory permissions.\n' "$SERVICE_USER" >&2
  exit 1
}
node_version="$(runuser -u "$SERVICE_USER" -- "$NODE_BIN" -p 'process.versions.node')" || {
  printf 'The service user %s cannot execute %s. Use a Node installation accessible to that user.\n' "$SERVICE_USER" "$NODE_BIN" >&2
  exit 1
}
printf 'Service user: %s\nNode: v%s (%s)\n' "$SERVICE_USER" "$node_version" "$NODE_BIN"
node_major="${node_version%%.*}"
node_remainder="${node_version#*.}"
node_minor="${node_remainder%%.*}"
if (( node_major < 22 || (node_major == 22 && node_minor < 13) )); then
  printf '%s\n' 'This app requires Node.js 22.13+ for built-in SQLite without an experimental flag. sudo may be selecting a different version from your normal shell.' >&2
  printf '%s\n' 'Select your supported Node executable: sudo env NODE_BIN="$(command -v node)" bash scripts/install-service.sh' >&2
  exit 1
fi
runuser -u "$SERVICE_USER" -- "$NODE_BIN" -e 'require("node:sqlite")' || {
  printf 'Node v%s at %s could not load its built-in SQLite module. See the error above.\n' "$node_version" "$NODE_BIN" >&2
  exit 1
}
if ! systemctl is-active --quiet dbl && [[ -n "$(ss -H -ltn 'sport = :3001')" ]]; then
  printf '%s\n' 'Port 3001 is already in use. Stop the manually started npm start process before installing the service.' >&2
  exit 1
fi

# Preserve the existing database and WAL rather than moving application data.
[[ ! -L "$APP_DIR/data" ]] || { printf '%s\n' 'Use a real data directory rather than a symlink.' >&2; exit 1; }
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$APP_DIR/data"
for filename in game.sqlite game.sqlite-wal game.sqlite-shm; do
  database_file="$APP_DIR/data/$filename"
  [[ ! -L "$database_file" ]] || { printf 'Database file must not be a symlink: %s\n' "$database_file" >&2; exit 1; }
  if [[ -f "$database_file" ]]; then
    chown "$SERVICE_USER:$SERVICE_GROUP" "$database_file"
    chmod 0640 "$database_file"
  fi
done

unit_tmp="$(mktemp)"
trap 'rm -f -- "$unit_tmp"' EXIT
sed -e "s|@APP_DIR@|$APP_DIR|g" \
    -e "s|@NODE_BIN@|$NODE_BIN|g" \
    -e "s|@SERVICE_USER@|$SERVICE_USER|g" \
    -e "s|@SERVICE_GROUP@|$SERVICE_GROUP|g" \
    "$APP_DIR/deploy/dbl.service" > "$unit_tmp"
install -o root -g root -m 0644 "$unit_tmp" /etc/systemd/system/dbl.service
systemctl daemon-reload
systemctl enable dbl
systemctl restart dbl

for attempt in {1..20}; do
  if systemctl is-active --quiet dbl && curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null; then
    printf '\n%s\n' 'dbl is running on 127.0.0.1:3001 and enabled at boot.'
    printf '%s\n' 'Logs: sudo journalctl -u dbl -f' 'Restart after updates: sudo systemctl restart dbl'
    exit 0
  fi
  sleep 1
done
printf '%s\n' 'Service did not become healthy. Check the logs below.' >&2
journalctl -u dbl -n 40 --no-pager
exit 1
