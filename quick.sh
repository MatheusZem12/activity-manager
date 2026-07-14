#!/usr/bin/env bash
#
# Abre a janela rápida. Normalmente você não precisa chamar isto na mão: o
# atalho global (definido nas configurações do app) já faz isso por você.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/source/bin/am-trigger.sh" quick
