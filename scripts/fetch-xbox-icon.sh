#!/usr/bin/env bash
# Downloads the Xbox app's current tile artwork from the Microsoft Store catalog
# onto this device so the XDeck shortcut uses the same icon as the Xbox app on
# Windows. The image is Microsoft's trademark: it is fetched for personal use
# at install time and is deliberately not committed to the repository.
set -euo pipefail

XBOX_APP_PRODUCT_ID="9MV0B5HZVK9Z"   # "Xbox" app in the Microsoft Store
MARKET="${XDECK_MARKET:-US}"
LANG_CODE="${XDECK_LANGUAGE:-en-us}"
OUT="${1:-${XDG_DATA_HOME:-$HOME/.local/share}/xdeck/icons/xdeck.png}"
SIZE=620

url="https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${XBOX_APP_PRODUCT_ID}&market=${MARKET}&languages=${LANG_CODE}"

image_url="$(curl -fsSL "$url" | python3 -c '
import json, sys
size = int(sys.argv[1])
product = json.load(sys.stdin)["Products"][0]
images = product["LocalizedProperties"][0]["Images"]
square = [i for i in images if i["ImagePurpose"] in ("Tile", "Logo") and i["Width"] == i["Height"]]
best = min(square, key=lambda i: abs(i["Width"] - size)) if square else None
if best:
    uri = best["Uri"]
    print(("https:" + uri) if uri.startswith("//") else uri)
' "$SIZE")"

if [[ -z "$image_url" ]]; then
  echo "Could not find the Xbox app icon in the Store catalog; keeping the default icon." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$(dirname "$OUT")"
curl -fsSL -o "$OUT.download" "$image_url"
# Store tiles have a large transparent safe area; trim it so the icon fills
# Steam's library slot. Fall back to the untrimmed image if trimming fails.
if ! python3 -I "$SCRIPT_DIR/lib/png_trim.py" "$OUT.download" "$OUT.tmp" 6; then
  cp "$OUT.download" "$OUT.tmp"
fi
mv "$OUT.tmp" "$OUT"
rm -f "$OUT.download"
echo "==> Xbox app icon saved to $OUT"
