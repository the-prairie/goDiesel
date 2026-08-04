#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-route-microsite.sh <route-slug> <share-name> [--dry-run]

Examples:
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way --dry-run
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way
EOF
}

ROUTE_SLUG="${1:-}"
SHARE_NAME="${2:-}"
MODE="${3:-}"

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
if [[ -n "$MODE" && "$MODE" != "--dry-run" ]]; then
  usage
  exit 1
fi

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

if [[ "$MODE" == "--dry-run" ]]; then
  echo "4/4 Dry run complete"
  echo "Review locally: VITE_SINGLE_ROUTE_SLUG=$ROUTE_SLUG npm --prefix app run dev"
  echo "Publish: ./scripts/publish-route-microsite.sh $ROUTE_SLUG $SHARE_NAME"
  exit 0
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
