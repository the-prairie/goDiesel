#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(dirname -- "$SCRIPT_DIR")
PROVIDER=${1:-}

if [ -x "$REPOSITORY_ROOT/.venv/bin/python" ]; then
  PYTHON="$REPOSITORY_ROOT/.venv/bin/python"
else
  PYTHON=$(command -v python3)
fi

cd "$REPOSITORY_ROOT"
"$PYTHON" -m pytest -q test_godiesel_local_capabilities.py

case "$PROVIDER" in
  atlas)
    exec npm --prefix app run test:e2e:atlas-live
    ;;
  earth-replay)
    exec npm --prefix app run test:e2e:earth
    ;;
  google-3d)
    exec npm --prefix app run test:e2e:google-live
    ;;
  *)
    echo "provider must be atlas, earth-replay, or google-3d" >&2
    exit 2
    ;;
esac
