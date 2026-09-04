#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

EARTH_ENGINE_PROJECT="${GODIESEL_EARTH_ENGINE_PROJECT:-}"
SHARE_NAME="${GODIESEL_PIPELINE_SHARE_NAME:-}"
TARGET_AUTHORITY="${GODIESEL_PIPELINE_TARGET_AUTHORITY:-}"
REPLACEMENT_AUTHORITY="${GODIESEL_PIPELINE_REPLACEMENT_AUTHORITY:-}"
REPLACE_EXISTING="${GODIESEL_PIPELINE_REPLACE_EXISTING:-}"
if [[ -z "$EARTH_ENGINE_PROJECT" || -z "$SHARE_NAME" || -z "$TARGET_AUTHORITY" || -z "$REPLACEMENT_AUTHORITY" || -z "$REPLACE_EXISTING" ]]; then
  cat >&2 <<'EOF'
The complete live pipeline gate requires:
  GODIESEL_EARTH_ENGINE_PROJECT=<registered-project>
  GODIESEL_PIPELINE_SHARE_NAME=<stable-pages-share-name>
  GODIESEL_PIPELINE_TARGET_AUTHORITY=<same-stable-pages-share-name>
  GODIESEL_PIPELINE_REPLACEMENT_AUTHORITY=<same-stable-pages-share-name>
  GODIESEL_PIPELINE_REPLACE_EXISTING=1

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
if [[ "$TARGET_AUTHORITY" != "$SHARE_NAME" || "$REPLACEMENT_AUTHORITY" != "$SHARE_NAME" ]]; then
  echo "Live pipeline authority must exactly match GODIESEL_PIPELINE_SHARE_NAME." >&2
  exit 2
fi
if [[ "$REPLACE_EXISTING" != "1" ]]; then
  echo "GODIESEL_PIPELINE_REPLACE_EXISTING must be 1 after explicit owner approval." >&2
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

cleanup() {
  if [[ -n "$DEV_PID" ]]; then
    kill "$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -rf "$INTELLIGENCE_DIR"
}
trap cleanup EXIT INT TERM

echo "[1/8] Census every real source field and rebuild every approved route"
"$PYTHON" pipeline_verification.py \
  --rebuild \
  --live-nominatim \
  --route-intelligence app/public/data/route-intelligence/14023448720.json \
  --route-intelligence app/public/data/route-intelligence/14736711660.json \
  --output "${EVIDENCE_DIR}/source-to-product.json"
"$PYTHON" -m pytest -q

echo "[2/8] Run the deterministic release gate for fault and edge coverage"
npm --prefix app run verify

echo "[3/8] Exercise the real route matrix, provider network, and isolated writer"
npm --prefix app run test:e2e:live-pipeline

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

echo "[7/8] Build, deploy, and smoke a real route-only Pages artifact"
./scripts/publish-live-pipeline-proof.sh

echo "[8/8] Complete"
echo "Live pipeline evidence: ${EVIDENCE_DIR}"
