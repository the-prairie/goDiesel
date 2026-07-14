#!/bin/bash
# Regenerate React route data from curated quests.json and current Strava data.
# Run this any time you edit quests.json or download fresh Strava data.
set -e
cd "$(dirname "$0")"
PYTHON="python3"
if [ -x ".venv/bin/python" ]; then
  PYTHON=".venv/bin/python"
fi
echo "Regenerating goDiesel route data..."
"${PYTHON}" build.py
echo "Route data regenerated."
echo "Run the app with: npm --prefix app run dev"
