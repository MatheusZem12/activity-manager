#!/usr/bin/env bash
#
# Gatilho da janela rápida. É isto que o atalho do compositor executa.
#
# Caminho normal: o serviço já está rodando na bandeja, então mandamos uma
# linha pela porta de loopback e a janela abre na hora (bash puro, sem subir
# processo novo).
#
# Caminho de emergência: o serviço não está rodando — aí sim sobe o Electron,
# que abre a janela rápida e passa a rodar em segundo plano.
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

# Serviço fora do ar: sobe o app (ele fica na bandeja depois disso).
exec env -u ELECTRON_RUN_AS_NODE GTK_USE_PORTAL=0 \
  "$SRC/node_modules/electron/dist/electron" "$SRC" "--${COMMAND}"
