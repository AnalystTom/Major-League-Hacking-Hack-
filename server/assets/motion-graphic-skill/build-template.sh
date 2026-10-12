#!/bin/sh
# Rebuilds resurface-short.html from resurface/ with the skill's own assembler. Run after editing a part; the
# processor only fills in DATA (the /*DATA*/null placeholder in config.js) per short, so it needs no Python.
set -eu
cd "$(dirname "$0")"
python3 -I scripts/assemble.py build resurface resurface-short.html
grep -q '/\*DATA\*/null' resurface-short.html
