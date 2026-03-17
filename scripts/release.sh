#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Read version from package.json
VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').name")
ZIP_NAME="${NAME}-v${VERSION}.zip"
RELEASE_DIR="$ROOT_DIR/releases"

echo "=== Building ${NAME} v${VERSION} ==="

# 1. Clean build
npm run build

# 2. Verify dist contents
echo ""
echo "=== Verifying dist/ ==="
REQUIRED_FILES=(
  "manifest.json"
  "content.js"
  "service-worker.js"
  "src/options/index.html"
  "icons/icon16.png"
  "icons/icon48.png"
  "icons/icon128.png"
)

MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "dist/$f" ]; then
    echo "  MISSING: $f"
    MISSING=1
  else
    echo "  OK: $f"
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo "ERROR: Missing required files in dist/. Aborting."
  exit 1
fi

# 3. Ensure manifest version matches package.json
MANIFEST_VERSION=$(node -p "require('./dist/manifest.json').version")
if [ "$MANIFEST_VERSION" != "$VERSION" ]; then
  echo ""
  echo "WARNING: manifest.json version ($MANIFEST_VERSION) != package.json version ($VERSION)"
  echo "Updating manifest.json to v${VERSION}..."
  node -e "
    const fs = require('fs');
    const m = JSON.parse(fs.readFileSync('./public/manifest.json','utf8'));
    m.version = '${VERSION}';
    fs.writeFileSync('./public/manifest.json', JSON.stringify(m, null, 2) + '\n');
    fs.writeFileSync('./dist/manifest.json', JSON.stringify(m, null, 2) + '\n');
  "
fi

# 4. Create releases dir
mkdir -p "$RELEASE_DIR"

# 5. Package into zip (exclude hidden files, source maps)
echo ""
echo "=== Packaging ==="
cd dist
rm -f "$RELEASE_DIR/$ZIP_NAME"
zip -r "$RELEASE_DIR/$ZIP_NAME" . \
  -x ".*" \
  -x "__MACOSX/*" \
  -x "*.map"
cd "$ROOT_DIR"

# 6. Report
ZIP_SIZE=$(du -h "$RELEASE_DIR/$ZIP_NAME" | cut -f1)
echo ""
echo "=== Release ready ==="
echo "  File: releases/${ZIP_NAME}"
echo "  Size: ${ZIP_SIZE}"
echo ""
echo "To publish to Chrome Web Store:"
echo "  1. Go to https://chrome.google.com/webstore/devconsole"
echo "  2. Click 'New Item' or select existing extension"
echo "  3. Upload releases/${ZIP_NAME}"
echo "  4. Fill in listing details and submit for review"
