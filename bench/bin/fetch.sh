#!/bin/sh
# Checks out SlopCodeBench's runner and problems at the commits pins.json names, under vendor/ in the
# benchmark's data directory, as data.ts finds it, and installs the runner's environment on the
# pinned Python.
set -eu
here=$(dirname "$(realpath "$0")")/..
vendor=${MEDRENGARD_BENCH_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/medrengard/bench}/vendor
pin() { node -p "require('$here/pins.json').$1"; }
for name in runner problems; do
  case $name in runner) dir=slop-code-bench ;; problems) dir=scb-problems ;; esac
  [ -d "$vendor/$dir" ] || git clone --quiet --filter=blob:none "$(pin "$name.repository")" "$vendor/$dir"
  git -C "$vendor/$dir" fetch --quiet origin
  git -C "$vendor/$dir" checkout --quiet --detach "$(pin "$name.commit")"
done
uv sync --quiet --project "$vendor/slop-code-bench" --python "$(pin python)"
