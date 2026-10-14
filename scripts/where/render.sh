#!/bin/sh
# Regenerate the public Where images from synthetic demo data. macOS + Google Chrome.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/src/usual/public"
TMP="$(mktemp -d)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
python3 "$ROOT/src/usual/where.py" board --demo --html "$OUT/where-demo.html"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1440,960 --force-device-scale-factor=2 \
  --screenshot="$TMP/board.png" "file://$OUT/where-demo.html" 2>/dev/null
cp "$TMP/board.png" "$OUT/where-board.png"
cp "$(dirname "$0")/og.html" "$TMP/og.html"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 --force-device-scale-factor=1 \
  --screenshot="$OUT/where-og.png" "file://$TMP/og.html" 2>/dev/null
rm -rf "$TMP"
echo "Wrote where-demo.html, where-board.png, where-og.png"
