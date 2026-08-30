#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-route-microsite.sh <route-slug> <share-name> [options]

Options:
  --dry-run           Validate and build without contacting Cloudflare.
  --replace-existing  Explicitly replace an existing stable share branch.

Examples:
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way --dry-run
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way
EOF
}

ROUTE_SLUG="${1:-}"
SHARE_NAME="${2:-}"
DRY_RUN=false
REPLACE_EXISTING=false

if [[ -z "$ROUTE_SLUG" || -z "$SHARE_NAME" ]]; then
  usage
  exit 1
fi
if [[ ! "$ROUTE_SLUG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid route slug: $ROUTE_SLUG" >&2
  exit 1
fi
if [[ ! "$SHARE_NAME" =~ ^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "Share name must use lowercase letters, numbers, and internal hyphens." >&2
  exit 1
fi
if (( ${#SHARE_NAME} > 57 )); then
  echo "Share name must be at most 57 characters so the Pages hostname is valid." >&2
  exit 1
fi
for option in "${@:3}"; do
  case "$option" in
    --dry-run) DRY_RUN=true ;;
    --replace-existing) REPLACE_EXISTING=true ;;
    *) usage; exit 1 ;;
  esac
done

BRANCH="share-${SHARE_NAME}"
PUBLIC_URL="https://${BRANCH}.godiesel.pages.dev/"

echo "1/4 Validating route source"
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" source

echo "2/4 Building route-only bundle"
GODIESEL_SINGLE_ROUTE_SLUG="$ROUTE_SLUG" ./make-dist.sh
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" dist

echo "3/4 Running focused microsite journey"
(
  cd app
  VITE_SINGLE_ROUTE_SLUG="$ROUTE_SLUG" npx playwright test e2e/single-route-microsite.spec.ts
)

if [[ "$DRY_RUN" == "true" ]]; then
  echo "4/4 Dry run complete"
  echo "Review locally: VITE_SINGLE_ROUTE_SLUG=$ROUTE_SLUG npm --prefix app run dev"
  echo "Publish: ./scripts/publish-route-microsite.sh $ROUTE_SLUG $SHARE_NAME"
  exit 0
fi

DEPLOYMENTS_JSON=$(npx wrangler pages deployment list \
  --project-name=godiesel --environment preview --json)
if node -e '
const fs = require("node:fs");
const branch = process.argv[1];
const deployments = JSON.parse(fs.readFileSync(0, "utf8"));
process.exit(deployments.some((deployment) => deployment.Branch === branch) ? 0 : 1);
' "$BRANCH" <<<"$DEPLOYMENTS_JSON"; then
  if [[ "$REPLACE_EXISTING" != "true" ]]; then
    echo "Refusing to replace existing share ${BRANCH}." >&2
    echo "Repeat with --replace-existing only after explicit owner approval." >&2
    exit 1
  fi
fi

echo "4/4 Publishing ${PUBLIC_URL}"
npx wrangler pages deploy dist --project-name=godiesel --branch="$BRANCH" --commit-dirty=true
(
  cd app
  node scripts/smoke-single-route-microsite.mjs "$PUBLIC_URL" "$ROUTE_SLUG"
)

echo "Published route guide: ${PUBLIC_URL}#/routes/${ROUTE_SLUG}"
echo "Published replay: ${PUBLIC_URL}#/replay/${ROUTE_SLUG}"
echo "Live Google 3D imagery still requires review in a hardware-accelerated browser."
