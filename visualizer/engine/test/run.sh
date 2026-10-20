#!/usr/bin/env bash
# Builds the engine for Node and runs engine/test/test.cjs against it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../src/vze.cpp"
OUT="${TMPDIR:-/tmp}/vze_node_test.js"

if ! command -v em++ >/dev/null 2>&1; then
  # shellcheck disable=SC1090
  [ -f "$HOME/emsdk/emsdk_env.sh" ] && source "$HOME/emsdk/emsdk_env.sh" >/dev/null 2>&1
fi

echo "building node module -> $OUT"
em++ "$SRC" \
  --no-entry -O2 -std=c++17 \
  -sMODULARIZE=1 -sEXPORT_NAME=createVzeModule \
  -sENVIRONMENT=node \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 \
  -sFILESYSTEM=0 -sNO_EXIT_RUNTIME=1 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU8","HEAPF32","HEAP32","stringToNewUTF8"]' \
  -o "$OUT"

VZE_NODE_MODULE="$OUT" node "$HERE/test.cjs"
