#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'USAGE'
Usage: ./scripts/publish-route-microsite.sh <route-slug> <share-name> [options]

Options:
  --dry-run           Validate, build, and stage without contacting Cloudflare.
  --replace-existing  Explicitly replace an existing stable share branch.

Examples:
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way --dry-run
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way
USAGE
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
# A public share without the Google key ships a replay that silently fails.
# Only a dry run may build without it.
REQUIRE_PROVIDER_KEY=1
if [[ "$DRY_RUN" == "true" ]]; then
  REQUIRE_PROVIDER_KEY=0
fi

echo "1/5 Validating route source"
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" source

echo "2/5 Building route-only bundle"
GODIESEL_REQUIRE_PROVIDER_KEY="$REQUIRE_PROVIDER_KEY" \
  GODIESEL_SINGLE_ROUTE_SLUG="$ROUTE_SLUG" \
  ./make-dist.sh
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" dist

# `wrangler pages deploy` compiles a functions/ directory and reads
# wrangler.toml from its working directory. From the repository root that
# would publish the course and discovery APIs, with their bindings, on the
# share's hostname. Deploy from a stage that holds the scoped dist only.
echo "3/5 Staging static files"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/godiesel-share.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -R dist "$STAGE/dist"
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" stage "$STAGE"

echo "4/5 Running focused microsite journey"
(
  cd app
  VITE_SINGLE_ROUTE_SLUG="$ROUTE_SLUG" npx playwright test e2e/single-route-microsite.spec.ts
)

if [[ "$DRY_RUN" == "true" ]]; then
  echo "5/5 Dry run complete"
  echo "Review locally: VITE_SINGLE_ROUTE_SLUG=$ROUTE_SLUG npm --prefix app run dev"
  echo "Publish: ./scripts/publish-route-microsite.sh $ROUTE_SLUG $SHARE_NAME"
  exit 0
fi

# The share name is a durable public URL. Publishing to a name that is already
# live replaces someone's link, so it needs explicit approval. Redirects are
# not followed: any answer other than 404 means the alias exists.
if ! PUBLIC_STATUS=$(curl --silent --show-error \
  --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 10 --max-time 30 "$PUBLIC_URL"); then
  echo "Could not verify whether ${PUBLIC_URL} already exists; refusing to publish." >&2
  exit 1
fi
if [[ "$PUBLIC_STATUS" != "404" && ! "$PUBLIC_STATUS" =~ ^(2|3)[0-9][0-9]$ && "$PUBLIC_STATUS" != "401" && "$PUBLIC_STATUS" != "403" ]]; then
  echo "Share-name collision check returned HTTP ${PUBLIC_STATUS}; refusing to publish." >&2
  exit 1
fi
if [[ "$PUBLIC_STATUS" != "404" && "$REPLACE_EXISTING" != "true" ]]; then
  echo "Refusing to replace existing share ${BRANCH} (HTTP ${PUBLIC_STATUS})." >&2
  echo "Repeat with --replace-existing only after explicit owner approval." >&2
  exit 1
fi

echo "5/5 Publishing ${PUBLIC_URL}"
COMMIT_HASH="$(git rev-parse HEAD)"
(
  cd "$STAGE"
  npx wrangler pages deploy dist --project-name=godiesel --branch="$BRANCH" \
    --commit-hash="$COMMIT_HASH" --commit-dirty=true
)
(
  cd app
  node scripts/smoke-single-route-microsite.mjs "$PUBLIC_URL" "$ROUTE_SLUG"
)

echo "Published route guide: ${PUBLIC_URL}#/routes/${ROUTE_SLUG}"
echo "Published replay: ${PUBLIC_URL}#/replay/${ROUTE_SLUG}"
echo "Live Google 3D imagery still requires review in a hardware-accelerated browser."
