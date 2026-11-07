#!/bin/sh
# Runs an npm command for web/ inside Docker (node_modules live in a named volume, not on the Mac).
set -eu
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD/web":/w -v mdv-node-modules:/w/node_modules -w /w node:22-alpine \
  sh -c "npm install --no-audit --no-fund --loglevel=error && $1"
