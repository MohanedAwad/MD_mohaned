#!/bin/sh
# Unit tests (Docker), then a rendered snapshot of every fixture with the real app.
set -eu
cd "$(dirname "$0")/.."
./scripts/web.sh "npm test"
[ -x "build/MD_mohaned Beta.app/Contents/MacOS/MDViewer" ] || ./scripts/build.sh
mkdir -p build/snapshots
for f in fixtures/*.md; do
  name=$(basename "$f" .md | tr ' ' '-')
  "build/MD_mohaned Beta.app/Contents/MacOS/MDViewer" --snapshot "$f" "build/snapshots/$name-light.png" --height 1000
  "build/MD_mohaned Beta.app/Contents/MacOS/MDViewer" --snapshot "$f" "build/snapshots/$name-dark.png" --dark --editor --width 1500 --height 1000
done
