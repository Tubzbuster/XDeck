#!/usr/bin/env bash
# Installs umu-launcher (Proton outside of Steam) into ~/.local/share/xdeck/umu.
# Uses the self-contained "zipapp" release, so nothing touches SteamOS's
# read-only root filesystem and no pacman/sudo is needed.
set -euo pipefail

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/xdeck"
UMU_DIR="$DATA_DIR/umu"
API="https://api.github.com/repos/Open-Wine-Components/umu-launcher/releases/latest"

if [[ -x "$UMU_DIR/umu-run" && "${1:-}" != "--force" ]]; then
  echo "umu-launcher already installed at $UMU_DIR/umu-run (use --force to update)"
  exit 0
fi

echo "==> Looking up the latest umu-launcher release"
release_json="$(curl -fsSL "$API")"
asset_url="$(python3 -c '
import json, sys
release = json.load(sys.stdin)
for asset in release.get("assets", []):
    if asset["name"].endswith("zipapp.tar"):
        print(asset["browser_download_url"])
        break
' <<<"$release_json")"

if [[ -z "$asset_url" ]]; then
  echo "Could not find a zipapp asset in the latest umu-launcher release." >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "==> Downloading $asset_url"
curl -fL --progress-bar -o "$tmp/umu.tar" "$asset_url"

mkdir -p "$tmp/extract"
tar -xf "$tmp/umu.tar" -C "$tmp/extract"
umu_run="$(find "$tmp/extract" -type f -name umu-run | head -n1)"
if [[ -z "$umu_run" ]]; then
  echo "umu-run not found in the downloaded archive." >&2
  exit 1
fi

rm -rf "$UMU_DIR"
mkdir -p "$UMU_DIR"
cp -a "$(dirname "$umu_run")/." "$UMU_DIR/"
chmod +x "$UMU_DIR/umu-run"
echo "==> umu-launcher installed: $UMU_DIR/umu-run"
echo "    On first launch umu downloads the Steam Linux Runtime and UMU-Proton (~1 GB)."
