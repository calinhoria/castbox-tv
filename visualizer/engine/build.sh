#!/usr/bin/env bash
# Builds the visualiser engine core (engine/src/vze.cpp) to WebAssembly.
#
#   ./engine/build.sh          # one-shot build into visualizer/wasm/
#
# The resulting wasm/vze.js + wasm/vze.wasm are consumed by js/engine.js.
# Requires Emscripten; the script auto-sources ~/emsdk/emsdk_env.sh when emcc
# is not already on PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/engine/src/vze.cpp"
OUT="$ROOT/wasm"

if ! command -v em++ >/dev/null 2>&1; then
  for env_script in "$HOME/emsdk/emsdk_env.sh" "${EMSDK:-/nonexistent}/emsdk_env.sh"; do
    if [ -f "$env_script" ]; then
      echo "sourcing $env_script"
      # shellcheck disable=SC1090
      source "$env_script" >/dev/null 2>&1 || true
      break
    fi
  done
fi

if ! command -v em++ >/dev/null 2>&1; then
  echo "error: em++ not found. Install the Emscripten SDK:" >&2
  echo "  git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/emsdk" >&2
  echo "  (cd ~/emsdk && ./emsdk install latest && ./emsdk activate latest)" >&2
  exit 1
fi

mkdir -p "$OUT"

em++ "$SRC" \
  --no-entry \
  -O3 -std=c++17 \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createVzeModule \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sFILESYSTEM=0 \
  -sNO_EXIT_RUNTIME=1 \
  -sEXPORTED_FUNCTIONS='["_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["UTF8ToString","HEAPU8","HEAPF32","HEAP32","stringToNewUTF8"]' \
  -o "$OUT/vze.mjs"

echo "built: $OUT/vze.mjs + $OUT/vze.wasm"
ls -lh "$OUT"
