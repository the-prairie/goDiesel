#!/bin/bash

set -euo pipefail

SOURCE_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ACCEPTANCE_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/godiesel-route-share.XXXXXX")
CHECKOUT="$ACCEPTANCE_PARENT/checkout"

cleanup() {
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
./scripts/route.sh check gpx-acceptance-plateau

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

echo "Prompt-to-preview acceptance passed without public deployment."
