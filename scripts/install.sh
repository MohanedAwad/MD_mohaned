#!/bin/sh
# `./scripts/install.sh` installs "MD Viewer Beta" (command: mdviewer-beta).
# `./scripts/install.sh stable` replaces the daily-use "MD Viewer" — only when the owner asks.
set -eu
cd "$(dirname "$0")/.."
VARIANT="${1:-beta}"
if [ "$VARIANT" = stable ]; then NAME="MD Viewer"; CMD="mdviewer"; else NAME="MD Viewer Beta"; CMD="mdviewer-beta"; fi
./scripts/build.sh "$VARIANT"
DEST="$HOME/Applications/$NAME.app"
mkdir -p "$HOME/Applications"
osascript -e "quit app \"$NAME\"" 2>/dev/null || true
rm -rf "$DEST"
cp -R "build/$NAME.app" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
mkdir -p "$HOME/.local/bin"
ln -sf "$DEST/Contents/MacOS/MDViewer" "$HOME/.local/bin/$CMD"
echo "Installed $DEST (command: ~/.local/bin/$CMD)"
