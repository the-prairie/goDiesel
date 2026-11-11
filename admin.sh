#!/bin/bash
# Launch the React Admin with its loopback-only owner writer.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi
# The ports and readiness wait can be overridden, for example to test this
# script against stub servers. The React app still calls the writer at its
# configured VITE_ADMIN_API_URL, which defaults to port 8766.
ADMIN_PORT="${GODIESEL_ADMIN_PORT:-8766}"
APP_PORT="${GODIESEL_APP_PORT:-8787}"
READY_ATTEMPTS="${GODIESEL_ADMIN_READY_ATTEMPTS:-40}"
export GODIESEL_ADMIN_PORT="${ADMIN_PORT}"
CHECKOUT_ROOT="$(pwd -P)"

PIDS=()
cleanup() {
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# A writer answering on the port may belong to another checkout or worktree.
# Saves through it would write there, so refuse anything but this checkout.
verify_admin_checkout() {
  local served
  served="$(curl -fs --max-time 2 "http://127.0.0.1:${ADMIN_PORT}/api/admin/status" \
    | "${PYTHON}" -c 'import json, sys
status = json.load(sys.stdin)
print(status.get("checkout_root") or "", status.get("pid") or "?", sep="\t")' 2>/dev/null || true)"
  local served_root="${served%%$'\t'*}"
  local served_pid="${served#*$'\t'}"
  if [ -z "${served_root}" ]; then
    echo "admin.sh: the owner writer on port ${ADMIN_PORT} does not report its checkout," >&2
    echo "  so saves might go to another checkout. Stop it and run ./admin.sh again." >&2
    exit 1
  fi
  if [ "${served_root}" != "${CHECKOUT_ROOT}" ]; then
    echo "admin.sh: port ${ADMIN_PORT} is serving the owner writer for another checkout." >&2
    echo "  serving:   ${served_root} (pid ${served_pid})" >&2
    echo "  this one:  ${CHECKOUT_ROOT}" >&2
    echo "  Saves would write to the serving checkout. Stop pid ${served_pid} and run ./admin.sh again." >&2
    exit 1
  fi
}

if curl -fs "http://127.0.0.1:${ADMIN_PORT}/api/admin/status" >/dev/null 2>&1; then
  verify_admin_checkout
else
  echo "Starting local owner writer on port ${ADMIN_PORT}..."
  "${PYTHON}" admin.py &
  PIDS+=("$!")
fi

if ! curl -fs "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
  echo "Starting React app on port ${APP_PORT}..."
  npm --prefix app run dev &
  PIDS+=("$!")
fi

admin_ready=false
app_ready=false
for ((attempt = 0; attempt < READY_ATTEMPTS; attempt++)); do
  admin_ready=false
  app_ready=false
  curl -fs "http://127.0.0.1:${ADMIN_PORT}/api/admin/status" >/dev/null 2>&1 && admin_ready=true
  curl -fs "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1 && app_ready=true
  if [ "${admin_ready}" = true ] && [ "${app_ready}" = true ]; then
    break
  fi
  sleep 0.25
done

if [ "${admin_ready}" != true ] || [ "${app_ready}" != true ]; then
  echo "admin.sh: not ready after ${READY_ATTEMPTS} checks; not opening the browser." >&2
  [ "${admin_ready}" = true ] || echo "  owner writer is not answering on port ${ADMIN_PORT}" >&2
  [ "${app_ready}" = true ] || echo "  React app is not answering on port ${APP_PORT}" >&2
  exit 1
fi
verify_admin_checkout

open "http://127.0.0.1:${APP_PORT}/#/admin"

if [ "${#PIDS[@]}" -gt 0 ]; then
  echo "Admin is ready. Press Ctrl+C to stop processes started by this script."
  wait
fi
