#!/usr/bin/env bash
# Copies the Visualiser Studio web files into the Android app's assets so
# WebInterfaceServer can serve them at http://<tv>:8092/studio/.
#
#   ./tools/sync-android-assets.sh
#
# Run this after ANY change under visualizer/ (js, css, wasm, presets, fonts,
# index.html) and before building the APK — otherwise the device keeps serving
# the previous bundle and "the changes" will not show up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/../app/src/main/assets/studio"

mkdir -p "$DEST"
cp "$ROOT/index.html" "$DEST/"
cp -r "$ROOT/css" "$ROOT/js" "$ROOT/wasm" "$ROOT/fonts" "$ROOT/assets" "$DEST/"
rm -rf "$DEST/presets"
mkdir -p "$DEST/presets"
cp -r "$ROOT"/presets/* "$DEST/presets/"

echo "synced $(find "$DEST" -type f | wc -l | tr -d ' ') files -> app/src/main/assets/studio ($(du -sh "$DEST" | cut -f1))"
