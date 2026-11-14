#!/usr/bin/env bash
# Bases only, for test-fitting the boards: generated/relay_box_<rev>-base.stl -> Bambu Studio projects.
set -euo pipefail
cd "$(dirname "$0")/../generated"
for rev in rev1a rev2; do
  python3 ~/.claude/plugins/cache/jimisola-plugins/cad-tools/0.2.1/skills/bambu-3mf/scripts/bambu_3mf.py \
    "relay_box_${rev}-base.stl" \
    --printer "Bambu Lab P2S 0.4 nozzle" \
    --process "0.20mm Standard @BBL P2S" \
    --filament "Bambu PLA Basic @BBL P2S" \
    --set enable_support=0 --set wall_loops=3 \
    -o "relay_box_${rev}-base-fittest.3mf"
done
