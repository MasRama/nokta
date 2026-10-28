#!/bin/sh
# Saves a screenshot of the devshell to build/shots/NAME.png and the top
# center of each monitor, where the notch is, to build/shots/NAME-notch.png
# (monitor 0) and NAME-notch-N.png (monitor N).
# Usage: tools/devshell/shot.sh NAME
set -eu
# shellcheck source=tools/devshell/env.sh
. "$(dirname "$0")/env.sh"
[ $# -eq 1 ] || { echo "usage: $0 NAME" >&2; exit 2; }
OUT="$ROOT/build/shots/$1.png"
mkdir -p "$ROOT/build/shots"
gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$OUT" > /dev/null
MONITORS=$(shell_eval "
JSON.stringify(Main.layoutManager.monitors.map((m) => [m.x, m.y, m.width]))")
python3 - "$OUT" "$ROOT/build/shots/$1-notch" "$MONITORS" <<'PY'
import re
import sys
from PIL import Image
image = Image.open(sys.argv[1])
# Eval answers with a GVariant such as (true, '"[[0,0,1920],[1920,0,1920]]"').
monitors = [tuple(map(int, m)) for m in re.findall(r'\[(-?\d+),(-?\d+),(\d+)\]', sys.argv[3])]
for index, (x, y, width) in enumerate(monitors):
    center = x + width // 2
    suffix = '' if index == 0 else f'-{index}'
    image.crop((center - 360, y, center + 360, y + 240)).save(f'{sys.argv[2]}{suffix}.png')
PY
echo "$OUT"
