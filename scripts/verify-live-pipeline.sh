#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

EARTH_ENGINE_PROJECT="${GODIESEL_EARTH_ENGINE_PROJECT:-}"
SHARE_NAME="${GODIESEL_PIPELINE_SHARE_NAME:-}"
if [[ -z "$EARTH_ENGINE_PROJECT" || -z "$SHARE_NAME" ]]; then
  cat >&2 <<'EOF'
The complete live pipeline gate requires:
  GODIESEL_EARTH_ENGINE_PROJECT=<registered-project>
  GODIESEL_PIPELINE_SHARE_NAME=<stable-pages-share-name>

This gate sends the selected real route geometry to the already-configured
providers and publishes a real Cloudflare Pages branch deployment.
EOF
  exit 2
fi

if [[ ! "$EARTH_ENGINE_PROJECT" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "GODIESEL_EARTH_ENGINE_PROJECT is not a valid Google Cloud project id." >&2
  exit 2
fi
if [[ ! "$SHARE_NAME" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]] || (( ${#SHARE_NAME} > 57 )); then
  echo "GODIESEL_PIPELINE_SHARE_NAME is not a DNS-safe Pages share name." >&2
  exit 2
fi

PYTHON=".venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  echo "Missing repository Python environment at $PYTHON." >&2
  exit 2
fi
if ! "$PYTHON" -c "import ee, requests" >/dev/null 2>&1; then
  echo "Install scripts/route_intelligence/requirements.txt into .venv first." >&2
  exit 2
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
EVIDENCE_DIR="app/artifacts/live-pipeline/${STAMP}"
INTELLIGENCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/godiesel-earth-engine.XXXXXX")
DEV_LOG="${EVIDENCE_DIR}/vite.log"
DEV_PID=""
mkdir -p "$EVIDENCE_DIR"

# status.json says what this evidence directory is. It is "running" from the
# start, names the step in progress, and becomes "passed" only after the last
# step. The exit trap writes "failed" (with the step and exit code) or
# "interrupted" (with the signal). A directory without status.json, or with any
# state but "passed", is not live evidence: report the gate as blocked.
# Read it with ./scripts/live-gate-status.sh <dir|latest>.
STATUS_FILE="${EVIDENCE_DIR}/status.json"
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
GATE_STATE="running"
CURRENT_STEP=""
COMPLETED_JSON=""
EXIT_CODE_JSON="null"
SIGNAL_JSON="null"
STEPS_JSON='[
    "1/8 source census and rebuild",
    "2/8 deterministic release gate",
    "3/8 live route matrix",
    "4/8 Earth Engine route intelligence",
    "5/8 credentialed preview",
    "6/8 hardware-backed journeys",
    "7/8 route-only Pages publish",
    "8/8 complete"
  ]'

write_status() {
  local current="null"
  if [[ -n "$CURRENT_STEP" ]]; then current="\"${CURRENT_STEP}\""; fi
  cat > "${STATUS_FILE}.tmp" <<STATUS_JSON
{
  "gate": "verify-live-pipeline",
  "state": "${GATE_STATE}",
  "started_at": "${STARTED_AT}",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_sha": "${GIT_SHA}",
  "share_name": "${SHARE_NAME}",
  "steps": ${STEPS_JSON},
  "current_step": ${current},
  "completed_steps": [${COMPLETED_JSON}
  ],
  "exit_code": ${EXIT_CODE_JSON},
  "signal": ${SIGNAL_JSON}
}
STATUS_JSON
  mv "${STATUS_FILE}.tmp" "$STATUS_FILE"
}

complete_current_step() {
  if [[ -n "$CURRENT_STEP" ]]; then
    if [[ -n "$COMPLETED_JSON" ]]; then COMPLETED_JSON="${COMPLETED_JSON},"; fi
    COMPLETED_JSON="${COMPLETED_JSON}
    \"${CURRENT_STEP}\""
    CURRENT_STEP=""
  fi
}

begin_step() {
  complete_current_step
  CURRENT_STEP="$1"
  write_status
}

cleanup() {
  if [[ -n "$DEV_PID" ]]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -rf "$INTELLIGENCE_DIR"
}

on_exit() {
  local code=$?
  cleanup
  if [[ "$GATE_STATE" != "passed" ]]; then
    if [[ "$SIGNAL_JSON" != "null" ]]; then
      GATE_STATE="interrupted"
    else
      GATE_STATE="failed"
    fi
    EXIT_CODE_JSON="$code"
    write_status
    echo "Live pipeline gate ${GATE_STATE} during ${CURRENT_STEP:-startup}: ${STATUS_FILE}" >&2
  fi
}

on_signal() {
  SIGNAL_JSON="\"$1\""
  exit "$2"
}

trap on_exit EXIT
trap 'on_signal INT 130' INT
trap 'on_signal TERM 143' TERM
trap 'on_signal HUP 129' HUP
write_status

begin_step "1/8 source census and rebuild"
echo "[1/8] Census every real source field and rebuild every approved route"
"$PYTHON" pipeline_verification.py \
  --rebuild \
  --live-nominatim \
  --route-intelligence app/public/data/route-intelligence/14023448720.json \
  --route-intelligence app/public/data/route-intelligence/14736711660.json \
  --output "${EVIDENCE_DIR}/source-to-product.json"
"$PYTHON" -m pytest -q

begin_step "2/8 deterministic release gate"
echo "[2/8] Run the deterministic release gate for fault and edge coverage"
npm --prefix app run verify

begin_step "3/8 live route matrix"
echo "[3/8] Exercise the real route matrix, provider network, and isolated writer"
npm --prefix app run test:e2e:live-pipeline

begin_step "4/8 Earth Engine route intelligence"
echo "[4/8] Regenerate both real Route Intelligence cases from Earth Engine"
for ROUTE_SLUG in 14023448720 14736711660; do
  "$PYTHON" scripts/route_intelligence/earth_engine_enrich.py \
    "app/public/data/routes/${ROUTE_SLUG}.json" \
    --project "$EARTH_ENGINE_PROJECT" \
    --output "${INTELLIGENCE_DIR}/${ROUTE_SLUG}.json"
  "$PYTHON" scripts/route_intelligence/local_journey_strip.py \
    "app/public/data/routes/${ROUTE_SLUG}.json" \
    "${INTELLIGENCE_DIR}/${ROUTE_SLUG}.json"
done
"$PYTHON" pipeline_verification.py \
  --route-intelligence "${INTELLIGENCE_DIR}/14023448720.json" \
  --route-intelligence "${INTELLIGENCE_DIR}/14736711660.json" \
  --output "${EVIDENCE_DIR}/live-earth-engine.json"

begin_step "5/8 credentialed preview"
echo "[5/8] Start one clean credentialed preview for all live renderer suites"
(
  cd app
  exec ./node_modules/.bin/vite --host 127.0.0.1 --port 8787
) >"$DEV_LOG" 2>&1 &
DEV_PID="$!"
for _ in {1..120}; do
  if curl -fsS "http://127.0.0.1:8787/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS "http://127.0.0.1:8787/" >/dev/null

begin_step "6/8 hardware-backed journeys"
echo "[6/8] Run every hardware-backed Google, Cesium, imagery, and export journey"
(
  cd app
  GODIESEL_ATLAS_PREVIEW_URL=http://127.0.0.1:8787 \
  GODIESEL_LIVE_EARTH_E2E=1 \
  GODIESEL_LIVE_GOOGLE_3D_E2E=1 \
    npx playwright test \
      --config playwright.live.config.ts \
      --headed \
      atlas-region-live.spec.ts \
      earth-replay-live.spec.ts \
      google-route-navigator-live.spec.ts \
      cinematic-route-trailer-live.spec.ts \
      cinematic-director-live.spec.ts \
      cinematic-export-live.spec.ts \
      route-intelligence-lab.spec.ts
)

begin_step "7/8 route-only Pages publish"
echo "[7/8] Build, deploy, and smoke a real route-only Pages artifact"
./scripts/publish-route-microsite.sh 3519505225411091950 "$SHARE_NAME"

begin_step "8/8 complete"
echo "[8/8] Complete"
complete_current_step
GATE_STATE="passed"
EXIT_CODE_JSON=0
write_status
echo "Live pipeline evidence: ${EVIDENCE_DIR} (passed)"
