#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="python3"
if [[ -x ".venv/bin/python" ]]; then
  PYTHON=".venv/bin/python"
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/publish-route-microsite.sh <route-slug> <share-name> [options]

Options:
  --dry-run                       Validate and build without contacting Cloudflare.
  --authorize-target <name>       Authorize this exact stable share name.
  --authorize-replacement <name>  Authorize replacing this exact stable share name.
  --replace-existing              Explicitly replace an existing stable share branch.

Examples:
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way --dry-run
  ./scripts/publish-route-microsite.sh 3519505225411091950 appian-way \
    --authorize-target appian-way --authorize-replacement appian-way
EOF
}

ROUTE_SLUG="${1:-}"
SHARE_NAME="${2:-}"
DRY_RUN=false
REPLACE_EXISTING=false
AUTHORIZED_TARGET=""
AUTHORIZED_REPLACEMENT=""

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
shift 2
while (( $# > 0 )); do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --replace-existing)
      REPLACE_EXISTING=true
      shift
      ;;
    --authorize-target|--authorize-replacement)
      if (( $# < 2 )); then usage; exit 1; fi
      if [[ "$1" == "--authorize-target" ]]; then
        AUTHORIZED_TARGET="$2"
      else
        AUTHORIZED_REPLACEMENT="$2"
      fi
      shift 2
      ;;
    *) usage; exit 1 ;;
  esac
done

BRANCH="share-${SHARE_NAME}"
PUBLIC_URL="https://${BRANCH}.godiesel.pages.dev/"
REQUIRE_PROVIDER_KEY=1
if [[ "$DRY_RUN" == "true" ]]; then
  REQUIRE_PROVIDER_KEY=0
fi
if [[ "$DRY_RUN" != "true" && ( "$AUTHORIZED_TARGET" != "$SHARE_NAME" || "$AUTHORIZED_REPLACEMENT" != "$SHARE_NAME" ) ]]; then
  echo "Refusing to publish without exact target and replacement authority for ${SHARE_NAME}." >&2
  exit 1
fi

RELEASE_COMMIT=$(git rev-parse HEAD)
RELEASE_TREE=$(git rev-parse 'HEAD^{tree}')
verify_release_checkout() {
  if [[ "$(git rev-parse HEAD)" != "$RELEASE_COMMIT" ]] || \
     [[ "$(git rev-parse 'HEAD^{tree}')" != "$RELEASE_TREE" ]] || \
     [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
    echo "Release checkout changed or became dirty; refusing to publish." >&2
    exit 1
  fi
}
verify_release_checkout

echo "1/4 Validating route source"
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" source

echo "2/4 Building route-only bundle"
GODIESEL_REQUIRE_PROVIDER_KEY="$REQUIRE_PROVIDER_KEY" \
  GODIESEL_SINGLE_ROUTE_SLUG="$ROUTE_SLUG" \
  ./make-dist.sh
node scripts/validate-route-microsite.mjs "$ROUTE_SLUG" dist
RELEASE_MANIFEST_SHA=$(shasum -a 256 dist/artifact-manifest.json | awk '{print $1}')

echo "3/4 Running focused microsite journey"
(
  cd app
  VITE_SINGLE_ROUTE_SLUG="$ROUTE_SLUG" \
    npx playwright test e2e/single-route-microsite.spec.ts \
    --config playwright.route-share.config.ts
)
POST_JOURNEY_MANIFEST_SHA=$(shasum -a 256 dist/artifact-manifest.json | awk '{print $1}')
if [[ "$POST_JOURNEY_MANIFEST_SHA" != "$RELEASE_MANIFEST_SHA" ]]; then
  echo "Built artifact changed during its browser journey; refusing to publish." >&2
  exit 1
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "4/4 Dry run complete"
  echo "Review locally: ./scripts/route.sh preview $ROUTE_SLUG"
  echo "Publish: ./scripts/route.sh publish $ROUTE_SLUG $SHARE_NAME --authorize-target $SHARE_NAME --authorize-replacement $SHARE_NAME"
  exit 0
fi

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
if [[ "$PUBLIC_STATUS" != "404" ]]; then
  if [[ "$REPLACE_EXISTING" != "true" ]]; then
    echo "Refusing to replace existing share ${BRANCH}." >&2
    echo "Repeat with --replace-existing only after explicit owner approval." >&2
    exit 1
  fi
fi

echo "4/4 Publishing ${PUBLIC_URL}"
verify_release_checkout
node app/scripts/finalize-build-identity.mjs dist
FINAL_MANIFEST_SHA=$(shasum -a 256 dist/artifact-manifest.json | awk '{print $1}')
if [[ "$FINAL_MANIFEST_SHA" != "$RELEASE_MANIFEST_SHA" ]]; then
  echo "Built artifact changed after validation; refusing to publish." >&2
  exit 1
fi
DEPLOY_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/godiesel-route-release.XXXXXX")
cleanup_deploy_root() {
  rm -rf "$DEPLOY_ROOT"
}
trap cleanup_deploy_root EXIT
cp -R dist/. "$DEPLOY_ROOT/"
node app/scripts/finalize-build-identity.mjs "$DEPLOY_ROOT"
STAGED_MANIFEST_SHA=$(shasum -a 256 "$DEPLOY_ROOT/artifact-manifest.json" | awk '{print $1}')
if [[ "$STAGED_MANIFEST_SHA" != "$RELEASE_MANIFEST_SHA" ]]; then
  echo "Built artifact changed while staging the immutable deployment input; refusing to publish." >&2
  exit 1
fi
STAGED_IDENTITY_JSON=$("$PYTHON" - "$DEPLOY_ROOT/build-identity.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    identity = json.load(source)
if identity.get("artifact_kind") != "built-artifact":
    raise SystemExit("Staged deployment identity is not an immutable built artifact")
print(json.dumps(identity, separators=(",", ":"), sort_keys=True))
PY
)
"$PYTHON" - "$PUBLIC_URL" <<'PY'
import json
import sys

print(
    "GODIESEL_RELEASE_ATTEMPTED="
    + json.dumps(
        {"stable_alias": sys.argv[1], "external_status": "externally-unknown"},
        separators=(",", ":"),
        sort_keys=True,
    )
)
PY
set +e
DEPLOY_OUTPUT=$(npx wrangler pages deploy "$DEPLOY_ROOT" --project-name=godiesel --branch="$BRANCH" --commit-dirty=true)
DEPLOY_STATUS=$?
set -e
printf '%s\n' "$DEPLOY_OUTPUT"
if [[ "$DEPLOY_STATUS" -ne 0 ]]; then
  exit "$DEPLOY_STATUS"
fi
IMMUTABLE_URL=$(printf '%s\n' "$DEPLOY_OUTPUT" | "$PYTHON" -c '
import re
import sys
urls = re.findall(r"https://[A-Za-z0-9-]+\.godiesel\.pages\.dev/?", sys.stdin.read())
candidates = [
    url.rstrip("/") + "/"
    for url in urls
    if not url.startswith("https://share-")
]
if not candidates:
    raise SystemExit("Wrangler did not report an immutable deployment URL")
print(candidates[-1])
')
"$PYTHON" - "$IMMUTABLE_URL" "$PUBLIC_URL" <<'PY'
import json
import sys

print(
    "GODIESEL_RELEASE_OBSERVED="
    + json.dumps(
        {
            "immutable_deployment_url": sys.argv[1],
            "stable_alias": sys.argv[2],
            "external_status": "externally-unknown",
        },
        separators=(",", ":"),
        sort_keys=True,
    )
)
PY
(
  cd app
  node scripts/smoke-single-route-microsite.mjs "$IMMUTABLE_URL" "$ROUTE_SLUG"
)
(
  cd app
  node scripts/smoke-single-route-microsite.mjs "$PUBLIC_URL" "$ROUTE_SLUG"
)
"$PYTHON" - "$IMMUTABLE_URL" "$PUBLIC_URL" "$RELEASE_COMMIT" "$RELEASE_TREE" "$STAGED_IDENTITY_JSON" <<'PY'
import json
import sys

from godiesel_verification import read_target_build_identity

immutable_url, stable_alias, commit, tree, staged_identity_json = sys.argv[1:]
staged = json.loads(staged_identity_json)
immutable = dict(
    read_target_build_identity(
        immutable_url,
        expected_commit=commit,
        expected_tree=tree,
    )
)
alias = dict(
    read_target_build_identity(
        stable_alias,
        expected_commit=commit,
        expected_tree=tree,
    )
)
if immutable != staged or alias != staged:
    raise SystemExit("Stable alias does not resolve to the immutable deployment build")
print(
    "GODIESEL_RELEASE_TARGET="
    + json.dumps(
        {
            "immutable_deployment_url": immutable_url,
            "stable_alias": stable_alias,
            "commit": immutable["commit"],
            "tree": immutable["tree"],
            "build_id": immutable["build_id"],
            "artifact_manifest_sha256": immutable["artifact_manifest_sha256"],
            "smoke_status": "passed",
        },
        separators=(",", ":"),
        sort_keys=True,
    )
)
PY

echo "Published route guide: ${PUBLIC_URL}#/routes/${ROUTE_SLUG}"
echo "Published replay: ${PUBLIC_URL}#/replay/${ROUTE_SLUG}"
echo "Live Google 3D imagery still requires review in a hardware-accelerated browser."
