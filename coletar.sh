#!/usr/bin/env bash
# Roda só o coletor do Rastro, fora do Electron — para colher dados desde já
# e para depurar sem reiniciar o app inteiro.
cd "$(dirname "$0")/source" || exit 1
exec node src/main/rastro/standalone.js "$@"
