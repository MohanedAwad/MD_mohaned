#!/bin/sh
# Builds the app and installs it to ~/Applications.
set -eu
cd "$(dirname "$0")/.."
./scripts/build.sh
DEST="$HOME/Applications/MD Viewer.app"
mkdir -p "$HOME/Applications"
osascript -e 'quit app "MD Viewer"' 2>/dev/null || true
rm -rf "$DEST"
cp -R "build/MD Viewer.app" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
echo "Installed $DEST"
