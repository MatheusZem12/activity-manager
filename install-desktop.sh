#!/usr/bin/env bash
#
# Installs (or removes) Activity Manager as a desktop application: creates the
# launcher in the applications menu and registers the icon. The launcher points straight
# at the code in source/, so any code change already applies on the next
# launch — there's no need to reinstall after every update.
#
# Usage:
#   ./install-desktop.sh              installs/updates the launcher and the icon
#   ./install-desktop.sh --uninstall  removes the launcher and the icons
set -euo pipefail

APP_ID="activity-manager"
APP_NAME="Activity Manager"
COMMENT="Activities with alerts and reusable clipboard texts, all local"
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

  # Undoes what the service wrote to Hyprland (shortcuts, autostart, window rules).
  if [[ -f "$HYPR_MANAGED" ]]; then
    rm -f "$HYPR_MANAGED"
    echo "  removed: $HYPR_MANAGED"
  fi
  if [[ -f "$HYPR_CONF" ]] && grep -q "${APP_ID}.conf" "$HYPR_CONF"; then
    cp "$HYPR_CONF" "${HYPR_CONF}.bak.$(date +%s)"
    # The comment line came in three forms over time: "Atalho"/"Atalhos do Activity
    # Manager" (older Portuguese versions) and "Activity Manager shortcuts".
    sed -i "/# Atalhos\? do Activity Manager/d; /# Activity Manager shortcuts/d; \|${APP_ID}\.conf|d" "$HYPR_CONF"
    hyprctl reload > /dev/null 2>&1 || true
    echo "  removed the 'source' line from $HYPR_CONF (backup created)"
  fi

  echo "Removed: $APP_NAME"
  exit 0
fi

# Makes sure the dependencies exist (the standalone Electron binary must be there).
if [[ ! -x "$ELECTRON" ]]; then
  echo "Dependencies not found — running 'npm install' in source/..."
  ( cd "$SRC" && npm install )
fi

# Renders the icon in several sizes + a vector version.
for size in 512 256 128 64 48 32; do
  out="$ICON_ROOT/${size}x${size}/apps"
  mkdir -p "$out"
  rsvg-convert -w "$size" -h "$size" "$SVG" -o "$out/${APP_ID}.png"
done
mkdir -p "$ICON_ROOT/scalable/apps"
cp "$SVG" "$ICON_ROOT/scalable/apps/${APP_ID}.svg"

# Creates the launcher. Exec calls the standalone Electron binary by absolute
# path, so it doesn't depend on node/npm/nvm being on the graphical session's PATH.
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

# A second launcher, just to open the quick window. On Hyprland the app itself
# already registers the global shortcut (Settings → Shortcuts); this exists for
# other environments and for whoever wants to call it from the app launcher.
cat > "$QUICK_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME — New activity
Comment=Opens $APP_NAME's quick window
Exec=$SRC/bin/am-trigger.sh quick
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
NoDisplay=true
EOF

# A launcher to open the quick text capture window (clipboard).
cat > "$CLIP_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME — New text
Comment=Opens $APP_NAME's text capture window
Exec=$SRC/bin/am-trigger.sh clip
Path=$SRC
Icon=$APP_ID
Terminal=false
Categories=$CATEGORIES
StartupWMClass=$APP_ID
NoDisplay=true
EOF

# A launcher to open the activity panel.
cat > "$PANEL_DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$APP_NAME — Panel
Comment=Opens $APP_NAME's activity panel
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

echo "Installed: $APP_NAME"
echo "  launcher: $DESKTOP"
echo "  quick window: $QUICK_DESKTOP"
echo "  new text (clipboard): $CLIP_DESKTOP"
echo "  activity panel: $PANEL_DESKTOP"
echo "  Look for \"$APP_NAME\" in your application launcher."
