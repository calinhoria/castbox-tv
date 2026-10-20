#!/usr/bin/env bash
# Runs the whole test suite:
#   1. engine/test  - FFT, levels, bindings and command emission (Node build of the WASM core)
#   2. test/        - schema/engine consistency + Canvas2D backend over every preset
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NODE_MODULE="${TMPDIR:-/tmp}/vze_node_test.js"

echo "== syntax check =="
shopt -s nullglob
for f in "$ROOT"/js/*.js "$ROOT"/test/*.mjs "$ROOT"/tools/*.mjs; do
  node --check "$f" || { echo "syntax error in $f" >&2; exit 1; }
  echo "  ok  $(basename "$f")"
done
echo

"$HERE/../engine/test/run.sh"
echo
node "$HERE/spa.test.mjs" "$NODE_MODULE"
