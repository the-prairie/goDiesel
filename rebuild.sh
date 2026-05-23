#!/bin/bash
# Rebuild the Quests app from curated quests.json + current Strava data.
# Run this any time you edit quests.json or download fresh Strava data.
set -e
cd "$(dirname "$0")"
PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi
echo "▶ Rebuilding Quests…"
"${PYTHON}" build.py
echo "✓ Done."
echo "  Open: open $(pwd)/index.html"
