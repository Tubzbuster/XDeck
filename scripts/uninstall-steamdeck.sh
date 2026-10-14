#!/usr/bin/env bash
# Removes XDeck. Game prefixes and settings are kept unless --purge is given.
# Remove the Steam shortcut by hand: right-click XDeck in Steam > Manage > Remove.
set -euo pipefail

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/xdeck"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/xdeck"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/xdeck"

rm -f "$HOME/Applications/XDeck.AppImage"
rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/xdeck.desktop"
rm -rf "$CACHE_DIR"
echo "Removed the XDeck AppImage, desktop entry and cache."

if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$DATA_DIR" "$CONFIG_DIR"
  echo "Purged $DATA_DIR (Proton prefixes, umu, logs) and $CONFIG_DIR."
else
  echo "Kept $DATA_DIR and $CONFIG_DIR (run with --purge to delete saves/prefixes and settings)."
fi
