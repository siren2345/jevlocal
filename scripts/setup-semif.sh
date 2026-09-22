#!/bin/bash
# Reproducible SemIf provider install. No /tmp dependency afterwards.
#
# - clones SemIf to vendor/SemIf at the pinned commit
# - creates .venv-semif and installs the documented [mlx] extra
# - prefetches the pinned Qwen3.5-4B revision into the HF cache
# - writes providers/semif-mlx.lock (pip freeze) for auditability
#
# Idempotent: safe to re-run. Re-checkout + reinstall if pins change.
set -euo pipefail
cd "$(dirname "$0")/.."

SEMIF_REPO="https://github.com/TheoLeeCJ/SemIf.git"
SEMIF_COMMIT="1f2dea3e25379f9dfc98cb83c324f00ab5deda37"
MODEL="Qwen/Qwen3.5-4B"
REVISION="851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a"

if [ ! -d vendor/SemIf/.git ]; then
  mkdir -p vendor
  git clone "$SEMIF_REPO" vendor/SemIf
fi
git -C vendor/SemIf fetch --quiet origin
git -C vendor/SemIf checkout --quiet "$SEMIF_COMMIT"
echo "SemIf: $(git -C vendor/SemIf rev-parse --short HEAD) $(git -C vendor/SemIf log -1 --format=%s)"

if [ ! -x .venv-semif/bin/python ]; then
  python3.12 -m venv .venv-semif
fi
.venv-semif/bin/pip install --quiet --upgrade pip
.venv-semif/bin/pip install --quiet -e 'vendor/SemIf[mlx]'
.venv-semif/bin/pip freeze > providers/semif-mlx.lock
echo "venv: $(.venv-semif/bin/python --version 2>&1), $(grep -c '==' providers/semif-mlx.lock) pinned packages"

HF_HUB_OFFLINE=0 .venv-semif/bin/python - <<PY
from huggingface_hub import snapshot_download
path = snapshot_download(repo_id="$MODEL", revision="$REVISION")
print(f"model: {path}")
PY

echo "OK: vendor/SemIf, .venv-semif, providers/semif-mlx.lock ready."
echo "Start with: ./scripts/run-semif.sh"
