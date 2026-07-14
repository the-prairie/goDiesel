#!/bin/bash
# Launch the React Admin with its loopback-only owner writer.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

if ! curl -fs http://127.0.0.1:8766/api/admin/status >/dev/null 2>&1; then
  echo "Starting local owner writer on port 8766..."
  "${PYTHON}" admin.py &
  PIDS+=("$!")
fi

if ! curl -fs http://127.0.0.1:8787/ >/dev/null 2>&1; then
  echo "Starting React app on port 8787..."
  npm --prefix app run dev &
  PIDS+=("$!")
fi

for _ in {1..40}; do
  if curl -fs http://127.0.0.1:8766/api/admin/status >/dev/null 2>&1 \
    && curl -fs http://127.0.0.1:8787/ >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

open "http://127.0.0.1:8787/#/admin"

if [ "${#PIDS[@]}" -gt 0 ]; then
  echo "Admin is ready. Press Ctrl+C to stop processes started by this script."
  wait
fi
