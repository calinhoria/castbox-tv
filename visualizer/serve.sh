#!/usr/bin/env bash
# Serves the SPA. ES modules + WebAssembly need http://, file:// will not work.
#
#   ./serve.sh          -> http://localhost:8099/
#   ./serve.sh 9000
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PORT="${1:-8099}"

if [ ! -f wasm/vze.wasm ]; then
  echo "warning: wasm/vze.wasm is missing - run ./engine/build.sh first" >&2
fi

# Fail with a useful message instead of a python traceback on a busy port.
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "error: port $PORT is already in use. Try: ./serve.sh $((PORT + 1))" >&2
  exit 1
fi

echo "Visualiser Studio: http://localhost:${PORT}/"
exec python3 -m http.server "$PORT"
