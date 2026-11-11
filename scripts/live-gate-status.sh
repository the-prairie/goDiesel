#!/bin/bash
# Report what a live-pipeline evidence directory proves.
#
#   ./scripts/live-gate-status.sh latest
#   ./scripts/live-gate-status.sh app/artifacts/live-pipeline/<stamp>
#
# Exits 0 only when the directory's status.json says "passed". Anything else
# (running, failed, interrupted, or no status.json at all) exits 1 and is
# reported as blocked: missing live evidence is never a skipped success.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
EVIDENCE_ROOT="${REPO}/app/artifacts/live-pipeline"
target="${1:-}"
if [[ -z "$target" || $# -gt 1 ]]; then
  echo "Usage: ./scripts/live-gate-status.sh <evidence-dir|latest>" >&2
  exit 2
fi

if [[ "$target" == "latest" ]]; then
  latest=""
  if [[ -d "$EVIDENCE_ROOT" ]]; then
    latest=$(ls -1 "$EVIDENCE_ROOT" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort | tail -n 1 || true)
  fi
  if [[ -z "$latest" ]]; then
    echo "blocked: no live-pipeline evidence under ${EVIDENCE_ROOT}"
    exit 1
  fi
  directory="${EVIDENCE_ROOT}/${latest}"
else
  directory="$target"
fi

status_file="${directory}/status.json"
if [[ ! -f "$status_file" ]]; then
  echo "blocked: ${directory} has no status.json, so it does not prove a passing live gate"
  exit 1
fi

field() {
  sed -n "s/^  \"$1\": \"\{0,1\}\([^\",]*\)\"\{0,1\},\{0,1\}\$/\1/p" "$status_file" | head -n 1
}

state=$(field state)
echo "Live gate evidence: ${directory}"
echo "state: ${state:-unknown}"
echo "started_at: $(field started_at)"
echo "updated_at: $(field updated_at)"
echo "git_sha: $(field git_sha)"
step=$(field current_step)
if [[ -n "$step" && "$step" != "null" ]]; then
  echo "step: ${step}"
fi
code=$(field exit_code)
if [[ -n "$code" && "$code" != "null" ]]; then
  echo "exit_code: ${code}"
fi
signal_name=$(field signal)
if [[ -n "$signal_name" && "$signal_name" != "null" ]]; then
  echo "signal: ${signal_name}"
fi

if [[ "$state" == "passed" ]]; then
  exit 0
fi
echo "blocked: the live gate did not pass (${state:-unknown})"
exit 1
