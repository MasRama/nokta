#!/bin/sh
# Saves a screenshot of the devshell to build/shots/NAME.png and the top
# center of the screen, where the notch is, to build/shots/NAME-notch.png.
# Usage: tools/devshell/shot.sh NAME
set -eu
. "$(dirname "$0")/env.sh"
[ $# -eq 1 ] || { echo "usage: $0 NAME" >&2; exit 2; }
OUT="$ROOT/build/shots/$1.png"
mkdir -p "$ROOT/build/shots"
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" > /dev/null
python3 - "$OUT" "$ROOT/build/shots/$1-notch.png" <<'PY'
import sys
from PIL import Image
image = Image.open(sys.argv[1])
width = image.width
image.crop((width // 2 - 360, 0, width // 2 + 360, 240)).save(sys.argv[2])
PY
echo "$OUT"
