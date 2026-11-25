#!/bin/sh
# Builds the app. `./scripts/build.sh` → "MD Viewer Beta" (development, safe to run any time).
# `./scripts/build.sh stable` → "MD Viewer" (the copy in daily use; only via install.sh stable).
# The two differ in name, bundle id, URL scheme and settings, so they never interfere.
set -eu
cd "$(dirname "$0")/.."
VARIANT="${1:-beta}"
if [ "$VARIANT" = stable ]; then
  NAME="MD_mohaned"; BUNDLE_ID="com.mohanedawad.mdmohaned"; SCHEME="md-mohaned"
else
  NAME="MD_mohaned Beta"; BUNDLE_ID="com.mohanedawad.mdmohaned.beta"; SCHEME="md-mohaned-beta"
fi

./scripts/web.sh "npm run build"

APP="build/$NAME.app"
rm -rf "$APP" build/AppIcon.iconset
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp mac/Info.plist "$APP/Contents/"
PLIST="$APP/Contents/Info.plist"
plutil -replace CFBundleName -string "$NAME" "$PLIST"
plutil -replace CFBundleDisplayName -string "$NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -replace CFBundleURLTypes.0.CFBundleURLSchemes.0 -string "$SCHEME" "$PLIST"
cp -R web/dist "$APP/Contents/Resources/web"
cp "fixtures/Feature Tour.md" "$APP/Contents/Resources/"
swift mac/make-icon.swift build/AppIcon.iconset "$VARIANT"
iconutil -c icns build/AppIcon.iconset -o "$APP/Contents/Resources/AppIcon.icns"
swiftc -O -swift-version 5 -target arm64-apple-macos13.3 mac/Sources/*.swift -o "$APP/Contents/MacOS/MDViewer"
codesign --force --sign - "$APP"
echo "Built $APP"
