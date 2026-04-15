#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROXIFY_BIN="${ROXIFY_BIN:-$ROOT_DIR/target/release/roxify_native}"

exec python3 "$ROOT_DIR/scripts/benchmark-cold.py" --roxify-bin "$ROXIFY_BIN" "$@"
