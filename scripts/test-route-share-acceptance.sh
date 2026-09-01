#!/bin/bash

set -euo pipefail

SOURCE_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ACCEPTANCE_PARENT=$(mktemp -d "${TMPDIR:-/tmp}/godiesel-route-share.XXXXXX")
CHECKOUT="$ACCEPTANCE_PARENT/checkout"
PREVIEW_PID=""
REAL_NPX=$(command -v npx)

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
mkdir -p "$ACCEPTANCE_PARENT/bin"
node - "$REAL_NPX" "$ACCEPTANCE_PARENT/bin/npx" "$ACCEPTANCE_PARENT/wrangler.log" <<'NODE'
const fs = require("node:fs");
const [realNpx, destination, marker] = process.argv.slice(2);
fs.writeFileSync(destination, [
  "#!/bin/bash",
  'for argument in "$@"; do',
  '  if [[ "$argument" != "wrangler" ]]; then continue; fi',
  `  printf '%s\\n' "$*" >> ${JSON.stringify(marker)}`,
  "  exit 97",
  "done",
  `exec ${JSON.stringify(realNpx)} "$@"`,
  "",
].join("\n"));
fs.chmodSync(destination, 0o755);
NODE
export PATH="$ACCEPTANCE_PARENT/bin:$PATH"
node - \
  "$CHECKOUT/tests/fixtures/routes/high-plateau-no-elevation.gpx" \
  "$CHECKOUT/route_sources/strava/3519505225411091950.gpx" \
  "$CHECKOUT/.route-share" <<'NODE'
const fs = require("node:fs");
const [plateauSource, ownerSource, destination] = process.argv.slice(2);
fs.writeFileSync(`${destination}/plateau-request.json`, JSON.stringify({
  schema_version: 1,
  gpx_path: plateauSource,
  activity_type: "Run",
  route_name: "Acceptance Plateau",
  region: "High Plateau",
  source_description: "A high-altitude fixture used to verify unavailable elevation truth.",
  desired_route_id: "gpx-acceptance-plateau",
}, null, 2) + "\n");
fs.writeFileSync(`${destination}/owner-request.json`, JSON.stringify({
  schema_version: 1,
  gpx_path: ownerSource,
  activity_type: "Run",
  route_name: "Owner Adventure Acceptance",
  region: "Rome, Italy",
  source_description: "An owner-supplied adventure run used for the complete prompt-to-preview workflow.",
  desired_route_id: "gpx-acceptance-owner-adventure",
  curation: {
    vibe: "A long urban adventure where ancient streets and sustained distance shape the day.",
    ideal_use: "A deliberate route review before attempting the full line.",
    terrain: ["Urban streets", "Historic roads"],
    difficulty: "Long and navigation-intensive",
    highlights: ["A continuous owner-supplied line through Rome"],
    caveats: ["Verify crossings, access, weather, and water before use"],
    seasonality: "Confirm local access and conditions before use.",
    editorial_note: "The supplied geometry is authoritative; the guide language remains editorial.",
  },
  annotations: [{
    id: "crossing-review",
    at_distance_m: 500,
    kind: "warning",
    evidence: "hypothesis",
    body: "Review major crossings and local access before attempting this supplied line.",
  }],
}, null, 2) + "\n");
NODE

./scripts/route.sh propose \
  --request .route-share/plateau-request.json \
  > .route-share/plateau-proposal.json
./scripts/route.sh create \
  --proposal .route-share/plateau-proposal.json \
  > .route-share/plateau-create.json
./scripts/godiesel plan route-share \
  --request .route-share/owner-request.json --json \
  > .route-share/owner-plan-envelope.json
OWNER_PROPOSAL=$(node -e 'const value=require("./.route-share/owner-plan-envelope.json"); process.stdout.write(value.receipt.result_path)')
./scripts/godiesel apply route-share \
  --proposal "$OWNER_PROPOSAL" --authorize canonical-local --json \
  > .route-share/owner-create-envelope.json
