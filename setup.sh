#!/bin/bash
# One-command setup for the jevlocal-mac local Jev environment.
# Installs the fixed SemIf quality provider and verifies the Laya fast path.
set -euo pipefail
cd "$(dirname "$0")"

node --version | grep -qE "v(2[0-9]|[3-9][0-9])" || { echo "Node.js 20+ required" >&2; exit 1; }
command -v python3.12 >/dev/null || { echo "python3.12 required (brew install python@3.12)" >&2; exit 1; }

./scripts/setup-semif.sh

LAYA_DIR="${LAYA_DIR:-/Users/ryo/jevlocal-coreml-experiment}"
if [ ! -x "$LAYA_DIR/.venv311/bin/python" ]; then
  echo "Laya service not found at $LAYA_DIR (override with LAYA_DIR=...)" >&2
  exit 1
fi
echo "Laya: $LAYA_DIR ok"

echo "OK: setup complete. Start everything with ./run.sh"
