#!/bin/bash

set -euo pipefail

SOURCE_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ACCEPTANCE_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/godiesel-route-share.XXXXXX")
CHECKOUT="$ACCEPTANCE_PARENT/checkout"
PREVIEW_PID=""

cleanup() {
  if [[ -n "$PREVIEW_PID" ]]; then
    kill "$PREVIEW_PID" >/dev/null 2>&1 || true
  fi
  git -C "$SOURCE_ROOT" worktree remove --force "$CHECKOUT" >/dev/null 2>&1 || true
  rm -rf "$ACCEPTANCE_PARENT"
}
trap cleanup EXIT

git -C "$SOURCE_ROOT" worktree add --detach "$CHECKOUT" HEAD >/dev/null

if [[ -d "$SOURCE_ROOT/.venv" ]]; then
  ln -s "$SOURCE_ROOT/.venv" "$CHECKOUT/.venv"
fi
if [[ -d "$SOURCE_ROOT/app/node_modules" ]]; then
  ln -s "$SOURCE_ROOT/app/node_modules" "$CHECKOUT/app/node_modules"
fi

cd "$CHECKOUT"
mkdir -p .route-share
node - \
  "$CHECKOUT/tests/fixtures/routes/high-plateau-no-elevation.gpx" \
  "$CHECKOUT/.route-share/acceptance-request.json" <<'NODE'
const fs = require("node:fs");
const [sourcePath, destination] = process.argv.slice(2);
fs.writeFileSync(destination, JSON.stringify({
  schema_version: 1,
  gpx_path: sourcePath,
  activity_type: "Run",
  route_name: "Acceptance Plateau",
  region: "High Plateau",
  source_description: "A fixture for the complete prompt-to-preview workflow.",
  desired_route_id: "gpx-acceptance-plateau",
  curation: {
    vibe: "A high plateau line where distance, exposure, and self-sufficiency set the pace.",
    ideal_use: "A deliberate scouting review before any real-world attempt.",
    terrain: ["High plateau trail"],
    difficulty: "Demanding and remote",
    highlights: ["Open plateau traverse"],
    caveats: ["Treat weather and remoteness as unresolved until locally verified"],
    seasonality: "Confirm local access and conditions before use.",
    editorial_note: "The supplied geometry is authoritative; the guide language remains editorial.",
  },
  annotations: [{
    id: "weather-exposure",
    at_distance_m: 500,
    kind: "warning",
    evidence: "hypothesis",
    body: "Exposure may change quickly; verify local weather and route access.",
  }],
}, null, 2) + "\n");
NODE

./scripts/route.sh propose \
  --request .route-share/acceptance-request.json \
  > .route-share/acceptance-proposal.json
./scripts/route.sh create \
  --proposal .route-share/acceptance-proposal.json \
  > .route-share/acceptance-create.json
./scripts/route.sh create \
  --proposal .route-share/acceptance-proposal.json \
  > .route-share/acceptance-retry.json
./scripts/route.sh preview gpx-acceptance-plateau --detach \
  > .route-share/acceptance-preview.txt
PREVIEW_PID=$(tr -cd '0-9' < .route-share/preview-gpx-acceptance-plateau.pid)
GUIDE_URL=$(awk '/Local route guide:/ {print $4}' .route-share/acceptance-preview.txt)
BASE_URL=${GUIDE_URL%%#*}
curl --fail --silent --show-error \
  "${BASE_URL}data/routes/gpx-acceptance-plateau.json" >/dev/null
if curl --fail --silent \
  "${BASE_URL}data/routes/3519505225411091950.json" >/dev/null 2>&1; then
  echo "Detached preview exposed unrelated route data." >&2
  exit 1
fi

node - <<'NODE'
const fs = require("node:fs");
const route = JSON.parse(fs.readFileSync(
  "app/public/data/routes/gpx-acceptance-plateau.json",
  "utf8",
));
const retry = JSON.parse(fs.readFileSync(
  ".route-share/acceptance-retry.json",
  "utf8",
));
if (route.lifecycle !== "discovered" || route.date !== "") {
  throw new Error("acceptance route lifecycle/date provenance changed");
}
if (route.elevation_status !== "unavailable" || route.elevation_gain_m !== null) {
  throw new Error("acceptance route elevation availability changed");
}
if (route.route.some((point) => point.elev !== null || "elapsed_s" in point)) {
  throw new Error("acceptance route invented elevation or owner elapsed time");
}
if (route.curation?.vibe !== "A high plateau line where distance, exposure, and self-sufficiency set the pace.") {
  throw new Error("acceptance route lost its intended guide premise");
}
if (route.annotations?.[0]?.body !== "Exposure may change quickly; verify local weather and route access.") {
  throw new Error("acceptance route lost its safety annotation");
}
if (retry.result !== "already_applied" || !retry.validation?.publishable) {
  throw new Error("acceptance retry did not revalidate canonical state");
}
const dataFiles = fs.readdirSync("dist/data/routes");
if (dataFiles.length !== 1 || dataFiles[0] !== "gpx-acceptance-plateau.json") {
  throw new Error("acceptance bundle contains unrelated route data");
}
if (fs.existsSync("dist/media")) {
  throw new Error("acceptance bundle contains unrelated route media");
}
NODE

echo "Prompt-to-preview acceptance passed with an isolated local server and no public deployment."
