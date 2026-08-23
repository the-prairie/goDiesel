#!/bin/bash
# Build the canonical React app into the Cloudflare Pages output directory.
set -euo pipefail
cd "$(dirname "$0")"

echo "Building React application..."
SINGLE_ROUTE_SLUG="${GODIESEL_SINGLE_ROUTE_SLUG:-}"
if [[ -n "$SINGLE_ROUTE_SLUG" && ! "$SINGLE_ROUTE_SLUG" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid GODIESEL_SINGLE_ROUTE_SLUG: $SINGLE_ROUTE_SLUG" >&2
  exit 1
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

/index.html
  Cache-Control: public, max-age=60, must-revalidate
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

/index.html
  Cache-Control: public, max-age=60, must-revalidate
EOF
fi

SIZE=$(du -sh dist | awk '{print $1}')
FILES=$(find dist -type f | wc -l | tr -d ' ')
echo "React dist ready: ${SIZE}, ${FILES} files"
echo "Deploy with: npx wrangler pages deploy dist --project-name=godiesel --branch=production"
