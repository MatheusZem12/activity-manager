#!/usr/bin/env bash
#
# Instala (ou remove) o Activity Manager como um aplicativo do desktop: cria o
# atalho no menu de aplicativos e registra o ícone. O atalho aponta direto para
# o código em source/, então qualquer alteração no código já vale no próximo
# lançamento — não é preciso reinstalar a cada atualização.
#
# Uso:
#   ./install-desktop.sh              instala/atualiza o atalho e o ícone
#   ./install-desktop.sh --uninstall  remove o atalho e os ícones
set -euo pipefail

APP_ID="activity-manager"
APP_NAME="Activity Manager"
COMMENT="Atividades com alertas e textos reutilizáveis do clipboard, tudo local"
CATEGORIES="Utility;Productivity;"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$REPO/source"
ELECTRON="$SRC/node_modules/electron/dist/electron"
SVG="$SRC/assets/icon.svg"

APP_DIR="$HOME/.local/share/applications"
ICON_ROOT="$HOME/.local/share/icons/hicolor"
DESKTOP="$APP_DIR/${APP_ID}.desktop"
QUICK_DESKTOP="$APP_DIR/${APP_ID}-quick.desktop"
CLIP_DESKTOP="$APP_DIR/${APP_ID}-clip.desktop"
PANEL_DESKTOP="$APP_DIR/${APP_ID}-panel.desktop"

HYPR_MANAGED="$HOME/.config/hypr/${APP_ID}.conf"
HYPR_CONF="$HOME/.config/hypr/hyprland.conf"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP" "$QUICK_DESKTOP" "$CLIP_DESKTOP" "$PANEL_DESKTOP"
  for size in 512 256 128 64 48 32; do rm -f "$ICON_ROOT/${size}x${size}/apps/${APP_ID}.png"; done
  rm -f "$ICON_ROOT/scalable/apps/${APP_ID}.svg"
  update-desktop-database "$APP_DIR" 2>/dev/null || true
  gtk-update-icon-cache -f "$ICON_ROOT" 2>/dev/null || true

  # Desfaz o que o serviço escreveu no Hyprland (atalho, autostart, window rules).
  if [[ -f "$HYPR_MANAGED" ]]; then
    rm -f "$HYPR_MANAGED"
    echo "  removido: $HYPR_MANAGED"
  fi
  if [[ -f "$HYPR_CONF" ]] && grep -q "${APP_ID}.conf" "$HYPR_CONF"; then
    cp "$HYPR_CONF" "${HYPR_CONF}.bak.$(date +%s)"
    # "Atalho"/"Atalhos": o comentário mudou de singular para plural quando o
    # clipboard entrou no app — versões antigas ainda têm o singular no arquivo.
    sed -i "/# Atalhos\? do Activity Manager/d; \|${APP_ID}\.conf|d" "$HYPR_CONF"
    hyprctl reload > /dev/null 2>&1 || true
    echo "  removido o 'source' do $HYPR_CONF (backup criado)"
  fi

  echo "Removido: $APP_NAME"
  exit 0
fi

# Garante as dependências (o binário standalone do Electron precisa existir).
if [[ ! -x "$ELECTRON" ]]; then
  echo "Dependências não encontradas — rodando 'npm install' em source/..."
  ( cd "$SRC" && npm install )
fi

# Renderiza o ícone em vários tamanhos + versão vetorial.
for size in 512 256 128 64 48 32; do
  out="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$out"
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out/${APP_ID}.png"
done
mkdir -p "$ICON_ROOT/scalable/apps"
cp "$SVG" "$ICON_ROOT/scalable/apps/${APP_ID}.svg"

# Cria o atalho. O Exec chama o binário standalone do Electron por caminho
# absoluto, então não depende de node/npm/nvm estarem no PATH da sessão gráfica.
mkdir -p "$APP_DIR"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME
Comment=$COMMENT
Exec=env -u ELECTRON_RUN_AS_NODE GTK_USE_PORTAL=0 "$ELECTRON" "$SRC" --hidden
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
X-GNOME-Autostart-enabled=true
EOF

# Segundo lançador, só para abrir a janela rápida. No Hyprland o próprio app já
# registra o atalho global (Configurações → Atalho global); isto aqui existe
# para outros ambientes e para quem quiser chamar pelo lançador de apps.
cat > "$QUICK_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME — Nova atividade
Comment=Abre a janela rápida do $APP_NAME
Exec=$SRC/bin/am-trigger.sh quick
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
NoDisplay=true
EOF

# Lançador para abrir a janela rápida de captura de texto (clipboard).
cat > "$CLIP_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME — Novo texto
Comment=Abre a janela de captura de texto do $APP_NAME
Exec=$SRC/bin/am-trigger.sh clip
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
NoDisplay=true
EOF

# Lançador para abrir o painel de atividades (a janela overlay encostada na borda).
cat > "$PANEL_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME — Painel
Comment=Abre o painel de atividades do $APP_NAME
Exec=$SRC/bin/am-trigger.sh panel
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
NoDisplay=true
EOF

update-desktop-database "$APP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f "$ICON_ROOT" 2>/dev/null || true

echo "Instalado: $APP_NAME"
echo "  atalho: $DESKTOP"
echo "  janela rápida: $QUICK_DESKTOP"
echo "  novo texto (clipboard): $CLIP_DESKTOP"
echo "  painel de atividades: $PANEL_DESKTOP"
echo "  Procure por \"$APP_NAME\" no seu lançador de aplicativos."
