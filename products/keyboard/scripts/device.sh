#!/bin/bash
# Build Telegraph signed for development and install it on a connected iPhone.
# Signs with the Xcode account on this Mac (needed for the App Group).
#   scripts/device.sh [DEVICE_UDID]     (default: PJ iPhone)
set -euo pipefail
cd "$(dirname "$0")/../ios"
DEVICE="${1:-00008150-000975C13A88401C}"
SPEC=project.yml
if [[ "${USUAL_KEYBOARD_BASE:-hex}" == "keyboardkit" ]]; then
  python3 - <<'PYKEY'
from pathlib import Path
lines=(Path.home()/'.secrets/telegraph.env').read_text().splitlines()
assert any(s.startswith('KEYBOARDKIT_LICENSE_KEY=') and s.split('=',1)[1].strip().strip("\"'") for s in lines), 'No KeyboardKit Pro key; use the default Hex build.'
PYKEY
  SPEC=project-keyboardkit.yml
fi
xcodegen generate --spec "$SPEC" >/dev/null
MINI=/Users/mini-home/projects/_factory/control-plane/scripts/mini.mjs
node "$MINI" can build-xcode | grep -q '^OK' || { echo "Mini says wait: $(node "$MINI" can build-xcode | head -1)"; exit 1; }
node "$MINI" run build-xcode -- xcodebuild -project Telegraph.xcodeproj -scheme Telegraph \
  -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath build/dd \
  -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
APP=build/dd/Build/Products/Debug-iphoneos/Telegraph.app
xcrun devicectl device install app --device "$DEVICE" "$APP" | tail -2
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing com.pauljump.telegraph | tail -1
