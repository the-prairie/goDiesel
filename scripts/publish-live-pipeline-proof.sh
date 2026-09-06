#!/bin/bash

set -euo pipefail
cd "$(dirname "$0")/.."

SHARE_NAME="${GODIESEL_PIPELINE_SHARE_NAME:-}"
TARGET_AUTHORITY="${GODIESEL_PIPELINE_TARGET_AUTHORITY:-}"
REPLACEMENT_AUTHORITY="${GODIESEL_PIPELINE_REPLACEMENT_AUTHORITY:-}"
REPLACE_EXISTING="${GODIESEL_PIPELINE_REPLACE_EXISTING:-}"

if [[ -z "$SHARE_NAME" || -z "$TARGET_AUTHORITY" || -z "$REPLACEMENT_AUTHORITY" || -z "$REPLACE_EXISTING" ]]; then
  echo "Live pipeline publication requires a share name, both exact authorities, and explicit replacement intent." >&2
  exit 2
fi
if [[ "$TARGET_AUTHORITY" != "$SHARE_NAME" || "$REPLACEMENT_AUTHORITY" != "$SHARE_NAME" ]]; then
  echo "Live pipeline authority must exactly match GODIESEL_PIPELINE_SHARE_NAME." >&2
  exit 2
fi
if [[ "$REPLACE_EXISTING" != "1" ]]; then
  echo "GODIESEL_PIPELINE_REPLACE_EXISTING must be 1 when replacement is explicitly intended." >&2
  exit 2
fi

exec ./scripts/publish-route-microsite.sh \
  3519505225411091950 \
  "$SHARE_NAME" \
  --authorize-target "$TARGET_AUTHORITY" \
  --authorize-replacement "$REPLACEMENT_AUTHORITY" \
  --replace-existing
