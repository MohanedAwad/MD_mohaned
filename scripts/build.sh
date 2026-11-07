#!/bin/sh
# Builds "build/MD Viewer.app". JS is built in Docker; the Swift shell uses Apple's command-line tools.
set -eu
cd "$(dirname "$0")/.."

./scripts/web.sh "npm run build"

APP="build/MD Viewer.app"
rm -rf "$APP" build/AppIcon.iconset
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp mac/Info.plist "$APP/Contents/"
cp -R web/dist "$APP/Contents/Resources/web"
cp "fixtures/Feature Tour.md" "$APP/Contents/Resources/"
swift mac/make-icon.swift build/AppIcon.iconset
iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
swiftc -O -swift-version 5 -target arm64-apple-macos13.3 mac/Sources/*.swift -o "$APP/Contents/MacOS/MDViewer"
codesign --force --sign - "$APP"
echo "Built $APP"
