#!/bin/bash
# Build the canonical React app into the Cloudflare Pages output directory.
set -euo pipefail
cd "$(dirname "$0")"

# .dist-manifest.json names what dist/ is (full or single-route). It is removed
# before anything else and written as the very last step, so a dist/ without
# one is a failed or interrupted build. See scripts/dist-manifest.mjs.
MANIFEST=".dist-manifest.json"
rm -f "$MANIFEST"

echo "Building React application..."
SINGLE_ROUTE_SLUG="${GODIESEL_SINGLE_ROUTE_SLUG:-}"
if [[ -n "$SINGLE_ROUTE_SLUG" && ! "$SINGLE_ROUTE_SLUG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid GODIESEL_SINGLE_ROUTE_SLUG: $SINGLE_ROUTE_SLUG" >&2
  exit 1
fi

# Record the source state before the build can touch tracked files.
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo unknown)
if [[ "$GIT_SHA" == "unknown" ]]; then
  GIT_DIRTY=unknown
elif [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  GIT_DIRTY=true
else
  GIT_DIRTY=false
fi

if [[ -n "$SINGLE_ROUTE_SLUG" ]]; then
  VITE_SINGLE_ROUTE_SLUG="$SINGLE_ROUTE_SLUG" npm --prefix app run build
else
  npm --prefix app run build
fi
npm --prefix app run test:bundle
node scripts/check-provider-key.mjs

rm -rf dist
mkdir -p dist
cp -R app/dist/. dist/

if [[ -n "$SINGLE_ROUTE_SLUG" ]]; then
  ROUTES_DIR="dist/data/routes"
  ROUTE_FILE="${ROUTES_DIR}/${SINGLE_ROUTE_SLUG}.json"
  if [[ ! -f "$ROUTE_FILE" ]]; then
    echo "Single-route detail file was not built: $ROUTE_FILE" >&2
    exit 1
  fi
  find dist/data -mindepth 1 -maxdepth 1 ! -name routes -exec rm -rf -- {} +
  find "$ROUTES_DIR" -depth -mindepth 1 ! -path "$ROUTE_FILE" -delete
  node scripts/scope-route-microsite.mjs "$SINGLE_ROUTE_SLUG"
fi

if [[ -n "$SINGLE_ROUTE_SLUG" ]]; then
  cat > dist/robots.txt <<'EOF'
User-agent: *
Disallow: /
EOF
else
  cat > dist/robots.txt <<'EOF'
User-agent: *
Allow: /
EOF
fi

if [[ -n "$SINGLE_ROUTE_SLUG" ]]; then
  cat > dist/_headers <<'EOF'
/*
  X-Robots-Tag: noindex, nofollow, noarchive

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/cesiumStatic/*
  Cache-Control: public, max-age=31536000, immutable

/route-avatars/*
  Cache-Control: public, max-age=31536000, immutable

/data/routes/*
  Cache-Control: public, max-age=3600, must-revalidate

/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache
EOF
else
  cat > dist/_headers <<'EOF'
/assets/*
  Cache-Control: public, max-age=31536000, immutable

/cesiumStatic/*
  Cache-Control: public, max-age=31536000, immutable

/route-avatars/*
  Cache-Control: public, max-age=31536000, immutable

/data/routes/*
  Cache-Control: public, max-age=3600, must-revalidate

/
  Cache-Control: no-cache

/index.html
  Cache-Control: no-cache
EOF
fi

if [[ -n "$SINGLE_ROUTE_SLUG" ]]; then
  node scripts/dist-manifest.mjs write --scope single-route --slug "$SINGLE_ROUTE_SLUG" \
    --git-sha "$GIT_SHA" --dirty "$GIT_DIRTY"
else
  node scripts/dist-manifest.mjs write --scope full --git-sha "$GIT_SHA" --dirty "$GIT_DIRTY"
fi

SIZE=$(du -sh dist | awk '{print $1}')
FILES=$(find dist -type f | wc -l | tr -d ' ')
echo "React dist ready: ${SIZE}, ${FILES} files"
if [[ -n "$SINGLE_ROUTE_SLUG" ]]; then
  echo "Publish with: ./scripts/publish-route-microsite.sh ${SINGLE_ROUTE_SLUG} <share-name>"
else
  echo "Deploy with: npx wrangler pages deploy dist --project-name=godiesel --branch=production"
  echo "Guarded (refuses unless dist/ is still this full build):"
  echo "  node scripts/dist-manifest.mjs check --scope full && npx wrangler pages deploy dist --project-name=godiesel --branch=production"
fi
