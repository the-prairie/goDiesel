#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
Usage: ./scripts/route-preview.sh <route-slug> [--detach]

Validates and builds the single-route bundle before starting a loopback-only
Vite server. --detach writes the process id and log under .route-share/.
EOF
}

ROUTE_SLUG="${1:-}"
MODE="${2:-}"
if [[ -z "$ROUTE_SLUG" || ! "$ROUTE_SLUG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  usage
  exit 1
fi
if [[ -n "$MODE" && "$MODE" != "--detach" ]]; then
  usage
  exit 1
fi

./scripts/publish-route-microsite.sh "$ROUTE_SLUG" "check-only" --dry-run

PYTHON="python3"
if [[ -x ".venv/bin/python" ]]; then
  PYTHON=".venv/bin/python"
fi
if ! "$PYTHON" - "$ROUTE_SLUG" <<'PY'
import sys
from pathlib import Path
from route_status import route_status
status = route_status(Path('.'), sys.argv[1])
sys.exit(0 if status['publishable'] else 1)
PY
then
  echo "Refusing to preview: durable source or generated route health is blocked." >&2
  exit 1
fi
PORT=$("$PYTHON" -c 'import socket
with socket.socket() as server:
    server.bind(("127.0.0.1", 0))
    print(server.getsockname()[1])')
BASE_URL="http://127.0.0.1:${PORT}/"
GUIDE_URL="${BASE_URL}#/routes/${ROUTE_SLUG}"
REPLAY_URL="${BASE_URL}#/replay/${ROUTE_SLUG}"

echo "Local route guide: ${GUIDE_URL}"
echo "Local Replay: ${REPLAY_URL}"

if [[ "$MODE" != "--detach" ]]; then
  echo "Preview remains active until this process is stopped."
  exec npm --prefix app exec vite -- preview \
    --host 127.0.0.1 --port "$PORT" --strictPort --outDir dist
fi

STATE_ROOT=".route-share"
PID_FILE="${STATE_ROOT}/preview-${ROUTE_SLUG}.pid"
LOG_FILE="${STATE_ROOT}/preview-${ROUTE_SLUG}.log"
mkdir -p "$STATE_ROOT"
if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID=$(tr -cd '0-9' < "$PID_FILE")
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "A detached preview for ${ROUTE_SLUG} is already active as PID ${EXISTING_PID}." >&2
    exit 1
  fi
fi

nohup npm --prefix app exec vite -- preview \
  --host 127.0.0.1 --port "$PORT" --strictPort --outDir dist \
  >"$LOG_FILE" 2>&1 &
PREVIEW_PID=$!
echo "$PREVIEW_PID" > "$PID_FILE"

for _attempt in {1..40}; do
  if curl --fail --silent --show-error "$BASE_URL" >/dev/null 2>&1; then
    echo "Detached preview PID: ${PREVIEW_PID}"
    echo "Preview log: ${LOG_FILE}"
    exit 0
  fi
  if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then
    echo "Preview server exited before becoming ready. See ${LOG_FILE}." >&2
    exit 1
  fi
  sleep 0.25
done

echo "Preview server did not become ready. See ${LOG_FILE}." >&2
exit 1
