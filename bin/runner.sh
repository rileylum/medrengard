#!/bin/sh
# Runs bin/runner.py in the pinned SlopCodeBench runner's environment, on the pinned problems.
here=$(dirname "$(realpath "$0")")
export SCBENCH_PROBLEMS_PATH="$here/../vendor/scb-problems"
exec uv run --quiet --project "$here/../vendor/slop-code-bench" python "$here/runner.py" "$@"