./scripts/route.sh create \
  --proposal "$OWNER_PROPOSAL" \
  > .route-share/owner-compatibility-retry.json
./scripts/godiesel apply route-share \
  --proposal "$OWNER_PROPOSAL" --authorize canonical-local --json \
  > .route-share/owner-retry-envelope.json
./scripts/godiesel verify route-share gpx-acceptance-owner-adventure \
  --preview --detach --json > .route-share/preview-envelope.json
node -e 'const value=require("./.route-share/preview-envelope.json"); process.stdout.write(value.result.stdout)' \
  > .route-share/acceptance-preview.txt
PREVIEW_PID=$(tr -cd '0-9' < .route-share/preview-gpx-acceptance-owner-adventure.pid)
GUIDE_URL=$(awk '/Local route guide:/ {print $4}' .route-share/acceptance-preview.txt)
BASE_URL=${GUIDE_URL%%#*}
curl --fail --silent --show-error \
  "${BASE_URL}data/routes/gpx-acceptance-owner-adventure.json" >/dev/null
if curl --fail --silent \
  "${BASE_URL}data/routes/gpx-acceptance-plateau.json" >/dev/null 2>&1; then
  echo "Detached preview exposed unrelated route data." >&2
  exit 1
fi

node - <<'NODE'
const fs = require("node:fs");
const plateau = JSON.parse(fs.readFileSync(
  "app/public/data/routes/gpx-acceptance-plateau.json",
  "utf8",
));
const route = JSON.parse(fs.readFileSync(
  "app/public/data/routes/gpx-acceptance-owner-adventure.json",
  "utf8",
));
const retryEnvelope = JSON.parse(fs.readFileSync(
  ".route-share/owner-retry-envelope.json",
  "utf8",
));
const compatibilityRetry = JSON.parse(fs.readFileSync(
  ".route-share/owner-compatibility-retry.json",
  "utf8",
));
const retry = retryEnvelope.result;
if (route.lifecycle !== "discovered" || route.date !== "") {
  throw new Error("acceptance route lifecycle/date provenance changed");
}
if (plateau.elevation_status !== "unavailable" || plateau.elevation_gain_m !== null) {
  throw new Error("high-altitude fixture elevation availability changed");
}
if (plateau.route.some((point) => point.elev !== null || "elapsed_s" in point)) {
  throw new Error("high-altitude fixture invented elevation or owner elapsed time");
}
if (route.route.some((point) => "elapsed_s" in point)) {
  throw new Error("discovered owner route exposed source elapsed time");
}
if (route.curation?.vibe !== "A long urban adventure where ancient streets and sustained distance shape the day.") {
  throw new Error("acceptance route lost its intended guide premise");
}
if (route.annotations?.[0]?.body !== "Review major crossings and local access before attempting this supplied line.") {
  throw new Error("acceptance route lost its safety annotation");
}
if (retry.result !== "already_applied" || !retry.validation?.publishable) {
  throw new Error("acceptance retry did not revalidate canonical state");
}
if (JSON.stringify(retry) !== JSON.stringify(compatibilityRetry)) {
  throw new Error("unified and compatibility retries produced different domain results");
}
const dataFiles = fs.readdirSync("dist/data/routes");
if (dataFiles.length !== 1 || dataFiles[0] !== "gpx-acceptance-owner-adventure.json") {
  throw new Error("acceptance bundle contains unrelated route data");
}
if (fs.existsSync("dist/media")) {
  throw new Error("acceptance bundle contains unrelated route media");
}
NODE

if [[ -s "$ACCEPTANCE_PARENT/wrangler.log" ]]; then
  echo "Acceptance attempted to invoke Wrangler." >&2
  exit 1
fi

echo "Prompt-to-preview acceptance passed with an isolated local server and no public deployment."
