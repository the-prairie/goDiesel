#!/bin/bash
# Launch the React Admin with its loopback-only owner writer.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi
ADMIN_PORT=8766
APP_PORT=8787

PIDS=()
cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

if ! curl -fs "http://127.0.0.1:${ADMIN_PORT}/api/admin/status" >/dev/null 2>&1; then
  echo "Starting local owner writer on port ${ADMIN_PORT}..."
  "${PYTHON}" admin.py &
  PIDS+=("$!")
fi

if ! curl -fs "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
  echo "Starting React app on port ${APP_PORT}..."
  npm --prefix app run dev &
  PIDS+=("$!")
fi

for _ in {1..40}; do
  if curl -fs "http://127.0.0.1:${ADMIN_PORT}/api/admin/status" >/dev/null 2>&1 \
    && curl -fs "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

open "http://127.0.0.1:${APP_PORT}/#/admin"

if [ "${#PIDS[@]}" -gt 0 ]; then
  echo "Admin is ready. Press Ctrl+C to stop processes started by this script."
  wait
fi
