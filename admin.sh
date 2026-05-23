#!/bin/bash
# Launch the Quests admin server and open it in the browser.
# Approve/reject routes visually, then click REBUILD SITE to regenerate index.html.
set -e
cd "$(dirname "$0")"
PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi
PORT=8766
URL="http://localhost:${PORT}"

# If something is already on the port (likely a previous admin.py), reuse it.
if curl -fs "${URL}/api/routes" >/dev/null 2>&1; then
  echo "▶ Admin already running at ${URL}"
else
  echo "▶ Starting Quests admin at ${URL}"
  "${PYTHON}" admin.py &
  SERVER_PID=$!
  # Wait until it's responsive (up to 10s)
  for i in {1..20}; do
    sleep 0.5
    if curl -fs "${URL}/api/routes" >/dev/null 2>&1; then break; fi
  done
  trap "echo; echo '▶ Stopping admin server.'; kill ${SERVER_PID} 2>/dev/null; exit" INT TERM
fi

open "${URL}"

# Keep script alive while server runs (so Ctrl+C kills it)
if [ -n "${SERVER_PID:-}" ]; then
  wait ${SERVER_PID}
fi
