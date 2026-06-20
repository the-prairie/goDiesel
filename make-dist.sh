#!/bin/bash
# Build the deployable subset of the Quests folder into dist/.
# Run this after ./rebuild.sh to package the public files for Cloudflare Pages.
#
# What ships:    index.html, cards/, route-avatars/
# What's PRIVATE: build.py, admin.py, admin.html, admin.sh, quests.json,
#                 .geo_cache.json, .geocode_buckets.json, rebuild.sh, make-dist.sh
set -e
cd "$(dirname "$0")"

DIST="dist"
rm -rf "$DIST"
mkdir -p "$DIST"

echo "▶ Copying public files into $DIST/…"
cp index.html "$DIST/"
cp -R cards   "$DIST/"
cp -R route-avatars "$DIST/"

# Optional: a tiny robots.txt and a Cloudflare _headers file for ideal caching.
cat > "$DIST/robots.txt" <<'EOF'
User-agent: *
Allow: /
EOF

# Cloudflare Pages reads this _headers file at deploy time and applies these
# rules to matching responses. Long-cache the immutable assets; short-cache HTML
# so site updates roll out within a minute.
cat > "$DIST/_headers" <<'EOF'
/cards/*
  Cache-Control: public, max-age=31536000, immutable

/route-avatars/*
  Cache-Control: public, max-age=31536000, immutable

/*.html
  Cache-Control: public, max-age=60, must-revalidate
EOF

SIZE=$(du -sh "$DIST" | awk '{print $1}')
FILES=$(find "$DIST" -type f | wc -l | tr -d ' ')
echo ""
echo "✓ dist/ ready · $SIZE · $FILES files"
echo ""
echo "Deploy options:"
echo ""
echo "  1) Cloudflare dashboard (easiest, no setup):"
echo "     → Open https://dash.cloudflare.com/?to=/:account/pages"
echo "     → Click 'Create a project' → 'Direct upload'"
echo "     → Drag the dist/ folder onto the upload area"
echo "     → Pick a project name (e.g. 'quests') and deploy"
echo ""
echo "  2) Wrangler CLI (faster for repeat deploys):"
echo "     npx wrangler pages deploy dist --project-name=godiesel"
echo "     (first run will prompt you to log in to Cloudflare via browser)"
