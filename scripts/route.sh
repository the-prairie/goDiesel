#!/bin/bash
# One entry point for the route workflow.
#
# The pieces already existed as separate scripts, and the curator had to hold
# the order in their head: rebuild, curate, dry run, publish. This composes
# them. Every guard in the underlying scripts is preserved, because this calls
# them rather than reimplementing them.
set -euo pipefail
cd "$(dirname "$0")/.."

PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/route.sh <command> [arguments]

  status [slug...]          Where a route stands. No arguments summarises the atlas.
  propose --request <file>  Validate intake and emit a reviewable JSON proposal.
  create --proposal <file>  Apply an approved proposal and rebuild route data.
  build                     Regenerate route data from quests.json and the sources.
  curate                    Open Admin with its local owner writer.
  check <slug>              Validate and build a route-only bundle, without publishing.
  preview <slug> [--detach] Validate, then serve a route-only local preview.
  publish <slug> <name> [--replace-existing]
                            Publish to https://share-<name>.godiesel.pages.dev/

Examples:
  ./scripts/route.sh status
  ./scripts/route.sh status 17654151284
  ./scripts/route.sh propose --request /path/to/request.json
  ./scripts/route.sh create --proposal /path/to/proposal.json
  ./scripts/route.sh preview 17654151284 --detach
  ./scripts/route.sh check 17654151284
  ./scripts/route.sh publish 17654151284 kyoto-hills
EOF
}

command="${1:-}"
shift || true

case "$command" in
  status)
    exec "${PYTHON}" route_status.py "$@"
    ;;

  propose)
    exec "${PYTHON}" route_create.py propose "$@"
    ;;

  create)
    exec "${PYTHON}" route_create.py create "$@"
    ;;

  build)
    exec ./rebuild.sh
    ;;

  curate)
    exec ./admin.sh
    ;;

  check)
    slug="${1:-}"
    if [[ -z "$slug" ]]; then usage; exit 1; fi
    PYTHONDONTWRITEBYTECODE=1 "${PYTHON}" -m pytest -q -p no:cacheprovider \
      test_route_create.py test_route_provenance.py
    # Report readiness before spending a build on it.
    "${PYTHON}" route_status.py "$slug"
    echo
    exec ./scripts/publish-route-microsite.sh "$slug" "check-only" --dry-run
    ;;

  preview)
    slug="${1:-}"
    if [[ -z "$slug" ]]; then usage; exit 1; fi
    exec ./scripts/route-preview.sh "$@"
    ;;

  publish)
    slug="${1:-}"
    share="${2:-}"
    if [[ -z "$slug" || -z "$share" ]]; then usage; exit 1; fi
    "${PYTHON}" route_status.py "$slug"
    echo
    # A publishable route is one whose geometry and generated record are sound.
    # A draft guide is not a blocker: publishing a scouted route with an
    # unfinished guide is a legitimate choice, and the page says which it is.
    if ! "${PYTHON}" - "$slug" <<'PY'
import sys
from pathlib import Path
from route_status import route_status
status = route_status(Path('.'), sys.argv[1])
sys.exit(0 if status['publishable'] else 1)
PY
    then
      echo "Refusing to publish: the route is blocked above." >&2
      exit 1
    fi
    exec ./scripts/publish-route-microsite.sh "$slug" "$share" "${@:3}"
    ;;

  ""|-h|--help|help)
    usage
    ;;

  *)
    echo "Unknown command: $command" >&2
    usage
    exit 1
    ;;
esac
