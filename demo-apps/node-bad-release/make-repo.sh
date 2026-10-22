#!/usr/bin/env bash
# Creates a standalone git repo with two branches for scenario S9:
#   main             — healthy app
#   feature/checkout — crashes at startup (wrong require path)
# Usage: ./make-repo.sh <target-dir>
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${1:?usage: make-repo.sh <target-dir>}"
[ -e "$DEST" ] && { echo "target exists: $DEST" >&2; exit 1; }

mkdir -p "$DEST"
cp -R "$SRC/index.js" "$SRC/package.json" "$SRC/lib" "$SRC/.liaraignore" "$DEST/"
cd "$DEST"
git init -q -b main
git -c user.name=demo -c user.email=demo@example.invalid add -A
git -c user.name=demo -c user.email=demo@example.invalid commit -qm "main: healthy release"

git checkout -q -b feature/checkout
cp -R "$SRC/branches/feature-checkout/." "$DEST/"
git -c user.name=demo -c user.email=demo@example.invalid add -A
git -c user.name=demo -c user.email=demo@example.invalid commit -qm "feature/checkout: add discount (broken import)"
git checkout -q main
echo "repo ready at $DEST (branches: main, feature/checkout)"