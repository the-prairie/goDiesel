#!/bin/bash
# Build the canonical React app into the Cloudflare Pages output directory.
set -euo pipefail
cd "$(dirname "$0")"

echo "Building React application..."
npm --prefix app run build
npm --prefix app run test:bundle

rm -rf dist
mkdir -p dist
cp -R app/dist/. dist/

cat > dist/robots.txt <<'EOF'
User-agent: *
Allow: /
EOF

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

SIZE=$(du -sh dist | awk '{print $1}')
FILES=$(find dist -type f | wc -l | tr -d ' ')
echo "React dist ready: ${SIZE}, ${FILES} files"
echo "Deploy with: npx wrangler pages deploy dist --project-name=godiesel"
