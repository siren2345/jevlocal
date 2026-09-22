#!/bin/bash
# One-command start: Laya fast path + SemIf quality provider + gateway.
# The gateway routes automatically; nothing to configure.
set -euo pipefail
cd "$(dirname "$0")"

LAYA_DIR="${LAYA_DIR:-/Users/ryo/jevlocal-coreml-experiment}"
PIDS=""

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 30); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "$name did not become ready at $url" >&2
  return 1
}

cleanup() { [ -n "$PIDS" ] && kill $PIDS 2>/dev/null; true; }
trap cleanup EXIT INT TERM

if ! curl -fsS -m 2 http://127.0.0.1:9012/health >/dev/null 2>&1; then
  (cd "$LAYA_DIR" && exec .venv311/bin/python -m uvicorn server:app \
    --host 127.0.0.1 --port 9012 --log-level warning > /tmp/jevlocal-laya.log 2>&1) &
  PIDS="$PIDS $!"
  wait_for http://127.0.0.1:9012/health laya
else
  echo "laya: already up on :9012"
fi

if ! curl -fsS -m 2 http://127.0.0.1:9013/health >/dev/null 2>&1; then
  JEVLOCAL_PORT=9013 ./scripts/run-semif.sh > /tmp/jevlocal-semif.log 2>&1 &
  PIDS="$PIDS $!"
  wait_for http://127.0.0.1:9013/health semif
else
  echo "semif: already up on :9013"
fi

echo "gateway: http://127.0.0.1:9011 (Ctrl+C to stop)"
JEVLOCAL_PORT=9011 node server.mjs &
PIDS="$PIDS $!"
wait
