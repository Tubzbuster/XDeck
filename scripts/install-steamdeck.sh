#!/usr/bin/env bash
# Installs XDeck on a Steam Deck (SteamOS 3.x, Desktop Mode, no sudo needed):
#   1. copies the AppImage to ~/Applications
#   2. installs umu-launcher for running Windows games through Proton
#   3. fetches the Xbox app icon from the Microsoft Store catalog
#   4. creates a desktop entry and adds XDeck to Steam as a non-Steam game
#
# usage: install-steamdeck.sh [path/to/XDeck.AppImage] [--no-umu] [--no-steam]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/xdeck"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/xdeck"
APP_DIR="$HOME/Applications"
DESKTOP_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/applications/xdeck.desktop"
ICON="$DATA_DIR/icons/xdeck.png"

appimage=""
with_umu=1
with_steam=1
for arg in "$@"; do
  case "$arg" in
    --no-umu) with_umu=0 ;;
    --no-steam) with_steam=0 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) appimage="$arg" ;;
  esac
done

if [[ -z "$appimage" ]]; then
  for candidate in "$REPO_DIR"/dist/XDeck-*.AppImage; do
    if [[ -f "$candidate" && ( -z "$appimage" || "$candidate" -nt "$appimage" ) ]]; then
      appimage="$candidate"
    fi
  done
fi
if [[ -z "$appimage" || ! -f "$appimage" ]]; then
  echo "No XDeck AppImage found. Build one with 'npm run dist' or pass its path." >&2
  exit 1
fi

echo "==> Installing $(basename "$appimage") to $APP_DIR"
mkdir -p "$APP_DIR" "$DATA_DIR/icons" "$CONFIG_DIR"
install -m 755 "$appimage" "$APP_DIR/XDeck.AppImage"

if (( with_umu )); then
  echo "==> Setting up umu-launcher"
  bash "$SCRIPT_DIR/setup-umu.sh" || echo "!! umu-launcher setup failed; XDeck will fall back to Steam's Proton." >&2
fi

echo "==> Fetching the Xbox app icon"
if ! bash "$SCRIPT_DIR/fetch-xbox-icon.sh" "$ICON"; then
  cp "$REPO_DIR/assets/icons/xdeck.png" "$ICON"
  echo "   Using XDeck's built-in icon instead."
fi

if [[ ! -f "$CONFIG_DIR/library.json" ]]; then
  cp "$REPO_DIR/config/library.example.json" "$CONFIG_DIR/library.json"
  echo "==> Created $CONFIG_DIR/library.json (add your own .exe entries here)"
fi

mkdir -p "$(dirname "$DESKTOP_FILE")"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=XDeck
Comment=Xbox Game Pass dashboard for Steam Deck
Exec="$APP_DIR/XDeck.AppImage" %U
Icon=$ICON
Terminal=false
Categories=Game;
StartupWMClass=XDeck
EOF
chmod +x "$DESKTOP_FILE"
echo "==> Desktop entry: $DESKTOP_FILE"

if (( with_steam )); then
  if command -v steamos-add-to-steam >/dev/null 2>&1; then
    echo "==> Adding XDeck to Steam (Steam must be running)"
    steamos-add-to-steam "$DESKTOP_FILE" || echo "!! Could not add automatically; see below." >&2
  else
    echo "   steamos-add-to-steam not available (not SteamOS?)."
  fi
fi

cat <<EOF

XDeck is installed.
  * If it isn't in your Steam library yet: Steam > Games > Add a Non-Steam Game > XDeck.
  * In Gaming Mode, set the controller layout for XDeck to "Gamepad" (Steam Input).
  * Cloud games: sign in to your Microsoft account the first time you open one.
  * Local games: copy XboxGames folders to ~/XboxGames or your SD card, or edit
    $CONFIG_DIR/library.json.
EOF
