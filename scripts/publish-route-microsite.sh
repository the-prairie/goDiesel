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
# dist/ must be the single-route bundle this run just built, complete.
node scripts/dist-manifest.mjs check --scope single-route --slug "$ROUTE_SLUG"

# `wrangler pages deploy` compiles a functions/ directory and reads
# wrangler.toml from its working directory. From the repository root that
# would publish the course and discovery APIs, with their bindings, on the
# share's hostname. Deploy from a stage that holds the scoped dist only.
echo "3/5 Staging static files"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/godiesel-share.XXXXXX")"
# Kept outside the stage: wrangler must see only dist/ in its directory.
PREVIOUS_HEADERS="$(mktemp "${TMPDIR:-/tmp}/godiesel-share-headers.XXXXXX")"
trap 'rm -rf "$STAGE" "$PREVIOUS_HEADERS"' EXIT
cp -R dist "$STAGE/dist"
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" stage "$STAGE"
# The staged copy is what wrangler uploads: it must still match the manifest.
node scripts/dist-manifest.mjs check --scope single-route --slug "$ROUTE_SLUG" \
  --dist "$STAGE/dist"

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
# not followed: any answer other than 404 means the alias exists. The same
# request's headers are kept for the receipt.
if ! PUBLIC_STATUS=$(curl --silent --show-error \
  --output /dev/null --dump-header "$PREVIOUS_HEADERS" --write-out '%{http_code}' \
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

# A receipt per publish, under the ignored .route-share/publish/, records the
# phase this run reached: validated -> deployed -> smoke-passed | smoke-failed,
# or deploy-failed. A receipt left at "validated" means the run stopped during
# the deploy, so whether the alias changed is unknown. When an existing alias is
# replaced, it records what the collision check could observe of the previous
# deployment. Nothing is rolled back automatically.
utc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_string() {
  local value
  value=$(printf '%s' "$1" | tr -d '\000-\037')
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}
json_or_null() {
  if [[ -n "$1" ]]; then json_string "$1"; else printf 'null'; fi
}
header_value() {
  grep -i "^$1:" "$PREVIOUS_HEADERS" 2>/dev/null | tail -n 1 | cut -d: -f2- \
    | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' || true
}

COMMIT_HASH="$(git rev-parse HEAD)"
DIST_DIGEST=$(sed -n 's/^  "content_digest": "\(sha256:[0-9a-f]*\)",*$/\1/p' .dist-manifest.json)
RECEIPT_STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RECEIPT_DIR=".route-share/publish"
RECEIPT="${RECEIPT_DIR}/${SHARE_NAME}-${RECEIPT_STAMP}.json"
if [[ -e "$RECEIPT" ]]; then
  RECEIPT="${RECEIPT_DIR}/${SHARE_NAME}-${RECEIPT_STAMP}-$$.json"
fi
mkdir -p "$RECEIPT_DIR"

if [[ "$PUBLIC_STATUS" == "404" ]]; then
  REPLACED_JSON="null"
else
  REPLACED_JSON="{
    \"alias\": $(json_string "$BRANCH"),
    \"public_url\": $(json_string "$PUBLIC_URL"),
    \"previous_observed_at\": $(json_string "$(utc_now)"),
    \"previous_http_status\": $(json_string "$PUBLIC_STATUS"),
    \"previous_etag\": $(json_or_null "$(header_value etag)"),
    \"previous_last_modified\": $(json_or_null "$(header_value last-modified)"),
    \"previous_deployment_id\": null,
    \"previous_deployment_note\": \"The previous Pages deployment id is not observable from the alias response; list deployments for the branch in Cloudflare to identify it.\"
  }"
fi

PHASE=""
PHASES_JSON=""
EXTRA_JSON=""
record_phase() {
  PHASE="$1"
  if [[ -n "$PHASES_JSON" ]]; then PHASES_JSON="${PHASES_JSON},"; fi
  PHASES_JSON="${PHASES_JSON}
    {\"phase\": $(json_string "$PHASE"), \"at\": $(json_string "$(utc_now)")}"
  cat > "${RECEIPT}.tmp" <<RECEIPT_JSON
{
  "receipt": "route-share-publish",
  "share_name": $(json_string "$SHARE_NAME"),
  "branch": $(json_string "$BRANCH"),
  "public_url": $(json_string "$PUBLIC_URL"),
  "route_slug": $(json_string "$ROUTE_SLUG"),
  "commit": $(json_string "$COMMIT_HASH"),
  "dist_content_digest": $(json_or_null "$DIST_DIGEST"),
  "phase": $(json_string "$PHASE"),
  "phases": [${PHASES_JSON}
  ],${EXTRA_JSON}
  "replaced": ${REPLACED_JSON}
}
RECEIPT_JSON
  mv "${RECEIPT}.tmp" "$RECEIPT"
}

record_phase validated
echo "Publish receipt: ${RECEIPT}"

echo "5/5 Publishing ${PUBLIC_URL}"
if (
  cd "$STAGE"
  npx wrangler pages deploy dist --project-name=godiesel --branch="$BRANCH" \
    --commit-hash="$COMMIT_HASH" --commit-dirty=true
); then
  record_phase deployed
else
  DEPLOY_EXIT=$?
  EXTRA_JSON="
  \"deploy_exit_code\": ${DEPLOY_EXIT},"
  record_phase deploy-failed
  echo "Deploy failed (exit ${DEPLOY_EXIT}). Receipt: ${RECEIPT}" >&2
  exit "$DEPLOY_EXIT"
fi

if (
  cd app
  node scripts/smoke-single-route-microsite.mjs "$PUBLIC_URL" "$ROUTE_SLUG"
); then
  record_phase smoke-passed
else
  SMOKE_EXIT=$?
  EXTRA_JSON="
  \"smoke_exit_code\": ${SMOKE_EXIT},"
  record_phase smoke-failed
  {
    echo "Smoke test failed (exit ${SMOKE_EXIT}) after deploying."
    echo "${PUBLIC_URL} is now serving the failed bundle."
    echo "No automatic rollback was attempted. Receipt: ${RECEIPT}"
  } >&2
  exit 1
fi

echo "Published route guide: ${PUBLIC_URL}#/routes/${ROUTE_SLUG}"
echo "Published replay: ${PUBLIC_URL}#/replay/${ROUTE_SLUG}"
echo "Live Google 3D imagery still requires review in a hardware-accelerated browser."
