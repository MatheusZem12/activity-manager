#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR/source"

# Garante que o Electron não rode no modo "Node.js only".
export ELECTRON_RUN_AS_NODE=

# Evita um bug do Electron/Chromium no Linux com diálogos de arquivo.
export GTK_USE_PORTAL=0

env -u ELECTRON_RUN_AS_NODE npm start
