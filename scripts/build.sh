#!/bin/sh
# Builds "build/MD Viewer.app". JS is built in Docker; the Swift shell uses Apple's command-line tools.
set -eu
cd "$(dirname "$0")/.."

docker run --rm -v "$PWD/web":/w -v mdv-node-modules:/w/node_modules -w /w node:22-alpine \
  sh -c "npm install --no-audit --no-fund --loglevel=error && npm run build"

APP="build/MD Viewer.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp mac/Info.plist "$APP/Contents/"
cp -R web/dist "$APP/Contents/Resources/web"
swiftc -O -swift-version 5 -target arm64-apple-macos13.3 mac/main.swift -o "$APP/Contents/MacOS/MDViewer"
codesign --force --sign - "$APP"
echo "Built $APP"
