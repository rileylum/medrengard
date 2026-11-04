#!/bin/sh
# Checks out SlopCodeBench's runner and problems at the commits pins.json names, under vendor/, and
# installs the runner's environment on the pinned Python.
set -eu
here=$(dirname "$(realpath "$0")")/..
pin() { node -p "require('$here/pins.json').$1"; }
for name in runner problems; do
  case $name in runner) dir=slop-code-bench ;; problems) dir=scb-problems ;; esac
  [ -d "$here/vendor/$dir" ] || git clone --quiet --filter=blob:none "$(pin "$name.repository")" "$here/vendor/$dir"
  git -C "$here/vendor/$dir" fetch --quiet origin
  git -C "$here/vendor/$dir" checkout --quiet --detach "$(pin "$name.commit")"
done
uv sync --quiet --project "$here/vendor/slop-code-bench" --python "$(pin python)"
