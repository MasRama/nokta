#!/bin/sh
# Builds the extension and packs it as ../build/nokta@nokta.io.shell-extension.zip.
set -eu
cd "$(dirname "$0")/.."

rm -rf dist
npm run build
cp metadata.json dist/
if [ -f stylesheet.css ]; then
  cp stylesheet.css dist/
fi

# gnome-extensions pack only takes the well-known files by itself.
set --
for entry in dist/*; do
  name="$(basename "$entry")"
  case "$name" in
    extension.js|metadata.json|stylesheet.css|prefs.js) ;;
    *) set -- "$@" "--extra-source=$name" ;;
  esac
done

mkdir -p ../build
gnome-extensions pack dist --force --out-dir ../build "$@"
echo "Packed ../build/nokta@nokta.io.shell-extension.zip"
