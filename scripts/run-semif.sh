#!/bin/bash
# Start the SemIf MLX provider on loopback. Requires ./scripts/setup-semif.sh.
# Env overrides: JEVLOCAL_HOST (default 127.0.0.1), JEVLOCAL_PORT (default 9013),
# SEMIF_MODEL, SEMIF_REVISION, SEMIF_MLX_BITS, SEMIF_MLX_CACHE_LIMIT_MIB,
# SEMIF_MAX_INPUT_TOKENS (see providers/semif_server.py).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x .venv-semif/bin/python ]; then
  echo "missing .venv-semif; run ./scripts/setup-semif.sh first" >&2
  exit 1
fi
if [ ! -d vendor/SemIf/src/semif_phase1 ]; then
  echo "missing vendor/SemIf checkout; run ./scripts/setup-semif.sh first" >&2
  exit 1
fi

export JEVLOCAL_HOST="${JEVLOCAL_HOST:-127.0.0.1}"
export JEVLOCAL_PORT="${JEVLOCAL_PORT:-9013}"
exec .venv-semif/bin/python providers/semif_server.py
