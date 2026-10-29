#!/usr/bin/env bash
#
# Quick window trigger. This is what the compositor shortcut runs.
#
# Normal path: the service is already running in the tray, so we send a line
# through the loopback port and the window opens right away (plain bash, no
# new process).
#
# Fallback path: the service isn't running — only then does Electron start,
# opening the quick window and staying in the background.
set -uo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT_FILE="${XDG_RUNTIME_DIR:-/tmp}/activity-manager.port"
COMMAND="${1:-quick}"

if [[ -r "$PORT_FILE" ]]; then
  PORT="$(<"$PORT_FILE")"
  if exec 3<>"/dev/tcp/127.0.0.1/${PORT}" 2>/dev/null; then
    printf '%s\n' "$COMMAND" >&3
    read -r -t 2 -u 3 _response || true
    exec 3<&- 3>&-
    exit 0
  fi
fi

# Service down: start the app (it stays in the tray after that).
exec env -u ELECTRON_RUN_AS_NODE GTK_USE_PORTAL=0 \
  "$SRC/node_modules/electron/dist/electron" "$SRC" "--${COMMAND}"
